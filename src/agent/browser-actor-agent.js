/**
 * PRATYAKSHA Browser Actor Agent Node
 * Sovereign Privacy-First Browser Agent
 *
 * Standalone browser execution agent with its own built-in system prompt
 * and complete suite of browser tools. Executes the formulated plan end-to-end
 * with pure, understandable logic and zero unnecessary mathematical overhead.
 */

import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { buildDOMTable, getPageContext } from '../browser/page-context.js';
import { createLangChainBrowserTools } from './browser-tools.js';
import { sanitizeObservationForModel } from '../safety/privacy.js';
import { pruneContext, validateToolCall } from './middleware.js';
import { normalizeToolInvocation } from '../shared/schemas.js';
import { formatError, NotFoundError, PolicyViolationError } from '../shared/errors.js';

export const BROWSER_ACTOR_SYSTEM_PROMPT = `You are PRATYAKSHA Core Browser Agent — an autonomous browser execution actor.
You control real web pages to accomplish user objectives.
You perceive live page interactive elements, select precise targets, and execute actions using your tools.

EXECUTION RULES:
1. Target elements by numeric [ID] from the provided interactive elements table for maximum accuracy.
2. For form filling (such as search, email, or input), type required values before triggering buttons.
3. NEVER ask conversational confirmation questions like "Shall I proceed?", "Would you like me to continue?", or "Shall I proceed with sending?". You are an autonomous agent—execute the full sequence to completion.
4. Once an email is sent, form is submitted, or the objective is fulfilled, call finish_task immediately with success: true and a clear summary. Do NOT keep clicking around.
5. Never claim completion without executing real browser operations.`;

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

  return `${BROWSER_ACTOR_SYSTEM_PROMPT}

CURRENT OBJECTIVE: ${taskObjective}
STEP: ${stepCount} of ${maxSteps}
CURRENT PAGE:
  URL  : ${currentUrl || 'unknown'}
  Title: ${currentTitle || 'unknown'}

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
        `Proceed with the objective: "${task}". Review the live DOM elements table above and execute the next browser tool (e.g. click_element, type_into_element, or finish_task). DO NOT ask conversational questions ("Shall I proceed?")—execute the action autonomously or call finish_task if the objective is fulfilled.`
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
