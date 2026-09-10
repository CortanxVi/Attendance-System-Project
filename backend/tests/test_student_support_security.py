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
from routers.support import _load_request_for_participant
from services.student_support_service import (
    inline_content_disposition,
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
        self.assertEqual(result.content_type, "image/png")
        self.assertEqual(result.extension, ".png")

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


class GoogleAvatarUrlTests(unittest.TestCase):
    def test_accepts_googleusercontent_https_url(self):
        url = "https://lh3.googleusercontent.com/a/example=s96-c"
        self.assertEqual(trusted_google_avatar_url({"picture": url}), url)

    def test_rejects_lookalike_or_insecure_avatar_hosts(self):
        self.assertIsNone(trusted_google_avatar_url({"picture": "https://googleusercontent.com.evil.example/a"}))
        self.assertIsNone(trusted_google_avatar_url({"picture": "http://lh3.googleusercontent.com/a"}))
        self.assertIsNone(trusted_google_avatar_url({"avatar_url": "https://evil.example/tracker"}))


class SupportParticipantAuthorizationTests(unittest.TestCase):
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
