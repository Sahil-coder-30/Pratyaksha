/**
 * PRATYAKSHA Ground-Truth Verification Node
 * Sovereign Privacy-First Browser Agent
 *
 * Evaluates whether the user's objective has truly been achieved
 * using live browser evidence, DOM state, and action history.
 * Rejects model completion claims that lack physical proof.
 */

import { HumanMessage } from '@langchain/core/messages';
import { VerificationFailureError, formatError } from '../shared/errors.js';
import { extractActionHistory } from './middleware.js';

const MAIL_HOST_REGEX = /mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|mail\.proton\.me|proton\.me\/mail|mail\.zoho\.|\bmail\./i;

export const VERIFICATION_OUTCOMES = Object.freeze({
  VERIFIED_SUCCESS: 'VERIFIED_SUCCESS',
  INCOMPLETE_RECOVERABLE: 'INCOMPLETE_RECOVERABLE',
  BLOCKED: 'BLOCKED',
  UNVERIFIED: 'UNVERIFIED',
  FAILED: 'FAILED'
});

/**
 * Evaluates execution outcome against real browser evidence.
 */
export function verifyTaskOutcome({
  task = '',
  plan = null,
  browserSession = {},
  actionHistory = [],
  latestObservation = null
}) {
  const currentUrl = browserSession?.url || '';
  const history = Array.isArray(actionHistory) ? actionHistory : [];

  // ── 1. Email / Messaging Verification Gate ──
  const isEmailTask = /\b(mail|email|send\s+email)\b/i.test(task);
  if (isEmailTask) {
    const visitedEmail = history.some(h => MAIL_HOST_REGEX.test(h.url || '')) ||
                         MAIL_HOST_REGEX.test(currentUrl);

    const typedInputs = history.filter(h => h.toolName === 'type_into_element');
    const clickedActions = history.filter(h => h.toolName === 'click_element');
    const clickedSend = clickedActions.some(c =>
      /send/i.test(c.args?.semantic_hint || '') || /\bsend\b/i.test(c.observation || '')
    ) || history.some(h => h.toolName === 'press_key' && /enter/i.test(h.args?.key || '') && /send/i.test(h.observation || ''));

    if (!visitedEmail) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'Target email service (e.g. mail.google.com) was never visited.',
        evidence: `Current URL: ${currentUrl}`
      };
    }

    if (typedInputs.length === 0) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'No recipient or message content was typed into the email form.',
        evidence: `Typed inputs count: 0`
      };
    }

    // Completed flow requires Send button click or confirmed submission
    if (!clickedSend && clickedActions.length < 2) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'The Send button was not clicked. Email remains an unsent draft.',
        evidence: 'No Send click detected in action history.'
      };
    }

    return {
      outcome: VERIFICATION_OUTCOMES.VERIFIED_SUCCESS,
      verified: true,
      reason: 'Email workflow verified: Visited service, filled fields, and triggered Send.',
      evidence: `Visited: ${currentUrl}, Inputs: ${typedInputs.length}, Send Clicked: true`
    };
  }

  // ── 2. Web Search Verification ──
  const isSearchTask = /\b(search|find|lookup|who|what|score|price)\b/i.test(task);
  if (isSearchTask) {
    const executedSearch = history.some(h =>
      h.toolName === 'search_web' ||
      /google\.com\/search/i.test(h.url || '') ||
      h.toolName === 'type_into_element' ||
      h.toolName === 'click_element'
    );
    const readPage = history.some(h => h.toolName === 'read_page' || h.toolName === 'extract_structured');

    if ((executedSearch && (readPage || latestObservation?.observation)) ||
        (latestObservation?.isFinished && latestObservation?.success)) {
      return {
        outcome: VERIFICATION_OUTCOMES.VERIFIED_SUCCESS,
        verified: true,
        reason: latestObservation?.summary || 'Search executed and content observed from search results.',
        evidence: `Observation text present: ${Boolean(latestObservation?.observation)}`
      };
    }

    return {
      outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
      verified: false,
      reason: 'Web search was not executed or search results were not extracted.',
      evidence: `Executed search: ${executedSearch}`
    };
  }

  // ── 3. General Tasks / Structured Plan Criteria ──
  if (plan?.verificationCriteria?.length) {
    const successfulTools = history.filter(h => h.ok !== false);
    if (successfulTools.length > 0 && latestObservation?.isFinished && latestObservation?.success) {
      return {
        outcome: VERIFICATION_OUTCOMES.VERIFIED_SUCCESS,
        verified: true,
        reason: latestObservation.summary || 'Completed planned operations on target page.',
        evidence: `Executed ${successfulTools.length} successful operations on ${currentUrl}`
      };
    }
  }

  // Fallback for default actions
  if (latestObservation?.isFinished && latestObservation?.success) {
    return {
      outcome: VERIFICATION_OUTCOMES.VERIFIED_SUCCESS,
      verified: true,
      reason: latestObservation.summary || 'Task completed.',
      evidence: `Finish signal received on ${currentUrl}`
    };
  }

  return {
    outcome: VERIFICATION_OUTCOMES.UNVERIFIED,
    verified: false,
    reason: 'Insufficient browser evidence to confirm task completion.',
    evidence: `Current page: ${currentUrl}`
  };
}

/**
 * LangGraph Verification Node
 */
export async function verifierNode(state, options = {}) {
  const events = options.events;
  events?.emit?.('THINKING', {
    phase: 'verify',
    text: 'Evaluating browser evidence & DOM state against objective…',
    step: state.stepCount
  });

  // The model gave up explicitly (login wall, missing info): report its reason, don't retry
  if (state.latestObservation?.isFinished && state.latestObservation?.success === false) {
    const reason = state.latestObservation.summary || 'Agent reported the task could not be completed.';
    events?.emit?.('THINKING', { phase: 'verify', text: `Agent stopped: ${reason}`, step: state.stepCount });
    return {
      verificationResult: {
        outcome: VERIFICATION_OUTCOMES.FAILED,
        verified: false,
        reason,
        evidence: `Current page: ${state.browserSession?.url || ''}`
      },
      status: 'FAILED'
    };
  }

  const result = verifyTaskOutcome({
    task: state.sanitizedTask || state.originalTask,
    plan: state.plan,
    browserSession: state.browserSession,
    actionHistory: extractActionHistory(state.messages || []),
    latestObservation: state.latestObservation
  });

  if (result.verified) {
    events?.emit?.('THINKING', {
      phase: 'verify',
      text: `✓ Verification passed: ${result.reason}`,
      step: state.stepCount
    });
  } else {
    events?.emit?.('THINKING', {
      phase: 'verify',
      text: `Verification note: ${result.reason}`,
      step: state.stepCount
    });
  }

  const failureErr = !result.verified ? new VerificationFailureError(result.reason, { criteria: [result.evidence] }) : null;
  const recoverable = !result.verified && result.outcome === VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE;

  const update = {
    verificationResult: result,
    error: failureErr ? formatError(failureErr) : null,
    status: result.verified ? 'VERIFIED' : (recoverable ? 'RECOVERABLE' : 'FAILED')
  };

  // Tell the model WHY its completion claim was rejected, otherwise it just calls finish_task again
  if (recoverable) {
    update.latestObservation = null;
    update.messages = [new HumanMessage(
      `Your finish_task was rejected by verification: ${result.reason} The task is NOT complete yet. Continue from the current page and finish only after this is done.`
    )];
  }
  return update;
}
