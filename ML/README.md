# 🧩 BigFish ML Privacy Service

> High-throughput on-device perception daemon combining PaddleOCR, BERT-NER, YOLO, and visual screenshot sanitization for zero-trust browser automation.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Status](https://img.shields.io/badge/status-Production--Ready-brightgreen)
![Runtime](https://img.shields.io/badge/runtime-Python%203.12%20%2B%20PyTorch%20%2B%20FastAPI-informational)

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
The **BigFish ML Privacy Service** (`BigFish/ML/`) is a standalone, local perception daemon running on `127.0.0.1:8788`. It intercepts screenshots and page buffers directly on the user's host machine. By synthesizing optical character recognition (PaddleOCR), named-entity recognition (BERT-NER), computer vision object detection (YOLO), and spatial entity resolution, it computes exact pixel bounding boxes for sensitive PII and applies visual redaction *before* any image buffer leaves the local host.

### Why this is its own microservice (not part of a monolith)
- **Bounded context:** Owns heavy neural network weights, GPU/CPU tensor inference, computer vision models, and visual image blackout transformations exclusively.
- **Independent scaling need:** PyTorch, PaddlePaddle, and HuggingFace Transformer model footprints require gigabytes of system memory and specialized native C++/CUDA runtimes that would destabilize the Node.js agent event loop if coupled into a single process.
- **Independent deployability:** Machine learning models, OCR dictionaries, and computer vision weights can be re-trained and updated on independent lifecycles without requiring Node.js service rebuilds.
- **Failure isolation:** If high image resolution or tensor memory spikes cause an Out-Of-Memory condition in the Python runtime, the main agent orchestrator detects the failure via circuit breaker and fails gracefully rather than taking down the entire browser connection.
- **Data isolation strategy:** 100% ephemeral in-memory processing. Images are loaded as transient PIL/NumPy arrays; zero raw screenshots or PII strings are persisted to disk or sent over external networks.

### The "User" of this service

| Caller | Call type | Why it calls this service |
|---|---|---|
| BigFish Chrome Extension Background | Sync HTTP POST (`/v1/privacy/mask`) | `browser_screenshot` sends the captured tab and gets back each private spot's box, category and value. The extension stores the value in its PII vault and paints the token over the box (`apps/extension/entrypoints/background/screenshot.ts`) |
| Tests and developers | Sync HTTP POST (`/v1/privacy/sanitize`) | Blacked-out image made by the daemon itself. No BigFish app calls it; the extension paints vault tokens instead |
| Local Process Health Monitors | Sync HTTP GET (`/healthz`, `/ready`) | Verifies Python daemon liveness and model initialization readiness |

---

## 🚧 Built Features & Current State

### Current state
| Field | Value |
|---|---|
| **Status** | 🟢 Production-Ready Local Daemon / Fully Implemented |
| **Version** | `0.1.0` |
| **Last deployed** | Local Daemon (`127.0.0.1:8788`) |
| **Owner(s)** | BigFish Machine Learning & Privacy Team |
| **Known technical debt** | Custom YOLO weights (`yolo26s.pt`) fall back to standard `yolov8n.pt` when custom UI fine-tuned weights are absent. The user must start the daemon (`pnpm dev:ml`); Chrome does not start it yet (a Native Messaging host could). Span boxes are estimated from character counts inside the OCR line box. |

### Features built (working today)
- `GET /healthz` — Lightweight daemon liveness probe returning service status — ✅ done
- `GET /ready` — Readiness probe verifying PaddleOCR, YOLO, and BERT-NER models are loaded in memory — ✅ done
- `POST /v1/privacy/mask` — End-to-end detection pipeline taking base64 screenshots and returning each private spot's box, normalized `[0..1]` box, category and value. Answers 503 when a model stage failed, so the caller never treats a broken run as "nothing private" — ✅ done
- `Regex PII Worker` — Emails, phones, PAN, SSN, Aadhaar (Verhoeff) and cards (Luhn) on each OCR line, same patterns as `apps/extension/safety/privacy.ts` (`workers/pii_regex.py`) — ✅ done
- `Mask policy` — Only personal data is masked: PERSON (NER names and YOLO people in photos), EMAIL, PHONE, ADDRESS, AADHAAR, PAN, CREDIT_CARD, SSN, PASSWORD and other IDs. Plain OCR text, organizations, places and URLs stay readable — ✅ done
- `POST /v1/privacy/sanitize` — End-to-end visual image redaction applying solid blackout rectangles over sensitive entities, in memory only (nothing is written to disk) — ✅ done
- `PaddleOCR Worker` — PP-OCRv5/v4 neural text detection and recognition on raw image buffers — ✅ done
- `BERT-NER Worker` — Hugging Face `dslim/bert-base-NER` transformer token classification identifying `PER`, `LOC`, `ORG`, and `MISC` — ✅ done
- `YOLO CV Worker` — Ultralytics object detection identifying visual UI elements and profile pictures — ✅ done
- `Spatial Entity Resolver` — Character-to-bbox projection, IoU spatial deduplication, and confidence fusion — ✅ done
- `Privacy Engine & Session Salt` — HMAC salt-keyed tokenization and privacy masking plan generator — ✅ done
- `Screenshot Sanitizer` — High-speed PIL ImageDraw blackout box masking with pixel-level verification — ✅ done

### How it was built
- **Language/runtime:** Python `3.12.x` managed via `uv`
- **Framework:** FastAPI `v0.162.0` + Uvicorn `v0.54.0`
- **Design patterns used:**
  - **Worker Pipeline Pattern:** Multi-stage orchestrator decoupling image decoding, OCR text extraction, visual object detection, and NLP token classification.
  - **Spatial Projection:** Projects character-level token offsets from BERT-NER back onto OCR 2D polygon bounding boxes.
  - **Zero-Copy In-Memory Buffers:** Decodes base64 strings directly into NumPy/PIL memory buffers without temporary file I/O during mask generation.
- **Key libraries:** `paddleocr>=3.4.1`, `paddlepaddle>=3.3.1`, `transformers>=5.20.2`, `torch>=2.14.1`, `ultralytics>=8.4.187`, `pillow>=10.4.0`, `fastapi`, `pydantic`

---

## 🏗️ Architecture & Design Patterns

The ML Privacy Daemon executes a 7-stage sequential pipeline:

```
BigFish/ML/
├── src/
│   ├── workers/
│   │   ├── ocr.py                 # PaddleOCR text detection & recognition worker
│   │   ├── ner.py                 # HuggingFace BERT-NER token classification worker
│   │   └── cv.py                  # Ultralytics YOLO computer vision object detector
│   ├── privacy/
│   │   ├── entity_resolver.py     # Spatial IoU clustering & character-to-box projection
│   │   ├── privacy_engine.py      # Masking plan generator & entity category rules
│   │   ├── session_manager.py     # HMAC salt generation & pseudonym persistence
│   │   └── screenshot_sanitizer.py# PIL visual blackout masking engine
│   ├── pipeline.py                # DetectionPipeline orchestrator
│   ├── schema.py                  # Detection data models
│   └── server.py                  # FastAPI HTTP daemon exposing REST endpoints
├── tests/
│   ├── test_e2e_full.py           # Live network daemon E2E test with pixel validation
│   ├── test_entity_resolver.py    # EntityResolver unit tests
│   ├── test_privacy_engine.py     # PrivacyEngine plan generation tests
│   ├── test_privacy_integration.py# Full pipeline integration tests
│   ├── test_screenshot_sanitizer.py # Visual sanitizer tests
│   └── test_server.py             # FastAPI TestClient contract tests
├── pyproject.toml                 # uv package configuration
└── uv.lock                        # Locked dependencies
```

---

## ⚙️ Usage & Setup

### Environment variables

| Key | Required | Description | Example (fake) |
|---|---|---|---|
| `BIGFISH_ML_PORT` | ❌ | Port the HTTP daemon listens on (defaults to 8788) | `8788` |
| `BIGFISH_ML_HOST` | ❌ | Bind interface (defaults to 127.0.0.1 for local isolation) | `127.0.0.1` |
| `BIGFISH_ML_WARMUP` | ❌ | `0` skips loading the models at startup (they load on the first request) | `1` |
| `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK` | ❌ | Disables slow model hoster connectivity checks on startup | `True` |

### Run Locally

Run from `BigFish/` repository root:

```bash
# Using root pnpm script
pnpm dev:ml

# Or using uv directly
# (--project keeps the repo root as the working folder, so `ML.src` imports)
uv --project ML run python -m ML.src.server

# Or using uvicorn directly (Windows PowerShell path shown; on macOS/Linux use ML/.venv/bin/uvicorn)
& "ML\.venv\Scripts\uvicorn.exe" ML.src.server:app --host 127.0.0.1 --port 8788 --reload

# Run comprehensive end-to-end network test
uv --project ML run python ML/tests/test_e2e_full.py

# Run complete pytest test suite (test_pii_masking.py needs no model weights)
uv --project ML run pytest ML/tests -v

# Extension e2e with this daemon: capture, mask, then OCR the result again
BIGFISH_E2E_ML=1 pnpm --filter @bigfish/extension exec playwright test e2e/screenshot.spec.ts
```

---

## 📡 Communication & Contracts

### Inbound Endpoints
- `GET /healthz` — Returns `{ "status": "ok", "service": "bigfish-ml", "time": 1792890870.74 }`
- `GET /ready` — Returns `{ "status": "ready", "models_loaded": ["paddleocr", "yolov8", "bert_base_ner"] }`. Models load in the background at startup (`BIGFISH_ML_WARMUP=0` turns that off); until then it answers 503
- `POST /v1/privacy/mask` — Body: `{ image: "data:image/png;base64,...", dpr: 1.0, viewport: {...} }`
  - Returns `{ regions: [{ id, category, confidence, box: [x1, y1, x2, y2], normalizedBox: { x, y, width, height }, text, sources }], readyForRelease, ... }`
  - `text` is the value under the box (null for a person in a photo). It only goes to the local caller, which keeps it in the PII vault. `readyForRelease: false` means something private could not be located; the extension then sends no image
- `POST /v1/privacy/sanitize` — Body: `{ image: "data:image/png;base64,...", plan?: {...} }`
  - Returns sanitized image: `{ sanitizedImage: "data:image/png;base64,...", maskCount: 15, maskedEntityIds: [...] }`

---

## 🛡️ Production Readiness

- **Health & Readiness Probes:** Provides both `/healthz` (liveness) and `/ready` (weights loaded) endpoints.
- **Pixel-Level Redaction Verification:** Validated via automated tests asserting that coordinates marked as sensitive have exact RGB `(0, 0, 0)` blackout values while surrounding layout context remains unmodified RGB `(255, 255, 255)`.
- **Local Loopback Security:** Binds strictly to `127.0.0.1`, preventing external network access to memory buffers.
- **CORS:** Only `chrome-extension://` origins and localhost pages may call the daemon, so a website the user visits cannot send it screenshots or read its answers.

---

## 📜 Changelog & Migration State

- **v0.1.0:** Complete implementation and verification of PaddleOCR, BERT-NER, YOLO, EntityResolver, ScreenshotSanitizer, and FastAPI daemon.
