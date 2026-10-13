/**
 * PRATYAKSHA Planner Node
 * Sovereign Privacy-First Browser Agent
 *
 * Converts the user objective into a structured, verifiable plan
 * with subgoal decomposition, risk annotations, and evidence criteria.
 * Supports structured model reasoning with robust deterministic offline fallback.
 */

import { z } from 'zod';
import { detectTargetService } from '../browser/page-context.js';
import { RISK_TIERS } from '../shared/constants.js';

export const StructuredPlanSchema = z.object({
  objective: z.string().describe('Preserved user objective.'),
  targetService: z.object({
    name: z.string(),
    url: z.string()
  }).nullable().optional().describe('Detected canonical target service or URL.'),
  subgoals: z.array(z.object({
    id: z.number().int(),
    description: z.string(),
    expectedAction: z.string(),
    riskTier: z.enum([
      RISK_TIERS.READ_ONLY,
      RISK_TIERS.REVERSIBLE,
      RISK_TIERS.SENSITIVE,
      RISK_TIERS.IRREVERSIBLE,
      RISK_TIERS.RESTRICTED
    ]).default(RISK_TIERS.REVERSIBLE),
    completionEvidence: z.string().describe('What browser evidence proves this subgoal is complete.')
  })).describe('Step-by-step subgoal breakdown.'),
  verificationCriteria: z.array(z.string()).default([]).describe('Checklist of factual evidence required to verify final completion.'),
  missingInformation: z.array(z.string()).default([]).describe(
    'BLOCKING missing parameters that make execution strictly impossible (e.g. sending an email with no recipient). Do NOT include optional preferences, formatting options, or clarifying questions where autonomous defaults exist. For search, research, lookup, or general browsing, this MUST be an empty array [].'
  )
});

/**
 * Deterministic Semantic Planner (Works 100% offline with zero cloud dependencies)
 */
export function generateDeterministicPlan(task = '', pageContext = {}) {
  let targetService = detectTargetService(task);
  const subgoals = [];
  const verificationCriteria = [];
  const missingInformation = [];

  const lower = task.toLowerCase();

  // ── Email / Messaging Workflow ──
  if (/\b(mail|email|send\s+email)\b/i.test(task)) {
    if (!targetService) {
      targetService = { name: 'Gmail', url: 'https://mail.google.com' };
    }
    const serviceUrl = targetService.url;
    subgoals.push({
      id: 1,
      description: `Navigate to email portal (${serviceUrl})`,
      expectedAction: 'open_url',
      riskTier: RISK_TIERS.REVERSIBLE,
      completionEvidence: 'Current page URL contains mail.google.com'
    });
    subgoals.push({
      id: 2,
      description: 'Open compose dialog if not open',
      expectedAction: 'click_element',
      riskTier: RISK_TIERS.REVERSIBLE,
      completionEvidence: 'Compose dialog or recipient field present in DOM'
    });
    subgoals.push({
      id: 3,
      description: 'Type recipient, subject, and message content',
      expectedAction: 'type_into_element',
      riskTier: RISK_TIERS.REVERSIBLE,
      completionEvidence: 'Email fields contain entered values'
    });
    subgoals.push({
      id: 4,
      description: 'Click Send button to dispatch email',
      expectedAction: 'click_element',
      riskTier: RISK_TIERS.IRREVERSIBLE,
      completionEvidence: 'Send button clicked and message sent toast appears'
    });

    verificationCriteria.push('Email service mail.google.com was visited');
    verificationCriteria.push('Recipient and message fields were typed');
    verificationCriteria.push('Send button was successfully triggered');

    // Check for missing recipient
    if (!/@/.test(task) && !/\[EMAIL_/i.test(task)) {
      missingInformation.push('Recipient email address was not specified');
    }
  }
  // ── Web Search / Fact Lookup ──
  else if (/\b(search|find|lookup|who|what|score|price)\b/i.test(task)) {
    subgoals.push({
      id: 1,
      description: `Search web for query: "${task}"`,
      expectedAction: 'search_web',
      riskTier: RISK_TIERS.READ_ONLY,
      completionEvidence: 'Search results displayed on search engine page'
    });
    subgoals.push({
      id: 2,
      description: 'Extract relevant answer text from search results',
      expectedAction: 'read_page',
      riskTier: RISK_TIERS.READ_ONLY,
      completionEvidence: 'Fact or relevant content extracted'
    });

    verificationCriteria.push('Search results retrieved from search engine');
    verificationCriteria.push('Direct answer or fact identified in page text');
  }
  // ── Navigation & Interaction ──
  else if (targetService) {
    subgoals.push({
      id: 1,
      description: `Navigate to target destination (${targetService.name})`,
      expectedAction: 'open_url',
      riskTier: RISK_TIERS.REVERSIBLE,
      completionEvidence: `Browser URL matches ${targetService.url}`
    });
    subgoals.push({
      id: 2,
      description: `Locate interactive elements on ${targetService.name}`,
      expectedAction: 'read_page',
      riskTier: RISK_TIERS.READ_ONLY,
      completionEvidence: 'Target elements identified in DOM table'
    });

    verificationCriteria.push(`Destination ${targetService.name} opened`);
  }
  // ── Conversational / Greetings / Explanations ──
  else if (/^\s*(hi|hello|hey|greetings|howdy|good\s+(morning|afternoon|evening)|who\s+are\s+you|what\s+can\s+you\s+do)\b/i.test(task)) {
    subgoals.push({
      id: 1,
      description: 'Acknowledge greeting and present autonomous browser capabilities',
      expectedAction: 'finish_task',
      riskTier: RISK_TIERS.READ_ONLY,
      completionEvidence: 'Greeting answered'
    });
    verificationCriteria.push('User query acknowledged');
  }
  // ── General Page Action ──
  else {
    subgoals.push({
      id: 1,
      description: 'Inspect current page context and interactive controls',
      expectedAction: 'read_page',
      riskTier: RISK_TIERS.READ_ONLY,
      completionEvidence: 'Current page DOM table inspected'
    });
    subgoals.push({
      id: 2,
      description: 'Perform requested action on target element',
      expectedAction: 'click_element',
      riskTier: RISK_TIERS.REVERSIBLE,
      completionEvidence: 'Element action completed'
    });

    verificationCriteria.push('Action executed without error');
  }

  return {
    objective: task,
    targetService: targetService ? { name: targetService.name, url: targetService.url } : null,
    subgoals,
    verificationCriteria,
    missingInformation
  };
}

/**
 * LangGraph Planner Node facade
 * Delegates directly to independent planner-agent module.
 */
export async function plannerNode(state, options = {}) {
  const { plannerAgentNode } = await import('./planner-agent.js');
  return plannerAgentNode(state, options);
}
