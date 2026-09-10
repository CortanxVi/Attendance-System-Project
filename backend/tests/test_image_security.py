import io
import os
import unittest

from fastapi import HTTPException
from PIL import Image
from starlette.datastructures import Headers, UploadFile


os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from services.light_ocr_service import read_validated_image


def png_upload(width: int, height: int) -> UploadFile:
    buffer = io.BytesIO()
    Image.new("1", (width, height), color=1).save(buffer, format="PNG", optimize=True)
    buffer.seek(0)
    return UploadFile(
        file=buffer,
        filename="test.png",
        headers=Headers({"content-type": "image/png"}),
    )


class ImageSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_compressed_image_above_pixel_limit_before_decode(self):
        upload = png_upload(5000, 5000)

        with self.assertRaises(HTTPException) as caught:
            await read_validated_image(upload, "ภาพทดสอบ")

        self.assertEqual(caught.exception.status_code, 413)

    async def test_accepts_normal_png(self):
        upload = png_upload(1280, 720)

        validated = await read_validated_image(upload, "ภาพทดสอบ")

        self.assertEqual(validated.content_type, "image/png")
        self.assertGreater(len(validated.content), 0)

    async def test_rejects_extreme_width_even_below_total_pixel_limit(self):
        upload = png_upload(5000, 100)

        with self.assertRaises(HTTPException) as caught:
            await read_validated_image(upload, "ภาพทดสอบ")

        self.assertEqual(caught.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
