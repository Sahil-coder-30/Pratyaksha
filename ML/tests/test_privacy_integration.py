#             $env:USE_TF = "0"
#             python -m ML.tests.test_privacy_integration


from ML.src.pipeline import DetectionPipeline
from ML.src.privacy.entity_resolver import EntityResolver
from ML.src.privacy.privacy_engine import PrivacyEngine
from ML.src.privacy.session_manager import SessionManager
from ML.src.workers.ocr import OCRDetector
from ML.src.workers.cv import CVDetector
from ML.src.workers.ner import NERDetector


def main():
    # 1. Run the existing detection pipeline.
    pipeline = DetectionPipeline(
        ocr_detector=OCRDetector(),
        cv_detector=CVDetector(),
        ner_detector=NERDetector(),
        strict=True,
    )

    # Use your existing local test image.
    image_path = r"D:\Honey\Fun\Pratyaksh\Pratyaksha\APAAR ID Kushagra.png"

    pipeline_result = pipeline.run(image_path)

    # 2. Resolve detections into entities.
    resolver = EntityResolver(
        iou_threshold=0.40,
        span_overlap_threshold=0.40,
    )

    resolved = resolver.resolve(pipeline_result)

    # 3. Generate a session-aware sanitization plan.
    session_manager = SessionManager(
        session_id="privacy_integration_test"
    )
    privacy_engine = PrivacyEngine(
        session_manager=session_manager
    )

    plan = privacy_engine.build_plan(resolved)

    # 4. Print metadata only. Never print entity text or evidence.
    print("\n--- Privacy Integration Summary ---")
    print("Pipeline detections:", resolved["detection_count"])
    print("Resolved entities:", resolved["entity_count"])
    print(
        "Unresolved detections:",
        len(resolved["unresolved_detections"]),
    )
    print(
        "Mask regions:",
        plan["metadata"]["mask_region_count"],
    )
    print(
        "Unlocalized entities:",
        plan["metadata"]["unlocalized_count"],
    )
    print(
        "Requires human review:",
        plan["requires_human_review"],
    )
    print(
        "Ready for sanitization:",
        plan["ready_for_sanitization"],
    )
    print(
        "Ready for release:",
        plan["ready_for_release"],
    )

    # 5. Verify basic output safety properties.
    assert plan["metadata"]["entity_count"] == resolved["entity_count"]

    assert all(
        region.get("entity_id")
        and region.get("bbox") is not None
        and region.get("action") == "mask"
        for region in plan["mask_regions"]
    )

    # A missing region must block release.
    if plan["unlocalized_entities"]:
        assert plan["ready_for_release"] is False

    print("\nPrivacy integration test completed.")


if __name__ == "__main__":
    main()
