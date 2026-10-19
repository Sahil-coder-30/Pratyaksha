/**
 * PRATYAKSHA Browser Actor Agent Node
 * Sovereign Privacy-First Browser Agent
 *
 * One LangGraph step of the browser agent:
 *   perceive (fresh DOM snapshot) → reason (LLM with tools) → act (execute tool calls).
 *
 * Context discipline (the main defence against hallucination):
 * - The page is described ONCE per step, in the system prompt, from a fresh scan.
 *   Old page snapshots are never replayed.
 * - Only the last few turns are sent verbatim; everything older is a one-line-per-action log.
 * - Element IDs are stable per DOM node, and a stale ID fails loudly instead of being guessed.
 */

import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { getPageContext, buildPageObservation } from '../browser/page-context.js';
import { createLangChainBrowserTools } from './browser-tools.js';
import { sanitizeObservationForModel } from '../safety/privacy.js';
import {
  validateToolCall,
  getMessageType,
  extractActionHistory,
  buildActionLog,
  buildModelHistory,
  detectLoop
} from './middleware.js';
import { normalizeToolInvocation } from '../shared/schemas.js';
import { classifyAction } from '../safety/action-policy.js';
import { formatError, NotFoundError, PolicyViolationError } from '../shared/errors.js';
import { TOOL_NAMES } from '../shared/constants.js';

export const BROWSER_ACTOR_SYSTEM_PROMPT = `You are PRATYAKSHA Core Browser Agent, an autonomous agent that completes tasks in a live web browser by calling tools.

HOW EACH STEP WORKS
- Every step you get a FRESH snapshot of the page: URL, scroll position, the interactive element list, and visible text.
- Read it, decide the next action(s), call the tool(s). Then you get a new snapshot showing the result.

ELEMENT LIST FORMAT
- One element per line: [ID] <tag> "label" plus value/placeholder/link/state.
- A leading * marks an element that is NEW since the last step (e.g. a menu, dialog, suggestion list or result that just appeared). Look at these first.
- "(dialog)" means the element is inside an open modal; act inside the modal first.

STRICT RULES (follow exactly)
1. Only use [ID]s that appear in the CURRENT element list. Never invent, guess or reuse an ID that is not listed now.
2. Never state facts you did not read on the page. Answers must come from VISIBLE TEXT or read_page output.
3. If what you need is not listed: scroll_page, or use find_on_page, or open a better URL. Do not click random elements.
4. Text fields: type_into_element (it replaces existing text). For search boxes set press_enter=true. Dropdowns: select_option. Popups/menus: press_key Escape.
5. Cookie banners, sign-up popups or overlays blocking the page: close or accept-necessary them first.
6. If an action fails, read the error and change approach. Never repeat the same failing action.
7. You may call several tools in one step only when they do not depend on each other's result (e.g. fill 3 form fields, then click Submit). After a click that navigates, the remaining calls are skipped automatically.
8. Do not ask the user questions like "Shall I proceed?". Act. If the task truly needs information you do not have (password, missing recipient), call finish_task with success=false and say what is missing.
9. If you hit a login wall, CAPTCHA, or payment step you are not authorized for, stop with finish_task(success=false) and explain.

FINISHING
- Call finish_task as soon as the goal is verifiably done on the page. Put the actual result (the answer, the data found, what was sent) in the summary.
- For information tasks, read the page first, then finish with the answer. Do not finish without the answer.
- Do not call finish_task for a multi-step goal (chat, form, email) until the final step is confirmed on the page.`;

/**
 * Tools hidden from the model by default: they either return nothing a text model
 * can use (screenshot), duplicate other tools, or need approval on every call.
 */
export const DEFAULT_HIDDEN_TOOLS = Object.freeze([
  TOOL_NAMES.SCREENSHOT,
  TOOL_NAMES.GET_PAGE_METADATA,
  TOOL_NAMES.INSPECT_DOM,
  TOOL_NAMES.GO_FORWARD,
  TOOL_NAMES.EXECUTE_JS
]);

// Tools after which the remaining batched calls must not run if the page navigated
const NAVIGATING_TOOLS = new Set([
  TOOL_NAMES.CLICK_ELEMENT,
  TOOL_NAMES.OPEN_URL,
  TOOL_NAMES.SEARCH_WEB,
  TOOL_NAMES.GO_BACK,
  TOOL_NAMES.GO_FORWARD,
  TOOL_NAMES.SWITCH_TAB,
  TOOL_NAMES.TYPE_INTO_ELEMENT,
  TOOL_NAMES.PRESS_KEY,
  TOOL_NAMES.SELECT_OPTION
]);

/**
 * Builds the runtime system prompt for the browser execution turn.
 */
export function buildBrowserActorPrompt({
  taskObjective = '',
  currentPlan = null,
  domTable = '',
  currentUrl = '',
  currentTitle = '',
  stepCount = 1,
  maxSteps = 100,
  blacklistedTargets = [],
  actionLog = '',
  warnings = []
}) {
  const sections = [BROWSER_ACTOR_SYSTEM_PROMPT, '', `TASK: ${taskObjective}`, `STEP: ${stepCount} of ${maxSteps}`];

  if (currentPlan?.subgoals?.length) {
    const items = currentPlan.subgoals.map(s => `  ${s.id}. ${s.description}`).join('\n');
    sections.push(`SUGGESTED APPROACH (a hint only; follow the real page if it differs):\n${items}`);
  }

  if (actionLog) {
    sections.push(`ACTIONS SO FAR:\n${actionLog}`);
  }

  if (blacklistedTargets.length > 0) {
    sections.push(`AVOID ELEMENTS: [${blacklistedTargets.join(', ')}] (they failed repeatedly)`);
  }

  if (warnings.length) {
    sections.push(`⚠️ WARNING:\n${warnings.map(w => `- ${w}`).join('\n')}`);
  }

  sections.push(`CURRENT PAGE:\n  URL  : ${currentUrl || 'unknown'}\n  Title: ${currentTitle || 'unknown'}`);
  sections.push(`INTERACTIVE ELEMENTS:\n${domTable}`);

  return sections.join('\n\n');
}

function formatArgsSummary(args) {
  if (!args || typeof args !== 'object') return '';
  const parts = [];
  if (args.target_id !== undefined) parts.push(`target: #${args.target_id}`);
  if (args.semantic_hint) parts.push(`"${args.semantic_hint}"`);
  if (args.url) parts.push(`url: "${args.url}"`);
  if (args.text) parts.push(`text: "${args.text.slice(0, 30)}${args.text.length > 30 ? '…' : ''}"`);
  if (args.option) parts.push(`option: "${args.option}"`);
  if (args.key) parts.push(`key: ${args.key}`);
  if (args.summary) parts.push(`"${args.summary.slice(0, 40)}"`);
  if (parts.length === 0) {
    const json = JSON.stringify(args);
    return json.length > 40 ? json.slice(0, 40) + '…' : json;
  }
  return parts.join(', ');
}

function truncateString(str, max = 120) {
  if (!str || typeof str !== 'string') return '';
  const clean = str.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function errorText(err, fallback) {
  const envelope = formatError(err);
  const errInfo = envelope.error || envelope;
  const msg = (errInfo.message && !errInfo.message.includes('Our team has been notified'))
    ? errInfo.message
    : (err?.message || fallback || String(err));
  return { code: errInfo.code, message: msg };
}

function bindModelTools(model, tools) {
  if (typeof model.bindTools === 'function') return model.bindTools(tools);
  if (model.primaryModel && typeof model.primaryModel.bindTools === 'function') return model.primaryModel.bindTools(tools);
  if (model.runnable && typeof model.runnable.bindTools === 'function') return model.runnable.bindTools(tools);
  return model;
}

/** Number of consecutive AI messages without tool calls at the end of the log. */
function trailingTextOnlyTurns(messages = []) {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const type = getMessageType(messages[i]);
    if (type === 'human') continue;
    if (type !== 'ai') break;
    const calls = messages[i].tool_calls || messages[i].additional_kwargs?.tool_calls;
    if (Array.isArray(calls) && calls.length) break;
    count++;
  }
  return count;
}

/**
 * Executes one tool call through the shared tool suite and returns the observation text.
 */
async function runTool(tools, toolCall, rawName) {
  const matchingTool = tools.find(t => t.name === toolCall.name) || tools.find(t => t.name === rawName);
  if (!matchingTool) {
    const { code, message } = errorText(
      new NotFoundError(`Tool "${toolCall.name}" is not registered in the browser suite`),
      `Tool "${toolCall.name}" is not registered in the browser suite`
    );
    return `ERROR [${toolCall.name} - ${code || 'NOT_FOUND'}]: ${message}`;
  }
  try {
    return await matchingTool.invoke(toolCall.args);
  } catch (err) {
    const { code, message } = errorText(err);
    return `ERROR [${toolCall.name} - ${code || 'TOOL_ERROR'}]: ${message}`;
  }
}

/**
 * Creates a standalone Browser Actor Agent instance.
 */
export function createBrowserActorAgent(options = {}) {
  return {
    name: 'browser_actor_agent',
    systemPrompt: BROWSER_ACTOR_SYSTEM_PROMPT,

    async invoke(state) {
      return browserActorAgentNode(state, options);
    }
  };
}

/**
 * Builds the tool suite + session context used by both the actor and the approval node.
 */
export function createActorToolSession({ tabId, url = '', title = '', vault, signal, chromeApi, exposeAllTools = false }) {
  const sessionContext = {
    activeTab: { id: tabId, url, title },
    vault,
    signal,
    chromeApi,
    lastResult: null
  };
  sessionContext.onToolResult = (res) => {
    sessionContext.lastResult = res;
  };
  const tools = createLangChainBrowserTools(() => sessionContext, {
    exclude: exposeAllTools ? [] : DEFAULT_HIDDEN_TOOLS
  });
  return { sessionContext, tools };
}

/**
 * Executes a previously approved tool call (used by the approval node after resume).
 */
export async function executeApprovedToolCall(pending, options = {}) {
  const { sessionContext, tools } = createActorToolSession({
    tabId: pending.tabId,
    url: pending.url,
    title: pending.title,
    vault: options.vault,
    signal: options.signal,
    chromeApi: options.chromeApi,
    exposeAllTools: true
  });
  const observation = await runTool(tools, pending.toolCall, pending.toolCall.name);
  return { observation, result: sessionContext.lastResult, activeTab: sessionContext.activeTab };
}

/**
 * LangGraph node handler for the browser execution agent.
 * Perceives live DOM, binds browser tools, invokes LLM, and executes actions.
 */
export async function browserActorAgentNode(state, options = {}) {
  const model = options.model;
  const chromeApi = options.chromeApi;
  const vault = options.vault;
  const signal = options.signal;
  const events = options.events;
  const maxSteps = options.maxSteps || 100;
  const interruptsEnabled = options.enableInterrupts !== false;

  if (!model) {
    return {
      stepCount: (state.stepCount || 0) + 1,
      status: 'TERMINATED',
      error: { code: 'MODEL_UNAVAILABLE', message: 'No LLM model configured for browser agent.' }
    };
  }

  const tabId = state.browserSession?.tabId;
  const task = state.sanitizedTask || state.originalTask || '';
  const stepCount = (state.stepCount || 0) + 1;
  const blacklistedTargets = state.blacklistedTargets || [];
  const priorMessages = state.messages || [];

  // 1. Perceive current page
  let pageCtx = { url: state.browserSession?.url || '', title: state.browserSession?.title || '', elements: [], page: null };
  if (tabId) {
    try {
      pageCtx = await getPageContext(tabId, { chromeApi, signal });
    } catch (_) {}
  }

  let hostname = 'page';
  try { if (pageCtx.url) hostname = new URL(pageCtx.url).hostname; } catch (_) {}
  events?.emit?.('THINKING', {
    phase: 'perceive',
    text: `Scanning DOM on ${hostname} (${pageCtx.elements?.length || 0} interactive elements discovered)`,
    step: stepCount,
    maxSteps
  });

  const blacklistSet = new Set(blacklistedTargets.map(Number));
  const domTable = sanitizeObservationForModel(
    buildPageObservation({ elements: pageCtx.elements || [], page: pageCtx.page, blacklistedTargets: blacklistSet }),
    vault
  ) || 'No interactive elements detected.';

  // 2. Memory: compact action log + loop detection over the full history
  const actionHistory = extractActionHistory(priorMessages);
  const warnings = [];
  const loopWarning = detectLoop(actionHistory);
  if (loopWarning) warnings.push(loopWarning);
  if (stepCount >= maxSteps - 2) {
    warnings.push(`Only ${maxSteps - stepCount + 1} steps left. Finish now with what you have (finish_task).`);
  }

  const systemPrompt = buildBrowserActorPrompt({
    taskObjective: task,
    currentPlan: state.plan,
    domTable,
    currentUrl: pageCtx.url,
    currentTitle: pageCtx.title,
    stepCount,
    maxSteps,
    blacklistedTargets,
    actionLog: buildActionLog(actionHistory),
    warnings
  });

  const { sessionContext, tools } = createActorToolSession({
    tabId,
    url: pageCtx.url,
    title: pageCtx.title,
    vault,
    signal,
    chromeApi,
    exposeAllTools: options.exposeAllTools
  });
  const modelWithTools = bindModelTools(model, tools);

  // 3. Conversation window: task first (providers like Gemini need a leading user turn),
  //    then the last few turns, and never a trailing AI message.
  const history = buildModelHistory(priorMessages, { maxTurns: options.maxHistoryTurns ?? 6 });
  const messages = [new SystemMessage(systemPrompt), new HumanMessage(`Task: ${task}`), ...history];
  const lastType = getMessageType(messages[messages.length - 1]);
  if (lastType === 'ai') {
    messages.push(new HumanMessage(
      `You replied without calling a tool. Look at the current page above and call the next tool. If the task is already complete, call finish_task with the result.`
    ));
  } else if (history.length > 0 && lastType === 'tool') {
    messages.push(new HumanMessage(`Step ${stepCount}: the page snapshot in the system message is fresh. Check what changed (elements marked *), then call the next tool.`));
  }

  // 4. Reason
  events?.emit?.('THINKING', {
    phase: 'reason',
    text: `Evaluating page state & choosing action for step ${stepCount}/${maxSteps}…`,
    step: stepCount,
    maxSteps
  });

  const aiResponse = await modelWithTools.invoke(messages, signal ? { signal } : undefined);
  const newMessages = [aiResponse];

  const thoughtText = typeof aiResponse.content === 'string'
    ? aiResponse.content.trim()
    : (Array.isArray(aiResponse.content) ? aiResponse.content.map(p => p?.text || '').join('').trim() : '');
  if (thoughtText) {
    events?.emit?.('THINKING', { phase: 'thought', text: thoughtText, step: stepCount, maxSteps });
  }

  let hasToolError = false;
  let latestObservation = null;
  let pendingToolCall = null;
  const stepStartUrl = pageCtx.url;

  // 5. Act
  const toolCalls = Array.isArray(aiResponse.tool_calls) ? aiResponse.tool_calls : [];
  let skipReason = '';

  for (const rawToolCall of toolCalls) {
    const callId = rawToolCall.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const { toolName: normalizedName, args: normalizedArgs } = normalizeToolInvocation(rawToolCall.name, rawToolCall.args);
    const toolCall = { ...rawToolCall, id: callId, name: normalizedName, args: normalizedArgs };

    if (signal?.aborted) {
      newMessages.push(new ToolMessage({ tool_call_id: callId, name: rawToolCall.name, content: 'ABORTED: Operation cancelled by user.' }));
      continue;
    }

    if (skipReason) {
      newMessages.push(new ToolMessage({ tool_call_id: callId, name: rawToolCall.name, content: `SKIPPED: ${skipReason}` }));
      continue;
    }

    events?.emit?.('THINKING', {
      phase: 'action',
      text: `Executing ${toolCall.name}(${formatArgsSummary(toolCall.args)})`,
      toolName: toolCall.name,
      args: toolCall.args,
      step: stepCount,
      maxSteps
    });
    events?.emit?.('TOOL_CALL', { toolName: toolCall.name, args: toolCall.args, step: stepCount });

    let observationText = '';
    const validation = validateToolCall(
      { ...toolCall, args: { ...toolCall.args, index: toolCall.args.target_id ?? toolCall.args.index } },
      blacklistedTargets
    );

    if (!validation.valid) {
      const { code, message } = errorText(new PolicyViolationError(validation.reason, { toolName: toolCall.name }), validation.reason);
      observationText = `BLOCKED [${toolCall.name} - ${code || 'POLICY_VIOLATION'}]: ${message}`;
    } else {
      // Pre-execution policy gate. Approval runs in its own graph node so that the
      // resume after a human decision never re-runs perception or the LLM call.
      const policyDecision = classifyAction(toolCall.name, toolCall.args, pageCtx);
      if (policyDecision.requiresApproval && interruptsEnabled) {
        events?.emit?.('THINKING', {
          phase: 'approval',
          text: `Tool intercepted: requires operator confirmation (${policyDecision.reason})`,
          step: stepCount,
          maxSteps
        });
        events?.emit?.('TOOL_APPROVAL_REQUIRED', {
          toolName: toolCall.name,
          args: toolCall.args,
          reason: policyDecision.reason,
          riskTier: policyDecision.riskTier,
          step: stepCount
        });
        pendingToolCall = {
          toolCall: { id: callId, name: toolCall.name, args: toolCall.args },
          rawName: rawToolCall.name,
          reason: policyDecision.reason,
          riskTier: policyDecision.riskTier,
          summary: policyDecision.summary,
          tabId: sessionContext.activeTab.id,
          url: pageCtx.url,
          title: pageCtx.title
        };
        skipReason = 'waiting for user approval of a previous action in this step; re-issue it next step if still needed.';
        continue; // its ToolMessage is added by the approval node
      }

      sessionContext.lastResult = null;
      observationText = await runTool(tools, toolCall, rawToolCall.name);
      if (sessionContext.lastResult) {
        latestObservation = { ...sessionContext.lastResult, args: toolCall.args };
      }
    }

    if (/^(ERROR|BLOCKED)/.test(observationText)) {
      hasToolError = true;
      latestObservation = latestObservation && latestObservation.toolName === toolCall.name
        ? latestObservation
        : { ok: false, toolName: toolCall.name, args: toolCall.args, observation: observationText, error: { message: observationText } };
    }

    events?.emit?.('THINKING', {
      phase: 'observation',
      text: `Observation: ${truncateString(observationText, 140)}`,
      toolName: toolCall.name,
      step: stepCount,
      maxSteps
    });
    events?.emit?.('OBSERVATION', { observation: observationText, toolName: toolCall.name, step: stepCount });

    newMessages.push(new ToolMessage({
      tool_call_id: callId,
      name: rawToolCall.name,
      content: sanitizeObservationForModel(observationText, vault)
    }));

    if (latestObservation?.isFinished) {
      skipReason = 'task already finished.';
      continue;
    }

    // Stop the batch when the page navigated: later IDs/assumptions are stale
    const afterUrl = latestObservation?.page?.url || '';
    const switchedTab = !!latestObservation?.newTabId;
    if (NAVIGATING_TOOLS.has(toolCall.name) && (switchedTab || (afterUrl && stepStartUrl && afterUrl !== stepStartUrl))) {
      skipReason = 'the page changed after the previous action. Re-check the new page snapshot before acting.';
    }
  }

  // 6. Text-only replies: nudge once, then accept the text as the final answer
  if (toolCalls.length === 0) {
    const consecutive = trailingTextOnlyTurns(priorMessages) + 1;
    if (consecutive >= 2 && thoughtText) {
      latestObservation = { isFinished: true, success: true, summary: thoughtText, steps: stepCount };
      events?.emit?.('THINKING', { phase: 'finish', text: `Model answered without tools: ${truncateString(thoughtText, 120)}`, step: stepCount, maxSteps });
    }
  }

  const finalPage = latestObservation?.page?.url ? latestObservation.page : null;
  const update = {
    messages: newMessages,
    stepCount,
    browserSession: {
      tabId: sessionContext.activeTab.id,
      url: finalPage?.url || pageCtx.url || sessionContext.activeTab.url,
      title: finalPage?.title || pageCtx.title || sessionContext.activeTab.title
    },
    domTable,
    latestObservation,
    recoveryCount: hasToolError ? (state.recoveryCount || 0) : 0,
    status: latestObservation?.isFinished
      ? 'TASK_FINISHED_SIGNAL'
      : (pendingToolCall ? 'AWAITING_TOOL_APPROVAL' : (hasToolError ? 'TOOL_ERROR' : 'ACTING'))
  };
  if (pendingToolCall) update.pendingToolCall = pendingToolCall;
  return update;
}
