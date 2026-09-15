import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from services.liveness_service import (
    create_attendance_liveness_challenge,
    create_liveness_challenge,
    verify_attendance_liveness_submission,
    verify_liveness_submission,
)
from services.light_ocr_service import OcrRateLimiter
from core.request_limits import SupportUploadLimitMiddleware
from main import app


class LivenessEvidenceSecurityTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.challenge = create_liveness_challenge(
            "challenge-1",
            "student-1",
            self.now + timedelta(minutes=1),
        )

    def evidence(self):
        return {
            "version": 3,
            "mode": "passive",
            "sampleCount": 3,
            "frames": [
                {"kind": "passive_sample", "sampleIndex": 1, "timestampMs": 1_500},
                {"kind": "passive_sample", "sampleIndex": 2, "timestampMs": 2_000},
                {"kind": "passive_sample", "sampleIndex": 3, "timestampMs": 2_500},
            ],
            "startedAtMs": 1_000,
            "completedAtMs": 2_600,
            "effectiveFps": 20,
        }

    def test_accepts_signed_complete_sequence(self):
        result = verify_liveness_submission(
            self.challenge.token,
            json.dumps(self.evidence()),
            "challenge-1",
            "student-1",
            now=self.now,
        )
        self.assertEqual(result.mode, "passive")
        self.assertEqual(result.sample_count, 3)

    def test_accepts_low_fps_attempt_but_rejects_over_20_seconds(self):
        evidence = self.evidence()
        evidence["effectiveFps"] = 8.2
        result = verify_liveness_submission(
            self.challenge.token,
            json.dumps(evidence),
            "challenge-1",
            "student-1",
            now=self.now,
        )
        self.assertEqual(result.total_duration_ms, 1_600)

        evidence["completedAtMs"] = 22_000
        with self.assertRaises(HTTPException):
            verify_liveness_submission(
                self.challenge.token,
                json.dumps(evidence),
                "challenge-1",
                "student-1",
                now=self.now,
            )

    def test_rejects_tampered_token_and_wrong_student(self):
        token = self.challenge.token
        tampered = f"{token[:-1]}{'A' if token[-1] != 'A' else 'B'}"
        with self.assertRaises(HTTPException):
            verify_liveness_submission(tampered, json.dumps(self.evidence()), "challenge-1", "student-1")
        with self.assertRaises(HTTPException):
            verify_liveness_submission(token, json.dumps(self.evidence()), "challenge-1", "student-2")

    def test_rejects_bad_sample_order_and_timing(self):
        evidence = self.evidence()
        evidence["frames"][1]["sampleIndex"] = 3
        with self.assertRaises(HTTPException):
            verify_liveness_submission(self.challenge.token, json.dumps(evidence), "challenge-1", "student-1", now=self.now)

        evidence = self.evidence()
        evidence["frames"][1]["timestampMs"] = 1_600
        with self.assertRaises(HTTPException):
            verify_liveness_submission(self.challenge.token, json.dumps(evidence), "challenge-1", "student-1", now=self.now)

    def test_rejects_client_attempt_to_reduce_signed_sample_count(self):
        evidence = self.evidence()
        evidence["sampleCount"] = 2
        with self.assertRaises(HTTPException):
            verify_liveness_submission(
                self.challenge.token,
                json.dumps(evidence),
                "challenge-1",
                "student-1",
                now=self.now,
            )

    def test_rejects_expired_token(self):
        with self.assertRaises(HTTPException):
            verify_liveness_submission(
                self.challenge.token,
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


class AttendanceHybridLivenessSecurityTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.challenge = create_attendance_liveness_challenge(
            "challenge-1",
            "student-1",
            "session-1",
            self.now + timedelta(minutes=1),
        )

    def evidence(self):
        prompt_delay = self.challenge.prompt_delay_ms
        action = self.challenge.action
        prompt_at = 2_500 + prompt_delay
        return {
            "version": 4,
            "mode": "hybrid",
            "sampleCount": 3,
            "action": action,
            "promptDelayMs": prompt_delay,
            "frames": [
                {"kind": "passive_sample", "sampleIndex": 1, "timestampMs": 1_500},
                {"kind": "passive_sample", "sampleIndex": 2, "timestampMs": 2_000},
                {"kind": "passive_sample", "sampleIndex": 3, "timestampMs": 2_500},
                {"kind": "challenge_action", "action": action, "timestampMs": prompt_at + 200},
                {"kind": "challenge_recovery", "action": action, "timestampMs": prompt_at + 500},
            ],
            "startedAtMs": 1_000,
            "promptAtMs": prompt_at,
            "completedAtMs": prompt_at + 600,
            "effectiveFps": 20,
        }

    def verify(self, evidence, **overrides):
        return verify_attendance_liveness_submission(
            self.challenge.token,
            json.dumps(evidence),
            overrides.get("challenge_id", "challenge-1"),
            overrides.get("student_id", "student-1"),
            overrides.get("session_id", "session-1"),
            now=self.now,
        )

    def test_accepts_signed_random_action_sequence(self):
        result = self.verify(self.evidence())
        self.assertEqual(result.mode, "hybrid")
        self.assertEqual(result.action, self.challenge.action)
        self.assertIn(self.challenge.action, ("blink", "move_closer"))
        self.assertGreaterEqual(self.challenge.prompt_delay_ms, 500)
        self.assertLessEqual(self.challenge.prompt_delay_ms, 1_400)

    def test_rejects_challenge_borrowed_by_another_student_or_session(self):
        for overrides in (
            {"student_id": "student-2"},
            {"session_id": "session-2"},
            {"challenge_id": "challenge-2"},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(HTTPException):
                self.verify(self.evidence(), **overrides)

    def test_rejects_client_action_substitution_and_early_action(self):
        evidence = self.evidence()
        replacement = "move_closer" if self.challenge.action == "blink" else "blink"
        evidence["action"] = replacement
        evidence["frames"][3]["action"] = replacement
        evidence["frames"][4]["action"] = replacement
        with self.assertRaises(HTTPException):
            self.verify(evidence)

        evidence = self.evidence()
        evidence["frames"][3]["timestampMs"] = evidence["promptAtMs"] - 1
        with self.assertRaises(HTTPException):
            self.verify(evidence)

    def test_rejects_protocol_v3_token_on_attendance_v4_path(self):
        passive = create_liveness_challenge(
            "challenge-1", "student-1", self.now + timedelta(minutes=1)
        )
        with self.assertRaises(HTTPException):
            verify_attendance_liveness_submission(
                passive.token,
                json.dumps(self.evidence()),
                "challenge-1",
                "student-1",
                "session-1",
                now=self.now,
            )


class LivenessApiContractTests(unittest.TestCase):
    def test_protocol_v4_attendance_requires_passive_and_random_action_frames(self):
        schema = app.openapi()
        request_schema = schema["paths"]["/api/v1/attendance/verify"]["post"]["requestBody"]["content"][
            "multipart/form-data"
        ]["schema"]
        reference = request_schema["$ref"].rsplit("/", 1)[-1]
        properties = schema["components"]["schemas"][reference]["properties"]
        self.assertIn("liveness_passive_images", properties)
        self.assertIn("liveness_action_image", properties)
        self.assertIn("liveness_recovery_image", properties)
        self.assertNotIn("id_card_image", properties)
        self.assertNotIn("liveness_blink_closed_images", properties)

    def test_student_face_enrollment_contract_accepts_server_verified_frame_set(self):
        schema = app.openapi()
        request_schema = schema["paths"]["/api/v1/enrollment/register-face"]["post"]["requestBody"]["content"][
            "multipart/form-data"
        ]["schema"]
        reference = request_schema["$ref"].rsplit("/", 1)[-1]
        properties = schema["components"]["schemas"][reference]["properties"]
        for name in (
            "enrollment_challenge_id",
            "liveness_token",
            "liveness_evidence",
            "liveness_passive_images",
        ):
            self.assertIn(name, properties)


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
