#             cd BigFish
#             $env:USE_TF = "0"
#             python -m ML.tests.test_server

import base64
import io
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from ML.src.server import app

client = TestClient(app)


def _create_synthetic_base64_image() -> str:
    img = Image.new("RGB", (400, 200), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    d.text((20, 20), "BigFish Privacy Verification", fill=(0, 0, 0))
    d.text((20, 60), "Name: Jane Doe", fill=(0, 0, 0))
    d.text((20, 100), "Organization: BigFish AI", fill=(0, 0, 0))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "bigfish-ml"


def test_ready():
    response = client.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"


def test_mask_endpoint():
    b64_img = _create_synthetic_base64_image()
    payload = {
        "requestId": "test-req-server-001",
        "image": f"data:image/png;base64,{b64_img}",
        "dpr": 1.0,
        "viewport": {"width": 400, "height": 200, "scrollX": 0, "scrollY": 0},
    }
    response = client.post("/v1/privacy/mask", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["requestId"] == "test-req-server-001"
    assert data["imageSize"]["width"] == 400
    assert data["imageSize"]["height"] == 200
    assert isinstance(data["regions"], list)
    assert "total_ms" in data["timings"]


def main():
    print("Testing /healthz...")
    test_healthz()
    print("Testing /ready...")
    test_ready()
    print("Testing /v1/privacy/mask...")
    test_mask_endpoint()
    print("\nAll ML Server endpoints verified successfully!")


if __name__ == "__main__":
    main()
