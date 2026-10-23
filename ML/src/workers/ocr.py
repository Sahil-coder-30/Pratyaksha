#How to run : Open new terminal
#             cd Pratyaksha 
#             $env:USE_TF = "0"
#             python -m ML.src.workers.ocr

from pathlib import Path

import numpy as np
from PIL import Image
from paddleocr import PaddleOCR

from ML.src.schema import Detection


class OCRDetector:
    def __init__(self, lang: str = "en"):
        self.ocr = PaddleOCR(
            lang=lang,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False, 
            enable_mkldnn=False,
        )

    @staticmethod
    def _load_image(image) -> np.ndarray:
        """Load an image path or PIL image into an RGB NumPy array."""
        if isinstance(image, (str, Path)):
            image = Image.open(image)

        if isinstance(image, Image.Image):
            image = image.convert("RGB")
            return np.asarray(image)

        if isinstance(image, np.ndarray):
            return image

        raise TypeError("Expected an image path, PIL image, or NumPy array.")

    @staticmethod
    def _bbox_from_polygon(points) -> list[float] | None:
        if points is None:
            return None

        points = np.asarray(points, dtype=float)

        if points.size < 4 or points.shape[-1] != 2:
            return None

        points = points.reshape(-1, 2)

        return [
            float(points[:, 0].min()),
            float(points[:, 1].min()),
            float(points[:, 0].max()),
            float(points[:, 1].max()),
        ]

    def _parse_new_result(self, result) -> list[Detection]:
        detections = []

        for page in result:
            data = getattr(page, "json", None)

            if callable(data):
                data = data()

            if not isinstance(data, dict):
                continue

            # PaddleOCR 3.x commonly nests fields under "res".
            data = data.get("res", data)

            texts = data.get("rec_texts", [])
            scores = data.get("rec_scores", [])
            polygons = data.get("rec_polys", [])

            for index, text in enumerate(texts):
                score = (
                    float(scores[index])
                    if index < len(scores)
                    else 0.0
                )

                polygon = (
                    polygons[index]
                    if index < len(polygons)
                    else None
                )

                detections.append(
                    Detection(
                        type="TEXT",
                        source="OCR",
                        confidence=score,
                        bbox=self._bbox_from_polygon(polygon),
                        text=str(text),
                    )
                )

        return detections

    def _parse_old_result(self, result) -> list[Detection]:
        detections = []

        # PaddleOCR 2.x often returns:
        # [[polygon, (recognized_text, confidence)], ...]
        if not result:
            return detections

        pages = result if isinstance(result, list) else [result]

        for page in pages:
            if not page:
                continue

            for item in page:
                try:
                    polygon, recognition = item
                    text, score = recognition

                    detections.append(
                        Detection(
                            type="TEXT",
                            source="OCR",
                            confidence=float(score),
                            bbox=self._bbox_from_polygon(polygon),
                            text=str(text),
                        )
                    )
                except (TypeError, ValueError):
                    continue

        return detections

    def detect(self, image) -> list[Detection]:
        array = self._load_image(image)

        # Prefer the PaddleOCR 3.x interface.
        if hasattr(self.ocr, "predict"):
            result = self.ocr.predict(array)
            return self._parse_new_result(result)

        # Compatibility path for older PaddleOCR versions.
        result = self.ocr.ocr(array, cls=True)
        return self._parse_old_result(result)


if __name__ == "__main__":
    detector = OCRDetector()
    detections = detector.detect("My Laptop Bill.jpg")

    for detection in detections:
        print(detection.to_dict())
