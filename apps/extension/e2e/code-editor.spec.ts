// browser_code_editor in a real browser, on a LeetCode-like page: a Monaco
// editor (from the jsdelivr CDN) with auto-closing brackets and auto-indent on,
// a hidden second editor, an unlabelled icon button that wipes the code, and
// a Format that reads the site's own debounced copy of the code.
import { expect, test } from "@playwright/test";
import { startHarness, type Harness } from "./harness.js";

test.describe.configure({ mode: "serial" });

let h: Harness;

// Unformatted on purpose. Typed into Monaco, its brackets and indents would double.
const SOLUTION = [
  "var twoSum = function(nums, target) {",
  "const seen = new Map();",
  "for (let i = 0; i < nums.length; i++) {",
  "if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];",
  "seen.set(nums[i], i);",
  "}",
  "return [];",
  "};",
].join("\n");

const FORMATTED = [
  "var twoSum = function(nums, target) {",
  "    const seen = new Map();",
  "    for (let i = 0; i < nums.length; i++) {",
  "        if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];",
  "        seen.set(nums[i], i);",
  "    }",
  "    return [];",
  "};",
].join("\n");

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await h?.close();
});

async function openCode(mode = "button"): Promise<void> {
  const nav = await h.callTool("browser_navigate", { url: `${h.fixtureUrl("code.html")}?mode=${mode}` });
  expect(nav.ok, nav.text).toBe(true);
  const ready = await h.callTool("browser_wait_for", { text: "Editor ready", timeout_ms: 30_000 });
  expect(ready.ok, ready.text).toBe(true);
}

async function editorValue(): Promise<string> {
  return h.page.evaluate(() => (window as any).monaco.editor.getEditors()[0].getValue());
}

test("read gives the language and the whole starter code of the main editor", async () => {
  await openCode();
  const read = await h.callTool("browser_code_editor", { action: "read", code: "" });
  expect(read.ok, read.text).toBe(true);
  expect(read.text).toMatch(/^ok Monaco editor \[tab \d+\] \| language javascript \| 8 lines\n/);
  expect(read.text).toContain("var twoSum = function(nums, target) {");
  expect(read.text).toContain("@param {number[]} nums");
});

test("write puts the code in exactly, then clicks the labelled Format button, not the icon next to it", async () => {
  await openCode();
  const wrote = await h.callTool("browser_code_editor", { action: "write", code: SOLUTION });
  expect(wrote.ok, wrote.text).toBe(true);
  expect(wrote.text).toMatch(/^ok wrote 8 lines into the Monaco editor \[tab \d+\] \| language javascript \| clicked "Format", formatted to 8 lines/);
  expect(await editorValue()).toBe(FORMATTED);
  expect(await h.page.evaluate(() => (window as any).wiped)).toBe(false);
  // The site's own copy has the new code too, so its Run or Submit sends it.
  await expect.poll(() => h.page.evaluate(() => (window as any).savedCode)).toBe(FORMATTED);
});

test("without a Format button, the editor's own Format code action runs (LeetCode)", async () => {
  await openCode("action");
  const wrote = await h.callTool("browser_code_editor", { action: "write", code: SOLUTION });
  expect(wrote.ok, wrote.text).toBe(true);
  expect(wrote.text).toContain(`ran the editor's "Format code", formatted to 8 lines`);
  expect(await editorValue()).toBe(FORMATTED);
  expect(await h.page.evaluate(() => (window as any).wiped)).toBe(false);
});

test("format=false keeps the code as written, and read returns it unchanged", async () => {
  await openCode("none");
  const wrote = await h.callTool("browser_code_editor", { action: "write", code: SOLUTION, format: false });
  expect(wrote.ok, wrote.text).toBe(true);
  expect(wrote.text).not.toContain("format");
  expect(await editorValue()).toBe(SOLUTION);
  const read = await h.callTool("browser_code_editor", { action: "read" });
  expect(read.text.split("\n").slice(1).join("\n")).toBe(SOLUTION);
});

test("a page without a code editor is a clear error", async () => {
  await h.callTool("browser_navigate", { url: h.fixtureUrl("heading.html") });
  const read = await h.callTool("browser_code_editor", { action: "read" });
  expect(read.ok).toBe(false);
  expect(read.text).toMatch(/^ERROR NOT_EDITABLE: No code editor on this page\./);
  const write = await h.callTool("browser_code_editor", { action: "write" });
  expect(write.text).toMatch(/^ERROR INVALID_ARGS: Give code/);
});
