from collections.abc import Awaitable, Callable

from core.config import (
    ATTENDANCE_VERIFY_REQUEST_MAX_BYTES,
    OCR_UPLOAD_REQUEST_MAX_BYTES,
    ROSTER_IMPORT_REQUEST_MAX_BYTES,
    SUPPORT_UPLOAD_REQUEST_MAX_BYTES,
)


ASGIApp = Callable[[dict, Callable[[], Awaitable[dict]], Callable[[dict], Awaitable[None]]], Awaitable[None]]


class RequestBodyTooLarge(Exception):
    pass


def _is_support_upload(scope: dict) -> bool:
    if scope.get("type") != "http" or scope.get("method") != "POST":
        return False
    path = scope.get("path", "").rstrip("/")
    if path == "/api/v1/support/requests":
        return True
    parts = path.split("/")
    return (
        len(parts) == 7
        and parts[:5] == ["", "api", "v1", "support", "requests"]
        and parts[6] == "messages"
        and bool(parts[5])
    )


def _is_roster_import(scope: dict) -> bool:
    if scope.get("type") != "http" or scope.get("method") != "POST":
        return False
    parts = scope.get("path", "").rstrip("/").split("/")
    return (
        len(parts) == 9
        and parts[:5] == ["", "api", "v1", "teacher", "courses"]
        and bool(parts[5])
        and parts[6:8] == ["roster", "import"]
        and parts[8] in {"preview", "commit"}
    )


def _is_student_card_ocr(scope: dict) -> bool:
    return (
        scope.get("type") == "http"
        and scope.get("method") == "POST"
        and scope.get("path", "").rstrip("/") == "/api/v1/ocr/student-card"
    )


def _is_attendance_verify(scope: dict) -> bool:
    return (
        scope.get("type") == "http"
        and scope.get("method") == "POST"
        and scope.get("path", "").rstrip("/") == "/api/v1/attendance/verify"
    )


def _is_face_enrollment(scope: dict) -> bool:
    return (
        scope.get("type") == "http"
        and scope.get("method") == "POST"
        and scope.get("path", "").rstrip("/") == "/api/v1/enrollment/register-face"
    )


def _is_face_enrollment_challenge(scope: dict) -> bool:
    return (
        scope.get("type") == "http"
        and scope.get("method") == "POST"
        and scope.get("path", "").rstrip("/") == "/api/v1/enrollment/liveness-challenge"
    )


class SupportUploadLimitMiddleware:
    """Reject oversized multipart bodies before Starlette spools files."""

    def __init__(
        self,
        app: ASGIApp,
        max_bytes: int = SUPPORT_UPLOAD_REQUEST_MAX_BYTES,
        roster_max_bytes: int = ROSTER_IMPORT_REQUEST_MAX_BYTES,
        ocr_max_bytes: int = OCR_UPLOAD_REQUEST_MAX_BYTES,
        attendance_max_bytes: int = ATTENDANCE_VERIFY_REQUEST_MAX_BYTES,
    ):
        self.app = app
        self.max_bytes = max_bytes
        self.roster_max_bytes = roster_max_bytes
        self.ocr_max_bytes = ocr_max_bytes
        self.attendance_max_bytes = attendance_max_bytes

    async def __call__(self, scope: dict, receive, send) -> None:
        support_upload = _is_support_upload(scope)
        roster_import = _is_roster_import(scope)
        student_card_ocr = _is_student_card_ocr(scope)
        attendance_verify = _is_attendance_verify(scope)
        face_enrollment = _is_face_enrollment(scope)
        face_enrollment_challenge = _is_face_enrollment_challenge(scope)
        if not any((support_upload, roster_import, student_card_ocr, attendance_verify, face_enrollment, face_enrollment_challenge)):
            await self.app(scope, receive, send)
            return
        if support_upload:
            active_limit = self.max_bytes
        elif roster_import:
            active_limit = self.roster_max_bytes
        elif student_card_ocr or face_enrollment_challenge:
            active_limit = self.ocr_max_bytes
        elif attendance_verify or face_enrollment:
            active_limit = self.attendance_max_bytes

        headers = {
            key.lower(): value
            for key, value in scope.get("headers", [])
        }
        raw_length = headers.get(b"content-length")
        if raw_length is not None:
            try:
                if int(raw_length) > active_limit:
                    await self._send_too_large(send, active_limit)
                    return
            except ValueError:
                # The HTTP server normally rejects malformed Content-Length.
                # The streamed-byte counter below remains the source of truth.
                pass

        received = 0
        response_started = False

        async def limited_receive() -> dict:
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > active_limit:
                    raise RequestBodyTooLarge
            return message

        async def tracked_send(message: dict) -> None:
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except RequestBodyTooLarge:
            if response_started:
                raise
            await self._send_too_large(send, active_limit)

    @staticmethod
    async def _send_too_large(send, active_limit: int) -> None:
        limit_mib = active_limit // (1024 * 1024)
        body = (
            f'{{"detail":"ข้อมูลอัปโหลดรวมมีขนาดเกินกำหนด {limit_mib} MB"}}'
        ).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"x-content-type-options", b"nosniff"),
            ],
        })
        await send({"type": "http.response.body", "body": body})
