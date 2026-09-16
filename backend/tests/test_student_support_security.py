import io
import os
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from fastapi import HTTPException
from PIL import Image
from starlette.datastructures import Headers, UploadFile


os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from core.security import trusted_google_avatar_url
from core.security import AuthenticatedUser
from routers.support import _load_attachment_for_participant, _load_request_for_participant
from routers.support import download_support_attachment, preview_support_attachment
from services.student_support_service import (
    attachment_content_disposition,
    inline_content_disposition,
    normalized_image_name,
    read_validated_support_attachment,
    safe_original_name,
)
from core.request_limits import SupportUploadLimitMiddleware


def upload(content: bytes, filename: str, content_type: str) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


class StudentSupportAttachmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_accepts_verified_png(self):
        buffer = io.BytesIO()
        Image.new("RGB", (320, 180), color="white").save(buffer, format="PNG")
        result = await read_validated_support_attachment(
            upload(buffer.getvalue(), "evidence.png", "image/png")
        )
        self.assertEqual(result.content_type, "image/jpeg")
        self.assertEqual(result.extension, ".jpg")

    async def test_converts_common_raster_images_to_browser_safe_stills(self):
        for image_format, filename, mime in (
            ("GIF", "moving.gif", "image/gif"),
            ("BMP", "diagram.bmp", "image/bmp"),
            ("TIFF", "scan.tiff", "image/tiff"),
            ("AVIF", "scan.avif", "image/avif"),
            ("HEIF", "phone.heic", "image/heic"),
            ("ICO", "icon.ico", "image/x-icon"),
        ):
            with self.subTest(image_format=image_format):
                buffer = io.BytesIO()
                Image.new("RGB", (64, 64), color="white").save(buffer, format=image_format)
                result = await read_validated_support_attachment(
                    upload(buffer.getvalue(), filename, mime)
                )
                self.assertEqual(result.content_type, "image/jpeg")
                self.assertTrue(result.original_name.endswith(".jpg"))
                with Image.open(io.BytesIO(result.content)) as decoded:
                    self.assertEqual(decoded.format, "JPEG")

    async def test_strips_image_metadata_and_keeps_transparency(self):
        buffer = io.BytesIO()
        Image.new("RGBA", (64, 64), (255, 0, 0, 100)).save(
            buffer, format="PNG", pnginfo=self._private_png_metadata()
        )
        result = await read_validated_support_attachment(
            upload(buffer.getvalue(), "evidence.png", "image/png")
        )
        self.assertEqual(result.content_type, "image/png")
        with Image.open(io.BytesIO(result.content)) as decoded:
            self.assertEqual(decoded.mode, "RGBA")
            self.assertNotIn("student", decoded.info)

    @staticmethod
    def _private_png_metadata():
        from PIL.PngImagePlugin import PngInfo
        metadata = PngInfo()
        metadata.add_text("student", "private")
        return metadata

    async def test_rejects_svg_even_with_image_mime(self):
        with self.assertRaises(HTTPException) as caught:
            await read_validated_support_attachment(
                upload(b"<svg><script>alert(1)</script></svg>", "unsafe.svg", "image/svg+xml")
            )
        self.assertEqual(caught.exception.status_code, 415)

    def test_normalized_image_name_respects_database_length_limit(self):
        name = normalized_image_name("a" * 255, ".jpg")
        self.assertEqual(len(name), 255)
        self.assertTrue(name.endswith(".jpg"))

    async def test_rejects_mime_type_that_does_not_match_image(self):
        buffer = io.BytesIO()
        Image.new("RGB", (64, 64), color="white").save(buffer, format="PNG")
        with self.assertRaises(HTTPException) as caught:
            await read_validated_support_attachment(
                upload(buffer.getvalue(), "renamed.jpg", "image/jpeg")
            )
        self.assertEqual(caught.exception.status_code, 400)

    async def test_rejects_image_above_decoded_pixel_limit(self):
        buffer = io.BytesIO()
        Image.new("1", (8192, 8192), color=1).save(buffer, format="PNG", optimize=True)
        with self.assertRaises(HTTPException) as caught:
            await read_validated_support_attachment(
                upload(buffer.getvalue(), "compressed.png", "image/png")
            )
        self.assertEqual(caught.exception.status_code, 413)

    async def test_rejects_pdf_with_active_content(self):
        malicious_pdf = b"%PDF-1.7\n1 0 obj << /JavaScript (alert) >> endobj\n%%EOF"
        with self.assertRaises(HTTPException) as caught:
            await read_validated_support_attachment(
                upload(malicious_pdf, "unsafe.pdf", "application/pdf")
            )
        self.assertEqual(caught.exception.status_code, 400)

    async def test_accepts_structurally_bounded_pdf(self):
        result = await read_validated_support_attachment(
            upload(b"%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF", "note.pdf", "application/pdf")
        )
        self.assertEqual(result.content_type, "application/pdf")

    def test_filename_drops_path_and_control_characters(self):
        self.assertEqual(safe_original_name("../../bad\r\nname.pdf"), "badname.pdf")
        self.assertEqual(safe_original_name(r"..\\windows\\name.pdf"), "name.pdf")

    def test_content_disposition_preserves_utf8_without_header_injection(self):
        header = inline_content_disposition('หลักฐาน\r\n".pdf')
        self.assertNotIn("\r", header)
        self.assertNotIn("\n", header)
        self.assertIn("filename*=UTF-8''", header)
        download_header = attachment_content_disposition('หลักฐาน\r\n".pdf')
        self.assertTrue(download_header.startswith("attachment;"))
        self.assertNotIn("\r", download_header)
        self.assertNotIn("\n", download_header)


class GoogleAvatarUrlTests(unittest.TestCase):
    def test_accepts_googleusercontent_https_url(self):
        url = "https://lh3.googleusercontent.com/a/example=s96-c"
        self.assertEqual(trusted_google_avatar_url({"picture": url}), url)

    def test_rejects_lookalike_or_insecure_avatar_hosts(self):
        self.assertIsNone(trusted_google_avatar_url({"picture": "https://googleusercontent.com.evil.example/a"}))
        self.assertIsNone(trusted_google_avatar_url({"picture": "http://lh3.googleusercontent.com/a"}))
        self.assertIsNone(trusted_google_avatar_url({"avatar_url": "https://evil.example/tracker"}))


class SupportParticipantAuthorizationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.user = AuthenticatedUser(
            id="11111111-1111-1111-1111-111111111111",
            email="student@email.kmutnb.ac.th",
            role="student",
            base_role="student",
            auth_session_id="test-session",
        )

    def test_rejects_user_outside_request_participants(self):
        response = SimpleNamespace(data=[{
            "id": "request-id",
            "student_id": "22222222-2222-2222-2222-222222222222",
            "teacher_id": "33333333-3333-3333-3333-333333333333",
        }])
        with patch("routers.support._request_query", return_value=response):
            with self.assertRaises(HTTPException) as caught:
                _load_request_for_participant("request-id", self.user)
        self.assertEqual(caught.exception.status_code, 403)

    def test_accepts_student_who_owns_request(self):
        row = {
            "id": "request-id",
            "student_id": self.user.id,
            "teacher_id": "33333333-3333-3333-3333-333333333333",
        }
        with patch("routers.support._request_query", return_value=SimpleNamespace(data=[row])):
            self.assertEqual(_load_request_for_participant("request-id", self.user), row)

    async def test_download_uses_same_participant_gate_as_preview(self):
        import uuid
        attachment_id = uuid.uuid4()
        attachment = {"content_type": "application/pdf", "original_name": "evidence.pdf"}
        with patch(
            "routers.support._load_attachment_for_participant",
            return_value=(attachment, b"%PDF-1.4\n%%EOF"),
        ) as load:
            download = await download_support_attachment(attachment_id, self.user)
            preview = await preview_support_attachment(attachment_id, self.user)
        self.assertEqual(load.call_count, 2)
        self.assertTrue(download.headers["content-disposition"].startswith("attachment;"))
        self.assertTrue(preview.headers["content-disposition"].startswith("inline;"))

    def test_attachment_bytes_are_not_loaded_for_nonparticipant(self):
        import uuid
        attachment_id = uuid.uuid4()
        with patch("routers.support.supabase") as supabase_client, patch(
            "routers.support._load_request_for_participant",
            side_effect=HTTPException(status_code=403, detail="forbidden"),
        ):
            supabase_client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = [
                SimpleNamespace(data=[{"message_id": "message-id", "storage_path": "private/path"}]),
                SimpleNamespace(data=[{"request_id": "request-id"}]),
            ]
            with self.assertRaises(HTTPException) as caught:
                _load_attachment_for_participant(attachment_id, self.user)
            self.assertEqual(caught.exception.status_code, 403)
            supabase_client.storage.from_.assert_not_called()


class SupportUploadLimitMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_chunked_body_before_app_receives_oversized_payload(self):
        app_called = False

        async def app(_scope, receive, _send):
            nonlocal app_called
            app_called = True
            while (await receive()).get("more_body"):
                pass

        chunks = iter([
            {"type": "http.request", "body": b"1234", "more_body": True},
            {"type": "http.request", "body": b"5678", "more_body": False},
        ])
        sent = []

        async def receive():
            return next(chunks)

        async def send(message):
            sent.append(message)

        middleware = SupportUploadLimitMiddleware(app, max_bytes=6)
        await middleware(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/v1/support/requests",
                "headers": [],
            },
            receive,
            send,
        )
        self.assertTrue(app_called)
        self.assertEqual(sent[0]["status"], 413)

    async def test_rejects_large_content_length_without_calling_app(self):
        app_called = False

        async def app(_scope, _receive, _send):
            nonlocal app_called
            app_called = True

        sent = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        middleware = SupportUploadLimitMiddleware(app, max_bytes=6)
        await middleware(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/v1/support/requests/request-id/messages",
                "headers": [(b"content-length", b"7")],
            },
            receive,
            send,
        )
        self.assertFalse(app_called)
        self.assertEqual(sent[0]["status"], 413)


if __name__ == "__main__":
    unittest.main()
