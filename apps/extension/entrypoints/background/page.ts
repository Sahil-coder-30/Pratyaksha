// Talking to the BigFish content script in a tab. Waits for the page to finish
// loading, and injects the content script if it is missing (tabs opened before
// the extension was installed or reloaded).
import { ErrorCode, toolError } from "@bigfish/contracts";
import { tabsManager } from "./tabs.js";

const LOAD_TIMEOUT_MS = 15_000;
const CONTENT_SCRIPT = "/content-scripts/content.js";

// True once the tab reports status "complete", false on timeout.
export async function waitForTabLoad(tabId: number, timeoutMs = LOAD_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve(loaded);
    };
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === "complete") done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);
    // Listener first, then check, so a load that finishes in between is not missed.
    browser.tabs.get(tabId).then(
      (tab) => tab.status === "complete" && done(true),
      () => done(false),
    );
  });
}

// After starting a navigation. The tab can still report "complete" for the old
// page for a moment, so give it time to start loading first.
export async function waitForNavigation(tabId: number): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 300));
  return waitForTabLoad(tabId);
}

export async function sendToTab<T = any>(tabId: number, message: unknown): Promise<T> {
  await waitForTabLoad(tabId);
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  } catch (err) {
    if (!noContentScript(err)) throw err;
    // The page has loaded, so the manifest script already had its chance: injecting cannot double it.
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  }
}

// A content script call with the tab's ref context. Keeps the tab's next ref id up to date.
export async function tabCall<T = any>(tabId: number, type: string, payload: Record<string, unknown> = {}): Promise<T & { ok: boolean; nextId?: number }> {
  const ctx = await tabsManager.refContext(tabId);
  const answer = await sendToTab<T & { ok: boolean; nextId?: number }>(tabId, { type, payload, ctx });
  tabsManager.noteNextId(tabId, answer?.nextId);
  return answer;
}

// Tool error text for a failed content script call.
export function pageError(err: unknown, what: string): { ok: false; text: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (/cannot access|cannot be scripted|chrome:\/\/|extensions gallery/i.test(message)) {
    return { ok: false, text: toolError(ErrorCode.RESTRICTED_PAGE, "BigFish cannot read or act on this page.", "Use a normal website tab.") };
  }
  return {
    ok: false,
    text: toolError(
      ErrorCode.PAGE_UNRESPONSIVE,
      `${what} failed: ${message}`,
      "Wait with browser_wait_for, then try once more. Do not reload the page again and again.",
    ),
  };
}

function noContentScript(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /receiving end does not exist|could not establish connection/i.test(message);
}
