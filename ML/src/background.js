
"use strict";

const MESSAGE_TYPES = new Set(["PAGE_CONTEXT"]);

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.type !== "PAGE_CONTEXT") {
      return;
    }

    // Only accept messages from this extension's content scripts.
    if (!sender.tab || sender.id !== chrome.runtime.id) {
      sendResponse({
        ok: false,
        error: "Untrusted message source"
      });
      return;
    }

    const payload = message.payload;

    if (
      !payload ||
      payload.type !== "PAGE_CONTEXT" ||
      !Array.isArray(payload.elements) ||
      payload.elements.length > 300
    ) {
      sendResponse({
        ok: false,
        error: "Invalid page context"
      });
      return;
    }

    // TODO: Forward to the local inference/privacy pipeline.
    // Do not log, persist, or transmit the raw payload.

    sendResponse({
      ok: true,
      stage: "observation_received"
    });
  }
);
