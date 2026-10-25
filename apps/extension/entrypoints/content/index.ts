// BigFish content script: answers the service worker's tool messages.
// Every message is { type, payload, ctx: { slot, idBase } }, and every answer
// carries nextId so the worker can keep refs unique across page loads.
import { bigFishDOM, type RefContext } from "./dom-actions";
import { agentCursor } from "./cursor";

// Messages that only read the page still show the agent is active here.
const READING = new Set(["BIGFISH_SCAN", "BIGFISH_TEXT", "BIGFISH_FIND", "BIGFISH_EXTRACT", "BIGFISH_CHECK", "BIGFISH_WAIT_QUIET"]);

type Message = { type: string; payload?: any; ctx?: RefContext };

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
      if (!message || typeof message !== "object" || !message.type?.startsWith("BIGFISH_")) return false;
      bigFishDOM.useContext(message.ctx);
      if (READING.has(message.type)) agentCursor.activity(message.type === "BIGFISH_WAIT_QUIET" ? "BigFish is waiting for the page" : "BigFish is reading the page");
      handle(message)
        .then((answer) => sendResponse({ ...answer, nextId: bigFishDOM.nextFreeId }))
        .catch((err) => sendResponse({ ok: false, error: "PAGE_UNRESPONSIVE", reason: err instanceof Error ? err.message : String(err) }));
      return true;
    });
  },
});

async function handle({ type, payload = {} }: Message): Promise<Record<string, unknown>> {
  const within = () => {
    if (!payload.within) return null;
    const el = bigFishDOM.resolve(payload.within);
    if (!el) throw new StaleWithin(payload.within);
    return el;
  };

  try {
    switch (type) {
      case "BIGFISH_PING":
        return { ok: true, url: location.href, title: document.title };

      case "BIGFISH_SCAN":
        return {
          ok: true,
          elements: bigFishDOM.scan(within(), { viewportOnly: payload.viewportOnly }),
          url: location.href,
          title: document.title,
          scrollY: Math.round(window.scrollY),
          scrollHeight: document.documentElement.scrollHeight,
          dialog: bigFishDOM.openDialog(),
          alerts: bigFishDOM.alerts(),
          lines: bigFishDOM.visibleLines(),
        };

      case "BIGFISH_TEXT":
        return {
          ok: true,
          text: bigFishDOM.pageText(within()),
          url: location.href,
          title: document.title,
          scrollY: Math.round(window.scrollY),
          scrollHeight: document.documentElement.scrollHeight,
        };

      case "BIGFISH_DESCRIBE": {
        const descriptor = bigFishDOM.describe(payload.ref);
        if (descriptor) return { ok: true, descriptor };
        return { ok: false, error: "STALE_REF", candidates: payload.ref ? bigFishDOM.candidatesFor(payload.ref) : [] };
      }

      case "BIGFISH_CLICK":
        return bigFishDOM.click(payload.ref);

      case "BIGFISH_TYPE":
        return bigFishDOM.type(payload.ref, String(payload.text ?? ""), { clear: payload.clear, submit: payload.submit });

      case "BIGFISH_FILL":
        return bigFishDOM.fill(payload.ref, String(payload.value ?? ""));

      case "BIGFISH_SELECT":
        return bigFishDOM.select(payload.ref, String(payload.option ?? ""));

      case "BIGFISH_PRESS_KEY":
        return bigFishDOM.pressKey(String(payload.key ?? ""), payload.ref);

      case "BIGFISH_SCROLL":
        return bigFishDOM.scroll(payload.direction, payload.amount ?? "page", payload.ref);

      case "BIGFISH_FIND":
        return { ok: true, matches: bigFishDOM.find(String(payload.query ?? ""), payload.kind ?? "element") };

      case "BIGFISH_WAIT_QUIET":
        return { ok: true, ...(await bigFishDOM.waitQuiet(Number(payload.quietMs ?? 800), Number(payload.timeoutMs ?? 5000))) };

      case "BIGFISH_FORMAT_BUTTON":
        return { ok: true, ...bigFishDOM.formatButton() };

      case "BIGFISH_CHECK":
        return { ok: true, met: bigFishDOM.check(payload) };

      case "BIGFISH_EXTRACT":
        return { ok: true, text: bigFishDOM.extract(payload.what, within(), String(payload.filter ?? ""), Number(payload.max ?? 25)) };

      default:
        return { ok: false, error: "INVALID_ARGS", reason: `Unknown message ${type}` };
    }
  } catch (err) {
    if (err instanceof StaleWithin) return { ok: false, error: "STALE_REF", reason: `within=${err.ref} is gone`, candidates: [] };
    throw err;
  }
}

class StaleWithin extends Error {
  constructor(readonly ref: string) {
    super(`stale ${ref}`);
  }
}
