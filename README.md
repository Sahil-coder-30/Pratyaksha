# PRATYAKSHA (प्रत्यक्ष)
## Sovereign On-Device Visual Perception & Privacy Shield for Light-Weight Browser Agents

**Codename**: PRATYAKSHA (प्रत्यक्ष)  
*Privacy-preserving Real-time Agentic Tokenizer & Vision-Augmented Knowledge Shield for Autonomous Workflows*  

---

## 🧭 Executive Overview

Modern autonomous browser agents present a fundamental dilemma: executing intelligent web automation (form filling, procurement, workflow execution) requires exposing visual screen pixels and DOM structures to remote Vision-Language Models (VLMs), risking catastrophic leaks of sensitive Personally Identifiable Information (PII), proprietary telemetry, and credentials.

**PRATYAKSHA solves this through an On-Device Privacy Firewall**:
> *Sensitive and PII data is sanitized **on-device in transient memory before** any network request is transmitted. Only unidentifiable, pseudonymized context is sent to AI models. Real values are rehydrated strictly inside the local browser sandbox upon physical DOM actuation.*

```
RAW WEBPAGE (Live DOM Tree + Screen Pixels)
│
▼
LOCAL PRIVACY FIREWALL (Client-Side Extension / Web Worker Sandbox)
├── DOM Analyzer              Semantic HTML signals, labels, input types, autocomplete, ARIA, bboxes
├── PaddleOCR.js / PP-OCRv5   Sub-millisecond character extraction, word polygons, confidence
├── YOLO26n ONNX (WebGPU)     Visual detection: FACE, ID_CARD, PASSPORT, CREDIT_CARD, SIGNATURE, QR/BARCODE
├── BERT-base NER (ONNX)      Contextual named entities: PERSON, LOCATION, ORGANIZATION
├── Structured PII Rules      Verhoeff/Luhn checksums, PAN/GSTIN modulo, Email/Phone regex
├── Entity Resolver           Spatial IoU fusion & multi-source confidence weighting
├── Session Manager           Stable anonymous identities ([PERSON_A71C], crypto.getRandomValues)
├── Semantic Anonymizer       Surgical text span rewriting preserving page reasoning layout
├── Visual Redactor           Irreversible canvas pixel masking with 15% safety padding
└── Sanitized Context Builder Compact JSON schema wire payload (elements + pseudonyms)
│
▼
FINAL PRIVACY GATE (Fail-Closed Outbound Audit Barrier)
├── Blocks: Raw DOM [X], Raw OCR [X], Raw PII [X], Session Mapping Vault [X]
└── Allows: Redacted Screenshot WebP + Sanitized Semantic JSON Payload
│
▼
AI REASONING ENGINE (Local / Cloud VLM)
└── Reasons over [PERSON_A71C], element roles, and masked screenshot → returns action JSON (CLICK, TYPE, SCROLL)
│
▼
JUST-IN-TIME LOCAL REHYDRATION & DISPATCH
└── Replaces [PERSON_A71C] with real in-memory value directly in target input field
```

---

## 📂 Documentation & Architecture Suite

Explore the complete interactive documentation portal by running `npm run docs:serve` (or browsing `Docs/index.html`):

| Module | Document | Focus |
|:---:|:---|:---|
| **HUB** | [`Docs/index.html`](./Docs/index.html) | **Master Portal**: Unified dashboard, visual comparison diagrams, interactive system topology |
| **HLD** | [`Docs/04_hld.html`](./Docs/04_hld.html) | **High-Level Design**: 8-tier microservices architecture, API contracts, WebSocket protocol, and ADRs |
| **ML & Privacy** | [`Docs/08_ml_privacy_module.html`](./Docs/08_ml_privacy_module.html) | **ML & Privacy Engine**: On-device YOLO26n ONNX, PaddleOCR.js, BERT NER, IoU spatial resolver, and 17-feature spec |
| **Agent Engine** | [`Docs/02_browser_agent.html`](./Docs/02_browser_agent.html) | **Autonomous Loop**: Perception-action loop, synthetic DOM events, local rehydration vault, and prompt injection defense |
| **Perception** | [`Docs/03_perception_problem.html`](./Docs/03_perception_problem.html) | **Neural Vision & DOM Blindspots**: Canvas/PDF blindspots, 8x8 dHash filters, quantized ONNX models |
| **Extension** | [`Docs/05_browser_extension.html`](./Docs/05_browser_extension.html) | **Chrome MV3 Deep Dive**: Service Worker, Offscreen Document, Content Script, Side Panel HUD, WebGPU execution |
| **Innovations** | [`Docs/07_reality_check_and_innovations.html`](./Docs/07_reality_check_and_innovations.html) | **Architecture Audit**: Latency benchmarks, sustainable ML stack, and 6 core architectural moats |
| **Strategy** | [`Docs/01_master_plan.html`](./Docs/01_master_plan.html) | **Master Strategic Blueprint**: Full research, competitive analysis, and sprint roadmap |
| **Presentation** | [`Docs/06_team_presentation.html`](./Docs/06_team_presentation.html) | **System Walkthrough & Deck**: User journey, visual matrix, and technical benchmark breakdown |

---

## 🚀 Core Innovations

1. **Reversible Pseudonymization Vault**: Replaces PII with semantic tokens (`[PERSON_A71C]`, `[AADHAAR_9F12]`). External models plan using tokens; client rehydrates locally. Raw values never leave browser memory.
2. **Fail-Closed Multi-Modal Fusion**: DOM structural analysis + PaddleOCR + YOLO26n visual detection + BERT-base NER fused via geometric IoU overlap.
3. **Deterministic Checksum Validation**: Zero false positives through algorithmic certainty — Verhoeff algorithm for 12-digit Indian Aadhaar, Form 49A modulo checks for PAN, and Luhn algorithm for payment cards.
4. **Mechanical Anti-Hallucination & Backtracking**: Strict loop detection, dynamic target blacklisting, and automatic state rollback when an action path encounters a dead end.
5. **Non-Blocking Web Worker Isolation**: Offloads ML inference (YOLO26n, PaddleOCR, BERT) to dedicated Web Workers with WebGPU/WASM to keep the host page at 60 FPS.
6. **1-Click Immediate Abort**: Instant `AbortController` cancellation that halts all in-flight requests, clears DOM bounding boxes, and prevents token burn.

---

## 🛠️ Complete Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| **Browser Extension** | Chrome Manifest V3 (MV3) | Tab management, side panel execution HUD, content scripting |
| **Agent Engine** | LangGraph StateGraph Architecture | 8-node state machine (Intake, Privacy, Planner, Policy, Agent, Verifier, Recovery, Finalize) |
| **Agent Framework** | `@langchain/core` & Chat Models | Mistral Large (`@langchain/mistralai`), Gemini (`@langchain/google-genai`), OpenRouter (`@langchain/openai`) |
| **Tool System** | LangChain `DynamicStructuredTool` + Zod | 19 sovereign browser automation tools with strict runtime schema validation |
| **Checkpointer** | `ChromeStorageSaver` (LangGraph) | Secrets-scrubbed persistent state persistence in `chrome.storage.local` across MV3 worker cycles |
| **PII & Vault** | Verhoeff & Luhn checksums + Ephemeral Map | Sovereign client-side PII identification, anonymization tokenization, and DOM rehydration |
| **OCR Engine** | `PaddleOCR.js` / `PP-OCRv5` | Sub-millisecond on-device character recognition |
| **Vision Model** | `YOLO26n` (ONNX Runtime Web) | Visual privacy-object detection (IDs, signatures, faces, QR codes) |
| **Named Entity** | `BERT-base NER` (Transformers.js) | Contextual text entity extraction (PERSON, LOCATION, ORG) |
| **Build Pipeline** | `esbuild` | Zero-external-dependency self-contained ESM bundle for Chrome MV3 (`npm run build`) |

---

## ⚡ Quick Start & Development

### 1. Install and Test
```bash
npm install
npm test        # 102 tests across 18 suites
```

### 2. Build the Extension
```bash
npm run build   # writes the loadable extension to build/
```

### 3. Load the Extension in Chrome
1. Open `chrome://extensions/`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the [`build/`](./build) folder.
4. Pin **PRATYAKSHA** and click it to open the side panel.

> After any code change, run `npm run build` again and click the reload icon on the extension card.

### 4. Add Your API Key (Bring Your Own Key)
The extension ships with **no API keys**. Open the side panel, click **⚙ Settings**, pick a provider (Mistral, OpenRouter, Gemini or TinyFish) and paste your own key.

- The key is stored only in `chrome.storage.local` on your device.
- It is sent only to the provider you selected.
- The **Deterministic** planner works offline with no key.

Never put real keys in source files. `build.js` fails the build if an `env.js` or `.env` file ends up in `build/`.

### 5. Package for the Chrome Web Store
```bash
npm run ext:pack   # creates dist/pratyaksha-extension.zip
```

### 6. Run the Interactive Testbed
```bash
npm run demo
```
Open [http://localhost:8080/demo/test-demo.html](http://localhost:8080/demo/test-demo.html) in Chrome and ask the agent to fill forms, navigate, and redact PII.

### 7. Explore the Documentation Portal
```bash
npm run docs:serve
```
Open [http://localhost:8080/index.html](http://localhost:8080/index.html) in any browser.

### 7. Run the Live Agent Evaluation
Unit tests use mocked models. The eval harness measures the real agent on real pages with a real LLM.

It runs `src/runner.js` in Node and drives a Chromium browser (Brave by default) through a puppeteer-backed `chrome.*` shim. The same content scripts as the extension (`src/browser/dom-actions.js`, `content-main.js`) are injected into each page.

```bash
# Key comes from the environment only. Never commit it, never put it in the repo.
export MISTRAL_API_KEY=...        # or GEMINI_API_KEY / OPENROUTER_API_KEY
npm run eval
```

| Option | Meaning |
|---|---|
| `--mock` | Scripted model, no key. Checks the harness plumbing only (tasks are expected to fail). |
| `--offline` | Skip tasks that need the public internet (Wikipedia). |
| `--only a,b` | Run only these task ids. |
| `--repeat N` | Runs per task, to measure flakiness. |
| `--max-steps N` / `--timeout S` | Step budget (default 25) and wall-clock limit per run (default 240s). |
| `--headful` | Show the browser window. |

| Env var | Meaning |
|---|---|
| `PRATYAKSHA_EVAL_PROVIDER` | `mistral`, `gemini` or `openrouter`. Default: first provider with a key set. |
| `PRATYAKSHA_EVAL_MODEL` | Model id override. |
| `PRATYAKSHA_EVAL_API_KEY` | Key for the chosen provider (else the provider's own env var). |
| `PRATYAKSHA_EVAL_BROWSER` | Path to a Chromium-based binary, if Brave or Chrome is not in `/Applications`. |

Tasks live in `scripts/eval/tasks.mjs`. Local fixture pages in `scripts/eval/fixtures/` are served on `127.0.0.1`:

| Task | What it tests |
|---|---|
| `kb-search-answer` | Search box, click a result, answer from the article. |
| `wikipedia-answer` | Same on a real public site. |
| `shipping-form-select` | Text input plus two `<select>` fields, then submit. |
| `cookie-banner-read` | Content is hidden until a cookie banner is dismissed. |
| `settings-modal` | Open a `<dialog>`, tick a checkbox, save. |
| `shop-multipage` | Navigate home, category, product, then read a spec. |
| `login-wall-infeasible` | No credentials given. Must end with `finish_task(success=false)` and not guess a login. |

Each run records: pass, reported success, steps, wall time, LLM calls (provider HTTP requests), failed tool calls (`ERROR`/`BLOCKED` observations), approvals, and whether the final answer is grounded in page text the agent saw. A run passes when the reported success matches the expected value, the expected answer is in the summary, and the page-state check holds. Gated actions are auto-approved by the harness.

Results go to `eval-results/latest.json` and `eval-results/latest.md` (plus timestamped copies). The folder is git-ignored.

---

## 📦 Project Structure

**Rule of thumb:** edit `src/` and `pratyaksha-extension/`. Never edit `build/`, it is regenerated on every build.

```
.
├── src/                          # Agent logic (bundled into build/agent/graph-engine.js)
│   ├── agent/                    # Models, LangChain tools, planner, verifier, recovery, graph, TinyFish client
│   ├── browser/                  # Browser tools + content scripts (dom-actions.js, content-main.js)
│   ├── safety/                   # PII vault, privacy shield, action/URL policy, approvals, limits
│   ├── persistence/              # ChromeStorageSaver checkpointer, thread store
│   ├── shared/                   # Constants, errors, Zod tool schemas
│   ├── ui/                       # Agent event emitter
│   └── runner.js                 # Bundle entry: everything the side panel imports
├── pratyaksha-extension/         # Hand-written Chrome MV3 shell
│   ├── manifest.json
│   ├── background/               # Service worker
│   ├── sidepanel/                # Chat UI, settings modal, 3D orb
│   ├── popup/                    # Toolbar popup
│   ├── shared/settings.js        # BYOK settings (chrome.storage.local)
│   ├── content/highlighter.css   # Content script styles
│   └── assets/                   # Icons and logos
├── tests/                        # node:test suites (npm test)
├── demo/                         # Local testbed pages
├── Docs/                         # Documentation website (deployed via vercel.json)
│   └── engineering/              # Architecture notes, guardrail design, implementation reports
├── observability/                # Optional telemetry stack (Prometheus, Loki, Grafana)
├── ML/                           # On-device ML privacy module prototype
├── build.js                      # Build script: src/ + pratyaksha-extension/ → build/
└── .github/workflows/ci.yml      # Runs tests and build on every push and PR
```

**Generated, not in git:** `build/` (loadable extension) and `dist/` (Web Store zip).
