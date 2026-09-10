from __future__ import annotations

import re
import logging
from time import perf_counter
import uuid
from collections.abc import Awaitable, Callable


ASGIApp = Callable[
    [dict, Callable[[], Awaitable[dict]], Callable[[dict], Awaitable[None]]],
    Awaitable[None],
]
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{8,128}$")
logger = logging.getLogger("attendance.requests")


class OperationalHeadersMiddleware:
    """Attach correlation and defensive API headers without logging secrets."""

    def __init__(self, app: ASGIApp, *, production: bool = False):
        self.app = app
        self.production = production

    async def __call__(self, scope: dict, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        request_headers = {key.lower(): value for key, value in scope.get("headers", [])}
        supplied_request_id = request_headers.get(b"x-request-id", b"").decode(
            "ascii", errors="ignore"
        )
        request_id = (
            supplied_request_id
            if REQUEST_ID_PATTERN.fullmatch(supplied_request_id)
            else uuid.uuid4().hex
        )
        started_at = perf_counter()
        response_status = 500

        async def send_with_headers(message: dict) -> None:
            nonlocal response_status
            if message.get("type") == "http.response.start":
                response_status = int(message.get("status", 500))
                headers = list(message.get("headers", []))
                headers.extend(
                    (
                        (b"x-request-id", request_id.encode("ascii")),
                        (b"x-content-type-options", b"nosniff"),
                        (b"x-frame-options", b"DENY"),
                        (b"referrer-policy", b"no-referrer"),
                        (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                    )
                )
                if scope.get("path", "").startswith("/api/"):
                    headers.append((b"cache-control", b"no-store"))
                if self.production:
                    headers.append(
                        (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'")
                    )
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        finally:
            # Log only the route path, never query strings, request bodies,
            # credentials, OCR output, student IDs, or biometric material.
            logger.info(
                "request_completed request_id=%s method=%s path=%s status=%s duration_ms=%s",
                request_id,
                scope.get("method", ""),
                scope.get("path", ""),
                response_status,
                round((perf_counter() - started_at) * 1000, 1),
            )
