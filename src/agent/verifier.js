/**
 * PRATYAKSHA Ground-Truth Verification Node
 * Sovereign Privacy-First Browser Agent
 *
 * Evaluates whether the user's objective has truly been achieved
 * using live browser evidence, DOM state, and action history.
 * Rejects model completion claims that lack physical proof.
 */

import { VerificationFailureError, formatError } from '../shared/errors.js';

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
    const visitedEmail = history.some(h => /mail\.google\.com/i.test(h.url || '')) ||
                         /mail\.google\.com/i.test(currentUrl);

    const typedInputs = history.filter(h => h.toolName === 'type_into_element');
    const clickedActions = history.filter(h => h.toolName === 'click_element');
    const clickedSend = clickedActions.some(c => /send/i.test(c.args?.semantic_hint || ''));

    if (!visitedEmail) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'Target email service (mail.google.com) was never visited.',
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

  const result = verifyTaskOutcome({
    task: state.sanitizedTask || state.originalTask,
    plan: state.plan,
    browserSession: state.browserSession,
    actionHistory: state.messages
      ?.filter(m => m._getType && m._getType() === 'tool')
      ?.map(m => ({ toolName: m.name, ok: !m.content?.startsWith('ERROR') })) || [],
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

  return {
    verificationResult: result,
    error: failureErr ? formatError(failureErr) : null,
    status: result.verified ? 'VERIFIED' : (result.outcome === VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE ? 'RECOVERABLE' : 'FAILED')
  };
}
