/**
 * PRATYAKSHA URL Navigation Policy
 * Sovereign Privacy-First Browser Agent
 */

import { FORBIDDEN_URL_PROTOCOLS } from '../shared/constants.js';

/**
 * Validates whether a target URL is permissible for browser navigation.
 */
export function validateNavigationUrl(rawUrl = '') {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { allowed: false, reason: 'URL cannot be empty' };
  }

  const trimmed = rawUrl.trim();
  let parsed;

  try {
    // If no protocol, test with https
    const testUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(testUrl);
  } catch (err) {
    return { allowed: false, reason: `Malformed URL: ${err.message}` };
  }

  // Reject forbidden protocols
  if (FORBIDDEN_URL_PROTOCOLS.includes(parsed.protocol)) {
    return {
      allowed: false,
      reason: `Access to internal browser protocol "${parsed.protocol}" is blocked.`,
      protocol: parsed.protocol
    };
  }

  // Only permit http, https, and file (controlled local testing)
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) {
    return {
      allowed: false,
      reason: `Protocol "${parsed.protocol}" is not supported for agent navigation.`,
      protocol: parsed.protocol
    };
  }

  return {
    allowed: true,
    normalizedUrl: parsed.href,
    protocol: parsed.protocol,
    hostname: parsed.hostname
  };
}
