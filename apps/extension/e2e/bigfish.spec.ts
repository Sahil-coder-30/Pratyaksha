// BigFish tools in a real browser, called through the server like the agent does.
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
function refOf(text: string, label: string | RegExp): string {
  const line = text.split(/\n|, /).find((l) => (typeof label === "string" ? l.includes(label) : label.test(l)));
  const ref = line?.match(/\d+:\d+/)?.[0];
  if (!ref) throw new Error(`No ref for ${label} in:\n${text}`);
  return ref;
}

async function openForm(): Promise<string> {
  const nav = await h.callTool("browser_navigate", { url: h.fixtureUrl("form.html") });
  expect(nav.ok, nav.text).toBe(true);
  const snap = await h.callTool("browser_snapshot", {});
  expect(snap.ok, snap.text).toBe(true);
  return snap.text;
}

test("open a page and read its heading", async () => {
  const nav = await h.callTool("browser_navigate", { url: h.fixtureUrl("heading.html") });
  expect(nav.ok, nav.text).toBe(true);
  expect(nav.text).toMatch(/^ok navigated\n\[tab \d+\] BigFish Heading Fixture/);
  expect(nav.text).toContain('link "Go to the form"');

  const text = await h.callTool("browser_snapshot", { mode: "text" });
  expect(text.text).toContain("Welcome to the BigFish test page");
});

test("refs are tab-scoped, and find / type / select / click return deltas", async () => {
  const snap = await openForm();
  expect(snap).toMatch(/\d+:\d+ textbox "Subject" =""/);
  expect(snap).toMatch(/\d+:\d+ combobox "Plan" ="Free"/);

  const found = await h.callTool("browser_find", { query: "subject" });
  const subject = refOf(found.text, 'textbox "Subject"');

  const typed = await h.callTool("browser_type", { ref: subject, text: "Pricing update" });
  expect(typed.ok, typed.text).toBe(true);
  expect(typed.text).toContain('type textbox "Subject" ="Pricing update"');
  await expect(h.page.locator("input[name=subject]")).toHaveValue("Pricing update");

  const selected = await h.callTool("browser_select", { ref: refOf(snap, 'combobox "Plan"'), option: "pro" });
  expect(selected.text).toContain('selected "Pro"');
  await expect(h.page.locator("select[name=plan]")).toHaveValue("pro");

  const missing = await h.callTool("browser_select", { ref: refOf(snap, 'combobox "Plan"'), option: "Enterprise" });
  expect(missing.text).toMatch(/^ERROR OPTION_NOT_FOUND.*Options: Free \| Pro/);

  const saved = await h.callTool("browser_click", { ref: refOf(snap, 'button "Save draft"') });
  expect(saved.ok, saved.text).toBe(true);
  const waited = await h.callTool("browser_wait_for", { text: "Draft saved", timeout_ms: 3000 });
  expect(waited.text).toMatch(/^ok met/);
});

test("PII is a token outside the browser, and the real value inside it", async () => {
  await openForm();
  const text = await h.callTool("browser_snapshot", { mode: "text" });
  expect(text.text).not.toContain("priya@example.com");
  expect(text.text).not.toContain("98765 43210");
  const token = text.text.match(/\[EMAIL_[0-9A-F]{4}\]/)?.[0];
  expect(token).toBeTruthy();

  const snap = await h.callTool("browser_snapshot", {});
  const typed = await h.callTool("browser_type", { ref: refOf(snap.text, 'textbox "To"'), text: token! });
  expect(typed.ok, typed.text).toBe(true);
  expect(typed.text).toContain(token!);
  expect(typed.text).not.toContain("priya@example.com");
  await expect(h.page.locator("input[name=to]")).toHaveValue("priya@example.com");
});

test("a ref from the previous page is STALE_REF after navigation", async () => {
  const snap = await openForm();
  const save = refOf(snap, 'button "Save draft"');
  await h.callTool("browser_navigate", { url: h.fixtureUrl("heading.html") });
  const click = await h.callTool("browser_click", { ref: save });
  expect(click.ok).toBe(false);
  expect(click.text).toMatch(/^ERROR STALE_REF/);
});

test("Send asks for approval in the side panel, and runs only after Approve", async () => {
  const snap = await openForm();
  const call = h.callTool("browser_click", { ref: refOf(snap, 'button "Send"') });

  const card = h.panel.locator(".approval-card").last();
  await expect(card).toContainText("Clicking sensitive button");
  await expect(h.page.locator("#status")).toHaveText("");
  await card.getByRole("button", { name: "Approve" }).click();

  const result = await call;
  expect(result.ok, result.text).toBe(true);
  await expect(h.page.locator("#status")).toHaveText("Message sent");
});

test("Deny returns APPROVAL_DENIED and nothing happens", async () => {
  const snap = await openForm();
  const call = h.callTool("browser_click", { ref: refOf(snap, 'button "Send"') });
  await h.panel.locator(".approval-card").last().getByRole("button", { name: "Deny" }).click();
  const result = await call;
  expect(result.text).toMatch(/^ERROR APPROVAL_DENIED/);
  await expect(h.page.locator("#status")).toHaveText("");
});

test("Enter in a search box needs no approval", async () => {
  const snap = await openForm();
  const pressed = await h.callTool("browser_press_key", { key: "Enter", ref: refOf(snap, 'searchbox "Search messages"') });
  expect(pressed.ok, pressed.text).toBe(true);
  await expect(h.page.locator("#status")).toHaveText("Searched");
});

test("with no side panel open, the approval opens a popup window", async () => {
  await h.panel.close();
  const snap = await openForm();
  const popupOpened = h.context.waitForEvent("page", (p) => p.url().includes("approvalId="));
  const call = h.callTool("browser_click", { ref: refOf(snap, 'button "Send"') });

  const popup = await popupOpened;
  // The popup closes itself as soon as the decision is made.
  await Promise.all([popup.waitForEvent("close"), popup.getByRole("button", { name: "Approve" }).click().catch(() => {})]);
  const result = await call;
  expect(result.ok, result.text).toBe(true);
  await expect(h.page.locator("#status")).toHaveText("Message sent");
});

test("wait_for gives up with TIMEOUT", async () => {
  const waited = await h.callTool("browser_wait_for", { text: "never shows up", timeout_ms: 500 });
  expect(waited.text).toMatch(/^ERROR TIMEOUT/);
});

test("the agent cursor and control frame show on the page during an action", async () => {
  const snap = await openForm();
  const call = h.callTool("browser_click", { ref: refOf(snap, 'button "Save draft"') });
  // Mid-move: the overlay is on the page while the click happens.
  await expect(h.page.locator("bigfish-agent-cursor")).toHaveCount(1);
  await h.page.waitForTimeout(250);
  await h.page.screenshot({ path: "test-results/agent-cursor.png" });
  expect((await call).ok).toBe(true);
  await expect(h.page.locator("#status")).toHaveText("Draft saved");
});

test("fill_form handles text, ARIA radios and checkboxes; a missing field shows up as an alert", async () => {
  await h.callTool("browser_navigate", { url: h.fixtureUrl("survey.html") });
  const snap = (await h.callTool("browser_snapshot", {})).text;
  // Each radio says which question it answers.
  expect(snap).toMatch(/radio "2022" \[ \] in "Graduation year"/);

  const early = await h.callTool("browser_click", { ref: refOf(snap, 'button "Submit"') });
  expect(early.text).toContain('alert: "This is a required question"');

  const filled = await h.callTool("browser_fill_form", {
    fields: [
      { ref: refOf(snap, "What's your name"), value: "Asha" },
      { ref: refOf(snap, 'radio "2022"'), value: "true" },
      { ref: refOf(snap, 'checkbox "Send me updates"'), value: "true" },
    ],
    submit_ref: refOf(snap, 'button "Submit"'),
  });
  expect(filled.ok, filled.text).toBe(true);
  expect(filled.text).toMatch(/radio "2022" \[x\]/);
  expect(filled.text).toMatch(/checkbox "Send me updates" \[x\]/);
  await expect(h.page.locator("#done")).toBeVisible();
});
