# 📦 BigFish Shared Contracts & Tool Schemas

> Single source of truth for TypeScript interfaces, Zod runtime schemas, wire protocol framing, and browser tool definitions across BigFish.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Status](https://img.shields.io/badge/status-Production--Ready-brightgreen)
![Runtime](https://img.shields.io/badge/runtime-TypeScript%205%20%2B%20Zod%204-informational)

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
`@bigfish/contracts` is the central contract package shared by the backend agent server, the Chrome extension, and the MCP WebSocket transport layer. It exports strict Zod schemas and inferred static TypeScript types that guarantee zero schema drift between client-side browser execution and server-side LLM cognition.

### Why this is its own package (not duplicated in apps)
- **Bounded context:** Owns type definitions, runtime input validation boundaries, wire message schemas, and error codes exclusively.
- **Independent scaling need:** Zero runtime compute overhead; compiles to lightweight ESM/CJS type declarations imported by all monorepo workspaces.
- **Independent deployability:** Changes to tool signatures and protocol versions are versioned and enforced across all consumers simultaneously.
- **Failure isolation:** Malformed tool arguments or unknown action requests fail immediately at schema validation boundaries before reaching browser execution engines.
- **Data isolation strategy:** Stateless schema definitions with zero datastore dependencies.

### The "User" of this package

| Consumer | Integration Type | Why it imports this package |
|---|---|---|
| `@bigfish/server` | In-process TypeScript import | Validates incoming tool call arguments and types outgoing `AgentEvent` streams |
| `@bigfish/extension` | In-process TypeScript import | Implements and executes the 13 browser tools according to strict schemas |
| `@bigfish/mcp-ws` | In-process TypeScript import | Encodes and decodes framed WebSocket wire messages |

---

## 🚧 Built Features & Current State

### Current state
| Field | Value |
|---|---|
| **Status** | 🟢 Production-Ready / Active |
| **Version** | `0.1.0` |
| **Last deployed** | Monorepo internal workspace |
| **Owner(s)** | BigFish Architecture Team |
| **Known technical debt** | None. All 13 browser tools have strict Zod validation schemas. |

### Features built (working today)
- `13 Browser Tool Schemas` — Complete Zod schemas with descriptions for LLM tool calling:
  - `browser_navigate` — URL navigation and back/forward/reload history actions
  - `browser_snapshot` — DOM text tree, interactive element indexing, and screenshot capture
  - `browser_find` — Natural-language fuzzy locator for interactive page elements
  - `browser_click` — Element click with support for modifiers and coordinates
  - `browser_type` — Text entry into input fields with optional auto-submit
  - `browser_fill_form` — Atomic multi-field form completion
  - `browser_select` — Dropdown and select element option selection
  - `browser_press_key` — Raw keyboard key events (Enter, Escape, Tab, Arrows)
  - `browser_scroll` — Directional and element-specific viewport scrolling
  - `browser_wait_for` — Explicit condition synchronization (text appears, element removed, network idle)
  - `browser_extract` — Structured tabular and text data scraping
  - `browser_tabs` — Tab switching, opening, closing, and enumeration
  - `browser_ping` — End-to-end connection latency benchmarking
- `Wire Message Contracts` — Framing specifications for `hello`, `ping`, `pong`, `call`, `result`, `abort`, `run_task`, `cancel_run`, and `agent_event`
- `Agent Event Stream Types` — Discriminated union types for SSE streaming (`run`, `plan`, `step`, `tool_call`, `progress`, `tool_result`, `final`, `error`)
- `Standardized Error Enums` — Canonical codes (`STATE_UNKNOWN`, `RUN_IN_PROGRESS`, `TOOL_LIMIT`, `RATE_LIMITED`, `APPROVAL_DENIED`)

### How it was built
- **Language/runtime:** TypeScript `5.x`, Node.js `>=22`
- **Key libraries:** `zod` (`v4.x`) for schema declaration and JSON schema generation for LangChain / MCP tool calling

---

## 🏗️ Architecture & Design Patterns

```
packages/contracts/
├── src/
│   ├── agent.ts       # AgentEvent, Subtask, Plan, and streaming message contracts
│   ├── errors.ts      # Canonical error codes and error response factories
│   ├── index.ts       # Central barrel export
│   ├── tools.ts       # 13 Browser tool Zod schemas and inferred types
│   └── wire.ts        # WebSocket framed protocol definitions and constants
├── tsconfig.json
└── package.json
```

---

## ⚙️ Usage & Setup

### Environment variables

| Key | Required | Description | Example (fake) |
|---|---|---|---|
| `NODE_ENV` | ❌ | Execution environment flag | `production` |

### Run Locally

Run from monorepo root:

```bash
# Type check contracts
pnpm --filter @bigfish/contracts typecheck
```

Example usage in TypeScript:

```typescript
import { BrowserClickArgsSchema, type BrowserClickArgs } from "@bigfish/contracts";

const validatedArgs: BrowserClickArgs = BrowserClickArgsSchema.parse({
  ref: "btn-login-01",
  clickCount: 1,
});
```

---

## 📡 Communication & Contracts

Acts as the single point of truth for inter-service communication contracts. Exports canonical constant `WS_PATH = "/mcp-ws"` and `MAX_FRAME_BYTES = 16 * 1024 * 1024` (16 MB maximum payload).

---

## 🛡️ Production Readiness

- **Health Checks:** Library package; provides contract typing for downstream `/healthz` and `/ready` probes.
- **Zero Runtime Side Effects:** Pure schema exports with zero unhandled exceptions or background intervals.
- **Fail-Fast Validation:** Strips unexpected keys and validates constraints at the perimeter before any execution.

---

## 📜 Changelog & Migration State

- **v0.1.0:** Canonical release defining all 13 browser tool schemas, agent events, and wire frames.
