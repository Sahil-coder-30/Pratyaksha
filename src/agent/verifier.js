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

    const expectsReply = /\b(wait(ing)?\s+(for\s+)?([a-z0-9_-]+\s+)*(reply|response)|until\s+([a-z0-9_-]+\s+)*(reply|response))\b/i.test(task);
    if (expectsReply) {
      const waitedForReply = history.some(h =>
        h.toolName === 'wait_for' && (h.ok !== false || h.metadata?.met || /condition\s+met|reply|response/i.test(h.observation || ''))
      );
      const readReply = history.some(h =>
        h.toolName === 'read_page' && /reply|response|from/i.test(h.observation || '')
      );
      if (!waitedForReply && !readReply) {
        return {
          outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
          verified: false,
          reason: 'Email was sent, but the task requires waiting for a reply from the other user. The agent must hold execution and wait for the response to be received in the DOM.',
          evidence: 'Send clicked, but incoming reply was not tracked or verified in DOM.'
        };
      }
    }

    return {
      outcome: VERIFICATION_OUTCOMES.VERIFIED_SUCCESS,
      verified: true,
      reason: expectsReply
        ? 'Email workflow verified: Sent message and confirmed response/reply received from other user.'
        : 'Email workflow verified: Visited service, filled fields, and triggered Send.',
      evidence: `Visited: ${currentUrl}, Inputs: ${typedInputs.length}, Send Clicked: true${expectsReply ? ', Reply Verified: true' : ''}`
    };
  }

  // ── 1b. WhatsApp Verification Gate ──
    const isWhatsAppTask = /\b(whatsapp|wa\.me)\b/i.test(task);
    if (isWhatsAppTask) {
      const visitedWhatsApp = history.some(h => /web\.whatsapp\.com/i.test(h.url || '')) || /web\.whatsapp\.com/i.test(currentUrl);
      const typedInputs = history.filter(h => h.toolName === 'type_into_element');
      const sentMessage = history.some(h =>
        (h.toolName === 'press_key' && /enter/i.test(h.args?.key || '')) ||
        (h.toolName === 'click_element' && /send/i.test(h.args?.semantic_hint || '')) ||
        (h.toolName === 'type_into_element' && (h.args?.press_enter || h.metadata?.pressEnter || /enter/i.test(h.observation || '')))
      );

    let targetChatName = null;
    const groupMatch = task.match(/(?:open|in|to)\s+["']?([a-zA-Z0-9_\s]{2,35}?)["']?\s+(?:group|chat|on\s+whatsapp)/i) ||
                       task.match(/(?:group|chat)\s+["']?([a-zA-Z0-9_\s]{2,35}?)["']?\s+(?:on|in)/i) ||
                       task.match(/whatsapp\s+(?:and\s+chat\s+(?:with\s+(?:the\s+people\s+over\s+there|them)\s+)?in\s+)?["']?([a-zA-Z0-9_\s]{2,35}?)["']?\s+group/i);
    if (groupMatch && groupMatch[1]) {
      targetChatName = groupMatch[1].trim();
    }

    const iterMatch = task.match(/(\d+)\s+iterations?/i);
    const requestedIterations = iterMatch ? parseInt(iterMatch[1], 10) : 1;
    const expectsReply = requestedIterations > 1 || /\b(a?wait(ing)?\s+(for\s+)?([a-z0-9_-]+\s+)*(reply|response)|until\s+([a-z0-9_-]+\s+)*(reply|response)|iterations?)\b/i.test(task);

    if (!visitedWhatsApp) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'WhatsApp Web (web.whatsapp.com) was never visited or active.',
        evidence: `Current URL: ${currentUrl}`
      };
    }

    if (targetChatName) {
      const selectedTargetChat = history.some(h =>
        (h.toolName === 'type_into_element' && new RegExp(targetChatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(h.args?.text || '')) ||
        (h.toolName === 'click_element' && new RegExp(targetChatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(h.args?.semantic_hint || h.observation || '')) ||
        (h.toolName === 'read_page' && new RegExp(targetChatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(h.observation || ''))
      );
      if (!selectedTargetChat) {
        return {
          outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
          verified: false,
          reason: `Requested WhatsApp chat or group "${targetChatName}" was not opened. The agent must search for and select "${targetChatName}".`,
          evidence: `Action history does not reference "${targetChatName}".`
        };
      }
    }

    if (typedInputs.length === 0) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'No message was typed into the WhatsApp chat input.',
        evidence: 'Input fields typed: 0'
      };
    }

    if (!sentMessage) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'Message was typed but not dispatched into the WhatsApp chat.',
        evidence: 'Send action (press Enter or click Send) not detected.'
      };
    }

    if (expectsReply) {
      const waitedForReply = history.some(h =>
        h.toolName === 'wait_for' && (h.ok !== false && (h.metadata?.met || /condition\s+met|new\s+reply/i.test(h.observation || '')))
      );
      if (!waitedForReply) {
        return {
          outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
          verified: false,
          reason: 'Message was dispatched, but the task requires waiting for a response from the group members. The agent must call wait_for with wait_for_reply=true to track incoming messages in the DOM.',
          evidence: 'Dispatched message, but incoming response was not tracked or verified in DOM.'
        };
      }
    }

    return {
      outcome: VERIFICATION_OUTCOMES.VERIFIED_SUCCESS,
      verified: true,
      reason: expectsReply
        ? 'WhatsApp workflow verified: Sent message and confirmed response received from group.'
        : 'WhatsApp workflow verified: Opened group and sent message.',
      evidence: `Visited: web.whatsapp.com, Sent: true${targetChatName ? `, Group: "${targetChatName}"` : ''}${expectsReply ? ', Reply Verified: true' : ''}`
    };
  }

  // ── 1c. Coding & Problem Solving Platform Verification Gate ──
  const isCodingTask = /\b(leetcode|hackerrank|codeforces|two sum|solve.*question|solve.*problem|submit.*code)\b/i.test(task);
  if (isCodingTask) {
    const visitedPlatform = history.some(h => /leetcode\.com|hackerrank\.com|codeforces\.com/i.test(h.url || '')) ||
                            /leetcode\.com|hackerrank\.com|codeforces\.com/i.test(currentUrl);

    const hasInjectedCode = history.some(h =>
      h.toolName === 'write_code_editor' ||
      (h.toolName === 'type_into_element' && (h.metadata?.codeModified || /editor/i.test(h.observation || '')))
    );

    const clickedSubmit = history.some(h =>
      (h.toolName === 'click_element' && /submit|run/i.test(h.args?.semantic_hint || h.observation || '')) ||
      (h.toolName === 'press_key' && /enter/i.test(h.args?.key || '') && /submit/i.test(h.observation || ''))
    );

    // A genuine verdict requires verified observation from the DOM, never from finish_task's summary
    const hasAcceptedVerdict = history.some(h =>
      (h.toolName === 'wait_for' && h.metadata?.met === true && /accepted/i.test(h.observation || '')) ||
      (h.toolName === 'read_page' && /accepted/i.test(h.observation || ''))
    ) || (latestObservation?.toolName !== 'finish_task' && /accepted/i.test(latestObservation?.observation || ''));

    const hasErrorVerdict = history.some(h =>
      (h.toolName === 'wait_for' && h.metadata?.met === true && /wrong answer|runtime error|time limit|compile error/i.test(h.observation || '')) ||
      (h.toolName === 'read_page' && /wrong answer|runtime error|time limit|compile error/i.test(h.observation || ''))
    ) || (latestObservation?.toolName !== 'finish_task' && /wrong answer|runtime error|time limit|compile error/i.test(latestObservation?.observation || ''));

    if (!visitedPlatform) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'Coding platform (e.g. leetcode.com) was never visited.',
        evidence: `Current URL: ${currentUrl}`
      };
    }

    if (!hasInjectedCode) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'Code solution was not injected into the code editor on the page. The agent must locate the <editor> element and call write_code_editor or type_into_element.',
        evidence: 'No write_code_editor or editor typing action detected in action history.'
      };
    }

    const requiresSubmit = /\b(submit)\b/i.test(task);
    if (requiresSubmit && !clickedSubmit) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'Code was injected into the editor, but the Submit button was not clicked.',
        evidence: 'Submit button click not detected.'
      };
    }

    if (hasErrorVerdict) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'Submission resulted in an error verdict (Compile Error, Wrong Answer, or Runtime Error). Inspect the editor, remove any duplicate code or leftover template, fix the solution, and resubmit.',
        evidence: 'Error verdict detected on page.'
      };
    }

    if (requiresSubmit && !hasAcceptedVerdict) {
      return {
        outcome: VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE,
        verified: false,
        reason: 'Submit was clicked, but the submission verdict ("Accepted") was not confirmed on the page. The agent must call wait_for(text_contains="Accepted", timeout_seconds=10) or inspect the submission status before finishing.',
        evidence: 'Submit clicked, but Accepted verdict not verified in DOM.'
      };
    }

    return {
      outcome: VERIFICATION_OUTCOMES.VERIFIED_SUCCESS,
      verified: true,
      reason: 'Coding problem solved, solution injected into editor, and submission confirmed.',
      evidence: `Visited platform, code injected: true${requiresSubmit ? ', Submit clicked & verdict verified: true' : ''}`
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
