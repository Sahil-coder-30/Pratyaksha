"""
server.py - BigFish ML Privacy HTTP Daemon

Provides local API endpoints for:
  - /healthz (Liveness check)
  - /ready (Readiness probe verifying ML pipeline initialization)
  - /v1/privacy/mask (Detect sensitive PII / entities and return mask coordinates)
  - /v1/privacy/sanitize (End-to-end detection and visual canvas/image masking)

Run with:
  cd BigFish
  python -m ML.src.server
Or:
  uvicorn ML.src.server:app --host 127.0.0.1 --port 8788
"""

import base64
import io
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image

import sys
import threading
from contextlib import asynccontextmanager

# The ML package is imported as ML.src.*, so the repo root must be importable
# (e.g. under `uvicorn ML.src.server:app` started from another folder).
_repo_dir = Path(__file__).resolve().parents[2]
if str(_repo_dir) not in sys.path:
    sys.path.insert(0, str(_repo_dir))

from ML.src.pipeline import DetectionPipeline
from ML.src.workers.ocr import OCRDetector
from ML.src.workers.cv import CVDetector
from ML.src.workers.ner import NERDetector
from ML.src.privacy.entity_resolver import EntityResolver
from ML.src.privacy.privacy_engine import PrivacyEngine
from ML.src.privacy.session_manager import SessionManager
from ML.src.privacy.screenshot_sanitizer import ScreenshotSanitizer

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("BigFish.ML.Server")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load the models in the background, so /healthz answers at once and the
    # first screenshot does not wait for model load.
    if os.environ.get("BIGFISH_ML_WARMUP", "1") != "0":
        threading.Thread(target=_warm_up, name="bigfish-ml-warmup", daemon=True).start()
    yield


app = FastAPI(
    title="BigFish ML Privacy Service",
    version="0.1.0",
    description="Local computer vision & NLP privacy pipeline for autonomous browser screenshot masking",
    lifespan=lifespan,
)

# Only the BigFish extension and local tools may call the daemon. A website the
# user visits must not be able to send it screenshots or read its answers.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|http://(127\.0\.0\.1|localhost)(:\d+)?)$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Global lazy-initialized pipeline components
_pipeline: Optional[DetectionPipeline] = None
_resolver: Optional[EntityResolver] = None
_privacy_engine: Optional[PrivacyEngine] = None
_sanitizer: Optional[ScreenshotSanitizer] = None
# Model loading happens once, even when warm-up and a request race.
_init_lock = threading.Lock()
# The OCR and NER models are not safe to call from several threads at once.
_inference_lock = threading.Lock()


def _warm_up() -> None:
    try:
        get_pipeline()
    except Exception as e:
        logger.error(f"Model warm-up failed: {e}")


def get_pipeline() -> tuple[DetectionPipeline, EntityResolver, PrivacyEngine, ScreenshotSanitizer]:
    with _init_lock:
        return _get_pipeline_locked()


def _get_pipeline_locked() -> tuple[DetectionPipeline, EntityResolver, PrivacyEngine, ScreenshotSanitizer]:
    global _pipeline, _resolver, _privacy_engine, _sanitizer
    if _pipeline is None or _resolver is None or _privacy_engine is None or _sanitizer is None:
        logger.info("Initializing BigFish ML Pipeline (OCR, CV, NER)...")
        ocr = OCRDetector()
        cv = CVDetector()
        ner = NERDetector()
        _pipeline = DetectionPipeline(
            ocr_detector=ocr,
            cv_detector=cv,
            ner_detector=ner,
            # A failed stage is recorded, and /mask then refuses to answer.
            strict=False,
        )
        _resolver = EntityResolver(
            iou_threshold=0.40,
            span_overlap_threshold=0.40,
        )
        _privacy_engine = PrivacyEngine(session_manager=SessionManager())
        _sanitizer = ScreenshotSanitizer()
        logger.info("BigFish ML Pipeline successfully initialized.")

    assert _pipeline is not None
    assert _resolver is not None
    assert _privacy_engine is not None
    assert _sanitizer is not None
    return _pipeline, _resolver, _privacy_engine, _sanitizer


# -----------------------------------------------------------------------------
# Data Contracts (Pydantic Models)
# -----------------------------------------------------------------------------

class ViewportInfo(BaseModel):
    width: int = Field(default=1280)
    height: int = Field(default=720)
    scrollX: int = Field(default=0)
    scrollY: int = Field(default=0)


class MaskRequest(BaseModel):
    requestId: Optional[str] = Field(default_factory=lambda: f"bf-req-{uuid4().hex[:12]}")
    image: str = Field(description="Base64 encoded image string or data URL (PNG/JPEG/WebP)")
    dpr: float = Field(default=1.0, description="Device Pixel Ratio")
    viewport: Optional[ViewportInfo] = None
    mustMask: Optional[list[str]] = Field(default_factory=list)
    knownValues: Optional[list[str]] = Field(default_factory=list)


class MaskRegion(BaseModel):
    id: str
    category: str
    confidence: float
    source: str
    box: list[float] = Field(description="[x1, y1, x2, y2] absolute pixel coordinates")
    normalizedBox: Optional[dict[str, float]] = None
    # The value under the box, so the caller can store it in its vault and
    # draw a placeholder. Only ever sent to the local caller. None for regions
    # without text, like a person in a photo.
    text: Optional[str] = None
    sources: list[str] = Field(default_factory=list)


class MaskResponse(BaseModel):
    requestId: str
    imageSize: dict[str, int]
    regions: list[MaskRegion]
    ocrLines: int
    unlocalizedCount: int
    readyForSanitization: bool
    readyForRelease: bool
    requiresHumanReview: bool
    timings: dict[str, float]


class SanitizeRequest(BaseModel):
    requestId: Optional[str] = Field(default_factory=lambda: f"bf-req-{uuid4().hex[:12]}")
    image: str = Field(description="Base64 image string")
    plan: Optional[dict[str, Any]] = None


class SanitizeResponse(BaseModel):
    requestId: str
    sanitizedImage: str = Field(description="Base64 encoded masked PNG image")
    imageWidth: int
    imageHeight: int
    maskCount: int
    maskedEntityIds: list[str]


# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------

@app.get("/healthz")
def healthz():
    """Liveness probe confirming daemon responsiveness."""
    return {
        "status": "ok",
        "service": "bigfish-ml",
        "time": time.time(),
    }


@app.get("/ready")
def ready():
    """Readiness probe confirming ML models are initialized in memory."""
    # Answer at once while warm-up holds the lock, instead of hanging the caller.
    if _pipeline is None and _init_lock.locked():
        raise HTTPException(status_code=503, detail="Models are still loading")
    try:
        get_pipeline()
        return {
            "status": "ready",
            "models_loaded": ["paddleocr", "yolov8", "bert_base_ner"],
        }
    except Exception as e:
        logger.error(f"Readiness check failed: {e}")
        raise HTTPException(status_code=503, detail=f"Models not ready: {str(e)}")


def _detect(pipeline: DetectionPipeline, resolver: EntityResolver, engine: PrivacyEngine, image: Image.Image):
    """Run detection, resolution and planning. Fails closed on a broken stage."""
    with _inference_lock:
        pipeline_result = pipeline.run(image)
    t_detect = time.perf_counter()

    if pipeline_result.get("stage_errors"):
        # An empty result from a failed stage is not proof the image is safe.
        failed = ", ".join(sorted(pipeline_result["stage_errors"]))
        logger.error(f"Detection stage failed: {failed}")
        raise HTTPException(status_code=503, detail=f"Detection stage failed: {failed}")

    resolved = resolver.resolve(pipeline_result)
    t_resolve = time.perf_counter()
    plan = engine.build_plan(resolved)
    return pipeline_result, resolved, plan, t_detect, t_resolve


def _decode_image(image_input: str) -> Image.Image:
    """Decodes a base64 string or data URL into a PIL Image."""
    try:
        if "," in image_input:
            image_input = image_input.split(",", 1)[1]
        image_bytes = base64.b64decode(image_input)
        return Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image format: {str(e)}")


@app.post("/v1/privacy/mask", response_model=MaskResponse)
def compute_mask_regions(request: MaskRequest):
    """
    Analyzes an input screenshot, runs OCR, CV, and NER,
    resolves spatial duplicates, and returns bounding box mask regions.
    """
    t_start = time.perf_counter()
    pipeline, resolver, engine, _ = get_pipeline()

    # Decode and save image to a temporary memory buffer
    image = _decode_image(request.image)
    width, height = image.size

    t_decode = time.perf_counter()

    pipeline_result, resolved, plan, t_detect, t_resolve = _detect(pipeline, resolver, engine, image)
    t_plan = time.perf_counter()

    entities = {e.get("entity_id"): e for e in resolved.get("entities", [])}

    # Construct response regions
    regions: list[MaskRegion] = []
    for idx, r in enumerate(plan.get("mask_regions", [])):
        bbox = r.get("bbox", [0, 0, 0, 0])
        # Normalized bounding box
        x1, y1, x2, y2 = bbox
        norm_box = {
            "x": round(x1 / width, 4) if width > 0 else 0.0,
            "y": round(y1 / height, 4) if height > 0 else 0.0,
            "width": round((x2 - x1) / width, 4) if width > 0 else 0.0,
            "height": round((y2 - y1) / height, 4) if height > 0 else 0.0,
        }
        entity = entities.get(r.get("resolver_entity_id"), {})
        text = entity.get("text")
        regions.append(
            MaskRegion(
                id=r.get("entity_id", f"region_{idx:03d}"),
                category=r.get("category", "SENSITIVE"),
                confidence=1.0,
                source="pipeline",
                box=[float(v) for v in bbox],
                normalizedBox=norm_box,
                text=str(text) if text else None,
                sources=list(entity.get("sources", [])),
            )
        )

    ocr_count = len(pipeline_result.get("by_source", {}).get("ocr", []))

    timings = {
        "decode_ms": round((t_decode - t_start) * 1000, 2),
        "detect_ms": round((t_detect - t_decode) * 1000, 2),
        "resolve_ms": round((t_resolve - t_detect) * 1000, 2),
        "plan_ms": round((t_plan - t_resolve) * 1000, 2),
        "total_ms": round((t_plan - t_start) * 1000, 2),
    }

    return MaskResponse(
        requestId=request.requestId or f"bf-req-{uuid4().hex[:12]}",
        imageSize={"width": width, "height": height},
        regions=regions,
        ocrLines=ocr_count,
        unlocalizedCount=len(plan.get("unlocalized_entities", [])),
        readyForSanitization=plan.get("ready_for_sanitization", True),
        readyForRelease=plan.get("ready_for_release", True),
        requiresHumanReview=plan.get("requires_human_review", False),
        timings=timings,
    )


@app.post("/v1/privacy/sanitize", response_model=SanitizeResponse)
def sanitize_screenshot(request: SanitizeRequest):
    """
    Applies visual black-box masks over sensitive regions and returns the sanitized image.
    """
    pipeline, resolver, engine, sanitizer = get_pipeline()

    image = _decode_image(request.image)
    width, height = image.size

    plan = request.plan
    if plan is None:
        # Generate plan automatically if not provided
        _, _, plan, _, _ = _detect(pipeline, resolver, engine, image)

    # In memory only: the screenshot is never written to disk.
    try:
        masked, res = sanitizer.apply(image, plan)
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=422, detail=f"Sanitization refused: {e}")

    buf = io.BytesIO()
    masked.save(buf, format="PNG")
    encoded_out = base64.b64encode(buf.getvalue()).decode("utf-8")

    return SanitizeResponse(
        requestId=request.requestId or f"bf-req-{uuid4().hex[:12]}",
        sanitizedImage=f"data:image/png;base64,{encoded_out}",
        imageWidth=res["image_width"],
        imageHeight=res["image_height"],
        maskCount=res["mask_count"],
        maskedEntityIds=res["masked_entity_ids"],
    )


def main():
    port = int(os.environ.get("BIGFISH_ML_PORT", "8788"))
    host = os.environ.get("BIGFISH_ML_HOST", "127.0.0.1")
    logger.info(f"Starting BigFish ML Privacy Daemon on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
