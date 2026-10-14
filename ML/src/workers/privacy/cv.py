#How to run : Open new terminal
#             cd Pratyaksha 
#             python -m ML.src.workers.privacy.cv


from pathlib import Path

import numpy as np
from PIL import Image
from ultralytics import YOLO

from ML.src.schema import Detection


class CVDetector:
    def __init__(
        self,
        model_path: str = r"D:\Honey\Fun\Pratyaksh\Pratyaksha\ML\models\yolo26s.pt",
        confidence_threshold: float = 0.30,
        device: str | None = None,
    ):
        if not Path(model_path).exists():
            raise FileNotFoundError(
                f"YOLO weights not found: {model_path}"
            )

        self.model = YOLO(model_path)
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
            if result.boxes is None:
                continue

            for box in result.boxes:
                class_id = int(box.cls.item())
                confidence = float(box.conf.item())
                x1, y1, x2, y2 = (
                    box.xyxy[0].cpu().tolist()
                )

                class_name = result.names[class_id].upper()

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
    detector = CVDetector(
        model_path=r"D:\Honey\Fun\Pratyaksh\Pratyaksha\ML\models\yolo26s.pt"
    )

    detections = detector.detect("pfp.jpeg")

    for detection in detections:
        print(detection.to_dict())
