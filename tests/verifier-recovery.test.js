/**
 * PRATYAKSHA Test Suite: Ground-Truth Verification & Bounded Recovery
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyTaskOutcome,
  verifierNode,
  VERIFICATION_OUTCOMES
} from '../src/agent/verifier.js';
import {
  decideRecoveryStrategy,
  recoveryNode,
  RECOVERY_DECISIONS,
  MAX_RECOVERY_ATTEMPTS
} from '../src/agent/recovery.js';
import { TOOL_NAMES } from '../src/shared/constants.js';

test('Verification - Email Workflow Anti-Hallucination Gate', () => {
  const task = 'Send an email to manager about project update';

  // 1. Rejected if Gmail never visited
  const resNoVisit = verifyTaskOutcome({
    task,
    browserSession: { url: 'https://example.com' },
    actionHistory: [{ toolName: 'click_element', ok: true }]
  });
  assert.equal(resNoVisit.verified, false);
  assert.equal(resNoVisit.outcome, VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE);
  assert.ok(resNoVisit.reason.includes('never visited'));

  // 2. Rejected if visited but no text typed
  const resNoType = verifyTaskOutcome({
    task,
    browserSession: { url: 'https://mail.google.com/mail/u/0' },
    actionHistory: [
      { toolName: 'open_url', url: 'https://mail.google.com', ok: true }
    ]
  });
  assert.equal(resNoType.verified, false);
  assert.ok(resNoType.reason.includes('No recipient or message content was typed'));

  // 3. Rejected if typed but Send never clicked
  const resNoSend = verifyTaskOutcome({
    task,
    browserSession: { url: 'https://mail.google.com/mail/u/0' },
    actionHistory: [
      { toolName: 'open_url', url: 'https://mail.google.com', ok: true },
      { toolName: 'type_into_element', ok: true, args: { text: 'update' } }
    ]
  });
  assert.equal(resNoSend.verified, false);
  assert.ok(resNoSend.reason.includes('Send button was not clicked'));

  // 4. Verified if visited, typed, and Send clicked
  const resSuccess = verifyTaskOutcome({
    task,
    browserSession: { url: 'https://mail.google.com/mail/u/0' },
    actionHistory: [
      { toolName: 'open_url', url: 'https://mail.google.com', ok: true },
      { toolName: 'type_into_element', ok: true, args: { text: 'update' } },
      { toolName: 'click_element', ok: true, args: { semantic_hint: 'Send' } }
    ]
  });
  assert.equal(resSuccess.verified, true);
  assert.equal(resSuccess.outcome, VERIFICATION_OUTCOMES.VERIFIED_SUCCESS);
});

test('Verification - Search Query Verification', () => {
  const task = 'Search who won the 2023 Cricket World Cup';

  const res = verifyTaskOutcome({
    task,
    browserSession: { url: 'https://www.google.com/search?q=cricket' },
    actionHistory: [{ toolName: 'search_web', ok: true }],
    latestObservation: { observation: 'Australia won the 2023 Cricket World Cup' }
  });

  assert.equal(res.verified, true);
  assert.equal(res.outcome, VERIFICATION_OUTCOMES.VERIFIED_SUCCESS);
});

test('Recovery - Decision Strategy Matrix', () => {
  // Budget exhausted
  const blocked = decideRecoveryStrategy({ consecutiveFailures: 3 });
  assert.equal(blocked.decision, RECOVERY_DECISIONS.TERMINATE_BLOCKED);

  // Domain drift -> Backtrack
  const drift = decideRecoveryStrategy({ isDomainDrift: true, consecutiveFailures: 1 });
  assert.equal(drift.decision, RECOVERY_DECISIONS.BACKTRACK_HISTORY);

  // Failing element ID -> Blacklist and pivot
  const pivot = decideRecoveryStrategy({
    consecutiveFailures: 1,
    lastAction: { toolName: 'click_element', args: { target_id: 17 } }
  });
  assert.equal(pivot.decision, RECOVERY_DECISIONS.BLACKLIST_AND_PIVOT);
  assert.equal(pivot.blacklistedId, 17);

  // 2 consecutive failures -> Replan
  const replan = decideRecoveryStrategy({ consecutiveFailures: 2 });
  assert.equal(replan.decision, RECOVERY_DECISIONS.REPLAN);
});

test('Recovery Node - Enforces Bounded Termination', async () => {
  const stateAtLimit = {
    recoveryCount: 3,
    latestObservation: { ok: false, error: new Error('Cannot find selector') },
    blacklistedTargets: []
  };

  const update = await recoveryNode(stateAtLimit);
  assert.equal(update.status, 'BLOCKED');
  assert.equal(update.error.code, 'MAX_RECOVERY_EXCEEDED');
  assert.equal(update.recoveryCount, 4);
});
