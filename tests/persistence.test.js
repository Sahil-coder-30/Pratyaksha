/**
 * PRATYAKSHA Test Suite: Checkpointing & Thread Persistence
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ChromeStorageSaver } from '../src/persistence/checkpointer.js';
import { ThreadStore } from '../src/persistence/thread-store.js';
import { createMockChrome } from './helpers/mock-chrome.js';

function createMockStorage(initialData = {}) {
  const store = { ...initialData };
  return {
    _data: store,
    get(keys, cb) {
      const res = {};
      for (const k of keys) {
        if (k in store) res[k] = store[k];
      }
      cb(res);
    },
    set(obj, cb) {
      Object.assign(store, obj);
      if (cb) cb();
    }
  };
}

test('ChromeStorageSaver - Checkpoint Persistence & Secret Scrubbing', async () => {
  const mockStorage = createMockStorage();
  const saver = new ChromeStorageSaver({ storage: mockStorage });

  const config = { configurable: { thread_id: 't_123', checkpoint_ns: '' } };
  const checkpoint = {
    v: 1,
    id: 'cp_1',
    ts: '2026-10-12',
    channel_values: {
      task: 'Research AI papers',
      apiKey: 'secret_mistral_api_key_12345',
      stepCount: 2
    },
    channel_versions: {},
    versions_seen: {}
  };

  await saver.put(config, checkpoint, {}, {});

  // Verify memory has the checkpoint
  const retrieved = await saver.get(config);
  assert.ok(retrieved);
  assert.equal(retrieved.channel_values.task, 'Research AI papers');
  assert.equal(retrieved.channel_values.stepCount, 2);

  // Verify apiKey was scrubbed before persisting
  assert.equal(retrieved.channel_values.apiKey, undefined);

  // Verify data was flushed to storage
  assert.ok(mockStorage._data.pratyaksha_checkpoints);
});

test('ChromeStorageSaver - Hydration from Prior Storage', async () => {
  const mockStorage = createMockStorage();
  const saver1 = new ChromeStorageSaver({ storage: mockStorage });

  const config = { configurable: { thread_id: 'thread_persist', checkpoint_ns: '' } };
  const checkpoint = {
    v: 1,
    id: 'cp_persist',
    ts: '2026-10-12',
    channel_values: { task: 'Persistent Task' },
    channel_versions: {},
    versions_seen: {}
  };

  await saver1.put(config, checkpoint, {}, {});

  // Instantiate new saver from same storage
  const saver2 = new ChromeStorageSaver({ storage: mockStorage });
  await saver2.hydrate();

  const retrieved = await saver2.get(config);
  assert.ok(retrieved);
  assert.equal(retrieved.channel_values.task, 'Persistent Task');
});

test('ThreadStore - CRUD & Tab Resumability Validation', async () => {
  const mockStorage = createMockStorage();
  const threadStore = new ThreadStore({ storage: mockStorage });

  // Create thread
  const thread = await threadStore.createThread({
    threadId: 'th_abc',
    taskId: 'task_001',
    task: 'Search flight tickets',
    tabId: 1
  });

  assert.equal(thread.threadId, 'th_abc');
  assert.equal(threadStore.getThread('th_abc').task, 'Search flight tickets');

  // Validate resumability when tab is active
  const chromeApi = createMockChrome({
    tabs: [{ id: 1, windowId: 1, url: 'https://flights.com', title: 'Flights' }]
  });

  const validResume = await threadStore.validateResumability('th_abc', chromeApi);
  assert.equal(validResume.canResume, true);

  // Validate failure when tab is closed
  const deadChromeApi = createMockChrome({ tabs: [] });
  const invalidResume = await threadStore.validateResumability('th_abc', deadChromeApi);
  assert.equal(invalidResume.canResume, false);
  assert.ok(invalidResume.reason.includes('no longer open'));
});
