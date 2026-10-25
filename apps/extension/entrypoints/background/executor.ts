// BigFish Executor: runs the 15 browser tools. Before a mutating action it
// focuses the ref's tab, rehydrates vault tokens, asks for approval when the
// action is risky, and after it returns a delta. Every result passes the PII
// filter before it leaves the extension.
import { ErrorCode, normalizeToolArgs, toolError } from "@bigfish/contracts";
import { tabsManager } from "./tabs.js";
import { pageError, tabCall, waitForNavigation, waitForTabLoad } from "./page.js";
import { buildDelta, buildSnapshot, buildTextSnapshot, clipValue, shortUrl, type ScanResult } from "./snapshot.js";
import { captureMasked, ScreenshotError } from "./screenshot.js";
import { pageEditor, type PageEditorResult } from "./code-editor.js";
import { isForbiddenUrl } from "../../safety/url-policy.js";
import { rehydrateArgs, sanitizeObservationForModel } from "../../safety/privacy.js";
import { classifyAction, type ActionDescriptor } from "../../safety/action-policy.js";
import { approvals } from "../../safety/approval.js";
import { vault } from "../../safety/pii-vault.js";

export interface ExecuteOptions {
  // Aborted when the server cancels the MCP call.
  signal?: AbortSignal;
  runId?: string;
  // Sent back to the server as MCP progress (e.g. while waiting for approval).
  onProgress?: (message: string) => void;
}

export interface ToolImage {
  data: string;
  mimeType: string;
}

interface ToolResult {
  ok: boolean;
  text: string;
  // Origin of the page the text came from, for the PII vault.
  origin?: string;
  // Only browser_screenshot sets it, and only after every private spot was masked.
  image?: ToolImage;
}

type Tab = Browser.tabs.Tab & { id: number };
type Descriptor = ActionDescriptor & { label?: string };

const SNAPSHOT_DEFAULT_CHARS = 3_000;
const SNAPSHOT_MAX_CHARS = 12_000;
const NAVIGATE_PREVIEW = 25;
const MAX_RESULT_CHARS = 12_000;
const WAIT_DEFAULT_MS = 5_000;
const WAIT_MAX_MS = 60_000;
const SETTLE_MS = 350;
// After an action, wait for the DOM to be quiet this long (but at most SETTLE_MAX_MS).
const SETTLE_QUIET_MS = 600;
const SETTLE_MAX_MS = 5_000;
// browser_wait_for idle=true: no DOM change for this long means the page is done.
const IDLE_QUIET_MS = 1_500;
// Sites like LeetCode copy the editor text into their own state a moment after a
// change, and their Format reads that state: format too soon and it gets the old code.
const FORMAT_DELAY_MS = 600;

class ToolFailure extends Error {
  constructor(readonly result: ToolResult) {
    super(result.text);
  }
}

function fail(code: ErrorCode, message: string, hint?: string): never {
  throw new ToolFailure({ ok: false, text: toolError(code, message, hint) });
}

export class BrowserToolExecutor {
  async execute(tool: string, rawArgs: any, _callerClient: string = "mcp", opts: ExecuteOptions = {}): Promise<{ ok: boolean; text: string; image?: ToolImage }> {
    if (opts.signal?.aborted) {
      return { ok: false, text: toolError(ErrorCode.TIMEOUT, `${tool} was cancelled before it started.`) };
    }
    await vault.ready();
    let result: ToolResult;
    try {
      result = await this.run(tool, normalizeToolArgs(tool, rawArgs ?? {}), opts);
    } catch (err) {
      result = err instanceof ToolFailure ? err.result : pageError(err, tool);
    }

    // Nothing leaves the browser without passing the PII filter.
    const origin = result.origin ?? (await activeOrigin());
    let text = sanitizeObservationForModel(result.text, origin);
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n… cut at ${MAX_RESULT_CHARS} chars`;
    return { ok: result.ok, text, ...(result.ok && result.image ? { image: result.image } : {}) };
  }

  private run(tool: string, args: any, opts: ExecuteOptions): Promise<ToolResult> {
    switch (tool) {
      case "browser_ping":
        return this.ping();
      case "browser_tabs":
        return this.tabs(args, opts);
      case "browser_navigate":
        return this.navigate(args, opts);
      case "browser_snapshot":
        return this.snapshot(args);
      case "browser_find":
        return this.find(args);
      case "browser_click":
        return this.click(args, opts);
      case "browser_type":
        return this.type(args, opts);
      case "browser_fill_form":
        return this.fillForm(args, opts);
      case "browser_select":
        return this.select(args);
      case "browser_press_key":
        return this.pressKey(args, opts);
      case "browser_scroll":
        return this.scroll(args);
      case "browser_wait_for":
        return this.waitFor(args, opts);
      case "browser_extract":
        return this.extract(args);
      case "browser_screenshot":
        return this.screenshot(args, opts);
      case "browser_code_editor":
        return this.codeEditor(args, opts);
      default:
        return Promise.resolve({ ok: false, text: toolError(ErrorCode.INVALID_ARGS, `Unknown tool "${tool}"`) });
    }
  }

  // ---- tools ------------------------------------------------------------------------

  private async ping(): Promise<ToolResult> {
    const tabs = await tabsManager.listTabs();
    return { ok: true, text: `ok pong | ext ${browser.runtime.getManifest().version} | ${tabs.length} tabs` };
  }

  private async tabs(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const action = args.action || "list";
    if (action === "list") {
      const list = await tabsManager.listTabs();
      const lines = [`ok ${list.length} tabs`];
      for (const t of list) {
        lines.push(`${t.active ? "*" : " "}${t.slot} ${t.title.slice(0, 60)} | ${shortUrl(t.url)}${t.isBigFish ? " (BigFish)" : ""}`);
      }
      return { ok: true, text: lines.join("\n") };
    }

    const tab = await tabsManager.getTabBySlot(args.tab);
    if (tab?.id === undefined) fail(ErrorCode.TAB_NOT_FOUND, `Tab ${args.tab} not found.`, "Call browser_tabs list.");

    if (action === "switch") {
      await focusTab(tab as Tab);
      return { ok: true, text: `ok switched to tab ${args.tab} | ${tab.title ?? ""}` };
    }
    if (action === "close") {
      if (!tabsManager.isAgentTab(tab.id!)) {
        await this.approve("browser_tabs", args, tab.url ?? "", `Close your tab "${tab.title ?? tab.url}"`, opts);
      }
      await browser.tabs.remove(tab.id!);
      return { ok: true, text: `ok closed tab ${args.tab}` };
    }
    return fail(ErrorCode.INVALID_ARGS, `Invalid action ${action}`);
  }

  private async navigate(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    let tab = args.tab ? await tabsManager.getTabBySlot(args.tab) : await tabsManager.getActiveTab();
    if (args.tab && !tab) fail(ErrorCode.TAB_NOT_FOUND, `Tab ${args.tab} not found.`, "Call browser_tabs list.");

    // A url wins: models often send a stray action next to it.
    if (args.action && !args.url) {
      if (tab?.id === undefined) return fail(ErrorCode.TAB_NOT_FOUND, "No tab to act on.");
      try {
        if (args.action === "reload") await browser.tabs.reload(tab.id);
        else if (args.action === "back") await browser.tabs.goBack(tab.id);
        else await browser.tabs.goForward(tab.id);
      } catch (err) {
        if (args.action === "reload") throw err;
        // Not a slow page: there is just no history entry. Waiting will not help.
        fail(ErrorCode.INVALID_ARGS, `There is no page to go ${args.action} to in this tab.`, "Do not retry. Open a url instead, or stop.");
      }
      const loaded = await waitForNavigation(tab.id);
      return this.pagePreview(tab as Tab, `ok ${args.action} done${loaded ? "" : " (page still loading)"}`, loaded);
    }

    if (!args.url) fail(ErrorCode.INVALID_ARGS, "Give url, or action back/forward/reload.");
    let url = String(args.url).trim();
    // No scheme: https, except local hosts, which rarely have TLS. "localhost:3000" also looks like a scheme.
    const local = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?(\/|$)/i.test(url);
    if (local) url = `http://${url}`;
    else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^(javascript|data|about|file|chrome|blob|mailto):/i.test(url)) url = `https://${url}`;
    if (isForbiddenUrl(url)) fail(ErrorCode.FORBIDDEN_URL, `${url} is blocked by policy.`, "Do not retry. Pick another page.");

    // A vault token inside a URL would send private data to that site: ask first.
    const target = safeOrigin(url);
    const { args: real, rehydrated } = rehydrateArgs("browser_navigate", { url }, target);
    if (rehydrated) {
      await this.approve("browser_navigate", { url }, target, `Open a URL that contains your private data (${target})`, opts);
      url = real.url;
    }

    if (args.new_tab || tab?.id === undefined) {
      tab = await tabsManager.openInBigFishGroup(url);
    } else {
      await browser.tabs.update(tab.id, { url });
    }
    const loaded = await waitForNavigation(tab.id!);
    return this.pagePreview(tab as Tab, `ok navigated${loaded ? "" : " (page still loading)"}`, loaded);
  }

  // Header + the first elements in view, so the agent often needs no snapshot after navigating.
  private async pagePreview(tab: Tab, firstLine: string, loaded = true): Promise<ToolResult> {
    const slot = await tabsManager.slotOf(tab.id);
    try {
      const scan = await this.scan(tab.id, { viewportOnly: true });
      const preview = { ...scan, elements: scan.elements.slice(0, NAVIGATE_PREVIEW) };
      return {
        ok: true,
        text: `${firstLine}\n${buildSnapshot(slot, preview, { maxChars: 2_500, offset: 0, newRefs: new Set() })}`,
        origin: safeOrigin(scan.url),
      };
    } catch {
      const now = await browser.tabs.get(tab.id).catch(() => tab);
      // A loaded web page that cannot be read is Chrome's error page (404, site down, bad host).
      if (loaded && /^https?:/i.test(now.url ?? "")) {
        return {
          ok: false,
          text: toolError(
            ErrorCode.PAGE_UNRESPONSIVE,
            `The page did not load: ${now.url}`,
            "The site may be down, the URL wrong (404), or the link is a download. Check the URL; do not retry it more than once.",
          ),
          origin: safeOrigin(now.url),
        };
      }
      return { ok: true, text: `${firstLine}\n[tab ${slot}] ${now.title ?? ""} | ${now.url ?? ""} (page cannot be read)`, origin: safeOrigin(now.url) };
    }
  }

  private async snapshot(args: any): Promise<ToolResult> {
    const tab = await this.tabFromArg(args.tab);
    const slot = await tabsManager.slotOf(tab.id);
    const maxChars = clamp(args.max_chars ?? SNAPSHOT_DEFAULT_CHARS, 200, SNAPSHOT_MAX_CHARS);
    const offset = Math.max(0, Number(args.offset ?? 0));

    if (args.mode === "text") {
      const page = await tabCall(tab.id, "BIGFISH_TEXT", { within: args.within });
      if (!page.ok) return contentError(page, args.within);
      return {
        ok: true,
        text: buildTextSnapshot(slot, page as any, { maxChars, offset, fromEnd: args.from_end === true }),
        origin: safeOrigin((page as any).url),
      };
    }

    const scan = await this.scan(tab.id, { within: args.within });
    // Only full-page snapshots set the baseline for "*" (new) marks.
    const newRefs = args.within || offset ? new Set<string>() : tabsManager.markSnapshot(tab.id, scan.elements.map((e) => e.ref));
    return { ok: true, text: buildSnapshot(slot, scan, { maxChars, offset, newRefs }), origin: safeOrigin(scan.url) };
  }

  private async find(args: any): Promise<ToolResult> {
    const tab = await this.tabFromArg(args.tab);
    const query = rehydrateArgs("browser_find", { q: args.query }, safeOrigin(tab.url)).args.q;
    const kind = args.kind === "text" ? "text" : "element";
    const resp = await tabCall<{ matches: string[] }>(tab.id, "BIGFISH_FIND", { query, kind });
    if (!resp.ok) return contentError(resp);
    const matches = resp.matches ?? [];
    const head = kind === "text" ? `ok ${matches.length} hits` : `ok ${matches.length} matches`;
    if (matches.length === 0) return { ok: true, text: `${head} | try other words, or browser_snapshot`, origin: safeOrigin(tab.url) };
    return { ok: true, text: [head, ...matches].join("\n"), origin: safeOrigin(tab.url) };
  }

  private async click(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const tab = await this.tabFromRef(args.ref);
    await focusTab(tab);
    const desc = await this.describe(tab, args.ref);
    await this.gate("browser_click", args, tab, desc, opts);

    const before = await this.scanQuiet(tab.id);
    const tabsBefore = await tabIds();
    const resp = await tabCall<{ role: string; name: string }>(tab.id, "BIGFISH_CLICK", { ref: args.ref });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.settle(tab.id);
    const opened = await openedTabs(tabsBefore);
    return { ok: true, text: buildDelta(`click ${resp.role} "${resp.name}"`, before, after) + opened, origin: safeOrigin(after?.url ?? tab.url) };
  }

  private async type(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const tab = await this.tabFromRef(args.ref);
    await focusTab(tab);
    const { args: real, crossOrigins, unknown } = rehydrateArgs("browser_type", args, safeOrigin(tab.url));
    if (unknown.length) fail(ErrorCode.INVALID_ARGS, `Unknown private data token ${unknown.join(", ")}.`, "Copy tokens exactly as a tool result showed them. Never make one up.");
    const desc = await this.describe(tab, args.ref);
    await this.gate("browser_type", real, tab, { ...desc, crossOrigins }, opts);

    const before = await this.scanQuiet(tab.id);
    const resp = await tabCall<{ role: string; name: string; value: string }>(tab.id, "BIGFISH_TYPE", {
      ref: args.ref,
      text: real.text,
      clear: args.clear,
      submit: args.submit,
    });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.settle(tab.id);
    const value = clipValue(String(resp.value ?? ""), 80).replace(/"/g, "'");
    return { ok: true, text: buildDelta(`type ${resp.role} "${resp.name}" ="${value}"`, before, after), origin: safeOrigin(tab.url) };
  }

  private async fillForm(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const fields: { ref: string; value: string }[] = args.fields ?? [];
    if (fields.length === 0 || fields.length > 15) fail(ErrorCode.INVALID_ARGS, "Give 1 to 15 fields.");
    const tab = await this.tabFromRef(fields[0]!.ref);
    await focusTab(tab);
    const origin = safeOrigin(tab.url);

    // One approval for the whole call: cross-origin data in any field, or a risky submit button.
    const crossOrigins = new Set<string>();
    const real = fields.map((f) => {
      const r = rehydrateArgs("browser_fill_form", f, origin);
      if (r.unknown.length) fail(ErrorCode.INVALID_ARGS, `Unknown private data token ${r.unknown.join(", ")}.`, "Copy tokens exactly as a tool result showed them. Never make one up.");
      r.crossOrigins.forEach((o) => crossOrigins.add(o));
      return r.args as { ref: string; value: string };
    });
    const submitDesc: Descriptor = args.submit_ref ? await this.describe(tab, args.submit_ref) : {};
    await this.gate(
      "browser_fill_form",
      args,
      tab,
      { ...submitDesc, formSubmitLabel: submitDesc.label, crossOrigins: [...crossOrigins] },
      opts,
      args.submit_ref,
    );

    const before = await this.scanQuiet(tab.id);
    const lines: string[] = [];
    for (const field of real) {
      const resp = await tabCall<{ role: string; name: string; value: string }>(tab.id, "BIGFISH_FILL", { ref: field.ref, value: field.value });
      if (!resp.ok) {
        const err = contentError(resp, field.ref);
        return { ok: false, text: `${err.text}\nFilled before the failure:\n${lines.join("\n") || "(none)"}`, origin };
      }
      const value = String(resp.value ?? "");
      lines.push(`${field.ref} ${resp.role} "${resp.name}" ${/^\[[x ]\]$/.test(value) ? value : `="${clipValue(value, 60)}"`}`);
    }
    let action = `filled ${lines.length} fields`;
    if (args.submit_ref) {
      const resp = await tabCall<{ role: string; name: string }>(tab.id, "BIGFISH_CLICK", { ref: args.submit_ref });
      if (!resp.ok) return { ok: false, text: `${contentError(resp, args.submit_ref).text}\nAll fields were filled.`, origin };
      action += `, clicked ${resp.role} "${resp.name}"`;
    }
    const after = await this.settle(tab.id);
    return { ok: true, text: `${buildDelta(action, before, after)}\n${lines.join("\n")}`, origin };
  }

  private async select(args: any): Promise<ToolResult> {
    const tab = await this.tabFromRef(args.ref);
    await focusTab(tab);
    const option = rehydrateArgs("browser_select", { o: args.option }, safeOrigin(tab.url)).args.o;
    const before = await this.scanQuiet(tab.id);
    const resp = await tabCall<{ role: string; name: string; selected: string }>(tab.id, "BIGFISH_SELECT", { ref: args.ref, option });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.settle(tab.id);
    return { ok: true, text: buildDelta(`selected "${resp.selected}" in ${resp.role} "${resp.name}"`, before, after), origin: safeOrigin(tab.url) };
  }

  private async pressKey(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const tab = args.ref ? await this.tabFromRef(args.ref) : await this.tabFromArg(undefined);
    await focusTab(tab);
    if (/^enter$/i.test(String(args.key))) {
      const desc = await this.describe(tab, args.ref).catch(() => ({}) as Descriptor);
      await this.gate("browser_press_key", args, tab, desc, opts);
    }
    const before = await this.scanQuiet(tab.id);
    const tabsBefore = await tabIds();
    const resp = await tabCall<{ focused: string }>(tab.id, "BIGFISH_PRESS_KEY", { key: args.key, ref: args.ref });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.settle(tab.id);
    const focus = resp.focused ? ` | focus: ${resp.focused}` : "";
    return { ok: true, text: `${buildDelta(`press ${args.key}`, before, after)}${focus}${await openedTabs(tabsBefore)}`, origin: safeOrigin(tab.url) };
  }

  private async scroll(args: any): Promise<ToolResult> {
    const tab = args.ref ? await this.tabFromRef(args.ref) : await this.tabFromArg(undefined);
    const before = await this.scanQuiet(tab.id, { viewportOnly: true });
    const resp = await tabCall<{ moved: number; position: number; height: number }>(tab.id, "BIGFISH_SCROLL", {
      direction: args.direction,
      amount: args.amount ?? "page",
      ref: args.ref,
    });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.scanQuiet(tab.id, { viewportOnly: true });
    const seen = new Set(before?.elements.map((e) => e.ref));
    const fresh = (after?.elements ?? []).filter((e) => !seen.has(e.ref));
    const list = fresh.slice(0, 20).map((e) => `${e.ref} ${e.role} "${e.name}"`);
    const head =
      resp.moved === 0
        ? `ok scrolled 0px, already at the ${args.direction === "up" ? "top" : "bottom"}`
        : `ok scrolled ${Math.abs(resp.moved)}px (${resp.position}/${resp.height})`;
    return { ok: true, text: list.length ? `${head} | +${fresh.length} new: ${list.join(", ")}` : head, origin: safeOrigin(tab.url) };
  }

  private async waitFor(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const conds = { text: args.text, gone_text: args.gone_text, ref: args.ref };
    if (!conds.text && !conds.gone_text && !conds.ref && !args.url_contains && !args.idle) {
      fail(ErrorCode.INVALID_ARGS, "Give text, gone_text, url_contains, ref or idle=true.");
    }
    const tab = args.ref ? await this.tabFromRef(args.ref) : await this.tabFromArg(undefined);
    const real = rehydrateArgs("browser_wait_for", conds, safeOrigin(tab.url)).args;
    const deadline = Date.now() + clamp(args.timeout_ms ?? WAIT_DEFAULT_MS, 100, WAIT_MAX_MS);
    const needsPage = Boolean(real.text || real.gone_text || real.ref);

    if (args.idle) {
      // Wait in slices, sending progress so the server's call timeout keeps resetting.
      let quiet = false;
      while (!quiet && Date.now() < deadline) {
        if (opts.signal?.aborted) fail(ErrorCode.TIMEOUT, "Cancelled while waiting.");
        opts.onProgress?.("Waiting for the page to finish");
        const slice = Math.min(10_000, deadline - Date.now());
        const resp = await tabCall<{ quiet: boolean }>(tab.id, "BIGFISH_WAIT_QUIET", { quietMs: IDLE_QUIET_MS, timeoutMs: slice }).catch(() => null);
        quiet = Boolean(resp?.ok && resp.quiet);
      }
      // Some apps (Gmail, dashboards) never go fully quiet. Not an error: report it and go on.
      if (!quiet && !conds.text && !conds.gone_text && !conds.ref && !args.url_contains) {
        const now = await browser.tabs.get(tab.id).catch(() => null);
        return { ok: true, text: `ok waited, page still changing a little | ${now?.title ?? ""}`, origin: safeOrigin(now?.url) };
      }
    }

    for (;;) {
      if (opts.signal?.aborted) fail(ErrorCode.TIMEOUT, "Cancelled while waiting.");
      const now = await browser.tabs.get(tab.id).catch(() => null);
      if (!now) return fail(ErrorCode.TAB_NOT_FOUND, "The tab was closed while waiting.");
      let met = !args.url_contains || (now.url ?? "").includes(args.url_contains);
      if (met && needsPage) {
        const resp = await tabCall<{ met: boolean }>(tab.id, "BIGFISH_CHECK", real).catch(() => null);
        met = Boolean(resp?.ok && resp.met);
      }
      if (met) {
        return { ok: true, text: `ok met | ${now.title ?? ""} | ${shortUrl(now.url ?? "")}`, origin: safeOrigin(now.url) };
      }
      if (Date.now() >= deadline) {
        fail(ErrorCode.TIMEOUT, `Condition not met in time. Page now: ${now.title ?? ""} | ${now.url ?? ""}`, "Snapshot to see the page, then decide.");
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private async extract(args: any): Promise<ToolResult> {
    const tab = await this.tabFromArg(undefined);
    const filter = rehydrateArgs("browser_extract", { f: args.filter ?? "" }, safeOrigin(tab.url)).args.f;
    const resp = await tabCall<{ text: string }>(tab.id, "BIGFISH_EXTRACT", {
      what: args.what,
      within: args.within,
      filter,
      max: clamp(args.max ?? 25, 1, 200),
    });
    if (!resp.ok) return contentError(resp, args.within);
    return { ok: true, text: resp.text, origin: safeOrigin(tab.url) };
  }

  private async codeEditor(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const tab = await this.tabFromArg(args.tab);
    const slot = await tabsManager.slotOf(tab.id);
    const origin = safeOrigin(tab.url);
    if (args.action === "read") {
      const res = editorOk(await pageEditor(tab.id, "read"));
      return { ok: true, text: `ok ${res.kind} editor [tab ${slot}] | language ${res.language || "unknown"} | ${res.lines} lines\n${res.code}`, origin };
    }
    if (args.action !== "write") fail(ErrorCode.INVALID_ARGS, `Invalid action ${args.action}`, "Use read or write.");
    if (!args.code) fail(ErrorCode.INVALID_ARGS, "Give code: the complete code to put in the editor.");

    await focusTab(tab);
    const { args: real, crossOrigins, unknown } = rehydrateArgs("browser_code_editor", { code: args.code }, origin);
    if (unknown.length) fail(ErrorCode.INVALID_ARGS, `Unknown private data token ${unknown.join(", ")}.`, "Copy tokens exactly as a tool result showed them. Never make one up.");
    await this.gate("browser_code_editor", real, tab, { crossOrigins }, opts);

    const wrote = editorOk(await pageEditor(tab.id, "write", String(real.code)));
    const head = `ok wrote ${wrote.lines} lines into the ${wrote.kind} editor [tab ${slot}] | language ${wrote.language || "unknown"}`;
    if (args.format === false) return { ok: true, text: head, origin };
    return { ok: true, text: `${head} | ${await this.formatCode(tab, wrote.code)}`, origin };
  }

  // Clicks the editor's Format button. Without one (or when the click fails), runs
  // the editor's own format action, which is what such a button runs.
  private async formatCode(tab: Tab, written: string): Promise<string> {
    await new Promise((r) => setTimeout(r, FORMAT_DELAY_MS));
    const button = await tabCall<{ ref?: string; name?: string }>(tab.id, "BIGFISH_FORMAT_BUTTON").catch(() => null);
    if (button?.ok && button.ref) {
      const click = await tabCall(tab.id, "BIGFISH_CLICK", { ref: button.ref }).catch(() => null);
      if (click?.ok) {
        const res = await pageEditor(tab.id, "wait_change", written);
        return formatNote(`clicked "${button.name}"`, res);
      }
    }
    const res = await pageEditor(tab.id, "format");
    if (res.ok && !res.format) return "no Format button or format action here, code left as written";
    return formatNote(res.ok ? `ran the editor's "${res.format}"` : "format failed", res);
  }

  // ---- helpers ----------------------------------------------------------------------

  private async screenshot(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const tab = await this.tabFromArg(args.tab);
    if (tab.windowId === undefined) fail(ErrorCode.TAB_NOT_FOUND, "The tab has no window.");
    const slot = await tabsManager.slotOf(tab.id);
    const origin = safeOrigin(tab.url);
    // Chrome only captures the visible tab of a window.
    await focusTab(tab);
    try {
      const shot = await captureMasked(tab.windowId!, origin, opts.signal);
      const masked = shot.tokens.length ? `masked: ${shot.tokens.join(", ")}` : "nothing private found";
      return {
        ok: true,
        text: `ok screenshot [tab ${slot}] ${shot.width}x${shot.height} | ${masked}`,
        origin,
        image: { data: shot.data, mimeType: shot.mimeType },
      };
    } catch (err) {
      if (err instanceof ScreenshotError) fail(err.code, err.message, err.hint);
      throw err;
    }
  }

  private async tabFromArg(slot: number | undefined): Promise<Tab> {
    const tab = slot ? await tabsManager.getTabBySlot(slot) : await tabsManager.getActiveTab();
    if (tab?.id === undefined) fail(ErrorCode.TAB_NOT_FOUND, slot ? `Tab ${slot} not found.` : "No active tab.", "Call browser_tabs list.");
    return tab as Tab;
  }

  private async tabFromRef(ref: string): Promise<Tab> {
    if (!/^\d+:\d+$/.test(String(ref ?? ""))) fail(ErrorCode.INVALID_ARGS, `"${ref}" is not a ref.`, "Refs look like 3:12. Take one from the last snapshot or browser_find.");
    const tab = await tabsManager.getTabForRef(String(ref ?? ""));
    if (tab?.id === undefined) fail(ErrorCode.STALE_REF, `Ref ${ref} belongs to a tab that is gone.`, "Call browser_tabs list, then snapshot.");
    return tab as Tab;
  }

  private async scan(tabId: number, payload: Record<string, unknown> = {}): Promise<ScanResult> {
    const resp = await tabCall<ScanResult>(tabId, "BIGFISH_SCAN", payload);
    if (!resp.ok) throw new ToolFailure(contentError(resp, payload.within as string | undefined));
    return resp;
  }

  // For deltas: a scan that never fails the tool.
  private async scanQuiet(tabId: number, payload: Record<string, unknown> = {}): Promise<ScanResult | null> {
    try {
      return await this.scan(tabId, payload);
    } catch {
      return null;
    }
  }

  // After an action: let the page react (or navigate), then look again.
  private async settle(tabId: number): Promise<ScanResult | null> {
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (tab?.status === "loading") await waitForTabLoad(tabId);
    await tabCall(tabId, "BIGFISH_WAIT_QUIET", { quietMs: SETTLE_QUIET_MS, timeoutMs: SETTLE_MAX_MS }).catch(() => null);
    const scan = await this.scanQuiet(tabId);
    if (scan) return scan;
    const now = await browser.tabs.get(tabId).catch(() => null);
    return now ? { elements: [], url: now.url ?? "", title: now.title ?? "", scrollY: 0, scrollHeight: 0 } : null;
  }

  private async describe(tab: Tab, ref: string | undefined): Promise<Descriptor> {
    const resp = await tabCall<{ descriptor: Descriptor }>(tab.id, "BIGFISH_DESCRIBE", { ref });
    if (!resp.ok) throw new ToolFailure(contentError(resp, ref));
    return resp.descriptor;
  }

  // Risky actions wait for the user. After approval the element must still be the same one.
  private async gate(tool: string, args: any, tab: Tab, desc: Descriptor, opts: ExecuteOptions, recheckRef: string | undefined = args.ref): Promise<void> {
    const policy = classifyAction(tool, args, desc);
    if (!policy.needsApproval) return;
    await this.approve(tool, args, tab.url ?? "", policy.reason ?? "This action needs your approval.", opts);
    if (recheckRef) {
      const again = await this.describe(tab, recheckRef).catch(() => null);
      if (!again || again.label !== desc.label || again.role !== desc.role) {
        fail(
          ErrorCode.STALE_APPROVAL,
          `The page changed while waiting for approval (${recheckRef} is not "${desc.label ?? ""}" any more).`,
          "Snapshot again and redo the action.",
        );
      }
    }
  }

  private async approve(tool: string, args: any, origin: string, reason: string, opts: ExecuteOptions): Promise<void> {
    const decision = await approvals.waitForDecision(
      {
        id: `${tool}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tool,
        args,
        reason,
        origin,
        fingerprint: approvals.computeActionFingerprint(tool, args, origin),
        createdAt: Date.now(),
      },
      { signal: opts.signal, onProgress: opts.onProgress },
    );
    if (decision === "approved") return;
    if (decision === "timeout") fail(ErrorCode.APPROVAL_DENIED, "No answer from the user in time.", "Do not retry. Tell the user what you wanted to do.");
    fail(ErrorCode.APPROVAL_DENIED, "The user said no.", "Do not retry. Report back.");
  }
}

// ---- module helpers -------------------------------------------------------------------

function contentError(resp: any, ref?: string): ToolResult {
  const code = (resp?.error as ErrorCode) || ErrorCode.PAGE_UNRESPONSIVE;
  switch (code) {
    case ErrorCode.STALE_REF: {
      const candidates: string[] = resp.candidates ?? [];
      return {
        ok: false,
        text: toolError(
          code,
          `${ref ?? "That ref"} is gone (the page changed).${resp.reason ? ` ${resp.reason}` : ""}`,
          candidates.length ? `Maybe: ${candidates.join("; ")}` : "Snapshot again.",
        ),
      };
    }
    case ErrorCode.NOT_ACTIONABLE:
      return { ok: false, text: toolError(code, `${ref} cannot be used now: ${resp.reason ?? "unknown"}.`, actionableHint(resp)) };
    case ErrorCode.OPTION_NOT_FOUND:
      return { ok: false, text: toolError(code, "No such option.", `Options: ${(resp.options ?? []).join(" | ")}`) };
    case ErrorCode.NOT_EDITABLE:
      return { ok: false, text: toolError(code, `${ref} cannot take this input: ${resp.reason ?? "wrong kind of element"}.`, "Find the right element with browser_find.") };
    case ErrorCode.INVALID_ARGS:
      return { ok: false, text: toolError(code, resp.reason ?? "Bad arguments.", "Fix the arguments. Repeating the same call will fail again.") };
    default:
      return { ok: false, text: toolError(code, resp?.reason ?? "The page did not answer.", "Wait with browser_wait_for, then try once more.") };
  }
}

function editorOk(res: PageEditorResult): Extract<PageEditorResult, { ok: true }> {
  if (res.ok) return res;
  if (res.error === "NO_EDITOR") fail(ErrorCode.NOT_EDITABLE, "No code editor on this page.", "Open the problem page first. For plain text fields use browser_type.");
  if (res.error === "READ_ONLY") fail(ErrorCode.NOT_EDITABLE, `Cannot write: ${res.reason}.`, "Open the editable editor (e.g. leave the submission view).");
  return fail(ErrorCode.PAGE_UNRESPONSIVE, `Cannot write: ${res.reason}.`, "Read the editor, then try once more.");
}

function formatNote(how: string, res: PageEditorResult): string {
  if (!res.ok) return `${how}, but the editor could not be read after it`;
  if (!res.changed) return `${how}, code unchanged (already formatted, or the site needs you signed in)`;
  return `${how}, formatted to ${res.lines} lines`;
}

function actionableHint(resp: any): string {
  const reason = String(resp?.reason ?? "");
  if (resp?.coveringRef) return `Close or move ${resp.coveringRef} first.`;
  if (reason.startsWith("covered")) return "Something is on top of it (a popup, banner or overlay). Close that first (its close or accept button), or press Escape.";
  if (reason === "disabled") return "It is disabled. Fill the required fields first, or use another element.";
  if (reason === "still moving") return "It is animating. Wait a moment, then try once more.";
  return "Scroll it into view, or open the menu or section that holds it.";
}

async function tabIds(): Promise<Set<number>> {
  return new Set((await browser.tabs.query({})).map((t) => t.id).filter((id): id is number => id !== undefined));
}

// " | opened tab 4 "Title" (now active)" for tabs an action opened, else "".
async function openedTabs(before: Set<number>): Promise<string> {
  const fresh = (await browser.tabs.query({})).filter((t) => t.id !== undefined && !before.has(t.id));
  if (fresh.length === 0) return "";
  const lines = await Promise.all(
    fresh.map(async (t) => `opened tab ${await tabsManager.slotOf(t.id!)} "${(t.title || t.url || "").slice(0, 50)}"${t.active ? " (now active)" : ""}`),
  );
  return ` | ${lines.join(", ")}`;
}

async function focusTab(tab: Tab): Promise<void> {
  if (!tab.active) await browser.tabs.update(tab.id, { active: true });
  if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function activeOrigin(): Promise<string> {
  return safeOrigin((await tabsManager.getActiveTab())?.url);
}

function safeOrigin(url: string | undefined): string {
  try {
    return new URL(url ?? "").origin;
  } catch {
    return "unknown";
  }
}

function clamp(value: unknown, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min;
}

export const executor = new BrowserToolExecutor();
