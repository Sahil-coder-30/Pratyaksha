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

function quote(str, max) {
  const clean = String(str || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Formats one element as a compact single line, e.g.
 *   *[12] <button> "Send" (dialog)
 *   [3] <input type=search> "Search mail" value="cats"
 * A leading `*` marks an element that appeared since the previous step.
 */
export function formatElementLine(el, isBlacklisted = false) {
  if (el.isEditor || el.tag === 'editor') {
    const lang = el.language ? ` language="${el.language}"` : '';
    const edType = el.editorType || el.type || 'monaco';
    const label = quote(el.label || 'Code Editor', 70);
    const parts = [`${el.isNew ? '*' : ''}[${el.id}] <editor type="${edType}"${lang}>`];
    if (isBlacklisted) {
      parts.push(`"[FAILED/DO-NOT-USE] ${label}" ⚠️ BLACKLISTED`);
      return parts.join(' ');
    }
    if (label) parts.push(`"${label}"`);
    return parts.join(' ');
  }

  const kind = el.type && el.type !== el.tag ? ` ${el.role ? 'role' : 'type'}=${el.type}` : '';
  const label = quote(el.label || el.text || el.placeholder || '', 70);
  const parts = [`${el.isNew ? '*' : ''}[${el.id}] <${el.tag || '?'}${kind}>`];
  if (isBlacklisted) {
    parts.push(`"[FAILED/DO-NOT-USE] ${label}" ⚠️ BLACKLISTED`);
    return parts.join(' ');
  }
  if (label) parts.push(`"${label}"`);
  if (el.value) parts.push(`value="${quote(el.value, 30)}"`);
  if (el.placeholder && el.placeholder !== el.label) parts.push(`placeholder="${quote(el.placeholder, 30)}"`);
  if (el.href) parts.push(`→ ${el.href}`);
  if (Array.isArray(el.options) && el.options.length) parts.push(`options=[${el.options.slice(0, 8).map(o => quote(o, 20)).join(' | ')}]`);
  const flags = [];
  if (el.disabled) flags.push('disabled');
  if (el.checked) flags.push('checked');
  if (el.selected) flags.push('selected');
  if (el.expanded === true) flags.push('expanded');
  if (el.expanded === false) flags.push('collapsed');
  if (el.inDialog) flags.push('dialog');
  if (flags.length) parts.push(`(${flags.join(', ')})`);
  return parts.join(' ');
}

/**
 * Formats interactive DOM elements into a compact, token-efficient list.
 * Viewport elements come first (in document order), then off-screen ones,
 * capped by both element count and character budget. Blacklisted targets go last.
 */
export function buildDOMTable(elements = [], max = 150, blacklistedTargets = new Set(), options = {}) {
  if (!elements.length) return 'No interactive elements detected.';
  const maxChars = options.maxChars || 7000;
  const isBl = el => blacklistedTargets.has(Number(el.id));

  const usable = elements.filter(el => !isBl(el));
  const blacklisted = elements.filter(isBl);
  const inView = usable.filter(el => el.inViewport !== false);
  const offView = usable.filter(el => el.inViewport === false);

  const lines = [];
  let used = 0;
  let shown = 0;
  let omitted = 0;
  const push = (line) => {
    if (shown >= max || used + line.length > maxChars) {
      omitted++;
      return;
    }
    lines.push(line);
    used += line.length + 1;
    shown++;
  };

  inView.forEach(el => push(formatElementLine(el)));
  if (offView.length) {
    lines.push('-- below/above the viewport (scroll to reach) --');
    offView.forEach(el => push(formatElementLine(el)));
  }
  blacklisted.forEach(el => push(formatElementLine(el, true)));
  if (omitted > 0) lines.push(`(… ${omitted} more elements not shown — scroll or use find_on_page to reach them)`);

  return lines.join('\n');
}

/**
 * Builds the full page observation the browser agent reasons over:
 * page state header, element list, and a snippet of visible text.
 */
export function buildPageObservation({ elements = [], page = null, blacklistedTargets = new Set(), maxElements = 150 } = {}) {
  const sections = [];
  if (page) {
    const scroll = [];
    scroll.push(page.pixelsAbove > 0 ? `${page.pixelsAbove}px above` : 'at top');
    scroll.push(page.pixelsBelow > 0 ? `${page.pixelsBelow}px more below` : 'at bottom');
    sections.push(`Scroll: ${scroll.join(', ')}.`);
    if (page.dialogOpen) {
      sections.push(`A dialog/modal is open${page.dialogLabel ? ` ("${quote(page.dialogLabel, 50)}")` : ''}. Elements marked (dialog) are inside it; finish or close it before using the page behind.`);
    }
  }
  sections.push(buildDOMTable(elements, maxElements, blacklistedTargets));
  if (page?.visibleText) {
    sections.push(`VISIBLE TEXT (viewport, truncated):\n${quote(page.visibleText, 1500)}`);
  }
  return sections.join('\n');
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
        const timer = setTimeout(() => reject(new Error('GET_PAGE_CONTEXT timeout')), 5000);
        chromeApi.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' }, r => {
          clearTimeout(timer);
          chromeApi.runtime?.lastError ? reject(new Error(chromeApi.runtime.lastError.message)) : resolve(r);
        });
      });
      if (resp?.elements) {
        return {
          url: resp.url || tab.url,
          title: resp.title || tab.title,
          elements: resp.elements,
          page: resp.page || null
        };
      }
    } catch {
      await ensureContentScript(tabId, chromeApi);
      await new Promise(r => setTimeout(r, 400));
    }
  }

  return { url: tab.url, title: tab.title, elements: [], page: null };
}
