
"""
pipeline.py

Orchestrates OCR, computer vision, and NER detection.

Responsibilities:
    1. Run OCR and CV on the supplied screenshot/image.
    2. Run NER on OCR-extracted text and optional DOM text.
    3. Normalize detections into a common schema.
    4. Combine detections into a single result for downstream processing.

Privacy:
    - Raw text and detections remain in local memory.
    - This module does NOT send data over a network.
    - This module does NOT perform anonymization or redaction.

Detector interface:
    Each detector can be either:
        - An object exposing detect(input_data)
        - A callable accepting input_data

Expected output from each detector:
    A list of dictionaries, Detection objects, or None.

Adapt the detector adapters if your existing modules use different APIs.
"""

#             cd BigFish 
#             $env:USE_TF = "0"
#             python -m ML.src.pipeline


from __future__ import annotations

from ML.src.workers.cv import CVDetector as cvdect
from ML.src.workers.ner import NERDetector as nerdect
from ML.src.workers.ocr import OCRDetector as ocrdect 
from ML.src.workers.pii_regex import PIIRegexDetector

import logging
from dataclasses import asdict, is_dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)


class DetectionPipelineError(RuntimeError):
    """Raised when a required detection stage fails."""


class DetectionPipeline:
    """Coordinates OCR, CV, and NER detectors."""

    def __init__(
        self,
        ocr_detector: ocrdect,
        cv_detector: cvdect,
        ner_detector: nerdect,
        *,
        pii_detector: Optional[PIIRegexDetector] = None,
        strict: bool = True,
    ) -> None:
        """
        Args:
            ocr_detector: OCR object or callable.
            cv_detector: CV object or callable.
            ner_detector: NER object or callable.
            pii_detector: Pattern detector for emails, phones and ID
                    numbers. Defaults to PIIRegexDetector.
            strict: If True, raise an error when a stage fails.
                    If False, record the failure and continue.

        Note:
            Use strict=True during development and testing.
            For a privacy-sensitive production pipeline, a failed
            stage must never be interpreted as proof that data is safe.
        """
        self.ocr_detector = ocr_detector
        self.cv_detector = cv_detector
        self.ner_detector = ner_detector
        self.pii_detector = pii_detector or PIIRegexDetector()
        self.strict = strict

    @staticmethod
    def _invoke(detector: Any, data: Any) -> Any:
        """Invoke a detector using a common interface."""
        if detector is None:
            raise ValueError("A detector has not been configured.")

        detect_method = getattr(detector, "detect", None)

        if callable(detect_method):
            return detect_method(data)

        if callable(detector):
            return detector(data)

        raise TypeError(
            "Detector must be callable or expose a callable detect() method."
        )

    @staticmethod
    def _to_dict(item: Any) -> dict[str, Any]:
        """Convert supported detection objects into dictionaries."""
        if isinstance(item, dict):
            return dict(item)

        if is_dataclass(item) and not isinstance(item, type):
            return asdict(item)

        model_dump = getattr(item, "model_dump", None)
        if callable(model_dump):
            res = model_dump()
            if isinstance(res, dict):
                return res

        raise TypeError(
            f"Unsupported detection type: {type(item).__name__}. "
            "Return a dictionary or a supported detection object."
        )

    @classmethod
    def _normalize(
        cls,
        output: Any,
        source: str,
    ) -> list[dict[str, Any]]:
        """
        Normalize detector output.

        Canonical fields:
            type, source, confidence, bbox, text, text_span, context_id

        Additional detector-specific fields are preserved.
        """
        if output is None:
            return []

        if isinstance(output, dict) or is_dataclass(output):
            items = [output]
        elif isinstance(output, (list, tuple)):
            items = list(output)
        else:
            raise TypeError(
                f"{source} returned {type(output).__name__}; "
                "expected a list, tuple, dictionary, or None."
            )

        normalized: list[dict[str, Any]] = []

        for item in items:
            record = cls._to_dict(item)

            # Accept common aliases from different detector modules.
            if "type" not in record:
                record["type"] = (
                    record.get("entity_group")
                    or record.get("entity")
                    or record.get("class_name")
                    or record.get("label")
                    or "UNKNOWN"
                )

            if "confidence" not in record:
                record["confidence"] = record.get(
                    "score",
                    record.get("conf"),
                )

            if "bbox" not in record:
                record["bbox"] = record.get(
                    "box",
                    record.get("bounding_box"),
                )

            if "text" not in record:
                record["text"] = record.get("word") 

            if "context_id" not in record: 
                record["context_id"] = record.get("context_id", None) 

            # The pipeline's stage identifies the source of this record.
            record["source"] = source

            normalized.append(record)

        return normalized

    def _run_stage(
        self,
        stage_name: str,
        detector: Any,
        data: Any,
    ) -> tuple[list[dict[str, Any]], Optional[str]]:
        """Run one detector and return its detections and error, if any."""
        try:
            raw_output = self._invoke(detector, data)
            detections = self._normalize(raw_output, stage_name)
            return detections, None

        except Exception as exc:
            logger.exception("%s stage failed", stage_name)

            if self.strict:
                raise DetectionPipelineError(
                    f"The {stage_name} stage failed."
                ) from exc

            # Preserve failure information so downstream logic can fail closed.
            return [], f"{type(exc).__name__}: {exc}"

    @staticmethod
    def _extract_ocr_text(
        ocr_detections: list[dict[str, Any]],
    ) -> list[str]:
        """Collect non-empty OCR text fragments in their returned order."""
        return [
            str(item["text"])
            for item in ocr_detections
            if item.get("text") is not None
            and str(item["text"]).strip()
        ]

    def run(
        self,
        image: Any,
        *,
        dom_text: Optional[str] = None,
        dom_detections: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        """
        Run the detection pipeline on one screenshot or image.

        Args:
            image:
                Image path, PIL image, NumPy array, or whatever your
                OCR/CV detector interfaces support.
            dom_text:
                Optional text extracted locally from the webpage DOM.
            dom_detections:
                Optional DOM detections already normalized to dictionaries.

        Returns:
            A dictionary containing detections, OCR text, stage status,
            and a readiness flag for downstream privacy processing.

        Important:
            The result can contain raw sensitive information. Do not send
            it directly to the server-side agent.
        """
        # Stage 1: OCR
        ocr_detections, ocr_error = self._run_stage(
            "ocr",
            self.ocr_detector,
            image,
        )

        # Stage 2: CV
        cv_detections, cv_error = self._run_stage(
            "cv",
            self.cv_detector,
            image,
        )

        
        # Stage 3: NER and regex PII
        # Each OCR text fragment gets one stable context ID.
        # NER and regex detections inherit the ID of the text they came from.
        ner_detections: list[dict[str, Any]] = []
        ner_errors: list[str] = []
        regex_detections: list[dict[str, Any]] = []
        regex_errors: list[str] = []

        text_sources: list[tuple[str, str]] = []

        for index, ocr_record in enumerate(ocr_detections):
            text = ocr_record.get("text")

            if text is None or not str(text).strip():
                continue

            context_id = f"ocr_text_{index}"

            # Store the same context on the parent OCR record.
            ocr_record["context_id"] = context_id

            text_sources.append((context_id, str(text)))

        if dom_text and dom_text.strip():
            text_sources.append(("dom_text", dom_text))

        for context_id, text in text_sources:
            results, error = self._run_stage(
                "ner",
                self.ner_detector,
                text,
            )

            for record in results:
                record["context_id"] = context_id
                ner_detections.append(record)

            if error:
                ner_errors.append(f"{context_id}: {error}")

            results, error = self._run_stage(
                "regex",
                self.pii_detector,
                text,
            )

            for record in results:
                record["context_id"] = context_id
                regex_detections.append(record)

            if error:
                regex_errors.append(f"{context_id}: {error}")


        # Stage 4: Attach optional DOM detections.
        normalized_dom = self._normalize(dom_detections or [], "dom")

        # Keep source-specific results available for debugging and tests.
        all_detections = (
            ocr_detections
            + cv_detections
            + ner_detections
            + regex_detections
            + normalized_dom
        )

        stage_errors: dict[str, Any] = {}

        if ocr_error:
            stage_errors["ocr"] = ocr_error

        if cv_error:
            stage_errors["cv"] = cv_error

        if ner_errors:
            stage_errors["ner"] = ner_errors

        if regex_errors:
            stage_errors["regex"] = regex_errors

        # A failure means the output is not cleared for downstream use.
        ready_for_privacy_processing = not stage_errors
        
        return {
            "detections": all_detections,
            "by_source": {
                "ocr": ocr_detections,
                "cv": cv_detections,
                "ner": ner_detections,
                "regex": regex_detections,
                "dom": normalized_dom,
            },
            "ocr_text": self._extract_ocr_text(ocr_detections),
            "stage_errors": stage_errors,
            "ready_for_privacy_processing": ready_for_privacy_processing,
        }



def main():
    # These assume your detector classes have no-argument
    # constructors. Adjust if they require model paths or config.
    ocr = ocrdect()
    cv = cvdect()
    ner = nerdect()

    pipeline = DetectionPipeline(
        ocr_detector=ocr,
        cv_detector=cv,
        ner_detector=ner,
        strict=True,
    )

    from pathlib import Path
    from PIL import Image, ImageDraw

    image_path = Path("sample_id.png")
    if not image_path.exists():
        img = Image.new("RGB", (600, 300), color=(255, 255, 255))
        d = ImageDraw.Draw(img)
        d.text((30, 30), "BigFish Privacy Vision Pipeline", fill=(0, 0, 0))
        d.text((30, 80), "Name: John Doe", fill=(0, 0, 0))
        d.text((30, 130), "Company: Acme Corp", fill=(0, 0, 0))
        d.text((30, 180), "Location: New Delhi", fill=(0, 0, 0))
        img.save(image_path)

    result = pipeline.run(image_path)

    print("\n--- Detection summary ---") 

    for record in result["by_source"]["ocr"]:
        print({
            "source": record.get("source"),
            "context_id": record.get("context_id"),
            "has_bbox": record.get("bbox") is not None,
            })
    
    for record in result["by_source"]["ner"]:
        print({
            "source": record.get("source"),
            "type": record.get("type"),
            "context_id": record.get("context_id"),
            "text_span": record.get("text_span"),
            })

    for source, detections in result["by_source"].items():
        print(f"\n{source.upper()}: {len(detections)} detections")
        for detection in detections:
            # Avoid printing raw text from real identity documents.
            safe_record = {
                key: value
                for key, value in detection.items()
                if key not in {"text"}
            }
            print(safe_record)

    print("Detection pipeline completed.")
    print("Detection count:", len(result["detections"]))
    print("Stage errors:", result["stage_errors"])
    print(
        "Ready for privacy processing:",
        result["ready_for_privacy_processing"],
    )


if __name__ == "__main__":
    main()
