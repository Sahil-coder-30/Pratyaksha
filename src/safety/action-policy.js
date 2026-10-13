/**
 * PRATYAKSHA Action Classification & Risk Policy
 * Sovereign Privacy-First Browser Agent
 *
 * Classifies proposed tool operations into risk tiers:
 * - READ_ONLY
 * - REVERSIBLE
 * - SENSITIVE
 * - IRREVERSIBLE
 * - RESTRICTED
 * Determines whether human-in-the-loop approval is mandatory prior to execution.
 */

import { RISK_TIERS, TOOL_NAMES } from '../shared/constants.js';

// Keywords indicative of consequential, irreversible user actions
const IRREVERSIBLE_SEMANTIC_REGEX = /\b(send|submit\s+order|pay|checkout|confirm\s+payment|buy|purchase|delete|destroy|terminate|transfer|publish)\b/i;

/**
 * Classifies a proposed browser operation and determines approval requirements.
 *
 * @param {string} toolName
 * @param {Object} args
 * @param {Object} [pageContext]
 * @returns {{ riskTier: string, requiresApproval: boolean, reason?: string, summary: string }}
 */
export function classifyAction(toolName, args = {}, pageContext = {}) {
  // 1. Privileged tools
  if (toolName === TOOL_NAMES.EXECUTE_JS) {
    return {
      riskTier: RISK_TIERS.RESTRICTED,
      requiresApproval: true,
      reason: 'Executing arbitrary JavaScript in the webpage requires explicit user authorization.',
      summary: `Execute arbitrary JavaScript: "${(args.code || '').slice(0, 60)}..."`
    };
  }

  // 2. Read-only tools
  if ([
    TOOL_NAMES.READ_PAGE,
    TOOL_NAMES.GET_PAGE_METADATA,
    TOOL_NAMES.GET_LINKS,
    TOOL_NAMES.FIND_ON_PAGE,
    TOOL_NAMES.EXTRACT_STRUCTURED,
    TOOL_NAMES.INSPECT_DOM,
    TOOL_NAMES.SCREENSHOT,
    TOOL_NAMES.WAIT_FOR,
    TOOL_NAMES.WAIT_SECONDS,
    TOOL_NAMES.SEARCH_WEB
  ].includes(toolName)) {
    return {
      riskTier: RISK_TIERS.READ_ONLY,
      requiresApproval: false,
      summary: `Read-only observation: ${toolName}`
    };
  }

  // 3. Reversible navigation & viewport operations
  if ([
    TOOL_NAMES.OPEN_URL,
    TOOL_NAMES.GO_BACK,
    TOOL_NAMES.GO_FORWARD,
    TOOL_NAMES.SWITCH_TAB,
    TOOL_NAMES.SCROLL_PAGE
  ].includes(toolName)) {
    return {
      riskTier: RISK_TIERS.REVERSIBLE,
      requiresApproval: false,
      summary: `Reversible navigation: ${toolName} (${args.url || args.direction || ''})`
    };
  }

  // 4. Interactive clicks — check for irreversible actions (Send, Pay, Delete, etc.)
  if (toolName === TOOL_NAMES.CLICK_ELEMENT) {
    const hint = args.semantic_hint || '';
    let isIrreversible = IRREVERSIBLE_SEMANTIC_REGEX.test(hint);

    // If target element is known in pageContext, inspect element label/text
    if (!isIrreversible && args.target_id && Array.isArray(pageContext.elements)) {
      const el = pageContext.elements.find(e => Number(e.id) === Number(args.target_id));
      if (el) {
        const text = `${el.label || ''} ${el.text || ''} ${el.ariaLabel || ''} ${el.value || ''}`;
        isIrreversible = IRREVERSIBLE_SEMANTIC_REGEX.test(text);
      }
    }

    if (isIrreversible) {
      return {
        riskTier: RISK_TIERS.IRREVERSIBLE,
        requiresApproval: true,
        reason: `Clicking an irreversible action control ("${hint || 'target #' + args.target_id}") requires confirmation.`,
        summary: `Click action: "${hint || 'Element #' + args.target_id}" on ${pageContext.url || 'current page'}`
      };
    }

    return {
      riskTier: RISK_TIERS.REVERSIBLE,
      requiresApproval: false,
      summary: `Click element: [#${args.target_id || '?'}] "${hint}"`
    };
  }

  // 5. Typing into elements
  if (toolName === TOOL_NAMES.TYPE_INTO_ELEMENT) {
    const hint = args.semantic_hint || '';
    const isSensitive = /password|pin|secret|cvv|otp|ssn|card/i.test(hint);

    if (isSensitive) {
      return {
        riskTier: RISK_TIERS.SENSITIVE,
        requiresApproval: true,
        reason: 'Entering credentials or sensitive security data requires explicit approval.',
        summary: `Type sensitive data into field: "${hint}"`
      };
    }

    return {
      riskTier: RISK_TIERS.REVERSIBLE,
      requiresApproval: false,
      summary: `Type into field: "${hint || '#' + args.target_id}"`
    };
  }

  // Default fallback
  return {
    riskTier: RISK_TIERS.REVERSIBLE,
    requiresApproval: false,
    summary: `Execute ${toolName}`
  };
}
