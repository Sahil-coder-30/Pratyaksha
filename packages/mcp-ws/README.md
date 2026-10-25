# 📦 BigFish Framed WebSocket MCP Transport Layer

> Length-prefixed binary/text framing, automatic exponential reconnect, and heartbeat liveness for Model Context Protocol over WebSockets.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Status](https://img.shields.io/badge/status-Production--Ready-brightgreen)
![Runtime](https://img.shields.io/badge/runtime-TypeScript%205%20%2B%20Node%20%2F%20Browser-informational)

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

### What this package does
`@bigfish/mcp-ws` provides an enterprise-grade transport layer connecting Model Context Protocol (MCP) clients and servers over WebSocket connections. It abstracts raw socket fragmentation with length-prefixed message framing, transparent bidirectional heartbeats, dead-peer detection, and jittered exponential backoff reconnection.

### Why this is its own package (not duplicated in apps)
- **Bounded context:** Exclusively handles low-level wire framing, socket liveness, protocol handshakes, and transport disconnection recovery.
- **Independent scaling need:** Zero memory footprint; acts as a shared transport engine for both Node.js server runtimes and browser Service Worker contexts.
- **Independent deployability:** Network protocol optimizations, heartbeat tuning, and backoff heuristics are updated without touching business logic in the agent or browser tools.
- **Failure isolation:** Isolates socket disconnects, EOF errors, and reconnect storms, providing clean promise-based RPC error handling (`STATE_UNKNOWN`, `CONNECTION_CLOSED`).
- **Data isolation strategy:** Pure transport layer with zero persistence.

### The "User" of this package

| Consumer | Integration Type | Why it imports this package |
|---|---|---|
| `@bigfish/server` (`apps/server`) | In-process TypeScript import | Mounts `ServerSocket` on `/mcp-ws` to communicate with client extensions |
| `@bigfish/extension` (`apps/extension`) | In-process TypeScript import | Uses `ClientSocket` in background service worker to connect and reconnect to server |

---

## 🚧 Built Features & Current State

### Current state
| Field | Value |
|---|---|
| **Status** | 🟢 Production-Ready / Active |
| **Version** | `0.1.0` |
| **Last deployed** | Monorepo internal workspace |
| **Owner(s)** | BigFish Infrastructure Team |
| **Known technical debt** | None. Fully covered by in-memory transport and connection drop test suites. |

### Features built (working today)
- `FramedTransport` — Decoupled transport implementation supporting in-memory pipes, Node.js `ws`, and browser `WebSocket` — ✅ done
- `ClientSocket` — Browser extension connection manager with ticket handshake, status callbacks, and exponential backoff retry — ✅ done
- `ServerSocket` — Server-side connection wrapper enforcing hello handshake timeouts and frame size limits — ✅ done
- `Liveness Heartbeats` — Regular ping/pong intervals with configurable timeout thresholds to drop silent half-open TCP connections — ✅ done
- `Grace Window Recovery` — In-flight read-only tool calls wait for reconnecting devices before failing — ✅ done

### How it was built
- **Language/runtime:** TypeScript `5.x`, isomorphic for Node.js `>=22` and browser WebExtension runtimes
- **Dependencies:** `@bigfish/contracts`

---

## 🏗️ Architecture & Design Patterns

```
packages/mcp-ws/
├── src/
│   ├── client-socket.ts       # Reconnecting client socket with state machine
│   ├── framed-transport.ts    # Isomorphic length-prefixed frame decoder/encoder
│   ├── index.ts               # Barrel exports
│   ├── liveness.ts            # Ping/pong timer and dead peer detection
│   └── server-socket.ts       # Server-side connection handler
├── tsconfig.json
└── package.json
```

---

## ⚙️ Usage & Setup

### Environment variables

| Key | Required | Description | Example (fake) |
|---|---|---|---|
| `NODE_ENV` | ❌ | Execution environment flag | `development` |

### Run Locally

Run from monorepo root:

```bash
# Type check transport package
pnpm --filter @bigfish/mcp-ws typecheck
```

Example usage in TypeScript:

```typescript
import { FramedTransport } from "@bigfish/mcp-ws";

const transport = new FramedTransport(websocketInstance);
await transport.send({ type: "ping" });
```

---

## 📡 Communication & Contracts

Implements the length-prefixed wire protocol specified in `@bigfish/contracts`:
- Max frame size: 16 MB (`MAX_FRAME_BYTES`).
- Heartbeat default: 15-second ping interval, 30-second dead peer timeout.
- Handshake timeout: 5-second hello frame deadline.

---

## 🛡️ Production Readiness

- **Health Checks:** Provides connection status hooks (`status: "ready" | "connecting" | "backoff"`) that feed server and client `/healthz` and `/ready` probes.
- **Graceful Draining:** Sockets close with WebSocket status `1001` (Going Away) during host process shutdowns.
- **Backoff Jitter:** Exponential reconnect with random jitter avoids thundering herd problems when the server restarts.

---

## 📜 Changelog & Migration State

- **v0.1.0:** Isomorphic framed transport, heartbeat liveness, and client reconnect engine.
