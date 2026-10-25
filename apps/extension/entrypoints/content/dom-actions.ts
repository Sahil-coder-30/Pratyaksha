import { agentCursor } from "./cursor";

// BigFish Content DOM Engine: element refs, fingerprints, actionability, and the
// DOM side of every browser tool (scan, text, find, click, type, select, keys,
// scroll, wait checks, extract).
//
// Refs are "<tab slot>:<id>". Ids keep counting across page loads of a tab (the
// service worker passes idBase), so a ref from an old page never points at a
// new element: it comes back as STALE_REF instead.

export interface ElementFingerprint {
  role: string;
  name: string;
  tag: string;
  css: string;
  href?: string;
}

export interface ScannedElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  href?: string;
  // The question or group a field belongs to, when its own name does not say it
  // (e.g. a Google Forms "Your answer" box or a "2022" radio).
  group?: string;
  inViewport: boolean;
}

export interface RefContext {
  slot: number;
  idBase: number;
}

export type ActionResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string; reason?: string; candidates?: string[]; coveringRef?: string; options?: string[] };

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "summary",
  "[contenteditable='true']",
  "[contenteditable='']",
  ...["button", "link", "tab", "menuitem", "checkbox", "radio", "switch", "option", "combobox", "textbox", "searchbox", "listbox"].map(
    (role) => `[role='${role}']`,
  ),
].join(", ");

// Scans stop here, so a huge page cannot stall the content script.
const MAX_SCAN = 800;
// browser_find looks further: it only returns the best few.
const MAX_FIND_SCAN = 5_000;
// Text lines kept per scan, so a delta can say what text an action added.
const MAX_LINES = 1_500;
const LINE_CHARS = 200;
// Keys browser_press_key understands, besides single characters.
const NAMED_KEYS = new Set([
  "Enter", "Escape", "Tab", "Backspace", "Delete", "Space", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown", "Insert", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);
const MODIFIERS = new Set(["shift", "control", "ctrl", "alt", "option", "meta", "cmd", "command"]);

// querySelectorAll that also looks inside open shadow roots, where web components
// (YouTube, Salesforce, many design systems) keep their buttons and fields.
function deepQueryAll<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T[] {
  const found: T[] = Array.from(root.querySelectorAll<T>(selector));
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.shadowRoot) found.push(...deepQueryAll<T>(el.shadowRoot, selector));
  }
  return found;
}
const NAME_CHARS = 80;
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox"]);
const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "checkbox", "radio", "switch", "option"]);
const GROUP_SELECTOR = "[role='radiogroup'], [role='group'], [role='listbox'], fieldset";
const HEADING_SELECTOR = "[role='heading'], h1, h2, h3, h4, h5, h6, legend, label";
// A container with more fields than this is a whole form, not one question.
const GROUP_MAX_FIELDS = 12;
const GROUP_MAX_DEPTH = 8;
const CODE_EDITOR_SELECTOR = ".monaco-editor, .cm-editor, .CodeMirror, .ace_editor";
// Only a button that says "format" counts. Unlabelled icon buttons next to an
// editor can wipe the code (LeetCode's "Retrieve last submitted code").
const FORMAT_LABEL = /^(auto[- ]?)?(format|beautify|prettify)( code| document)?\b/i;
const FORMAT_MAX_DEPTH = 8;

export class BigFishDOMEngine {
  private readonly elementMap = new Map<string, HTMLElement>();
  private readonly fingerprintMap = new Map<string, ElementFingerprint>();
  private slot = 1;
  private nextId = 1;

  // Every call from the service worker carries the tab slot and the next free id.
  useContext(ctx?: RefContext): void {
    if (!ctx) return;
    this.slot = ctx.slot;
    if (ctx.idBase > this.nextId) this.nextId = ctx.idBase;
  }

  get nextFreeId(): number {
    return this.nextId;
  }

  // ---- naming -----------------------------------------------------------------

  getRole(el: HTMLElement): string {
    const roleAttr = el.getAttribute("role");
    if (roleAttr) return roleAttr.toLowerCase().split(/\s+/)[0]!;
    const tag = el.tagName.toLowerCase();
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "a") return "link";
    if (tag === "input") {
      const type = ((el as HTMLInputElement).type || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (el.isContentEditable) return "textbox";
    return tag;
  }

  getAccessibleName(el: HTMLElement): string {
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_CHARS);
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return clean(aria);
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const text = labelledby
        .split(/\s+/)
        .map((id) => ((el.getRootNode() as Document | ShadowRoot).getElementById?.(id) ?? document.getElementById(id))?.textContent ?? "")
        .join(" ");
      if (text.trim()) return clean(text);
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      const label = el.labels?.[0];
      if (label) {
        // A label that wraps its control would also read the control's own text (e.g. select options).
        const copy = label.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("input, select, textarea, button").forEach((c) => c.remove());
        if (copy.textContent?.trim()) return clean(copy.textContent);
      }
    }
    const placeholder = el.getAttribute("placeholder") ?? el.getAttribute("aria-placeholder") ?? el.getAttribute("data-placeholder");
    if (placeholder?.trim()) return clean(placeholder);
    const title = el.getAttribute("title");
    if (title?.trim()) return clean(title);
    if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type) && el.value) return clean(el.value);
    const alt = el.querySelector("img[alt]")?.getAttribute("alt");
    const text = clean(el.innerText || el.textContent);
    return text || clean(alt);
  }

  // Nearest labelled group (radiogroup, fieldset) or small container with a heading,
  // e.g. one Google Forms question. Undefined when it adds nothing to the name.
  private getGroupLabel(el: HTMLElement, name: string): string | undefined {
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_CHARS);
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < GROUP_MAX_DEPTH; depth++, node = node.parentElement) {
      let label = "";
      // Only a named group counts: an unnamed one would read out its own options.
      if (node.matches(GROUP_SELECTOR) && (node instanceof HTMLFieldSetElement || node.hasAttribute("aria-label") || node.hasAttribute("aria-labelledby"))) {
        label = node instanceof HTMLFieldSetElement ? clean(node.querySelector("legend")?.textContent) : this.getAccessibleName(node);
      }
      if (!label) {
        if (node.querySelectorAll(INTERACTIVE_SELECTOR).length > GROUP_MAX_FIELDS) return undefined;
        // Not another option's own label (a <label> around a sibling radio).
        const heading = Array.from(node.querySelectorAll<HTMLElement>(HEADING_SELECTOR)).find(
          (h) => !h.contains(el) && !h.querySelector(INTERACTIVE_SELECTOR) && !(h instanceof HTMLLabelElement && h.control) && this.isVisible(h),
        );
        label = clean(heading?.innerText || heading?.textContent);
      }
      if (label) return name.toLowerCase().includes(label.toLowerCase()) ? undefined : label;
    }
    return undefined;
  }

  private valueOf(el: HTMLElement, role: string): string | undefined {
    if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent?.trim() ?? "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return TEXT_ROLES.has(role) ? el.value : undefined;
    }
    if (el.isContentEditable) return (el.innerText || "").trim().slice(0, 200);
    return undefined;
  }

  private computeCssSelector(el: HTMLElement): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const name = el.getAttribute("name");
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    let path = el.tagName.toLowerCase();
    if (typeof el.className === "string" && el.className.trim()) {
      path += el.className
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join("");
    }
    return path;
  }

  // ---- scanning -------------------------------------------------------------------

  private isVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && parseFloat(style.opacity || "1") > 0.05;
  }

  private inViewport(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  }

  private refFor(el: HTMLElement): string {
    const existing = el.getAttribute("data-bigfish-id");
    if (existing && this.elementMap.get(existing) === el) return existing;
    const ref = `${this.slot}:${this.nextId++}`;
    el.setAttribute("data-bigfish-id", ref);
    return ref;
  }

  scan(within?: HTMLElement | null, opts: { viewportOnly?: boolean; max?: number } = {}): ScannedElement[] {
    const root = within ?? document.body;
    if (!root) return [];
    const results: ScannedElement[] = [];
    const max = opts.max ?? MAX_SCAN;
    for (const el of deepQueryAll(root, INTERACTIVE_SELECTOR)) {
      if (results.length >= max) break;
      if (!this.isVisible(el)) continue;
      const inViewport = this.inViewport(el);
      if (opts.viewportOnly && !inViewport) continue;

      const ref = this.refFor(el);
      const role = this.getRole(el);
      const name = this.getAccessibleName(el);
      const href = el instanceof HTMLAnchorElement ? el.getAttribute("href") ?? undefined : undefined;
      this.elementMap.set(ref, el);
      this.fingerprintMap.set(ref, { role, name, tag: el.tagName.toLowerCase(), css: this.computeCssSelector(el), href });

      const entry: ScannedElement = { ref, role, name, href, inViewport };
      if (FIELD_ROLES.has(role)) {
        const group = this.getGroupLabel(el, name);
        if (group) entry.group = group;
      }
      const value = this.valueOf(el, role);
      if (value !== undefined) entry.value = value;
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) entry.checked = el.checked;
      else if (el.getAttribute("aria-checked")) entry.checked = el.getAttribute("aria-checked") === "true";
      else if (role === "option" && el.hasAttribute("aria-selected")) entry.checked = el.getAttribute("aria-selected") === "true";
      results.push(entry);
    }
    if (within) return results;
    // An open dialog (Gmail compose, a modal form) is where the next action is: list it first,
    // then what is in view, then the rest of the page.
    const dialog = this.openDialogElement();
    const rank = (e: ScannedElement) => (dialog && dialog.contains(this.elementMap.get(e.ref) ?? null) ? 2 : e.inViewport ? 1 : 0);
    return results.map((e, i) => ({ e, i, r: rank(e) })).sort((a, b) => b.r - a.r || a.i - b.i).map(({ e }) => e);
  }

  private openDialogElement(): HTMLElement | undefined {
    const dialogs = deepQueryAll(document, "dialog[open], [role='dialog'], [role='alertdialog'], [aria-modal='true']");
    // The last visible one is the one on top.
    return dialogs.filter((d) => this.isVisible(d)).at(-1);
  }

  // Name of an open modal dialog, if any.
  openDialog(): string | undefined {
    const visible = this.openDialogElement();
    if (!visible) return undefined;
    return this.getAccessibleName(visible).slice(0, 40) || "dialog";
  }

  pageText(within?: HTMLElement | null): string {
    const root = within ?? document.body;
    const text = (root?.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    return text;
  }

  // Short distinct text lines, so a delta can show text an action added
  // (e.g. "Saved", "Your response has been recorded") even when no element changed.
  visibleLines(): string[] {
    const lines = this.pageText()
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l.length <= LINE_CHARS);
    return [...new Set(lines)].slice(0, MAX_LINES);
  }

  // ---- ref resolution ------------------------------------------------------------

  resolve(ref: string): HTMLElement | null {
    const [slot] = ref.split(":");
    if (Number(slot) !== this.slot) return null;
    const known = this.elementMap.get(ref);
    if (known?.isConnected) return known;

    const tagged = deepQueryAll(document, `[data-bigfish-id="${CSS.escape(ref)}"]`)[0];
    if (tagged) {
      this.elementMap.set(ref, tagged);
      return tagged;
    }

    // Same page, re-rendered: find the element again by role + name (must be unique).
    const fp = this.fingerprintMap.get(ref);
    if (!fp) return null;
    const matches = deepQueryAll(document, fp.tag).filter(
      (el) => this.isVisible(el) && this.getRole(el) === fp.role && this.getAccessibleName(el) === fp.name,
    );
    if (matches.length !== 1) return null;
    const el = matches[0]!;
    el.setAttribute("data-bigfish-id", ref);
    this.elementMap.set(ref, el);
    return el;
  }

  // For STALE_REF: up to 3 current elements that look like the lost one.
  candidatesFor(ref: string): string[] {
    const fp = this.fingerprintMap.get(ref);
    const elements = this.scan();
    const words = (fp?.name ?? "").toLowerCase().split(/\W+/).filter(Boolean);
    return elements
      .map((e) => {
        let score = fp && e.role === fp.role ? 1 : 0;
        for (const w of words) if (e.name.toLowerCase().includes(w)) score += 2;
        return { e, score };
      })
      .filter((x) => x.score > 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ e }) => `${e.ref} ${e.role} "${e.name}"`);
  }

  private stale(ref: string): ActionResult {
    return { ok: false, error: "STALE_REF", candidates: this.candidatesFor(ref) };
  }

  // With no ref: the focused element (for Enter without a target).
  describe(ref?: string) {
    const el = ref ? this.resolve(ref) : (document.activeElement as HTMLElement | null);
    if (!el) return null;
    const role = this.getRole(el);
    const label = this.getAccessibleName(el);
    const form = el.closest("form");
    let formSubmitLabel: string | undefined;
    if (form) {
      const submit = form.querySelector<HTMLElement>("button[type='submit'], input[type='submit'], button:not([type])");
      if (submit) formSubmitLabel = this.getAccessibleName(submit);
    }
    const isSearch =
      el.getAttribute("type") === "search" ||
      role === "searchbox" ||
      form?.getAttribute("role") === "search" ||
      /\bsearch\b/i.test(label) ||
      /\bsearch\b/i.test(form?.getAttribute("action") ?? "");
    return { role, label, formSubmitLabel, isSearch, origin: window.location.origin };
  }

  // ---- actionability -------------------------------------------------------------

  async waitActionable(el: HTMLElement, timeoutMs = 3000): Promise<{ ok: boolean; reason?: string; coveringRef?: string }> {
    const start = Date.now();
    let lastReason = "not visible";
    while (Date.now() - start < timeoutMs) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      if (!this.isVisible(el)) {
        lastReason = "not visible";
        await sleep(80);
        continue;
      }
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") {
        lastReason = "disabled";
        await sleep(80);
        continue;
      }
      const r1 = el.getBoundingClientRect();
      await sleep(50);
      const r2 = el.getBoundingClientRect();
      if (Math.abs(r1.left - r2.left) >= 1 || Math.abs(r1.top - r2.top) >= 1) {
        lastReason = "still moving";
        continue;
      }
      // Inside a shadow root, its own elementFromPoint sees past the host.
      const root = el.getRootNode() as Document | ShadowRoot;
      const top = (root.elementFromPoint ?? document.elementFromPoint).call(root, r2.left + r2.width / 2, r2.top + r2.height / 2) as HTMLElement | null;
      if (!top || top === el || el.contains(top) || top.contains(el) || top.closest("label")?.contains(el)) return { ok: true };
      const cover = top.closest<HTMLElement>("[data-bigfish-id]");
      const coverName = this.getAccessibleName(top).slice(0, 30);
      lastReason = `covered by ${cover ? top.tagName.toLowerCase() : this.computeCssSelector(top)}${coverName && !cover ? ` "${coverName}"` : ""}`;
      return { ok: false, reason: lastReason, coveringRef: cover?.getAttribute("data-bigfish-id") ?? undefined };
    }
    return { ok: false, reason: lastReason };
  }

  // ---- actions ---------------------------------------------------------------------

  async click(ref: string): Promise<ActionResult> {
    const el = this.resolve(ref);
    if (!el) return this.stale(ref);
    const ready = await this.waitActionable(el);
    if (!ready.ok) return { ok: false, error: "NOT_ACTIONABLE", reason: ready.reason, coveringRef: ready.coveringRef };
    await agentCursor.pointAt(el, "Clicking");
    await agentCursor.press();
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
    return { ok: true, role: this.getRole(el), name: this.getAccessibleName(el) };
  }

  async type(ref: string, text: string, opts: { clear?: boolean; submit?: boolean }): Promise<ActionResult> {
    const el = this.resolve(ref);
    if (!el) return this.stale(ref);
    const ready = await this.waitActionable(el);
    if (!ready.ok) return { ok: false, error: "NOT_ACTIONABLE", reason: ready.reason, coveringRef: ready.coveringRef };
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    const editable = isField ? el : el.isContentEditable ? el : (el.querySelector<HTMLElement>("[contenteditable='true'], textarea, input") ?? null);
    if (!editable) return { ok: false, error: "NOT_EDITABLE", reason: `${this.getRole(el)} is not a text field` };
    if ((editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) && editable.readOnly) {
      return { ok: false, error: "NOT_EDITABLE", reason: "the field is read-only" };
    }

    await agentCursor.pointAt(editable, "Typing");
    await agentCursor.press();
    editable.focus();
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      // The native setter, so React and other frameworks see the change.
      const proto = editable instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setValue = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
      setValue.call(editable, opts.clear === false ? editable.value + text : text);
      editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      editable.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // Rich editors (ProseMirror, Gmail) listen to beforeinput/input, which insertText produces.
      if (opts.clear !== false) {
        const range = document.createRange();
        range.selectNodeContents(editable);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      const inserted = document.execCommand("insertText", false, text);
      if (!inserted) {
        editable.textContent = opts.clear === false ? (editable.textContent ?? "") + text : text;
        editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    }

    if (opts.submit) this.pressEnter(editable);
    return { ok: true, role: this.getRole(el), name: this.getAccessibleName(el), value: this.valueOf(editable, "textbox") ?? "" };
  }

  // browser_fill_form: one field of any kind. Radios and checkboxes are clicked
  // (a checkbox only when its state must change), dropdowns are selected, the rest is typed.
  async fill(ref: string, value: string): Promise<ActionResult> {
    const el = this.resolve(ref);
    if (!el) return this.stale(ref);
    const role = this.getRole(el);
    const off = /^(false|no|off|0|unchecked)$/i.test(value.trim());
    if (role === "radio" || role === "checkbox" || role === "switch" || role === "option") {
      const checked = el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true";
      if (role !== "radio" && checked === !off) return { ok: true, role, name: this.getAccessibleName(el), value: checked ? "[x]" : "[ ]" };
      if (role === "radio" && checked) return { ok: true, role, name: this.getAccessibleName(el), value: "[x]" };
      const clicked = await this.click(ref);
      if (!clicked.ok) return clicked;
      await sleep(150);
      const now = el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true";
      return { ok: true, role, name: this.getAccessibleName(el), value: now ? "[x]" : "[ ]" };
    }
    if (el instanceof HTMLSelectElement || role === "listbox" || (role === "combobox" && !(el instanceof HTMLInputElement) && !el.isContentEditable)) {
      const picked = await this.select(ref, value);
      return picked.ok ? { ...picked, value: String(picked.selected ?? value) } : picked;
    }
    return this.type(ref, value, { clear: true });
  }

  // Visible alert and error texts (e.g. "This is a required question"), for deltas.
  alerts(): string[] {
    const nodes = deepQueryAll(document, "[role='alert'], [aria-live='assertive'], .error, [aria-invalid='true'] ~ *");
    const texts = nodes
      .filter((n) => this.isVisible(n))
      .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80))
      .filter(Boolean);
    return [...new Set(texts)].slice(0, 5);
  }

  async select(ref: string, option: string): Promise<ActionResult> {
    const el = this.resolve(ref);
    if (!el) return this.stale(ref);
    const want = option.trim().toLowerCase();

    if (el instanceof HTMLSelectElement) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      await agentCursor.pointAt(el, `Choosing "${option}"`);
      await agentCursor.press();
      const options = Array.from(el.options);
      const match =
        options.find((o) => o.textContent?.trim().toLowerCase() === want || o.value.toLowerCase() === want) ??
        options.find((o) => o.textContent?.trim().toLowerCase().includes(want));
      if (!match) {
        return { ok: false, error: "OPTION_NOT_FOUND", options: options.slice(0, 10).map((o) => o.textContent?.trim() ?? o.value) };
      }
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setValue.call(el, match.value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, role: "combobox", name: this.getAccessibleName(el), selected: match.textContent?.trim() ?? match.value };
    }

    // ARIA combobox or listbox: open it, then click the option.
    const role = this.getRole(el);
    if (role !== "combobox" && role !== "listbox" && !el.hasAttribute("aria-haspopup")) {
      return { ok: false, error: "NOT_EDITABLE", reason: `${role} is not a dropdown` };
    }
    const opened = await this.click(ref);
    if (!opened.ok) return opened;
    await sleep(250);
    const listId = el.getAttribute("aria-controls") ?? el.getAttribute("aria-owns");
    // A listbox holds its own options; a combobox points at its popup.
    const scope = role === "listbox" ? el : (listId && document.getElementById(listId)) || document;
    const options = Array.from(scope.querySelectorAll<HTMLElement>("[role='option']")).filter((o) => this.isVisible(o));
    const match =
      options.find((o) => this.getAccessibleName(o).toLowerCase() === want) ??
      options.find((o) => this.getAccessibleName(o).toLowerCase().includes(want));
    if (!match) {
      return { ok: false, error: "OPTION_NOT_FOUND", options: options.slice(0, 10).map((o) => this.getAccessibleName(o)) };
    }
    match.scrollIntoView({ block: "nearest" });
    match.click();
    return { ok: true, role: this.getRole(el), name: this.getAccessibleName(el), selected: this.getAccessibleName(match) };
  }

  async pressKey(key: string, ref?: string): Promise<ActionResult> {
    let target: HTMLElement | null;
    if (ref) {
      target = this.resolve(ref);
      if (!target) return this.stale(ref);
      await agentCursor.pointAt(target, `Pressing ${key}`);
      target.focus();
    } else {
      target = (document.activeElement as HTMLElement | null) ?? document.body;
      if (target !== document.body) await agentCursor.pointAt(target, `Pressing ${key}`);
      else agentCursor.activity(`Pressing ${key}`);
    }
    const parts = key === "+" ? ["+"] : key.split("+").map((p) => p.trim());
    const main = parts.pop() ?? key;
    const mods = new Set(parts.map((p) => p.toLowerCase()));
    if (!(main.length === 1 || NAMED_KEYS.has(main)) || [...mods].some((m) => !MODIFIERS.has(m))) {
      return { ok: false, error: "INVALID_ARGS", reason: `Unknown key "${key}". Use names like Enter, Escape, Tab, ArrowDown, or Control+a` };
    }
    const init: KeyboardEventInit = {
      key: main,
      code: codeFor(main),
      bubbles: true,
      cancelable: true,
      shiftKey: mods.has("shift"),
      ctrlKey: mods.has("control") || mods.has("ctrl"),
      altKey: mods.has("alt"),
      metaKey: mods.has("meta") || mods.has("cmd"),
    };

    if (main === "Enter" && mods.size === 0) {
      this.pressEnter(target!);
    } else if (main === "Tab") {
      // Synthetic Tab does not move focus, so move it ourselves.
      const notCancelled = target!.dispatchEvent(new KeyboardEvent("keydown", init));
      if (notCancelled) this.moveFocus(target!, init.shiftKey ? -1 : 1);
      target!.dispatchEvent(new KeyboardEvent("keyup", init));
    } else {
      target!.dispatchEvent(new KeyboardEvent("keydown", init));
      target!.dispatchEvent(new KeyboardEvent("keyup", init));
    }
    const focused = document.activeElement as HTMLElement | null;
    return { ok: true, focused: focused && focused !== document.body ? `${this.getRole(focused)} "${this.getAccessibleName(focused)}"` : "" };
  }

  // Enter on a field: let page handlers see it; if nobody handled it inside a form, submit the form.
  private pressEnter(target: HTMLElement): void {
    const init: KeyboardEventInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit;
    const notCancelled = target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keypress", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    const form = target.closest("form");
    if (notCancelled && form && !(target instanceof HTMLTextAreaElement) && !target.isContentEditable) {
      form.requestSubmit ? form.requestSubmit() : form.submit();
    }
  }

  private moveFocus(from: HTMLElement, step: 1 | -1): void {
    const focusable = Array.from(
      deepQueryAll(document, "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1']), [contenteditable='true']"),
    ).filter((el) => !(el as HTMLButtonElement).disabled && this.isVisible(el));
    const index = focusable.indexOf(from);
    focusable.at((index + step + focusable.length) % focusable.length)?.focus();
  }

  async scroll(direction: "up" | "down", amount: "page" | "half", ref?: string): Promise<ActionResult> {
    let box: HTMLElement | null = null;
    if (ref) {
      const target = this.resolve(ref);
      if (!target) return this.stale(ref);
      // A ref inside a scroll box scrolls that box; with none around it, the page.
      box = target;
      while (box && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(window.getComputedStyle(box).overflowY))) box = box.parentElement;
    }
    const label = direction === "up" ? "Scrolling ↑" : "Scrolling ↓";
    if (box) await agentCursor.pointAt(box, label);
    else await agentCursor.moveTo(window.innerWidth - 40, window.innerHeight / 2, label);
    const height = box ? box.clientHeight : window.innerHeight;
    const delta = (direction === "up" ? -1 : 1) * Math.round(height * (amount === "half" ? 0.5 : 0.85));
    const before = box ? box.scrollTop : window.scrollY;
    if (box) box.scrollBy({ top: delta, behavior: "instant" });
    else window.scrollBy({ top: delta, behavior: "instant" });
    const after = box ? box.scrollTop : window.scrollY;
    return { ok: true, moved: Math.round(after - before), position: Math.round(after), height: box ? box.scrollHeight : document.documentElement.scrollHeight };
  }

  // The Format button of the biggest code editor, looked for in the editor's
  // containers from the nearest out. Returns a ref for BIGFISH_CLICK, or null.
  formatButton(): { ref: string; name: string } | null {
    const editor = deepQueryAll(document, CODE_EDITOR_SELECTOR)
      .filter((el) => this.isVisible(el))
      .sort((a, b) => area(b) - area(a))[0];
    let node = editor?.parentElement;
    for (let depth = 0; node && depth < FORMAT_MAX_DEPTH; depth++, node = node.parentElement) {
      const button = deepQueryAll(node, "button, [role='button']").find((el) => {
        if (editor!.contains(el) || !this.isVisible(el) || (el as HTMLButtonElement).disabled) return false;
        const labels = [this.getAccessibleName(el), el.getAttribute("data-tooltip"), el.getAttribute("data-original-title"), el.getAttribute("data-tip")];
        return labels.some((l) => FORMAT_LABEL.test((l ?? "").trim()));
      });
      if (button) {
        const ref = this.refFor(button);
        const name = this.getAccessibleName(button);
        this.elementMap.set(ref, button);
        this.fingerprintMap.set(ref, { role: this.getRole(button), name, tag: button.tagName.toLowerCase(), css: this.computeCssSelector(button) });
        return { ref, name: name || "Format" };
      }
    }
    return null;
  }

  // ---- find / check / extract ----------------------------------------------------------

  find(query: string, kind: "element" | "text"): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    if (kind === "text") {
      const text = this.pageText();
      const lower = text.toLowerCase();
      const hits: string[] = [];
      let from = 0;
      while (hits.length < 5) {
        const at = lower.indexOf(q, from);
        if (at < 0) break;
        hits.push(`…${text.slice(Math.max(0, at - 60), at + q.length + 60).replace(/\s+/g, " ")}…`);
        from = at + q.length;
      }
      return hits;
    }
    // Whole-word matches only, so "to" finds "To recipients" but not "Skip to content" first.
    const words = q.split(/\W+/).filter(Boolean);
    const scored = this.scan(null, { max: MAX_FIND_SCAN }).map((e) => {
      const name = e.name.toLowerCase();
      const nameWords = name.split(/\W+/).filter(Boolean);
      const groupWords = (e.group ?? "").toLowerCase().split(/\W+/).filter(Boolean);
      let score = name === q ? 20 : name.startsWith(q) ? 8 : 0;
      let hits = 0;
      for (const w of words) {
        const before = score;
        if (nameWords.includes(w)) score += 3;
        else if (w.length >= 4 && name.includes(w)) score += 1;
        else if (groupWords.includes(w)) score += 1;
        if (e.role === w || (w === "field" && (e.role === "textbox" || e.role === "combobox"))) score += 2;
        if (score > before) hits++;
      }
      // A short name that matches is more likely the label itself.
      if (score > 0) score += Math.max(0, 3 - Math.floor(nameWords.length / 3));
      return { e, score, hits };
    });
    // When some elements match every word ("Item 850"), the ones that match fewer words are noise.
    const most = Math.max(0, ...scored.map((x) => x.hits));
    return scored
      .filter((x) => x.score > 0 && x.hits === most)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ e }) => `${e.ref} ${e.role} "${e.name}"${e.group ? ` in "${e.group}"` : ""}`);
  }

  // Resolves once the DOM had no changes for quietMs (e.g. a streamed chat reply finished), or at timeoutMs.
  waitQuiet(quietMs: number, timeoutMs: number): Promise<{ quiet: boolean; waitedMs: number }> {
    const started = Date.now();
    return new Promise((resolve) => {
      let quietTimer = setTimeout(() => done(true), quietMs);
      const deadline = setTimeout(() => done(false), timeoutMs);
      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => done(true), quietMs);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      function done(quiet: boolean) {
        observer.disconnect();
        clearTimeout(quietTimer);
        clearTimeout(deadline);
        resolve({ quiet, waitedMs: Date.now() - started });
      }
    });
  }

  // One poll of browser_wait_for. URL conditions are checked by the service worker.
  check(cond: { text?: string; gone_text?: string; ref?: string }): boolean {
    const text = cond.text || cond.gone_text ? this.pageText().toLowerCase() : "";
    if (cond.text && !text.includes(cond.text.toLowerCase())) return false;
    if (cond.gone_text && text.includes(cond.gone_text.toLowerCase())) return false;
    if (cond.ref) {
      const el = this.resolve(cond.ref);
      if (!el || !this.isVisible(el) || (el as HTMLButtonElement).disabled) return false;
    }
    return true;
  }

  extract(what: "links" | "table" | "fields", within: HTMLElement | null, filter: string, max: number): string {
    const f = filter.toLowerCase();
    const keep = (s: string) => !f || s.toLowerCase().includes(f);

    if (what === "links") {
      const lines = this.scan(within)
        .filter((e) => e.role === "link" && e.href)
        .map((e) => `${e.ref} "${e.name}" →${e.href}`)
        .filter(keep)
        .slice(0, max);
      return `ok ${lines.length} links\n${lines.join("\n")}`;
    }
    if (what === "fields") {
      const lines = this.scan(within)
        .filter((e) => e.value !== undefined || e.checked !== undefined)
        .map((e) => `${e.ref} ${e.role} "${e.name}" ${e.checked !== undefined ? (e.checked ? "[x]" : "[ ]") : `="${e.value}"`}${e.group ? ` in "${e.group}"` : ""}`)
        .filter(keep)
        .slice(0, max);
      return `ok ${lines.length} fields\n${lines.join("\n")}`;
    }

    const root = within ?? document.body;
    const tables = Array.from(root.querySelectorAll("table")).filter((t) => this.isVisible(t as HTMLElement));
    if (within instanceof HTMLTableElement) tables.unshift(within);
    // The biggest table is usually the data one.
    const table = tables.sort((a, b) => b.rows.length - a.rows.length)[0];
    if (!table) return "ok 0 rows (no table here)";
    const rows = Array.from(table.rows).map((row) =>
      Array.from(row.cells)
        .map((c) => (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim())
        .join("\t"),
    );
    const [header, ...body] = rows;
    const kept = body.filter(keep).slice(0, max);
    return `ok table ${kept.length} rows\n${[header ?? "", ...kept].join("\n")}`;
  }
}

function area(el: Element): number {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function codeFor(key: string): string {
  if (key.length === 1) return /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /\d/.test(key) ? `Digit${key}` : key;
  return key;
}

export const bigFishDOM = new BigFishDOMEngine();
