# 🧩 BigFish Chrome Extension & Browser MCP Server

> Privacy-first Chrome extension that turns your browser into a secure Model Context Protocol (MCP) server with client-side PII masking and agentic UI.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Status](https://img.shields.io/badge/status-Development-brightgreen)
![Runtime](https://img.shields.io/badge/runtime-Chrome%20MV3%20%2B%20WXT%200.21-informational)

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
The **BigFish Extension** (`@bigfish/extension`) runs inside the user's real Chrome browser session. It acts as a local **Model Context Protocol (MCP) Server** over an encrypted WebSocket connection, exposing 15 browser automation tools (clicks, typing, snapshots, tabs, form fills) while intercepting all page text to strip sensitive PII (emails, cards, Aadhaar, phones) before any data leaves the local device.

### Why this is its own microservice (not part of a monolith)
- **Bounded context:** Owns direct access to live Chrome DOM APIs, user browser cookies, active sessions, audio hardware for voice dictation, and the local PII rehydration vault exclusively.
- **Independent scaling need:** Scales horizontally with every user's personal workstation or laptop; zero browser execution compute load is borne by central servers.
- **Independent deployability:** Packaged as an unpacked Chrome MV3 extension adhering to the WebExtension standard and distributed via the Chrome Web Store.
- **Failure isolation:** If the cloud agent server experiences latency or disconnects, the user's tabs and browser state are never killed. The extension handles reconnect backoff automatically.
- **Data isolation strategy:** Client-side local storage (`browser.storage.local`) and in-memory PII token vault; raw sensitive credentials never leave the browser sandbox.

### The "User" of this service

| Caller | Call type | Why it calls this service |
|---|---|---|
| End User | Direct UI Interaction | Interacts with the Chrome side panel, dictates voice commands, and approves risky actions |
| BigFish Backend Agent Server | Inbound Framed WebSocket RPC (`/mcp-ws`) | Invokes browser automation tools (`browser_click`, `browser_snapshot`, etc.) |
| Browser Active Tabs | In-process Content Script Messaging | Injects DOM actions, accessibility tree extractors, and the visual agent cursor |

---

## 🚧 Built Features & Current State

### Current state
| Field | Value |
|---|---|
| **Status** | 🟢 Production-Ready Local Extension / Active Development |
| **Version** | `0.1.0` |
| **Last deployed** | Chrome Developer Mode / Local Build |
| **Owner(s)** | BigFish Frontend & Security Team |
| **Known technical debt** | Web Speech API speech-to-text requires Google server connectivity; local whisper model fallback is planned for 100% offline air-gapped dictation. |

### Features built (working today)
- `15 Browser Automation Tools` — Full implementation of `browser_navigate`, `browser_snapshot`, `browser_find`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_select`, `browser_press_key`, `browser_scroll`, `browser_wait_for`, `browser_extract`, `browser_screenshot`, `browser_code_editor`, `browser_tabs`, and `browser_ping` — ✅ done
- `Code editors (LeetCode)` — `browser_code_editor` reads or replaces the code in a Monaco, CodeMirror or Ace editor through the editor's own API in the page's MAIN world, so no brackets or indents double up. After a write it clicks the editor's Format button (only one labelled Format), or runs the editor's own format action, like LeetCode's "Format code" (`entrypoints/background/code-editor.ts`) — ✅ done
- `Masked screenshots` — `browser_screenshot` captures the visible tab, gets PII boxes from the local ML daemon (`WXT_ML_URL`), stores each value in the PII vault, and paints its token over the box (`entrypoints/background/screenshot.ts`). No image is sent when the daemon is down (`ML_UNAVAILABLE`) or a spot cannot be located (`PRIVACY_BLOCKED`) — ✅ done
- `Zero-Trust PII Redaction Vault` — Intercepts page snapshots and redacts emails, phones, PAN, Luhn-verified credit cards, and Verhoeff-verified Aadhaar numbers into deterministic salt tokens (`[CARD_XXXX]`) — ✅ done
- `Origin-Aware Rehydration` — Allows form autofill tools to replace tokens with real values *only* on the verified originating web domain — ✅ done
- `Visual Agent Cursor` — Renders an animated cursor directly on web pages showing live AI agent targeting — ✅ done
- `Sidepanel Agent Workspace` — Displays real-time plan checklists, subtask step statuses, expandable tool results, and final synthesized answers — ✅ done
- `Web Speech Voice Input` — Hands-free voice dictation with automatic speech-to-text conversion and punctuation — ✅ done
- `Human-in-the-Loop Approvals` — Intercepts high-risk actions (financial transactions, data deletion, authentication submission) for explicit user approval — ✅ done

### How it was built
- **Language/runtime:** TypeScript `5.x`, Chrome Manifest V3
- **Framework:** WXT `v0.21.4` (Next-generation Web Extension Framework) + Vite `8.3.5`
- **Design patterns used:**
  - **Reverse MCP Architecture:** The extension acts as the server while the central agent acts as the client, avoiding external inbound network punch-through.
  - **Tokenized Vault Pattern:** Replaces raw PII with deterministic HMAC hashes, ensuring the cloud LLM reasons over structured tokens without seeing sensitive credentials.
  - **Single-Event FIFO Executor:** Serializes tool invocations per tab to prevent concurrent race conditions during DOM mutations.
- **Key libraries:** `@modelcontextprotocol/server`, `@bigfish/contracts`, `@bigfish/mcp-ws`, `zod`

---

## 🏗️ Architecture & Design Patterns

The extension is partitioned into isolated MV3 contexts:

```
apps/extension/
├── entrypoints/
│   ├── background/        # Service worker: MCP server, WebSocket connection, tool executor
│   ├── content/           # Content script: DOM action engine, visual agent cursor
│   ├── sidepanel/         # Sidepanel UI: main controller, voice input, agent client
│   └── mic-permission/    # Permission dialogue for audio recording
├── safety/                # PII vault, action policy, URL policy, approval queue
├── wxt.config.ts          # WXT bundler configuration
└── package.json
```

---

## ⚙️ Usage & Setup

### Environment variables

| Key | Required | Description | Example (fake) |
|---|---|---|---|
| `WXT_SERVER_URL` | ❌ | Backend agent server WebSocket URL | `http://127.0.0.1:8787` |
| `WXT_ML_URL` | ❌ | Local ML privacy daemon that masks `browser_screenshot` images | `http://127.0.0.1:8788` |
| `WXT_GOOGLE_CLIENT_ID` | ✅ | Google OAuth Client ID for identity verification | `123456789-sample.apps.googleusercontent.com` |
| `WXT_EXTENSION_KEY` | ❌ | Fixed manifest public key for persistent extension ID | `sample-manifest-public-key` |


### Run Locally

Run from monorepo root:

```bash
# Install dependencies
pnpm install

# Build extension for Chrome MV3
pnpm --filter @bigfish/extension build

# Launch Chrome in development mode with extension hot-reloading
pnpm dev:ext

# Run safety and PII unit tests
pnpm --filter @bigfish/extension test

# Playwright E2E: Chromium + built extension + server + fixture pages, incl. tool edge cases (tools-edge.spec.ts)
pnpm --filter @bigfish/extension e2e

# Agent evals: the real model on fixture pages (forms, shop, table, mail, chat). Needs the e2e build (run e2e once).
# Traces go to test-results/agent-eval/
NVIDIA_API_KEY=... pnpm --filter @bigfish/extension exec tsx e2e/agent-eval.ts [case...]
```

To load manually in Chrome:
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select `apps/extension/.output/chrome-mv3` (or `dist/chrome-mv3`).

---

## 📡 Communication & Contracts

### Outbound Connection
- Connects to `ws://127.0.0.1:8787/mcp-ws` with single-use tickets acquired via `/api/ws-ticket`.
- Exchanges length-prefixed protocol frames (`hello`, `ping`, `pong`, `call`, `result`, `abort`).

### Inbound Tool Dispatch
Receives tool requests validated against `@bigfish/contracts` schemas and dispatches to the active Chrome tab.

---

## 🛡️ Production Readiness

- **Health Checks & State Machine:** The background connection exposes states (`signed_out`, `idle`, `ticket`, `connecting`, `ready`, `backoff`, `stopped`) visible in the UI header and supports internal `/healthz` and `/ready` connectivity probes.
- **Fail-Safe Disconnects:** Any in-flight mutating tool cut off mid-execution returns `STATE_UNKNOWN` and is never blindly retried, preventing duplicate financial transactions.
- **Zero Raw PII Leaks:** Text extracted via snapshots passes through `sanitizeObservationForModel` before serialization onto the wire.

---

## 📜 Changelog & Migration State

- **v0.1.0:** Implementation of 13 browser tools, WXT MV3 build, reverse MCP framed WebSocket client, PII vault, visual cursor, and voice input integration.
