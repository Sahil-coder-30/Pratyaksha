/**
 * PRATYAKSHA Privacy Shield & Observation Sanitizer
 * Sovereign Privacy-First Browser Agent
 *
 * Implements pre-intake PII tokenization (Aadhaar, PAN, Email, Phone),
 * local execution rehydration, and DOM observation / event scrubbing.
 */

import { PIIVault, globalVault } from '../../pratyaksha-extension/vault/pii-vault.js';

export { PIIVault, globalVault };

// Regexes for observation scrubbing
const SENSITIVE_TOKEN_REGEX = /(?:bearer\s+[a-z0-9_\-\.]{20,}|(?:ghp|gho|glpat|sk-[a-zA-Z0-9_\-]{20,})|[a-zA-Z0-9_\-\.]{32,}(?=\b))/gi;
const PASSWORD_FIELD_VALUE_REGEX = /<input[^>]+type=["']password["'][^>]*value=["']([^"']+)["']/gi;

/**
 * Anonymizes input user task using the local in-memory PII vault.
 */
export function anonymizeInputTask(taskText, vault = globalVault) {
  if (!taskText || typeof taskText !== 'string') {
    return { sanitizedText: taskText, detected: [] };
  }
  return vault.anonymize(taskText);
}

/**
 * Rehydrates tokenized text back with original values locally.
 */
export function rehydrateLocalValue(text, vault = globalVault) {
  if (!text || typeof text !== 'string') return text;
  return vault.rehydrate(text);
}

/**
 * Scrubs sensitive secrets, credentials, and raw authentication tokens
 * from DOM observations before they enter the model context.
 */
export function sanitizeObservationForModel(observation = '', vault = globalVault) {
  if (!observation || typeof observation !== 'string') return '';

  let sanitized = observation;

  // Mask password field values in DOM dumps
  sanitized = sanitized.replace(PASSWORD_FIELD_VALUE_REGEX, (match, val) => {
    return match.replace(val, '••••••••');
  });

  // Mask high-entropy API tokens and auth headers
  sanitized = sanitized.replace(SENSITIVE_TOKEN_REGEX, (token) => {
    if (token.startsWith('[') && token.endsWith(']')) return token; // Preserve vault tokens
    return '[REDACTED_SECRET_TOKEN]';
  });

  // Re-run vault anonymization on extracted text if dynamic page revealed PII
  if (vault?.anonymize) {
    const { sanitizedText } = vault.anonymize(sanitized);
    sanitized = sanitizedText;
  }

  return sanitized;
}

/**
 * Sanitizes event payloads before they are emitted to the UI or logs.
 */
export function sanitizeEventPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;

  const copy = { ...payload };

  // Never leak API keys or secrets
  if ('apiKey' in copy) copy.apiKey = '[REDACTED_API_KEY]';
  if ('mistralApiKey' in copy) copy.mistralApiKey = '[REDACTED_API_KEY]';
  if ('geminiApiKey' in copy) copy.geminiApiKey = '[REDACTED_API_KEY]';

  // Redact raw password arguments
  if (copy.args && typeof copy.args === 'object') {
    const argsCopy = { ...copy.args };
    if (argsCopy.text && (/password|pin|secret|otp/i.test(argsCopy.semantic_hint || ''))) {
      argsCopy.text = '••••••••';
    }
    copy.args = argsCopy;
  }

  return copy;
}

/**
 * Filters state object to ensure persistent checkpoints never contain raw secrets.
 */
export function cleanStateForCheckpoint(state = {}) {
  const clean = { ...state };
  delete clean.apiKey;
  delete clean.mistralApiKey;
  delete clean.geminiApiKey;
  return clean;
}
