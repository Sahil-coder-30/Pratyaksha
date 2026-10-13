/**
 * PRATYAKSHA Content Script Message Router
 * Sovereign Privacy-First Browser Agent
 */

(function() {
  if (window.__PRATYAKSHA_INITIALIZED__) return;
  window.__PRATYAKSHA_INITIALIZED__ = true;

  console.log('[PRATYAKSHA] Content script active on:', window.location.href);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, payload } = message;

    if (type === 'PING') {
      sendResponse({ status: 'PONG', ready: true, url: window.location.href });
      return true;
    }

    if (type === 'GET_PAGE_CONTEXT') {
      try {
        const elements = window.PratyakshaDOM ? window.PratyakshaDOM.scanInteractiveElements() : [];
        sendResponse({ url: window.location.href, title: document.title, elements });
      } catch (err) {
        sendResponse({ url: window.location.href, title: document.title, elements: [], error: err.message });
      }
      return true;
    }

    if (type === 'CLEAR_HIGHLIGHT' || type === 'REMOVE_CURSOR') {
      try {
        if (window.PratyakshaDOM?.clearHighlight) {
          window.PratyakshaDOM.clearHighlight();
        } else {
          const leftovers = document.querySelectorAll('#pratyaksha-agent-cursor, #pratyaksha-control-frame');
          leftovers.forEach(el => { try { el.remove(); } catch (_) {} });
        }
      } catch (err) {
        console.warn('[PRATYAKSHA] Clear highlight warning:', err);
      }
      try { sendResponse({ success: true }); } catch (_) {}
      return true;
    }

    if (type === 'SET_CONTROL_ACTIVE') {
      try {
        if (window.PratyakshaDOM?.setControlActive) {
          window.PratyakshaDOM.setControlActive(message.active !== false);
        }
      } catch (err) {
        console.warn('[PRATYAKSHA] Set control active warning:', err);
      }
      try { sendResponse({ success: true }); } catch (_) {}
      return true;
    }

    if (type === 'EXECUTE_ACTION') {
      handleAction(payload)
        .then(result  => sendResponse({ success: true, result }))
        .catch(err    => {
          console.error('[PRATYAKSHA] Action error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // async response
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  async function handleAction(payload) {
    if (!window.PratyakshaDOM) throw new Error('PratyakshaDOM not initialised.');

    const {
      action, target_id, selector, semantic_hint,
      value, clear_first, deltaY, durationMs, maxChars,
      // New tool payloads
      filter, max, text, caseSensitive, fields, rootSelector,
      code, textContains, timeoutMs
    } = payload;

    // Resolve a target element from id / selector / semantic hint
    const parsedId = Number(target_id);
    const numId = (target_id !== undefined && target_id !== null && Number.isFinite(parsedId) && parsedId > 0) ? parsedId : null;
    const target = numId !== null ? numId : (selector || semantic_hint || (target_id != null ? String(target_id) : null));

    switch (action) {

      // ── Existing actions ──────────────────────────────────────────────────
      case 'CLICK':
        if (target === null) throw new Error('CLICK requires target_id or semantic_hint');
        return await window.PratyakshaDOM.click(target);

      case 'TYPE':
        if (target === null) throw new Error('TYPE requires target_id or semantic_hint');
        return await window.PratyakshaDOM.type(target, value || '', { clearFirst: !!clear_first });

      case 'PRESS_ENTER':
        if (target === null) throw new Error('PRESS_ENTER requires target_id or semantic_hint');
        return await window.PratyakshaDOM.pressEnter(target);

      case 'PRESS_ESCAPE':
        return await window.PratyakshaDOM.pressEscape();

      case 'SCROLL':
        return await window.PratyakshaDOM.scroll(deltaY || 500);

      case 'SCROLL_INTO_VIEW':
        return await window.PratyakshaDOM.scrollIntoView(target);

      case 'HIGHLIGHT':
        return window.PratyakshaDOM.highlight(target, `🎯 ${semantic_hint || selector || String(target_id)}`);

      case 'CLEAR_HIGHLIGHT':
      case 'REMOVE_CURSOR':
        window.PratyakshaDOM.clearHighlight();
        return true;

      case 'START_CONTROL':
        window.PratyakshaDOM?.setControlActive?.(true);
        return true;

      case 'STOP_CONTROL':
        window.PratyakshaDOM?.setControlActive?.(false);
        return true;

      case 'WAIT':
        await new Promise(r => setTimeout(r, durationMs || 500));
        return true;

      case 'EXTRACT':
        return window.PratyakshaDOM.extractPageSummary();

      // Legacy GET_TEXT (kept for backward compat)
      case 'GET_TEXT': {
        const limit = Math.min(maxChars || 3000, 8000);
        return window.PratyakshaDOM.extractPageText(limit);
      }

      // ── New tool actions ──────────────────────────────────────────────────

      case 'READ_PAGE':
        return window.PratyakshaDOM.readPage(selector, Math.min(maxChars || 4000, 8000));

      case 'GET_METADATA':
        return window.PratyakshaDOM.getPageMetadata();

      case 'GET_LINKS':
        return window.PratyakshaDOM.getLinks(filter || '', max || 25);

      case 'FIND_ON_PAGE':
        return window.PratyakshaDOM.findOnPage(text || '', !!caseSensitive);

      case 'EXTRACT_STRUCTURED':
        return window.PratyakshaDOM.extractStructured(fields || [], rootSelector || null);

      case 'INSPECT_DOM': {
        const inspectTarget = numId !== null ? numId : (selector || semantic_hint || null);
        return window.PratyakshaDOM.inspectElement(inspectTarget);
      }

      case 'EXECUTE_JS': {
        if (!code) throw new Error('EXECUTE_JS requires code string.');
        try {
          // eslint-disable-next-line no-new-func
          const fn     = new Function(`"use strict"; return (${code})`);
          const result = fn();
          // Resolve promises
          const resolved = (result && typeof result.then === 'function') ? await result : result;
          // Return JSON-serialisable value
          if (resolved === undefined) return undefined;
          try { return JSON.parse(JSON.stringify(resolved)); } catch { return String(resolved); }
        } catch (err) {
          throw new Error(`JS execution failed: ${err.message}`);
        }
      }

      case 'WAIT_FOR': {
        const timeout = Math.min(timeoutMs || 8000, 30000);
        const found   = await pollCondition({ selector, textContains }, timeout);
        return found;
      }

      default:
        throw new Error(`Unknown action: "${action}"`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Poll until a CSS selector appears or text is visible, or timeout
  // ─────────────────────────────────────────────────────────────────────────
  function pollCondition({ selector, textContains }, timeoutMs) {
    return new Promise(resolve => {
      const start    = Date.now();
      const interval = 250;

      const check = () => {
        let found  = false;
        let detail = '';

        if (selector) {
          const el = document.querySelector(selector);
          if (el) { found = true; detail = `selector "${selector}" appeared`; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }

        if (!found && textContains) {
          const bodyText = document.body.innerText || '';
          if (bodyText.toLowerCase().includes(textContains.toLowerCase())) {
            found  = true;
            detail = `text "${textContains}" appeared on page`;
          }
        }

        if (found) return resolve({ found: true, detail });
        if (Date.now() - start >= timeoutMs) return resolve({ found: false, detail: 'timed out' });
        setTimeout(check, interval);
      };

      check();
    });
  }
})();
