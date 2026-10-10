# PRATYAKSHA (प्रत्यक्ष)
## Sovereign On-Device Visual Perception & Privacy Shield for Light-Weight Browser Agents

**Codename**: PRATYAKSHA (प्रत्यक्ष)  
*Privacy-preserving Real-time Agentic Tokenizer & Vision-Augmented Knowledge Shield for Autonomous Workflows*  

---

## 📂 Documentation Suite (Organized by Architectural Track)

### Track 1 · Strategy & Architecture
| Module | Document | Scope & Focus |
|:---:|:---|:---|
| **HUB** | [`index.html`](./index.html) | **Master Documentation Hub**: Unified executive dashboard, visual comparison diagrams, interactive system topology |
| **DOC** | [`readme.html`](./readme.html) | **Interactive Project Brief**: Live web version of this README with rubric gauges and architecture flows |
| **06** | [`06_team_presentation.html`](./06_team_presentation.html) | **Presentation & Benchmarks**: Visual showdown matrix, user journey, and technical breakdown |
| **01** | [`01_master_plan.html`](./01_master_plan.html) | **Master Strategic Blueprint**: Research, competitive matrix, and architectural roadmap |

### Track 2 · System Architecture & Reality Audits
| Module | Document | Scope & Focus |
|:---:|:---|:---|
| **04** | [`04_hld.html`](./04_hld.html) | **High-Level Design (HLD)**: 8 microservices inventory, API contracts, WebSocket protocol, and ADRs |
| **07** | [`07_reality_check_and_innovations.html`](./07_reality_check_and_innovations.html) | **Architecture Audit & Innovations**: Benchmarks, sustainable ML stack, and 6 defensible moats |

### Track 3 · Deep-Dive Engineering Modules
| Module | Document | Scope & Focus |
|:---:|:---|:---|
| **08** | [`08_ml_privacy_module.html`](./08_ml_privacy_module.html) | **⭐ ML & Privacy Module**: Local privacy firewall, YOLO26n ONNX, PaddleOCR.js, BERT NER, and Entity Resolver |
| **03** | [`03_perception_problem.html`](./03_perception_problem.html) | **Neural Vision & Perception Blindspots**: 7 DOM blindspots (PDFs, canvas), 8×8 dHash filters, quantized ONNX models |
| **05** | [`05_browser_extension.html`](./05_browser_extension.html) | **Chrome MV3 Extension Deep Dive**: Service Worker, Offscreen Document, Content Script, Side Panel HUD, WebGPU execution |
| **02** | [`02_browser_agent.html`](./02_browser_agent.html) | **Browser Agent & Action Dispatcher**: Perception-action loop, 10 synthetic DOM actions, local rehydration vault |

---

## 🧭 System Concept

PRATYAKSHA provides a **privacy-preserving vision agent** running in the browser:

> *Sensitive/PII data must be sanitized **on-device before** any network request is made. Only anonymized, unidentifiable data is transmitted to the central AI reasoning engine.*

The server VLM then processes the sanitized context and returns **actionable commands** (click, type, scroll) that the browser agent executes.

---

## 🏗️ System Architecture (Local Privacy Firewall)

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
SERVER AI AGENT (Intranet / Cloud VLM)
└── Reasons over [PERSON_A71C], element roles, and masked screenshot → returns action JSON (CLICK, TYPE, SCROLL)
```

---

## 🚀 Core Innovations

1. **Reversible Pseudonymization Vault** — Replaces PII with semantic tokens (`[PERSON_A71C]`, `[AADHAAR_9F12]`). Server plans using tokens; client rehydrates locally. Real values never leave the device.
2. **Fail-Closed Multi-Modal Fusion** — DOM structural analysis + PaddleOCR + YOLO26n visual detection + BERT-base NER fused via geometric IoU overlap.
3. **Deterministic Checksum Stack** — Verhoeff checksum (Aadhaar), PAN modulo validators, IFSC registry. Zero false positives through algorithmic certainty.
4. **Final Privacy Gate & Egress Audit** — Fail-closed verification barrier: regex scan of serialized JSON + canvas pixel confirmation + post-redaction OCR verification.
5. **Non-Blocking Web Worker Isolation** — Offloads all heavy ML inference (YOLO26n, PaddleOCR, BERT) to dedicated Web Workers with WebGPU/WASM to keep host DOM at 60 FPS.
6. **10-Step Operational Execution Loop** — `OBSERVE` → `DETECT` → `FUSE` → `IDENTIFY` → `PROTECT` → `VERIFY` → `SEND` → `REASON` → `ACT` → `OBSERVE AGAIN`.
