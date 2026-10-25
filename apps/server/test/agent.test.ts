// Agent pipeline checks with a fake extension and scripted models (no LLM):
// the run loop and its SSE events, verify retries, cancel, 409, limits, and the
// tool call rules when the extension disconnects.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { AgentErrorCode, ErrorCode, type AgentEvent } from "@bigfish/contracts";
import { startServer } from "../src/server.js";
import type { AgentModels, PlanOutput, Verdict } from "../src/agent/models.js";
import { callBrowserTool, type ToolCallContext } from "../src/agent/tool-policy.js";
import { TUNING, USER, auth, jwtFor, testBed, waitFor } from "./helpers.js";

const MAX_TOOL_CALLS = 6;

let srv: Awaited<ReturnType<typeof startServer>>;
const { httpUrl, fake, session } = testBed(() => srv);

// ---- scripted models -------------------------------------------------------

type ActScript = (messages: BaseMessage[], turn: number) => AIMessage;

interface Script {
  act: ActScript;
  plan?: PlanOutput;
  judge?: (input: string) => Verdict;
}

const seen = { judge: [] as string[], finalize: [] as string[], act: [] as BaseMessage[][] };
let script: Script;

// The server keeps this object; each test swaps `script`.
const models: AgentModels = {
  plan: async () => script.plan ?? { subtasks: [{ goal: "do the thing", criteria: "the thing is done" }] },
  act: () => {
    let turn = 0;
    return {
      invoke: async (messages) => {
        seen.act.push(messages);
        return script.act(messages, turn++);
      },
    };
  },
  judge: async (input) => {
    seen.judge.push(input);
    return script.judge?.(input) ?? { passed: true, reason: "looks done" };
  },
  finalize: async (input) => {
    seen.finalize.push(input);
    return `final answer`;
  },
};

let callSeq = 0;
function callTool(name: string, args: Record<string, unknown> = {}) {
  return new AIMessage({ content: "", tool_calls: [{ id: `c${++callSeq}`, name, args, type: "tool_call" }] });
}
function callTools(...calls: Array<[string, Record<string, unknown>]>) {
  return new AIMessage({
    content: "",
    tool_calls: calls.map(([name, args]) => ({ id: `c${++callSeq}`, name, args, type: "tool_call" as const })),
  });
}
const complete = () => callTool("complete_subtask", { summary: "done", evidence: "seen on page" });

function lastToolText(messages: BaseMessage[]): string {
  const tool = [...messages].reverse().find((m) => ToolMessage.isInstance(m));
  return tool ? String(tool.content) : "";
}

// ---- HTTP + SSE helpers ----------------------------------------------------

async function post(path: string, body: unknown, userId: string | null = USER) {
  return fetch(`${httpUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(userId ? { authorization: `Bearer ${await jwtFor(userId)}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Reads the SSE stream to the end. onEvent may act mid-run (e.g. cancel).
async function readEvents(res: Response, onEvent?: (e: AgentEvent) => void | Promise<void>): Promise<AgentEvent[]> {
  assert.equal(res.status, 200);
  const events: AgentEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      const event = JSON.parse(data) as AgentEvent;
      events.push(event);
      await onEvent?.(event);
    }
  }
  return events;
}

const invoke = (deviceId: string, prompt = "do the thing", userId: string | null = USER) =>
  post("/api/agent/invoke", { deviceId, prompt }, userId);

const typesOf = (events: AgentEvent[]) => events.map((e) => e.type);

// Closes a fake extension and waits until the server dropped it (max 3 devices per user).
async function closeExt(ext: { deviceId: string; close(): void } | undefined) {
  if (!ext) return;
  ext.close();
  await waitFor(() => (srv.registry.get(USER, ext.deviceId) ? undefined : true));
}

// ---- setup -------------------------------------------------------------------

before(async () => {
  srv = await startServer({
    port: 0,
    host: "127.0.0.1",
    socket: TUNING,
    auth,
    agent: { models, graceMs: 1_000, limits: { maxToolCalls: MAX_TOOL_CALLS } },
  });
});

after(async () => {
  await srv.close();
});

beforeEach(() => {
  seen.judge = [];
  seen.finalize = [];
  seen.act = [];
});

const pageHandlers = {
  browser_tabs: () => "ok 1 tabs\n*1 Test page | https://example.com",
  browser_snapshot: () => "[tab 1] Test page | example.com\nHello from the page",
};

// ---- tests ---------------------------------------------------------------------

describe("agent run", () => {
  test("plan -> act -> verify -> finalize, streamed as SSE events", async () => {
    script = {
      act: (messages, turn) => {
        if (turn === 0) return callTool("browser_ping");
        assert.match(lastToolText(messages), /<page untrusted>\nok pong/);
        return callTools(["save_fact", { key: "ping", value: "pong" }], ["complete_subtask", { summary: "pinged", evidence: "pong" }]);
      },
    };
    const ext = await fake({ handlers: pageHandlers });
    await session(ext.deviceId);

    const events = await readEvents(await invoke(ext.deviceId));
    const types = typesOf(events);
    assert.equal(types[0], "run");
    assert.equal(types.at(-1), "final");
    for (const t of ["plan", "step", "tool_call", "tool_result"]) assert.ok(types.includes(t as AgentEvent["type"]), t);

    const result = events.find((e) => e.type === "tool_result");
    assert.ok(result?.type === "tool_result" && result.ok && result.text.includes("pong"));
    assert.ok(events.some((e) => e.type === "step" && e.node === "verify" && e.message.startsWith("Passed")));
    assert.match(seen.judge[0]!, /Hello from the page/, "the judge reads the live page");
    assert.match(seen.finalize[0]!, /- ping: pong/, "saved facts reach the final answer");
    assert.equal(srv.runs.size, 0);
    await closeExt(ext);
  });

  test("a rejected subtask is retried once with the judge's feedback", async () => {
    script = { act: () => complete(), judge: () => ({ passed: false, reason: "the button is still there" }) };
    const ext = await fake({ handlers: pageHandlers });
    await session(ext.deviceId);

    const events = await readEvents(await invoke(ext.deviceId));
    const acts = events.filter((e) => e.type === "step" && e.node === "act");
    assert.equal(acts.length, 2, "first try + one retry");
    const retryBrief = seen.act.at(-1)!.map((m) => String(m.content)).join("\n");
    assert.match(retryBrief, /Previous attempt was not accepted: the button is still there/);
    assert.match(seen.finalize[0]!, /\[failed\]/);
    assert.equal(typesOf(events).at(-1), "final");
    await closeExt(ext);
  });

  test("a task that asks for dummy data tells the actor and the judge to make values up", async () => {
    script = { act: () => complete() };
    const ext = await fake({ handlers: pageHandlers });
    await session(ext.deviceId);

    await readEvents(await invoke(ext.deviceId, "fill this form with dummy details"));
    const brief = seen.act[0]!.map((m) => String(m.content)).join("\n");
    assert.match(brief, /The user asked for made-up values/);
    assert.match(seen.judge[0]!, /The user asked for made-up values/);

    seen.act = [];
    seen.judge = [];
    await readEvents(await invoke(ext.deviceId, "fill this form"));
    assert.doesNotMatch(seen.act[0]!.map((m) => String(m.content)).join("\n"), /The user asked for made-up values/);
    assert.doesNotMatch(seen.judge[0]!, /The user asked for made-up values/);
    await closeExt(ext);
  });

  test("cancel stops the run and the call running in the browser", async () => {
    let aborted = false;
    script = { act: () => callTool("browser_wait_for", { text: "never" }) };
    const ext = await fake({
      handlers: {
        ...pageHandlers,
        browser_wait_for: (_args, extra) =>
          new Promise((resolve) => extra.signal.addEventListener("abort", () => ((aborted = true), resolve("cancelled")))),
      },
    });
    await session(ext.deviceId);

    let runId = "";
    const events = await readEvents(await invoke(ext.deviceId), async (e) => {
      if (e.type === "run") runId = e.runId;
      if (e.type === "tool_call") {
        const other = await post("/api/agent/cancel", { runId }, "google:someone-else");
        assert.equal(other.status, 404, "another user cannot cancel it");
        assert.equal((await post("/api/agent/cancel", { runId })).status, 200);
      }
    });
    const last = events.at(-1)!;
    assert.ok(last.type === "error" && last.code === AgentErrorCode.CANCELLED);
    await waitFor(() => (aborted ? true : undefined));
    assert.equal(srv.runs.size, 0);
    await closeExt(ext);
  });

  test("a second run on the same device gets 409 RUN_IN_PROGRESS", async () => {
    script = { act: () => callTool("browser_wait_for", { text: "never" }) };
    const ext = await fake({
      handlers: { ...pageHandlers, browser_wait_for: (_a, extra) => new Promise((r) => extra.signal.addEventListener("abort", () => r("x"))) },
    });
    await session(ext.deviceId);

    let runId = "";
    await readEvents(await invoke(ext.deviceId), async (e) => {
      if (e.type === "run") runId = e.runId;
      if (e.type === "tool_call") {
        const second = await invoke(ext.deviceId);
        assert.equal(second.status, 409);
        assert.equal((await second.json()).code, "RUN_IN_PROGRESS");
        await post("/api/agent/cancel", { runId });
      }
    });
    await closeExt(ext);
  });

  test("invoke checks the JWT, the input and that the device is the user's", async () => {
    const ext = await fake({ handlers: pageHandlers });
    await session(ext.deviceId);
    assert.equal((await invoke(ext.deviceId, "hi", null)).status, 401);
    assert.equal((await invoke(ext.deviceId, "   ")).status, 400);
    assert.equal((await invoke(ext.deviceId, "hi", "google:someone-else")).status, 404);
    assert.equal((await post("/api/agent/cancel", { runId: "nope" })).status, 404);
    await closeExt(ext);
  });

  test(`the run stops after ${MAX_TOOL_CALLS} browser tool calls`, async () => {
    script = { act: (_m, turn) => callTool("browser_snapshot", { offset: turn }) };
    const ext = await fake({ handlers: pageHandlers });
    await session(ext.deviceId);

    const events = await readEvents(await invoke(ext.deviceId));
    assert.equal(events.filter((e) => e.type === "tool_call").length, MAX_TOOL_CALLS);
    const last = events.at(-1)!;
    assert.ok(last.type === "error" && last.code === AgentErrorCode.TOOL_LIMIT);
    await closeExt(ext);
  });

  test("the same call 3 times in a row is refused by the loop guard", async () => {
    let pings = 0;
    script = {
      act: (messages, turn) => {
        if (turn < 3) return callTool("browser_ping");
        assert.match(lastToolText(messages), /^ERROR LOOP/);
        return complete();
      },
    };
    const ext = await fake({ handlers: { ...pageHandlers, browser_ping: () => `ok pong ${++pings}` } });
    await session(ext.deviceId);

    await readEvents(await invoke(ext.deviceId));
    assert.equal(pings, 2, "the third call never reached the browser");
    await closeExt(ext);
  });

  test("a call that failed twice is refused, even with other calls in between", async () => {
    let snapshots = 0;
    script = {
      act: (messages, turn) => {
        if (turn >= 5) {
          assert.match(lastToolText(messages), /^ERROR LOOP: browser_snapshot already failed 2 times/);
          return complete();
        }
        return turn % 2 === 0 ? callTool("browser_snapshot") : callTool("browser_navigate", { action: "reload" });
      },
    };
    const ext = await fake({
      handlers: {
        ...pageHandlers,
        browser_snapshot: () => (snapshots++, { text: "ERROR PAGE_UNRESPONSIVE: not ready", isError: true }),
        browser_navigate: () => "ok reload completed",
      },
    });
    await session(ext.deviceId);

    await readEvents(await invoke(ext.deviceId));
    // Two failed snapshots in the act loop; the third is refused. The verify step's snapshot is separate.
    assert.equal(snapshots - 1, 2);
    await closeExt(ext);
  });

  test("an empty model reply is not sent back to the model", async () => {
    script = {
      act: (messages, turn) => {
        if (turn === 0) return new AIMessage({ content: "" });
        const empty = messages.some((m) => AIMessage.isInstance(m) && !m.tool_calls?.length && !String(m.content).trim());
        assert.equal(empty, false, "no empty assistant turn in the history");
        return complete();
      },
    };
    const ext = await fake({ handlers: pageHandlers });
    await session(ext.deviceId);

    const events = await readEvents(await invoke(ext.deviceId));
    assert.equal(typesOf(events).at(-1), "final");
    await closeExt(ext);
  });

  test("only one browser action runs per model turn", async () => {
    const clicked: string[] = [];
    script = {
      act: (messages, turn) => {
        if (turn === 0) return callTools(["browser_click", { ref: "1:1" }], ["browser_click", { ref: "1:2" }]);
        assert.match(lastToolText(messages), /^SKIPPED: one browser action per turn/);
        return complete();
      },
    };
    const ext = await fake({ handlers: { ...pageHandlers, browser_click: (args) => (clicked.push(String(args.ref)), "ok clicked") } });
    await session(ext.deviceId);

    await readEvents(await invoke(ext.deviceId));
    assert.deepEqual(clicked, ["1:1"]);
    await closeExt(ext);
  });

  test("a masked screenshot reaches the model as an image after the tool answers, and only the newest is kept", async () => {
    const images = (messages: BaseMessage[]) =>
      messages.flatMap((m) =>
        HumanMessage.isInstance(m) && Array.isArray(m.content)
          ? m.content.filter((b) => b.type === "image_url").map((b) => (b as unknown as { image_url: { url: string } }).image_url.url)
          : [],
      );
    let shot = 0;
    script = {
      act: (messages, turn) => {
        if (turn < 2) return callTool("browser_screenshot");
        const urls = images(messages);
        assert.deepEqual(urls, ["data:image/jpeg;base64,U0hPVDI="], "only the newest screenshot is sent");
        const last = messages.at(-1)!;
        assert.ok(HumanMessage.isInstance(last), "the image follows the tool answer");
        assert.ok(ToolMessage.isInstance(messages.at(-2)!));
        assert.match(String(messages.at(-2)!.content), /masked: \[NAME_1A2B\]/);
        assert.ok(messages.some((m) => HumanMessage.isInstance(m) && m.content === "[old screenshot cleared]"));
        return complete();
      },
    };
    const ext = await fake({
      handlers: {
        ...pageHandlers,
        browser_screenshot: () => ({
          text: "ok screenshot [tab 1] 1280x720 | masked: [NAME_1A2B]",
          image: { data: Buffer.from(`SHOT${++shot}`).toString("base64"), mimeType: "image/jpeg" },
        }),
      },
    });
    await session(ext.deviceId);

    const events = await readEvents(await invoke(ext.deviceId));
    assert.equal(typesOf(events).at(-1), "final");
    const result = events.find((e) => e.type === "tool_result" && e.name === "browser_screenshot");
    assert.ok(result && result.type === "tool_result" && !result.text.includes("U0hPV"), "no image data in events");
    await closeExt(ext);
  });

  test("ML_UNAVAILABLE from the extension reaches the model as an error, with no image", async () => {
    script = {
      act: (messages, turn) => {
        if (turn === 0) return callTool("browser_screenshot");
        assert.match(lastToolText(messages), /^ERROR ML_UNAVAILABLE/);
        assert.ok(!messages.some((m) => HumanMessage.isInstance(m) && Array.isArray(m.content)));
        return complete();
      },
    };
    const ext = await fake({
      handlers: {
        ...pageHandlers,
        browser_screenshot: () => ({ text: "ERROR ML_UNAVAILABLE: The local ML privacy service is not running.", isError: true }),
      },
    });
    await session(ext.deviceId);

    await readEvents(await invoke(ext.deviceId));
    await closeExt(ext);
  });

  test("bad arguments from the model never reach the browser", async () => {
    let clicks = 0;
    script = {
      act: (messages, turn) => {
        if (turn === 0) return callTool("browser_click", { reff: "1:1" });
        assert.match(lastToolText(messages), /^ERROR INVALID_ARGS: ref/);
        return complete();
      },
    };
    const ext = await fake({ handlers: { ...pageHandlers, browser_click: () => (clicks++, "ok") } });
    await session(ext.deviceId);

    await readEvents(await invoke(ext.deviceId));
    assert.equal(clicks, 0);
    await closeExt(ext);
  });

  test("filler args from the model (null, empty, false, an action next to a url) are dropped", async () => {
    let navigated: Record<string, unknown> | undefined;
    let typed: Record<string, unknown> | undefined;
    script = {
      act: (_messages, turn) => {
        if (turn === 0) return callTool("browser_navigate", { url: "https://example.com", action: "forward", tab: null, new_tab: false });
        if (turn === 1) return callTool("browser_type", { ref: "1:2", text: "hi", clear: false, submit: false });
        return complete();
      },
    };
    const ext = await fake({
      handlers: {
        ...pageHandlers,
        browser_navigate: (args) => ((navigated = args), "ok navigated"),
        browser_type: (args) => ((typed = args), "ok type"),
      },
    });
    await session(ext.deviceId);

    await readEvents(await invoke(ext.deviceId));
    assert.deepEqual(navigated, { url: "https://example.com" });
    // clear defaults to true, so an explicit false is kept.
    assert.equal(typed?.clear, false);
    await closeExt(ext);
  });
});

describe("tool calls when the extension disconnects", () => {
  const ctxFor = (deviceId: string, graceMs = 1_000): ToolCallContext => ({
    registry: srv.registry,
    userId: USER,
    deviceId,
    runId: "run-test",
    signal: new AbortController().signal,
    graceMs,
  });

  test("a mutating tool cut off mid-call is never retried (STATE_UNKNOWN)", async () => {
    let clicks = 0;
    const ext = await fake({
      deviceId: "drop-click-1",
      handlers: {
        browser_click: () => {
          clicks++;
          ext.close();
          return new Promise(() => {});
        },
      },
    });
    await session(ext.deviceId);
    const reconnect = fake({ deviceId: "drop-click-1", handlers: { browser_click: () => (clicks++, "ok") } });

    const result = await callBrowserTool(ctxFor("drop-click-1"), "browser_click", { ref: "1:1" }, "t1");
    assert.equal(result.ok, false);
    assert.match(result.text, new RegExp(`^ERROR ${ErrorCode.STATE_UNKNOWN}`));
    assert.equal(clicks, 1, "the click ran once, even though the device came back");
    await closeExt(await reconnect);
  });

  test("a read-only tool cut off mid-call retries once after the device reconnects", async () => {
    const first = await fake({
      deviceId: "drop-snap-1",
      handlers: {
        browser_snapshot: () => {
          first.close();
          void fake({ deviceId: "drop-snap-1", handlers: { browser_snapshot: () => "ok fresh snapshot" } }).then((e) => (second = e));
          return new Promise(() => {});
        },
      },
    });
    let second: Awaited<ReturnType<typeof fake>> | undefined;
    await session(first.deviceId);

    const result = await callBrowserTool(ctxFor("drop-snap-1"), "browser_snapshot", {}, "t2");
    assert.equal(result.ok, true);
    assert.match(result.text, /ok fresh snapshot/);
    await waitFor(() => second);
    await closeExt(second);
  });

  test("a call waits for a device that is reconnecting, up to the grace window", async () => {
    const late = new Promise<Awaited<ReturnType<typeof fake>>>((resolve) => setTimeout(() => resolve(fake({ deviceId: "late-device-1" })), 100));
    const result = await callBrowserTool(ctxFor("late-device-1"), "browser_ping", {}, "t3");
    assert.match(result.text, /pong/);
    await closeExt(await late);

    const gone = await callBrowserTool(ctxFor("never-device-1", 200), "browser_ping", {}, "t4");
    assert.match(gone.text, new RegExp(`^ERROR ${ErrorCode.NOT_CONNECTED}`));
  });
});
