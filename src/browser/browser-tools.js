/**
 * PRATYAKSHA Hardened Browser Execution Layer
 * Sovereign Privacy-First Browser Agent
 *
 * Dispatches browser operations to Chrome Extension APIs and content scripts.
 * Implements strict navigation semantics, message-channel verification,
 * structured tool result contracts, and cancellation signal handling.
 */

import { TOOL_NAMES, FORBIDDEN_URL_PROTOCOLS } from '../shared/constants.js';
import {
  PratyakshaError,
  ToolExecutionError,
  ChannelClosedError,
  NavigationTimeoutError,
  PolicyViolationError
} from '../shared/errors.js';
import {
  validateToolArgs,
  normalizeToolInvocation,
  createToolResult,
  createToolError
} from '../shared/schemas.js';

let _lastScreenshot = null;
export function getLastScreenshot() { return _lastScreenshot; }
export function setLastScreenshot(s) { _lastScreenshot = s; }

/**
 * Checks whether a given URL is forbidden under extension security policy.
 */
export function isForbiddenUrl(url) {
  if (!url || typeof url !== 'string') return true;
  try {
    const parsed = new URL(url);
    return FORBIDDEN_URL_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Checks whether the current URL represents an active protected workspace application
 * (such as WhatsApp, Gmail, Slack, Discord, etc.) where navigating the tab would destroy
 * the live session, clear message forms, and disrupt chat sockets.
 */
export function isProtectedWorkspace(url = '') {
  if (!url || typeof url !== 'string') return false;
  return /(?:web\.whatsapp\.com|mail\.google\.com|slack\.com|discord\.com|teams\.microsoft\.com)/i.test(url);
}

const TINYFISH_API_BASE = 'https://agent.tinyfish.ai/v1';

/**
 * Executes an isolated web search/research task via the TinyFish Cloud Browser Agent.
 * This runs completely in an isolated cloud sandbox, leaving the local tab/session 100% undisturbed.
 *
 * @param {Object} args { query: string, goal?: string }
 * @param {Object} activeTab Current browser tab
 * @param {Object} [options]
 * @returns {Promise<Object>} ToolResult
 */
export async function executeTinyFishResearch(args = {}, activeTab = {}, options = {}) {
  const query = (args.query || '').trim();
  if (!query) {
    throw new ToolExecutionError('Search query is required for tinyfish_research', { toolName: TOOL_NAMES.TINYFISH_RESEARCH });
  }

  // Retrieve API Key with cascading fallbacks
  let apiKey = options.tinyfishApiKey || options.apiKey;
  if (!apiKey && typeof chrome !== 'undefined' && chrome?.storage?.local) {
    try {
      const stored = await chrome.storage.local.get(['tinyfishApiKey']);
      apiKey = stored?.tinyfishApiKey;
    } catch (_) {}
  }
  if (!apiKey && typeof process !== 'undefined' && process.env?.TINYFISH_API_KEY) {
    apiKey = process.env.TINYFISH_API_KEY;
  }
  if (!apiKey && typeof globalThis !== 'undefined' && globalThis.ENV?.TINYFISH_API_KEY) {
    apiKey = globalThis.ENV.TINYFISH_API_KEY;
  }
  if (!apiKey) {
    apiKey = 'sk-tinyfish-S4PTJp3U71cpkZ-QdWjQ4t9eY_gxxJHJ';
  }

  const researchGoal = args.goal || `Find accurate, concise factual information to answer: "${query}". Return a clear direct summary.`;

  const chromeApi = options.chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
  const currentTab = await getTabSafe(activeTab?.id, chromeApi);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const res = await fetch(`${TINYFISH_API_BASE}/automation/run`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: 'https://www.google.com',
        goal: researchGoal
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`TinyFish API returned status ${res.status}: ${errText || res.statusText}`);
    }

    const data = await res.json();
    let resultText = '';
    if (data.status === 'COMPLETED' && data.result != null) {
      resultText = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
    } else if (data.status === 'FAILED') {
      throw new Error(data.error?.message || `TinyFish automation failed with status ${data.status}`);
    } else {
      resultText = JSON.stringify(data.result || data);
    }

    const tabUrl = activeTab?.url || currentTab?.url || '';
    return createToolResult({
      toolName: TOOL_NAMES.TINYFISH_RESEARCH,
      observation: `[TinyFish Isolated Cloud Research Result]:\nQuery: "${query}"\nAnswer:\n${resultText}\n\n(Note: Your active tab remains untouched on "${tabUrl || 'current workspace'}". The chat/workspace session is preserved. Use this factual information to answer the user directly in chat.)`,
      page: { ...currentTab, url: tabUrl || currentTab.url },
      metadata: {
        query,
        source: 'tinyfish',
        steps: data.num_of_steps,
        isolated: true
      }
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ToolExecutionError(`TinyFish research timed out for query: "${query}"`, { toolName: TOOL_NAMES.TINYFISH_RESEARCH });
    }
    throw new ToolExecutionError(`TinyFish research error: ${err.message}`, { toolName: TOOL_NAMES.TINYFISH_RESEARCH, details: err });
  }
}

/**
 * Executes a browser operation against the active tab.
 *
 * @param {string} toolName
 * @param {Object} rawArgs
 * @param {Object} activeTab { id, url, title, ... }
 * @param {Object} [options]
 * @param {Object} [options.vault]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.chromeApi] optional custom Chrome API object for tests
 * @returns {Promise<Object>} Standard ToolResult contract
 */
export async function executeBrowserTool(toolName, rawArgs = {}, activeTab, options = {}) {
  const normalized = normalizeToolInvocation(toolName, rawArgs);
  toolName = normalized.toolName;
  rawArgs = normalized.args;

  const chromeApi = options.chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
  const signal = options.signal;
  const vault = options.vault;

  if (signal?.aborted) {
    throw new PratyakshaError('Operation aborted by user', { code: 'CANCELLED', recoverable: false });
  }

  if (!activeTab?.id) {
    return createToolError({
      toolName,
      error: new ToolExecutionError('No active browser tab connected', { toolName }),
      page: activeTab || {},
      recoverable: false
    });
  }

  const tabId = activeTab.id;

  // 1. Validate arguments against authoritative schema
  let args;
  try {
    args = validateToolArgs(toolName, rawArgs);
  } catch (err) {
    return createToolError({
      toolName,
      error: new ToolExecutionError(`Invalid tool arguments: ${err.message}`, { toolName, details: err }),
      page: activeTab,
      recoverable: true
    });
  }

  try {
    switch (toolName) {

      // ── search_web ──────────────────────────────────────────────────────────
      case TOOL_NAMES.SEARCH_WEB: {
        const q = args.query.trim();

        // Protected Workspace Interception:
        // If the agent is on WhatsApp Web, Gmail, Slack, etc., navigating the active tab
        // drops the live chat session and corrupts DOM context.
        // We automatically route through TinyFish isolated cloud research!
        const currentTabBefore = await getTabSafe(tabId, chromeApi);
        const activeUrl = isProtectedWorkspace(activeTab?.url) ? activeTab.url : (currentTabBefore?.url || activeTab?.url || '');
        if (isProtectedWorkspace(activeUrl)) {
          const research = await executeTinyFishResearch({
            query: q,
            goal: `Search and extract concise factual answer for: "${q}"`
          }, activeTab, options);

          return createToolResult({
            toolName: TOOL_NAMES.SEARCH_WEB,
            observation: `[Protected Workspace Interception: Active tab is on ${activeUrl}. Query was processed in an isolated TinyFish sandbox to keep your active chat/workspace DOM completely intact!]\n\n${research.observation}`,
            page: { ...currentTabBefore, url: activeUrl },
            metadata: { query: q, autoRoutedToTinyFish: true, protectedWorkspaceUrl: activeUrl }
          });
        }

        const engines = {
          google:     `https://www.google.com/search?q=${encodeURIComponent(q)}`,
          bing:       `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
          duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
        };
        const url = engines[args.engine] || engines.google;

        await chromeApi.tabs.update(tabId, { url });
        await waitForTabLoad(tabId, 15000, chromeApi, signal);
        await sleepMs(150, signal);
        await ensureContentScript(tabId, chromeApi);

        const textResp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { action: 'READ_PAGE', selector: null, maxChars: 5000 }
        }, 10000, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        const text = textResp?.result || '(empty)';

        return createToolResult({
          toolName,
          observation: `Search results for "${q}" on ${args.engine || 'google'}:\n${text}`,
          page: currentTab,
          metadata: { query: q, engine: args.engine || 'google' }
        });
      }

      // ── open_url ────────────────────────────────────────────────────────────
      case TOOL_NAMES.OPEN_URL: {
        let url = args.url.trim();
        // Only prepend https:// if no URI scheme is present
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(url)) {
          url = `https://${url}`;
        }

        if (isForbiddenUrl(url)) {
          throw new PolicyViolationError(`Navigation to internal/restricted URL "${url}" is blocked.`, { policy: 'URL_POLICY' });
        }

        const currentTabBefore = await getTabSafe(tabId, chromeApi);
        if (isProtectedWorkspace(currentTabBefore?.url || activeTab?.url) &&
            !/web\.whatsapp\.com|mail\.google\.com/i.test(url) &&
            /google\.com|bing\.com|duckduckgo\.com|wikipedia\.org/i.test(url)) {
          const research = await executeTinyFishResearch({
            query: url,
            goal: `Extract relevant facts or answers from ${url}`
          }, activeTab, options);

          return createToolResult({
            toolName: TOOL_NAMES.OPEN_URL,
            observation: `[Protected Workspace Interception: Active tab is on ${currentTabBefore?.url || activeTab?.url}. External lookup "${url}" was isolated via TinyFish cloud sandbox to protect the active chat session!]\n\n${research.observation}`,
            page: currentTabBefore,
            metadata: { requestedUrl: url, autoRoutedToTinyFish: true }
          });
        }

        await chromeApi.tabs.update(tabId, { url });
        await waitForTabLoad(tabId, 15000, chromeApi, signal);
        await sleepMs(150, signal);
        await ensureContentScript(tabId, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        return createToolResult({
          toolName,
          observation: `Opened: ${url}${args.rationale ? ` (${args.rationale})` : ''}`,
          page: currentTab,
          metadata: { requestedUrl: url }
        });
      }

      // ── go_back ─────────────────────────────────────────────────────────────
      case TOOL_NAMES.GO_BACK: {
        await chromeApi.tabs.goBack(tabId).catch(() => {});
        await waitForTabLoad(tabId, 10000, chromeApi, signal);
        await sleepMs(100, signal);
        await ensureContentScript(tabId, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        return createToolResult({
          toolName,
          observation: `Navigated back. Now on: ${currentTab.url || 'previous page'}`,
          page: currentTab
        });
      }

      // ── go_forward ──────────────────────────────────────────────────────────
      case TOOL_NAMES.GO_FORWARD: {
        await chromeApi.tabs.goForward(tabId).catch(() => {});
        await waitForTabLoad(tabId, 10000, chromeApi, signal);
        await sleepMs(100, signal);
        await ensureContentScript(tabId, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        return createToolResult({
          toolName,
          observation: `Navigated forward. Now on: ${currentTab.url || 'next page'}`,
          page: currentTab
        });
      }

      // ── switch_tab ──────────────────────────────────────────────────────────
      case TOOL_NAMES.SWITCH_TAB: {
        const win = await chromeApi.windows.getCurrent();
        const tabs = await chromeApi.tabs.query({ windowId: win.id });

        let target = null;
        if (args.tab_index !== undefined && tabs[args.tab_index]) {
          target = tabs[args.tab_index];
        } else if (args.title_contains) {
          const kw = args.title_contains.toLowerCase();
          target = tabs.find(t => (t.title || '').toLowerCase().includes(kw));
        } else if (args.url_contains) {
          const kw = args.url_contains.toLowerCase();
          target = tabs.find(t => (t.url || '').toLowerCase().includes(kw));
        }

        if (!target) {
          throw new ToolExecutionError(`No matching tab found for criteria: ${JSON.stringify(args)}`, { toolName });
        }

        await chromeApi.tabs.update(target.id, { active: true });
        await sleepMs(100, signal);
        await ensureContentScript(target.id, chromeApi);

        const newTab = await getTabSafe(target.id, chromeApi);
        return createToolResult({
          toolName,
          observation: `Switched to tab: "${newTab.title}" — ${newTab.url}`,
          page: newTab,
          newTabId: newTab.id
        });
      }

      // ── read_page ───────────────────────────────────────────────────────────
      case TOOL_NAMES.READ_PAGE: {
        const maxChars = Math.min(args.max_chars || 4000, 8000);
        const resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { action: 'READ_PAGE', selector: args.selector || null, maxChars }
        }, 8000, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        const text = resp?.result || '(no content)';
        return createToolResult({
          toolName,
          observation: `URL: ${currentTab.url}\nTitle: ${currentTab.title}\n\n${text}`,
          page: currentTab,
          metadata: { length: text.length, truncated: text.length >= maxChars }
        });
      }

      // ── get_page_metadata ───────────────────────────────────────────────────
      case TOOL_NAMES.GET_PAGE_METADATA: {
        const resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { action: 'GET_METADATA' }
        }, 8000, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        const meta = resp?.result || {};
        return createToolResult({
          toolName,
          observation: `Page Metadata:\n${JSON.stringify(meta, null, 2)}`,
          page: currentTab,
          metadata: meta
        });
      }

      // ── get_links ───────────────────────────────────────────────────────────
      case TOOL_NAMES.GET_LINKS: {
        const resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { action: 'GET_LINKS', filter: args.filter || '', max: args.max || 25 }
        }, 8000, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        const links = resp?.result || [];
        if (!links.length) {
          return createToolResult({
            toolName,
            observation: 'No links found matching filter.',
            page: currentTab,
            metadata: { count: 0 }
          });
        }
        const formatted = links.map((l, i) => `[${i + 1}] "${l.text}" → ${l.url}`).join('\n');
        return createToolResult({
          toolName,
          observation: `Found ${links.length} link(s):\n${formatted}`,
          page: currentTab,
          metadata: { count: links.length }
        });
      }

      // ── find_on_page ────────────────────────────────────────────────────────
      case TOOL_NAMES.FIND_ON_PAGE: {
        const resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { action: 'FIND_ON_PAGE', text: args.text, caseSensitive: !!args.case_sensitive }
        }, 8000, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        const r = resp?.result || {};
        if (!r.found) {
          return createToolResult({
            toolName,
            observation: `"${args.text}" was NOT found on this page.`,
            page: currentTab,
            metadata: { found: false, count: 0 }
          });
        }
        return createToolResult({
          toolName,
          observation: `Found ${r.count} match(es) for "${args.text}". Scrolled to first match.\nContext: ...${r.context}...`,
          page: currentTab,
          metadata: { found: true, count: r.count }
        });
      }

      // ── extract_structured ──────────────────────────────────────────────────
      case TOOL_NAMES.EXTRACT_STRUCTURED: {
        const resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: {
            action: 'EXTRACT_STRUCTURED',
            fields: args.fields,
            rootSelector: args.root_selector || null
          }
        }, 8000, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        const data = resp?.result || {};
        return createToolResult({
          toolName,
          observation: `Extracted structured data:\n${JSON.stringify(data, null, 2)}`,
          page: currentTab,
          metadata: { fields: Object.keys(data) }
        });
      }

      // ── click_element ───────────────────────────────────────────────────────
      case TOOL_NAMES.CLICK_ELEMENT: {
        const targetId = args.target_id;
        const hint = args.semantic_hint || '';
        const initialTab = await getTabSafe(tabId, chromeApi);
        const isSendOrSubmit = /(^|\b)(send|submit|dispatch)\b/i.test(hint);
        const clickTimeout = isSendOrSubmit ? 45000 : 35000;

        let resp;
        try {
          resp = await sendToTab(tabId, {
            type: 'EXECUTE_ACTION',
            payload: { action: 'CLICK', target_id: targetId, semantic_hint: hint }
          }, clickTimeout, chromeApi);
        } catch (err) {
          // If channel closed, verify whether navigation actually started
          if (err instanceof ChannelClosedError || err.message?.includes('message channel closed')) {
            await waitForTabLoad(tabId, 12000, chromeApi, signal);
            await sleepMs(200, signal);
            await ensureContentScript(tabId, chromeApi);

            const afterTab = await getTabSafe(tabId, chromeApi);
            const navigated = afterTab.url !== initialTab.url;
            return createToolResult({
              toolName,
              observation: navigated
                ? `Clicked [#${targetId || '?'}] "${hint}" — page navigated to ${afterTab.url}.`
                : `Clicked [#${targetId || '?'}] "${hint}" — channel closed, page refreshed.`,
              page: afterTab,
              metadata: { navigated, previousUrl: initialTab.url }
            });
          }
          throw err;
        }

        if (!resp?.success) {
          throw new ToolExecutionError(resp?.error || `Could not click [#${targetId || '?'}] "${hint}"`, { toolName });
        }

        let currentTab = await getTabSafe(tabId, chromeApi);
        const navigated = !!currentTab.url && currentTab.url !== initialTab.url;
        if (navigated) {
          await waitForTabLoad(tabId, 12000, chromeApi, signal);
          await ensureContentScript(tabId, chromeApi);
          currentTab = await getTabSafe(tabId, chromeApi);
        }
        const info = resp.result && typeof resp.result === 'object' ? resp.result : {};
        const what = info.clicked || `[#${targetId || '?'}] "${hint}"`;
        const change = navigated ? `page navigated to ${currentTab.url}` : (info.change || 'no URL change');
        const sendStatus = info.sendConfirmed ? ' (Email dispatched & Send confirmed in DOM)' : '';
        return createToolResult({
          toolName,
          observation: `Clicked ${what} — ${change}${sendStatus}.`,
          page: currentTab,
          metadata: { navigated, previousUrl: initialTab.url, target_id: targetId, sendConfirmed: !!info.sendConfirmed }
        });
      }

      // ── type_into_element ───────────────────────────────────────────────────
      case TOOL_NAMES.TYPE_INTO_ELEMENT: {
        const targetId = args.target_id;
        const hint = args.semantic_hint || '';
        let text = args.text;

        // Local privacy rehydration
        if (vault?.rehydrate) {
          text = vault.rehydrate(text) ?? text;
        }

        const initialTab = await getTabSafe(tabId, chromeApi);
        let resp;
        try {
          resp = await sendToTab(tabId, {
            type: 'EXECUTE_ACTION',
            payload: {
              action: 'TYPE',
              target_id: targetId,
              semantic_hint: hint,
              value: text,
              clear_first: args.clear_first !== false,
              press_enter: !!args.press_enter
            }
          }, 10000, chromeApi);
        } catch (err) {
          // Enter submitted a form and the page unloaded mid-response
          if (args.press_enter && (err instanceof ChannelClosedError || err.message?.includes('message channel closed'))) {
            resp = { success: true, result: {} };
          } else {
            throw err;
          }
        }

        if (!resp?.success) {
          throw new ToolExecutionError(resp?.error || `Could not type into [#${targetId || '?'}] "${hint}"`, { toolName });
        }

        let currentTab = await getTabSafe(tabId, chromeApi);
        const navigated = !!currentTab.url && currentTab.url !== initialTab.url;
        if (navigated) {
          await waitForTabLoad(tabId, 12000, chromeApi, signal);
          await ensureContentScript(tabId, chromeApi);
          currentTab = await getTabSafe(tabId, chromeApi);
        }
        const info = resp.result && typeof resp.result === 'object' ? resp.result : {};
        const desc = info.typedInto || (targetId ? `[#${targetId}]` : `"${hint}"`);
        // Read-back lets the model confirm the field really holds the text (scrubbed before it reaches the model)
        const valueNote = typeof info.value === 'string' ? ` Field now contains: "${info.value}".` : '';
        return createToolResult({
          toolName,
          observation: `Typed into ${desc}${args.press_enter ? ' + Enter' : ''}.${valueNote}${navigated ? ` Page navigated to ${currentTab.url}.` : ''}`,
          page: currentTab,
          metadata: { pressEnter: !!args.press_enter, navigated, target_id: targetId }
        });
      }

      // ── execute_js ──────────────────────────────────────────────────────────
      case TOOL_NAMES.EXECUTE_JS: {
        const currentTab = await getTabSafe(tabId, chromeApi);
        if (isForbiddenUrl(currentTab.url)) {
          throw new PolicyViolationError('Arbitrary execute_js is prohibited on internal browser pages.', { policy: 'ACTION_POLICY' });
        }

        const resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { action: 'EXECUTE_JS', code: args.code }
        }, 10000, chromeApi);

        const result = resp?.result;
        return createToolResult({
          toolName,
          observation: `JS executed${args.description ? ` (${args.description})` : ''}.\nResult: ${
            result === undefined ? '(no return value)' : JSON.stringify(result)
          }`,
          page: currentTab,
          metadata: { hasReturnValue: result !== undefined }
        });
      }

      // ── inspect_dom ─────────────────────────────────────────────────────────
      case TOOL_NAMES.INSPECT_DOM: {
        const resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: {
            action: 'INSPECT_DOM',
            target_id: args.target_id,
            selector: args.selector,
            semantic_hint: args.semantic_hint
          }
        }, 8000, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        const info = resp?.result;
        return createToolResult({
          toolName,
          observation: info ? `DOM Inspection:\n${JSON.stringify(info, null, 2)}` : 'Element not found for inspection.',
          page: currentTab,
          metadata: info || {}
        });
      }

      // ── screenshot ──────────────────────────────────────────────────────────
      case TOOL_NAMES.SCREENSHOT: {
        const win = await chromeApi.windows.getCurrent();
        const dataUrl = await chromeApi.tabs.captureVisibleTab(win.id, { format: 'png' });
        const currentTab = await getTabSafe(tabId, chromeApi);

        _lastScreenshot = { dataUrl, url: currentTab.url, title: currentTab.title, timestamp: Date.now() };
        const sizeKB = Math.round(dataUrl.length * 0.75 / 1024);

        return createToolResult({
          toolName,
          observation: `Screenshot captured (≈${sizeKB}KB PNG).\nPage: "${currentTab.title}"\nURL: ${currentTab.url}`,
          page: currentTab,
          screenshotDataUrl: dataUrl,
          metadata: { sizeKB }
        });
      }

      // ── scroll_page ─────────────────────────────────────────────────────────
      case TOOL_NAMES.SCROLL_PAGE: {
        const dir = args.direction;
        let deltaY;

        if (dir === 'top') deltaY = -999999;
        else if (dir === 'bottom') deltaY = 999999;
        else deltaY = (dir === 'up' ? -1 : 1) * (args.pixels || 600);

        const resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { action: 'SCROLL', deltaY, target_id: args.target_id }
        }, 5000, chromeApi);

        const currentTab = await getTabSafe(tabId, chromeApi);
        const info = resp?.result && typeof resp.result === 'object' ? resp.result : null;
        let observation = dir === 'top' || dir === 'bottom'
          ? `Scrolled to ${dir} of page.`
          : `Scrolled ${dir} ${Math.abs(deltaY)}px.`;
        if (info && info.scrolled === 0) {
          observation = `Scroll ${dir} had no effect (already at the ${dir === 'up' || dir === 'top' ? 'top' : 'bottom'} or nothing scrollable).`;
        }
        return createToolResult({
          toolName,
          observation,
          page: currentTab
        });
      }

      // ── select_option ───────────────────────────────────────────────────────
      case TOOL_NAMES.SELECT_OPTION: {
        const resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: {
            action: 'SELECT_OPTION',
            target_id: args.target_id,
            semantic_hint: args.semantic_hint,
            option: args.option
          }
        }, 8000, chromeApi);

        if (!resp?.success) {
          throw new ToolExecutionError(resp?.error || `Could not select "${args.option}"`, { toolName });
        }
        const currentTab = await getTabSafe(tabId, chromeApi);
        return createToolResult({
          toolName,
          observation: `Selected "${resp.result?.selected || args.option}" in [#${args.target_id || '?'}].`,
          page: currentTab,
          metadata: { target_id: args.target_id }
        });
      }

      // ── press_key ───────────────────────────────────────────────────────────
      case TOOL_NAMES.PRESS_KEY: {
        const initialTab = await getTabSafe(tabId, chromeApi);
        let resp;
        try {
          resp = await sendToTab(tabId, {
            type: 'EXECUTE_ACTION',
            payload: { action: 'PRESS_KEY', key: args.key, target_id: args.target_id }
          }, 5000, chromeApi);
        } catch (err) {
          if (err instanceof ChannelClosedError || err.message?.includes('message channel closed')) {
            resp = { success: true, result: {} };
          } else {
            throw err;
          }
        }
        if (!resp?.success) {
          throw new ToolExecutionError(resp?.error || `Could not press ${args.key}`, { toolName });
        }
        let currentTab = await getTabSafe(tabId, chromeApi);
        if (currentTab.url && currentTab.url !== initialTab.url) {
          await waitForTabLoad(tabId, 12000, chromeApi, signal);
          await ensureContentScript(tabId, chromeApi);
          currentTab = await getTabSafe(tabId, chromeApi);
        }
        const change = resp.result?.change;
        return createToolResult({
          toolName,
          observation: `Pressed ${args.key}${args.target_id ? ` on [#${args.target_id}]` : ''}${change ? ` — ${change}` : ''}.`,
          page: currentTab
        });
      }

      // ── wait_for ─────────────────────────────────────────────────────────────
      case TOOL_NAMES.WAIT_FOR: {
        const timeoutSeconds = Math.min(Math.max(args.timeout_seconds || 60, 1), 600);
        const timeoutMs = timeoutSeconds * 1000;
        const trackerId = `track_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const sliceMs = 3000;
        const startTime = Date.now();
        let lastReportedSec = 0;
        let found = false;
        let resultInfo = null;

        while (Date.now() - startTime < timeoutMs) {
          if (signal?.aborted) {
            return createToolResult({
              toolName,
              observation: 'wait_for aborted by user.',
              page: await getTabSafe(tabId, chromeApi),
              metadata: { met: false, aborted: true }
            });
          }

          let resp = null;
          try {
            resp = await sendToTab(tabId, {
              type: 'EXECUTE_ACTION',
              payload: {
                action: 'WAIT_FOR',
                trackerId,
                selector: args.selector || null,
                textContains: args.text_contains || null,
                waitForReply: args.wait_for_reply !== false && (!!args.wait_for_reply || (!args.selector && !args.text_contains)),
                trackDomChanges: !!args.track_dom_changes,
                expectedSender: args.expected_sender || null,
                timeoutMs: sliceMs
              }
            }, 15000, chromeApi);
          } catch (err) {
            if (err instanceof ChannelClosedError || err.message?.includes('message channel closed')) {
              await ensureContentScript(tabId, chromeApi);
            }
          }

          if (resp?.result?.found) {
            found = true;
            resultInfo = resp.result;
            break;
          }

          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          if (elapsedSec - lastReportedSec >= 15) {
            lastReportedSec = elapsedSec;
          }

          const remainingMs = timeoutMs - (Date.now() - startTime);
          if (remainingMs <= 0) break;
          await sleepMs(Math.min(sliceMs, remainingMs), signal);
        }

        const currentTab = await getTabSafe(tabId, chromeApi);
        if (!found) {
          return createToolResult({
            toolName,
            observation: `wait_for held process for ${timeoutSeconds}s — no incoming reply or matching condition detected in DOM.`,
            page: currentTab,
            metadata: { met: false }
          });
        }

        const detailMsg = resultInfo?.detail || 'incoming response received and verified in DOM';
        const contentSnippet = resultInfo?.newContent ? `\nResponse Content:\n${resultInfo.newContent}` : '';
        return createToolResult({
          toolName,
          observation: `Condition met: ${detailMsg}.${contentSnippet}`,
          page: currentTab,
          metadata: { met: true, detail: resultInfo?.detail, newContent: resultInfo?.newContent }
        });
      }

      // ── wait_seconds ─────────────────────────────────────────────────────────
      case TOOL_NAMES.WAIT_SECONDS: {
        const totalMs = Math.min(Math.max(args.seconds * 1000, 500), 300000);
        const start = Date.now();
        while (Date.now() - start < totalMs) {
          if (signal?.aborted) break;
          const chunk = Math.min(1000, totalMs - (Date.now() - start));
          await sleepMs(chunk, signal);
        }
        const currentTab = await getTabSafe(tabId, chromeApi);
        return createToolResult({
          toolName,
          observation: `Waited ${(Date.now() - start) / 1000}s${args.reason ? ` (${args.reason})` : ''}.`,
          page: currentTab
        });
      }

      // ── finish_task ──────────────────────────────────────────────────────────
      case TOOL_NAMES.FINISH_TASK: {
        try {
          await sendToTab(tabId, { type: 'CLEAR_HIGHLIGHT' }, 2000, chromeApi);
        } catch (_) {}
        const currentTab = await getTabSafe(tabId, chromeApi);
        return createToolResult({
          toolName,
          observation: `Task finished: ${args.summary}`,
          page: currentTab,
          isFinished: true,
          success: args.success,
          summary: args.summary
        });
      }

      // ── tinyfish_research ───────────────────────────────────────────────────
      case TOOL_NAMES.TINYFISH_RESEARCH: {
        return await executeTinyFishResearch(args, activeTab, options);
      }

      default:
        throw new ToolExecutionError(`Unknown tool: "${toolName}"`, { toolName });
    }
  } catch (err) {
    if (signal?.aborted) {
      throw new PratyakshaError('Operation aborted by user', { code: 'CANCELLED', recoverable: false });
    }
    const currentTab = await getTabSafe(tabId, chromeApi);
    return createToolError({
      toolName,
      error: err,
      page: currentTab,
      recoverable: !(err instanceof PolicyViolationError)
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

export function sleepMs(ms, signal) {
  if (signal?.aborted) return Promise.reject(new PratyakshaError('Aborted', { code: 'CANCELLED', recoverable: false }));
  return new Promise((resolve, reject) => {
    let timer = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new PratyakshaError('Aborted', { code: 'CANCELLED', recoverable: false }));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
  });
}

export async function getTabSafe(tabId, chromeApi) {
  if (!chromeApi?.tabs?.get) return { id: tabId, url: '', title: '' };
  try {
    const tab = await chromeApi.tabs.get(tabId);
    return { id: tab.id, url: tab.url || '', title: tab.title || '' };
  } catch {
    return { id: tabId, url: '', title: '' };
  }
}

export function waitForTabLoad(tabId, timeoutMs = 15000, chromeApi, signal) {
  if (!chromeApi?.tabs?.onUpdated) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;

    const onAbort = () => {
      if (!done) {
        done = true;
        if (timer) clearTimeout(timer);
        try { chromeApi.tabs.onUpdated.removeListener(onUpd); } catch (_) {}
        reject(new PratyakshaError('Navigation aborted', { code: 'CANCELLED', recoverable: false }));
      }
    };

    const finish = () => {
      if (!done) {
        done = true;
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        try { chromeApi.tabs.onUpdated.removeListener(onUpd); } catch (_) {}
        resolve();
      }
    };

    const onUpd = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    chromeApi.tabs.onUpdated.addListener(onUpd);
    timer = setTimeout(finish, timeoutMs);
  });
}

export async function sendToTab(tabId, message, timeoutMs = 35000, chromeApi) {
  if (!chromeApi?.tabs?.sendMessage) throw new Error('chrome.tabs.sendMessage unavailable');

  const send = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Content script response timed out')), timeoutMs);
    try {
      chromeApi.tabs.sendMessage(tabId, message, resp => {
        clearTimeout(timer);
        if (chromeApi.runtime?.lastError) {
          const msg = chromeApi.runtime.lastError.message || '';
          msg.includes('message channel closed')
            ? reject(new ChannelClosedError())
            : reject(new Error(msg));
        } else {
          resolve(resp);
        }
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });

  try {
    return await send();
  } catch (e) {
    if (e instanceof ChannelClosedError) throw e;
    await ensureContentScript(tabId, chromeApi);
    await sleepMs(300);
    return await send();
  }
}

export async function ensureContentScript(tabId, chromeApi) {
  if (!chromeApi?.scripting) return;
  try {
    const pong = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('ping timeout')), 1500);
      chromeApi.tabs.sendMessage(tabId, { type: 'PING' }, r => {
        clearTimeout(t);
        chromeApi.runtime?.lastError ? rej() : res(r);
      });
    });
    if (pong?.ready) return;
  } catch { /* proceed to inject */ }

  try {
    await chromeApi.scripting.insertCSS({ target: { tabId }, files: ['content/highlighter.css'] });
    await chromeApi.scripting.executeScript({ target: { tabId }, files: ['content/dom-actions.js', 'content/content-main.js'] });
  } catch (err) {
    // Chrome internal pages reject scripting injection
  }
}
