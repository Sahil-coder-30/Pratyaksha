/**
 * PRATYAKSHA Standardized Domain Errors with FaultKit
 * Sovereign Privacy-First Browser Agent
 *
 * Provides OpenAPI-compliant, structured error handling for the entire agent pipeline.
 */

import {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
  ServiceUnavailableError,
  ModelRateLimitError,
  LlmProviderDownError,
  formatError as faultkitFormatError,
  toErrorResponse as faultkitToErrorResponse,
  coerceToAppError
} from 'faultkit';

/**
 * Normalizes and formats errors into OpenAPI-compliant ErrorResponse envelopes.
 * PRATYAKSHA explicitly never masks errors behind generic production text such as
 * "An unexpected error occurred. Our team has been notified."
 * The exact diagnostic error message and details are always preserved.
 */
export function toErrorResponse(err, options = {}) {
  const appError = coerceToAppError(err, options?.errorCoercer);

  const customOpts = {
    isProduction: false,
    genericServerErrorMessage: appError.message || err?.message || (typeof err === 'string' ? err : 'Internal error'),
    ...options
  };

  const response = faultkitToErrorResponse(appError, customOpts);

  // Hard guarantee: if any FaultKit default generic masked message is returned, replace with exact error
  if (
    response?.error?.message === 'An unexpected error occurred. Our team has been notified.' ||
    response?.error?.message === 'An unexpected error occurred.' ||
    response?.error?.message === 'An unexpected internal server error occurred.'
  ) {
    const rawMsg = err?.message || (typeof err === 'string' ? err : null);
    if (rawMsg) {
      response.error.message = rawMsg;
    }
  }

  // Preserve details if not populated
  if (!response?.error?.details && (err?.details || err?.cause || err?.response)) {
    response.error.details = err.details || err.cause || err.response;
  }

  return response;
}

export const formatError = toErrorResponse;

// Register transparent unmasked formatter on AppError
if (typeof AppError._registerFormatter === 'function') {
  AppError._registerFormatter(toErrorResponse);
}

// Re-export core FaultKit classes & helpers
export {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
  ServiceUnavailableError,
  ModelRateLimitError,
  LlmProviderDownError,
  coerceToAppError
};

/**
 * Base PRATYAKSHA Domain Error extending FaultKit's AppError.
 */
export class PratyakshaError extends AppError {
  constructor(message, options = {}) {
    const statusCode = options.statusCode || 400;
    const errorCode = options.code || 'PRATYAKSHA_ERROR';
    const details = options.details || null;
    const isOperational = options.recoverable !== undefined ? options.recoverable : true;

    super(message, statusCode, errorCode, details, isOperational);

    this.name = this.constructor.name;
    this.code = errorCode; // Backwards compatibility for code checks
    this.recoverable = isOperational;
    this.details = details || {};
  }
}

export class ToolExecutionError extends PratyakshaError {
  constructor(message, options = {}) {
    super(message, { statusCode: 422, code: 'TOOL_EXECUTION_ERROR', recoverable: true, ...options });
    this.toolName = options.toolName || 'unknown';
  }
}

export class ChannelClosedError extends PratyakshaError {
  constructor(message = 'Message channel closed before a response was received', options = {}) {
    super(message, { statusCode: 503, code: 'CHANNEL_CLOSED', recoverable: true, ...options });
  }
}

export class NavigationTimeoutError extends PratyakshaError {
  constructor(message = 'Navigation timed out', options = {}) {
    super(message, { statusCode: 504, code: 'NAVIGATION_TIMEOUT', recoverable: true, ...options });
  }
}

export class ContentScriptError extends PratyakshaError {
  constructor(message = 'Failed to communicate with content script', options = {}) {
    super(message, { statusCode: 503, code: 'CONTENT_SCRIPT_ERROR', recoverable: true, ...options });
  }
}

export class PolicyViolationError extends PratyakshaError {
  constructor(message = 'Action rejected by safety policy', options = {}) {
    super(message, { statusCode: 403, code: 'POLICY_VIOLATION', recoverable: false, ...options });
    this.policy = options.policy || 'ACTION_POLICY';
  }
}

export class ApprovalRequiredError extends PratyakshaError {
  constructor(message = 'User approval required for sensitive action', options = {}) {
    super(message, { statusCode: 403, code: 'APPROVAL_REQUIRED', recoverable: true, ...options });
    this.approvalId = options.approvalId;
    this.action = options.action;
  }
}

export class ApprovalRejectedError extends PratyakshaError {
  constructor(message = 'User rejected proposed action', options = {}) {
    super(message, { statusCode: 403, code: 'APPROVAL_REJECTED', recoverable: false, ...options });
  }
}

export class BudgetExhaustedError extends PratyakshaError {
  constructor(message = 'Execution step budget exhausted', options = {}) {
    super(message, { statusCode: 429, code: 'BUDGET_EXHAUSTED', recoverable: false, ...options });
    this.budgetType = options.budgetType || 'STEPS';
  }
}

export class VerificationFailureError extends PratyakshaError {
  constructor(message = 'Task verification failed against live browser state', options = {}) {
    super(message, { statusCode: 422, code: 'VERIFICATION_FAILURE', recoverable: true, ...options });
    this.criteria = options.criteria || [];
  }
}
