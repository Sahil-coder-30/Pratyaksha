// Tool edge cases in a real browser, through the same MCP pipe the agent uses:
// filler args, error pages, shadow DOM, covered/disabled/read-only elements,
// text-only changes, new tabs, made-up tokens and bad keys.
import { expect, test } from "@playwright/test";
import { startHarness, type Harness } from "./harness.js";

test.describe.configure({ mode: "serial" });

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await h?.close();
});

// The first ref in a result whose line contains `label`.
function refOf(text: string, label: string): string {
  const ref = text.split(/\n|, /).find((l) => l.includes(label))?.match(/\d+:\d+/)?.[0];
  if (!ref) throw new Error(`No ref for ${label} in:\n${text}`);
  return ref;
}

async function openEdge(): Promise<string> {
  const nav = await h.callTool("browser_navigate", { url: h.fixtureUrl("edge.html") });
  expect(nav.ok, nav.text).toBe(true);
  return (await h.callTool("browser_snapshot", { max_chars: 6000 })).text;
}

test("null, empty and false filler args from an MCP client are ignored; a url wins over action", async () => {
  const nav = await h.callTool("browser_navigate", { url: h.fixtureUrl("edge.html"), action: "back", tab: null, new_tab: false, within: "" });
  expect(nav.ok, nav.text).toBe(true);
  expect(nav.text).toContain("BigFish Edge Cases");
});

test("an error page (404, site down) is an error, not 'ok navigated'", async () => {
  const missing = await h.callTool("browser_navigate", { url: h.fixtureUrl("nope.html") });
  expect(missing.text).toMatch(/^ERROR PAGE_UNRESPONSIVE: The page did not load/);
  const down = await h.callTool("browser_navigate", { url: "http://127.0.0.1:1/" });
  expect(down.text).toMatch(/^ERROR PAGE_UNRESPONSIVE: The page did not load/);
});

test("a local address without a scheme opens over http", async () => {
  const nav = await h.callTool("browser_navigate", { url: h.fixtureUrl("heading.html").replace(/^http:\/\//, "") });
  expect(nav.text).toMatch(/^ok navigated\n\[tab \d+\] BigFish Heading Fixture/);
});

test("back with no history says so, instead of 'wait and retry'", async () => {
  await h.callTool("browser_navigate", { url: h.fixtureUrl("heading.html"), new_tab: true });
  const back = await h.callTool("browser_navigate", { action: "back" });
  expect(back.text).toMatch(/^ERROR INVALID_ARGS: There is no page to go back to/);
});

test("fields say which question or group they belong to", async () => {
  const snap = await openEdge();
  expect(snap).toMatch(/checkbox "Weekly" \[x\] in "Newsletter"/);
  expect(snap).toMatch(/option "Small" \[ \] in "Size"/);
});

test("shadow DOM elements can be found, typed into and clicked", async () => {
  await openEdge();
  const input = refOf((await h.callTool("browser_find", { query: "shadow input" })).text, 'textbox "Shadow input"');
  expect((await h.callTool("browser_type", { ref: input, text: "deep" })).ok).toBe(true);
  const button = refOf((await h.callTool("browser_find", { query: "shadow button" })).text, 'button "Shadow button"');
  const clicked = await h.callTool("browser_click", { ref: button });
  expect(clicked.text).toContain('text: "shadow clicked deep"');
});

test("find looks past the first 800 elements and drops partial matches", async () => {
  await openEdge();
  const found = await h.callTool("browser_find", { query: "Item 850" });
  expect(found.text).toMatch(/^ok 1 matches\n\d+:\d+ button "Item 850"$/);
});

test("covered, disabled and read-only elements fail with a hint that fits", async () => {
  const snap = await openEdge();
  const covered = await h.callTool("browser_click", { ref: refOf(snap, 'button "Covered button"') });
  expect(covered.text).toMatch(/^ERROR NOT_ACTIONABLE: .* covered by #overlay\. Hint: Something is on top of it/);
  const disabled = await h.callTool("browser_click", { ref: refOf(snap, 'button "Disabled button"') });
  expect(disabled.text).toMatch(/disabled\. Hint: It is disabled/);
  const readOnly = await h.callTool("browser_type", { ref: refOf(snap, 'textbox "Readonly code"'), text: "HACK" });
  expect(readOnly.text).toMatch(/^ERROR NOT_EDITABLE: .*read-only/);
  const bad = await h.callTool("browser_click", { ref: "abc" });
  expect(bad.text).toMatch(/^ERROR INVALID_ARGS: "abc" is not a ref/);
});

test("a click or key that only changes text reports that text, not 'no visible change'", async () => {
  const snap = await openEdge();
  await h.callTool("browser_click", { ref: refOf(snap, 'button "Close overlay"') });
  const clicked = await h.callTool("browser_click", { ref: refOf(snap, 'button "Covered button"') });
  expect(clicked.text).toContain('text: "covered clicked"');
  const search = refOf(snap, 'searchbox "Search site"');
  await h.callTool("browser_type", { ref: search, text: "fish" });
  const pressed = await h.callTool("browser_press_key", { key: "Enter", ref: search });
  expect(pressed.text).toContain('text: "searched fish"');
});

test("select works on ARIA listboxes, and refuses elements that are not dropdowns", async () => {
  const snap = await openEdge();
  const picked = await h.callTool("browser_select", { ref: refOf(snap, 'listbox "Size"'), option: "Large" });
  expect(picked.text).toMatch(/option "Large" \[x\] in "Size"/);
  const notDropdown = await h.callTool("browser_select", { ref: refOf(snap, 'button "Load later"'), option: "x" });
  expect(notDropdown.text).toMatch(/^ERROR NOT_EDITABLE: .*not a dropdown/);
});

test("a made-up private data token and an unknown key are refused", async () => {
  const snap = await openEdge();
  const token = await h.callTool("browser_fill_form", { fields: [{ ref: refOf(snap, 'textbox "Notes"'), value: "[EMAIL_0000]" }] });
  expect(token.text).toMatch(/^ERROR INVALID_ARGS: Unknown private data token \[EMAIL_0000\]/);
  const key = await h.callTool("browser_press_key", { key: "Hyperdrive" });
  expect(key.text).toMatch(/^ERROR INVALID_ARGS: Unknown key "Hyperdrive"/);
});

test("a click that opens a new tab says which tab", async () => {
  const snap = await openEdge();
  const clicked = await h.callTool("browser_click", { ref: refOf(snap, 'link "Open heading in a new tab"') });
  expect(clicked.text).toMatch(/opened tab \d+ "BigFish Heading Fixture" \(now active\)/);
});

test("PII on the page never reaches the tool results", async () => {
  await openEdge();
  const text = await h.callTool("browser_snapshot", { mode: "text", max_chars: 400 });
  const links = await h.callTool("browser_extract", { what: "links" });
  for (const out of [text.text, links.text]) {
    expect(out).not.toContain("help@fishmail.example");
    expect(out).not.toContain("owner@fishmail.example");
    expect(out).not.toContain("99887");
  }
});
