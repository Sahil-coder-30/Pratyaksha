/**
 * PRATYAKSHA Planner Agent Node
 * Sovereign Privacy-First Browser Agent
 *
 * Standalone planner agent with its own built-in system prompt.
 * Converts user objectives into a clean, minimal, verifiable execution plan.
 */

import { generateDeterministicPlan, StructuredPlanSchema } from './planner.js';

export const PLANNER_SYSTEM_PROMPT = `You are PRATYAKSHA Planner Agent — an autonomous web task strategist.
Your role is to formulate a clean, minimal, executable plan for the browser execution agent.
1. Break down the user objective into sequential subgoals.
2. Assign expected browser actions: open_url, click_element, type_into_element, search_web, read_page, finish_task.
3. Only flag missing information if strictly blocking (e.g. sending an email with no recipient specified).
4. For general search, lookup, or navigation, proceed autonomously without asking clarifying questions.`;

/**
 * Creates a standalone Planner Agent instance.
 */
export function createPlannerAgent(options = {}) {
  const model = options.model;
  const useModelPlanner = options.useModelPlanner || false;
  const events = options.events;

  return {
    name: 'planner_agent',
    systemPrompt: PLANNER_SYSTEM_PROMPT,

    async invoke(state) {
      return plannerAgentNode(state, { model, useModelPlanner, events });
    }
  };
}

/**
 * LangGraph node handler for the planner agent.
 * Executes pure planning logic with zero unnecessary complexity.
 */
export async function plannerAgentNode(state, options = {}) {
  const task = state.sanitizedTask || state.originalTask || '';
  const pageContext = state.browserSession || {};
  const model = options.model;
  const events = options.events;

  events?.emit?.('THINKING', {
    phase: 'plan',
    text: 'Formulating structured execution plan…',
    step: 0,
    maxSteps: options.maxSteps || 100
  });

  // 1. Generate fast, clean deterministic plan
  let plan = generateDeterministicPlan(task, pageContext);

  // 2. Structured model planning if explicitly enabled and model available
  if (options.useModelPlanner && model && typeof model.withStructuredOutput === 'function') {
    try {
      const structuredModel = model.withStructuredOutput(StructuredPlanSchema);
      const prompt = `${PLANNER_SYSTEM_PROMPT}

User Objective: "${task}"
Current Browser State:
URL: ${pageContext.url || 'None'}
Title: ${pageContext.title || 'None'}

Return a structured plan with subgoals and verification criteria.`;

      const response = await structuredModel.invoke(prompt);
      if (response && Array.isArray(response.subgoals) && response.subgoals.length > 0) {
        if (!Array.isArray(response.verificationCriteria) || response.verificationCriteria.length === 0) {
          response.verificationCriteria = ['Task acknowledged'];
        }
        plan = response;
      }
    } catch (err) {
      console.warn('[PRATYAKSHA Planner Agent] Model planning error, using deterministic plan:', err.message);
    }
  }

  // 3. Check for genuinely blocking missing information (e.g. email with no recipient)
  const hasBlockingMissingInfo = Array.isArray(plan.missingInformation) &&
    plan.missingInformation.length > 0 &&
    plan.missingInformation.some(info => /recipient|password|secret|account\s+number|destination/i.test(info) || !plan.subgoals?.length);

  if (plan.subgoals?.length) {
    events?.emit?.('THINKING', {
      phase: 'plan',
      text: `Execution plan formulated with ${plan.subgoals.length} subgoal(s).`,
      step: 0,
      maxSteps: options.maxSteps || 100
    });
  }

  return {
    plan,
    currentSubgoalIndex: 0,
    status: hasBlockingMissingInfo ? 'AWAITING_USER_INPUT' : 'PLANNING_COMPLETE'
  };
}
