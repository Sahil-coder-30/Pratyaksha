/**
 * PRATYAKSHA Test Suite: State Definition & Planner Node
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentState } from '../src/agent/state.js';
import {
  StructuredPlanSchema,
  generateDeterministicPlan,
  plannerNode
} from '../src/agent/planner.js';
import { RISK_TIERS } from '../src/shared/constants.js';

test('AgentState - Annotation Channels & Initial State', () => {
  assert.ok(AgentState.spec.threadId);
  assert.ok(AgentState.spec.taskId);
  assert.ok(AgentState.spec.messages);
  assert.ok(AgentState.spec.plan);
  assert.ok(AgentState.spec.browserSession);
  assert.ok(AgentState.spec.blacklistedTargets);
  assert.ok(AgentState.spec.verificationResult);
});

test('StructuredPlanSchema - Validation', () => {
  const validPlan = {
    objective: 'Look up tomorrow weather',
    targetService: null,
    subgoals: [
      {
        id: 1,
        description: 'Search for tomorrow weather in Tokyo',
        expectedAction: 'search_web',
        riskTier: RISK_TIERS.READ_ONLY,
        completionEvidence: 'Weather results page loaded'
      }
    ],
    verificationCriteria: ['Weather forecast found in text'],
    missingInformation: []
  };

  const parsed = StructuredPlanSchema.parse(validPlan);
  assert.equal(parsed.objective, validPlan.objective);
  assert.equal(parsed.subgoals.length, 1);

  // Missing subgoals array rejects
  assert.throws(() => {
    StructuredPlanSchema.parse({ objective: 'empty' });
  });
});

test('Deterministic Planner - Email Workflow & Missing Information', () => {
  const task = 'Send an email saying I will be late to the meeting';
  const plan = generateDeterministicPlan(task, { url: 'https://google.com' });

  assert.equal(plan.objective, task);
  assert.equal(plan.targetService?.name, 'Gmail');
  assert.equal(plan.subgoals.length, 4);

  // Verify Send subgoal is classified as IRREVERSIBLE
  const sendSubgoal = plan.subgoals.find(s => /send/i.test(s.description));
  assert.ok(sendSubgoal);
  assert.equal(sendSubgoal.riskTier, RISK_TIERS.IRREVERSIBLE);

  // Recipient was not specified, so missingInformation must be flagged
  assert.ok(plan.missingInformation.length > 0);
  assert.ok(plan.missingInformation.some(m => /recipient/i.test(m)));
});

test('Deterministic Planner - Web Search Flow', () => {
  const task = 'Search who won the cricket world cup 2023';
  const plan = generateDeterministicPlan(task);

  assert.equal(plan.subgoals.length, 2);
  assert.equal(plan.subgoals[0].expectedAction, 'search_web');
  assert.equal(plan.subgoals[0].riskTier, RISK_TIERS.READ_ONLY);
  assert.equal(plan.missingInformation.length, 0);
});

test('Planner Node - LangGraph State Transformation', async () => {
  const mockState = {
    originalTask: 'Search best books on system design',
    sanitizedTask: 'Search best books on system design',
    browserSession: { url: 'https://google.com' }
  };

  const update = await plannerNode(mockState);
  assert.ok(update.plan);
  assert.equal(update.status, 'PLANNING_COMPLETE');
  assert.equal(update.plan.subgoals.length, 2);
});
