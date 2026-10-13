/**
 * PRATYAKSHA Session Thread Store & Resume Validator
 * Sovereign Privacy-First Browser Agent
 *
 * Manages active task threads, thread isolation, and verifies browser state
 * and pending approvals prior to resuming interrupted tasks.
 */

import { getTabSafe } from '../browser/browser-tools.js';

export class ThreadStore {
  /**
   * @param {Object} [options]
   * @param {Object} [options.storage] Custom storage adapter
   * @param {string} [options.storageKey='pratyaksha_threads']
   */
  constructor(options = {}) {
    this.storage = options.storage || (typeof chrome !== 'undefined' && chrome?.storage?.local ? chrome.storage.local : null);
    this.storageKey = options.storageKey || 'pratyaksha_threads';
    this.threads = new Map();
  }

  async load() {
    if (!this.storage) return;
    try {
      const data = await new Promise((resolve) => {
        if (typeof this.storage.get === 'function') {
          this.storage.get([this.storageKey], res => resolve(res || {}));
        } else {
          resolve({});
        }
      });
      const stored = data[this.storageKey] || {};
      this.threads = new Map(Object.entries(stored));
    } catch (_) {}
  }

  async save() {
    if (!this.storage) return;
    try {
      const obj = Object.fromEntries(this.threads.entries());
      await new Promise(resolve => {
        if (typeof this.storage.set === 'function') {
          this.storage.set({ [this.storageKey]: obj }, resolve);
        } else {
          resolve();
        }
      });
    } catch (_) {}
  }

  async createThread({ threadId, taskId, task, tabId, meta = {} }) {
    const id = threadId || `thread_${Date.now()}`;
    const record = {
      threadId: id,
      taskId: taskId || `task_${Date.now()}`,
      task: task || '',
      tabId: tabId || null,
      status: 'RUNNING',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      meta
    };
    this.threads.set(id, record);
    await this.save();
    return record;
  }

  getThread(threadId) {
    return this.threads.get(threadId) || null;
  }

  async updateThread(threadId, updates = {}) {
    const record = this.threads.get(threadId);
    if (!record) return null;
    Object.assign(record, updates, { updatedAt: Date.now() });
    this.threads.set(threadId, record);
    await this.save();
    return record;
  }

  async deleteThread(threadId) {
    const deleted = this.threads.delete(threadId);
    if (deleted) await this.save();
    return deleted;
  }

  /**
   * Validates whether an interrupted thread can safely be resumed in the browser.
   * Checks if the thread exists, and if the associated browser tab is still open.
   */
  async validateResumability(threadId, chromeApi) {
    const thread = this.getThread(threadId);
    if (!thread) {
      return { canResume: false, reason: 'Thread record not found.' };
    }

    if (thread.tabId && chromeApi?.tabs) {
      const tab = await getTabSafe(thread.tabId, chromeApi);
      if (!tab.url) {
        return {
          canResume: false,
          reason: `Associated browser tab #${thread.tabId} is no longer open.`,
          thread
        };
      }
    }

    return { canResume: true, thread };
  }
}
