#             cd BigFish 
#             $env:USE_TF = "0"
#             python -m ML.tests.test_entity_resolver

from pathlib import Path
from PIL import Image, ImageDraw

from ML.src.privacy.entity_resolver import EntityResolver
from ML.src.workers.ocr import OCRDetector
from ML.src.workers.cv import CVDetector
from ML.src.workers.ner import NERDetector
from ML.src.pipeline import DetectionPipeline


def main():
    pipeline = DetectionPipeline(
        ocr_detector=OCRDetector(),
        cv_detector=CVDetector(),
        ner_detector=NERDetector(),
        strict=True,
    )

    image_path = Path("sample_id.png")
    if not image_path.exists():
        img = Image.new("RGB", (600, 300), color=(255, 255, 255))
        d = ImageDraw.Draw(img)
        d.text((30, 30), "BigFish Identity Card", fill=(0, 0, 0))
        d.text((30, 80), "Name: John Doe", fill=(0, 0, 0))
        d.text((30, 130), "Organization: Acme Corporation", fill=(0, 0, 0))
        d.text((30, 180), "City: New Delhi", fill=(0, 0, 0))
        img.save(image_path)

    result = pipeline.run(image_path) 

    # Inspect detection structure without printing sensitive text.
    detections = result.get("detections", [])

    print("\n--- Detection metadata ---")

    for i, det in enumerate(detections):
        bbox = det.get("bbox")
        span = det.get("text_span")

        print({
            "index": i,
            "source": det.get("source"),
            "type": det.get("type"),
            "has_bbox": bbox is not None,
            "coordinate_space": det.get("coordinate_space"),
            "has_text_span": span is not None,
            "context_id": det.get("context_id"),
            "confidence_available": det.get("confidence") is not None,
        })

    resolver = EntityResolver(
        iou_threshold=0.40,
        span_overlap_threshold=0.40,
    )

    resolved = resolver.resolve(result)

    print("Original detections:", resolved["detection_count"])
    print("Resolved entities:", resolved["entity_count"])
    print("Spatial relationships:", len(resolved["relationships"]))
    print("Unresolved detections:", len(resolved["unresolved_detections"]))

    for entity in resolved["entities"]:
        print({
            "entity_id": entity["entity_id"],
            "type": entity["type"],
            "sources": entity["sources"],
            "parent_region_count": len(entity.get("parent_regions", [])),
            "effective_box_count": len(entity.get("effective_bounding_boxes", [])),
            "requires_review": entity["requires_review"],
        })


def test_entity_resolver():
    main()


if __name__ == "__main__":
    main()
