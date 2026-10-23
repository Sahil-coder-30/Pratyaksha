#             $env:USE_TF = "0"
#             python -m ML.src.privacy.screenshot_sanitizer


from pathlib import Path
from typing import Any, Mapping

from PIL import Image, ImageDraw, ImageFont


class ScreenshotSanitizer:
    """
    Masks sensitive regions in a screenshot and labels them with
    session-local entity IDs.

    Expected bounding-box format:
        [x1, y1, x2, y2]

    Coordinates must refer to the original screenshot's pixel space.
    """

    def __init__(
        self,
        mask_color: tuple[int, int, int] = (0, 0, 0),
        label_color: tuple[int, int, int] = (255, 255, 255),
        label_background: tuple[int, int, int] = (35, 35, 35),
        padding: int = 2,
        label_height: int = 20,
    ):
        self.mask_color = mask_color
        self.label_color = label_color
        self.label_background = label_background
        self.padding = max(0, padding)
        self.label_height = max(14, label_height)

    @staticmethod
    def _load_font(size: int = 12):
        try:
            return ImageFont.truetype("arial.ttf", size)
        except OSError:
            return ImageFont.load_default()

    @staticmethod
    def _validate_bbox(
        bbox: Any,
        image_width: int,
        image_height: int,
    ) -> tuple[int, int, int, int] | None:
        """
        Validate and clip a bounding box to the image boundaries.
        Returns None for malformed or unusable boxes.
        """
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            return None

        if any(
            isinstance(value, bool) or not isinstance(value, (int, float))
            for value in bbox
        ):
            return None

        x1, y1, x2, y2 = bbox

        # Reject non-finite values.
        import math

        if not all(math.isfinite(value) for value in bbox):
            return None

        # Reject reversed/zero-area boxes before clipping.
        if x2 <= x1 or y2 <= y1:
            return None

        # Clip the box to the image dimensions.
        x1 = max(0, min(image_width - 1, int(x1)))
        y1 = max(0, min(image_height - 1, int(y1)))
        x2 = max(0, min(image_width - 1, int(x2)))
        y2 = max(0, min(image_height - 1, int(y2)))

        if x2 <= x1 or y2 <= y1:
            return None

        return x1, y1, x2, y2

    def sanitize(
        self,
        image_path: str | Path,
        privacy_plan: Mapping[str, Any],
        output_path: str | Path,
    ) -> dict[str, Any]:
        """
        Apply every valid mask region from a privacy plan.

        This method does not modify the original image.

        Returns metadata only; it does not return raw detected text.
        """
        if not isinstance(privacy_plan, Mapping):
            raise TypeError("privacy_plan must be a mapping")

        if not privacy_plan.get("ready_for_sanitization", False):
            raise ValueError(
                "Privacy plan is not marked ready for sanitization."
            )

        regions = privacy_plan.get("mask_regions", [])
        if not isinstance(regions, list):
            raise TypeError("privacy_plan['mask_regions'] must be a list")

        image_path = Path(image_path)
        output_path = Path(output_path)

        if not image_path.is_file():
            raise FileNotFoundError(f"Input screenshot not found: {image_path}")

        # Convert to RGB so the output is a predictable, non-transparent image.
        with Image.open(image_path) as source:
            image = source.convert("RGB")

        width, height = image.size
        draw = ImageDraw.Draw(image)
        font = self._load_font()
        applied = []
        rejected = []

        for index, region in enumerate(regions):
            if not isinstance(region, Mapping):
                rejected.append(index)
                continue

            if region.get("action") != "mask":
                continue

            entity_id = region.get("entity_id")
            bbox = self._validate_bbox(region.get("bbox"), width, height)

            if not isinstance(entity_id, str) or not entity_id.strip() or bbox is None:
                rejected.append(index)
                continue

            x1, y1, x2, y2 = bbox
            pad = self.padding

            # Opaque rectangle: the original pixels in this region are replaced.
            mask_box = (
                max(0, x1 - pad),
                max(0, y1 - pad),
                min(width - 1, x2 + pad),
                min(height - 1, y2 + pad),
            )
            draw.rectangle(mask_box, fill=self.mask_color)

            # Draw an entity ID label just above the masked area where possible.
            label = f"[{entity_id}]"
            label_bbox = draw.textbbox((0, 0), label, font=font)
            text_width = label_bbox[2] - label_bbox[0]
            text_height = label_bbox[3] - label_bbox[1]

            label_x = max(0, min(x1, width - text_width - 4))
            label_y = y1 - self.label_height

            if label_y < 0:
                label_y = min(height - text_height - 4, y2 + 2)

            label_y = max(0, label_y)

            background_box = (
                label_x,
                label_y,
                min(width - 1, label_x + text_width + 4),
                min(height - 1, label_y + text_height + 4),
            )

            draw.rectangle(background_box, fill=self.label_background)
            draw.text(
                (label_x + 2, label_y + 2),
                label,
                fill=self.label_color,
                font=font,
            )

            applied.append({
                "entity_id": entity_id,
                "bbox": list(mask_box),
            })

        # Fail closed: don't produce an output if any requested mask was invalid.
        if rejected:
            raise ValueError(
                f"Sanitization aborted: {len(rejected)} mask region(s) "
                "were invalid. No output was saved."
            )

        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Save to a temporary file first, then replace the destination.
        temporary_path = output_path.with_name(
            f"{output_path.stem}.tmp{output_path.suffix}"
        )
        try:
            image.save(temporary_path, format="PNG")
            temporary_path.replace(output_path)
        finally:
            if temporary_path.exists():
                temporary_path.unlink()

        return {
            "output_path": str(output_path),
            "image_width": width,
            "image_height": height,
            "mask_count": len(applied),
            "masked_entity_ids": list(
                dict.fromkeys(item["entity_id"] for item in applied)
            ),
            "rejected_region_count": len(rejected),
            "sanitization_completed": True,
        }
