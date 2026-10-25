// BigFish MCP tool contracts (zod v4). The 15 browser tools are defined here.
import { z } from "zod";

export interface ToolContract {
  name: string;
  description: string;
  input: z.ZodObject<any>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export const TOOLS: ToolContract[] = [
  {
    name: "browser_ping",
    description: "Check that the BigFish extension is connected.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_tabs",
    description: "List, switch, or close tabs in the browser.",
    input: z.object({
      action: z.enum(["list", "switch", "close"]),
      tab: z.number().optional().describe("Tab slot to switch to or close. Omit for list."),
    }),
  },
  {
    name: "browser_navigate",
    description: "Open a URL, or (without url) go back, forward, or reload. Never send action together with url.",
    input: z.object({
      url: z.string().optional().describe("Page to open. Omit only when using action."),
      action: z.enum(["back", "forward", "reload"]).optional().describe("Only when there is no url. Omit when opening a url."),
      tab: z.number().optional().describe("Tab slot from browser_tabs. Omit for the active tab."),
      new_tab: z.boolean().optional().describe("true opens the url in a new tab. Omit to use the current tab."),
    }),
  },
  {
    name: "browser_snapshot",
    description: "Compact view of the page interactive elements or text. from_end=true reads the newest text, like the latest chat reply.",
    input: z.object({
      tab: z.number().optional().describe("Tab slot from browser_tabs. Omit for the active tab."),
      mode: z.enum(["interactive", "text"]).optional().default("interactive").describe("interactive: fields, buttons, links. text: the page text."),
      within: z.string().optional().describe("Ref of a container to look inside. Omit for the whole page."),
      max_chars: z.number().optional().default(3000),
      offset: z.number().optional().default(0).describe("Skip this many elements or chars, to page through a long result."),
      from_end: z.boolean().optional().describe("true reads the newest text at the end (mode=text). Omit otherwise."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_find",
    description: "Search the page for an element or text match.",
    input: z.object({
      query: z.string(),
      tab: z.number().optional().describe("Tab slot from browser_tabs. Omit for the active tab."),
      kind: z.enum(["element", "text"]).optional().default("element").describe("element: fields, buttons, links. text: words on the page."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_click",
    description: "Click an element by its ref ID.",
    input: z.object({
      ref: z.string(),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_type",
    description: "Type text into an input field by ref ID.",
    input: z.object({
      ref: z.string(),
      text: z.string(),
      submit: z.boolean().optional().default(false).describe("true presses Enter after typing."),
      clear: z.boolean().optional().default(true).describe("false appends to the current text."),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_fill_form",
    description: "Fill text fields, dropdowns, radios and checkboxes in one call (value \"true\" checks a box), then optionally click submit_ref.",
    input: z.object({
      fields: z.array(z.object({ ref: z.string(), value: z.string() })).max(15),
      submit_ref: z.string().optional().describe("Ref of the submit button to click after filling. Omit to only fill."),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_select",
    description: "Pick an option in a dropdown or combobox.",
    input: z.object({
      ref: z.string(),
      option: z.string(),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_press_key",
    description: "Press a keyboard key such as Enter, Escape, or Tab.",
    input: z.object({
      key: z.string(),
      ref: z.string().optional().describe("Ref to focus first. Omit to press on the focused element."),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_scroll",
    description: "Scroll the page or a scrollable element up or down.",
    input: z.object({
      direction: z.enum(["up", "down"]),
      ref: z.string().optional().describe("Ref of a scrollable element. Omit to scroll the page."),
      amount: z.enum(["page", "half"]).optional().default("page"),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_wait_for",
    description: "Wait for text, URL, an element, or idle=true: the page stopped changing (a chat reply finished). Max 60000 ms.",
    input: z.object({
      text: z.string().optional().describe("Wait until this text shows. Omit if not waiting for text."),
      gone_text: z.string().optional().describe("Wait until this text is gone. Omit if not needed."),
      url_contains: z.string().optional().describe("Wait until the URL contains this. Omit if not needed."),
      ref: z.string().optional().describe("Wait until this element is visible and enabled. Omit if not needed."),
      idle: z.boolean().optional().describe("true waits until the page stops changing. Omit otherwise."),
      timeout_ms: z.number().optional().default(5000),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_screenshot",
    description:
      "Screenshot of the visible part of the page, with private data replaced by tokens like [NAME_1A2B]. Use only when the snapshot is not enough: images, canvas, charts, layout.",
    input: z.object({
      tab: z.number().optional().describe("Tab slot from browser_tabs. Omit for the active tab."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_extract",
    description: "Pull links, tables, or fields as structured text.",
    input: z.object({
      what: z.enum(["links", "table", "fields"]),
      within: z.string().optional().describe("Ref of a container to look inside. Omit for the whole page."),
      filter: z.string().optional().describe("Keep only lines with this text. Omit to keep all."),
      max: z.number().optional().default(25),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_code_editor",
    description:
      "Read or replace the code in the page's code editor (Monaco on LeetCode, CodeMirror, Ace). Use it for code instead of browser_type, which breaks indents and brackets there. write then clicks the editor's Format button.",
    input: z.object({
      action: z.enum(["read", "write"]).describe("read: language and current code. write: replace all code."),
      code: z.string().optional().describe("The complete code for write. Omit for read."),
      format: z.boolean().optional().default(true).describe("false skips formatting after write."),
      tab: z.number().optional().describe("Tab slot from browser_tabs. Omit for the active tab."),
    }),
    annotations: { destructiveHint: true },
  },
];

// Models often send every optional field: null, "", false, or a stray value.
// Those are dropped before a call runs, so they cannot change what the tool does.
export function normalizeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const shape = TOOLS.find((t) => t.name === name)?.input.shape ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    const field = shape[key] as z.ZodType | undefined;
    const fallback = field?.safeParse(undefined);
    const optional = !fallback || fallback.success;
    // false is only "not set" when the default is not true (clear=false must stay).
    const unset = value === null || value === "" || (value === false && fallback?.data !== true);
    if (optional && unset) continue;
    out[key] = value;
  }
  // A url wins over a stray back/forward/reload.
  if (name === "browser_navigate" && out.url) delete out.action;
  if (name === "browser_tabs" && out.action === "list") delete out.tab;
  if (name === "browser_code_editor" && out.action === "read") delete out.code;
  return out;
}

// Server-side allowlist. Tools an extension reports outside this set never reach the agent.
export const TOOL_NAMES: ReadonlySet<string> = new Set(TOOLS.map((t) => t.name));
