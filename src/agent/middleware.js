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
