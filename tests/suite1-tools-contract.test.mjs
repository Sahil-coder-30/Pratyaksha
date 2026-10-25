import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../packages/contracts/src/tools.ts";

describe("Suite 1: Tool Contracts & Zod Schemas (60 Tests)", () => {
  it("TC001: TOOLS list has exactly 13 defined tools", () => {
    assert.equal(TOOLS.length, 13);
  });

  const toolNames = [
    "browser_ping",
    "browser_tabs",
    "browser_navigate",
    "browser_snapshot",
    "browser_find",
    "browser_click",
    "browser_type",
    "browser_fill_form",
    "browser_select",
    "browser_press_key",
    "browser_scroll",
    "browser_wait_for",
    "browser_extract",
  ];

  toolNames.forEach((name, idx) => {
    it(`TC${String(idx + 2).padStart(3, "0")}: Tool "${name}" exists and has valid name and description`, () => {
      const tool = TOOLS.find((t) => t.name === name);
      assert.ok(tool, `Tool ${name} should exist in TOOLS`);
      assert.ok(tool.description.length > 5);
      const wordCount = tool.description.trim().split(/\s+/).length;
      assert.ok(wordCount <= 25, `Description for ${name} exceeds 25 words: ${wordCount}`);
    });
  });

  // browser_ping tests (TC015 - TC018)
  describe("browser_ping schema", () => {
    const ping = TOOLS.find((t) => t.name === "browser_ping");
    it("TC015: accepts empty object", () => {
      assert.doesNotThrow(() => ping.input.parse({}));
    });
    it("TC016: ignores unexpected fields cleanly", () => {
      const parsed = ping.input.parse({ extra: 123 });
      assert.ok(parsed);
    });
    it("TC017: ping has readOnlyHint annotation", () => {
      assert.equal(ping.annotations?.readOnlyHint, true);
    });
    it("TC018: ping does not have destructiveHint", () => {
      assert.notEqual(ping.annotations?.destructiveHint, true);
    });
  });

  // browser_tabs schema (TC019 - TC024)
  describe("browser_tabs schema", () => {
    const tabs = TOOLS.find((t) => t.name === "browser_tabs");
    it("TC019: accepts action 'list'", () => {
      const res = tabs.input.parse({ action: "list" });
      assert.equal(res.action, "list");
    });
    it("TC020: accepts action 'switch' with tab number", () => {
      const res = tabs.input.parse({ action: "switch", tab: 2 });
      assert.equal(res.tab, 2);
    });
    it("TC021: accepts action 'close' with tab number", () => {
      const res = tabs.input.parse({ action: "close", tab: 1 });
      assert.equal(res.action, "close");
    });
    it("TC022: rejects invalid action 'duplicate'", () => {
      assert.throws(() => tabs.input.parse({ action: "duplicate" }));
    });
    it("TC023: rejects missing action", () => {
      assert.throws(() => tabs.input.parse({ tab: 1 }));
    });
    it("TC024: rejects non-numeric tab", () => {
      assert.throws(() => tabs.input.parse({ action: "switch", tab: "two" }));
    });
  });

  // browser_navigate schema (TC025 - TC030)
  describe("browser_navigate schema", () => {
    const nav = TOOLS.find((t) => t.name === "browser_navigate");
    it("TC025: accepts url string", () => {
      const res = nav.input.parse({ url: "https://example.com" });
      assert.equal(res.url, "https://example.com");
    });
    it("TC026: accepts action 'back'", () => {
      const res = nav.input.parse({ action: "back" });
      assert.equal(res.action, "back");
    });
    it("TC027: accepts action 'forward'", () => {
      const res = nav.input.parse({ action: "forward" });
      assert.equal(res.action, "forward");
    });
    it("TC028: accepts action 'reload'", () => {
      const res = nav.input.parse({ action: "reload" });
      assert.equal(res.action, "reload");
    });
    it("TC029: accepts new_tab flag", () => {
      const res = nav.input.parse({ url: "https://example.com", new_tab: true });
      assert.equal(res.new_tab, true);
    });
    it("TC030: rejects invalid action 'jump'", () => {
      assert.throws(() => nav.input.parse({ action: "jump" }));
    });
  });

  // browser_snapshot schema (TC031 - TC036)
  describe("browser_snapshot schema", () => {
    const snap = TOOLS.find((t) => t.name === "browser_snapshot");
    it("TC031: snapshot defaults mode to 'interactive'", () => {
      const res = snap.input.parse({});
      assert.equal(res.mode, "interactive");
    });
    it("TC032: snapshot defaults max_chars to 3000", () => {
      const res = snap.input.parse({});
      assert.equal(res.max_chars, 3000);
    });
    it("TC033: accepts mode 'text'", () => {
      const res = snap.input.parse({ mode: "text" });
      assert.equal(res.mode, "text");
    });
    it("TC034: accepts within ref", () => {
      const res = snap.input.parse({ within: "2:45" });
      assert.equal(res.within, "2:45");
    });
    it("TC035: rejects invalid mode 'dom'", () => {
      assert.throws(() => snap.input.parse({ mode: "dom" }));
    });
    it("TC036: has readOnlyHint annotation", () => {
      assert.equal(snap.annotations?.readOnlyHint, true);
    });
  });

  // browser_find schema (TC037 - TC041)
  describe("browser_find schema", () => {
    const find = TOOLS.find((t) => t.name === "browser_find");
    it("TC037: accepts query string", () => {
      const res = find.input.parse({ query: "pricing" });
      assert.equal(res.query, "pricing");
      assert.equal(res.kind, "element");
    });
    it("TC038: accepts kind 'text'", () => {
      const res = find.input.parse({ query: "terms", kind: "text" });
      assert.equal(res.kind, "text");
    });
    it("TC039: rejects missing query", () => {
      assert.throws(() => find.input.parse({}));
    });
    it("TC040: rejects invalid kind 'html'", () => {
      assert.throws(() => find.input.parse({ query: "test", kind: "html" }));
    });
    it("TC041: has readOnlyHint annotation", () => {
      assert.equal(find.annotations?.readOnlyHint, true);
    });
  });

  // browser_click schema (TC042 - TC045)
  describe("browser_click schema", () => {
    const click = TOOLS.find((t) => t.name === "browser_click");
    it("TC042: accepts ref", () => {
      const res = click.input.parse({ ref: "2:49" });
      assert.equal(res.ref, "2:49");
    });
    it("TC043: rejects missing ref", () => {
      assert.throws(() => click.input.parse({}));
    });
    it("TC044: rejects non-string ref", () => {
      assert.throws(() => click.input.parse({ ref: 249 }));
    });
    it("TC045: has destructiveHint annotation", () => {
      assert.equal(click.annotations?.destructiveHint, true);
    });
  });

  // browser_type schema (TC046 - TC050)
  describe("browser_type schema", () => {
    const bType = TOOLS.find((t) => t.name === "browser_type");
    it("TC046: accepts ref and text with default clear=true, submit=false", () => {
      const res = bType.input.parse({ ref: "1:10", text: "hello" });
      assert.equal(res.ref, "1:10");
      assert.equal(res.text, "hello");
      assert.equal(res.clear, true);
      assert.equal(res.submit, false);
    });
    it("TC047: accepts custom submit=true and clear=false", () => {
      const res = bType.input.parse({ ref: "1:10", text: "query", submit: true, clear: false });
      assert.equal(res.submit, true);
      assert.equal(res.clear, false);
    });
    it("TC048: rejects missing text", () => {
      assert.throws(() => bType.input.parse({ ref: "1:10" }));
    });
    it("TC049: rejects missing ref", () => {
      assert.throws(() => bType.input.parse({ text: "test" }));
    });
    it("TC050: has destructiveHint annotation", () => {
      assert.equal(bType.annotations?.destructiveHint, true);
    });
  });

  // browser_fill_form schema (TC051 - TC054)
  describe("browser_fill_form schema", () => {
    const fill = TOOLS.find((t) => t.name === "browser_fill_form");
    it("TC051: accepts array of fields", () => {
      const res = fill.input.parse({
        fields: [{ ref: "2:1", value: "John" }, { ref: "2:2", value: "Doe" }],
      });
      assert.equal(res.fields.length, 2);
    });
    it("TC052: accepts optional submit_ref", () => {
      const res = fill.input.parse({
        fields: [{ ref: "2:1", value: "John" }],
        submit_ref: "2:9",
      });
      assert.equal(res.submit_ref, "2:9");
    });
    it("TC053: rejects more than 15 fields", () => {
      const fields = Array.from({ length: 16 }, (_, i) => ({ ref: `2:${i}`, value: `val${i}` }));
      assert.throws(() => fill.input.parse({ fields }));
    });
    it("TC054: has destructiveHint annotation", () => {
      assert.equal(fill.annotations?.destructiveHint, true);
    });
  });

  // browser_select, press_key, scroll, wait_for, extract (TC055 - TC060)
  describe("browser_select, press_key, scroll, wait_for, extract schemas", () => {
    it("TC055: browser_select requires ref and option", () => {
      const sel = TOOLS.find((t) => t.name === "browser_select");
      assert.throws(() => sel.input.parse({ ref: "1:1" }));
      assert.doesNotThrow(() => sel.input.parse({ ref: "1:1", option: "opt1" }));
    });
    it("TC056: browser_press_key requires key", () => {
      const pk = TOOLS.find((t) => t.name === "browser_press_key");
      assert.throws(() => pk.input.parse({}));
      assert.doesNotThrow(() => pk.input.parse({ key: "Enter" }));
    });
    it("TC057: browser_scroll requires direction", () => {
      const sc = TOOLS.find((t) => t.name === "browser_scroll");
      assert.throws(() => sc.input.parse({}));
      assert.doesNotThrow(() => sc.input.parse({ direction: "down" }));
    });
    it("TC058: browser_wait_for accepts condition and timeout_ms", () => {
      const wf = TOOLS.find((t) => t.name === "browser_wait_for");
      const res = wf.input.parse({ text: "Done", timeout_ms: 3000 });
      assert.equal(res.timeout_ms, 3000);
    });
    it("TC059: browser_extract requires what in links|table|fields", () => {
      const ext = TOOLS.find((t) => t.name === "browser_extract");
      assert.throws(() => ext.input.parse({ what: "images" }));
      assert.doesNotThrow(() => ext.input.parse({ what: "table" }));
    });
    it("TC060: browser_extract defaults max to 25", () => {
      const ext = TOOLS.find((t) => t.name === "browser_extract");
      const res = ext.input.parse({ what: "links" });
      assert.equal(res.max, 25);
    });
  });
});
