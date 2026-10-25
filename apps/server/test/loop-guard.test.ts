// Loop guard: repeats, repeated failures, and actions that take turns.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LOOP_CYCLE_WINDOW, LoopGuard } from "../src/agent/loop-guard.js";

describe("loop guard", () => {
  test("back and forward taking turns is refused", () => {
    const guard = new LoopGuard();
    const actions = ["back", "back", "forward", "back", "forward", "back"].map((action) => ({ action }));
    const verdicts = actions.map((args) => guard.check("browser_navigate", args));
    assert.equal(verdicts.slice(0, LOOP_CYCLE_WINDOW - 1).every((v) => v === null), true);
    assert.match(verdicts.at(-1) ?? "", /^ERROR LOOP: browser_navigate keeps taking turns/);
  });

  test("paging with scroll and snapshot is not a loop", () => {
    const guard = new LoopGuard();
    for (let i = 0; i < 5; i++) {
      assert.equal(guard.check("browser_scroll", { direction: "down" }), null);
      assert.equal(guard.check("browser_snapshot", {}), null);
    }
  });

  test("filling different fields is not a loop", () => {
    const guard = new LoopGuard();
    for (let i = 0; i < 8; i++) assert.equal(guard.check("browser_type", { ref: `1:${i}`, text: "x" }), null);
  });
});
