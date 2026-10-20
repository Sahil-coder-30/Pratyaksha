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

    const expectsReply = /\b(wait(ing)?\s+(for\s+)?([a-z0-9_-]+\s+)*(reply|response)|until\s+([a-z0-9_-]+\s+)*(reply|response))\b/i.test(task);
    if (expectsReply) {
      subgoals.push({
        id: 5,
        description: 'Hold execution and wait for reply from other user, tracking incoming message DOM changes',
        expectedAction: 'wait_for',
        riskTier: RISK_TIERS.READ_ONLY,
        completionEvidence: 'Incoming response/reply detected and verified in DOM'
      });
    }

    verificationCriteria.push('Email service mail.google.com was visited');
    verificationCriteria.push('Recipient and message fields were typed');
    verificationCriteria.push('Send button was successfully triggered');
    if (expectsReply) {
      verificationCriteria.push('Response/reply from other user was received and verified in DOM');
    }

    // Check for missing recipient
    if (!/@/.test(task) && !/\[EMAIL_/i.test(task)) {
      missingInformation.push('Recipient email address was not specified');
    }
  }
  // ── WhatsApp / Chat Workflow ──
  else if (/\b(whatsapp|wa\.me)\b/i.test(task)) {
    targetService = { name: 'WhatsApp', url: 'https://web.whatsapp.com' };

    // Extract target group/chat name: e.g. "silicon valley ke 14"
    let targetChatName = null;
    const groupMatch = task.match(/(?:open|in|to)\s+["']?([a-zA-Z0-9_\s]{2,35}?)["']?\s+(?:group|chat|on\s+whatsapp)/i) ||
                       task.match(/(?:group|chat)\s+["']?([a-zA-Z0-9_\s]{2,35}?)["']?\s+(?:on|in)/i) ||
                       task.match(/whatsapp\s+(?:and\s+chat\s+(?:with\s+(?:the\s+people\s+over\s+there|them)\s+)?in\s+)?["']?([a-zA-Z0-9_\s]{2,35}?)["']?\s+group/i);
    if (groupMatch && groupMatch[1]) {
      targetChatName = groupMatch[1].trim();
    }

    const iterMatch = task.match(/(\d+)\s+iterations?/i);
    const requestedIterations = iterMatch ? parseInt(iterMatch[1], 10) : 1;
    const untilExit = /\buntil\s+(the\s+)?(user|members?|someone|they)?\s*says?\s*["']?exit["']?\b/i.test(task);
    const expectsReply = requestedIterations > 1 || untilExit || /\b(a?wait(ing)?\s+(for\s+)?([a-z0-9_-]+\s+)*(reply|response)|until\s+([a-z0-9_-]+\s+)*(reply|response)|iterations?)\b/i.test(task);

    subgoals.push({
      id: 1,
      description: 'Focus WhatsApp Web on current active tab',
      expectedAction: 'read_page',
      riskTier: RISK_TIERS.READ_ONLY,
      completionEvidence: 'WhatsApp chat interface is active'
    });

    if (targetChatName) {
      subgoals.push({
        id: 2,
        description: `Search for and click into requested group/contact "${targetChatName}"`,
        expectedAction: 'type_into_element',
        riskTier: RISK_TIERS.REVERSIBLE,
        completionEvidence: `Group "${targetChatName}" is opened and active in main chat pane`
      });
    } else {
      subgoals.push({
        id: 2,
        description: 'Find and open requested contact or group chat',
        expectedAction: 'click_element',
        riskTier: RISK_TIERS.REVERSIBLE,
        completionEvidence: 'Target chat conversation opened in main view'
      });
    }

    subgoals.push({
      id: 3,
      description: 'Type and dispatch initial message/introduction into WhatsApp compose input (with press_enter=true)',
      expectedAction: 'type_into_element',
      riskTier: RISK_TIERS.REVERSIBLE,
      completionEvidence: 'Message text typed and dispatched into WhatsApp chat'
    });

    if (expectsReply) {
      subgoals.push({
        id: 4,
        description: untilExit
          ? 'Execute continuous conversation loop: wait for incoming reply, answer questions (using tinyfish_research for external info), and continue chatting until user says "exit"'
          : (requestedIterations > 1
            ? `Execute multi-turn conversation loop: wait for incoming reply, read response, and answer (cycle through ${requestedIterations} iterations)`
            : 'Hold execution and wait for response from group members, monitoring DOM for incoming messages'),
        expectedAction: 'wait_for',
        riskTier: RISK_TIERS.READ_ONLY,
        completionEvidence: untilExit
          ? 'Conversation loop completed when user said "exit"'
          : (requestedIterations > 1
            ? `Conversation loop completed for ${requestedIterations} iterations`
            : 'Incoming response detected in WhatsApp DOM')
      });
    }

    verificationCriteria.push('WhatsApp Web was accessed');
    if (targetChatName) {
      verificationCriteria.push(`Target group "${targetChatName}" was selected and opened`);
    } else {
      verificationCriteria.push('Target group or chat was opened');
    }
    verificationCriteria.push('Message was dispatched into the chat');
    if (expectsReply) {
      verificationCriteria.push('Incoming response tracked and verified in DOM without hallucination');
    }
    if (untilExit) {
      verificationCriteria.push('Conversation maintained until user exit condition received');
    } else if (requestedIterations > 1) {
      verificationCriteria.push('Multi-turn conversation maintained across iterations');
    }
  }
  // ── Coding & Problem-Solving Workflow (LeetCode, HackerRank, etc.) ──
  else if (/\b(leetcode|hackerrank|codeforces|two sum|twosum|solve.*problem|solve.*question|fix.*(code|solution|this)|pasted.*solution|template.*looks)\b/i.test(task)) {
    targetService = targetService || { name: 'LeetCode', url: 'https://leetcode.com' };

    const isFixTask = /\b(fix|pasted|duplicate|template|compile error|wrong answer|not accepted|error)\b/i.test(task);

    if (isFixTask) {
      subgoals.push({
        id: 1,
        description: 'Locate code editor on problem page and completely clear duplicate template and boilerplate using write_code_editor(clear_existing=true)',
        expectedAction: 'write_code_editor',
        riskTier: RISK_TIERS.REVERSIBLE,
        completionEvidence: 'Code editor completely wiped and re-injected with single clean solution'
      });
      subgoals.push({
        id: 2,
        description: 'Click Submit button to test corrected code against judge',
        expectedAction: 'click_element',
        riskTier: RISK_TIERS.REVERSIBLE,
        completionEvidence: 'Submit button clicked and testcase evaluation triggered'
      });
      subgoals.push({
        id: 3,
        description: 'Wait for judge submission verdict ("Accepted") and confirm result',
        expectedAction: 'wait_for',
        riskTier: RISK_TIERS.READ_ONLY,
        completionEvidence: 'Accepted verdict verified in DOM'
      });

      verificationCriteria.push('Editor was cleared of duplicate templates and updated with clean solution');
      verificationCriteria.push('Submit was triggered and Accepted verdict verified in DOM');
    } else {
      subgoals.push({
        id: 1,
        description: 'Navigate to coding platform problem page',
        expectedAction: 'open_url',
        riskTier: RISK_TIERS.REVERSIBLE,
        completionEvidence: 'Problem description and editor active on page'
      });

      subgoals.push({
        id: 2,
        description: 'Locate code editor and inject clean solution using write_code_editor (with clear_existing=true)',
        expectedAction: 'write_code_editor',
        riskTier: RISK_TIERS.REVERSIBLE,
        completionEvidence: 'Code editor buffer updated with algorithm implementation'
      });

      subgoals.push({
        id: 3,
        description: 'Click Submit button to test code against judge testcases',
        expectedAction: 'click_element',
        riskTier: RISK_TIERS.REVERSIBLE,
        completionEvidence: 'Submit button clicked and testcase evaluation triggered'
      });

      subgoals.push({
        id: 4,
        description: 'Wait for judge submission verdict ("Accepted") and confirm result',
        expectedAction: 'wait_for',
        riskTier: RISK_TIERS.READ_ONLY,
        completionEvidence: 'Submission verdict (Accepted) verified in DOM'
      });

      verificationCriteria.push('Coding platform was visited and problem opened');
      verificationCriteria.push('Solution was injected into code editor');
      verificationCriteria.push('Submit was triggered and Accepted verdict verified in DOM');
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
