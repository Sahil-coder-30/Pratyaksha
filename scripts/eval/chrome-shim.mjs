/**
 * Minimal chrome.* extension API shim backed by puppeteer.
 *
 * Covers what src/browser/* and src/runner.js call: tabs (get, query, update,
 * goBack, goForward, sendMessage, captureVisibleTab, onUpdated), windows.getCurrent,
 * scripting (executeScript, insertCSS) and runtime.lastError.
 *
 * Content scripts (src/browser/dom-actions.js + content-main.js) are injected
 * into the page's main world, with a page-local chrome.runtime.onMessage shim.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_PRELUDE = `(() => {
  if (window.__pratyakshaDispatch) return;
  const listeners = [];
  window.__pratyakshaChromeShim = { runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } } };
  window.__pratyakshaDispatch = (message) => new Promise((resolve) => {
    let done = false;
    const send = (r) => { if (!done) { done = true; resolve(r === undefined ? null : r); } };
    for (const fn of listeners) {
      try { fn(message, { id: 'pratyaksha-eval' }, send); } catch (err) { send({ success: false, error: String(err && err.message || err) }); }
    }
    setTimeout(() => send(undefined), 60000);
  });
})();`;

const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';
const CHANNEL_CLOSED = 'The message channel closed before a response was received.';

export function createChromeShim(browser, { srcDir }) {
  const domActionsSrc = readFileSync(join(srcDir, 'browser/dom-actions.js'), 'utf8');
  const contentMainSrc = readFileSync(join(srcDir, 'browser/content-main.js'), 'utf8');
  const contentScript = `${PAGE_PRELUDE}\n${domActionsSrc}\n;(function (chrome) {\n${contentMainSrc}\n})(window.__pratyakshaChromeShim);`;

  const pageToId = new Map();
  const idToPage = new Map();
  const updateListeners = new Set();
  let nextId = 1;
  let activeId = null;
  let lastError = null;

  const fireUpdated = (id, info) => {
    const page = idToPage.get(id);
    const tab = { id, url: page?.url() || '', status: info.status };
    for (const fn of [...updateListeners]) {
      try { fn(id, info, tab); } catch (_) {}
    }
  };

  function register(page) {
    if (pageToId.has(page)) return pageToId.get(page);
    const id = nextId++;
    pageToId.set(page, id);
    idToPage.set(id, page);
    page.setBypassCSP(true).catch(() => {});
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) fireUpdated(id, { status: 'loading', url: frame.url() });
    });
    page.on('load', () => fireUpdated(id, { status: 'complete' }));
    page.on('close', () => {
      pageToId.delete(page);
      idToPage.delete(id);
      if (activeId === id) activeId = null;
    });
    return id;
  }

  // Pages opened by the site (target=_blank, window.open) become new tabs
  browser.on('targetcreated', async (target) => {
    if (target.type() !== 'page') return;
    const page = await target.page().catch(() => null);
    if (page) {
      const id = register(page);
      activeId = id;
    }
  });

  function pageOf(tabId) {
    const page = idToPage.get(tabId);
    if (!page) throw new Error(`No tab with id: ${tabId}.`);
    return page;
  }

  async function tabInfo(id) {
    const page = pageOf(id);
    let title = '';
    try { title = await page.title(); } catch (_) {}
    return { id, windowId: 1, url: page.url(), title, active: id === activeId, status: 'complete' };
  }

  function withLastError(message, cb, value) {
    lastError = message ? { message } : null;
    try { cb?.(value); } finally { lastError = null; }
  }

  async function dispatch(page, message) {
    const ready = await page.evaluate(() => typeof window.__pratyakshaDispatch === 'function');
    if (!ready) throw new Error(NO_RECEIVER);
    return page.evaluate((m) => window.__pratyakshaDispatch(m), message);
  }

  const chromeApi = {
    runtime: {
      id: undefined,
      get lastError() { return lastError; }
    },
    windows: {
      async getCurrent() { return { id: 1, focused: true }; }
    },
    tabs: {
      onUpdated: {
        addListener(fn) { updateListeners.add(fn); },
        removeListener(fn) { updateListeners.delete(fn); }
      },
      async get(tabId) { return tabInfo(tabId); },
      async query() { return Promise.all([...idToPage.keys()].map(tabInfo)); },
      async update(tabId, props = {}) {
        const page = pageOf(tabId);
        if (props.active) {
          activeId = tabId;
          await page.bringToFront().catch(() => {});
        }
        // Like Chrome, resolve before the load finishes; callers wait on onUpdated
        if (props.url) page.goto(props.url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
        return tabInfo(tabId);
      },
      async goBack(tabId) { await pageOf(tabId).goBack({ timeout: 15000 }).catch(() => {}); },
      async goForward(tabId) { await pageOf(tabId).goForward({ timeout: 15000 }).catch(() => {}); },
      async captureVisibleTab() {
        const page = idToPage.get(activeId);
        if (!page) throw new Error('No active tab to capture');
        const b64 = await page.screenshot({ encoding: 'base64', type: 'png' });
        return `data:image/png;base64,${b64}`;
      },
      sendMessage(tabId, message, cb) {
        let page;
        try { page = pageOf(tabId); } catch (err) { setTimeout(() => withLastError(err.message, cb), 0); return; }
        dispatch(page, message).then(
          (resp) => withLastError(null, cb, resp),
          (err) => {
            const msg = String(err?.message || err);
            const closed = /Execution context was destroyed|Target closed|detached|navigat/i.test(msg);
            withLastError(closed ? CHANNEL_CLOSED : (msg.includes(NO_RECEIVER) ? NO_RECEIVER : msg), cb);
          }
        );
      }
    },
    scripting: {
      async executeScript({ target }) {
        await pageOf(target.tabId).evaluate(contentScript);
        return [{ result: true }];
      },
      async insertCSS() {
        // Highlight styling is cosmetic; skipped in headless evaluation
      }
    }
  };

  return {
    chromeApi,
    register,
    setActive(id) { activeId = id; },
    pageOf
  };
}
