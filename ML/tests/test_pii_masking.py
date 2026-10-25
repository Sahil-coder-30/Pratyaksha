#             cd BigFish
#             uv --project ML run pytest ML/tests/test_pii_masking.py -v

"""
Masking policy tests that need no model weights: OCR, NER and YOLO are
replaced with fixed fakes, the rest of the pipeline is real.
Synthetic values only. Do not use real ID data in tests.
"""

import base64
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from ML.src import server
from ML.src.pipeline import DetectionPipeline
from ML.src.privacy.entity_resolver import EntityResolver
from ML.src.privacy.privacy_engine import PrivacyEngine
from ML.src.privacy.screenshot_sanitizer import ScreenshotSanitizer
from ML.src.privacy.session_manager import SessionManager
from ML.src.workers.pii_regex import PIIRegexDetector

# Verhoeff-valid and Luhn-valid synthetic numbers.
AADHAAR = "2345 6789 0124"
CARD = "4111 1111 1111 1111"

LINES = [
    ("Contact us", [10, 10, 110, 30]),
    ("Email: priya@example.test", [10, 50, 260, 70]),
    ("Name: Jane Doe", [10, 90, 150, 110]),
    ("Works at Acme Corp", [10, 130, 190, 150]),
    (f"Aadhaar {AADHAAR}", [10, 170, 230, 190]),
    ("Open https://docs.google.com/forms/d/abc/viewform", [10, 210, 400, 230]),
]


def fake_ocr(_image):
    return [{"type": "TEXT", "confidence": 0.99, "bbox": box, "text": text} for text, box in LINES]


def fake_ner(text):
    found = []
    for word, label in (("Jane Doe", "PER"), ("Acme Corp", "ORG")):
        start = text.find(word)
        if start >= 0:
            found.append({
                "type": label,
                "confidence": 0.98,
                "text": word,
                "text_span": {"start": start, "end": start + len(word)},
            })
    return found


def fake_cv(_image):
    return [
        {"type": "PERSON", "confidence": 0.9, "bbox": [300, 10, 380, 90]},
        {"type": "LAPTOP", "confidence": 0.9, "bbox": [300, 100, 380, 160]},
    ]


def broken(_data):
    raise RuntimeError("model crashed")


def make_pipeline(ocr=fake_ocr, ner=fake_ner, cv=fake_cv):
    return DetectionPipeline(ocr_detector=ocr, cv_detector=cv, ner_detector=ner, strict=False)


def run_plan(pipeline):
    resolved = EntityResolver().resolve(pipeline.run(Image.new("RGB", (420, 240), "white")))
    return resolved, PrivacyEngine(session_manager=SessionManager()).build_plan(resolved)


def masked_texts(resolved, plan):
    by_id = {e["entity_id"]: e for e in resolved["entities"]}
    return {
        (r["category"], by_id[r["resolver_entity_id"]].get("text"))
        for r in plan["mask_regions"]
    }


# ---- regex worker -------------------------------------------------------------------


def test_regex_finds_fixed_format_pii():
    text = f"priya@example.test, +91 98765 43210, ABCDE1234F, {AADHAAR}, {CARD}, 123-45-6789"
    found = {(d.type, d.text) for d in PIIRegexDetector().detect(text)}
    assert ("EMAIL", "priya@example.test") in found
    assert ("PHONE", "+91 98765 43210") in found
    assert ("PAN", "ABCDE1234F") in found
    assert ("AADHAAR", AADHAAR) in found
    assert ("CREDIT_CARD", CARD) in found
    assert ("SSN", "123-45-6789") in found


def test_regex_skips_bad_checksums_and_urls():
    text = "2345 6789 0123 4111 1111 1111 1112 https://site.test/u/9876543210"
    assert PIIRegexDetector().detect(text) == []


# ---- masking policy -----------------------------------------------------------------


def test_only_personal_data_is_masked():
    resolved, plan = run_plan(make_pipeline())
    masked = masked_texts(resolved, plan)

    assert ("EMAIL", "priya@example.test") in masked
    assert ("PERSON", "Jane Doe") in masked
    assert ("AADHAAR", AADHAAR) in masked
    # A person in a photo, found by YOLO, has no text.
    assert ("PERSON", None) in masked

    texts = {text for _, text in masked}
    assert "Contact us" not in texts
    assert "Acme Corp" not in texts
    assert not any(text and "docs.google.com" in text for text in texts)
    assert not any(category == "LAPTOP" for category, _ in masked)
    assert plan["ready_for_release"] is True


def test_span_masks_only_its_part_of_the_line():
    resolved, plan = run_plan(make_pipeline())
    by_id = {e["entity_id"]: e for e in resolved["entities"]}
    email = next(
        r for r in plan["mask_regions"]
        if by_id[r["resolver_entity_id"]].get("text") == "priya@example.test"
    )
    x1, y1, x2, y2 = email["bbox"]
    line = LINES[1][1]
    # "Email: " is left visible, the box stays on the line.
    assert x1 > line[0] + 20
    assert x2 <= line[2]
    assert (y1, y2) == (line[1], line[3])


def test_plan_holds_no_raw_text():
    _, plan = run_plan(make_pipeline())
    assert "priya@example.test" not in repr(plan)
    assert "Jane Doe" not in repr(plan)


# ---- HTTP daemon --------------------------------------------------------------------


def image_payload():
    buf = io.BytesIO()
    Image.new("RGB", (420, 240), "white").save(buf, format="PNG")
    return {"image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}


@pytest.fixture
def client(monkeypatch):
    def install(pipeline):
        monkeypatch.setattr(server, "_pipeline", pipeline)
        monkeypatch.setattr(server, "_resolver", EntityResolver())
        monkeypatch.setattr(server, "_privacy_engine", PrivacyEngine(session_manager=SessionManager()))
        monkeypatch.setattr(server, "_sanitizer", ScreenshotSanitizer())
        return TestClient(server.app)

    return install


def test_mask_returns_text_and_category_for_the_vault(client):
    res = client(make_pipeline()).post("/v1/privacy/mask", json=image_payload())
    assert res.status_code == 200
    regions = res.json()["regions"]
    found = {(r["category"], r["text"]) for r in regions}
    assert ("EMAIL", "priya@example.test") in found
    assert ("PERSON", "Jane Doe") in found
    photo = next(r for r in regions if r["text"] is None)
    assert photo["sources"] == ["cv"]


def test_mask_fails_closed_when_a_stage_breaks(client):
    res = client(make_pipeline(ner=broken)).post("/v1/privacy/mask", json=image_payload())
    assert res.status_code == 503
    assert "ner" in res.json()["detail"]


def test_sanitize_writes_nothing_to_disk(client, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    res = client(make_pipeline()).post("/v1/privacy/sanitize", json=image_payload())
    assert res.status_code == 200
    assert res.json()["maskCount"] > 0
    assert list(Path(tmp_path).iterdir()) == []


def test_cors_allows_only_extension_and_localhost(client):
    http = client(make_pipeline())
    ext = "chrome-extension://" + "a" * 32
    assert http.get("/healthz", headers={"Origin": ext}).headers.get("access-control-allow-origin") == ext
    assert "access-control-allow-origin" not in http.get("/healthz", headers={"Origin": "https://evil.test"}).headers
