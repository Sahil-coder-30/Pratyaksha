/**
 * PRATYAKSHA Bounded Recovery & Backtracking Node
 * Sovereign Privacy-First Browser Agent
 *
 * Chooses recovery strategies upon failures:
 * - RETRY_ACTION
 * - BACKTRACK_HISTORY
 * - DISMISS_OVERLAY
 * - BLACKLIST_AND_PIVOT
 * - REPLAN
 * - TERMINATE_BLOCKED
 * Enforces strict failure caps to guarantee bounded termination.
 */

import { executeBrowserTool } from '../browser/browser-tools.js';
import { TOOL_NAMES } from '../shared/constants.js';
import { BudgetExhaustedError, formatError } from '../shared/errors.js';

export const RECOVERY_DECISIONS = Object.freeze({
  RETRY_ACTION: 'RETRY_ACTION',
  BACKTRACK_HISTORY: 'BACKTRACK_HISTORY',
  DISMISS_OVERLAY: 'DISMISS_OVERLAY',
  BLACKLIST_AND_PIVOT: 'BLACKLIST_AND_PIVOT',
  REPLAN: 'REPLAN',
  TERMINATE_BLOCKED: 'TERMINATE_BLOCKED'
});

export const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Selects an appropriate recovery strategy based on error and history.
 */
export function decideRecoveryStrategy({
  consecutiveFailures = 0,
  lastError = null,
  lastAction = null,
  isDomainDrift = false
}) {
  if (consecutiveFailures >= MAX_RECOVERY_ATTEMPTS) {
    return {
      decision: RECOVERY_DECISIONS.TERMINATE_BLOCKED,
      reason: `Exhausted maximum recovery attempts (${MAX_RECOVERY_ATTEMPTS}). Halting execution safely.`
    };
  }

  if (isDomainDrift) {
    return {
      decision: RECOVERY_DECISIONS.BACKTRACK_HISTORY,
      reason: 'Navigation drifted away from intended target website. Backtracking browser history.'
    };
  }

  // If last action targeted an element that failed repeatedly -> blacklist and pivot
  if (lastAction?.args?.target_id) {
    return {
      decision: RECOVERY_DECISIONS.BLACKLIST_AND_PIVOT,
      blacklistedId: Number(lastAction.args.target_id),
      reason: `Target element [#${lastAction.args.target_id}] failed. Blacklisting target and re-observing DOM.`
    };
  }

  // After 2 consecutive failures, request a fresh plan
  if (consecutiveFailures >= 2) {
    return {
      decision: RECOVERY_DECISIONS.REPLAN,
      reason: 'Multiple consecutive tool failures occurred. Re-evaluating high-level plan.'
    };
  }

  return {
    decision: RECOVERY_DECISIONS.RETRY_ACTION,
    reason: lastError?.message || 'Retrying with alternative DOM selector or wait.'
  };
}

/**
 * LangGraph Recovery Node
 */
export async function recoveryNode(state, options = {}) {
  const currentRecovery = state.recoveryCount || 0;
  const newRecoveryCount = currentRecovery + 1;
  const chromeApi = options.chromeApi;

  // Check if budget exceeded
  if (newRecoveryCount > MAX_RECOVERY_ATTEMPTS) {
    const budgetErr = new BudgetExhaustedError(`Recovery budget of ${MAX_RECOVERY_ATTEMPTS} attempts exhausted.`, {
      code: 'MAX_RECOVERY_EXCEEDED',
      details: { limit: MAX_RECOVERY_ATTEMPTS, count: newRecoveryCount }
    });
    const envelope = formatError(budgetErr);
    const errInfo = envelope.error || envelope;
    return {
      recoveryCount: newRecoveryCount,
      status: 'BLOCKED',
      error: {
        code: errInfo.code || 'MAX_RECOVERY_EXCEEDED',
        message: errInfo.message,
        details: errInfo.details
      }
    };
  }

  const lastObs = state.latestObservation;
  const lastAction = lastObs ? { toolName: lastObs.toolName, args: lastObs.metadata || {} } : null;

  const strategy = decideRecoveryStrategy({
    consecutiveFailures: newRecoveryCount,
    lastError: state.error || (lastObs?.ok === false ? lastObs.error : null),
    lastAction
  });

  const blacklisted = [...(state.blacklistedTargets || [])];
  if (strategy.blacklistedId && !blacklisted.includes(strategy.blacklistedId)) {
    blacklisted.push(strategy.blacklistedId);
  }

  // Execute mechanical recovery operations if necessary
  if (strategy.decision === RECOVERY_DECISIONS.BACKTRACK_HISTORY && state.browserSession?.tabId) {
    try {
      await executeBrowserTool(TOOL_NAMES.GO_BACK, {}, { id: state.browserSession.tabId }, { chromeApi });
    } catch (err) {
      const envelope = formatError(err);
      console.warn('[PRATYAKSHA Recovery] Backtrack error:', envelope.error?.message || err.message);
    }
  }

  return {
    recoveryCount: newRecoveryCount,
    blacklistedTargets: blacklisted,
    status: strategy.decision === RECOVERY_DECISIONS.REPLAN ? 'REPLAN_REQUIRED' : 'RECOVERED'
  };
}
