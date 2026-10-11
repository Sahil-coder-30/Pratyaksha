
(function () {
  "use strict";

  const schemas = globalThis.PrivacyAgentSchemas;
  const dom = globalThis.PrivacyAgentDOM;

  if (!schemas || !dom) {
    console.error("Privacy Agent: modules failed to load.");
    return;
  }

  const runtimeAPI =
    globalThis.browser?.runtime ||
    globalThis.chrome?.runtime;

  if (!runtimeAPI) {
    console.error("Privacy Agent: runtime API unavailable.");
    return;
  }

  let timer = null;
  let stopped = false;
  let lastSignature = "";

  const DEBOUNCE_MS = 500;

  function collectContext() {
    const result = dom.analyze();

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };

    const context = schemas.createPageContext({
      // Local observation metadata only. Sanitize before network use.
      url: window.location.href,
      title: document.title.slice(0, 300),
      viewport,
      elements: result.elements,
      capturedAt: Date.now()
    });

    return {
      context,
      truncated: result.truncated,
      skippedCount: result.skippedCount
    };
  }

  function makeSignature(context) {
    // Used only to avoid sending identical snapshots repeatedly.
    // Never log or transmit this signature as a substitute for sanitization.
    return JSON.stringify({
      url: context.url,
      title: context.title,
      viewport: context.viewport,
      elements: context.elements
    });
  }

  async function sendSnapshot() {
    if (stopped) return;

    try {
      const result = collectContext();
      const signature = makeSignature(result.context);

      if (signature === lastSignature) return;

      lastSignature = signature;

      await runtimeAPI.sendMessage({
        type: schemas.MESSAGE_TYPES.PAGE_CONTEXT,
        payload: result.context,
        metadata: {
          truncated: result.truncated,
          skippedCount: result.skippedCount
        }
      });
    } catch {
      // Do not log the snapshot or raw page content.
      // The local pipeline can retry on a later observation.
    }
  }

  function scheduleSnapshot() {
    if (stopped) return;

    clearTimeout(timer);

    timer = setTimeout(() => {
      void sendSnapshot();
    }, DEBOUNCE_MS);
  }

  const observer = new MutationObserver(mutations => {
    // Ignore changes confined to script/style metadata.
    const relevant = mutations.some(mutation => {
      const target = mutation.target;

      if (!(target instanceof Element) &&
          !(target instanceof Text)) {
        return false;
      }

      const element =
        target instanceof Element
          ? target
          : target.parentElement;

      if (!element) return false;

      return !element.closest(
        "script, style, noscript"
      );
    });

    if (relevant) scheduleSnapshot();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "type",
      "role",
      "aria-label",
      "aria-hidden",
      "autocomplete",
      "placeholder",
      "hidden",
      "disabled",
      "class",
      "style"
    ]
  });

  // Capture the initial visible page context.
  void sendSnapshot();

  // Scroll changes viewport-relative bounding boxes.
  window.addEventListener(
    "scroll",
    scheduleSnapshot,
    { passive: true }
  );

  window.addEventListener(
    "resize",
    scheduleSnapshot,
    { passive: true }
  );

  // Content scripts may be recreated during navigation.
  // This cleanup also supports future lifecycle management.
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearTimeout(timer);
    observer.disconnect();
  }, { once: true });
})();
