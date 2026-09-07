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
        started_at = 1_000
        movement_started = 1_100
        peak_at = 1_350
        returned_at = 1_650
        prompt_at = returned_at + self.challenge.prompt_delay_ms
        blinks = []
        frames = [
            {"kind": "baseline_open", "timestampMs": started_at},
            {"kind": "near", "timestampMs": peak_at},
            {"kind": "returned", "timestampMs": returned_at},
        ]
        cursor = prompt_at + 100
        for index in range(1, self.challenge.required_blinks + 1):
            blinks.append({
                "action": "blink",
                "blinkIndex": index,
                "closedAtMs": cursor,
                "reopenedAtMs": cursor + 150,
                "durationMs": 150,
                "minLeftEyeRatio": 0.58,
                "minRightEyeRatio": 0.60,
            })
            frames.extend((
                {"kind": "blink_closed", "timestampMs": cursor + 50, "blinkIndex": index},
                {"kind": "blink_open", "timestampMs": cursor + 150, "blinkIndex": index},
            ))
            cursor += 250
        completed_at = cursor + 100
        frames.append({"kind": "final_open", "timestampMs": completed_at})
        return {
            "version": 2,
            "actions": list(self.challenge.actions),
            "requiredBlinks": self.challenge.required_blinks,
            "promptDelayMs": self.challenge.prompt_delay_ms,
            "movement": {
                "action": "move_closer",
                "startedAtMs": movement_started,
                "peakAtMs": peak_at,
                "completedAtMs": returned_at,
                "baselineScale": 0.40,
                "peakScale": 0.48,
                "returnedScale": 0.41,
            },
            "blinks": blinks,
            "frames": frames,
            "startedAtMs": started_at,
            "promptAtMs": prompt_at,
            "completedAtMs": completed_at,
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
        self.assertEqual(result.actions, ("move_closer", "blink"))
        self.assertEqual(result.required_blinks, self.challenge.required_blinks)

    def test_accepts_slow_valid_attempt_but_rejects_over_45_seconds(self):
        evidence = self.evidence()
        evidence["effectiveFps"] = 8.2
        evidence["completedAtMs"] = 41_000
        evidence["frames"][-1]["timestampMs"] = 41_000
        result = verify_liveness_submission(
            self.challenge.token,
            json.dumps(evidence),
            "challenge-1",
            "student-1",
            now=self.now,
        )
        self.assertEqual(result.total_duration_ms, 40_000)

        evidence["completedAtMs"] = 46_100
        evidence["frames"][-1]["timestampMs"] = 46_100
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

    def test_rejects_static_scale_and_one_eye_blink(self):
        evidence = self.evidence()
        evidence["movement"]["peakScale"] = 0.41
        with self.assertRaises(HTTPException):
            verify_liveness_submission(self.challenge.token, json.dumps(evidence), "challenge-1", "student-1", now=self.now)

        evidence = self.evidence()
        evidence["blinks"][0]["minRightEyeRatio"] = 0.90
        with self.assertRaises(HTTPException):
            verify_liveness_submission(self.challenge.token, json.dumps(evidence), "challenge-1", "student-1", now=self.now)

    def test_rejects_client_attempt_to_reduce_signed_blink_count(self):
        evidence = self.evidence()
        evidence["requiredBlinks"] = 1 if self.challenge.required_blinks == 2 else 2
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


class LivenessApiContractTests(unittest.TestCase):
    def test_protocol_v2_upload_contract_has_no_legacy_turn_frame(self):
        schema = app.openapi()
        request_schema = schema["paths"]["/api/v1/attendance/verify"]["post"]["requestBody"]["content"][
            "multipart/form-data"
        ]["schema"]
        reference = request_schema["$ref"].rsplit("/", 1)[-1]
        properties = schema["components"]["schemas"][reference]["properties"]
        self.assertIn("liveness_near_image", properties)
        self.assertIn("liveness_return_image", properties)
        self.assertIn("liveness_blink_closed_images", properties)
        self.assertIn("liveness_blink_open_images", properties)
        self.assertNotIn("liveness_turn_image", properties)
        self.assertNotIn("liveness_blink_image", properties)


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
