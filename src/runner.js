/**
 * PRATYAKSHA Unified Execution Runner
 * Sovereign Privacy-First Browser Agent
 *
 * Primary execution entry point bridging UI controllers (Side Panel, Popup)
 * to the compiled LangGraph StateGraph engine, model factory, checkpointer, and events.
 */

import { makeModel, makeModelWithFallbacks, buildAutomaticFallbacks } from './agent/models.js';
import { createAgentGraph, createTwoAgentGraph } from './agent/graph.js';
import { ChromeStorageSaver } from './persistence/checkpointer.js';
import { ThreadStore } from './persistence/thread-store.js';
import { AgentEventEmitter, AGENT_EVENT_TYPES } from './ui/agent-events.js';
import { globalVault } from './safety/privacy.js';
import { verifyApproval, consumeApproval } from './safety/approval.js';
import { formatError, toErrorResponse } from './shared/errors.js';

export class PratyakshaAgentRunner {
  constructor(options = {}) {
    this.provider = options.provider || 'mistral';
    this.apiKey = (options.apiKey || '').trim();
    this.modelName = options.model || (
      this.provider === 'mistral' ? 'codestral-latest' :
      this.provider === 'openrouter' ? 'deepseek/deepseek-v4.1-flash' :
      'gemini-3.5-flash'
    );
    this.geminiApiKey = (options.geminiApiKey || '').trim();
    this.openrouterApiKey = (options.openrouterApiKey || '').trim();
    this.mistralApiKey = (options.mistralApiKey || '').trim();
    this.vault = options.vault || globalVault;
    this.maxSteps = options.maxSteps || 100;
    this.useTwoAgentGraph = options.useTwoAgentGraph ?? false;
    this.onEvent = options.onEvent || (() => {});
    this.chromeApi = options.chromeApi || (typeof chrome !== 'undefined' ? chrome : null);

    this.checkpointer = new ChromeStorageSaver();
    this.threadStore = new ThreadStore();
    this.events = new AgentEventEmitter(this.onEvent);

    this.abortController = new AbortController();
    this.isCancelled = false;
    this.activeThreadId = null;
    this.activeTab = null;
    this.pendingApproval = null;
    this.app = null;
    this.graphConfig = null;
    this.lastState = null;
  }

  cancel() {
    this.isCancelled = true;
    this.events.isCancelled = true;
    try {
      this.abortController.abort();
    } catch (_) {}
    this._clearHighlights().catch(() => {});
    this.events.emitCancelled('Agent stopped immediately by user.');
  }

  async _clearHighlights() {
    if (!this.activeTab?.id || !this.chromeApi?.tabs) return;
    try {
      this.chromeApi.tabs.sendMessage(this.activeTab.id, { type: 'CLEAR_HIGHLIGHT' }, () => {
        if (this.chromeApi.runtime?.lastError) {}
      });
      this.chromeApi.tabs.sendMessage(this.activeTab.id, { type: 'SET_CONTROL_ACTIVE', active: false }, () => {
        if (this.chromeApi.runtime?.lastError) {}
      });
    } catch (_) {}
  }

  /**
   * Main run entry point.
   */
  async run(userTask, activeTab) {
    this.isCancelled = false;
    this.events.isCancelled = false;
    this.abortController = new AbortController();
    this.activeTab = activeTab;

    const threadId = `th_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const taskId = `task_${Date.now()}`;
    this.activeThreadId = threadId;
    this.runStartTime = Date.now();
    this.events.setContext({
      threadId,
      taskId,
      provider: this.provider,
      model: this.modelName
    });

    // 1. Initialize checkpointer & thread store
    await this.checkpointer.hydrate();
    await this.threadStore.load();
    await this.threadStore.createThread({
      threadId,
      taskId,
      task: userTask,
      tabId: activeTab?.id,
      meta: { provider: this.provider, model: this.modelName }
    });

    // 2. Resolve Model with Automatic Degradation Fallbacks
    let model = null;
    try {
      if (this.apiKey) {
        const primaryConfig = {
          provider: this.provider,
          apiKey: this.apiKey,
          model: this.modelName
        };
        const fallbacks = buildAutomaticFallbacks(primaryConfig, {
          geminiApiKey: this.geminiApiKey,
          openrouterApiKey: this.openrouterApiKey,
          mistralApiKey: this.mistralApiKey
        });
        model = makeModelWithFallbacks(primaryConfig, fallbacks);
      }
    } catch (err) {
      this.events.emit(AGENT_EVENT_TYPES.TOOL_ERROR, { error: `Model setup error: ${err.message}` });
      return { success: false, summary: `Model configuration error: ${err.message}`, steps: 0 };
    }

    // 3. Emit task start
    this.events.emit(AGENT_EVENT_TYPES.TASK_START, {
      task: userTask,
      provider: this.provider,
      model: this.modelName
    });

    this.events.emitStateChange('PERCEIVING', 'Scanning DOM & evaluating task…');

    // 4. Compile Graph
    const graphFactory = this.useTwoAgentGraph ? createTwoAgentGraph : createAgentGraph;
    const app = graphFactory({
      model,
      chromeApi: this.chromeApi,
      vault: this.vault,
      checkpointer: this.checkpointer,
      signal: this.abortController.signal,
      maxSteps: this.maxSteps,
      events: this.events
    });

    const initialState = {
      threadId,
      taskId,
      originalTask: userTask,
      browserSession: {
        tabId: activeTab?.id || null,
        url: activeTab?.url || '',
        title: activeTab?.title || ''
      }
    };

    const graphConfig = {
      configurable: { thread_id: threadId },
      recursionLimit: Math.max(500, (this.maxSteps || 100) * 5)
    };

    try {
      this.events.emitStateChange('REASONING', `Reasoning with ${this.modelName}…`);

      this.app = app;
      this.graphConfig = graphConfig;

      const result = await app.invoke(initialState, graphConfig);
      return await this._handleResult(result, threadId);
    } catch (err) {
      if (this.isCancelled || err.name === 'AbortError') {
        await this._clearHighlights();
        return { success: false, summary: 'Agent stopped immediately by user.', steps: 1 };
      }

      await this._clearHighlights();
      const envelope = formatError(err);
      const errInfo = envelope.error || envelope;
      let exactMsg = (errInfo.message && !errInfo.message.includes('Our team has been notified'))
        ? errInfo.message
        : (err?.message || String(err));
      let code = errInfo.code || err?.code || 'EXECUTION_ERROR';
      const details = errInfo.details || err?.details || null;

      const diagnosed = diagnoseExecutionError(err, exactMsg, code);
      exactMsg = diagnosed.message;
      code = diagnosed.code;

      this.events.emit(AGENT_EVENT_TYPES.TOOL_ERROR, { error: exactMsg, code, details });
      return {
        success: false,
        summary: `Execution error [${code}]: ${exactMsg}`,
        error: { code, message: exactMsg, details },
        steps: 1
      };
    }
  }

  async _handleResult(result, threadId) {
    this.lastState = result;

    if (this.isCancelled) {
      await this._clearHighlights();
      return { success: false, summary: 'Agent stopped immediately by user.', steps: result.stepCount || 1 };
    }

    // Check if human approval is requested
    if (result.status === 'AWAITING_APPROVAL' || result.finalResult?.awaitingApproval) {
      const pendingReq = result.pendingApproval || result.finalResult?.pendingApproval;
      this.pendingApproval = pendingReq;

      this.events.emit(AGENT_EVENT_TYPES.APPROVAL_REQUIRED, {
        request: pendingReq,
        threadId,
        toolName: pendingReq?.action?.toolName,
        reason: pendingReq?.reason
      });

      await this.threadStore.updateThread(threadId, {
        status: 'AWAITING_APPROVAL',
        summary: `Action requires approval: ${pendingReq?.reason}`
      });

      return {
        success: false,
        awaitingApproval: true,
        pendingApproval: pendingReq,
        summary: `Action requires approval: ${pendingReq?.reason}`,
        steps: result.stepCount || 1
      };
    }

    // Check if user input is requested
    if (result.status === 'AWAITING_USER_INPUT' || result.finalResult?.awaitingUserInput) {
      await this._clearHighlights();
      const summary = result.finalResult?.summary || 'Additional information required from user.';
      this.events.emitStateChange('AWAITING_INPUT', summary);
      await this.threadStore.updateThread(threadId, {
        status: 'AWAITING_USER_INPUT',
        summary
      });
      return {
        success: false,
        awaitingUserInput: true,
        summary,
        missingInformation: result.finalResult?.missingInformation || result.plan?.missingInformation || [],
        steps: result.stepCount || 1
      };
    }

    await this._clearHighlights();

    const final = result.finalResult || {
      success: result.status === 'COMPLETED',
      summary: result.status === 'COMPLETED' ? 'Task accomplished.' : 'Task ended.',
      steps: result.stepCount || 1
    };

    const durationMs = this.runStartTime ? Date.now() - this.runStartTime : 0;

    if (final.success) {
      this.events.emitTaskComplete(final.summary, true, final.steps, { durationMs });
    } else {
      this.events.emit(AGENT_EVENT_TYPES.BUDGET_REACHED, { summary: final.summary, steps: final.steps, durationMs });
    }

    await this.threadStore.updateThread(threadId, {
      status: final.success ? 'COMPLETED' : 'TERMINATED',
      summary: final.summary
    });

    await this.checkpointer.flush().catch(() => {});

    return {
      success: final.success,
      summary: final.summary,
      steps: final.steps
    };
  }

  /**
   * Resumes graph execution following explicit human approval.
   */
  async approveAction(token) {
    if (!this.pendingApproval) {
      throw new Error('No pending action requiring approval.');
    }

    const approvalToken = token || this.pendingApproval.token;
    const verify = verifyApproval({
      token: approvalToken,
      threadId: this.activeThreadId,
      currentAction: this.pendingApproval.action,
      currentPageUrl: this.activeTab?.url
    });

    if (!verify.valid) {
      throw new Error(`Approval validation failed: ${verify.reason}`);
    }

    consumeApproval(approvalToken);
    this.events.emit(AGENT_EVENT_TYPES.APPROVAL_GRANTED, { token: approvalToken });

    if (!this.app || !this.graphConfig) {
      throw new Error('Graph execution context unavailable to resume.');
    }

    const resumeState = {
      ...this.lastState,
      status: 'POLICY_ALLOWED',
      approvalStatus: 'APPROVED',
      approvalToken
    };

    this.pendingApproval = null;
    this.events.emitStateChange('ACTING', `Executing approved action…`);

    try {
      const result = await this.app.invoke(resumeState, this.graphConfig);
      return await this._handleResult(result, this.activeThreadId);
    } catch (err) {
      await this._clearHighlights();
      const envelope = formatError(err);
      const errInfo = envelope.error || envelope;
      const exactMsg = (errInfo.message && !errInfo.message.includes('Our team has been notified'))
        ? errInfo.message
        : (err?.message || String(err));
      const code = errInfo.code || err?.code || 'EXECUTION_ERROR';
      const details = errInfo.details || err?.details || null;

      this.events.emit(AGENT_EVENT_TYPES.TOOL_ERROR, { error: exactMsg, code, details });
      return {
        success: false,
        summary: `Execution error [${code}]: ${exactMsg}`,
        error: { code, message: exactMsg, details },
        steps: 1
      };
    }
  }

  /**
   * Explicitly rejects pending action.
   */
  async rejectAction(reason = 'Action rejected by user.') {
    if (!this.pendingApproval) return;
    this.events.emit(AGENT_EVENT_TYPES.APPROVAL_REJECTED, { reason });
    this.pendingApproval = null;

    if (this.activeThreadId) {
      await this.threadStore.updateThread(this.activeThreadId, {
        status: 'TERMINATED',
        summary: reason
      });
    }

    await this._clearHighlights();
    return { success: false, summary: reason, steps: this.lastState?.stepCount || 1 };
  }
}

export { CANONICAL_SERVICES } from './shared/constants.js';
export { detectTargetService } from './browser/page-context.js';
export class LangGraphAgent extends PratyakshaAgentRunner {}

/**
 * Diagnostic helper that converts low-level API provider and network failures
 * into clear, actionable human explanations.
 */
export function diagnoseExecutionError(err, rawMsg = '', rawCode = 'EXECUTION_ERROR') {
  const combined = `${rawMsg || ''} ${err?.message || ''} ${JSON.stringify(err?.error || '')} ${JSON.stringify(err?.details || '')} ${err?.cause?.message || ''} ${err?.code || ''}`.toLowerCase();

  // 1. OpenRouter 402 Payment Required / Credit Allowance
  if (
    err?.status === 402 ||
    err?.statusCode === 402 ||
    rawCode === 402 ||
    rawCode === 'PAYMENT_REQUIRED' ||
    combined.includes('402') ||
    combined.includes('requires more credits') ||
    combined.includes('fewer max_tokens') ||
    combined.includes('payment required')
  ) {
    return {
      code: 'PAYMENT_REQUIRED',
      message: `OpenRouter error (402 Payment Required): Insufficient credits or token allowance for this request. (Hint: OpenRouter requires an active balance or fewer max_tokens. You can adjust your key limit at openrouter.ai/settings/keys, select a free model such as deepseek/deepseek-chat:free, or switch to Google Gemini in Settings). Diagnostic: ${rawMsg}`
    };
  }

  // 2. Network Disconnects / Offline / Network Changed
  if (
    combined.includes('err_internet_disconnected') ||
    combined.includes('err_network_changed') ||
    combined.includes('internet_disconnected') ||
    combined.includes('network_changed') ||
    (err?.name === 'TypeError' && combined.includes('fetch failed')) ||
    combined.includes('failed to fetch')
  ) {
    return {
      code: 'NETWORK_DISCONNECTED',
      message: `Network error (net::ERR_INTERNET_DISCONNECTED / net::ERR_NETWORK_CHANGED): The network connection to the AI model was interrupted or changed. Please check your internet connection and try again. Diagnostic: ${rawMsg}`
    };
  }

  // 3. Unauthorized / Invalid API Key (401)
  if (
    err?.status === 401 ||
    err?.statusCode === 401 ||
    combined.includes('invalid api key') ||
    combined.includes('unauthorized') ||
    combined.includes('user not found')
  ) {
    return {
      code: 'UNAUTHORIZED',
      message: `Authentication error (401 Unauthorized): Invalid or expired API key. Configure a valid key in Settings (⚙). Diagnostic: ${rawMsg}`
    };
  }

  // 4. Rate Limits & Capacity Exhaustion (429 / 3505 / RATE_LIMIT_EXCEEDED / backend_out_of_capacity)
  if (
    err?.status === 429 ||
    err?.statusCode === 429 ||
    err?.raw_status_code === 429 ||
    rawCode === 429 ||
    rawCode === 'RATE_LIMIT_EXCEEDED' ||
    combined.includes('429') ||
    combined.includes('backend_out_of_capacity') ||
    combined.includes('rate limit') ||
    combined.includes('rate_limited') ||
    combined.includes('not enough capacity') ||
    combined.includes('3505')
  ) {
    return {
      code: 'RATE_LIMIT_EXCEEDED',
      message: `AI Provider Overload (429 Capacity / Rate Limit): The model provider is temporarily out of capacity or rate-limited. (Hint: Switch to Google Gemini or select 'open-mistral-nemo' / 'codestral-latest' in Settings (⚙) to continue immediately). Diagnostic: ${rawMsg}`
    };
  }

  return {
    code: rawCode || 'EXECUTION_ERROR',
    message: rawMsg
  };
}
