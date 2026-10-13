/**
 * PRATYAKSHA Browser Agent Execution Node
 * Sovereign Privacy-First Browser Agent
 *
 * Implements the LangChain model + tool reasoning loop turn
 * with fresh DOM perception, system prompt generation, and observation tracking.
 */

import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { buildDOMTable, getPageContext } from '../browser/page-context.js';
import { createLangChainBrowserTools } from './browser-tools.js';
import { sanitizeObservationForModel } from '../safety/privacy.js';
import { TOOL_NAMES } from '../shared/constants.js';
import { pruneContext, validateToolCall } from './middleware.js';
import { formatError, NotFoundError, PolicyViolationError } from '../shared/errors.js';

/**
 * Builds the comprehensive system prompt for the model turn.
 */
export function buildAgentSystemPrompt({
  taskObjective = '',
  currentPlan = null,
  domTable = '',
  currentUrl = '',
  currentTitle = '',
  stepCount = 1,
  maxSteps = 100,
  blacklistedTargets = []
}) {
  let planGuidance = '';
  if (currentPlan?.subgoals?.length) {
    const list = currentPlan.subgoals
      .map(s => `  ${s.id}. ${s.description} [${s.riskTier}] → Evidence: ${s.completionEvidence}`)
      .join('\n');
    planGuidance = `
STRUCTURED EXECUTION PLAN:
${list}
Verification criteria: ${currentPlan.verificationCriteria?.join('; ') || 'Factual completion'}
`;
  }

  let blacklistWarning = '';
  if (blacklistedTargets.length > 0) {
    blacklistWarning = `
⚠️ ACTIVE BLACKLIST NOTICE:
The following element IDs have failed or led to dead ends: [${blacklistedTargets.join(', ')}].
DO NOT TARGET THESE ELEMENTS AGAIN.
`;
  }

  return `You are PRATYAKSHA (प्रत्यक्ष) — an elite sovereign, privacy-first autonomous browser agent.
You operate a real browser tab. You perceive the live page and invoke browser tools to complete the user's objective.

CURRENT OBJECTIVE: ${taskObjective}
STEP: ${stepCount} of ${maxSteps}
CURRENT PAGE:
  URL  : ${currentUrl || 'unknown'}
  Title: ${currentTitle || 'unknown'}

INTERACTIVE ELEMENTS (Inputs and buttons prioritized):
${domTable}
${planGuidance}
${blacklistWarning}
STRATEGY RULES:
1. Target elements by numeric [ID] from the table for maximum precision.
2. For form filling (such as emails), fill recipient and body fields before clicking Send.
3. Once all required actions are executed and verified on the real page, call finish_task.
4. Never hallucinate completion without performing the real browser operations.`;
}

function formatToolArgsSummary(args) {
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

function truncateText(str, max = 120) {
  if (!str || typeof str !== 'string') return '';
  const clean = str.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

/**
 * Executes a single agent turn: perceives DOM, invokes model with bound tools,
 * and records tool results.
 */
export async function browserAgentTurn(state, options = {}) {
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
  const task = state.sanitizedTask || state.originalTask;
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

  const domTable = buildDOMTable(pageCtx.elements, 75, new Set(blacklistedTargets));

  // 2. Build system prompt & messages
  const systemPrompt = buildAgentSystemPrompt({
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

  const modelWithTools = model.bindTools(tools);

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

  // Apply context pruning to history
  const prunedHistory = pruneContext(state.messages || []);

  // Filter out any stale SystemMessages from history to prevent duplicate/misordered system directives
  const cleanHistory = prunedHistory.filter(msg => {
    const type = getMessageType(msg);
    return type !== 'system';
  });

  // Ensure every tool_call in any historical AIMessage is paired with a ToolMessage.
  // APIs such as Mistral enforce code 3230 if tool calls count != tool responses count.
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
        const nextType = getMessageType(next);
        if (nextType === 'tool') {
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

  // If there are no historical messages, provide the user objective
  if (pairedHistory.length === 0) {
    messages.push(new HumanMessage(`Complete this task: ${task}`));
  } else {
    // CRITICAL API INVARIANT: The last message must NEVER be an AIMessage (role: assistant).
    // DeepSeek, Mistral, Anthropic, and other providers throw 400 (invalid_request_message_order / code 3230)
    // if the last message is assistant. Always prompt the model for its next browser action.
    const lastMsg = messages[messages.length - 1];
    const lastType = getMessageType(lastMsg);
    if (lastType === 'ai' || lastType === 'assistant' || (lastType !== 'human' && lastType !== 'user' && lastType !== 'tool')) {
      messages.push(new HumanMessage(
        `Proceed with the objective: "${task}". Review the live DOM elements table above and execute the next browser tool (e.g. click_element, type_into_element, or finish_task).`
      ));
    }
  }

  // 3. Model invocation
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

  // 4. Execute tool calls generated by model
  if (Array.isArray(aiResponse.tool_calls) && aiResponse.tool_calls.length > 0) {
    for (const toolCall of aiResponse.tool_calls) {
      if (signal?.aborted) {
        newMessages.push(new ToolMessage({
          tool_call_id: toolCall.id || `call_${Date.now()}`,
          name: toolCall.name,
          content: 'ABORTED: Operation cancelled by user.'
        }));
        continue;
      }

      events?.emit?.('THINKING', {
        phase: 'action',
        text: `Executing ${toolCall.name}(${formatToolArgsSummary(toolCall.args)})`,
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

      // Validate against target blacklists
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
        const matchingTool = tools.find(t => t.name === toolCall.name);
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
        text: `Observation: ${truncateText(observationText, 140)}`,
        toolName: toolCall.name,
        step: stepCount,
        maxSteps
      });
      events?.emit?.('OBSERVATION', {
        observation: observationText,
        toolName: toolCall.name,
        step: stepCount
      });

      // Scrub observation before passing to model context
      const scrubbedObservation = sanitizeObservationForModel(observationText, vault);

      newMessages.push(new ToolMessage({
        tool_call_id: toolCall.id || `call_${Date.now()}`,
        name: toolCall.name,
        content: scrubbedObservation
      }));
    }
  } else {
    // Check if the model signalled task completion in free-form text
    const text = (typeof aiResponse.content === 'string' ? aiResponse.content : '').toLowerCase();
    const isDone = text.includes('task complete') || text.includes('completed the task') || text.includes('finished the task');
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
    status: latestObservation?.isFinished ? 'TASK_FINISHED_SIGNAL' : (hasToolError ? 'TOOL_ERROR' : 'ACTING')
  };
}
