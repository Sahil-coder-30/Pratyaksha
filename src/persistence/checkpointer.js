/**
 * PRATYAKSHA Chrome Storage Checkpointer for LangGraph
 * Sovereign Privacy-First Browser Agent
 *
 * Implements persistent checkpointing across Chrome MV3 service worker terminations
 * and browser restarts using chrome.storage.local.
 * Automatically scrubs secrets prior to serialization and enforces thread isolation.
 */

import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { cleanStateForCheckpoint } from '../safety/privacy.js';

function safeSerializeForChrome(obj) {
  try {
    const seen = new WeakSet();
    const jsonStr = JSON.stringify(obj, (key, value) => {
      if (typeof value === 'function' || typeof value === 'symbol') {
        return undefined;
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (value instanceof Uint8Array || (value && value.constructor && value.constructor.name === 'Uint8Array')) {
        return { __type: 'Uint8Array', __data: Array.from(value) };
      }
      if (value instanceof Map) {
        return Object.fromEntries(value.entries());
      }
      if (value instanceof Set) {
        return Array.from(value);
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return undefined; // Break circular reference
        }
        seen.add(value);
      }
      return value;
    });
    return jsonStr ? JSON.parse(jsonStr) : {};
  } catch (e) {
    return {};
  }
}

function safeDeserializeFromChrome(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(safeDeserializeFromChrome);
  }

  if (value.__type === 'Uint8Array' && Array.isArray(value.__data)) {
    return new Uint8Array(value.__data);
  }

  const result = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = safeDeserializeFromChrome(v);
  }
  return result;
}

export class ChromeStorageSaver extends MemorySaver {
  /**
   * @param {Object} [options]
   * @param {Object} [options.storage] Custom storage adapter (defaults to chrome.storage.local)
   * @param {string} [options.storageKey='pratyaksha_checkpoints']
   */
  constructor(options = {}) {
    super();
    this.persistentStorage = options.storage || (typeof chrome !== 'undefined' && chrome?.storage?.local ? chrome.storage.local : null);
    this.storageKey = options.storageKey || 'pratyaksha_checkpoints';
    this.isHydrated = false;
  }

  /**
   * Loads existing persisted checkpoints from storage into memory.
   */
  async hydrate() {
    if (!this.persistentStorage) {
      this.isHydrated = true;
      return;
    }

    try {
      const data = await new Promise((resolve) => {
        if (typeof this.persistentStorage.get === 'function') {
          this.persistentStorage.get([this.storageKey], (res) => resolve(res || {}));
        } else {
          resolve({});
        }
      });

      const rawSerialized = data[this.storageKey];
      const serialized = rawSerialized ? safeDeserializeFromChrome(rawSerialized) : null;
      if (serialized && typeof serialized === 'object') {
        if (serialized.storage && typeof serialized.storage === 'object') {
          for (const [threadId, checkpoints] of Object.entries(serialized.storage)) {
            this.storage[threadId] = checkpoints;
          }
        }
        if (serialized.writes && typeof serialized.writes === 'object') {
          for (const [threadId, writes] of Object.entries(serialized.writes)) {
            this.writes[threadId] = writes;
          }
        }
      }
    } catch (err) {
      console.warn('[PRATYAKSHA Checkpointer] Hydration warning:', err.message);
    } finally {
      this.isHydrated = true;
    }
  }

  /**
   * Persists current memory checkpoints to storage.
   */
  async flush() {
    if (!this.persistentStorage) return;

    try {
      const safeStorage = safeSerializeForChrome(this.storage || {});
      const safeWrites = safeSerializeForChrome(this.writes || {});

      const payload = {
        [this.storageKey]: {
          storage: safeStorage,
          writes: safeWrites,
          savedAt: Date.now()
        }
      };

      await new Promise((resolve) => {
        if (typeof this.persistentStorage.set === 'function') {
          this.persistentStorage.set(payload, () => {
            // Consume runtime.lastError to prevent Unchecked runtime.lastError warnings
            if (typeof chrome !== 'undefined' && chrome?.runtime?.lastError) {
              // Safely consumed
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.warn('[PRATYAKSHA Checkpointer] Flush error:', err.message);
    }
  }

  /**
   * Puts a checkpoint into memory and flushes to chrome.storage.local.
   */
  async put(config, checkpoint, metadata, newVersions) {
    // Scrub secrets from checkpoint channel values before saving
    if (checkpoint?.channel_values && typeof checkpoint.channel_values === 'object') {
      checkpoint.channel_values = cleanStateForCheckpoint(checkpoint.channel_values);
    }

    const result = await super.put(config, checkpoint, metadata, newVersions);
    await this.flush();
    return result;
  }

  /**
   * Puts writes into memory and flushes to chrome.storage.local.
   */
  async putWrites(config, writes, taskId) {
    const result = await super.putWrites(config, writes, taskId);
    await this.flush();
    return result;
  }

  /**
   * Deletes a thread and flushes.
   */
  async deleteThread(threadId) {
    if (typeof super.deleteThread === 'function') {
      await super.deleteThread(threadId);
    }
    await this.flush();
  }
}
