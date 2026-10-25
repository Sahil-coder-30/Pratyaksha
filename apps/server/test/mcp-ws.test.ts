// Checks for the /mcp-ws pipe (extension = MCP server, server = MCP client)
// and for login: Google token -> JWT -> one-time ticket -> socket.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { CloseCode, ErrorCode, TOOLS, WIRE_VERSION, encodeCtl } from "@bigfish/contracts";
import { FramedTransport, SocketOpenError, openMcpSocket } from "@bigfish/mcp-ws";
import { startServer } from "../src/server.js";
import { issueUserJwt } from "../src/auth/jwt.js";
import { SessionError } from "../src/mcp/session.js";
import { MAX_DEVICES_PER_USER } from "../src/mcp/registry.js";
import { DEV_USER_ID } from "../src/routes/dev.routes.js";
import { withOrigin } from "../scripts/fake-extension.js";
import { OriginWebSocket, TUNING, USER, auth, jwtFor, testBed, textOf, waitFor } from "./helpers.js";

let srv: Awaited<ReturnType<typeof startServer>>;
let httpUrl: string;
const { urlFor, fake, session } = testBed(() => srv);

before(async () => {
  srv = await startServer({ port: 0, host: "127.0.0.1", devRoutes: true, socket: TUNING, auth });
  httpUrl = `http://127.0.0.1:${srv.port}`;
});

after(async () => {
  await srv.close();
});

// A raw socket for protocol-level tests. Resolves with the close code.
async function rawSocket(onOpen: (ws: WebSocket) => void): Promise<number> {
  const url = await urlFor();
  return new Promise((resolve) => {
    const ws = new OriginWebSocket(url);
    ws.addEventListener("open", () => onOpen(ws));
    ws.addEventListener("close", (e) => resolve(e.code));
  });
}

describe("FramedTransport (in memory)", () => {
  test("McpServer and Client talk over two linked transports", async () => {
    const pair: { a?: FramedTransport; b?: FramedTransport } = {};
    const sink = (to: () => FramedTransport | undefined) => ({
      send: (text: string) => queueMicrotask(() => to()?.deliver(JSON.parse(text).m)),
      close: () => to()?.socketClosed(),
    });
    pair.a = new FramedTransport(sink(() => pair.b), "a");
    pair.b = new FramedTransport(sink(() => pair.a), "b");

    const server = new McpServer({ name: "mem", version: "0" });
    server.registerTool("echo", { description: "echo", inputSchema: z.object({ msg: z.string() }) }, async ({ msg }) => ({
      content: [{ type: "text", text: `echo ${msg}` }],
    }));
    await server.connect(pair.a);
    const client = new Client({ name: "mem-client", version: "0" });
    await client.connect(pair.b);

    const res = await client.callTool({ name: "echo", arguments: { msg: "hi" } });
    assert.equal(textOf(res), "echo hi");
    await client.close();
  });
});

describe("/mcp-ws", () => {
  test("browser_ping round trip through the registry", async () => {
    // The dev user, so the dev ping route can reach it.
    const ext = await fake({ userId: DEV_USER_ID });
    const s = await session(ext.deviceId, DEV_USER_ID);
    assert.deepEqual(
      s.tools.map((t) => t.name),
      TOOLS.map((t) => t.name),
    );

    const res = await s.callTool("browser_ping");
    assert.match(textOf(res), /pong/);

    const health = await (await fetch(`${httpUrl}/health`)).json();
    assert.ok(health.devices >= 1);
    const ping = await (await fetch(`${httpUrl}/api/dev/devices/${ext.deviceId}/ping`)).json();
    assert.equal(ping.ok, true);

    ext.close();
    await waitFor(() => (srv.registry.get(DEV_USER_ID, ext.deviceId) ? undefined : true));
  });

  test("tools outside the contract allowlist never reach the server side", async () => {
    const ext = await fake({
      extraTools: [{ name: "evil_tool", description: "not in contracts", input: z.object({}) }],
    });
    const s = await session(ext.deviceId);
    assert.equal(s.hasTool("evil_tool"), false);
    await assert.rejects(s.callTool("evil_tool"), (err: unknown) => {
      return err instanceof SessionError && err.code === ErrorCode.UNKNOWN_TOOL;
    });
    ext.close();
  });

  test("a second connection for the same device replaces the first with 4003", async () => {
    const first = await fake({ deviceId: "device-replace-1" });
    const firstSession = await session(first.deviceId);
    const second = await fake({ deviceId: "device-replace-1" });

    const closed = await first.socket.closed;
    assert.equal(closed.code, CloseCode.REPLACED);
    const current = await waitFor(() => {
      const s = srv.registry.get(USER, "device-replace-1");
      return s && s !== firstSession ? s : undefined;
    });
    assert.equal(current.info.connId, second.socket.connId);
    second.close();
  });

  test("unsupported contracts version is refused with 4426", async () => {
    await assert.rejects(
      openMcpSocket({
        url: await urlFor(),
        deviceId: "device-old-1",
        ext: "0.0.1",
        contracts: 99,
        WebSocketImpl: OriginWebSocket,
      }),
      (err: unknown) => err instanceof SocketOpenError && err.code === CloseCode.UPGRADE_REQUIRED,
    );
  });

  test("an invalid frame closes the socket with 4002", async () => {
    const code = await rawSocket((ws) => ws.send("not json"));
    assert.equal(code, CloseCode.BAD_FRAME);
  });

  test("an MCP frame before hello closes the socket with 4002", async () => {
    const code = await rawSocket((ws) => ws.send(JSON.stringify({ v: WIRE_VERSION, k: "mcp", m: { jsonrpc: "2.0" } })));
    assert.equal(code, CloseCode.BAD_FRAME);
  });

  test("no hello in time closes the socket with 4004", async () => {
    const code = await rawSocket(() => {});
    assert.equal(code, CloseCode.HELLO_TIMEOUT);
  });

  test("a peer that stops sending heartbeats is dropped", async () => {
    const started = Date.now();
    const code = await rawSocket((ws) =>
      ws.send(encodeCtl({ t: "hello", deviceId: "device-silent-1", ext: "0", contracts: 1 })),
    );
    // The server terminates the TCP socket, so the client sees an abnormal close.
    assert.equal(code, 1006);
    assert.ok(Date.now() - started >= TUNING.heartbeatDeadlineMs);
  });

  test("tool calls on one device run one at a time, in order", async () => {
    const events: string[] = [];
    let calls = 0;
    const ext = await fake({
      handlers: {
        browser_ping: async () => {
          const id = ++calls === 1 ? "a" : "b";
          events.push(`start ${id}`);
          await new Promise((r) => setTimeout(r, 50));
          events.push(`end ${id}`);
          return `ok ${id}`;
        },
      },
    });
    const s = await session(ext.deviceId);
    await Promise.all([s.callTool("browser_ping"), s.callTool("browser_ping")]);
    assert.deepEqual(events, ["start a", "end a", "start b", "end b"]);
    ext.close();
  });

  test("aborting a call cancels it on the extension side", async () => {
    let aborted = false;
    const ext = await fake({
      handlers: {
        browser_ping: (_args, extra) =>
          new Promise((resolve) => {
            extra.signal.addEventListener("abort", () => {
              aborted = true;
              resolve("cancelled");
            });
          }),
      },
    });
    const s = await session(ext.deviceId);
    const controller = new AbortController();
    const call = s.callTool("browser_ping", {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(call);
    await waitFor(() => (aborted ? true : undefined));
    ext.close();
  });

  test("a disconnect mid-call fails the call fast instead of waiting for the timeout", async () => {
    const ext = await fake({ handlers: { browser_ping: () => new Promise(() => {}) } });
    const s = await session(ext.deviceId);
    const started = Date.now();
    const call = s.callTool("browser_ping", {}, { timeoutMs: 30_000 });
    setTimeout(() => ext.close(), 50);
    await assert.rejects(call);
    assert.ok(Date.now() - started < 2_000);
    assert.equal(s.state, "closed");
  });
});

describe("login and tickets", () => {
  const post = (path: string, init: { body?: unknown; jwt?: string } = {}) =>
    fetch(`${httpUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(init.jwt ? { authorization: `Bearer ${init.jwt}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  // Opens /mcp-ws and reports whether the upgrade succeeded.
  function tryOpen(url: string, WS: typeof WebSocket = OriginWebSocket): Promise<boolean> {
    return new Promise((resolve) => {
      const ws = new WS(url);
      ws.addEventListener("open", () => {
        ws.close();
        resolve(true);
      });
      ws.addEventListener("error", () => resolve(false));
    });
  }

  test("a valid Google token becomes a BigFish JWT for google:<sub>", async () => {
    const res = await post("/api/auth/google", { body: { accessToken: "good-alice" } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.email, "alice@example.com");
    assert.ok(body.expiresAt > Date.now());

    const devices = await fetch(`${httpUrl}/api/devices`, { headers: { authorization: `Bearer ${body.token}` } });
    assert.equal(devices.status, 200);
  });

  test("a bad or missing Google token is refused", async () => {
    assert.equal((await post("/api/auth/google", { body: { accessToken: "stolen" } })).status, 401);
    assert.equal((await post("/api/auth/google", { body: {} })).status, 400);
  });

  test("ws-ticket and devices need a valid JWT", async () => {
    assert.equal((await post("/api/ws-ticket")).status, 401);
    assert.equal((await post("/api/ws-ticket", { jwt: "not-a-jwt" })).status, 401);
    const otherSecret = new TextEncoder().encode("another-secret-another-secret-123");
    const forged = (await issueUserJwt(otherSecret, { userId: USER, email: "x@example.com" })).token;
    assert.equal((await post("/api/ws-ticket", { jwt: forged })).status, 401);
    assert.equal((await fetch(`${httpUrl}/api/devices`)).status, 401);
  });

  test("/mcp-ws refuses a missing, reused or unknown ticket", async () => {
    const wsBase = httpUrl.replace(/^http/, "ws");
    assert.equal(await tryOpen(`${wsBase}/mcp-ws`), false);
    assert.equal(await tryOpen(`${wsBase}/mcp-ws?ticket=made-up`), false);

    const url = await urlFor();
    assert.equal(await tryOpen(url), true);
    assert.equal(await tryOpen(url), false, "a ticket works only once");
  });

  test("/mcp-ws refuses a wrong Origin", async () => {
    const url = await urlFor();
    assert.equal(await tryOpen(url, withOrigin("https://evil.example")), false);
    assert.equal(await tryOpen(url), false, "the refused attempt does not leave the ticket usable");
  });

  test("devices are per user: same deviceId, two users, two sessions", async () => {
    const a = await fake({ userId: "google:a", deviceId: "shared-device-1" });
    const b = await fake({ userId: "google:b", deviceId: "shared-device-1" });
    const sa = await session("shared-device-1", "google:a");
    const sb = await session("shared-device-1", "google:b");
    assert.notEqual(sa, sb);
    assert.equal(sa.state, "ready", "user b did not replace user a");

    const res = await fetch(`${httpUrl}/api/devices`, { headers: { authorization: `Bearer ${await jwtFor("google:a")}` } });
    const body = await res.json();
    assert.deepEqual(
      body.devices.map((d: { deviceId: string }) => d.deviceId),
      ["shared-device-1"],
    );

    const ping = (userId: string, deviceId: string) =>
      jwtFor(userId).then((jwt) => post(`/api/devices/${deviceId}/ping`, { jwt }));
    const pong = await ping("google:a", "shared-device-1");
    assert.equal(pong.status, 200);
    assert.match(textOf(await pong.json()), /pong/);
    assert.equal((await ping("google:c", "shared-device-1")).status, 404, "user c cannot reach a or b's device");
    a.close();
    b.close();
  });

  test(`a user gets at most ${MAX_DEVICES_PER_USER} devices (4008), but a known device may reconnect`, async () => {
    const userId = "google:many";
    const exts = [];
    for (let i = 0; i < MAX_DEVICES_PER_USER; i++) {
      const ext = await fake({ userId, deviceId: `many-device-${i}` });
      await session(ext.deviceId, userId);
      exts.push(ext);
    }

    await assert.rejects(
      fake({ userId, deviceId: "many-device-extra" }),
      (err: unknown) => err instanceof SocketOpenError && err.code === CloseCode.TOO_MANY_DEVICES,
    );

    const again = await fake({ userId, deviceId: "many-device-0" });
    assert.equal((await exts[0].socket.closed).code, CloseCode.REPLACED);
    again.close();
    for (const ext of exts.slice(1)) ext.close();
  });
});
