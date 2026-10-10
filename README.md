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
| **HUB** | [`Docs/index.html`](file:///Users/home/Desktop/PS-%2026171/Docs/index.html) | **Master Portal**: Unified dashboard, visual comparison diagrams, interactive system topology |
| **HLD** | [`Docs/04_hld.html`](file:///Users/home/Desktop/PS-%2026171/Docs/04_hld.html) | **High-Level Design**: 8-tier microservices architecture, API contracts, WebSocket protocol, and ADRs |
| **ML & Privacy** | [`Docs/08_ml_privacy_module.html`](file:///Users/home/Desktop/PS-%2026171/Docs/08_ml_privacy_module.html) | **ML & Privacy Engine**: On-device YOLO26n ONNX, PaddleOCR.js, BERT NER, IoU spatial resolver, and 17-feature spec |
| **Agent Engine** | [`Docs/02_browser_agent.html`](file:///Users/home/Desktop/PS-%2026171/Docs/02_browser_agent.html) | **Autonomous Loop**: Perception-action loop, synthetic DOM events, local rehydration vault, and prompt injection defense |
| **Perception** | [`Docs/03_perception_problem.html`](file:///Users/home/Desktop/PS-%2026171/Docs/03_perception_problem.html) | **Neural Vision & DOM Blindspots**: Canvas/PDF blindspots, 8x8 dHash filters, quantized ONNX models |
| **Extension** | [`Docs/05_browser_extension.html`](file:///Users/home/Desktop/PS-%2026171/Docs/05_browser_extension.html) | **Chrome MV3 Deep Dive**: Service Worker, Offscreen Document, Content Script, Side Panel HUD, WebGPU execution |
| **Innovations** | [`Docs/07_reality_check_and_innovations.html`](file:///Users/home/Desktop/PS-%2026171/Docs/07_reality_check_and_innovations.html) | **Architecture Audit**: Latency benchmarks, sustainable ML stack, and 6 core architectural moats |
| **Strategy** | [`Docs/01_master_plan.html`](file:///Users/home/Desktop/PS-%2026171/Docs/01_master_plan.html) | **Master Strategic Blueprint**: Full research, competitive analysis, and sprint roadmap |
| **Presentation** | [`Docs/06_team_presentation.html`](file:///Users/home/Desktop/PS-%2026171/Docs/06_team_presentation.html) | **System Walkthrough & Deck**: User journey, visual matrix, and technical benchmark breakdown |

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
| **Agent Engine** | LangGraph StateGraph Architecture | Deterministic semantic planner + Mistral Large / Gemini VLM fallback |
| **PII & Vault** | Verhoeff & Luhn checksums + Ephemeral Map | Sovereign client-side PII identification and temporary rehydration |
| **OCR Engine** | `PaddleOCR.js` / `PP-OCRv5` | Sub-millisecond on-device character recognition |
| **Vision Model** | `YOLO26n` (ONNX Runtime Web) | Visual privacy-object detection (IDs, signatures, faces, QR codes) |
| **Named Entity** | `BERT-base NER` (Transformers.js) | Contextual text entity extraction (PERSON, LOCATION, ORG) |
| **Compute** | WebGPU + WASM SIMD fallback | Local hardware-accelerated tensor execution |

---

## ⚡ Quick Start

### 1. Load the Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in top-right corner).
3. Click **Load unpacked** and select the [`pratyaksha-extension/`](file:///Users/home/Desktop/PS-%2026171/pratyaksha-extension) folder.
4. Pin the **PRATYAKSHA** extension to your toolbar and click it to open the Side Panel HUD.

### 2. Run the Interactive Testbed
```bash
# Start the local test server for the operations portal demo
npm run demo
```
Open [http://localhost:8080/test-demo.html](http://localhost:8080/test-demo.html) in Chrome and command the agent to test automatic form filling and PII redaction.

### 3. Explore Full Interactive Documentation
```bash
# Serve the complete documentation suite
npm run docs:serve
```
Open [http://localhost:8080/index.html](http://localhost:8080/index.html) in any browser.

---

## 📦 Project Structure

```
.
├── pratyaksha-extension/           # Chrome Manifest V3 Extension
│   ├── manifest.json               # Extension manifest configuration
│   ├── agent/                      # LangGraph StateGraph engine, tools, & planner
│   ├── background/                 # Service worker & tab management
│   ├── content/                    # DOM action dispatcher & highlighter
│   ├── popup/                      # Quick launcher popup
│   ├── sidepanel/                  # Execution cockpit HUD & trace view
│   └── vault/                      # In-memory PII vault & Verhoeff validator
├── demo/                           # Interactive testing testbed
│   └── test-demo.html              # Operations portal test harness
├── Docs/                           # Interactive documentation & architectural specs
│   ├── index.html                  # Master documentation portal
│   ├── 01_master_plan.html ... 08_ml_privacy_module.html
│   └── pdf/                        # Technical system design whitepapers
├── public/                         # Public diagrams & SVGs
├── vercel.json                     # Production deployment routing
└── package.json                    # Workspace scripts
```
