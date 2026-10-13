/**
 * PRATYAKSHA UI Event Streaming & Lifecycle Relays
 * Sovereign Privacy-First Browser Agent
 *
 * Bridges LangGraph graph nodes and tool execution events to the Side Panel UI.
 * Redacts sensitive credentials, masks passwords, and maps graph states
 * to the 3D Orb and chat activity indicators.
 */

import { sanitizeEventPayload } from '../safety/privacy.js';

export const AGENT_EVENT_TYPES = Object.freeze({
  TASK_START: 'TASK_START',
  PLAN_CREATED: 'PLAN_CREATED',
  STATE_CHANGE: 'STATE_CHANGE',
  TOOL_CALL: 'TOOL_CALL',
  OBSERVATION: 'OBSERVATION',
  TOOL_ERROR: 'TOOL_ERROR',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVAL_GRANTED: 'APPROVAL_GRANTED',
  APPROVAL_REJECTED: 'APPROVAL_REJECTED',
  VERIFICATION_START: 'VERIFICATION_START',
  VERIFICATION_COMPLETE: 'VERIFICATION_COMPLETE',
  RECOVERY_START: 'RECOVERY_START',
  THINKING: 'THINKING',
  REASONING_STEP: 'REASONING_STEP',
  THINKING_CHUNK: 'THINKING_CHUNK',
  TASK_COMPLETE: 'TASK_COMPLETE',
  BUDGET_REACHED: 'BUDGET_REACHED',
  CANCELLED: 'CANCELLED'
});

export class AgentEventEmitter {
  constructor(listener = () => {}) {
    this.listener = typeof listener === 'function' ? listener : () => {};
    this.isCancelled = false;
  }

  emit(type, payload = {}) {
    if (this.isCancelled && type !== AGENT_EVENT_TYPES.CANCELLED) return;

    const sanitized = sanitizeEventPayload(payload);
    const event = {
      type,
      timestamp: new Date().toLocaleTimeString(),
      ...sanitized
    };

    try {
      this.listener(event);
    } catch (err) {
      console.warn('[PRATYAKSHA Event Relay] Listener warning:', err.message);
    }
  }

  emitThinking(payload = {}) {
    const data = typeof payload === 'string' ? { text: payload } : payload;
    this.emit(AGENT_EVENT_TYPES.THINKING, data);
  }

  emitStateChange(state, label) {
    this.emit(AGENT_EVENT_TYPES.STATE_CHANGE, { state, label });
  }

  emitTaskComplete(summary, success = true, steps = 1) {
    this.emit(AGENT_EVENT_TYPES.TASK_COMPLETE, { summary, success, steps });
  }

  emitCancelled(message = 'Execution cancelled by user.') {
    this.isCancelled = true;
    this.emit(AGENT_EVENT_TYPES.CANCELLED, { message });
  }
}
