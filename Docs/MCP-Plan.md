# BigFish MCP Plan: Chrome extension as MCP server, Node server as MCP client

This is the full execution plan for the MCP integration. Hand it to a new agent session as-is.
Follow `AGENTS.md` for repo rules (read-only git, never read `.env`, ask before deleting files, ask before installs).

---

## 1. Goal

- The **Chrome extension** is the **MCP server**. It owns the browser tools (tabs, navigate, snapshot, click, type, ...).
- The **Node server** (`apps/server`, Hono + LangGraph) is the **MCP client**. The LangGraph agent calls browser tools through MCP.
- The side panel sends a prompt to `POST /api/agent/invoke`. The agent runs on the server and drives the user's browser through MCP.
- One common server, many users, many extensions. Each user's agent must only ever touch that user's own browser.

## 2. Core idea: reverse connection

A Chrome extension **cannot listen on a port**. So the server cannot dial into it.

- The **extension dials out** to the server: `wss://<server>/mcp-ws`.
- Once the socket is open, the roles flip at the MCP level: the extension runs `McpServer`, the server runs `Client`.
- MCP is just JSON-RPC, so we write one custom `Transport` that carries JSON-RPC over the WebSocket. The SDK does not care what is underneath.
- Works for a laptop server and a cloud server, because the extension only needs outbound access.

```
Side panel --POST /api/agent/invoke (SSE)--> Node server (Hono)
                                              |
                                         LangGraph agent
                                              | tools = loadMcpTools(session.client)
                                              v
                                   SessionRegistry["userId:deviceId"] -> DeviceSession (MCP Client)
                                              | FramedTransport (server side)
Background SW <====== WebSocket /mcp-ws (extension dialed out) ======+
   | McpServer + FramedTransport (client side)
   v
chrome.tabs / chrome.scripting / content script (existing executor.ts)
```

## 3. Design decisions (already made, do not re-open)

### 3.1 Layers

| Layer | Job | Code |
|---|---|---|
| L1 Socket | Connect, auth, hello/ready, heartbeat, close codes | `packages/mcp-ws` (client-socket, server-socket, liveness) |
| L2 Transport | Feed JSON-RPC frames to the MCP SDK | `packages/mcp-ws/src/framed-transport.ts` |
| L3 MCP | initialize, tools/list, tools/call, progress, cancel | MCP SDK v2 (`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/client` 2.3.1) |
| L4 Agent | LangGraph, retry policy, serialize, SSE | `apps/server/src/agent`, `apps/server/src/mcp` |

### 3.2 Wire protocol (`packages/contracts/src/wire.ts`)

- Every frame is JSON: `{ v: 1, k: "mcp", m: <JSON-RPC> }` or `{ v: 1, k: "ctl", c: <control> }`.
- Control messages: `hello { deviceId, ext, contracts }`, `ready { connId }`, `hb`.
- Handshake: extension sends `hello`, server checks version (and auth from step 2), server sends `ready`, then the server's MCP `Client` sends `initialize`.
- Messages that arrive before the SDK calls `transport.start()` are buffered (max 64), so nothing is lost between `ready` and `connect()`.
- Both ends send `hb` every 20s. Silent for 45s means dead (browser JS cannot see WS ping frames, so heartbeats are app-level).
- Max frame 4 MB (`ws` `maxPayload` on the server).

### 3.3 Close codes

| Code | Meaning | Extension behaviour |
|---|---|---|
| 1000 | Normal | Stop |
| 1012 | Server restart or deploy | Reconnect with jitter |
| 4001 | Unauthorized / ticket expired | Get a new ticket, reconnect |
| 4002 | Bad frame | Reconnect with backoff |
| 4003 | Replaced by a newer connection for the same device | **Do not reconnect** |
| 4004 | Hello timeout | Reconnect with backoff |
| 4005 | Heartbeat timeout | Reconnect with backoff |
| 4006 | MCP init failed | Reconnect with backoff |
| 4008 | Too many devices for this user | Stop, show in UI |
| 4426 | Extension too old (contracts version) | Stop, show "update extension" |

### 3.4 Sessions and multi-user

- One socket = one `DeviceSession` = one MCP `Client`. A `Client` is a few KB, so one process can hold thousands.
- Registry key is `userId:deviceId`. `userId` always comes from the verified JWT, never from the request body.
- A new connection for the same key replaces the old one (old one is closed with 4003). The registry only deletes an entry if it still points at the closing session.
- Tool calls on one device are **serialized** (per-session promise chain), because they all act on one browser.
- The server only exposes tools in the contracts allowlist (`TOOL_NAMES`). Anything else an extension reports is dropped.
- One agent run per device at a time (`409 RUN_IN_PROGRESS`).

### 3.5 Tool call rules

- `client.callTool({ name, arguments, _meta: { runId, toolCallId } }, { signal, timeout, resetTimeoutOnProgress, maxTotalTimeout, onprogress })`.
- Default timeout 45s. Approval waits send MCP progress so they do not time out. Hard cap 150s.
- Cancel: abort the `signal`. The SDK sends `notifications/cancelled`. On the extension side the handler sees `ctx.mcpReq.signal` (SDK v2 puts the abort signal there, and `_meta` at `ctx.mcpReq._meta`).
- Tool failures are results with `isError: true` and text like `ERROR STALE_REF: ... Hint: ...` (use `toolError()` from contracts). Connection failures throw `SessionError` with a code.
- Disconnect mid-run:
  - Read-only tools (`readOnlyHint: true`): wait up to 15s for the device to reconnect, retry once.
  - Mutating tools (click, type, navigate): **never auto-retry**. Return `ERROR STATE_UNKNOWN: connection lost during <tool>, re-snapshot before acting`.
- Tool results go to the LLM wrapped as page data, with a system prompt rule that page content is data, not instructions.

### 3.6 Auth (step 2): Google login

1. Extension: `chrome.identity.getAuthToken({ interactive: true })` returns a Google access token (Chrome caches and refreshes it).
2. Extension: `POST /api/auth/google { accessToken }`.
3. Server: verify with Google tokeninfo. Check `aud`/`azp == GOOGLE_EXTENSION_CLIENT_ID` and `email_verified`.
4. Server: issue its own JWT (1 hour, HS256 with `JWT_SECRET`, library `jose`), `userId = "google:<sub>"`. No refresh token. On expiry the extension calls `getAuthToken({ interactive: false })` again.
5. Extension keeps the JWT in `chrome.storage.session` (memory only, readable by the SW and side panel).
6. Socket auth: `POST /api/ws-ticket` (Bearer JWT) returns a 30s single-use ticket. Connect to `/mcp-ws?ticket=...`. Browsers cannot set headers on `WebSocket`, and a JWT in a URL leaks into logs. A one-time ticket does not.
7. On upgrade: verify and delete the ticket, and check `Origin == chrome-extension://<EXTENSION_ID>`. Reject before the upgrade (Hono middleware before `upgradeWebSocket` returns 401).

The developer does these by hand (the agent must not):
- Generate the extension key pair. The private `.pem` is a secret file. Only the **public key** goes into `wxt.config.ts` as `manifest.key`, which fixes the extension ID.
- Create a Google OAuth client of type "Chrome Extension" for that ID.
- Fill `.env`. The agent only adds names to `.env.example`: `GOOGLE_EXTENSION_CLIENT_ID`, `JWT_SECRET`, `EXTENSION_ID`.

### 3.7 MV3 service worker survival

- Heartbeat every 20s keeps the SW alive (Chrome 116+ counts WebSocket activity).
- `chrome.alarms` every 30s wakes the SW and calls `ensureConnected()` if not READY.
- `ensureConnected()` is idempotent. It runs on SW start, on `onStartup`/`onInstalled`, on alarm, and when the side panel opens.
- Reconnect backoff: full jitter, `random(0, min(30s, 1s * 2^n))`, reset `n` after 60s stable.
- Every reconnect builds a fresh `McpServer` + transport and a full `initialize`. Never try to resume an old session.

### 3.8 Scaling later (not in the 4 steps)

- Redis presence `presence:{userId}:{deviceId} -> { podId, connId }` with a 60s TTL refreshed on heartbeat.
- An invoke that lands on the wrong pod is forwarded once to the owner pod. The agent always runs on the pod that holds the socket.
- Duplicate connections across pods: the newer pod publishes `kick`, the old pod closes with 4003.
- Graceful drain on SIGTERM: stop accepting, give runs 30s, close sockets in batches with 1012.
- Keep `SessionRegistry` and the ticket store behind interfaces so Redis can plug in without rewrites.

---

## 4. Current state (end of the previous session)

### Done in step 1 (typecheck passes for server, mcp-ws, contracts)

| File | What |
|---|---|
| `packages/contracts/src/wire.ts` | Envelope, control schemas (zod), close codes, versions, timings, `decodeFrame` |
| `packages/contracts/src/errors.ts` | Added `UNKNOWN_TOOL`, `STATE_UNKNOWN` |
| `packages/contracts/src/tools.ts` | Added `TOOL_NAMES` allowlist |
| `packages/contracts/src/index.ts` | Exports `wire.js` |
| `packages/mcp-ws/` (new workspace package) | `framed-transport.ts`, `liveness.ts`, `client-socket.ts` (`openMcpSocket`), `server-socket.ts` (`ServerSocket`, `HandshakeError`) |
| `apps/server/src/mcp/session.ts` | `DeviceSession` (Client, serialize, allowlist, `SessionError`) |
| `apps/server/src/mcp/registry.ts` | `SessionRegistry` |
| `apps/server/src/ws/mcp-ws.ts` | `/mcp-ws` handler on `@hono/node-ws`. Uses `DEV_USER_ID = "dev"` until step 2 |
| `apps/server/src/app/app.ts` | `createApp()`: `/health`, `/mcp-ws`, old `/mcp`, dev routes |
| `apps/server/src/server.ts` | `startServer()` with `close()`, used by `index.ts` and tests |
| `apps/server/src/index.ts` | Entry point with SIGINT/SIGTERM shutdown |
| `apps/server/src/routes/dev.routes.ts` | `GET /api/dev/devices`, `GET /api/dev/devices/:deviceId/ping` (only if `ENABLE_DEV_ROUTES=1`) |
| `apps/server/scripts/fake-extension.ts` | Fake extension (Node) using `openMcpSocket` + `McpServer` |
| `apps/server/test/mcp-ws.test.ts` | 12 tests (`node:test` via `tsx --test`) |
| `apps/server/package.json` | Added `@bigfish/mcp-ws`, `@modelcontextprotocol/client@2.3.1` (exact, same copy `@langchain/mcp-adapters` uses), scripts `test`, `fake-ext` |
| `apps/server/.env.example` | Added `ENABLE_DEV_ROUTES` |

`pnpm install` was already run.

### Open bug: 4 of 12 tests fail

Passing: in-memory round trip, allowlist, replace (4003), old version (4426), bad frame (4002), MCP before hello (4002), hello timeout (4004), heartbeat dead peer.

Failing: `browser_ping round trip`, `serialize`, `abort`, `disconnect mid-call`.

One root cause: in `DeviceSession.open()`, `client.listTools()` returns an **empty list** for the fake extension, so `browser_ping` is filtered out and calls throw `UNKNOWN_TOOL`. The other 3 failures follow from that.

How to debug it:
1. Log the raw `listTools()` result and `client.getServerCapabilities()` in `DeviceSession.open()`. Run only `pnpm exec tsx --test --test-name-pattern="round trip" test/mcp-ws.test.ts` from `apps/server`.
2. Add `listTools()` to the in-memory test in `mcp-ws.test.ts`. If the list is empty there too, the bug is in SDK usage, not the socket.
3. Suspects:
   - The v2 client caches responses (`CacheableRequestOptions`, `InMemoryResponseCacheStore`). Try a no-cache option on `listTools`.
   - Protocol era: client 2.3.1 and server 2.4.0 may negotiate `2026-07-28`, where tool listing may behave differently. Check the negotiated version and the `ProtocolEra` / version-negotiation options on `Client` and `McpServer`.
   - `TOOLS[].input` is a `ZodObject`. Check that `registerTool` in server 2.4.0 accepts a full `ZodObject` as `inputSchema` and does not silently skip the tool. The existing `apps/server/src/mcp.ts` uses the same pattern.
   - Pagination: check `nextCursor` in the result.
4. Remove the debug log once it is fixed.

---

## 5. Execution: 4 steps

After each step, **stop** and report to the developer: files changed, how to test (commands), and what is left or risky. Start the next step only when the developer says `next`.

### Step 1: Foundation (MCP pipe without Chrome). Almost done.

Remaining:
- Fix the empty `listTools` bug (section 4).
- All 12 tests green: `pnpm --filter @bigfish/server test`.
- Typecheck green: `apps/server`, `packages/mcp-ws`, `packages/contracts` (`npx tsc --noEmit -p .` in each).
- Manual check: `ENABLE_DEV_ROUTES=1 pnpm dev:server`, then `pnpm --filter @bigfish/server fake-ext dev-device-1`, then `GET /api/dev/devices/dev-device-1/ping` returns `pong`.

**Done when:** tests green, manual ping works.

### Step 2: Google login + real extension connection

Server:
- `POST /api/auth/google` (tokeninfo verify, issue JWT with `jose`). Install `jose` (ask first).
- Auth middleware `requireUser` (Bearer JWT, sets `userId`).
- `POST /api/ws-ticket` and a `TicketStore` interface (in-memory now, 30s TTL, single-use).
- `/mcp-ws`: middleware before upgrade verifies ticket and Origin, passes `userId` into `mcpWsHandler` (replace `DEV_USER_ID`).
- Max 3 devices per user (4008).
- `/health` keeps only counts. Device details move behind auth (`GET /api/devices` for the current user).
- Remove the old `/mcp` route, `apps/server/src/mcp.ts` and `apps/server/src/bridge.ts`, and `BridgeMessage` in `packages/contracts/src/bridge.ts`. **Ask before deleting files.**

Extension (`apps/extension`):
- Add deps `@modelcontextprotocol/server@2.4.0`, `zod@4.6.7`, `@bigfish/mcp-ws` (ask first). Confirm the SDK bundles in the MV3 SW (`wxt build`). It ships a browser shim.
- `wxt.config.ts`: permissions `identity`, `alarms` (already there), `oauth2 { client_id, scopes: ["openid", "email", "profile"] }`, `key` from env (public key only).
- `entrypoints/background/auth.ts`: getAuthToken, exchange for JWT, store in `chrome.storage.session`, silent refresh.
- `entrypoints/background/conn/connection.ts`: state machine `IDLE -> TICKET -> CONNECTING -> HELLO -> MCP_INIT -> READY`, backoff with jitter, close code rules (3.3), `ensureConnected()`, alarms. One `openMcpSocket` per attempt.
- `entrypoints/background/mcp/server.ts`: build an `McpServer`, register `TOOLS` from contracts, and route each handler to the existing `executor.execute()` in `entrypoints/background/executor.ts`. Pass `ctx.mcpReq.signal` and `ctx.mcpReq._meta.runId`.
- Replace the old `entrypoints/background/bridge.ts` usage in `background/index.ts` (keep the approval and kill-switch messages working: kill switch closes the socket with 1000 and stops reconnects).
- `deviceId`: UUID in `chrome.storage.local`, created once.
- Side panel: "Sign in with Google" button, signed-in email, connection state.

**Done when:** load the unpacked extension, sign in, the device shows up for your user, `browser_ping` works through the server. Killing the SW in `chrome://serviceworker-internals` leads to an automatic reconnect.

### Step 3: Agent pipeline

- `POST /api/agent/invoke { deviceId, prompt, threadId? }` with SSE events `step`, `tool_call`, `progress`, `tool_result`, `final`, `error`. `POST /api/agent/cancel { runId }`. Both behind `requireUser`. `deviceId` must belong to the JWT user, else 404.
- Use the empty files `apps/server/src/routes/agent.routes.ts`, `apps/server/src/controllers/agent.controller.ts` and `apps/server/src/runs.ts` (run registry, AbortController, per-device lock: 409 `RUN_IN_PROGRESS`).
- Tools: `loadMcpTools(...)` from `@langchain/mcp-adapters` 2.0.1 on `session.client` (it supports an existing client). Wrap calls so they go through `DeviceSession.callTool` (serialize, `_meta`, timeouts, signal).
- `apps/server/src/agent/tool-policy.ts`: retry rules from 3.5, 15s grace window (registry state `READY | RECONNECTING | GONE`), result wrapping, `SessionError` turned into LLM-readable text.
- `apps/server/src/agent/graph.ts`: graph from `Docs/Plan.md` (plan, act, verify, finalize), model from `AGENT_MODEL` (default `mistral-medium-latest`) via `@langchain/mistralai` with `MISTRAL_API_KEY`, limits 80 tool calls and 8 minutes per run. Disable parallel tool use or rely on the session serializer.
- Side panel: replace the fake `executeCommand()` in `entrypoints/sidepanel/main.ts` with a real invoke and SSE reader, plus a cancel button.

**Done when:** a prompt from the side panel runs the agent, SSE steps show up, cancel stops the run. Tests: fake extension plus a stubbed model for the run loop, cancel, 409 and the disconnect rules.

### Step 4: Browser tools + safety

- Define the remaining 12 tools in `packages/contracts/src/tools.ts` (names, zod inputs, `readOnlyHint` / `destructiveHint`), per `Docs/Plan.md` and `Docs/Browser-Tools.md`.
- Finish the handlers in `executor.ts` and the content script `entrypoints/content/dom-actions.ts` (snapshot refs like `"2:45"`, actions by ref, `STALE_REF` after navigation).
- Safety files in `apps/extension/safety/`: PII redaction before text leaves the extension, approval flow in the side panel (progress while waiting), URL policy, size caps (snapshot about 6k chars).
- Playwright E2E: Chrome with `--load-extension`, a local fixture page in `apps/server/fixtures/`. Install `@playwright/test` (ask first).

**Done when:** "open example.com and tell me the heading" works end to end, and a risky action shows an approval popup.

---

## 6. Verification checklist (all steps)

- `pnpm -r typecheck`
- `pnpm --filter @bigfish/server test`
- `pnpm --filter @bigfish/extension build`
- Manual: server running, extension loaded, sign in, run a prompt, cancel a run, kill the SW mid-run (the run fails cleanly, no click runs twice, the extension reconnects).
