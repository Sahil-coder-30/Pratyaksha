/**
 * PRATYAKSHA Execution Budget & Limits Policy
 * Sovereign Privacy-First Browser Agent
 *
 * Tracks and enforces distinct boundaries:
 * - Model call count limit
 * - Browser tool invocation limit
 * - Recovery attempt limit
 * - Wall-clock duration limit
 */

import { BudgetExhaustedError } from '../shared/errors.js';

export class ExecutionBudgetTracker {
  constructor(options = {}) {
    this.maxSteps = options.maxSteps || 100;
    this.maxToolCalls = options.maxToolCalls || 200;
    this.maxRecoveryAttempts = options.maxRecoveryAttempts || 3;
    this.maxDurationMs = options.maxDurationMs || 15 * 60 * 1000; // 15 mins for long lifecycle

    this.stepCount = 0;
    this.toolCallCount = 0;
    this.recoveryCount = 0;
    this.startTime = Date.now();
  }

  incrementStep() {
    this.stepCount++;
    this.checkLimits();
    return this.stepCount;
  }

  incrementToolCall() {
    this.toolCallCount++;
    if (this.toolCallCount > this.maxToolCalls) {
      throw new BudgetExhaustedError(
        `Tool call limit reached (${this.maxToolCalls}). Terminating execution safely.`,
        { budgetType: 'TOOL_CALLS' }
      );
    }
    return this.toolCallCount;
  }

  incrementRecovery() {
    this.recoveryCount++;
    if (this.recoveryCount > this.maxRecoveryAttempts) {
      throw new BudgetExhaustedError(
        `Maximum recovery attempts reached (${this.maxRecoveryAttempts}). Agent cannot backtrack further.`,
        { budgetType: 'RECOVERY_ATTEMPTS' }
      );
    }
    return this.recoveryCount;
  }

  checkLimits() {
    if (this.stepCount > this.maxSteps) {
      throw new BudgetExhaustedError(
        `Maximum step limit reached (${this.maxSteps}).`,
        { budgetType: 'STEPS' }
      );
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.maxDurationMs) {
      throw new BudgetExhaustedError(
        `Execution time limit exceeded (${Math.round(elapsed / 1000)}s).`,
        { budgetType: 'DURATION' }
      );
    }
  }

  getSnapshot() {
    return {
      stepCount: this.stepCount,
      toolCallCount: this.toolCallCount,
      recoveryCount: this.recoveryCount,
      elapsedMs: Date.now() - this.startTime,
      maxSteps: this.maxSteps,
      maxRecoveryAttempts: this.maxRecoveryAttempts
    };
  }
}
