/**
 * PRATYAKSHA Browser Agent Tools Registry
 * Sovereign Privacy-First Browser Agent Tools
 *
 * Full autonomous tool suite — 15 browser tools covering:
 * search, navigation, reading, extraction, interaction, inspection, and tab management.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TOOL DECLARATIONS (Gemini format — auto-derived to Mistral below)
// ─────────────────────────────────────────────────────────────────────────────
export const BROWSER_TOOL_DECLARATIONS = [

  // ── NAVIGATION & SEARCH ───────────────────────────────────────────────────
  {
    name: 'search_web',
    description: 'Searches the web for fresh information using a query string. Navigates to Google, waits for results, and returns the extracted result text. Use this for current events, facts, lookups.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'The search query to look up on the web.' },
        engine: { type: 'STRING', enum: ['google', 'bing', 'duckduckgo'], description: 'Search engine to use (default: google).' }
      },
      required: ['query']
    }
  },
  {
    name: 'open_url',
    description: 'Opens an exact URL in the current tab. Use this when you already know the destination URL. For searches use search_web instead.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'The full URL to open (e.g. "https://example.com/page").' },
        rationale: { type: 'STRING', description: 'Why you are navigating here.' }
      },
      required: ['url']
    }
  },
  {
    name: 'go_back',
    description: 'Navigates the current tab back one page in browser history. Use for recovery or to return to a previous state.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'go_forward',
    description: 'Navigates the current tab forward one page in browser history.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'switch_tab',
    description: 'Switches the active browser tab by matching a title keyword or URL keyword. Use for multi-tab research workflows.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title_contains: { type: 'STRING', description: 'Keyword that the target tab title must contain (case-insensitive).' },
        url_contains: { type: 'STRING', description: 'Keyword that the target tab URL must contain (case-insensitive).' },
        tab_index: { type: 'NUMBER', description: 'Zero-based index of the tab in the current window.' }
      }
    }
  },

  // ── READING & EXTRACTION ──────────────────────────────────────────────────
  {
    name: 'read_page',
    description: 'Reads and extracts the visible text content of the current page. Optionally focus on a specific CSS region. Use to understand page content, verify navigation, or read search results.',
    parameters: {
      type: 'OBJECT',
      properties: {
        selector: { type: 'STRING', description: 'Optional CSS selector to focus extraction on a specific section (e.g. "main", "#results", ".article-body").' },
        max_chars: { type: 'NUMBER', description: 'Max characters to return (default 4000, max 8000).' }
      },
      required: []
    }
  },
  {
    name: 'get_page_metadata',
    description: 'Returns structured metadata about the current page: title, URL, canonical, meta description, Open Graph tags, author, publish date. Use for source validation.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_links',
    description: 'Returns all hyperlinks on the page as a list of {text, url} pairs. Optionally filter by keyword. Use for navigation planning.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filter: { type: 'STRING', description: 'Optional keyword — only return links whose text or URL contain this string (case-insensitive).' },
        max: { type: 'NUMBER', description: 'Maximum number of links to return (default 25).' }
      },
      required: []
    }
  },
  {
    name: 'find_on_page',
    description: 'Searches for a text string on the current page. Returns whether it was found, how many matches exist, the surrounding context, and scrolls to the first match.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'The text or keyword to search for on the page.' },
        case_sensitive: { type: 'BOOLEAN', description: 'Whether the search is case-sensitive (default false).' }
      },
      required: ['text']
    }
  },
  {
    name: 'extract_structured',
    description: 'Extracts structured data from the page into a JSON object. Provide a list of fields, each with a CSS selector and optional attribute. Use to avoid hallucination when reading specific values (prices, names, dates, etc.).',
    parameters: {
      type: 'OBJECT',
      properties: {
        fields: {
          type: 'ARRAY',
          description: 'List of fields to extract. Each item: { "name": "fieldName", "selector": ".css-selector", "attribute": "href" (optional, default: innerText) }.',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING', description: 'Field name' },
              selector: { type: 'STRING', description: 'CSS selector' },
              attribute: { type: 'STRING', description: 'Optional attribute (e.g. href, src)' }
            }
          }
        },
        root_selector: { type: 'STRING', description: 'Optional CSS selector to scope extraction to a specific container (e.g. "#main-table tr:first-child").' }
      },
      required: ['fields']
    }
  },

  // ── INTERACTION ───────────────────────────────────────────────────────────
  {
    name: 'click_element',
    description: 'Clicks an interactive element — buttons, links, tabs, checkboxes. Use target_id from the DOM table for accuracy.',
    parameters: {
      type: 'OBJECT',
      properties: {
        target_id: { type: 'NUMBER', description: 'Numeric [ID] from the DOM elements table. Preferred for guaranteed accuracy.' },
        semantic_hint: { type: 'STRING', description: 'Fallback: describe the element (e.g. "Compose button", "Search icon").' }
      },
      required: ['target_id']
    }
  },
  {
    name: 'type_into_element',
    description: 'Types text into any input, search bar, textarea, or rich-text editor. Use target_id from the DOM table.',
    parameters: {
      type: 'OBJECT',
      properties: {
        target_id: { type: 'NUMBER', description: 'Numeric [ID] from the DOM elements table.' },
        semantic_hint: { type: 'STRING', description: 'Fallback: describe the field (e.g. "Search box", "Email recipient field").' },
        text: { type: 'STRING', description: 'The exact text to type.' },
        clear_first: { type: 'BOOLEAN', description: 'Clear existing content before typing (default false).' },
        press_enter: { type: 'BOOLEAN', description: 'Press Enter after typing (for search bars and form submission).' }
      },
      required: ['target_id', 'text']
    }
  },
  {
    name: 'execute_js',
    description: 'Executes arbitrary JavaScript in the context of the current page and returns the result. Use for complex interactions not possible with other tools (custom events, reading JS variables, interacting with SPAs).',
    parameters: {
      type: 'OBJECT',
      properties: {
        code: { type: 'STRING', description: 'JavaScript expression or statement to execute in the page context. Return value is stringified.' },
        description: { type: 'STRING', description: 'What this JS is intended to do.' }
      },
      required: ['code']
    }
  },

  // ── OBSERVATION & WAITING ─────────────────────────────────────────────────
  {
    name: 'inspect_dom',
    description: 'Inspects a specific DOM element and returns its accessibility info, attributes, role, and nearby children. Use when you need to understand an element before interacting with it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        target_id: { type: 'NUMBER', description: 'Numeric [ID] from the DOM elements table.' },
        selector: { type: 'STRING', description: 'CSS selector to inspect an element not in the table.' },
        semantic_hint: { type: 'STRING', description: 'Describe the element if selector/id unavailable.' }
      }
    }
  },
  {
    name: 'screenshot',
    description: 'Captures a screenshot of the current visible viewport. Returns page title and dimensions. Use for visual understanding of complex UIs or to verify page state.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'scroll_page',
    description: 'Scrolls the viewport to reveal more content, load lazy elements, or navigate to a specific position.',
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', enum: ['down', 'up', 'top', 'bottom'], description: '"down"/"up" scroll by pixels; "top"/"bottom" jump to page extremes.' },
        pixels: { type: 'NUMBER', description: 'Pixels to scroll (for "down"/"up"). Default 600.' }
      },
      required: ['direction']
    }
  },
  {
    name: 'wait_for',
    description: 'Waits until a specific element appears in the DOM or specific text becomes visible on the page. More precise than wait_seconds for dynamic content.',
    parameters: {
      type: 'OBJECT',
      properties: {
        selector: { type: 'STRING', description: 'CSS selector to wait for (e.g. ".search-results", "#compose-window").' },
        text_contains: { type: 'STRING', description: 'Text that must appear on the page (e.g. "Results for").' },
        timeout_seconds: { type: 'NUMBER', description: 'Max seconds to wait (default 8, max 30).' }
      }
    }
  },
  {
    name: 'wait_seconds',
    description: 'Pauses for N seconds to let animations, modals, AJAX requests, or page transitions finish.',
    parameters: {
      type: 'OBJECT',
      properties: {
        seconds: { type: 'NUMBER', description: 'Seconds to wait (1–5).' },
        reason: { type: 'STRING', description: 'Why you are waiting.' }
      },
      required: ['seconds']
    }
  },
  {
    name: 'finish_task',
    description: 'Marks the task complete with a detailed summary. Call ONLY when the user goal is fully achieved. If blocked, try alternatives before giving up.',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: 'Detailed summary of what was accomplished, including key information found.' },
        success: { type: 'BOOLEAN', description: 'true if goal achieved, false only if truly impossible after exhausting all options.' }
      },
      required: ['summary', 'success']
    }
  }
];

function toOpenAiProp(prop) {
  if (!prop) return {};
  const out = {
    type: (prop.type || 'string').toLowerCase(),
    ...(prop.description ? { description: prop.description } : {}),
    ...(prop.enum ? { enum: prop.enum } : {})
  };
  if (prop.items) {
    out.items = toOpenAiProp(prop.items);
  }
  if (prop.properties) {
    out.properties = Object.fromEntries(
      Object.entries(prop.properties).map(([k, v]) => [k, toOpenAiProp(v)])
    );
  }
  if (prop.required) {
    out.required = prop.required;
  }
  return out;
}

export const MISTRAL_TOOL_DECLARATIONS = BROWSER_TOOL_DECLARATIONS.map(tool => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(tool.parameters.properties || {}).map(([k, v]) => [k, toOpenAiProp(v)])
      ),
      required: tool.parameters.required || []
    }
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel error: content script unloaded due to navigation
// ─────────────────────────────────────────────────────────────────────────────
class ChannelClosedError extends Error {
  constructor() {
    super('message channel closed before a response was received');
    this.name = 'ChannelClosedError';
  }
}

// Screenshot store (for the current session)
let _lastScreenshot = null;
export function getLastScreenshot() { return _lastScreenshot; }

// ─────────────────────────────────────────────────────────────────────────────
// TOOL DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string}  toolName
 * @param {Object}  args
 * @param {Object}  activeTab   { id, url, title, ... }
 * @param {Object}  vault       PIIVault instance
 * @returns {Promise<{ observation: string, isFinished?: boolean, newTabId?: number }>}
 */
export async function executeBrowserTool(toolName, args = {}, activeTab, vault) {
  if (!activeTab?.id) throw new Error('No active browser tab connected.');
  const tabId = activeTab.id;

  switch (toolName) {

    // ── search_web ──────────────────────────────────────────────────────────
    case 'search_web': {
      const q = (args.query || '').trim();
      if (!q) throw new Error('search_web requires a query.');

      const engines = {
        google:     `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        bing:       `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
        duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
      };
      const url = engines[args.engine] || engines.google;

      await chrome.tabs.update(tabId, { url });
      await waitForTabLoad(tabId, 15000);
      await sleepMs(1000);
      await ensureContentScript(tabId);

      const textResp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: { action: 'READ_PAGE', selector: null, maxChars: 5000 }
      });
      const text = textResp?.result || '(empty)';
      return { observation: `Search results for "${q}" on ${args.engine || 'google'}:\n${text}` };
    }

    // ── open_url ────────────────────────────────────────────────────────────
    case 'open_url': {
      let url = (args.url || '').trim();
      if (!url) throw new Error('open_url requires a url.');
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

      await chrome.tabs.update(tabId, { url });
      await waitForTabLoad(tabId, 15000);
      await sleepMs(800);
      await ensureContentScript(tabId);
      return { observation: `Opened: ${url}` };
    }

    // ── go_back ─────────────────────────────────────────────────────────────
    case 'go_back': {
      await chrome.tabs.goBack(tabId).catch(() => {});
      await waitForTabLoad(tabId, 10000);
      await sleepMs(600);
      await ensureContentScript(tabId);
      const t = await chrome.tabs.get(tabId).catch(() => ({}));
      return { observation: `Navigated back. Now on: ${t.url || 'previous page'}` };
    }

    // ── go_forward ──────────────────────────────────────────────────────────
    case 'go_forward': {
      await chrome.tabs.goForward(tabId).catch(() => {});
      await waitForTabLoad(tabId, 10000);
      await sleepMs(600);
      await ensureContentScript(tabId);
      const t = await chrome.tabs.get(tabId).catch(() => ({}));
      return { observation: `Navigated forward. Now on: ${t.url || 'next page'}` };
    }

    // ── switch_tab ──────────────────────────────────────────────────────────
    case 'switch_tab': {
      const win   = await chrome.windows.getCurrent();
      const tabs  = await chrome.tabs.query({ windowId: win.id });

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

      if (!target) throw new Error(`No matching tab found (${JSON.stringify(args)}).`);

      await chrome.tabs.update(target.id, { active: true });
      await sleepMs(400);
      await ensureContentScript(target.id);
      return {
        observation: `Switched to tab: "${target.title}" — ${target.url}`,
        newTabId: target.id
      };
    }

    // ── read_page ───────────────────────────────────────────────────────────
    case 'read_page': {
      const maxChars = Math.min(args.max_chars || 4000, 8000);
      const resp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: { action: 'READ_PAGE', selector: args.selector || null, maxChars }
      });
      const tab  = await chrome.tabs.get(tabId).catch(() => ({}));
      const text = resp?.result || '(no content)';
      return { observation: `URL: ${tab.url}\nTitle: ${tab.title}\n\n${text}` };
    }

    // ── get_page_metadata ───────────────────────────────────────────────────
    case 'get_page_metadata': {
      const resp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: { action: 'GET_METADATA' }
      });
      const meta = resp?.result || {};
      return {
        observation: `Page Metadata:\n${JSON.stringify(meta, null, 2)}`
      };
    }

    // ── get_links ───────────────────────────────────────────────────────────
    case 'get_links': {
      const resp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: { action: 'GET_LINKS', filter: args.filter || '', max: args.max || 25 }
      });
      const links = resp?.result || [];
      if (!links.length) return { observation: 'No links found matching the filter.' };
      const formatted = links.map((l, i) => `[${i + 1}] "${l.text}" → ${l.url}`).join('\n');
      return { observation: `Found ${links.length} links:\n${formatted}` };
    }

    // ── find_on_page ────────────────────────────────────────────────────────
    case 'find_on_page': {
      if (!args.text) throw new Error('find_on_page requires text.');
      const resp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: { action: 'FIND_ON_PAGE', text: args.text, caseSensitive: !!args.case_sensitive }
      });
      const r = resp?.result || {};
      if (!r.found) return { observation: `"${args.text}" was NOT found on this page.` };
      return {
        observation: `Found ${r.count} match(es) for "${args.text}". Scrolled to first match.\nContext: ...${r.context}...`
      };
    }

    // ── extract_structured ──────────────────────────────────────────────────
    case 'extract_structured': {
      if (!args.fields?.length) throw new Error('extract_structured requires a fields array.');
      const resp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: {
          action: 'EXTRACT_STRUCTURED',
          fields: args.fields,
          rootSelector: args.root_selector || null
        }
      });
      const data = resp?.result || {};
      return {
        observation: `Extracted structured data:\n${JSON.stringify(data, null, 2)}`
      };
    }

    // ── click_element ───────────────────────────────────────────────────────
    case 'click_element': {
      const targetId = typeof args.target_id === 'string' ? parseInt(args.target_id, 10) : args.target_id;
      const hint     = args.semantic_hint || '';
      if (!targetId && !hint) throw new Error('click_element needs target_id or semantic_hint.');

      let resp;
      try {
        resp = await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { action: 'CLICK', target_id: targetId, semantic_hint: hint }
        });
      } catch (err) {
        // Channel-closed = click triggered navigation = success
        if (err instanceof ChannelClosedError || err.message?.includes('message channel closed')) {
          await waitForTabLoad(tabId, 12000);
          await sleepMs(900);
          await ensureContentScript(tabId);
          return { observation: `Clicked [#${targetId}] "${hint}" — page navigated successfully.` };
        }
        throw err;
      }

      if (!resp?.success) throw new Error(resp?.error || `Could not click [#${targetId}] "${hint}"`);
      await sleepMs(600);
      return { observation: `Clicked [#${targetId}] "${hint}" — DOM settled.` };
    }

    // ── type_into_element ───────────────────────────────────────────────────
    case 'type_into_element': {
      const targetId = typeof args.target_id === 'string' ? parseInt(args.target_id, 10) : args.target_id;
      const hint     = args.semantic_hint || '';
      let   text     = args.text || '';
      if (vault?.rehydrate) text = vault.rehydrate(text) ?? text;
      if (!text && text !== 0) throw new Error('type_into_element requires text.');

      const resp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: { action: 'TYPE', target_id: targetId, semantic_hint: hint, value: text, clear_first: !!args.clear_first }
      });
      if (!resp?.success) throw new Error(resp?.error || `Could not type into [#${targetId}] "${hint}"`);

      if (args.press_enter) {
        await sleepMs(150);
        await sendToTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { action: 'PRESS_ENTER', target_id: targetId, semantic_hint: hint }
        }).catch(() => {});
        await sleepMs(700);
      }

      const desc = targetId ? `[#${targetId}]` : `"${hint}"`;
      return { observation: `Typed "${text.slice(0, 80)}" into ${desc}${args.press_enter ? ' + Enter' : ''}.` };
    }

    // ── execute_js ──────────────────────────────────────────────────────────
    case 'execute_js': {
      if (!args.code) throw new Error('execute_js requires code.');
      const resp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: { action: 'EXECUTE_JS', code: args.code }
      });
      const result = resp?.result;
      return {
        observation: `JS executed${args.description ? ` (${args.description})` : ''}.\nResult: ${
          result === undefined ? '(no return value)' : JSON.stringify(result)
        }`
      };
    }

    // ── inspect_dom ─────────────────────────────────────────────────────────
    case 'inspect_dom': {
      const targetId = typeof args.target_id === 'string' ? parseInt(args.target_id, 10) : args.target_id;
      const resp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: { action: 'INSPECT_DOM', target_id: targetId, selector: args.selector, semantic_hint: args.semantic_hint }
      });
      const info = resp?.result;
      if (!info) return { observation: 'Element not found for inspection.' };
      return { observation: `DOM Inspection:\n${JSON.stringify(info, null, 2)}` };
    }

    // ── screenshot ──────────────────────────────────────────────────────────
    case 'screenshot': {
      try {
        const win    = await chrome.windows.getCurrent();
        const dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: 'png' });
        const tab    = await chrome.tabs.get(tabId).catch(() => ({}));
        _lastScreenshot = { dataUrl, url: tab.url, title: tab.title, timestamp: Date.now() };

        // Estimate dimensions from data URL length (rough: PNG ~3 bytes/pixel compressed)
        const sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
        return {
          observation: `Screenshot captured (≈${sizeKB}KB PNG).\nPage: "${tab.title}"\nURL: ${tab.url}`,
          screenshotDataUrl: dataUrl
        };
      } catch (err) {
        throw new Error(`Screenshot failed: ${err.message}`);
      }
    }

    // ── scroll_page ─────────────────────────────────────────────────────────
    case 'scroll_page': {
      const dir = (args.direction || 'down').toLowerCase();
      let deltaY;
      if (dir === 'top') {
        await sendToTab(tabId, { type: 'EXECUTE_ACTION', payload: { action: 'SCROLL', deltaY: -999999 } });
        await sleepMs(300);
        return { observation: 'Scrolled to top of page.' };
      }
      if (dir === 'bottom') {
        await sendToTab(tabId, { type: 'EXECUTE_ACTION', payload: { action: 'SCROLL', deltaY: 999999 } });
        await sleepMs(300);
        return { observation: 'Scrolled to bottom of page.' };
      }
      deltaY = (dir === 'up' ? -1 : 1) * (args.pixels || 600);
      await sendToTab(tabId, { type: 'EXECUTE_ACTION', payload: { action: 'SCROLL', deltaY } });
      await sleepMs(350);
      return { observation: `Scrolled ${dir} ${Math.abs(deltaY)}px.` };
    }

    // ── wait_for ─────────────────────────────────────────────────────────────
    case 'wait_for': {
      if (!args.selector && !args.text_contains) throw new Error('wait_for requires selector or text_contains.');
      const timeoutMs = Math.min((args.timeout_seconds || 8) * 1000, 30000);
      const resp = await sendToTab(tabId, {
        type: 'EXECUTE_ACTION',
        payload: {
          action: 'WAIT_FOR',
          selector: args.selector || null,
          textContains: args.text_contains || null,
          timeoutMs
        }
      }, timeoutMs + 2000);  // outer timeout slightly larger

      if (!resp?.result?.found) {
        return { observation: `wait_for timed out after ${timeoutMs / 1000}s — condition not met.` };
      }
      return { observation: `Condition met: ${resp.result.detail || 'element appeared.'}` };
    }

    // ── wait_seconds ─────────────────────────────────────────────────────────
    case 'wait_seconds': {
      const ms = Math.min(Math.max((args.seconds || 1) * 1000, 500), 5000);
      await sleepMs(ms);
      return { observation: `Waited ${ms / 1000}s${args.reason ? ` (${args.reason})` : ''}.` };
    }

    // ── finish_task ──────────────────────────────────────────────────────────
    case 'finish_task': {
      sendToTab(tabId, { type: 'EXECUTE_ACTION', payload: { action: 'CLEAR_HIGHLIGHT' } }).catch(() => {});
      return {
        observation: `Task finished: ${args.summary}`,
        isFinished: true,
        success: args.success !== false,
        summary: args.summary || 'Done.'
      };
    }

    default:
      throw new Error(`Unknown tool: "${toolName}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Sends a message to the content script with timeout + channel-closed detection.
 * ChannelClosedError → content script torn down (navigation) — caller handles.
 * Timeout / script-missing → inject and retry once.
 */
async function sendToTab(tabId, message, timeoutMs = 8000) {
  const send = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Content script response timed out')), timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, resp => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          msg.includes('message channel closed')
            ? reject(new ChannelClosedError())
            : reject(new Error(msg));
        } else {
          resolve(resp);
        }
      });
    } catch (e) { clearTimeout(timer); reject(e); }
  });

  try {
    return await send();
  } catch (e) {
    if (e instanceof ChannelClosedError) throw e;
    await ensureContentScript(tabId);
    await sleepMs(300);
    return await send();
  }
}

function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUpd); resolve(); } };
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    chrome.tabs.onUpdated.addListener(onUpd);
    setTimeout(finish, timeoutMs);
  });
}

async function ensureContentScript(tabId) {
  try {
    const pong = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('ping timeout')), 1500);
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, r => {
        clearTimeout(t);
        chrome.runtime.lastError ? rej() : res(r);
      });
    });
    if (pong?.ready) return;
  } catch { /* fall through to injection */ }

  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/highlighter.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/dom-actions.js', 'content/content-main.js'] });
  } catch (err) {
    console.warn('[PRATYAKSHA] Script injection failed:', err.message);
  }
}
