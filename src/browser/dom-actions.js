/**
 * PRATYAKSHA DOM Action Dispatcher & Perception Engine
 * Sovereign Privacy-First Browser Agent
 * 
 * High-precision browser perception, element tagging, semantic matching,
 * and resilient cross-framework interaction (React, Vue, Angular, Gmail/RichText).
 */

// Guarded so a re-injection keeps the live registry (and therefore stable IDs)
window.PratyakshaDOM = window.PratyakshaDOM || (function() {
  let agentCursor = null;
  let controlFrame = null;
  let cursorMoveId = 0;

  function ensureControlFrame() {
    try {
      const root = document.documentElement || document.body;
      if (!root) return null;
      if (!controlFrame || !document.documentElement.contains(controlFrame)) {
        controlFrame = document.createElement('div');
        controlFrame.id = 'pratyaksha-control-frame';
        controlFrame.setAttribute('aria-hidden', 'true');
        controlFrame.innerHTML = '<div class="control-badge"><span class="control-badge-dot"></span><span>PRATYAKSHA AI IN CONTROL</span></div>';
        root.appendChild(controlFrame);
      }
      return controlFrame;
    } catch (err) {
      console.warn('[PRATYAKSHA] Error ensuring control frame:', err);
      return null;
    }
  }

  function setControlActive(active = true) {
    try {
      if (active) {
        const frame = ensureControlFrame();
        if (frame) {
          void frame.offsetWidth;
          frame.classList.add('is-active');
        }
      } else {
        if (controlFrame) {
          try { controlFrame.classList.remove('is-active'); } catch (_) {}
          try { controlFrame.remove(); } catch (_) {}
          controlFrame = null;
        }
        const leftovers = document.querySelectorAll('#pratyaksha-control-frame');
        leftovers.forEach(el => {
          try { el.remove(); } catch (_) {}
        });
      }
    } catch (err) {
      console.warn('[PRATYAKSHA] setControlActive error:', err);
    }
  }

  function ensureAgentCursor() {
    try {
      const root = document.documentElement || document.body;
      if (!root) return null;
      if (!agentCursor || !document.documentElement.contains(agentCursor)) {
        agentCursor = document.createElement('div');
        agentCursor.id = 'pratyaksha-agent-cursor';
        agentCursor.setAttribute('aria-hidden', 'true');
        agentCursor.innerHTML = '<svg class="figma-cursor-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5.65 12.37H5.46L5.32 12.5L0.5 16.88V1.2L11.78 12.37H5.65Z" fill="#000000" stroke="#FFFFFF" stroke-width="1.8" stroke-linejoin="round"/></svg><span class="pratyaksha-cursor-ripple"></span>';
        root.appendChild(agentCursor);
      }
      return agentCursor;
    } catch (err) {
      console.warn('[PRATYAKSHA] Error ensuring agent cursor:', err);
      return null;
    }
  }

  function moveAgentCursor(el, { click = false } = {}) {
    try { setControlActive(true); } catch (_) {}
    const cursor = ensureAgentCursor();
    if (!cursor || !el || typeof el.getBoundingClientRect !== 'function') {
      return { x: 0, y: 0, duration: 100 };
    }

    try {
      const rect = el.getBoundingClientRect();
      const x = Math.max(8, Math.min(window.innerWidth - 12, rect.left + rect.width / 2));
      const y = Math.max(8, Math.min(window.innerHeight - 12, rect.top + rect.height / 2));

      // Short distance-aware glide (120ms - 220ms): visible to the user, cheap for the agent
      const prevX = parseFloat(cursor.dataset.x) || (window.innerWidth / 2);
      const prevY = parseFloat(cursor.dataset.y) || (window.innerHeight / 2);
      const distance = Math.hypot(x - prevX, y - prevY);
      const duration = Math.min(220, Math.max(120, Math.round(distance * 0.08 + 110)));

      cursor.style.transition = `opacity 140ms ease, transform 160ms cubic-bezier(0.16, 1, 0.3, 1), left ${duration}ms cubic-bezier(0.22, 1, 0.36, 1), top ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;

      cursor.classList.remove('is-clicking');
      cursor.classList.add('is-visible');
      cursor.dataset.x = String(x);
      cursor.dataset.y = String(y);
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;

      if (click) {
        setTimeout(() => {
          cursor.classList.add('is-clicking');
          setTimeout(() => {
            try { cursor?.classList.remove('is-clicking'); } catch (_) {}
          }, 250);
        }, Math.max(20, duration - 40));
      }
      return { x, y, duration };
    } catch (err) {
      console.warn('[PRATYAKSHA] moveAgentCursor error:', err);
      return { x: 0, y: 0, duration: 0 };
    }
  }

  function getUniqueSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';

    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }

    const tag = el.tagName.toLowerCase();

    if (el.name && document.querySelectorAll(`${tag}[name="${CSS.escape(el.name)}"]`).length === 1) {
      return `${tag}[name="${CSS.escape(el.name)}"]`;
    }

    if (el.getAttribute('aria-label')) {
      const aria = el.getAttribute('aria-label');
      if (document.querySelectorAll(`${tag}[aria-label="${CSS.escape(aria)}"]`).length === 1) {
        return `${tag}[aria-label="${CSS.escape(aria)}"]`;
      }
    }

    if (el.getAttribute('placeholder')) {
      const ph = el.getAttribute('placeholder');
      if (document.querySelectorAll(`${tag}[placeholder="${CSS.escape(ph)}"]`).length === 1) {
        return `${tag}[placeholder="${CSS.escape(ph)}"]`;
      }
    }

    // Path fallback
    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      } else {
        let sibling = current;
        let nth = 1;
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.tagName.toLowerCase() === selector) nth++;
        }
        if (nth > 1) selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  // ── Element registry ─────────────────────────────────────────────────────
  // IDs are stable for the lifetime of a DOM node. An element keeps the same
  // [ID] across scans, so earlier references in the agent's history stay valid,
  // and a stale ID can never silently resolve to a different element.
  const elementIds = new WeakMap();
  const idToElement = new Map();
  let nextElementId = 1;
  let previousScanIds = new Set();

  const MAX_ELEMENTS = 150;
  const MAX_VISIBLE_TEXT = 1500;

  const INTERACTIVE_SELECTOR = [
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable="plaintext-only"]',
    'button',
    'a[href]',
    'summary',
    'label[for]',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="textbox"]',
    '[role="treeitem"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="row"]',
    '[role="listitem"]',
    '[data-testid*="cell"]',
    '[data-testid*="chat"]',
    '[onclick]',
    '[jsaction*="click"]',
    '[aria-haspopup="true"]',
    '[aria-haspopup="menu"]',
    '[aria-haspopup="listbox"]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  // Controls that swallow their descendants (a <span> inside a <button> is noise)
  const LEAF_CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], summary';
  const EDITABLE_SELECTOR = 'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], [role="searchbox"], [role="combobox"]';
  const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return !el.readOnly;
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      return !el.readOnly && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden'].includes(t);
    }
    return false;
  }

  function isVisible(el, rect, style) {
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) === 0 && !isEditable(el)) return false;
    return true;
  }

  /** Collects matches across the document and any open shadow roots. */
  function deepQueryAll(selector, root = document, out = [], depth = 0) {
    try {
      root.querySelectorAll(selector).forEach(el => out.push(el));
      if (depth > 3) return out;
      const all = root.querySelectorAll('*');
      for (const host of all) {
        if (host.shadowRoot) deepQueryAll(selector, host.shadowRoot, out, depth + 1);
      }
    } catch (_) {}
    return out;
  }

  function getAccessibleName(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id)?.innerText || '')
        .join(' ').trim();
      if (text) return text;
    }
    return '';
  }

  /**
   * Derives a unified, human-readable label for an element
   */
  function extractElementLabel(el) {
    const aria = el.getAttribute('aria-label') || getAccessibleName(el) || '';
    if (aria.trim()) return aria.trim();

    if (el.id) {
      try {
        const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (labelEl && labelEl.innerText.trim()) return labelEl.innerText.trim();
      } catch (_) {}
    }
    if (isEditable(el) || el.tagName === 'SELECT') {
      const parentLabel = el.closest('label');
      if (parentLabel && parentLabel.innerText.trim()) {
        return parentLabel.innerText.replace(el.innerText || '', '').trim();
      }
      const placeholder = el.getAttribute('placeholder') || '';
      if (placeholder.trim()) return placeholder.trim();
    }

    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text) return text.slice(0, 80);

    const title = el.getAttribute('title') || el.getAttribute('data-tooltip') || '';
    if (title.trim()) return title.trim();

    const img = el.tagName === 'IMG' ? el : el.querySelector?.('img[alt], svg title');
    if (img) {
      const alt = img.getAttribute?.('alt') || img.textContent || '';
      if (alt.trim()) return alt.trim();
    }

    const name = el.getAttribute('name') || '';
    if (name.trim()) return name.trim();

    // Preceding sibling text (common in custom form controls like "To: [input]")
    const prev = el.previousElementSibling;
    if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN') && prev.innerText.trim()) {
      return prev.innerText.trim();
    }

    return '';
  }

  function shortHref(el) {
    const raw = el.getAttribute('href');
    if (!raw || raw.startsWith('javascript:') || raw === '#') return '';
    try {
      const u = new URL(raw, location.href);
      if (u.origin === location.origin) return (u.pathname + u.search).slice(0, 60);
      return (u.hostname + u.pathname).slice(0, 60);
    } catch (_) {
      return raw.slice(0, 60);
    }
  }

  /**
   * True when the element's center is covered by an unrelated element
   * (modal backdrop, cookie banner, sticky overlay). Only meaningful in viewport.
   */
  function isOccluded(el, rect) {
    try {
      if (el.getRootNode() instanceof ShadowRoot) return false;
      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + Math.min(8, rect.width / 2), rect.top + Math.min(8, rect.height / 2)]
      ];
      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return false;
        // Labels forward clicks to their control
        if (hit.tagName === 'LABEL' && hit.control === el) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function assignId(el) {
    let id = elementIds.get(el);
    if (!id) {
      id = nextElementId++;
      elementIds.set(el, id);
    }
    idToElement.set(id, el);
    if (el.getAttribute('data-pratyaksha-id') !== String(id)) {
      el.setAttribute('data-pratyaksha-id', String(id));
    }
    return id;
  }

  /** Visible text of the current viewport, compact, so the model can read without a tool call. */
  function collectVisibleText(limit = MAX_VISIBLE_TEXT) {
    const parts = [];
    let total = 0;
    const seenParents = new Map();
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/i.test(p.tagName)) return NodeFilter.FILTER_REJECT;
          return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      let visited = 0;
      while (walker.nextNode() && visited < 6000 && total < limit) {
        visited++;
        const node = walker.currentNode;
        const p = node.parentElement;
        let visible = seenParents.get(p);
        if (visible === undefined) {
          const r = p.getBoundingClientRect();
          visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight &&
                    r.right > 0 && r.left < window.innerWidth;
          if (visible) {
            const s = window.getComputedStyle(p);
            visible = s.visibility !== 'hidden' && s.display !== 'none';
          }
          seenParents.set(p, visible);
        }
        if (!visible) continue;
        const text = node.nodeValue.replace(/\s+/g, ' ').trim();
        if (text.length < 2 && !/\d/.test(text)) continue;
        parts.push(text);
        total += text.length + 1;
      }
    } catch (_) {}
    return parts.join(' | ').slice(0, limit);
  }

  function describeOptions(selectEl) {
    return Array.from(selectEl.options || []).slice(0, 12).map(o => (o.text || o.value || '').trim().slice(0, 30)).filter(Boolean);
  }

  /**
   * Fuzzy matches semantic intent across candidate elements
   */
  function findSemanticElement(hint) {
    if (!hint || typeof hint !== 'string') return null;
    const lower = hint.toLowerCase().trim();
    if (!lower) return null;

    const intentMap = {
      compose: ['compose', 'new email', 'new message', 'write email', 'create message', 'draft'],
      recipient: ['to', 'recipient', 'recipients', 'email to', 'send to', 'to recipients'],
      subject: ['subject', 'subjectbox', 'subject line'],
      body: ['message body', 'compose body', 'email body', 'write your email'],
      send: ['send', 'send (ctrl-enter)', 'send message'],
      search: ['search', 'search query', 'search mail', 'google search']
    };
    const hasWord = (text, word) => new RegExp(`(^|\\W)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i').test(text);

    let targetKeywords = [lower];
    for (const synonyms of Object.values(intentMap)) {
      if (synonyms.some(s => hasWord(lower, s))) {
        targetKeywords = [...new Set([...targetKeywords, ...synonyms])];
        break;
      }
    }

    const candidates = deepQueryAll(INTERACTIVE_SELECTOR).filter(el => {
      const rect = el.getBoundingClientRect();
      return isVisible(el, rect, window.getComputedStyle(el));
    });

    let bestMatch = null;
    let highestScore = 0;

    for (const el of candidates) {
      const label = extractElementLabel(el).toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const ph = (el.getAttribute('placeholder') || '').toLowerCase();
      const name = (el.getAttribute('name') || '').toLowerCase();
      const id = (el.id || '').toLowerCase();

      let score = 0;
      for (const kw of targetKeywords) {
        if (label === kw) score += 50;
        else if (kw.length > 2 && label.includes(kw)) score += 30;
        if (aria === kw) score += 40;
        else if (kw.length > 2 && aria.includes(kw)) score += 25;
        if (ph === kw) score += 35;
        else if (kw.length > 2 && ph.includes(kw)) score += 20;
        if (name === kw || id === kw) score += 30;
        else if (kw.length > 2 && (name.includes(kw) || id.includes(kw))) score += 15;
      }

      const editable = isEditable(el) || el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'textbox';
      if (hasWord(lower, 'recipient') || hasWord(lower, 'to') || hasWord(lower, 'body') || hasWord(lower, 'field') || hasWord(lower, 'input')) {
        if (editable) score += 20;
      } else if (hasWord(lower, 'button') || hasWord(lower, 'compose') || hasWord(lower, 'send')) {
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') score += 20;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = el;
      }
    }

    return highestScore >= 20 ? bestMatch : null;
  }

  /**
   * Resolves a target to a live element.
   * Numeric IDs resolve ONLY through the registry: a missing ID is an error, never
   * a fuzzy guess (guessing is what made the agent click the wrong thing).
   * Accepts: element | number | "12" | CSS selector | { target_id, selector, semantic_hint }
   */
  function resolveElement(target) {
    if (target instanceof Element) return { el: target };
    if (target === null || target === undefined) return { el: null, reason: 'No target given.' };

    if (typeof target === 'object') {
      let reason = '';
      if (target.target_id !== undefined && target.target_id !== null && target.target_id !== '') {
        const res = resolveElement(Number(target.target_id));
        if (res.el) return res;
        reason = res.reason;
      }
      if (target.selector) {
        const res = resolveElement(String(target.selector));
        if (res.el) return res;
      }
      if (target.semantic_hint) {
        const el = findSemanticElement(target.semantic_hint);
        if (el) return { el, viaHint: true };
        reason = reason || `No element matches "${target.semantic_hint}".`;
      }
      return { el: null, reason: reason || 'Target not found.' };
    }

    if (typeof target === 'number' || /^\d+$/.test(String(target).trim())) {
      const numId = Number(target);
      const el = idToElement.get(numId);
      if (el && el.isConnected) return { el };
      return {
        el: null,
        reason: `Element [${numId}] no longer exists on the page (it was removed or the page changed). Use an ID from the CURRENT element list.`
      };
    }

    const strTarget = String(target).trim();
    if (!strTarget) return { el: null, reason: 'Empty target.' };
    try {
      const el = document.querySelector(strTarget);
      if (el) return { el };
    } catch (_) {}
    const semantic = findSemanticElement(strTarget);
    if (semantic) return { el: semantic, viaHint: true };
    return { el: null, reason: `No element matches "${strTarget}".` };
  }

  function findElement(target) {
    return resolveElement(target).el;
  }

  function requireElement(target, action) {
    const res = resolveElement(target);
    if (!res.el) throw new Error(`${action} failed: ${res.reason}`);
    return res.el;
  }

  function describeTarget(el) {
    const id = elementIds.get(el);
    const label = extractElementLabel(el).slice(0, 40);
    return `${id ? `[${id}] ` : ''}<${el.tagName.toLowerCase()}>${label ? ` "${label}"` : ''}`;
  }

  /**
   * Resolves once the DOM has been quiet for `quietMs`, or after `maxMs`.
   * Replaces fixed sleeps: fast pages return in ~quietMs, slow SPAs get time to render.
   */
  function waitForDomSettle(maxMs = 1500, quietMs = 250) {
    return new Promise(resolve => {
      let quietTimer = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(quietTimer);
        clearTimeout(maxTimer);
        try { observer.disconnect(); } catch (_) {}
        resolve();
      };
      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      });
      try {
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch (_) {
        return resolve();
      }
      quietTimer = setTimeout(finish, quietMs);
      const maxTimer = setTimeout(finish, maxMs);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Active response & DOM mutation tracker
  // ───────────────────────────────────────────────────────────────────────────
  const activeTrackers = new Map();

  function queryMessageContainers() {
    const selectors = [
      '[role="listitem"]',
      '[data-message-id]',
      '.adn.ads',
      '.ii.gt',
      '.h7',
      '[role="article"]',
      '.message-in',
      '[data-pre-plain-text]',
      '.chat-message',
      '[data-testid*="msg"]',
      '.email-body',
      '.mail-message',
      'div[aria-label*="Message" i]'
    ];
    try {
      return Array.from(document.querySelectorAll(selectors.join(', ')));
    } catch (_) {
      return [];
    }
  }

  function getVisibleTextSnapshot() {
    try {
      return (document.body?.innerText || '').trim();
    } catch (_) {
      return '';
    }
  }

  function pollResponseCondition({
    trackerId = 'default',
    selector = null,
    textContains = null,
    waitForReply = false,
    trackDomChanges = false,
    expectedSender = null
  } = {}) {
    let tracker = activeTrackers.get(trackerId);
    if (!tracker) {
      const initialElements = queryMessageContainers();
      const initialElementsSet = new Set(initialElements);
      const initialText = getVisibleTextSnapshot();
      let mutationCount = 0;
      const addedSnippets = [];

      let observer = null;
      try {
        if (typeof MutationObserver !== 'undefined' && document.body) {
          observer = new MutationObserver((mutations) => {
            mutationCount += mutations.length;
            for (const m of mutations) {
              for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const txt = (node.innerText || node.textContent || '').trim();
                  if (txt.length > 5 && !addedSnippets.includes(txt.slice(0, 80))) {
                    addedSnippets.push(txt.slice(0, 300));
                  }
                }
              }
            }
          });
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
      } catch (_) {}

      tracker = {
        trackerId,
        startTime: Date.now(),
        initialElementsSet,
        initialText,
        observer,
        getMutationCount: () => mutationCount,
        getAddedSnippets: () => addedSnippets
      };
      activeTrackers.set(trackerId, tracker);
    }

    const cleanup = (res) => {
      if (tracker.observer) {
        try { tracker.observer.disconnect(); } catch (_) {}
      }
      activeTrackers.delete(trackerId);
      return res;
    };

    // 1. Selector check
    if (selector) {
      const el = document.querySelector(selector);
      if (el) {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        return cleanup({ found: true, detail: `Selector "${selector}" appeared in DOM` });
      }
    }

    // 2. Text check
    const currentText = getVisibleTextSnapshot();
    if (textContains) {
      if (currentText.toLowerCase().includes(textContains.toLowerCase())) {
        return cleanup({ found: true, detail: `Expected text "${textContains}" appeared on page` });
      }
    }

    // 3. Wait for reply / incoming response
    if (waitForReply) {
      const currentElements = queryMessageContainers();
      const newElements = currentElements.filter(el => !tracker.initialElementsSet.has(el));
      if (newElements.length > 0) {
        const newText = newElements.map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean).join('\n');
        return cleanup({
          found: true,
          detail: `New reply message appeared in thread (${newElements.length} new message container(s))`,
          newContent: newText.slice(0, 500)
        });
      }

      if (expectedSender && currentText.toLowerCase().includes(expectedSender.toLowerCase()) && !tracker.initialText.toLowerCase().includes(expectedSender.toLowerCase())) {
        return cleanup({
          found: true,
          detail: `Incoming response from "${expectedSender}" detected in DOM`
        });
      }

      const snippets = tracker.getAddedSnippets();
      if (snippets.length > 0) {
        const replySnippet = snippets.find(s => !/(sending|saving|draft|undo)/i.test(s) && s.length > 10);
        if (replySnippet) {
          return cleanup({
            found: true,
            detail: `Incoming message response text received: "${replySnippet.slice(0, 100)}"`,
            newContent: replySnippet
          });
        }
      }
    }

    // 4. Track DOM changes
    if (trackDomChanges) {
      if (tracker.getMutationCount() > 5) {
        const snippets = tracker.getAddedSnippets();
        if (snippets.length > 0) {
          return cleanup({
            found: true,
            detail: `Tracked DOM changes: new content received (${tracker.getMutationCount()} mutations, "${snippets[0].slice(0, 80)}")`,
            newContent: snippets[0]
          });
        }
      }
    }

    return { found: false, detail: 'Waiting for response/DOM mutations...' };
  }

  function clearAllTrackers() {
    try {
      for (const [id, tracker] of activeTrackers.entries()) {
        if (tracker.observer) {
          try { tracker.observer.disconnect(); } catch (_) {}
        }
      }
      activeTrackers.clear();
    } catch (_) {}
  }

  function scrollIntoViewIfNeeded(el) {
    const rect = el.getBoundingClientRect();
    const fullyVisible = rect.top >= 0 && rect.left >= 0 &&
                         rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
    if (!fullyVisible) {
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      } catch (_) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    }
  }

  /** Finds the largest scrollable container in view (Gmail, Slack, etc. scroll inside a div, not the window). */
  function findScrollContainer() {
    let best = null;
    let bestArea = 0;
    const els = document.querySelectorAll('div, main, section, ul, [role="main"], [role="feed"], [role="list"]');
    const limit = Math.min(els.length, 4000);
    for (let i = 0; i < limit; i++) {
      const el = els[i];
      if (el.scrollHeight <= el.clientHeight + 20) continue;
      const style = window.getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
      const r = el.getBoundingClientRect();
      const visibleH = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
      const area = visibleH * r.width;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }

  function fireMouseSequence(target, x, y) {
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 0 };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    target.dispatchEvent(new PointerEvent('pointerover', pointer));
    target.dispatchEvent(new MouseEvent('mouseover', base));
    target.dispatchEvent(new PointerEvent('pointermove', pointer));
    target.dispatchEvent(new MouseEvent('mousemove', base));
    target.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
    target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    const focusable = target.closest?.('button, a, input, textarea, select, [tabindex], [contenteditable]') || target;
    try { focusable.focus({ preventScroll: true }); } catch (_) {}
    target.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0, detail: 1 }));
  }

  function visibleDialogs() {
    return Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter(d => {
      const r = d.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = window.getComputedStyle(d);
      return s.visibility !== 'hidden' && s.display !== 'none';
    });
  }

  function snapshotState() {
    return { url: location.href, dialogs: visibleDialogs().length };
  }

  function summarizeChange(before) {
    const after = snapshotState();
    const notes = [];
    if (after.url !== before.url) notes.push(`URL changed to ${after.url}`);
    if (after.dialogs > before.dialogs) notes.push('a dialog/modal opened');
    else if (after.dialogs < before.dialogs) notes.push('a dialog/modal closed');
    return notes.join('; ');
  }

  return {
    /**
     * Scans DOM for visible interactive elements and returns them in document order.
     * Elements hidden behind modals/overlays are dropped so the model only sees what it can act on.
     */
    scanInteractiveElements() {
      return this.scanPage().elements;
    },

    /**
     * Full perception snapshot: interactive elements + compact page state.
     */
    scanPage() {
      const viewH = window.innerHeight || 800;
      const viewW = window.innerWidth || 1280;
      const matched = new Set(deepQueryAll(INTERACTIVE_SELECTOR));

      // Cursor:pointer pass catches div/span "buttons" that SPAs use without roles
      const pointerPool = document.querySelectorAll('div, span, li, img, i, td, svg');
      const poolLimit = Math.min(pointerPool.length, 5000);
      for (let i = 0; i < poolLimit; i++) {
        const el = pointerPool[i];
        if (matched.has(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > viewH * 2) continue;
        if (window.getComputedStyle(el).cursor !== 'pointer') continue;
        const parent = el.parentElement;
        if (parent && window.getComputedStyle(parent).cursor === 'pointer') continue;
        matched.add(el);
      }

      const dialogs = visibleDialogs();
      const topDialog = dialogs[dialogs.length - 1] || null;

      const candidates = [];
      let occludedCount = 0;
      for (const el of matched) {
        if (el.closest('#pratyaksha-agent-cursor, #pratyaksha-control-frame')) continue;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (!isVisible(el, rect, style)) continue;
        if (rect.bottom < -viewH || rect.top > viewH * 4) continue;

        const editable = el.matches(EDITABLE_SELECTOR);
        if (!editable) {
          const leafAncestor = el.parentElement?.closest(LEAF_CONTROL_SELECTOR);
          if (leafAncestor && matched.has(leafAncestor)) continue;
        }

        // A <label for> duplicates its visible control; keep it only for hidden custom checkboxes
        if (el.tagName === 'LABEL' && el.control && matched.has(el.control)) {
          const cr = el.control.getBoundingClientRect();
          if (cr.width > 0 && cr.height > 0 && parseFloat(window.getComputedStyle(el.control).opacity) !== 0) continue;
        }

        const inViewport = rect.bottom > 0 && rect.top < viewH && rect.right > 0 && rect.left < viewW;
        if (inViewport && isOccluded(el, rect)) {
          occludedCount++;
          continue;
        }

        const label = extractElementLabel(el);
        const tag = el.tagName.toLowerCase();
        // Pointer-only elements without any label are untargetable noise
        if (!label && !editable && !['button', 'a', 'select', 'input'].includes(tag) && !el.getAttribute('role')) continue;

        candidates.push({ el, rect, inViewport, label, tag, editable });
      }

      // A blocking modal covers the page: off-screen elements behind it are not actionable either
      if (topDialog && occludedCount > 0) {
        for (let i = candidates.length - 1; i >= 0; i--) {
          if (!candidates[i].inViewport && !topDialog.contains(candidates[i].el)) candidates.splice(i, 1);
        }
      }

      // Budget: everything in viewport first, then nearest off-screen elements
      candidates.sort((a, b) => {
        if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1;
        return Math.abs(a.rect.top) - Math.abs(b.rect.top);
      });
      const kept = candidates.slice(0, MAX_ELEMENTS);
      kept.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

      // Drop registry entries for elements that left the page
      for (const [id, el] of idToElement) {
        if (!el.isConnected) idToElement.delete(id);
      }

      const currentIds = new Set();
      const elements = kept.map(item => {
        const el = item.el;
        const id = assignId(el);
        currentIds.add(id);
        const role = el.getAttribute('role') || '';
        const type = el.getAttribute('type') || '';
        const entry = {
          id,
          tag: item.tag,
          role,
          type: type || role || (el.isContentEditable ? 'contenteditable' : ''),
          label: item.label.replace(/\s+/g, ' ').slice(0, 80),
          text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60),
          selector: `[data-pratyaksha-id="${id}"]`,
          inViewport: item.inViewport,
          isNew: previousScanIds.size > 0 && !previousScanIds.has(id),
          inDialog: !!(topDialog && topDialog.contains(el))
        };
        if (item.tag === 'a') entry.href = shortHref(el);
        if (item.editable) {
          const value = el.isContentEditable ? (el.innerText || '') : (el.value || '');
          if (value && type !== 'password') entry.value = value.replace(/\s+/g, ' ').slice(0, 40);
          if (type === 'password' && value) entry.value = '••••';
          const ph = el.getAttribute('placeholder');
          if (ph && ph !== item.label) entry.placeholder = ph.slice(0, 40);
        }
        if (item.tag === 'select') {
          entry.value = el.options?.[el.selectedIndex]?.text?.trim().slice(0, 40) || '';
          entry.options = describeOptions(el);
        }
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') entry.disabled = true;
        if (el.checked === true || el.getAttribute('aria-checked') === 'true') entry.checked = true;
        if (el.getAttribute('aria-expanded')) entry.expanded = el.getAttribute('aria-expanded') === 'true';
        if (el.getAttribute('aria-selected') === 'true') entry.selected = true;
        return entry;
      });

      for (const id of previousScanIds) {
        if (!currentIds.has(id)) {
          const el = idToElement.get(id);
          // Off-list elements keep their ID (stable) but lose the marker attribute
          if (el && el.isConnected) el.removeAttribute('data-pratyaksha-id');
        }
      }
      previousScanIds = currentIds;

      const scrollEl = document.scrollingElement || document.documentElement;
      const page = {
        url: location.href,
        title: document.title,
        scrollY: Math.round(window.scrollY),
        pixelsAbove: Math.round(scrollEl.scrollTop || window.scrollY || 0),
        pixelsBelow: Math.max(0, Math.round((scrollEl.scrollHeight || 0) - (scrollEl.scrollTop || 0) - viewH)),
        viewportHeight: viewH,
        dialogOpen: !!topDialog,
        dialogLabel: topDialog ? (topDialog.getAttribute('aria-label') || topDialog.querySelector('h1,h2,h3,[role="heading"]')?.innerText || '').trim().slice(0, 60) : '',
        totalCandidates: candidates.length,
        visibleText: collectVisibleText()
      };

      return { elements, page };
    },

    /** Move the visible agent pointer to a page target. */
    highlight(target, label = 'TARGET') {
      const el = findElement(target);
      if (!el) return false;
      moveAgentCursor(el);
      return true;
    },

    clearHighlight() {
      try {
        clearAllTrackers();
        cursorMoveId++;
        if (agentCursor) {
          try { agentCursor.classList.remove('is-visible', 'is-clicking'); } catch (_) {}
          try { agentCursor.remove(); } catch (_) {}
          agentCursor = null;
        }
        const leftovers = document.querySelectorAll('#pratyaksha-agent-cursor');
        leftovers.forEach(el => {
          try { el.remove(); } catch (_) {}
        });
        setControlActive(false);
        return true;
      } catch (err) {
        console.warn('[PRATYAKSHA] clearHighlight error:', err);
        return false;
      }
    },

    removeCursor() {
      return this.clearHighlight();
    },

    setControlActive(active = true) {
      setControlActive(active);
      return true;
    },

    /**
     * Scroll element into the viewport (instant, only when needed).
     */
    async scrollIntoView(target) {
      const el = findElement(target);
      if (!el) return false;
      scrollIntoViewIfNeeded(el);
      return true;
    },

    waitForDomSettle,

    /**
     * Clicks an element with a full pointer/mouse event chain on the element that is
     * actually under the cursor, then waits for the DOM to settle.
     */
    async click(target) {
      const el = requireElement(target, 'Click');
      const desc = describeTarget(el);

      if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Click failed: ${desc} is disabled. Fill the required fields first or pick another element.`);
      }
      if (el.tagName === 'SELECT') {
        throw new Error(`${desc} is a dropdown <select>. Use select_option with the option text instead of clicking it.`);
      }

      scrollIntoViewIfNeeded(el);
      const rect = el.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);

      // Dispatch on the topmost node under the point when it belongs to the target,
      // so handlers bound to inner spans/icons fire too.
      let dispatchTarget = el;
      try {
        const hit = document.elementFromPoint(x, y);
        if (hit && el.contains(hit)) dispatchTarget = hit;
      } catch (_) {}

      // Untrusted clicks on target=_blank links are popup-blocked: open in the same tab
      const anchor = el.closest('a[href]');
      let restoreTarget = null;
      if (anchor && anchor.getAttribute('target') && anchor.getAttribute('target') !== '_self') {
        restoreTarget = anchor.getAttribute('target');
        anchor.setAttribute('target', '_self');
      }

      const { duration } = moveAgentCursor(el, { click: true });
      await sleep(Math.min(duration, 220));

      const before = snapshotState();
      fireMouseSequence(dispatchTarget, x, y);

      if (restoreTarget !== null) {
        setTimeout(() => { try { anchor.setAttribute('target', restoreTarget); } catch (_) {} }, 50);
      }

      const isSendAction = /(^|\b)(send|submit|dispatch)\b/i.test(desc) ||
                           /(^|\b)(send|submit|dispatch)\b/i.test(el.getAttribute('aria-label') || '') ||
                           /(^|\b)(send|submit)\b/i.test(el.innerText || '');

      if (isSendAction) {
        // Wait for send network in-flight request and confirmation banner to settle
        const maxWaitMs = 8000;
        const startWait = Date.now();
        while (Date.now() - startWait < maxWaitMs) {
          const bodyText = (document.body?.innerText || '');
          const isStillSending = /\b(sending|saving\s+draft)\b/i.test(bodyText) && !/\bmessage\s+sent\b/i.test(bodyText);
          const hasSentConfirmation = /\b(message\s+sent|sent\b|undo\b)/i.test(bodyText);
          if (hasSentConfirmation || !isStillSending) {
            break;
          }
          await sleep(250);
        }
      }

      await waitForDomSettle(1500, 250);
      const changeText = summarizeChange(before);
      return {
        clicked: desc,
        change: isSendAction ? (changeText ? `${changeText}; email dispatched` : 'email dispatched') : changeText,
        sendConfirmed: isSendAction
      };
    },

    /**
     * Types text into any input: <input>, <textarea>, contenteditable, combobox.
     * Inserts the whole string at once (fast) and fires the events frameworks listen to.
     * Options: { clearFirst: bool (default true), pressEnter: bool }
     */
    async type(target, value, options = {}) {
      let el = requireElement(target, 'Type');

      // Clicked on a wrapper or label? Type into the real editable inside/behind it.
      if (!isEditable(el)) {
        const inner = (el.tagName === 'LABEL' && el.control) ||
                      el.querySelector?.('input:not([type="hidden"]), textarea, [contenteditable="true"], [contenteditable=""]');
        if (inner && isEditable(inner)) el = inner;
      }
      if (!isEditable(el)) {
        throw new Error(`Type failed: ${describeTarget(el)} is not a text field. Pick an input/textarea/editor from the element list (or click it first if it opens one).`);
      }

      scrollIntoViewIfNeeded(el);
      const { duration } = moveAgentCursor(el);
      await sleep(Math.min(duration, 200));

      try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      const shouldClear = options.clearFirst !== false;
      const textToType = String(value ?? '');

      if (el.isContentEditable) {
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          if (!shouldClear) range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
          if (shouldClear) document.execCommand('delete', false);
          const ok = document.execCommand('insertText', false, textToType);
          if (!ok) throw new Error('insertText rejected');
        } catch (_) {
          if (shouldClear) el.textContent = '';
          el.textContent += textToType;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: textToType, inputType: 'insertText' }));
        }
      } else {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const newValue = (shouldClear ? '' : (el.value || '')) + textToType;
        const lastChar = textToType.slice(-1);
        if (lastChar) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: lastChar, bubbles: true, cancelable: true }));
        }
        if (setter) setter.call(el, newValue); else el.value = newValue;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: textToType, inputType: 'insertText' }));
        if (lastChar) {
          el.dispatchEvent(new KeyboardEvent('keyup', { key: lastChar, bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Recipient chips (Gmail "To") commit on Enter
      const looksLikeEmail = /@[\w.-]+\.[a-zA-Z]{2,}$/.test(textToType.trim());
      const isRecipientInput = el.getAttribute('role') === 'combobox' ||
                               el.getAttribute('type') === 'email' ||
                               /(^|\b)(to|recipients?)\b/i.test(el.getAttribute('aria-label') || '') ||
                               /^(to|recipients?)$/i.test(el.getAttribute('name') || '');
      if (options.pressEnter || (looksLikeEmail && isRecipientInput)) {
        await sleep(80);
        await this.pressEnter(el);
      } else {
        await waitForDomSettle(600, 150);
      }

      const actual = el.isConnected
        ? (el.isContentEditable ? (el.innerText || '') : (el.value ?? ''))
        : '';
      return { typedInto: describeTarget(el), value: String(actual).slice(0, 80) };
    },

    /**
     * Dispatches Enter on the target and submits its form only if no handler cancelled the key.
     */
    async pressEnter(target) {
      const el = requireElement(target, 'Press Enter');
      const before = snapshotState();
      const eventOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true, view: window };

      const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
      el.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
      el.dispatchEvent(new KeyboardEvent('keyup', eventOpts));

      if (notCancelled && el.form && el.tagName === 'INPUT') {
        try {
          if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
          else el.form.submit();
        } catch (_) {}
      }

      await waitForDomSettle(1500, 250);
      return { change: summarizeChange(before) };
    },

    /**
     * Presses a named key (Escape, Enter, Tab, ArrowDown, ...) on a target or the focused element.
     */
    async pressKey(key, target = null) {
      if (key === 'Enter' && target !== null && target !== undefined) return this.pressEnter(target);
      const el = (target !== null && target !== undefined) ? requireElement(target, 'Press key') : (document.activeElement || document.body);
      const before = snapshotState();
      const codes = { Escape: 27, Enter: 13, Tab: 9, Backspace: 8, Delete: 46, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Space: 32, PageDown: 34, PageUp: 33, Home: 36, End: 35 };
      const keyValue = key === 'Space' ? ' ' : key;
      const eventOpts = { key: keyValue, code: key, keyCode: codes[key] || 0, which: codes[key] || 0, bubbles: true, cancelable: true, composed: true, view: window };
      el.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
      el.dispatchEvent(new KeyboardEvent('keyup', eventOpts));
      await waitForDomSettle(800, 200);
      return { change: summarizeChange(before) };
    },

    /** Backward-compatible alias */
    async pressEscape() {
      return this.pressKey('Escape');
    },

    /**
     * Selects an option by visible text or value. Works for native <select> and
     * custom dropdowns (opens the trigger, then clicks the matching option).
     */
    async selectOption(target, optionText) {
      const el = requireElement(target, 'Select option');
      const wanted = String(optionText || '').trim().toLowerCase();
      if (!wanted) throw new Error('select_option requires the option text.');

      if (el.tagName === 'SELECT') {
        const options = Array.from(el.options);
        const match = options.find(o => o.text.trim().toLowerCase() === wanted || o.value.toLowerCase() === wanted) ||
                      options.find(o => o.text.trim().toLowerCase().includes(wanted));
        if (!match) {
          throw new Error(`Option "${optionText}" not found. Available: ${describeOptions(el).join(', ')}`);
        }
        scrollIntoViewIfNeeded(el);
        moveAgentCursor(el, { click: true });
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(el, match.value); else el.value = match.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        await waitForDomSettle(800, 200);
        return { selected: match.text.trim() };
      }

      // Custom dropdown: open it, then click the option whose text matches
      await this.click(el);
      const optionSelector = '[role="option"], [role="menuitem"], [role="menuitemradio"], li, [data-value]';
      const pool = deepQueryAll(optionSelector).filter(o => {
        const r = o.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const text = o => (o.innerText || o.textContent || '').trim().toLowerCase();
      const option = pool.find(o => text(o) === wanted) || pool.find(o => text(o).includes(wanted));
      if (!option) {
        throw new Error(`Opened ${describeTarget(el)} but no visible option matches "${optionText}". Check the element list for the open menu.`);
      }
      await this.click(option);
      return { selected: (option.innerText || '').trim().slice(0, 60) };
    },

    /**
     * Scrolls the window, or the main scrollable container when the window itself cannot scroll.
     */
    async scroll(deltaY, target = null) {
      let scroller = null;
      if (target !== null && target !== undefined) {
        scroller = findElement(target);
      }
      if (!scroller) {
        const doc = document.scrollingElement || document.documentElement;
        const before = doc.scrollTop;
        window.scrollBy({ top: deltaY, behavior: 'instant' });
        if (doc.scrollTop !== before || Math.abs(deltaY) > 100000) {
          await waitForDomSettle(500, 150);
          return { scrolled: doc.scrollTop - before, container: 'window' };
        }
        scroller = findScrollContainer();
      }
      if (!scroller) return { scrolled: 0, container: 'none' };
      const before = scroller.scrollTop;
      scroller.scrollBy({ top: deltaY, behavior: 'instant' });
      await waitForDomSettle(500, 150);
      return { scrolled: scroller.scrollTop - before, container: describeTarget(scroller) };
    },
    /**
     * Extracts page headings and summary
     */
    extractPageSummary() {
      const title = document.title || '';
      const h1s = Array.from(document.querySelectorAll('h1')).map(h => h.innerText.trim()).filter(Boolean);
      const h2s = Array.from(document.querySelectorAll('h2')).slice(0, 5).map(h => h.innerText.trim()).filter(Boolean);
      const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
      return { title, metaDesc, mainHeadings: h1s, subHeadings: h2s, url: window.location.href };
    },

    /**
     * Extracts visible page text
     */
    extractPageText(maxChars = 3000) {
      try {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script,style,noscript,svg,iframe,nav,footer').forEach(e => e.remove());
        const raw = (clone.innerText || clone.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        return raw.slice(0, maxChars);
      } catch (_) { return ''; }
    },

    /**
     * read_page: smart extraction — prefers semantic main content regions,
     * falls back to full body. Optionally scoped to a CSS selector.
     */
    readPage(selector = null, maxChars = 4000) {
      try {
        let root;
        if (selector) {
          root = document.querySelector(selector);
          if (!root) return `No element matched selector "${selector}".`;
        } else {
          // Prefer semantic content regions
          root = document.querySelector('main') ||
                 document.querySelector('article') ||
                 document.querySelector('[role="main"]') ||
                 document.querySelector('#main') ||
                 document.querySelector('#content') ||
                 document.body;
        }
        const clone = root.cloneNode(true);
        clone.querySelectorAll('script,style,noscript,svg,iframe,nav,footer,header').forEach(e => e.remove());
        const raw = (clone.innerText || clone.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        return raw.slice(0, maxChars);
      } catch (e) { return `readPage error: ${e.message}`; }
    },

    /**
     * get_page_metadata: returns structured metadata about the current page
     */
    getPageMetadata() {
      const get = (sel, attr = 'content') => document.querySelector(sel)?.[attr] || '';
      const getLinkHref = (rel) => document.querySelector(`link[rel="${rel}"]`)?.href || '';

      return {
        title:         document.title,
        url:           window.location.href,
        canonical:     getLinkHref('canonical'),
        description:   get('meta[name="description"]') || get('meta[property="og:description"]'),
        og_title:      get('meta[property="og:title"]'),
        og_image:      get('meta[property="og:image"]'),
        author:        get('meta[name="author"]'),
        published:     get('meta[property="article:published_time"]') || get('meta[name="date"]'),
        lang:          document.documentElement.lang || '',
        charset:       document.characterSet || ''
      };
    },

    /**
     * get_links: returns links as [{text, url}] with optional keyword filter
     */
    getLinks(filter = '', max = 25) {
      const kw = filter.toLowerCase();
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const results = [];

      for (const a of anchors) {
        if (results.length >= max) break;
        const text = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
        const url  = a.href || '';
        if (!url || url.startsWith('javascript:') || url.startsWith('#')) continue;
        if (kw && !text.toLowerCase().includes(kw) && !url.toLowerCase().includes(kw)) continue;
        results.push({ text: text.slice(0, 80), url });
      }

      return results;
    },

    /**
     * find_on_page: searches page text, scrolls to first match, returns context
     */
    findOnPage(searchText, caseSensitive = false) {
      if (!searchText) return { found: false, count: 0, context: '' };

      const bodyText = document.body.innerText || '';
      const needle   = caseSensitive ? searchText : searchText.toLowerCase();
      const haystack = caseSensitive ? bodyText   : bodyText.toLowerCase();

      let count   = 0;
      let idx     = 0;
      let firstIdx = -1;
      while ((idx = haystack.indexOf(needle, idx)) !== -1) {
        count++;
        if (firstIdx === -1) firstIdx = idx;
        idx += needle.length;
      }

      if (count === 0) return { found: false, count: 0, context: '' };

      // Extract context around first match
      const start   = Math.max(0, firstIdx - 80);
      const end     = Math.min(bodyText.length, firstIdx + needle.length + 80);
      const context = bodyText.slice(start, end).replace(/\s+/g, ' ');

      // Use browser find API to highlight and scroll
      try { window.find(searchText, caseSensitive, false, true, false, true, false); } catch (_) {}

      return { found: true, count, context };
    },

    /**
     * extract_structured: extract fields from DOM into a JSON object.
     * fields: [{ name, selector, attribute? }]
     */
    extractStructured(fields = [], rootSelector = null) {
      const root = rootSelector ? (document.querySelector(rootSelector) || document) : document;
      const result = {};

      for (const field of fields) {
        if (!field.name || !field.selector) continue;
        try {
          const els = Array.from(root.querySelectorAll(field.selector));
          if (els.length === 0) {
            result[field.name] = null;
          } else if (els.length === 1) {
            const el  = els[0];
            const val = field.attribute
              ? el.getAttribute(field.attribute)
              : (el.innerText || el.textContent || el.value || '').trim();
            result[field.name] = val;
          } else {
            // Multiple matches → return array
            result[field.name] = els.map(el =>
              field.attribute
                ? el.getAttribute(field.attribute)
                : (el.innerText || el.textContent || el.value || '').trim()
            );
          }
        } catch (e) {
          result[field.name] = `ERROR: ${e.message}`;
        }
      }

      return result;
    },

    /**
     * inspect_dom: returns accessibility/attribute info about a single element
     */
    inspectElement(target) {
      const el = (target instanceof Element) ? target : findElement(target);
      if (!el) return null;

      const children = Array.from(el.children).slice(0, 5).map(c => ({
        tag:  c.tagName.toLowerCase(),
        text: (c.innerText || '').trim().slice(0, 40),
        role: c.getAttribute('role') || ''
      }));

      const attrs = {};
      for (const { name, value } of el.attributes) {
        if (!['style', 'class'].includes(name)) attrs[name] = value;
      }

      return {
        tag:         el.tagName.toLowerCase(),
        id:          el.id || null,
        role:        el.getAttribute('role') || el.getAttribute('aria-role') || null,
        aria_label:  el.getAttribute('aria-label') || null,
        placeholder: el.getAttribute('placeholder') || null,
        text:        (el.innerText || el.textContent || '').trim().slice(0, 200),
        value:       el.value || null,
        href:        el.href || null,
        type:        el.type || null,
        disabled:    el.disabled || false,
        pratyaksha_id: el.getAttribute('data-pratyaksha-id') || null,
        attributes:  attrs,
        children
      };
    },

    pollResponseCondition,
    clearAllTrackers
  };
})();

