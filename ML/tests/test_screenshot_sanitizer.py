#             cd BigFish
#             $env:USE_TF = "0"
#             python -m ML.tests.test_screenshot_sanitizer 


from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image

from ML.src.privacy.screenshot_sanitizer import ScreenshotSanitizer


def main():
    with TemporaryDirectory() as temp_dir:
        temp = Path(temp_dir)
        source_path = temp / "synthetic_input.png"
        output_path = temp / "sanitized_output.png"

        # Create a synthetic image with a white background.
        source = Image.new("RGB", (300, 160), "white")

        # Simulate text by placing a dark rectangle in the region to mask.
        source_draw = __import__("PIL.ImageDraw", fromlist=["Draw"]).Draw(source)
        source_draw.rectangle((40, 50, 180, 90), fill=(20, 20, 20))
        source.save(source_path)

        plan = {
            "ready_for_sanitization": True,
            "mask_regions": [
                {
                    "entity_id": "ENTITY_0001",
                    "bbox": [40, 50, 180, 90],
                    "action": "mask",
                }
            ],
        }

        sanitizer = ScreenshotSanitizer()
        result = sanitizer.sanitize(
            source_path,
            plan,
            output_path,
        )

        assert output_path.is_file()
        assert result["sanitization_completed"] is True
        assert result["mask_count"] == 1
        assert "ENTITY_0001" in result["masked_entity_ids"]

        # Check a pixel inside the masked region is now opaque black.
        with Image.open(output_path) as sanitized:
            assert sanitized.convert("RGB").getpixel((100, 70)) == (0, 0, 0)

        # Confirm the source image was not modified.
        with Image.open(source_path) as original:
            assert original.convert("RGB").getpixel((100, 70)) == (20, 20, 20)

        print("Screenshot sanitizer test passed.")
        print(f"Mask count: {result['mask_count']}")
        print(f"Output dimensions: {result['image_width']}x{result['image_height']}")
        print("Original image unchanged: True")


def test_screenshot_sanitizer():
    main()


if __name__ == "__main__":
    main()
