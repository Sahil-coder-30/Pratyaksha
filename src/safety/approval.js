/**
 * PRATYAKSHA Human-in-the-Loop Approval Manager
 * Sovereign Privacy-First Browser Agent
 *
 * Binds user approvals to exact pending actions, fingerprints targets,
 * enforces thread isolation, and prevents replay attacks.
 */

import { PratyakshaError } from '../shared/errors.js';

// In-memory registry of active / consumed approvals
const _activeApprovals = new Map();
const _consumedTokens = new Set();

/**
 * Computes a deterministic action fingerprint.
 */
export function computeActionFingerprint(action = {}, pageUrl = '') {
  const norm = {
    toolName: action.toolName,
    args: action.args || {},
    pageUrl: (pageUrl || '').split('?')[0] // Ignore query params that mutate dynamically
  };
  return JSON.stringify(norm);
}

/**
 * Creates an approval request bound to an action and thread.
 */
export function createApprovalRequest({ threadId, action, reason, pageContext = {} }) {
  if (!threadId) throw new Error('threadId is required to create approval request');
  if (!action?.toolName) throw new Error('action is required to create approval request');

  const token = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const fingerprint = computeActionFingerprint(action, pageContext.url);

  const request = {
    token,
    threadId,
    action: {
      toolName: action.toolName,
      args: { ...action.args }
    },
    reason: reason || 'Sensitive operation requires user confirmation',
    fingerprint,
    page: {
      url: pageContext.url || '',
      title: pageContext.title || ''
    },
    status: 'PENDING',
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes validity
  };

  _activeApprovals.set(token, request);
  return request;
}

/**
 * Validates an approval token against the current pending action and thread.
 */
export function verifyApproval({ token, threadId, currentAction, currentPageUrl }) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Missing approval token' };
  }

  if (_consumedTokens.has(token)) {
    return { valid: false, reason: 'Approval token has already been consumed (replay prevention)' };
  }

  const req = _activeApprovals.get(token);
  if (!req) {
    return { valid: false, reason: 'Approval token not found or invalid' };
  }

  if (Date.now() > req.expiresAt) {
    _activeApprovals.delete(token);
    return { valid: false, reason: 'Approval token has expired' };
  }

  if (req.threadId !== threadId) {
    return { valid: false, reason: 'Approval thread mismatch' };
  }

  if (currentAction) {
    const currentFp = computeActionFingerprint(currentAction, currentPageUrl);
    if (currentFp !== req.fingerprint) {
      return {
        valid: false,
        reason: 'Action parameters or page target changed since approval was granted'
      };
    }
  }

  return { valid: true, request: req };
}

/**
 * Consumes an approval token so it cannot be re-used.
 */
export function consumeApproval(token) {
  if (_activeApprovals.has(token)) {
    _activeApprovals.delete(token);
  }
  _consumedTokens.add(token);
}

/**
 * Clears active approvals for a thread.
 */
export function clearApprovalsForThread(threadId) {
  for (const [token, req] of _activeApprovals.entries()) {
    if (req.threadId === threadId) {
      _activeApprovals.delete(token);
    }
  }
}
