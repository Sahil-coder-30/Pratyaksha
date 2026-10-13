/**
 * PRATYAKSHA Test Suite: UI Events & Unified Runner
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentEventEmitter, AGENT_EVENT_TYPES } from '../src/ui/agent-events.js';
import { PratyakshaAgentRunner, LangGraphAgent } from '../src/runner.js';
import { createMockChrome } from './helpers/mock-chrome.js';

test('AgentEventEmitter - Event Delivery & Secret Scrubbing', () => {
  const emitted = [];
  const emitter = new AgentEventEmitter((ev) => emitted.push(ev));

  emitter.emit(AGENT_EVENT_TYPES.TASK_START, {
    task: 'Book tickets',
    apiKey: 'sk-secret-key-123'
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, AGENT_EVENT_TYPES.TASK_START);
  assert.equal(emitted[0].task, 'Book tickets');
  assert.equal(emitted[0].apiKey, '[REDACTED_API_KEY]');
  assert.ok(emitted[0].timestamp);

  // After cancellation, events are suppressed
  emitter.emitCancelled('Stop requested');
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].type, AGENT_EVENT_TYPES.CANCELLED);

  emitter.emit(AGENT_EVENT_TYPES.TOOL_CALL, { toolName: 'click_element' });
  assert.equal(emitted.length, 2, 'No further events emitted after cancellation');
});

test('PratyakshaAgentRunner & LangGraphAgent Facade - Execution Flow', async () => {
  const chromeApi = createMockChrome();
  const events = [];

  const agent = new LangGraphAgent({
    provider: 'mistral',
    apiKey: 'mock-key',
    model: 'ministral-8b-latest',
    chromeApi,
    onEvent: (ev) => events.push(ev)
  });

  assert.ok(agent instanceof PratyakshaAgentRunner);

  // Run a task that requires input (missing recipient email)
  const result = await agent.run(
    'Send an email to my colleague about the sprint demo',
    { id: 1, url: 'https://mail.google.com', title: 'Gmail' }
  );

  assert.ok(result);
  assert.equal(typeof result.success, 'boolean');
  assert.ok(events.some(e => e.type === AGENT_EVENT_TYPES.TASK_START));
});

test('PratyakshaAgentRunner - 1-Click Immediate Stop / Cancel', async () => {
  const chromeApi = createMockChrome();
  const events = [];

  const agent = new PratyakshaAgentRunner({
    chromeApi,
    onEvent: (ev) => events.push(ev)
  });

  agent.cancel();
  assert.equal(agent.isCancelled, true);
  assert.ok(events.some(e => e.type === AGENT_EVENT_TYPES.CANCELLED));
});

test('PratyakshaAgentRunner - Human Approval Interception, Resumption, and Rejection', async () => {
  const chromeApi = createMockChrome();
  const events = [];

  const agent = new PratyakshaAgentRunner({
    provider: 'mistral',
    apiKey: 'mock-key',
    chromeApi,
    onEvent: (ev) => events.push(ev)
  });

  // Emulate an awaiting approval state
  agent.activeThreadId = 'th_test_approval';
  agent.activeTab = { id: 1, url: 'https://bank.example.com', title: 'Bank' };

  const { createApprovalRequest } = await import('../src/safety/approval.js');
  const req = createApprovalRequest({
    threadId: agent.activeThreadId,
    action: { toolName: 'click_element', args: { index: 10 } },
    reason: 'Irreversible fund transfer click',
    pageContext: agent.activeTab
  });

  // Test handling of an awaiting approval result
  const handled = await agent._handleResult({
    status: 'AWAITING_APPROVAL',
    pendingApproval: req,
    stepCount: 2
  }, agent.activeThreadId);

  assert.equal(handled.awaitingApproval, true);
  assert.equal(agent.pendingApproval.token, req.token);
  assert.ok(events.some(e => e.type === AGENT_EVENT_TYPES.APPROVAL_REQUIRED));

  // Test rejecting approval
  const rejectResult = await agent.rejectAction('User cancelled transaction');
  assert.equal(rejectResult.success, false);
  assert.equal(rejectResult.summary, 'User cancelled transaction');
  assert.equal(agent.pendingApproval, null);
  assert.ok(events.some(e => e.type === AGENT_EVENT_TYPES.APPROVAL_REJECTED));
});

test('PratyakshaAgentRunner - Two-Agent Architecture Selection', async () => {
  const chromeApi = createMockChrome();
  const agent = new PratyakshaAgentRunner({
    chromeApi,
    useTwoAgentGraph: true
  });

  assert.equal(agent.useTwoAgentGraph, true);
});

