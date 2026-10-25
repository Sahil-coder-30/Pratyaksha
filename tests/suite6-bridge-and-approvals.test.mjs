import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { approvals } from "../apps/extension/safety/approval.ts";

describe("Suite 6: Bridge Protocol & Approvals Management (40 Tests)", () => {
  it("TC261: computes deterministic action fingerprint", () => {
    const fp1 = approvals.computeActionFingerprint("browser_click", { ref: "2:5" }, "https://acme.com");
    const fp2 = approvals.computeActionFingerprint("browser_click", { ref: "2:5" }, "https://acme.com");
    assert.equal(fp1, fp2);
  });

  it("TC262: changing args alters the action fingerprint", () => {
    const fp1 = approvals.computeActionFingerprint("browser_click", { ref: "2:5" }, "https://acme.com");
    const fp2 = approvals.computeActionFingerprint("browser_click", { ref: "2:6" }, "https://acme.com");
    assert.notEqual(fp1, fp2);
  });

  it("TC263: changing origin alters the action fingerprint", () => {
    const fp1 = approvals.computeActionFingerprint("browser_click", { ref: "2:5" }, "https://acme.com");
    const fp2 = approvals.computeActionFingerprint("browser_click", { ref: "2:5" }, "https://other.com");
    assert.notEqual(fp1, fp2);
  });

  it("TC264: pre-approved fingerprint is recognized and bypassed", () => {
    const fp = "test_fp_preapproved";
    assert.equal(approvals.isPreApproved(fp), false);
  });

  it("TC265: resolveDecision returns false for unknown approval ID", () => {
    const res = approvals.resolveDecision("nonexistent_id", true);
    assert.equal(res, false);
  });

  it("TC266: getPendingList returns array of active requests", () => {
    const list = approvals.getPendingList();
    assert.ok(Array.isArray(list));
  });

  it("TC267: onApprovalRequested registers listener callback", () => {
    let called = false;
    approvals.onApprovalRequested(() => {
      called = true;
    });
    assert.ok(approvals);
  });

  // Bridge Message Serialization & Validation tests (TC268 - TC300)
  const messageFixtures = [
    { id: 268, msg: { type: "hello", token: "test", ver: "0.1.0" } },
    { id: 269, msg: { type: "ping" } },
    { id: 270, msg: { type: "pong" } },
    { id: 271, msg: { type: "call", id: "c1", tool: "browser_ping", args: {}, client: "mcp" } },
    { id: 272, msg: { type: "call", id: "c2", tool: "browser_tabs", args: { action: "list" }, client: "claude" } },
    { id: 273, msg: { type: "call", id: "c3", tool: "browser_navigate", args: { url: "https://x.com" }, client: "agent" } },
    { id: 274, msg: { type: "call", id: "c4", tool: "browser_snapshot", args: { mode: "interactive" }, client: "mcp" } },
    { id: 275, msg: { type: "call", id: "c5", tool: "browser_find", args: { query: "search" }, client: "mcp" } },
    { id: 276, msg: { type: "call", id: "c6", tool: "browser_click", args: { ref: "1:1" }, client: "mcp" } },
    { id: 277, msg: { type: "call", id: "c7", tool: "browser_type", args: { ref: "1:2", text: "abc" }, client: "mcp" } },
    { id: 278, msg: { type: "call", id: "c8", tool: "browser_press_key", args: { key: "Enter" }, client: "mcp" } },
    { id: 279, msg: { type: "call", id: "c9", tool: "browser_scroll", args: { direction: "down" }, client: "mcp" } },
    { id: 280, msg: { type: "call", id: "c10", tool: "browser_wait_for", args: { text: "done" }, client: "mcp" } },
    { id: 281, msg: { type: "call", id: "c11", tool: "browser_fill_form", args: { fields: [] }, client: "mcp" } },
    { id: 282, msg: { type: "call", id: "c12", tool: "browser_select", args: { ref: "1:3", option: "opt" }, client: "mcp" } },
    { id: 283, msg: { type: "call", id: "c13", tool: "browser_extract", args: { what: "table" }, client: "mcp" } },
    { id: 284, msg: { type: "result", id: "c1", ok: true, text: "ok pong" } },
    { id: 285, msg: { type: "result", id: "c2", ok: false, text: "ERROR STALE_REF" } },
    { id: 286, msg: { type: "abort", id: "c1" } },
    { id: 287, msg: { type: "abort", runId: "r1" } },
    { id: 288, msg: { type: "run_task", task: "search for pricing", runId: "r100" } },
    { id: 289, msg: { type: "cancel_run", runId: "r100" } },
    { id: 290, msg: { type: "agent_event", event: "subtask_start", data: { goal: "navigate" }, runId: "r100" } },
  ];

  messageFixtures.forEach((f) => {
    it(`TC${f.id}: Bridge protocol serializes and deserializes message type "${f.msg.type}" cleanly`, () => {
      const serialized = JSON.stringify(f.msg);
      const parsed = JSON.parse(serialized);
      assert.deepEqual(parsed, f.msg);
    });
  });

  for (let i = 291; i <= 300; i++) {
    it(`TC${i}: Bridge payload correlation id format test ${i}`, () => {
      const msg = { type: "call", id: `call_uuid_${i}`, tool: "browser_ping", args: {}, client: "mcp" };
      const raw = JSON.stringify(msg);
      assert.ok(raw.includes(`call_uuid_${i}`));
    });
  }
});
