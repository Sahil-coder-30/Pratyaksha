/**
 * PRATYAKSHA Test Suite: Execution Middleware
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { HumanMessage, ToolMessage, AIMessage } from '@langchain/core/messages';
import { pruneContext, validateToolCall, filterRetries } from '../src/agent/middleware.js';

test('Middleware - Context Pruning Bounds Long Observation History', () => {
  const bigObservation = 'x'.repeat(2000);
  const messages = [
    new HumanMessage('Perform task'),
    new AIMessage({ content: '', tool_calls: [{ id: '1', name: 'read_page', args: {} }] }),
    new ToolMessage({ tool_call_id: '1', name: 'read_page', content: bigObservation }),
    new AIMessage({ content: '', tool_calls: [{ id: '2', name: 'click_element', args: { index: 1 } }] }),
    new ToolMessage({ tool_call_id: '2', name: 'click_element', content: 'Clicked element 1' }),
    new AIMessage({ content: 'Done' })
  ];

  const pruned = pruneContext(messages, { maxRecentMessages: 3, maxObservationLength: 200 });
  assert.equal(pruned.length, 6);

  // The older tool message should be compacted
  const olderToolMsg = pruned[2];
  assert.ok(olderToolMsg.content.length < 350);
  assert.ok(olderToolMsg.content.includes('observation pruned for context'));

  // The recent messages should remain uncompacted
  assert.equal(pruned[4].content, 'Clicked element 1');
});

test('Middleware - Tool Call Validation Intercepts Blacklisted Targets', () => {
  const blacklisted = [42, 'btn-submit'];

  // Allowed target
  const validCall = { name: 'click_element', args: { index: 5 } };
  const v1 = validateToolCall(validCall, blacklisted);
  assert.equal(v1.valid, true);

  // Blacklisted index
  const blockedIndex = { name: 'click_element', args: { index: 42 } };
  const v2 = validateToolCall(blockedIndex, blacklisted);
  assert.equal(v2.valid, false);
  assert.ok(v2.reason.includes('blacklisted'));

  // Blacklisted selector
  const blockedSelector = { name: 'click_element', args: { selector: 'btn-submit' } };
  const v3 = validateToolCall(blockedSelector, blacklisted);
  assert.equal(v3.valid, false);
  assert.ok(v3.reason.includes('blacklisted'));
});

test('Middleware - Retry Filtering and Circuit Breaker', () => {
  const failureCounters = new Map();

  // Non-fatal error attempt 1
  const r1 = filterRetries('click_element', new Error('Element not found'), failureCounters, 2);
  assert.equal(r1.retryable, true);
  assert.equal(r1.tripCircuit, false);
  assert.equal(r1.failures, 1);

  // Non-fatal error attempt 2 trips circuit
  const r2 = filterRetries('click_element', new Error('Element not found'), failureCounters, 2);
  assert.equal(r2.retryable, false);
  assert.equal(r2.tripCircuit, true);
  assert.equal(r2.failures, 2);

  // Fatal policy violation immediately trips circuit
  const rFatal = filterRetries('open_url', new Error('Forbidden URL protocol'), failureCounters, 2);
  assert.equal(rFatal.retryable, false);
  assert.equal(rFatal.tripCircuit, true);
});
