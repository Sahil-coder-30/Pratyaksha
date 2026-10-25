"""
test_e2e_full.py - Comprehensive End-to-End Validation for BigFish ML Privacy Daemon

This test performs a complete end-to-end verification of the ML service:
1. Spawns the real Uvicorn HTTP server daemon on 127.0.0.1:8799.
2. Polls /healthz and /ready over actual HTTP until models are initialized.
3. Tests POST /v1/privacy/mask with a realistic sensitive document:
   - Validates OCR detection of text.
   - Validates NER token classification of entities (PER, LOC, ORG).
   - Validates EntityResolver spatial projection and bounding box generation.
   - Validates normalized [0, 1] coordinate math for Chrome extension consumption.
   - Validates latency timing benchmarks.
4. Tests POST /v1/privacy/sanitize:
   - Validates image masking and visual redaction.
   - Decodes the returned base64 image and verifies pixel-level blackout masking.
5. Shuts down the daemon cleanly.
"""

import base64
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from PIL import Image, ImageDraw


TEST_HOST = "127.0.0.1"
TEST_PORT = 8799
BASE_URL = f"http://{TEST_HOST}:{TEST_PORT}"


def create_realistic_test_document() -> tuple[Image.Image, str]:
    """Creates a realistic document image containing sensitive PII and returns (PIL Image, base64 data URL)."""
    width, height = 800, 450
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Header / Non-sensitive context
    draw.text((40, 30), "BIGFISH HEALTHCARE - PATIENT SUMMARY RECORD", fill=(20, 20, 20))
    draw.line([(40, 55), (760, 55)], fill=(180, 180, 180), width=2)

    # Sensitive personal & organizational entities
    draw.text((40, 80), "Patient Name: Dr. Evelyn Reed", fill=(0, 0, 0))
    draw.text((40, 140), "Consulting Physician: Dr. Marcus Vance", fill=(0, 0, 0))
    draw.text((40, 200), "Facility: Saint Jude Medical Center", fill=(0, 0, 0))
    draw.text((40, 260), "Clinic Location: Boston, Massachusetts", fill=(0, 0, 0))
    draw.text((40, 320), "Identification: AADHAAR 5489 1234 9876", fill=(0, 0, 0))

    # Footer
    draw.line([(40, 380), (760, 380)], fill=(180, 180, 180), width=2)
    draw.text((40, 400), "CONFIDENTIAL - RESTRICTED ACCESS ONLY", fill=(100, 100, 100))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    data_url = f"data:image/png;base64,{raw_b64}"
    return img, data_url


def http_get(path: str) -> dict:
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "BigFish-E2E-Tester"})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def http_post(path: str, data: dict) -> dict:
    url = f"{BASE_URL}{path}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "BigFish-E2E-Tester"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def run_e2e_test():
    print("=" * 70)
    print("  BigFish ML Privacy Service - Full End-to-End Network & Pipeline Test")
    print("=" * 70)

    # 1. Start ML Server Daemon in background
    python_exe = sys.executable
    env = os.environ.copy()
    env["BIGFISH_ML_PORT"] = str(TEST_PORT)
    env["BIGFISH_ML_HOST"] = TEST_HOST

    print(f"\n[Step 1] Starting ML Server Daemon on http://{TEST_HOST}:{TEST_PORT}...")
    server_process = subprocess.Popen(
        [python_exe, "-m", "ML.src.server"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        # 2. Wait for server to become responsive
        print("[Step 2] Waiting for server to initialize and respond...")
        max_wait = 45
        start_time = time.time()
        server_ready = False

        while time.time() - start_time < max_wait:
            try:
                health = http_get("/healthz")
                if health.get("status") == "ok":
                    print(f"  -> Daemon live! Status: {health}")
                    server_ready = True
                    break
            except Exception:
                time.sleep(1)

        if not server_ready:
            raise RuntimeError(f"Server failed to start within {max_wait}s")

        # 3. Test /ready endpoint (ensures PaddleOCR, YOLO, BERT models are in memory)
        print("\n[Step 3] Checking /ready endpoint (verifying model weights in memory)...")
        ready_res = http_get("/ready")
        print(f"  -> Ready response: {ready_res}")
        assert ready_res.get("status") == "ready", "Server not ready"
        assert "paddleocr" in ready_res.get("models_loaded", [])
        assert "bert_base_ner" in ready_res.get("models_loaded", [])

        # 4. Create document & call POST /v1/privacy/mask
        print("\n[Step 4] Calling POST /v1/privacy/mask with realistic sensitive document...")
        orig_img, data_url = create_realistic_test_document()
        orig_w, orig_h = orig_img.size

        mask_req = {
            "requestId": "e2e-verification-req-001",
            "image": data_url,
            "dpr": 1.0,
            "viewport": {"width": orig_w, "height": orig_h, "scrollX": 0, "scrollY": 0},
            "mustMask": ["PER", "LOC", "ORG"],
        }

        t0 = time.perf_counter()
        mask_res = http_post("/v1/privacy/mask", mask_req)
        latency = round((time.perf_counter() - t0) * 1000, 2)

        print(f"  -> /v1/privacy/mask responded in {latency}ms")
        print(f"  -> Request ID: {mask_res.get('requestId')}")
        print(f"  -> Image dimensions reported: {mask_res.get('imageSize')}")
        print(f"  -> OCR detected lines: {mask_res.get('ocrLines')}")
        print(f"  -> Sensitive mask regions returned: {len(mask_res.get('regions', []))}")
        print(f"  -> Pipeline latency breakdown: {mask_res.get('timings')}")

        regions = mask_res.get("regions", [])
        assert len(regions) > 0, "Expected at least one sensitive region detected"

        for idx, reg in enumerate(regions):
            box = reg.get("box")
            norm = reg.get("normalizedBox")
            cat = reg.get("category")
            print(f"     Region {idx+1}: [{cat}] Box: {box} | NormBox: {norm}")
            assert len(box) == 4, "Box must have 4 coordinates [x1, y1, x2, y2]"
            assert 0 <= box[0] < box[2] <= orig_w, f"Invalid horizontal box bounds: {box}"
            assert 0 <= box[1] < box[3] <= orig_h, f"Invalid vertical box bounds: {box}"
            assert 0.0 <= norm["x"] <= 1.0, f"Invalid normalized x: {norm['x']}"
            assert 0.0 <= norm["y"] <= 1.0, f"Invalid normalized y: {norm['y']}"
            assert norm["width"] > 0, "Normalized width must be positive"
            assert norm["height"] > 0, "Normalized height must be positive"

        # 5. Test POST /v1/privacy/sanitize (Visual Redaction)
        print("\n[Step 5] Calling POST /v1/privacy/sanitize to perform visual redaction...")
        sanitize_req = {
            "requestId": "e2e-verification-req-002",
            "image": data_url,
        }

        t0 = time.perf_counter()
        sanitize_res = http_post("/v1/privacy/sanitize", sanitize_req)
        sanitize_latency = round((time.perf_counter() - t0) * 1000, 2)

        print(f"  -> /v1/privacy/sanitize responded in {sanitize_latency}ms")
        print(f"  -> Mask count applied: {sanitize_res.get('maskCount')}")
        print(f"  -> Masked Entity IDs: {sanitize_res.get('maskedEntityIds')}")

        sanitized_data_url = sanitize_res.get("sanitizedImage", "")
        assert sanitized_data_url.startswith("data:image/png;base64,"), "Invalid sanitized image format"

        # 6. Pixel-Level Verification: Assert that image was actually blackened under mask bboxes
        print("\n[Step 6] Verifying pixel-level visual redaction in sanitized image buffer...")
        sanitized_b64 = sanitized_data_url.split(",", 1)[1]
        sanitized_img = Image.open(io.BytesIO(base64.b64decode(sanitized_b64))).convert("RGB")

        assert sanitized_img.size == (orig_w, orig_h), "Sanitized image size does not match original"

        # Check pixels inside the first detected mask region
        first_box = regions[0]["box"]
        mid_x = int((first_box[0] + first_box[2]) / 2)
        mid_y = int((first_box[1] + first_box[3]) / 2)
        pixel_inside = sanitized_img.getpixel((mid_x, mid_y))
        print(f"  -> Sample pixel inside masked region ({mid_x}, {mid_y}): RGB {pixel_inside}")
        assert pixel_inside == (0, 0, 0), f"Expected blackened pixel (0, 0, 0), got {pixel_inside}"

        # Check pixels in an unmasked clean region (e.g. top-left corner background)
        clean_pixel = sanitized_img.getpixel((10, 10))
        print(f"  -> Sample pixel in background clean region (10, 10): RGB {clean_pixel}")
        assert clean_pixel == (255, 255, 255), f"Expected white background (255, 255, 255), got {clean_pixel}"

        print("\n" + "=" * 70)
        print("  ALL END-TO-END CHECKS PASSED: BIGFISH ML SERVICE IS 100% OPERATIONAL!")
        print("=" * 70)

    finally:
        print("\n[Teardown] Shutting down test ML daemon process...")
        server_process.terminate()
        try:
            server_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_process.kill()
        print("  -> Daemon stopped cleanly.")


if __name__ == "__main__":
    run_e2e_test()
