// BigFish snapshot and delta text (formats in Docs/Browser-Tools.md 2.3 and 2.4).
// PII is redacted later, for every tool result, in the executor.
import type { ScannedElement } from "../content/dom-actions.js";

export interface ScanResult {
  elements: ScannedElement[];
  url: string;
  title: string;
  scrollY: number;
  scrollHeight: number;
  dialog?: string;
  alerts?: string[];
  // Short visible text lines (see visibleLines in the content script).
  lines?: string[];
}

const DELTA_NEW_LIMIT = 5;
const DELTA_TEXT_LIMIT = 3;

// A long field value, cut for the model. The mark says the field itself holds it all,
// so the model does not type it again.
export function clipValue(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}… [${value.length} chars]`;
}

// Kept whole up to a long cap: the model copies URLs from here, and a cut URL
// opens the wrong page. A cut one ends with "…" so it is not copied as is.
const URL_MAX = 300;

export function shortUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return bare.length <= URL_MAX ? bare : `${bare.slice(0, URL_MAX)}…`;
}

export function header(slot: number, page: Omit<ScanResult, "elements">): string {
  const parts = [`[tab ${slot}] ${page.title.slice(0, 60)}`, shortUrl(page.url), `scroll ${page.scrollY}/${page.scrollHeight}`];
  if (page.dialog) parts.push(`dialog:"${page.dialog}"`);
  return parts.join(" | ");
}

export function elementLine(e: ScannedElement, isNew = false): string {
  let line = `${isNew ? "*" : ""}${e.ref} ${e.role} "${e.name.replace(/"/g, "'")}"`;
  if (e.checked !== undefined) line += e.checked ? " [x]" : " [ ]";
  else if (e.value !== undefined) line += ` ="${clipValue(e.value, 40).replace(/"/g, "'")}"`;
  if (e.href && !e.href.startsWith("javascript:")) {
    const path = e.href.replace(/^https?:\/\/[^/]+/, "") || "/";
    line += ` →${path.length <= 40 ? path : `${path.slice(0, 40)}…`}`;
  }
  if (e.group) line += ` in "${e.group.replace(/"/g, "'")}"`;
  return line;
}

// offset skips that many elements, so the agent can page through long lists.
export function buildSnapshot(slot: number, scan: ScanResult, opts: { maxChars: number; offset: number; newRefs: Set<string> }): string {
  const lines = [header(slot, scan)];
  let used = lines[0]!.length;
  let shown = 0;
  const elements = scan.elements.slice(opts.offset);
  for (const e of elements) {
    const line = elementLine(e, opts.newRefs.has(e.ref));
    if (used + line.length + 1 > opts.maxChars) break;
    lines.push(line);
    used += line.length + 1;
    shown++;
  }
  const rest = elements.length - shown;
  if (rest > 0) lines.push(`… ${rest} more below (offset=${opts.offset + shown}, or use within= / browser_find)`);
  if (scan.elements.length === 0) lines.push("(no interactive elements; try mode=text)");
  return lines.join("\n");
}

export function buildTextSnapshot(
  slot: number,
  page: Omit<ScanResult, "elements"> & { text: string },
  opts: { maxChars: number; offset: number; fromEnd?: boolean },
): string {
  const head = header(slot, page);
  if (opts.fromEnd) {
    // The newest text (e.g. the latest chat reply) is at the bottom.
    const body = page.text.slice(-opts.maxChars);
    const before = page.text.length - body.length;
    return [head, before > 0 ? `… ${before} earlier chars (read from the end)` : "", body || "(no text)"].filter(Boolean).join("\n");
  }
  const body = page.text.slice(opts.offset, opts.offset + opts.maxChars);
  const rest = page.text.length - opts.offset - body.length;
  return [head, body || "(no text)", rest > 0 ? `… ${rest} more chars (offset=${opts.offset + body.length})` : ""].filter(Boolean).join("\n");
}

// What changed after an action, in one short line.
export function buildDelta(action: string, before: ScanResult | null, after: ScanResult | null): string {
  const parts = [`ok ${action}`];
  if (before && after && before.url !== after.url) {
    parts.push(`navigated to ${shortUrl(after.url)} "${after.title.slice(0, 50)}"`);
    return parts.join(" | ");
  }
  if (!after) return parts.join(" | ");
  if (before?.dialog !== after.dialog) {
    if (after.dialog) parts.push(`dialog opened "${after.dialog}"`);
    else parts.push(`dialog closed`);
  }
  if (before) {
    const old = new Set(before.elements.map((e) => e.ref));
    const now = new Set(after.elements.map((e) => e.ref));
    const added = after.elements.filter((e) => !old.has(e.ref));
    const gone = before.elements.filter((e) => !now.has(e.ref)).length;
    if (added.length) {
      const shown = added.slice(0, DELTA_NEW_LIMIT).map((e) => elementLine(e));
      parts.push(`+${added.length} new: ${shown.join(", ")}${added.length > DELTA_NEW_LIMIT ? ", …" : ""}`);
    }
    if (gone) parts.push(`-${gone} gone`);
    // Same element, new state: a checked radio, a changed value.
    const was = new Map(before.elements.map((e) => [e.ref, e]));
    const changed = after.elements.filter((e) => {
      const old = was.get(e.ref);
      return old && (old.checked !== e.checked || old.value !== e.value);
    });
    if (changed.length) {
      parts.push(`changed: ${changed.slice(0, DELTA_NEW_LIMIT).map((e) => elementLine(e)).join(", ")}${changed.length > DELTA_NEW_LIMIT ? ", …" : ""}`);
    }
    const oldAlerts = new Set(before.alerts ?? []);
    const newAlerts = (after.alerts ?? []).filter((a) => !oldAlerts.has(a));
    if (newAlerts.length) parts.push(`alert: ${newAlerts.map((a) => `"${a}"`).join(", ")}`);
    // Text the action added that no element line already shows (a status message, a result).
    const oldLines = new Set(before.lines ?? []);
    const shown = new Set([...after.elements.flatMap((e) => [e.name, e.value ?? ""]), ...newAlerts]);
    const newText = (after.lines ?? []).filter((l) => !oldLines.has(l) && !shown.has(l));
    if (newText.length) {
      const quoted = newText.slice(0, DELTA_TEXT_LIMIT).map((l) => `"${l.slice(0, 80)}"`);
      parts.push(`text: ${quoted.join(", ")}${newText.length > DELTA_TEXT_LIMIT ? ", …" : ""}`);
    }
    if (!added.length && !gone && !changed.length && !newAlerts.length && !newText.length && before.dialog === after.dialog) parts.push("no visible change");
  }
  return parts.join(" | ");
}
