/**
 * PRATYAKSHA Test Suite: Privacy Shield, Action Policy & Safety Limits
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anonymizeInputTask,
  rehydrateLocalValue,
  sanitizeObservationForModel,
  sanitizeEventPayload,
  cleanStateForCheckpoint,
  PIIVault
} from '../src/safety/privacy.js';
import { validateNavigationUrl } from '../src/safety/url-policy.js';
import { classifyAction } from '../src/safety/action-policy.js';
import {
  createApprovalRequest,
  verifyApproval,
  consumeApproval
} from '../src/safety/approval.js';
import { ExecutionBudgetTracker } from '../src/safety/execution-limits.js';
import { TOOL_NAMES, RISK_TIERS } from '../src/shared/constants.js';

test('Privacy - Anonymization, Scrubbing & Rehydration', () => {
  const vault = new PIIVault();

  // Test PAN and Phone redaction (4th char P = Person)
  const input = 'My PAN is ABCPE1234F and my phone is 9876543210';
  const { sanitizedText, detected } = anonymizeInputTask(input, vault);

  assert.equal(detected.length, 2);
  assert.ok(!sanitizedText.includes('ABCPE1234F'));
  assert.ok(!sanitizedText.includes('9876543210'));

  // Test local rehydration
  const restored = rehydrateLocalValue(sanitizedText, vault);
  assert.equal(restored, input);

  // Test observation scrubbing
  const rawDom = '<div>Your token is sk-1234567890abcdef1234567890abcdef and password is <input type="password" value="secret123"></div>';
  const scrubbedDom = sanitizeObservationForModel(rawDom, vault);
  assert.ok(!scrubbedDom.includes('secret123'));
  assert.ok(!scrubbedDom.includes('sk-1234567890abcdef1234567890abcdef'));
  assert.ok(scrubbedDom.includes('••••••••'));

  // Test event payload sanitization
  const event = sanitizeEventPayload({
    apiKey: 'secret-key-123',
    toolName: 'type_into_element',
    args: { semantic_hint: 'password input', text: 'mypassword' }
  });
  assert.equal(event.apiKey, '[REDACTED_API_KEY]');
  assert.equal(event.args.text, '••••••••');

  // Test checkpoint cleaning
  const checkpoint = cleanStateForCheckpoint({
    task: 'do task',
    apiKey: 'secret-llm-key',
    geminiApiKey: 'secret-gemini-key'
  });
  assert.equal(checkpoint.apiKey, undefined);
  assert.equal(checkpoint.geminiApiKey, undefined);
  assert.equal(checkpoint.task, 'do task');
});

test('URL Policy - Protocol Boundaries & Validation', () => {
  assert.equal(validateNavigationUrl('https://example.com/checkout').allowed, true);
  assert.equal(validateNavigationUrl('http://localhost:8080').allowed, true);
  assert.equal(validateNavigationUrl('chrome://settings').allowed, false);
  assert.equal(validateNavigationUrl('chrome-extension://xyz/options.html').allowed, false);
  assert.equal(validateNavigationUrl('javascript:void(0)').allowed, false);
  assert.equal(validateNavigationUrl('').allowed, false);
});

test('Action Policy - Risk Classification & Approval Triggering', () => {
  // execute_js -> RESTRICTED + approval required
  const jsClass = classifyAction(TOOL_NAMES.EXECUTE_JS, { code: 'document.cookie' });
  assert.equal(jsClass.riskTier, RISK_TIERS.RESTRICTED);
  assert.equal(jsClass.requiresApproval, true);

  // Click on "Send Email" -> IRREVERSIBLE + approval required
  const sendClass = classifyAction(TOOL_NAMES.CLICK_ELEMENT, { semantic_hint: 'Send Email Now' });
  assert.equal(sendClass.riskTier, RISK_TIERS.IRREVERSIBLE);
  assert.equal(sendClass.requiresApproval, true);

  // Normal link click -> REVERSIBLE + no approval
  const normalClick = classifyAction(TOOL_NAMES.CLICK_ELEMENT, { semantic_hint: 'Next Page' });
  assert.equal(normalClick.riskTier, RISK_TIERS.REVERSIBLE);
  assert.equal(normalClick.requiresApproval, false);

  // Read page -> READ_ONLY + no approval
  const readClass = classifyAction(TOOL_NAMES.READ_PAGE, {});
  assert.equal(readClass.riskTier, RISK_TIERS.READ_ONLY);
  assert.equal(readClass.requiresApproval, false);

  // Type password -> SENSITIVE + approval required
  const passClass = classifyAction(TOOL_NAMES.TYPE_INTO_ELEMENT, { semantic_hint: 'Account Password' });
  assert.equal(passClass.riskTier, RISK_TIERS.SENSITIVE);
  assert.equal(passClass.requiresApproval, true);
});

test('Approval System - Binding, Verification & Replay Prevention', () => {
  const threadId = 'thread_001';
  const action = { toolName: TOOL_NAMES.CLICK_ELEMENT, args: { semantic_hint: 'Send Email' } };
  const pageContext = { url: 'https://mail.google.com/mail/u/0' };

  // Create approval
  const req = createApprovalRequest({ threadId, action, reason: 'Confirm sending email', pageContext });
  assert.ok(req.token);
  assert.equal(req.threadId, threadId);

  // Verify valid approval
  const check1 = verifyApproval({
    token: req.token,
    threadId,
    currentAction: action,
    currentPageUrl: pageContext.url
  });
  assert.equal(check1.valid, true);

  // Thread mismatch fails
  const checkThreadMismatch = verifyApproval({
    token: req.token,
    threadId: 'different_thread',
    currentAction: action,
    currentPageUrl: pageContext.url
  });
  assert.equal(checkThreadMismatch.valid, false);

  // Action tampering fails
  const tamperedAction = { toolName: TOOL_NAMES.CLICK_ELEMENT, args: { semantic_hint: 'Delete All' } };
  const checkTampered = verifyApproval({
    token: req.token,
    threadId,
    currentAction: tamperedAction,
    currentPageUrl: pageContext.url
  });
  assert.equal(checkTampered.valid, false);

  // Consume token and verify replay prevention
  consumeApproval(req.token);
  const checkReplay = verifyApproval({
    token: req.token,
    threadId,
    currentAction: action,
    currentPageUrl: pageContext.url
  });
  assert.equal(checkReplay.valid, false);
  assert.ok(checkReplay.reason.includes('replay prevention'));
});

test('Execution Limits - Step & Recovery Cap Enforcement', () => {
  const tracker = new ExecutionBudgetTracker({ maxSteps: 3, maxRecoveryAttempts: 2 });

  assert.equal(tracker.incrementStep(), 1);
  assert.equal(tracker.incrementStep(), 2);
  assert.equal(tracker.incrementStep(), 3);

  // Exceeding step limit throws
  assert.throws(() => {
    tracker.incrementStep();
  }, { code: 'BUDGET_EXHAUSTED' });

  // Exceeding recovery limit throws
  const recoveryTracker = new ExecutionBudgetTracker({ maxRecoveryAttempts: 2 });
  recoveryTracker.incrementRecovery();
  recoveryTracker.incrementRecovery();
  assert.throws(() => {
    recoveryTracker.incrementRecovery();
  }, { code: 'BUDGET_EXHAUSTED' });
});
