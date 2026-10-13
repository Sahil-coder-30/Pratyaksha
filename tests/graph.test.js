/**
 * PRATYAKSHA Test Suite: LangGraph Workflow Orchestration
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentGraph, getGraphMermaid } from '../src/agent/graph.js';
import { createMockChrome } from './helpers/mock-chrome.js';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { AIMessage } from '@langchain/core/messages';

test('LangGraph - Compilation & Topology', () => {
  const app = createAgentGraph();
  assert.ok(app);
  assert.equal(typeof app.invoke, 'function');

  const mermaid = getGraphMermaid(app);
  assert.ok(mermaid.includes('graph TD;'));
  assert.ok(mermaid.includes('intake'));
  assert.ok(mermaid.includes('privacy'));
  assert.ok(mermaid.includes('planner'));
  assert.ok(mermaid.includes('policy'));
  assert.ok(mermaid.includes('browser_agent'));
  assert.ok(mermaid.includes('verification'));
  assert.ok(mermaid.includes('recovery'));
  assert.ok(mermaid.includes('finalize'));
});

test('LangGraph - Empty Task Validation Flow', async () => {
  const app = createAgentGraph();
  const res = await app.invoke({
    originalTask: ''
  });

  assert.equal(res.status, 'TERMINATED');
  assert.equal(res.finalResult.success, false);
  assert.ok(res.finalResult.summary.includes('Task cannot be empty'));
});

test('LangGraph - Missing Information Flow', async () => {
  const app = createAgentGraph();
  // Email task without recipient triggers missing information flag
  const res = await app.invoke({
    originalTask: 'Send an email saying I will be late to the meeting',
    browserSession: { tabId: 1, url: 'https://google.com', title: 'Google' }
  });

  // Planner routes directly to finalize when missingInformation is present
  assert.ok(res.plan);
  assert.ok(res.plan.missingInformation.length > 0);
  assert.equal(res.status, 'TERMINATED');
  assert.equal(res.finalResult.success, false);
});

test('LangGraph - Full Workflow Execution with Fake Model', async () => {
  const chromeApi = createMockChrome();

  // Model returns finish_task tool call
  const fakeModel = new FakeListChatModel({
    responses: [
      new AIMessage({
        content: 'Task completed successfully',
        tool_calls: [
          {
            id: 'call_test_1',
            name: 'finish_task',
            args: { summary: 'Found system design books', success: true }
          }
        ]
      })
    ]
  });

  const app = createAgentGraph({
    model: fakeModel,
    chromeApi,
    enableInterrupts: false
  });

  const res = await app.invoke({
    originalTask: 'Look up best system design books',
    browserSession: { tabId: 1, url: 'https://example.com/books', title: 'Books' }
  });

  assert.ok(res.finalResult);
  assert.equal(res.finalResult.success, true);
  assert.ok(res.finalResult.summary.includes('Found system design books'));
  assert.equal(res.status, 'COMPLETED');
});

test('LangGraph - Message Ordering Invariant (Never Ends in AIMessage)', async () => {
  const chromeApi = createMockChrome();
  let receivedMessages = null;

  // Custom mock model capturing the exact messages array it receives
  const trackingModel = {
    bindTools() {
      return {
        async invoke(msgs) {
          receivedMessages = msgs;
          return new AIMessage({
            content: 'Finishing task',
            tool_calls: [
              {
                id: 'call_done_1',
                name: 'finish_task',
                args: { summary: 'Done safely', success: true }
              }
            ]
          });
        }
      };
    }
  };

  const app = createAgentGraph({
    model: trackingModel,
    chromeApi,
    enableInterrupts: false
  });

  // Supply state that already ends with an AIMessage (e.g. from prior turn or checkpoint)
  const res = await app.invoke({
    originalTask: 'Test task with previous history',
    messages: [
      new AIMessage('I am an earlier assistant response without tools')
    ],
    browserSession: { tabId: 1, url: 'https://example.com', title: 'Example' }
  });

  assert.ok(receivedMessages);
  assert.ok(receivedMessages.length >= 2);
  const lastMsg = receivedMessages[receivedMessages.length - 1];
  const lastType = lastMsg._getType ? lastMsg._getType() : lastMsg.role;

  // Verifies that the trailing message is strictly a HumanMessage, NOT an AIMessage
  assert.equal(lastType, 'human', 'Trailing message sent to LLM must be human/user, preventing Mistral code 3230');
  assert.equal(res.status, 'COMPLETED');
});

test('LangGraph - Multi-Step Execution Loop (Executes 3 steps without premature step-1 exit)', async () => {
  const chromeApi = createMockChrome();

  let turn = 0;
  const multiStepModel = {
    bindTools() {
      return {
        async invoke(msgs) {
          turn++;
          if (turn === 1) {
            return new AIMessage({
              content: 'Clicking search button',
              tool_calls: [{
                id: 'call_step_1',
                name: 'click_element',
                args: { target_id: 1, semantic_hint: 'Search' }
              }]
            });
          }
          if (turn === 2) {
            return new AIMessage({
              content: 'Typing search query',
              tool_calls: [{
                id: 'call_step_2',
                name: 'type_into_element',
                args: { target_id: 2, text: 'LangGraph architecture' }
              }]
            });
          }
          return new AIMessage({
            content: 'Completed the multi-step search task',
            tool_calls: [{
              id: 'call_step_3',
              name: 'finish_task',
              args: { summary: 'Successfully searched and found results', success: true }
            }]
          });
        }
      };
    }
  };

  const app = createAgentGraph({
    model: multiStepModel,
    chromeApi,
    enableInterrupts: false,
    maxSteps: 100
  });

  const res = await app.invoke({
    originalTask: 'Search for LangGraph architecture and report back',
    browserSession: { tabId: 1, url: 'https://example.com', title: 'Example' }
  });

  assert.equal(res.status, 'COMPLETED');
  assert.equal(res.finalResult.success, true);
  assert.equal(res.stepCount, 3, 'LangGraph executed all 3 turns end-to-end without stopping on step 1');
  assert.ok(res.finalResult.summary.includes('Successfully searched'));
});

test('LangGraph - Real-time Thinking Events Stream', async () => {
  const chromeApi = createMockChrome();
  const thinkingEvents = [];
  const { AgentEventEmitter } = await import('../src/ui/agent-events.js');
  const emitter = new AgentEventEmitter((ev) => {
    if (ev.type === 'THINKING') {
      thinkingEvents.push(ev);
    }
  });

  const fakeModel = new FakeListChatModel({
    responses: [
      new AIMessage({
        content: 'Reasoning about elements',
        tool_calls: [{
          id: 'call_think_1',
          name: 'finish_task',
          args: { summary: 'Done reasoning', success: true }
        }]
      })
    ]
  });

  const app = createAgentGraph({
    model: fakeModel,
    chromeApi,
    enableInterrupts: false,
    maxSteps: 100,
    events: emitter
  });

  await app.invoke({
    originalTask: 'Evaluate and think through page actions',
    browserSession: { tabId: 1, url: 'https://example.com', title: 'Example' }
  });

  assert.ok(thinkingEvents.length >= 3, 'Thinking events emitted throughout the lifecycle');
  const phases = thinkingEvents.map(e => e.phase);
  assert.ok(phases.includes('intake'), 'Intake thinking event emitted');
  assert.ok(phases.includes('perceive'), 'Perceive thinking event emitted');
  assert.ok(phases.includes('reason'), 'Reason thinking event emitted');
  assert.ok(phases.includes('action'), 'Action thinking event emitted');
});
