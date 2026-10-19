/**
 * PRATYAKSHA Agent Execution Middleware
 * Sovereign Privacy-First Browser Agent
 *
 * Implements:
 * 1. Context Pruning: Prevents token blowup and model context exhaustion
 * 2. Tool Call Validation: Intercepts blacklisted targets before physical DOM dispatch
 * 3. Retry Filters & Circuit Breaker: Limits consecutive tool failures
 */

import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';

/**
 * Prunes conversation history messages to fit safely inside context windows.
 * Preserves the original goal/human message and the latest N messages,
 * while truncating stale large observations from earlier turns.
 *
 * @param {Array<Object>} messages
 * @param {Object} [options]
 * @param {number} [options.maxRecentMessages=12]
 * @param {number} [options.maxObservationLength=500]
 * @returns {Array<Object>} Pruned messages
 */
export function pruneContext(messages = [], options = {}) {
  if (!Array.isArray(messages) || messages.length <= 4) {
    return messages;
  }

  const maxRecent = options.maxRecentMessages || 12;
  const maxObsLen = options.maxObservationLength || 500;

  // Split into recent vs older messages
  const cutoffIndex = Math.max(0, messages.length - maxRecent);
  const olderMessages = messages.slice(0, cutoffIndex);
  const recentMessages = messages.slice(cutoffIndex);

  // Compact older tool messages so they don't consume tokens
  const compactedOlder = olderMessages.map(msg => {
    if (msg instanceof ToolMessage || msg?._getType?.() === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (content.length > maxObsLen) {
        const truncated = content.slice(0, maxObsLen) + '… [observation pruned for context]';
        return new ToolMessage({
          tool_call_id: msg.tool_call_id,
          name: msg.name,
          content: truncated
        });
      }
    }
    return msg;
  });

  return [...compactedOlder, ...recentMessages];
}

/**
 * Validates a model-generated tool call before execution.
 * Checks against active target blacklists and bad arguments.
 *
 * @param {Object} toolCall { name, args }
 * @param {Array<string|number>} blacklistedTargets
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateToolCall(toolCall, blacklistedTargets = []) {
  if (!toolCall || !toolCall.name) {
    return { valid: false, reason: 'Invalid or missing tool call specification' };
  }

  const blacklistSet = new Set((blacklistedTargets || []).map(String));
  const args = toolCall.args || {};

  // Check selector / index / target references
  if (args.index !== undefined && blacklistSet.has(String(args.index))) {
    return {
      valid: false,
      reason: `Target element index [${args.index}] is currently blacklisted due to prior failures.`
    };
  }

  if (args.selector && blacklistSet.has(String(args.selector))) {
    return {
      valid: false,
      reason: `Target selector "${args.selector}" is currently blacklisted due to prior failures.`
    };
  }

  return { valid: true };
}

/**
 * Evaluates whether a tool failure is retryable or if the circuit breaker should trip.
 *
 * @param {string} toolName
 * @param {Error|string} error
 * @param {Map<string, number>} failureCounters
 * @param {number} [maxConsecutiveFailures=3]
 * @returns {{ retryable: boolean, tripCircuit: boolean, failures: number }}
 */
export function filterRetries(toolName, error, failureCounters, maxConsecutiveFailures = 3) {
  const count = (failureCounters.get(toolName) || 0) + 1;
  failureCounters.set(toolName, count);

  const errMsg = typeof error === 'string' ? error : error?.message || '';
  const isFatal = /forbidden|aborted|cancelled|policy violation|unsupported/i.test(errMsg);

  if (isFatal) {
    return { retryable: false, tripCircuit: true, failures: count };
  }

  const tripCircuit = count >= maxConsecutiveFailures;
  return {
    retryable: !tripCircuit,
    tripCircuit,
    failures: count
  };
}

/**
 * Returns the LangChain message role ('ai' | 'human' | 'tool' | 'system' | 'unknown')
 * across message classes, plain objects, and deserialized checkpoints.
 */
export function getMessageType(msg) {
  if (!msg) return 'unknown';
  if (typeof msg._getType === 'function') return msg._getType();
  if (typeof msg.getType === 'function') return msg.getType();
  if (msg.type) return msg.type;
  if (msg._type) return msg._type;
  if (msg.role) {
    if (msg.role === 'assistant') return 'ai';
    if (msg.role === 'user') return 'human';
    return msg.role;
  }
  const ctor = msg.constructor?.name || '';
  if (ctor.startsWith('AIMessage')) return 'ai';
  if (ctor.startsWith('HumanMessage')) return 'human';
  if (ctor.startsWith('SystemMessage')) return 'system';
  if (ctor === 'ToolMessage') return 'tool';
  return 'unknown';
}

function getToolCalls(msg) {
  const list = msg?.tool_calls || msg?.additional_kwargs?.tool_calls;
  return Array.isArray(list) ? list : [];
}

function contentToString(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return content ? JSON.stringify(content) : '';
}

/**
 * Flattens the message log into an ordered action history:
 * [{ toolName, args, ok, observation, url }]
 * Pairs every AI tool call with its ToolMessage result by tool_call_id.
 */
export function extractActionHistory(messages = []) {
  const results = new Map();
  for (const msg of messages) {
    if (getMessageType(msg) === 'tool' && msg.tool_call_id) {
      results.set(msg.tool_call_id, contentToString(msg.content));
    }
  }

  const history = [];
  for (const msg of messages) {
    if (getMessageType(msg) !== 'ai') continue;
    for (const tc of getToolCalls(msg)) {
      const name = tc.name || tc.function?.name || 'unknown';
      let args = tc.args;
      if (!args && typeof tc.function?.arguments === 'string') {
        try { args = JSON.parse(tc.function.arguments); } catch (_) { args = {}; }
      }
      const observation = results.get(tc.id) ?? '';
      const ok = !!observation && !/^(ERROR|BLOCKED|SKIPPED|REJECTED)/.test(observation);
      const navMatch = observation.match(/navigated to (\S+)/i);
      const url = (args && (args.url || null)) || (navMatch ? navMatch[1].replace(/[.,]$/, '') : null);
      history.push({ toolName: name, args: args || {}, ok, observation, url });
    }
  }
  return history;
}

function describeArgs(args = {}) {
  const parts = [];
  if (args.target_id !== undefined) parts.push(`#${args.target_id}`);
  if (args.semantic_hint) parts.push(`"${String(args.semantic_hint).slice(0, 30)}"`);
  if (args.text !== undefined) parts.push(`text="${String(args.text).slice(0, 40)}"`);
  if (args.option) parts.push(`option="${String(args.option).slice(0, 30)}"`);
  if (args.key) parts.push(args.key);
  if (args.url) parts.push(String(args.url).slice(0, 80));
  if (args.query) parts.push(`"${String(args.query).slice(0, 60)}"`);
  if (args.direction) parts.push(args.direction);
  if (args.summary) parts.push(`"${String(args.summary).slice(0, 40)}"`);
  return parts.join(' ');
}

/**
 * Compact one-line-per-action log of everything done so far. Lets the model keep
 * long-horizon memory while only the most recent turns are sent verbatim.
 */
export function buildActionLog(history = [], maxLines = 25) {
  if (!history.length) return '';
  const start = Math.max(0, history.length - maxLines);
  const lines = [];
  if (start > 0) lines.push(`(${start} earlier actions omitted)`);
  history.slice(start).forEach((h, i) => {
    const firstLine = (h.observation || '').split('\n')[0].replace(/\s+/g, ' ');
    const outcome = h.ok ? 'OK' : 'FAILED';
    lines.push(`${start + i + 1}. ${h.toolName}(${describeArgs(h.args)}) → ${outcome}: ${firstLine.slice(0, 140)}`);
  });
  return lines.join('\n');
}

/**
 * Detects repetition: the same action (tool + args) attempted 3+ times recently,
 * or several consecutive failures. Returns a warning string or ''.
 */
export function detectLoop(history = [], windowSize = 8) {
  const recent = history.slice(-windowSize).filter(h => h.toolName !== 'finish_task');

  // Detect duplicate message spam (typing identical text 2+ times in chat/input)
  const typeHistory = recent.filter(h => h.toolName === 'type_into_element' && h.args?.text);
  const textCounts = new Map();
  for (const h of typeHistory) {
    const trimmedText = String(h.args.text).trim().toLowerCase();
    if (trimmedText.length > 5) {
      const count = (textCounts.get(trimmedText) || 0) + 1;
      textCounts.set(trimmedText, count);
      if (count >= 2) {
        return `SPAM / LOOP PREVENTION: You have already typed and sent this exact message ("${String(h.args.text).slice(0, 40)}..."). Do NOT repeat identical messages or spam the chat! If you are awaiting a reply or response from other participants, call wait_for({ wait_for_reply: true, track_dom_changes: true }) to hold execution until a new response is received.`;
      }
    }
  }

  const counts = new Map();
  for (const h of recent) {
    const key = `${h.toolName}:${JSON.stringify(h.args || {})}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count >= 3) {
      const name = key.split(':')[0];
      return `You repeated the same ${name} action ${count} times without progress. It is NOT working. Do something different: pick another element, scroll, press Escape to close an overlay, go back, or use a different route to the goal.`;
    }
  }
  const lastThree = history.slice(-3);
  if (lastThree.length === 3 && lastThree.every(h => !h.ok)) {
    return 'Your last 3 actions failed. Stop and re-read the CURRENT element list and visible text before acting; use only IDs that appear in it.';
  }
  return '';
}

/**
 * Builds the conversation window sent to the model:
 * - only the last `maxTurns` AI turns are kept verbatim (older ones live in the action log)
 * - tool observations are truncated (recent ones less aggressively)
 * - every AI tool call is guaranteed a matching ToolMessage (provider invariant)
 * - the window never starts with a dangling ToolMessage
 */
export function buildModelHistory(messages = [], options = {}) {
  const maxTurns = options.maxTurns ?? 6;
  const recentObsChars = options.recentObservationChars ?? 2500;
  const olderObsChars = options.olderObservationChars ?? 300;

  const clean = messages.filter(m => getMessageType(m) !== 'system');

  // Group into turns: an AI message plus its trailing tool messages; human messages stand alone
  const turns = [];
  for (const msg of clean) {
    const type = getMessageType(msg);
    if (type === 'tool') {
      if (turns.length && turns[turns.length - 1].ai) turns[turns.length - 1].tools.push(msg);
      continue; // orphan tool message: drop
    }
    if (type === 'ai') turns.push({ ai: msg, tools: [] });
    else turns.push({ other: msg });
  }

  const aiTurnIdx = turns.map((t, i) => (t.ai ? i : -1)).filter(i => i >= 0);
  const cutAt = aiTurnIdx.length > maxTurns ? aiTurnIdx[aiTurnIdx.length - maxTurns] : 0;
  const kept = turns.slice(cutAt);
  const recentBoundary = aiTurnIdx.length >= 2 ? aiTurnIdx[aiTurnIdx.length - 2] - cutAt : 0;

  const out = [];
  kept.forEach((turn, idx) => {
    if (turn.other) {
      out.push(turn.other);
      return;
    }
    out.push(turn.ai);
    const limit = idx >= recentBoundary ? recentObsChars : olderObsChars;
    const seen = new Set();
    for (const tm of turn.tools) {
      seen.add(tm.tool_call_id);
      const content = contentToString(tm.content);
      out.push(content.length > limit
        ? new ToolMessage({ tool_call_id: tm.tool_call_id, name: tm.name, content: `${content.slice(0, limit)}… [truncated]` })
        : tm);
    }
    for (const tc of getToolCalls(turn.ai)) {
      if (tc.id && !seen.has(tc.id)) {
        out.push(new ToolMessage({ tool_call_id: tc.id, name: tc.name || 'tool', content: 'No result recorded.' }));
      }
    }
  });
  return out;
}
