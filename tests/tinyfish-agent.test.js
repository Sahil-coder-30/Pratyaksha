/**
 * PRATYAKSHA Test Suite: TinyFish Agent Integration
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TinyFishAgent, validateTinyFishKey } from '../pratyaksha-extension/agent/tinyfish-agent.js';

test('TinyFish Agent - Key Validation', () => {
  assert.equal(validateTinyFishKey(''), false);
  assert.equal(validateTinyFishKey('short'), false);
  assert.equal(validateTinyFishKey(null), false);
  assert.equal(validateTinyFishKey(undefined), false);
  assert.equal(validateTinyFishKey('tf-live-valid-api-key-12345'), true);
});

test('TinyFish Agent - Emits events and parses SSE stream to completion', async () => {
  const events = [];
  const agent = new TinyFishAgent({
    apiKey: 'tf-test-key-1234567890',
    onEvent: (evt) => events.push(evt)
  });

  const sseBody = [
    'data: {"type":"STARTED","run_id":"run_abc123"}\n\n',
    'data: {"type":"STREAMING_URL","streaming_url":"https://stream.tinyfish.ai/run_abc123"}\n\n',
    'data: {"type":"PROGRESS","purpose":"Navigating to target site"}\n\n',
    'data: {"type":"PROGRESS","purpose":"Checking incoming response"}\n\n',
    'data: {"type":"COMPLETE","status":"COMPLETED","run_id":"run_abc123","result":{"reply":"Meeting confirmed for 3pm"}}\n\n'
  ].join('');

  // Mock global fetch for this test
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.ok(url.includes('/automation/run-sse'));
    assert.equal(opts.headers['X-API-Key'], 'tf-test-key-1234567890');
    return {
      ok: true,
      status: 200,
      body: {
        getReader() {
          let consumed = false;
          return {
            async read() {
              if (consumed) return { done: true, value: undefined };
              consumed = true;
              return { done: false, value: new TextEncoder().encode(sseBody) };
            },
            releaseLock() {}
          };
        }
      }
    };
  };

  try {
    const result = await agent.run('Check email for reply', { url: 'https://mail.google.com' });
    assert.equal(result.success, true);
    assert.equal(result.runId, 'run_abc123');
    assert.ok(result.summary.includes('Meeting confirmed for 3pm'));
    assert.ok(events.length >= 4);
    assert.ok(events.some(e => e.text && e.text.includes('run_abc123')));
    assert.ok(events.some(e => e.streamingUrl));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TinyFish Agent - Instant Cancel stops processing', async () => {
  const agent = new TinyFishAgent({
    apiKey: 'tf-test-key-1234567890'
  });

  let cancelledRunId = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url.includes('/cancel')) {
      cancelledRunId = url.split('/runs/')[1]?.split('/cancel')[0];
      return { ok: true, status: 200 };
    }
    // Simulate slow stream
    return {
      ok: true,
      status: 200,
      body: {
        getReader() {
          return {
            async read() {
              await new Promise(r => setTimeout(r, 100));
              return { done: false, value: new TextEncoder().encode('data: {"type":"STARTED","run_id":"run_to_cancel"}\n\n') };
            },
            releaseLock() {}
          };
        }
      }
    };
  };

  try {
    const runPromise = agent.run('Some long task', { url: 'https://example.com' });
    // Cancel quickly
    setTimeout(() => agent.cancel(), 20);
    const result = await runPromise;
    assert.equal(result.success, false);
    assert.ok(result.summary.includes('cancelled'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
