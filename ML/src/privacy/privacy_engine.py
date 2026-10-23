#             $env:USE_TF = "0"
#             python -m ML.src.privacy.privacy_engine


from collections.abc import Mapping
from typing import Any

from ML.src.privacy.session_manager import SessionManager


class PrivacyEngine:
    """
    Converts resolved entities into a privacy sanitization plan.

    The engine does not modify images. It determines which regions
    require masking and assigns session-local entity IDs.
    """

    # Canonical entity types that should be masked by default.
    SENSITIVE_TYPES = {
        "PERSON",
        "ORGANIZATION",
        "LOCATION",
        "EMAIL",
        "PHONE",
        "ADDRESS",
        "IDENTIFIER",
        "DATE_OF_BIRTH",
        "FINANCIAL",
        "CREDENTIAL",
        "UNKNOWN",
    }

    TYPE_ALIASES = {
        "PER": "PERSON",
        "ORG": "ORGANIZATION",
        "LOC": "LOCATION",
        "GPE": "LOCATION",
        "EMAIL_ADDRESS": "EMAIL",
        "PHONE_NUMBER": "PHONE",
        "ID": "IDENTIFIER",
        "ID_NUMBER": "IDENTIFIER",
    }

    def __init__(
        self,
        session_manager: SessionManager | None = None,
    ):
        self.session_manager = session_manager or SessionManager()

    @classmethod
    def _canonical_type(cls, value: Any) -> str:
        entity_type = str(value or "UNKNOWN").strip().upper()
        return cls.TYPE_ALIASES.get(entity_type, entity_type)

    @staticmethod
    def _get_boxes(entity: Mapping[str, Any]) -> list[Any]:
        """
        Prefer effective boxes, which may include parent OCR regions
        for NER entities. Fall back to the resolver's direct boxes.
        """
        candidates = entity.get("effective_bounding_boxes")

        if candidates is None:
            candidates = entity.get("bounding_boxes")

        if candidates is None:
            candidates = entity.get("bbox")

        if candidates is None:
            return []

        if isinstance(candidates, (list, tuple)):
            # A single box may itself be represented as four numbers.
            if (
                len(candidates) == 4
                and all(
                    isinstance(value, (int, float))
                    for value in candidates
                )
            ):
                return [list(candidates)]

            return [
                box for box in candidates
                if box is not None
            ]

        return [candidates]

    def build_plan(
        self,
        resolution: Mapping[str, Any],
    ) -> dict[str, Any]:
        """
        Build a sanitization plan from the entity resolver's output.

        Raw entity text and evidence are deliberately excluded.
        """
        if not isinstance(resolution, Mapping):
            raise TypeError("resolution must be a mapping")

        entities = resolution.get("entities", [])

        if not isinstance(entities, list):
            raise TypeError("resolution['entities'] must be a list")

        mask_regions: list[dict[str, Any]] = []
        decisions: list[dict[str, Any]] = []
        unlocalized_entities: list[str] = []

        requires_human_review = bool(
            resolution.get("unresolved_detections", [])
        )

        for entity in entities:
            if not isinstance(entity, Mapping):
                raise TypeError("Each resolved entity must be a mapping")

            resolver_id = entity.get("entity_id")
            entity_type = self._canonical_type(entity.get("type"))
            requires_review = bool(entity.get("requires_review", False))

            should_mask = (
                entity_type in self.SENSITIVE_TYPES
                or requires_review
            )

            # Never include raw text or evidence in the plan.
            if not should_mask:
                decisions.append({
                    "entity_id": None,
                    "type": entity_type,
                    "action": "no_mask",
                    "reason": "Not classified as sensitive by current policy",
                    "requires_review": False,
                })
                continue

            # Only reuse IDs when upstream identity resolution explicitly
            # provides a stable key. Per-run resolver IDs are not enough.
            stable_key = entity.get("stable_entity_key")
            if stable_key is not None:
                stable_key = f"{entity_type}:{stable_key}"

            privacy_id = self.session_manager.assign_entity_id(
                stable_key=stable_key
            )

            boxes = self._get_boxes(entity)

            if requires_review:
                requires_human_review = True

            if not boxes:
                unlocalized_entities.append(privacy_id)
                requires_human_review = True

                decisions.append({
                    "entity_id": privacy_id,
                    "type": entity_type,
                    "action": "review_required",
                    "reason": "No usable spatial region available",
                    "requires_review": True,
                })
                continue

            reason = (
                "Uncertain detection; mask conservatively"
                if requires_review or entity_type == "UNKNOWN"
                else "Sensitive entity type"
            )

            for box in boxes:
                mask_regions.append({
                    "entity_id": privacy_id,
                    "bbox": box,
                    "coordinate_space": entity.get("coordinate_space"),
                    "action": "mask",
                })

            decisions.append({
                "entity_id": privacy_id,
                "type": entity_type,
                "action": "mask",
                "reason": reason,
                "requires_review": requires_review,
                "region_count": len(boxes),
            })

        return {
            "session_id": self.session_manager.session_id,
            "mask_regions": mask_regions,
            "decisions": decisions,
            "unlocalized_entities": unlocalized_entities,
            "requires_human_review": requires_human_review,
            "ready_for_sanitization": not unlocalized_entities,
            "ready_for_release": not unlocalized_entities,
            "metadata": {
                "entity_count": len(entities),
                "mask_region_count": len(mask_regions),
                "unlocalized_count": len(unlocalized_entities),
            },
        }
