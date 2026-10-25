#How to run : Open new terminal
#             cd BigFish 
#             $env:USE_TF = "0"
#             python -m ML.src.workers.cv


from pathlib import Path

import numpy as np
from PIL import Image
from ultralytics import YOLO

from ML.src.schema import Detection

DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "yolo26s.pt"


class CVDetector:
    def __init__(
        self,
        model_path: str | Path | None = None,
        confidence_threshold: float = 0.30,
        device: str | None = None,
    ):
        resolved_path = Path(model_path) if model_path else DEFAULT_MODEL_PATH
        if not resolved_path.exists():
            # Fall back to standard lightweight pretrained YOLO if custom weights are not present
            resolved_path = "yolov8n.pt"

        self.model = YOLO(str(resolved_path))
        self.confidence_threshold = confidence_threshold
        self.device = device

    def detect(self, image) -> list[Detection]:
        if isinstance(image, np.ndarray):
            # OpenCV arrays are normally BGR. Convert to RGB.
            image = Image.fromarray(image[..., ::-1])
        elif isinstance(image, (str, Path)):
            image = Image.open(image).convert("RGB")
        elif isinstance(image, Image.Image):
            image = image.convert("RGB")
        else:
            raise TypeError(
                "Expected an image path, PIL image, or NumPy array."
            )

        results = self.model.predict(
            source=image,
            conf=self.confidence_threshold,
            device=self.device,
            verbose=False,
        )

        detections = []

        for result in results:
            boxes = getattr(result, "boxes", None)
            if boxes is None:
                continue

            names = getattr(result, "names", {})
            for box in boxes:
                class_id = int(box.cls.item())
                confidence = float(box.conf.item())
                x1, y1, x2, y2 = (
                    box.xyxy[0].cpu().tolist()
                )

                raw_name = names.get(class_id, "OBJECT") if isinstance(names, dict) else "OBJECT"
                class_name = str(raw_name).upper()

                detections.append(
                    Detection(
                        type=class_name,
                        source="cv",
                        confidence=confidence,
                        bbox=[
                            float(x1),
                            float(y1),
                            float(x2),
                            float(y2),
                        ],
                    )
                )

        return detections


if __name__ == "__main__":
    detector = CVDetector()

    test_img = Path("pfp.jpeg")
    if test_img.exists():
        test_detections = detector.detect(test_img)
        for detection in test_detections:
            print(detection.to_dict())
    else:
        print("CVDetector initialized successfully.")

