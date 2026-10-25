# 🧩 BigFish Agent & MCP Backend Server

> Autonomous LangGraph orchestration and MCP WebSocket host that connects AI models to real user browsers with zero-trust safety.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Status](https://img.shields.io/badge/status-Development-brightgreen)
![Runtime](https://img.shields.io/badge/runtime-Node.js%2022%20%2B%20TypeScript%205-informational)

---

## 📖 Table of Contents
- [Overview & The "Why"](#-overview--the-why)
- [Built Features & Current State](#-built-features--current-state)
- [Architecture & Design Patterns](#-architecture--design-patterns)
- [Usage & Setup](#-usage--setup)
- [Communication & Contracts](#-communication--contracts)
- [Production Readiness](#-production-readiness)
- [Changelog & Migration State](#-changelog--migration-state)

---

## 🎯 Overview & The "Why"

### What this service does
The **BigFish Backend Server** (`@bigfish/server`) orchestrates autonomous browser execution. It receives user natural language goals, plans multi-step execution graphs via LangGraph and Mistral AI, verifies completion with a judge model, and dispatches actions across a low-latency, length-prefixed WebSocket MCP bridge connected to the BigFish Chrome Extension.

### Why this is its own microservice (not part of a monolith)
- **Bounded context:** Owns long-running agent state machines, tool policy verification, loop prevention, and multi-tenant device session routing exclusively.
- **Independent scaling need:** High memory and async I/O overhead driven by LangGraph state trees and streaming Server-Sent Events (SSE) differs drastically from the lightweight client-side Chrome extension and CPU/GPU-heavy on-device ML privacy models.
- **Independent deployability:** Agent prompts, planning policies, and model orchestrators iterate continuously without forcing extension updates or Chrome Web Store re-reviews.
- **Failure isolation:** If the server restarts or crashes, local browser tabs remain intact, credentials remain secure, and the extension enters graceful reconnect backoff without losing page state.
- **Data isolation strategy:** Ephemeral in-memory session registry and ticket store; session state is strictly transient with zero persistent PII storage.

### The "User" of this service

| Caller | Call type | Why it calls this service |
|---|---|---|
| BigFish Chrome Extension Sidepanel | Sync HTTP / SSE (`/api/agent/invoke`) | Starts agent runs and receives live streaming `AgentEvent` traces |
| BigFish Chrome Extension Background | Framed WebSocket (`/mcp-ws`) | Connects as an MCP Server exposing 15 browser automation tools |
| Browser Client Authentication | Sync REST (`/api/auth/google`, `/api/ws-ticket`) | Exchanges Google OAuth tokens for BigFish JWTs and one-time WS connection tickets |

---

## 🚧 Built Features & Current State

### Current state
| Field | Value |
|---|---|
| **Status** | 🟢 Production-Ready Local Daemon / Active Development |
| **Version** | `0.1.0` |
| **Last deployed** | Monorepo active local development |
| **Owner(s)** | BigFish Core Platform Team |
| **Known technical debt** | Ticket store and session registries are currently in-memory single-node stores; clustering requires Redis-backed ticket revocation and distributed pub/sub. |

### Features built (working today)
- `GET /health`, `GET /healthz`, `GET /ready` — Liveness and readiness probes returning active device and run counts — ✅ done
- `POST /api/auth/google` — Verifies Google ID tokens and issues signed BigFish JWTs — ✅ done
- `POST /api/ws-ticket` — Mints 60-second single-use tickets for extension WebSocket authentication — ✅ done
- `GET /api/devices` — Lists connected browser devices for the authenticated user — ✅ done
- `POST /api/agent/invoke` — Executes LangGraph `plan -> act -> verify -> finalize` agent pipeline over SSE — ✅ done
- `POST /api/agent/cancel` — Aborts an active agent run and signals in-flight browser tools to cancel — ✅ done
- `GET /mcp-ws` — Upgrades authenticated WebSocket connections to length-prefixed MCP framed RPC — ✅ done
- `Loop Guard & Tool Policy` — Terminates runs after 6 tool calls, detects 3x repeated actions, and validates argument schemas — ✅ done

### How it was built
- **Language/runtime:** Node.js `>=22` + TypeScript `5.x`
- **Framework:** Hono `v4.13.13` + `@hono/node-server` + `@hono/node-ws`
- **Design patterns used:**
  - **State Machine (LangGraph):** Explicit cyclical graph tracking subtask decomposition, tool execution, and judge verification.
  - **Framed Protocol Adapter:** Converts standard Model Context Protocol (MCP) tool calls into length-prefixed WebSocket frames with heartbeat ping/pong.
  - **Single-Use Ticket Auth:** Guarantees WebSocket connection handshakes cannot be hijacked or replayed by unauthorized origins.
- **Key libraries:** `@langchain/langgraph`, `@langchain/mistralai`, `jose` (JWT), `zod` (contract validation), `@bigfish/contracts`, `@bigfish/mcp-ws`

---

## 🏗️ Architecture & Design Patterns

The server decouples long-running AI cognition from physical browser execution:

```
apps/server/
├── src/
│   ├── agent/             # LangGraph state machine, actors, models, loop-guard, prompts
│   ├── auth/              # Google OAuth token verification, JWT issuance, ticket store
│   ├── controllers/       # Agent invocation, run streaming, and cancellation logic
│   ├── mcp/               # In-memory device session registry, client session bindings
│   ├── routes/            # Hono REST endpoints (/api/agent, /api/auth, /api/devices, /api/dev)
│   ├── ws/                # WebSocket upgrade handler, ticket guard, framed RPC dispatch
│   ├── app/               # Hono application factory with route mounting
│   ├── runs.ts            # Active run registry and cancellation controllers
│   ├── server.ts          # Process lifecycle, graceful shutdown, signal handling
│   └── index.ts           # Service entrypoint
├── test/                  # 33 unit and integration tests (agent, mcp-ws, auth, loop-guard)
└── package.json
```

---

## ⚙️ Usage & Setup

### Environment variables

| Key | Required | Description | Example (fake) |
|---|---|---|---|
| `PORT` | ❌ | Port the HTTP daemon listens on (defaults to 8787) | `8787` |
| `HOST` | ❌ | Bind interface (defaults to 127.0.0.1 for local isolation) | `127.0.0.1` |
| `NVIDIA_API_KEY` | One model key ✅ | NVIDIA key (free at build.nvidia.com). Used first when set | `nvapi-sample-xxxxxxxx` |
| `NVIDIA_MODEL` | ❌ | NVIDIA agent model (must support tool calling) | `nvidia/nemotron-3.5-super-vl-120b-a12b` |
| `NVIDIA_JUDGE_MODEL` | ❌ | NVIDIA model that checks each subtask | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| `OPEN_ROUTER_API_KEY` | One model key ✅ | OpenRouter key. Used when no NVIDIA key is set | `sk-or-v1-sample-xxxxxxxx` |
| `OPEN_ROUTER_MODEL` | ❌ | OpenRouter agent model | `openai/gpt-6-luna` |
| `OPEN_ROUTER_JUDGE_MODEL` | ❌ | OpenRouter judge model (defaults to `OPEN_ROUTER_MODEL`) | `openai/gpt-6-luna` |
| `MISTRAL_API_KEY` | One model key ✅ | Mistral key. Used when no NVIDIA or OpenRouter key is set. With no model key, `/api/agent/invoke` answers 503 | `mstrl_sample_api_key_xxxxxxxx` |
| `AGENT_MODEL` | ❌ | Mistral agent model (must support tool calling) | `mistral-medium-latest` |
| `AGENT_JUDGE_MODEL` | ❌ | Mistral judge model | `mistral-small-latest` |
| `AGENT_VISION` | ❌ | `false` hides `browser_screenshot` from a model that cannot read images | `true` |
| `GOOGLE_EXTENSION_CLIENT_ID`| ✅ | Chrome Extension OAuth Client ID | `123456789-sample.apps.googleusercontent.com` |
| `JWT_SECRET` | ✅ | Symmetric secret for signing BigFish access JWTs | `super-secret-random-jwt-key-32chars` |
| `EXTENSION_ID` | ✅ | Chrome Extension ID to enforce WebSocket Origin check | `abcdefghijklmnopabcdefghijklmnop` |
| `ENABLE_DEV_ROUTES` | ❌ | Set to 1 to enable mock logins and unauthenticated dev routes | `0` |

### Run Locally

Run from monorepo root:

```bash
# Install dependencies
pnpm install

# Run the development server with hot-reload
pnpm dev:server

# Run test suite
pnpm --filter @bigfish/server test

# Run type checking
pnpm --filter @bigfish/server typecheck
```

---

## 📡 Communication & Contracts

### Inbound Endpoints
- `GET /healthz` — Liveness probe (HTTP 200 `{ "ok": true, "name": "bigfish" }`)
- `GET /ready` — Readiness probe verifying socket registry is operational
- `POST /api/auth/google` — Body: `{ idToken: string }` $\to$ Returns `{ token: string, user: { id, email } }`
- `POST /api/ws-ticket` — Header: `Authorization: Bearer <jwt>` $\to$ Returns `{ ticket: string, wsUrl: string }`
- `POST /api/agent/invoke` — Body: `{ prompt: string, deviceId: string }` $\to$ Emits SSE `AgentEvent` stream
- `POST /api/agent/cancel` — Body: `{ runId: string }` $\to$ Returns `{ ok: true }`

### Outbound Tool RPC (Over Extension MCP WebSocket)
Dispatches any of the 15 verified browser tool contracts defined in `@bigfish/contracts`:
`browser_navigate`, `browser_snapshot`, `browser_find`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_select`, `browser_press_key`, `browser_scroll`, `browser_wait_for`, `browser_extract`, `browser_screenshot`, `browser_code_editor`, `browser_tabs`, `browser_ping`.

A `browser_screenshot` image is passed to the model as a user message right after the tool answers (OpenAI-compatible APIs take images only there). Only the newest screenshot stays in the context.

---

## 🛡️ Production Readiness

- **Health Checks:** Implements both `/healthz` and `/ready` probes.
- **Graceful Shutdown:** Intercepts `SIGINT` and `SIGTERM`, rejects new HTTP requests, terminates active agent runs with `CANCELLED`, disconnects MCP WebSocket peers with code `1001` (Going Away), and drains sockets within 5 seconds.
- **Security & Origin Locking:** `/mcp-ws` enforces origin header matching against `chrome-extension://${EXTENSION_ID}` and requires cryptographically validated single-use tickets.
- **Loop Guards:** Prevents runaway agent iterations by capping actions at 6 per run and terminating duplicate cycles.

---

## 📜 Changelog & Migration State

- **v0.1.0:** Initial implementation of LangGraph plan-act-verify cycle, Hono backend, framed MCP WebSocket client registry, and Mistral model integration.
