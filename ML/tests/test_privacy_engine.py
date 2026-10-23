#             $env:USE_TF = "0"
#             python -m ML.tests.test_privacy_engine 


from ML.src.privacy.privacy_engine import PrivacyEngine
from ML.src.privacy.session_manager import SessionManager


def test_privacy_engine():
    session = SessionManager(session_id="test_session")
    engine = PrivacyEngine(session_manager=session)

    # Synthetic entities only. Do not use real ID data in tests.
    resolution = {
        "entities": [
            {
                "entity_id": "entity_00001",
                "type": "PERSON",
                "sources": ["ner"],
                "requires_review": False,
                "effective_bounding_boxes": [
                    [10, 20, 150, 55]
                ],
                "coordinate_space": "screenshot_px",
                "text": "SYNTHETIC PERSON",
            },
            {
                "entity_id": "entity_00002",
                "type": "UNKNOWN",
                "sources": ["ocr"],
                "requires_review": True,
                "effective_bounding_boxes": [
                    [20, 80, 220, 110]
                ],
                "coordinate_space": "screenshot_px",
                "text": "SYNTHETIC ID VALUE",
            },
            {
                "entity_id": "entity_00003",
                "type": "EMAIL",
                "sources": ["ner"],
                "requires_review": False,
                "effective_bounding_boxes": [],
                "coordinate_space": None,
                "text": "synthetic@example.test",
            },
        ],
        "unresolved_detections": [],
    }

    plan = engine.build_plan(resolution)

    assert plan["session_id"] == "test_session"
    assert plan["metadata"]["entity_count"] == 3

    # PERSON and UNKNOWN regions should be masked.
    assert len(plan["mask_regions"]) == 2
    assert all(
        region["action"] == "mask"
        for region in plan["mask_regions"]
    )

    # The unlocalized EMAIL must not silently pass through.
    assert len(plan["unlocalized_entities"]) == 1
    assert plan["ready_for_sanitization"] is False
    assert plan["ready_for_release"] is False

    # Labels should be unique for distinct entities in this test.
    entity_ids = [
        decision["entity_id"]
        for decision in plan["decisions"]
        if decision["entity_id"] is not None
    ]
    assert len(entity_ids) == len(set(entity_ids))

    # The plan must not expose original sensitive text.
    plan_text = repr(plan)
    assert "SYNTHETIC PERSON" not in plan_text
    assert "SYNTHETIC ID VALUE" not in plan_text
    assert "synthetic@example.test" not in plan_text

    print("Privacy engine test passed.")
    print("Entity count:", plan["metadata"]["entity_count"])
    print("Mask regions:", plan["metadata"]["mask_region_count"])
    print("Unlocalized entities:", plan["metadata"]["unlocalized_count"])
    print("Ready for sanitization:", plan["ready_for_sanitization"])
    print("Ready for release:", plan["ready_for_release"])


if __name__ == "__main__":
    test_privacy_engine()
