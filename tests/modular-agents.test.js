/**
 * PRATYAKSHA Test Suite: Modular Two-Agent Architecture
 * Validates independent Planner Agent, Browser Actor Agent, and TwoAgentGraph.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerAgent, plannerAgentNode, PLANNER_SYSTEM_PROMPT } from '../src/agent/planner-agent.js';
import { createBrowserActorAgent, browserActorAgentNode, BROWSER_ACTOR_SYSTEM_PROMPT } from '../src/agent/browser-actor-agent.js';
import { createTwoAgentGraph } from '../src/agent/graph.js';
import { createMockChrome } from './helpers/mock-chrome.js';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { AIMessage } from '@langchain/core/messages';

test('Planner Agent - Standalone Module & Built-in System Prompt', async () => {
  assert.ok(PLANNER_SYSTEM_PROMPT.includes('PRATYAKSHA Planner Agent'));

  const agent = createPlannerAgent();
  assert.equal(agent.name, 'planner_agent');
  assert.ok(agent.systemPrompt.includes('PRATYAKSHA Planner Agent'));

  const state = {
    originalTask: 'Search for quantum computing advancements',
    browserSession: { tabId: 1, url: 'https://example.com', title: 'Example' }
  };

  const update = await agent.invoke(state);
  assert.equal(update.status, 'PLANNING_COMPLETE');
  assert.ok(Array.isArray(update.plan.subgoals));
  assert.ok(update.plan.subgoals.length > 0);
  assert.equal(update.currentSubgoalIndex, 0);
});

test('Browser Actor Agent - Standalone Module & Built-in System Prompt', async () => {
  assert.ok(BROWSER_ACTOR_SYSTEM_PROMPT.includes('PRATYAKSHA Core Browser Agent'));

  const chromeApi = createMockChrome();
  const fakeModel = new FakeListChatModel({
    responses: [
      new AIMessage({
        content: 'Finished executing plan',
        tool_calls: [
          {
            id: 'call_act_1',
            name: 'finish_task',
            args: { summary: 'Plan executed successfully', success: true }
          }
        ]
      })
    ]
  });

  const agent = createBrowserActorAgent({
    model: fakeModel,
    chromeApi
  });

  assert.equal(agent.name, 'browser_actor_agent');
  assert.ok(agent.systemPrompt.includes('PRATYAKSHA Core Browser Agent'));

  const state = {
    originalTask: 'Check system status',
    plan: {
      subgoals: [{ id: 1, description: 'Check status', expectedAction: 'read_page' }]
    },
    browserSession: { tabId: 1, url: 'https://example.com', title: 'Status' },
    messages: [],
    stepCount: 0
  };

  const update = await agent.invoke(state);
  assert.equal(update.status, 'TASK_FINISHED_SIGNAL');
  assert.ok(update.latestObservation);
  assert.equal(update.latestObservation.isFinished, true);
  assert.equal(update.stepCount, 1);
});

test('Two-Agent Graph - Direct Low-Latency Pipeline Execution', async () => {
  const chromeApi = createMockChrome();
  const fakeModel = new FakeListChatModel({
    responses: [
      new AIMessage({
        content: 'Done search',
        tool_calls: [
          {
            id: 'call_two_agent_1',
            name: 'finish_task',
            args: { summary: 'Completed task with two-agent graph', success: true }
          }
        ]
      })
    ]
  });

  const app = createTwoAgentGraph({
    model: fakeModel,
    chromeApi,
    maxSteps: 50
  });

  assert.ok(app);
  assert.equal(typeof app.invoke, 'function');

  const res = await app.invoke({
    originalTask: 'Find the latest AI research papers',
    browserSession: { tabId: 1, url: 'https://example.com', title: 'Example' }
  });

  assert.equal(res.status, 'COMPLETED');
  assert.equal(res.finalResult.success, true);
  assert.ok(res.finalResult.summary.includes('Completed task with two-agent graph'));
});
