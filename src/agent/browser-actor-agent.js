/**
 * PRATYAKSHA Browser Actor Agent Node
 * Sovereign Privacy-First Browser Agent
 *
 * Standalone browser execution agent with its own built-in system prompt
 * and complete suite of browser tools. Executes the formulated plan end-to-end
 * with pure, understandable logic and zero unnecessary mathematical overhead.
 */

import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { interrupt } from '@langchain/langgraph';
import { buildDOMTable, getPageContext } from '../browser/page-context.js';
import { createLangChainBrowserTools } from './browser-tools.js';
import { sanitizeObservationForModel } from '../safety/privacy.js';
import { pruneContext, validateToolCall } from './middleware.js';
import { normalizeToolInvocation } from '../shared/schemas.js';
import { classifyAction } from '../safety/action-policy.js';
import { formatError, NotFoundError, PolicyViolationError } from '../shared/errors.js';

export const BROWSER_ACTOR_SYSTEM_PROMPT = `You are PRATYAKSHA Core Browser Agent — an autonomous visual browser execution actor.
You control live web applications, dynamic single-page apps (SPAs), chats, and web forms to accomplish user objectives.
You perceive live page interactive elements, evaluate dynamic changes on the website, and execute actions using your tools.

CRITICAL EXECUTION PRINCIPLES:
1. DO NOT OPERATE IN A RIGID ONE-WAY FLOW:
   Websites and chat applications are dynamic, asynchronous, and reactive. Never execute a predetermined script blindly.
   After performing each step, observe and identify what changed on the website before deciding the next move.

2. SENSE → ANALYZE CHANGES → ACT ITERATIVE CYCLE:
   In each iteration:
   - SENSE: Read the latest INTERACTIVE ELEMENTS table and previous tool observation.
   - ANALYZE CHANGES: Identify what actually changed on the page (e.g. did a new chat message or response bubble appear? Did a modal or dialog open? Did an input clear or accept text? Did a button state change? Did the URL change?).
   - DECIDE NEXT ACTION: If interacting with a chat or conversational interface, evaluate what the other party/system responded before drafting the next reply. If an action opened a modal, target elements inside that new modal. If waiting for an asynchronous event (like a bot or user response in a chat), observe the page before proceeding.
   - ONLY FINISH WHEN TRUE GOAL IS ATTAINED: In chat/multi-turn workflows, do NOT call finish_task prematurely after just sending one message unless the full conversation goal specified by the user is completely achieved.

3. DOM TARGETING:
   - Target elements by numeric [ID] from the provided interactive elements table for guaranteed accuracy.
   - For text inputs, search boxes, or chat fields, always use type_into_element before clicking send/submit.

4. NO CONVERSATIONAL CONFIRMATION DRIFT:
   - NEVER ask meta questions like "Shall I proceed?", "Would you like me to continue?", or "Shall I proceed with sending?". You are an autonomous browser actor—perform the browser actions directly on the page.

5. COMPLETION CRITERIA:
   - When the user's ultimate goal has been verified on the page (e.g., chat completed, search results extracted, email sent and confirmed), call finish_task immediately with a clear summary.`;

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
  blacklistedTargets = []
}) {
  let planSection = '';
  if (currentPlan?.subgoals?.length) {
    const items = currentPlan.subgoals
      .map(s => `  ${s.id}. ${s.description} [${s.riskTier}] → Evidence: ${s.completionEvidence}`)
      .join('\n');
    planSection = `\nSTRUCTURED EXECUTION PLAN:\n${items}\n`;
  }

  let blacklistSection = '';
  if (blacklistedTargets.length > 0) {
    blacklistSection = `\n⚠️ AVOID ELEMENTS: [${blacklistedTargets.join(', ')}] (Previously failed/dead ends)\n`;
  }

  let iterationNotice = '';
  if (stepCount > 1) {
    iterationNotice = `\n⚡ ITERATION ${stepCount}/${maxSteps} NOTICE:
The INTERACTIVE ELEMENTS table below shows the LIVE, UPDATED DOM following your previous action.
1. Identify what CHANGED on the website (new messages/replies, new modals, modified inputs, or state changes).
2. Analyze the newly appeared elements carefully.
3. Formulate and execute your next action based on this fresh state rather than assuming previous assumptions.\n`;
  }

  return `${BROWSER_ACTOR_SYSTEM_PROMPT}

CURRENT OBJECTIVE: ${taskObjective}
STEP: ${stepCount} of ${maxSteps}
CURRENT PAGE:
  URL  : ${currentUrl || 'unknown'}
  Title: ${currentTitle || 'unknown'}
${iterationNotice}
INTERACTIVE ELEMENTS:
${domTable}
${planSection}${blacklistSection}`;
}

function getMessageType(msg) {
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
  if (msg.constructor && msg.constructor.name) {
    if (msg.constructor.name === 'AIMessage' || msg.constructor.name === 'AIMessageChunk') return 'ai';
    if (msg.constructor.name === 'HumanMessage' || msg.constructor.name === 'HumanMessageChunk') return 'human';
    if (msg.constructor.name === 'SystemMessage' || msg.constructor.name === 'SystemMessageChunk') return 'system';
    if (msg.constructor.name === 'ToolMessage') return 'tool';
  }
  return 'unknown';
}

function formatArgsSummary(args) {
  if (!args || typeof args !== 'object') return '';
  const parts = [];
  if (args.target_id !== undefined) parts.push(`target: #${args.target_id}`);
  if (args.semantic_hint) parts.push(`"${args.semantic_hint}"`);
  if (args.url) parts.push(`url: "${args.url}"`);
  if (args.text) parts.push(`text: "${args.text.slice(0, 30)}${args.text.length > 30 ? '…' : ''}"`);
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

  // 1. Perceive current page DOM
  let pageCtx = { url: state.browserSession?.url || '', title: state.browserSession?.title || '', elements: [] };
  if (tabId) {
    try {
      pageCtx = await getPageContext(tabId, { chromeApi, signal });
    } catch (_) {}
  }

  events?.emit?.('THINKING', {
    phase: 'perceive',
    text: `Scanning DOM on ${pageCtx.url ? new URL(pageCtx.url).hostname : 'page'} (${pageCtx.elements?.length || 0} interactive elements discovered)`,
    step: stepCount,
    maxSteps
  });

  const domTable = buildDOMTable(pageCtx.elements, 35, new Set(blacklistedTargets));

  // 2. Build system prompt & message context
  const systemPrompt = buildBrowserActorPrompt({
    taskObjective: task,
    currentPlan: state.plan,
    domTable,
    currentUrl: pageCtx.url,
    currentTitle: pageCtx.title,
    stepCount,
    maxSteps,
    blacklistedTargets
  });

  const sessionContext = {
    activeTab: { id: tabId, url: pageCtx.url, title: pageCtx.title },
    vault,
    signal,
    chromeApi
  };

  const tools = createLangChainBrowserTools(() => sessionContext);

  let latestObservation = null;
  sessionContext.onToolResult = (res) => {
    latestObservation = res;
  };

  let modelWithTools;
  if (typeof model.bindTools === 'function') {
    modelWithTools = model.bindTools(tools);
  } else if (model.primaryModel && typeof model.primaryModel.bindTools === 'function') {
    modelWithTools = model.primaryModel.bindTools(tools);
  } else if (model.runnable && typeof model.runnable.bindTools === 'function') {
    modelWithTools = model.runnable.bindTools(tools);
  } else {
    modelWithTools = model;
  }

  // 3. Prepare message history with pruning and role alternation protection
  const prunedHistory = pruneContext(state.messages || []);
  const cleanHistory = prunedHistory.filter(msg => getMessageType(msg) !== 'system');

  // Ensure every tool call in history has a corresponding tool response
  const pairedHistory = [];
  for (let i = 0; i < cleanHistory.length; i++) {
    const msg = cleanHistory[i];
    pairedHistory.push(msg);

    const tcList = msg?.tool_calls || msg?.additional_kwargs?.tool_calls;
    if (Array.isArray(tcList) && tcList.length > 0) {
      const neededIds = new Set(tcList.map(tc => tc.id).filter(Boolean));
      let j = i + 1;
      while (j < cleanHistory.length) {
        const next = cleanHistory[j];
        if (getMessageType(next) === 'tool') {
          neededIds.delete(next.tool_call_id);
          j++;
        } else {
          break;
        }
      }
      for (const missingId of neededIds) {
        pairedHistory.push(new ToolMessage({
          tool_call_id: missingId,
          name: 'tool_execution',
          content: 'Observation recorded.'
        }));
      }
    }
  }

  const messages = [
    new SystemMessage(systemPrompt),
    ...pairedHistory
  ];

  if (pairedHistory.length === 0) {
    messages.push(new HumanMessage(`Complete this task: ${task}`));
  } else {
    // LLM Provider invariant: trailing message must never be an AIMessage
    const lastMsg = messages[messages.length - 1];
    const lastType = getMessageType(lastMsg);
    if (lastType === 'ai' || lastType === 'assistant' || (lastType !== 'human' && lastType !== 'user' && lastType !== 'tool')) {
      messages.push(new HumanMessage(
        `Step ${stepCount} Iteration: Review the updated live DOM elements table above. Identify what changed on the website after the previous step (e.g. newly arrived chat messages, opened modals, updated forms, or status changes). Analyze the updated state and execute the next tool for: "${task}". Do NOT execute in a blind one-way flow—react dynamically to the live page state.`
      ));
    }
  }

  // 4. Model invocation
  events?.emit?.('THINKING', {
    phase: 'reason',
    text: `Evaluating page state & choosing action for step ${stepCount}/${maxSteps}…`,
    step: stepCount,
    maxSteps
  });

  const aiResponse = await modelWithTools.invoke(messages);
  const newMessages = [aiResponse];

  if (typeof aiResponse.content === 'string' && aiResponse.content.trim()) {
    events?.emit?.('THINKING', {
      phase: 'thought',
      text: aiResponse.content.trim(),
      step: stepCount,
      maxSteps
    });
  }

  let hasToolError = false;

  // 5. Execute tool calls cleanly with alias normalization
  if (Array.isArray(aiResponse.tool_calls) && aiResponse.tool_calls.length > 0) {
    for (const rawToolCall of aiResponse.tool_calls) {
      if (signal?.aborted) {
        newMessages.push(new ToolMessage({
          tool_call_id: rawToolCall.id || `call_${Date.now()}`,
          name: rawToolCall.name,
          content: 'ABORTED: Operation cancelled by user.'
        }));
        continue;
      }

      const { toolName: normalizedName, args: normalizedArgs } = normalizeToolInvocation(rawToolCall.name, rawToolCall.args);
      const toolCall = {
        ...rawToolCall,
        name: normalizedName,
        args: normalizedArgs
      };

      events?.emit?.('THINKING', {
        phase: 'action',
        text: `Executing ${toolCall.name}(${formatArgsSummary(toolCall.args)})`,
        toolName: toolCall.name,
        args: toolCall.args,
        step: stepCount,
        maxSteps
      });
      events?.emit?.('TOOL_CALL', {
        toolName: toolCall.name,
        args: toolCall.args,
        step: stepCount
      });

      const validation = validateToolCall(toolCall, blacklistedTargets);
      let observationText = '';

      if (!validation.valid) {
        hasToolError = true;
        const polErr = new PolicyViolationError(validation.reason, { toolName: toolCall.name });
        const envelope = formatError(polErr);
        const errInfo = envelope.error || envelope;
        const exactMsg = (errInfo.message && !errInfo.message.includes('Our team has been notified'))
          ? errInfo.message
          : validation.reason;
        observationText = `BLOCKED [${toolCall.name} - ${errInfo.code || 'POLICY_VIOLATION'}]: ${exactMsg}`;
      } else {
        // Dynamic Pre-Execution Policy & Tool-Calling HITL Gate
        const policyDecision = classifyAction(toolCall.name, toolCall.args, pageCtx);
        let operatorApproved = true;

        if (policyDecision.requiresApproval) {
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

          if (options.enableInterrupts !== false) {
            try {
              const approvalRes = interrupt({
                type: 'TOOL_APPROVAL_REQUIRED',
                action: toolCall,
                reason: policyDecision.reason,
                riskTier: policyDecision.riskTier,
                summary: policyDecision.summary
              });

              if (approvalRes && (approvalRes.approved === false || approvalRes.status === 'REJECTED')) {
                operatorApproved = false;
                observationText = `REJECTED_BY_OPERATOR: The user denied permission to execute ${toolCall.name}. Reason: ${approvalRes.reason || 'User cancelled action.'}. Do not retry this identical action; choose an alternative safe action or conclude the task.`;
              }
            } catch (err) {
              console.warn('[BrowserActor] Tool interrupt skipped or unsupported in execution context:', err.message);
            }
          }
        }

        if (operatorApproved) {
          const matchingTool = tools.find(t => t.name === toolCall.name) ||
                               tools.find(t => t.name === rawToolCall.name);
          if (matchingTool) {
            try {
              observationText = await matchingTool.invoke(toolCall.args);
            } catch (err) {
              hasToolError = true;
              const envelope = formatError(err);
              const errInfo = envelope.error || envelope;
              const exactMsg = (errInfo.message && !errInfo.message.includes('Our team has been notified'))
                ? errInfo.message
                : (err?.message || String(err));
              observationText = `ERROR [${toolCall.name} - ${errInfo.code || 'TOOL_ERROR'}]: ${exactMsg}`;
            }
          } else {
            hasToolError = true;
            const nfErr = new NotFoundError(`Tool "${toolCall.name}" is not registered in the browser suite`);
            const envelope = formatError(nfErr);
            const errInfo = envelope.error || envelope;
            const exactMsg = (errInfo.message && !errInfo.message.includes('Our team has been notified'))
              ? errInfo.message
              : `Tool "${toolCall.name}" is not registered in the browser suite`;
            observationText = `ERROR [${toolCall.name} - ${errInfo.code || 'NOT_FOUND'}]: ${exactMsg}`;
          }
        }
      }

      if (observationText.startsWith('ERROR') || observationText.startsWith('BLOCKED')) {
        hasToolError = true;
      }

      events?.emit?.('THINKING', {
        phase: 'observation',
        text: `Observation: ${truncateString(observationText, 140)}`,
        toolName: toolCall.name,
        step: stepCount,
        maxSteps
      });
      events?.emit?.('OBSERVATION', {
        observation: observationText,
        toolName: toolCall.name,
        step: stepCount
      });

      const scrubbedObservation = sanitizeObservationForModel(observationText, vault);

      newMessages.push(new ToolMessage({
        tool_call_id: rawToolCall.id || `call_${Date.now()}`,
        name: rawToolCall.name,
        content: scrubbedObservation
      }));
    }
  } else {
    // Check if the model signalled task completion in free-form text
    const text = (typeof aiResponse.content === 'string' ? aiResponse.content : '').toLowerCase();
    const isDone = text.includes('task complete') ||
      text.includes('completed the task') ||
      text.includes('finished the task') ||
      text.includes('email has been sent') ||
      text.includes('message has been sent') ||
      text.includes('email was successfully sent') ||
      text.includes('successfully sent');
    if (isDone) {
      latestObservation = {
        isFinished: true,
        success: true,
        summary: aiResponse.content || 'Task completed.',
        steps: stepCount
      };
      events?.emit?.('THINKING', {
        phase: 'finish',
        text: `Model signaled completion: ${latestObservation.summary}`,
        step: stepCount,
        maxSteps
      });
    }
  }

  return {
    messages: newMessages,
    stepCount,
    browserSession: {
      tabId: sessionContext.activeTab.id,
      url: sessionContext.activeTab.url,
      title: sessionContext.activeTab.title
    },
    domTable,
    latestObservation,
    recoveryCount: hasToolError ? (state.recoveryCount || 0) : 0,
    status: latestObservation?.isFinished ? 'TASK_FINISHED_SIGNAL' : (hasToolError ? 'TOOL_ERROR' : 'ACTING')
  };
}
