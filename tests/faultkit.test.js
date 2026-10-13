/**
 * PRATYAKSHA Test Suite: FaultKit Domain Error Integration
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  PratyakshaError,
  ToolExecutionError,
  PolicyViolationError,
  ApprovalRequiredError,
  ApprovalRejectedError,
  BudgetExhaustedError,
  VerificationFailureError,
  NavigationTimeoutError,
  ChannelClosedError,
  ValidationError,
  NotFoundError,
  formatError,
  toErrorResponse
} from '../src/shared/errors.js';

test('FaultKit - PratyakshaError extends AppError with backwards compatibility', () => {
  const err = new PratyakshaError('Base error occurred', {
    code: 'CUSTOM_TEST_CODE',
    statusCode: 400,
    details: { reason: 'unit test' }
  });

  assert.ok(err instanceof AppError);
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'CUSTOM_TEST_CODE');
  assert.equal(err.errorCode, 'CUSTOM_TEST_CODE');
  assert.equal(err.statusCode, 400);
  assert.equal(err.recoverable, true);
  assert.equal(err.details.reason, 'unit test');
});

test('FaultKit - Concrete Domain Error Status Codes & Taxonomy', () => {
  // Tool Execution Error (422 Unprocessable Entity)
  const toolErr = new ToolExecutionError('Failed to click element', { toolName: 'click_element' });
  assert.equal(toolErr.statusCode, 422);
  assert.equal(toolErr.code, 'TOOL_EXECUTION_ERROR');
  assert.equal(toolErr.toolName, 'click_element');

  // Policy Violation Error (403 Forbidden)
  const policyErr = new PolicyViolationError('Navigation to chrome:// blocked');
  assert.equal(policyErr.statusCode, 403);
  assert.equal(policyErr.code, 'POLICY_VIOLATION');
  assert.equal(policyErr.recoverable, false);

  // Approval Errors (403 Forbidden)
  const appReqErr = new ApprovalRequiredError('Approval needed for payment', { approvalId: 'app_1' });
  assert.equal(appReqErr.statusCode, 403);
  assert.equal(appReqErr.code, 'APPROVAL_REQUIRED');

  const appRejErr = new ApprovalRejectedError('User declined action');
  assert.equal(appRejErr.statusCode, 403);
  assert.equal(appRejErr.code, 'APPROVAL_REJECTED');

  // Budget Exhausted (429 Rate Limit)
  const budgetErr = new BudgetExhaustedError('Max steps reached');
  assert.equal(budgetErr.statusCode, 429);
  assert.equal(budgetErr.code, 'BUDGET_EXHAUSTED');

  // Verification Failure (422 Unprocessable Entity)
  const verifErr = new VerificationFailureError('Missing DOM proof', { criteria: ['selector present'] });
  assert.equal(verifErr.statusCode, 422);
  assert.equal(verifErr.code, 'VERIFICATION_FAILURE');

  // Network & Transport (503 / 504)
  const navErr = new NavigationTimeoutError('Page load timed out');
  assert.equal(navErr.statusCode, 504);

  const chanErr = new ChannelClosedError();
  assert.equal(chanErr.statusCode, 503);
});

test('FaultKit - formatError & toErrorResponse Envelope Verification', () => {
  const err = new ToolExecutionError('Element with target_id 42 not found on page', {
    toolName: 'click_element',
    details: { target_id: 42 }
  });

  const formatted = formatError(err);
  assert.equal(formatted.success, false);
  assert.ok(formatted.error);
  assert.equal(formatted.error.code, 'TOOL_EXECUTION_ERROR');
  assert.equal(formatted.error.message, 'Element with target_id 42 not found on page');
  assert.deepEqual(formatted.error.details, { target_id: 42 });

  const response = toErrorResponse(err);
  assert.equal(response.success, false);
  assert.ok(response.error);
  assert.equal(response.error.code, 'TOOL_EXECUTION_ERROR');
  assert.equal(response.error.message, 'Element with target_id 42 not found on page');
  assert.deepEqual(response.error.details, { target_id: 42 });
});

test('FaultKit - Guarantees Exact Error Message Never Masked by Generic Copy', () => {
  const exactMsg = 'API error occurred: Status 400. Body: {"message":"Expected last role User or Tool"}';
  const nativeErr = new Error(exactMsg);

  const formatted = formatError(nativeErr);
  assert.equal(formatted.success, false);
  assert.ok(formatted.error);
  assert.notEqual(formatted.error.message, 'An unexpected error occurred. Our team has been notified.');
  assert.equal(formatted.error.message, exactMsg);

  const resp = toErrorResponse(nativeErr, { isProduction: true });
  assert.equal(resp.success, false);
  assert.notEqual(resp.error.message, 'An unexpected error occurred. Our team has been notified.');
  assert.equal(resp.error.message, exactMsg);
});

