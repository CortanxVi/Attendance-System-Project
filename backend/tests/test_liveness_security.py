import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from services.liveness_service import create_liveness_challenge, verify_liveness_submission
from services.light_ocr_service import OcrRateLimiter
from core.request_limits import SupportUploadLimitMiddleware


class LivenessEvidenceSecurityTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.token, self.actions = create_liveness_challenge(
            "challenge-1",
            "student-1",
            self.now + timedelta(minutes=1),
        )

    def evidence(self):
        events = []
        for action in self.actions:
            events.append({
                "action": action,
                "durationMs": 120 if action == "blink" else 250,
                "eyeRatio": 0.60,
                "yawDelta": 0 if action == "blink" else (-0.15 if action == "turn_left" else 0.15),
                "pitchDelta": 0.01,
            })
        return {
            "version": 1,
            "actions": self.actions,
            "events": events,
            "startedAtMs": 1000,
            "completedAtMs": 1800,
        }

    def test_accepts_signed_complete_sequence(self):
        result = verify_liveness_submission(
            self.token,
            json.dumps(self.evidence()),
            "challenge-1",
            "student-1",
            now=self.now,
        )
        self.assertIn(result.turn_action, {"turn_left", "turn_right"})

    def test_rejects_tampered_token_and_wrong_student(self):
        tampered = f"{self.token[:-1]}{'A' if self.token[-1] != 'A' else 'B'}"
        with self.assertRaises(HTTPException):
            verify_liveness_submission(tampered, json.dumps(self.evidence()), "challenge-1", "student-1")
        with self.assertRaises(HTTPException):
            verify_liveness_submission(self.token, json.dumps(self.evidence()), "challenge-1", "student-2")

    def test_rejects_nod_as_turn_and_one_eye_blink(self):
        evidence = self.evidence()
        for event in evidence["events"]:
            if event["action"] != "blink":
                event["yawDelta"] = 0.01
                event["pitchDelta"] = 0.20
        with self.assertRaises(HTTPException):
            verify_liveness_submission(self.token, json.dumps(evidence), "challenge-1", "student-1", now=self.now)

        evidence = self.evidence()
        next(event for event in evidence["events"] if event["action"] == "blink")["eyeRatio"] = 0.90
        with self.assertRaises(HTTPException):
            verify_liveness_submission(self.token, json.dumps(evidence), "challenge-1", "student-1", now=self.now)

    def test_rejects_expired_token(self):
        with self.assertRaises(HTTPException):
            verify_liveness_submission(
                self.token,
                json.dumps(self.evidence()),
                "challenge-1",
                "student-1",
                now=self.now + timedelta(minutes=2),
            )


class AtomicFaceAttendanceMigrationTests(unittest.TestCase):
    def test_rpc_is_backend_only_and_consumes_after_insert(self):
        migration_dir = Path(__file__).parents[2] / "supabase" / "migrations"
        sql = "\n".join(
            (migration_dir / filename).read_text(encoding="utf-8").lower()
            for filename in (
                "20260902065653_finalize_face_attendance.sql",
                "20260902072732_claim_face_attendance_challenge.sql",
                "20260902150753_renew_face_attendance_claim.sql",
            )
        )
        self.assertIn("revoke all on function public.finalize_face_attendance", sql)
        self.assertIn("from public, anon, authenticated", sql)
        self.assertIn("to service_role", sql)
        self.assertLess(sql.index("insert into public.attendance_records"), sql.index("set consumed_at = checked_in_at"))
        self.assertIn("for update", sql)
        self.assertIn("on conflict (session_id, student_id) do nothing", sql)
        self.assertIn("processing_token is distinct from claim_token", sql)
        self.assertIn("claim_face_attendance_challenge", sql)
        self.assertIn("release_face_attendance_challenge", sql)
        self.assertIn("renew_face_attendance_challenge", sql)


class OcrFairUseTests(unittest.TestCase):
    def test_standalone_ocr_limit_is_per_authenticated_user(self):
        limiter = OcrRateLimiter(limit=2, window_seconds=60)
        limiter.check("student-a")
        limiter.check("student-a")
        limiter.check("student-b")
        with self.assertRaises(HTTPException) as caught:
            limiter.check("student-a")
        self.assertEqual(caught.exception.status_code, 429)

    def test_limiter_bounds_remembered_user_keys(self):
        limiter = OcrRateLimiter(limit=2, window_seconds=60, max_keys=2)
        limiter.check("student-a")
        limiter.check("student-b")
        limiter.check("student-c")
        self.assertLessEqual(len(limiter._events), 2)


class AttendanceUploadBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_verify_body_is_rejected_before_multipart_parser(self):
        app_called = False

        async def app(_scope, _receive, _send):
            nonlocal app_called
            app_called = True

        sent = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        middleware = SupportUploadLimitMiddleware(app, attendance_max_bytes=100)
        await middleware(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/v1/attendance/verify",
                "headers": [(b"content-length", b"101")],
            },
            receive,
            send,
        )
        self.assertFalse(app_called)
        self.assertEqual(sent[0]["status"], 413)


if __name__ == "__main__":
    unittest.main()
