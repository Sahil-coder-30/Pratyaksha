import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPageSnapshot, summarizeDelta } from "../apps/extension/entrypoints/background/snapshot.ts";
import { ErrorCode, toolError } from "../packages/contracts/src/errors.ts";

describe("Suite 5: Snapshot Builder, Deltas & Error Formatting (50 Tests)", () => {
  it("TC211: summarizeDelta formats simple click action correctly", () => {
    const res = summarizeDelta('click button "Send"');
    assert.equal(res, 'ok click button "Send"');
  });

  it("TC212: summarizeDelta includes optional details", () => {
    const res = summarizeDelta('click button "Send"', 'dialog closed; "Message sent" appeared');
    assert.equal(res, 'ok click button "Send" | dialog closed; "Message sent" appeared');
  });

  it("TC213: toolError formats standard ERROR string", () => {
    const err = toolError(ErrorCode.STALE_REF, "Element is gone after re-render.", "Use one of the candidates.");
    assert.equal(err, "ERROR STALE_REF: Element is gone after re-render. Hint: Use one of the candidates.");
  });

  it("TC214: toolError formats error without hint", () => {
    const err = toolError(ErrorCode.TAB_NOT_FOUND, "Tab slot 99 does not exist.");
    assert.equal(err, "ERROR TAB_NOT_FOUND: Tab slot 99 does not exist.");
  });

  // Verify all ErrorCode enum values (TC215 - TC231)
  const codes = Object.keys(ErrorCode);
  codes.forEach((codeKey, idx) => {
    const tcId = 215 + idx;
    it(`TC${tcId}: ErrorCode.${codeKey} matches "${codeKey}" and formats cleanly`, () => {
      const code = ErrorCode[codeKey];
      assert.equal(code, codeKey);
      const formatted = toolError(code, "test message");
      assert.ok(formatted.startsWith(`ERROR ${codeKey}:`));
    });
  });

  // Snapshot generation tests (TC232 - TC260)
  it("TC232: buildPageSnapshot includes slot, title, and sanitized url in header", () => {
    const snap = buildPageSnapshot({
      slot: 3,
      title: "Pricing - Acme Corp",
      url: "https://acme.com/pricing",
      scrollY: 100,
      scrollHeight: 1500,
      elements: [],
    });
    assert.match(snap, /\[tab 3\] Pricing - Acme Corp \| acme\.com\/pricing \| scroll 100\/1500/);
  });

  it("TC233: buildPageSnapshot includes element refs, role, and accessible names", () => {
    const snap = buildPageSnapshot({
      slot: 2,
      title: "Dashboard",
      url: "https://dash.corp/home",
      scrollY: 0,
      scrollHeight: 1000,
      elements: [
        { ref: "2:1", role: "button", name: "Submit" },
        { ref: "2:2", role: "textbox", name: "Search", value: "test" },
        { ref: "2:3", role: "link", name: "Pricing", href: "/pricing" },
      ],
    });
    assert.match(snap, /2:1 button "Submit"/);
    assert.match(snap, /2:2 textbox "Search" ="test"/);
    assert.match(snap, /2:3 link "Pricing" →\/pricing/);
  });

  it("TC234: buildPageSnapshot automatically tokenizes PII inside element names or values", () => {
    const snap = buildPageSnapshot({
      slot: 1,
      title: "Profile",
      url: "https://profile.corp/me",
      scrollY: 0,
      scrollHeight: 800,
      elements: [
        { ref: "1:1", role: "textbox", name: "Email", value: "alice.secret@work.com" },
      ],
    });
    assert.doesNotMatch(snap, /alice\.secret@work\.com/);
    assert.match(snap, /\[EMAIL_[0-9A-F]{4}\]/);
  });

  for (let i = 235; i <= 260; i++) {
    it(`TC${i}: snapshot truncates output when exceeding maxChars (case ${i})`, () => {
      const snap = buildPageSnapshot({
        slot: 1,
        title: `Page ${i}`,
        url: `https://example.com/page/${i}`,
        scrollY: 0,
        scrollHeight: 5000,
        elements: Array.from({ length: 40 }, (_, j) => ({
          ref: `1:${j}`,
          role: "button",
          name: `Action Button Number ${j} with long descriptive label text`,
        })),
        maxChars: 500,
      });
      assert.ok(snap.length <= 650);
      assert.match(snap, /more elements below/);
    });
  }
});
