/**
 * PRATYAKSHA Page Context & Observation Engine
 * Sovereign Privacy-First Browser Agent
 *
 * Coordinates DOM scanning, elements table formatting,
 * dynamic target blacklisting, and canonical service detection.
 */

import { CANONICAL_SERVICES } from '../shared/constants.js';
import { ensureContentScript, getTabSafe } from './browser-tools.js';

/**
 * Detects if a user prompt targets a known canonical service.
 */
export function detectTargetService(task = '') {
  for (const s of CANONICAL_SERVICES) {
    if (s.pattern.test(task)) return s;
  }
  const urlMatch = task.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    try {
      const u = new URL(urlMatch[0]);
      return {
        pattern: null,
        url: u.href,
        name: u.hostname,
        hostMatch: new RegExp(u.hostname.replace(/\./g, '\\.'), 'i')
      };
    } catch (_) {}
  }
  return null;
}

/**
 * Formats interactive DOM elements into an ASCII table.
 * Prioritizes inputs and buttons, pushes blacklisted targets to the end.
 */
export function buildDOMTable(elements = [], max = 75, blacklistedTargets = new Set()) {
  if (!elements.length) return 'No interactive elements detected.';

  const header = '[ID]  TAG            TYPE/ROLE     LABEL / PLACEHOLDER / TEXT                     STATUS/VAL';
  const sep    = '─'.repeat(header.length);

  const sorted = [...elements].sort((a, b) => {
    const isBlA = blacklistedTargets.has(Number(a.id));
    const isBlB = blacklistedTargets.has(Number(b.id));
    if (isBlA && !isBlB) return 1;
    if (!isBlA && isBlB) return -1;

    const isInputA = /input|textarea|textbox|combobox/i.test(`${a.tag} ${a.type} ${a.role}`);
    const isInputB = /input|textarea|textbox|combobox/i.test(`${b.tag} ${b.type} ${b.role}`);
    if (isInputA && !isInputB) return -1;
    if (!isInputA && isInputB) return 1;
    return 0;
  });

  const rows = sorted.slice(0, max).map(el => {
    const isBl = blacklistedTargets.has(Number(el.id));
    const id    = String(el.id || '').padStart(4, ' ');
    const tag   = `<${el.tag || '?'}>`.padEnd(14, ' ');
    const type  = (el.type || el.role || '').padEnd(13, ' ');
    let label   = (el.label || el.text || '').replace(/\s+/g, ' ').slice(0, 46);
    if (isBl) {
      label = `[FAILED/DO-NOT-USE] ${label}`.slice(0, 46);
    }
    label = label.padEnd(46, ' ');
    const val   = isBl ? '⚠️ BLACKLISTED' : (el.value ? `"${el.value.slice(0, 20)}"` : '');
    return `[${id}]  ${tag} ${type} ${label} ${val}`;
  });

  return [header, sep, ...rows].join('\n');
}

/**
 * Collects a fresh page context from the active tab.
 */
export async function getPageContext(tabId, options = {}) {
  const chromeApi = options.chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
  const signal = options.signal;
  if (!tabId || !chromeApi?.tabs) return { url: '', title: '', elements: [] };

  const tab = await getTabSafe(tabId, chromeApi);

  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) break;
    try {
      const resp = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('GET_PAGE_CONTEXT timeout')), 4000);
        chromeApi.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' }, r => {
          clearTimeout(timer);
          chromeApi.runtime?.lastError ? reject(new Error(chromeApi.runtime.lastError.message)) : resolve(r);
        });
      });
      if (resp?.elements) {
        return {
          url: resp.url || tab.url,
          title: resp.title || tab.title,
          elements: resp.elements
        };
      }
    } catch {
      await ensureContentScript(tabId, chromeApi);
      await new Promise(r => setTimeout(r, 400));
    }
  }

  return { url: tab.url, title: tab.title, elements: [] };
}
