
"""
entity_resolver.py

Resolves duplicate detections from OCR, CV, NER, and DOM.

Input:
    The result dictionary returned by DetectionPipeline.run(), or
    a list of normalized detection dictionaries.

Output:
    Resolved entities, original detection evidence, and spatial
    relationships for downstream privacy processing.

Important:
    - Does not anonymize or redact.
    - Does not transmit data.
    - Does not merge entities based on text equality alone.
    - Keeps ambiguous detections separate.
"""

#             cd BigFish 
#             $env:USE_TF = "0"
#             python -m ML.src.privacy.entity_resolver

from __future__ import annotations

import re
from typing import Any, Optional


# Labels representing the same semantic entity.
TYPE_ALIASES = {
    "PER": "PERSON",
    "PERSON": "PERSON",
    "B-PER": "PERSON",
    "I-PER": "PERSON",

    "ORG": "ORGANIZATION",
    "ORGANIZATION": "ORGANIZATION",
    "B-ORG": "ORGANIZATION",
    "I-ORG": "ORGANIZATION",

    "LOC": "LOCATION",
    "LOCATION": "LOCATION",
    "GPE": "LOCATION",
    "B-LOC": "LOCATION",
    "I-LOC": "LOCATION",
    "B-GPE": "LOCATION",
    "I-GPE": "LOCATION",

    "EMAIL": "EMAIL",
    "EMAIL_ADDRESS": "EMAIL",

    "PHONE": "PHONE",
    "PHONE_NUMBER": "PHONE",

    "CREDIT_CARD": "CREDIT_CARD",
    "CREDIT_CARD_NUMBER": "CREDIT_CARD",

    "AADHAAR": "AADHAAR",
    "AADHAAR_NUMBER": "AADHAAR",
    "PAN": "PAN",
    "PAN_NUMBER": "PAN",

    "PASSWORD": "PASSWORD",
    "USERNAME": "USERNAME",

    "URL": "URL",
    "LINK": "URL",
    "PUBLIC_LINK": "URL",

    "SSN": "SSN",

    # A plain OCR line is not sensitive by itself. NER and regex hits inside it are.
    "TEXT": "TEXT",
    "OCR_TEXT": "TEXT",
    "UNKNOWN": "UNKNOWN",
}

GENERIC_TYPES = {"UNKNOWN"}

# Text-only sources: their detections have a character span inside an OCR
# line, not a box, and are located through that line.
SPAN_SOURCES = {"ner", "regex"}


class EntityResolver:
    """Resolve duplicate detections while preserving evidence."""

    def __init__(
        self,
        *,
        iou_threshold: float = 0.40,
        span_overlap_threshold: float = 0.40,
    ) -> None:
        if not 0.0 <= iou_threshold <= 1.0:
            raise ValueError("iou_threshold must be between 0 and 1.")

        if not 0.0 <= span_overlap_threshold <= 1.0:
            raise ValueError(
                "span_overlap_threshold must be between 0 and 1."
            )

        self.iou_threshold = iou_threshold
        self.span_overlap_threshold = span_overlap_threshold

    @staticmethod
    def _canonical_type(value: Any) -> str:
        """Normalize common entity-label aliases."""
        if value is None:
            return "UNKNOWN"

        label = str(value).strip().upper().replace("-", "_")
        return TYPE_ALIASES.get(label, label)

    @staticmethod
    def _normalize_text(value: Any) -> Optional[str]:
        """Normalize text for comparisons without changing stored text."""
        if value is None:
            return None

        text = re.sub(r"\s+", " ", str(value)).strip()
        return text.casefold() if text else None

    @staticmethod
    def _normalize_bbox(
        bbox: Any,
    ) -> Optional[list[float]]:
        """
        Validate a bbox in [x1, y1, x2, y2] format.

        Coordinates must use the same coordinate system and image
        dimensions before comparing two boxes.
        """
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            return None

        try:
            x1, y1, x2, y2 = map(float, bbox)
        except (TypeError, ValueError):
            return None

        if x2 <= x1 or y2 <= y1:
            return None

        return [x1, y1, x2, y2]

    @staticmethod
    def _normalize_span(
        span: Any,
    ) -> Optional[dict[str, int]]:
        """Normalize character offsets to start/end."""
        if not isinstance(span, dict):
            return None

        start_val = span.get("start", span.get("start_char"))
        end_val = span.get("end", span.get("end_char"))

        if start_val is None or end_val is None:
            return None

        try:
            start = int(start_val)
            end = int(end_val)
        except (TypeError, ValueError):
            return None

        if start < 0 or end <= start:
            return None

        return {"start": start, "end": end}

    @staticmethod
    def _bbox_iou(
        a: list[float],
        b: list[float],
    ) -> float:
        """Calculate intersection over union for two XYXY boxes."""
        ix1 = max(a[0], b[0])
        iy1 = max(a[1], b[1])
        ix2 = min(a[2], b[2])
        iy2 = min(a[3], b[3])

        intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)

        area_a = (a[2] - a[0]) * (a[3] - a[1])
        area_b = (b[2] - b[0]) * (b[3] - b[1])
        union = area_a + area_b - intersection

        return intersection / union if union > 0 else 0.0

    @staticmethod
    def _project_span(
        bbox: list[float],
        text: Optional[str],
        span: Optional[dict[str, int]],
    ) -> list[float]:
        """
        Estimate the part of an OCR line box that holds a character span.

        OCR gives one box per line, so the span is placed by its share of
        the characters, plus slack because glyph widths differ: half a
        character before it (so the label before it stays readable) and one
        after it. Without usable text or span, the whole line is used.
        """
        if not text or span is None:
            return list(bbox)

        length = len(text)
        start = max(0, min(span["start"], length))
        end = max(start, min(span["end"], length))

        if length == 0 or end <= start:
            return list(bbox)

        x1, y1, x2, y2 = bbox
        char_width = (x2 - x1) / length

        return [
            max(x1, x1 + char_width * (start - 0.5)),
            y1,
            min(x2, x1 + char_width * (end + 1)),
            y2,
        ]

    def _spans_overlap(
        self,
        a: dict[str, int],
        b: dict[str, int],
    ) -> bool:
        """Compare character spans in the same text context."""
        intersection = max(
            0,
            min(a["end"], b["end"]) - max(a["start"], b["start"]),
        )

        if intersection == 0:
            return False

        length_a = a["end"] - a["start"]
        length_b = b["end"] - b["start"]

        return (
            intersection / min(length_a, length_b)
            >= self.span_overlap_threshold
        )

    def _same_entity_occurrence(
        self,
        a: dict[str, Any],
        b: dict[str, Any],
    ) -> bool:
        """
        Decide whether two records are duplicate detections.

        Matching labels alone is insufficient. We require matching
        entity types and spatial or contextual evidence.
        """
        if a["type"] != b["type"]:
            return False

        # Different image coordinate systems must not be compared.
        if (
            a.get("coordinate_space")
            != b.get("coordinate_space")
        ):
            return False

        bbox_a = a.get("bbox")
        bbox_b = b.get("bbox")

        if bbox_a is not None and bbox_b is not None:
            if self._bbox_iou(bbox_a, bbox_b) >= self.iou_threshold:
                text_a = a.get("_normalized_text")
                text_b = b.get("_normalized_text")

                # Same-type detections can refer to the same region.
                # Conflicting, non-empty text is evidence against merging.
                if (
                    text_a is not None
                    and text_b is not None
                    and text_a != text_b
                ):
                    return False

                return True

        # Text spans are comparable only within the same text context.
        context_a = a.get("context_id")
        context_b = b.get("context_id")
        span_a = a.get("text_span")
        span_b = b.get("text_span")

        if (
            context_a is not None
            and context_a == context_b
            and span_a is not None
            and span_b is not None
        ):
            if self._spans_overlap(span_a, span_b):
                return True

        # Exact text alone is not enough: a name or email can occur
        # more than once on a page as separate occurrences.
        return False

    @staticmethod
    def _prepare_detection(
        item: dict[str, Any],
        index: int,
        source_hint: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a normalized copy without mutating pipeline output."""
        record = dict(item)

        record.setdefault("detection_id", f"det_{index:05d}")

        source = record.get("source") or source_hint or "unknown"
        record["source"] = str(source).lower()

        raw_type = (
            record.get("type")
            or record.get("entity_group")
            or record.get("entity")
            or record.get("class_name")
            or record.get("label")
        )
        record["type"] = EntityResolver._canonical_type(raw_type)

        if "confidence" not in record:
            record["confidence"] = record.get(
                "score",
                record.get("conf"),
            )

        conf_raw = record.get("confidence")
        if conf_raw is not None:
            try:
                confidence = float(conf_raw)
                record["confidence"] = (
                    confidence
                    if 0.0 <= confidence <= 1.0
                    else None
                )
            except (TypeError, ValueError):
                record["confidence"] = None

        bbox = record.get("bbox", record.get("box"))
        record["bbox"] = EntityResolver._normalize_bbox(bbox)

        record["text_span"] = EntityResolver._normalize_span(
            record.get("text_span")
        )

        record["_normalized_text"] = EntityResolver._normalize_text(
            record.get("text")
        )

        return record

    def _flatten_input(
        self,
        data: dict[str, Any] | list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Accept either pipeline output or a flat detection list."""
        records: list[dict[str, Any]] = []

        if isinstance(data, list):
            source_items = [("unknown", data)]

        elif isinstance(data, dict) and isinstance(
            data.get("by_source"), dict
        ):
            source_items = list(data["by_source"].items())

        elif isinstance(data, dict) and isinstance(
            data.get("detections"), list
        ):
            source_items = [("unknown", data["detections"])]

        else:
            raise TypeError(
                "Expected a pipeline result dictionary or a list "
                "of detection dictionaries."
            )

        index = 0

        for source_hint, items in source_items:
            if not isinstance(items, list):
                continue

            for item in items:
                if not isinstance(item, dict):
                    raise TypeError(
                        "Each detection must be a dictionary."
                    )

                records.append(
                    self._prepare_detection(
                        item,
                        index,
                        source_hint=source_hint,
                    )
                )
                index += 1

        # A flat detections list should be handled if by_source is empty.
        if not records and isinstance(data, dict):
            for index, item in enumerate(data.get("detections", [])):
                if isinstance(item, dict):
                    records.append(
                        self._prepare_detection(item, index)
                    )

        # Ensure IDs are unique, even if input records reused IDs.
        seen_ids: set[str] = set()

        for index, record in enumerate(records):
            original_id = str(record["detection_id"])
            unique_id = original_id

            suffix = 2
            while unique_id in seen_ids:
                unique_id = f"{original_id}_{suffix}"
                suffix += 1

            record["detection_id"] = unique_id
            seen_ids.add(unique_id)

        return records

    def resolve(
        self,
        data: dict[str, Any] | list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Resolve duplicate detections.

        Returns:
            {
                "entities": [...],
                "relationships": [...],
                "unresolved_detections": [...],
                "detection_count": int,
                "entity_count": int
            }
        """
        records = self._flatten_input(data)
        count = len(records) 

        
        # Index OCR regions by context so NER mentions can inherit
        # approximate localization from their originating text.
        ocr_by_context: dict[str, list[dict[str, Any]]] = {}

        for record in records:
            context_id = record.get("context_id")

            if (
                record.get("source") == "ocr"
                and context_id is not None
                and record.get("bbox") is not None
            ):
                ocr_by_context.setdefault( context_id, [] ).append(record)


        # Union-find: group only pairs supported by matching evidence.
        parent = list(range(count))

        def find(index: int) -> int:
            while parent[index] != index:
                parent[index] = parent[parent[index]]
                index = parent[index]
            return index

        def union(a: int, b: int) -> None:
            root_a = find(a)
            root_b = find(b)

            if root_a != root_b:
                parent[root_b] = root_a

        relationships: list[dict[str, Any]] = []

        for i in range(count):
            for j in range(i + 1, count):
                a = records[i]
                b = records[j]

                if self._same_entity_occurrence(a, b):
                    union(i, j)

        groups: dict[int, list[dict[str, Any]]] = {}

        for index, record in enumerate(records):
            groups.setdefault(find(index), []).append(record)

        entities: list[dict[str, Any]] = []

        for entity_index, members in enumerate(groups.values(), start=1):
            sources = sorted({item["source"] for item in members})

            # Prefer a specific, non-empty text value when available.
            text_candidates = [
                item
                for item in members
                if item.get("text") is not None
                and str(item["text"]).strip()
            ]

            representative = (
                text_candidates[0] if text_candidates else members[0]
            )

            boxes = [
                item["bbox"]
                for item in members
                if item.get("bbox") is not None
            ]

            spans = [
                item["text_span"]
                for item in members
                if item.get("text_span") is not None
            ]

            confidences = [
                item["confidence"]
                for item in members
                if item.get("confidence") is not None
            ]

            
                        # Find OCR regions associated with this entity's context.
            # Only NER and regex entities inherit parent OCR regions, and
            # only the part of the line their span covers.
            parent_regions = []

            for item in members:
                if item.get("source") not in SPAN_SOURCES:
                    continue

                context_id = item.get("context_id")

                for ocr_record in ocr_by_context.get(context_id, []):
                    parent_regions.append({
                        "detection_id": ocr_record["detection_id"],
                        "context_id": context_id,
                        "bbox": self._project_span(
                            ocr_record["bbox"],
                            ocr_record.get("text"),
                            item.get("text_span"),
                        ),
                        "line_bbox": ocr_record["bbox"],
                        "coordinate_space": ocr_record.get(
                            "coordinate_space"
                        ),
                    })

            effective_bounding_boxes = (
                boxes
                + [
                    region["bbox"]
                    for region in parent_regions
                ]
            )

            
            rep_text = representative.get("text")
            is_url_text = bool(
                rep_text
                and isinstance(rep_text, str)
                and re.search(
                    r'(?:https?://|www\.)\S+|docs\.google\.com/\S+|'
                    r'^[a-zA-Z0-9-]+\.(?:com|org|net|edu|gov|io|ai|co|dev|app|in)(?:/\S*)?$',
                    rep_text.strip(),
                    re.IGNORECASE,
                )
            )
            resolved_type = "URL" if is_url_text else representative["type"]
            is_requires_review = (
                False if is_url_text else (
                    resolved_type == "UNKNOWN"
                    or any(
                        item.get("confidence") is None
                        for item in members
                    )
                )
            )

            entities.append(
                {
                    "entity_id": f"entity_{entity_index:05d}",
                    "type": resolved_type,
                    "text": rep_text,
                    "sources": sources,
                    "bounding_boxes": boxes,
                    "text_spans": spans,
                    "context_ids": sorted(
                        {
                            item["context_id"]
                            for item in members
                            if item.get("context_id") is not None
                        }
                    ),
                    "confidence_scores": confidences,
                    "detection_ids": [
                        item["detection_id"] for item in members
                    ],
                    "evidence": [
                        {
                            key: value
                            for key, value in item.items()
                            if not key.startswith("_")
                        }
                        for item in members
                    ],
                    "requires_review": is_requires_review,
                    "parent_regions": parent_regions,
                    "effective_bounding_boxes": effective_bounding_boxes,
                }
            )

        # Record overlaps between different entity types without merging.
        for i in range(count):
            for j in range(i + 1, count):
                a = records[i]
                b = records[j]

                if a["type"] == b["type"]:
                    continue

                bbox_a = a.get("bbox")
                bbox_b = b.get("bbox")

                if bbox_a is None or bbox_b is None:
                    continue

                iou = self._bbox_iou(bbox_a, bbox_b)

                if iou > 0:
                    relationships.append(
                        {
                            "type": "spatial_overlap",
                            "detection_a": a["detection_id"],
                            "detection_b": b["detection_id"],
                            "entity_type_a": a["type"],
                            "entity_type_b": b["type"],
                            "iou": round(iou, 4),
                            "requires_review": True,
                        }
                    )

        # Preserve detections that could not be confidently resolved.        
        # A span-only NER detection can be localized through its
        # parent OCR region, provided its context matches.
        unresolved = []

        for item in records:
            context_id = item.get("context_id")

            has_parent_region = bool(
                context_id is not None
                and ocr_by_context.get(context_id)
            )

            has_location = (
                item.get("bbox") is not None
                or (
                    item.get("source") in SPAN_SOURCES
                    and item.get("text_span") is not None
                    and has_parent_region
                )
            )

            needs_review = (
                item["type"] == "UNKNOWN"
                or item.get("confidence") is None
                or not has_location
            )

            if needs_review:
                unresolved.append({
                    key: value
                    for key, value in item.items()
                    if not key.startswith("_")
                })


        return {
            "entities": entities,
            "relationships": relationships,
            "unresolved_detections": unresolved,
            "detection_count": count,
            "entity_count": len(entities),
        }
