"""Behavioural tests of the blink -> move_closer fallback through the real FastAPI endpoints.

The database, the QR claim RPCs, image decoding and the frame verifier are replaced by small
in-memory fakes; the routing, dependency, token signing/verification, fallback store, retry
challenge construction and the JSON response shape are the real code.
"""

import asyncio
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

import main
from core import security
from services import action_fallback as af
from services import liveness_service as ls
from services.liveness_frame_service import BlinkActionFailure, VerifiedLivenessFrames

USER = security.AuthenticatedUser(
    id="user-1", role="student", base_role="student", student_id="1234567890123", auth_session_id="s"
)
OTHER = security.AuthenticatedUser(
    id="user-2", role="student", base_role="student", student_id="1234567890124", auth_session_id="s2"
)
SESSION_ID = "session-1"
CHALLENGE_ID = "challenge-1"


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def gte(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def update(self, *_a, **_k):
        return self

    def insert(self, row):
        self.db.inserted.append((self.table, row))
        return self

    def execute(self):
        rows = [row for row in self.db.tables.get(self.table, [])
                if all(row.get(key, value) == value for key, value in self.filters)]
        return SimpleNamespace(data=[dict(row) for row in rows])


class FakeDb:
    def __init__(self, claim_seconds=400, session_status="open", consumed=False):
        self.expires_at = datetime.now(timezone.utc) + timedelta(seconds=claim_seconds)
        self.tables = {
            "attendance_checkin_challenges": [{
                "id": CHALLENGE_ID, "session_id": SESSION_ID, "student_id": USER.id,
                "expires_at": self.expires_at.isoformat(), "consumed_at": "x" if consumed else None,
            }],
            "attendance_sessions": [{
                "id": SESSION_ID, "course_id": "course-1", "status": session_status, "archived_at": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "courses": {"course_code": "CS101", "course_name": "Intro",
                            "late_threshold_minutes": 15, "absent_threshold_minutes": 45},
            }],
            "profiles": [{"id": USER.id, "student_id": USER.student_id, "full_name": "Student",
                          "face_embedding": [1.0, 0.0]}],
        }
        self.inserted = []

    def table(self, name):
        return _Query(self, name)


def fake_verify_submission(token, _evidence, challenge_id, student_id, session_id):
    payload = ls._decode_and_verify_token(token)  # real signature check
    if (payload["challenge_id"], payload["student_id"], payload.get("session_id")) != (challenge_id, student_id, session_id):
        raise HTTPException(status_code=403, detail="binding")
    return SimpleNamespace(action=payload["action"], sample_count=3)


async def fake_read(upload, _label):
    return SimpleNamespace(content=b"x")


async def fake_keep_alive(*_a):
    await asyncio.sleep(3600)


class Harness:
    """Patch everything around the endpoint; ``verifier`` decides what the frame check does."""

    def __init__(self, db, verifier, store, test_course=False, user=USER):
        self.db, self.store = db, store
        self.verifier_calls = []
        self.recorded = []

        def verify_frames(*args, on_blink_passed=None, **_kwargs):
            self.verifier_calls.append(args[3])
            return verifier(args[3], on_blink_passed)

        self.patches = [
            patch.object(main, "supabase", db),
            patch.object(main, "verify_attendance_liveness_submission", fake_verify_submission),
            patch.object(main, "require_course_enrollment", lambda *_a: None),
            patch.object(main, "claim_face_attendance_challenge", lambda *_a: None),
            patch.object(main, "release_face_attendance_challenge", lambda *_a: None),
            patch.object(main, "keep_face_attendance_claim_alive", fake_keep_alive),
            patch.object(main, "read_validated_image", fake_read),
            patch.object(main, "prepare_face_image", lambda _c: np.zeros((8, 8, 3), np.uint8)),
            patch.object(main, "verify_hybrid_liveness_frames", verify_frames),
            patch.object(main.face_service, "calculate_similarity", return_value=0.9),
            patch.object(main, "finalize_face_attendance", lambda **_k: {"result": "created"}),
            patch.object(main, "is_test_course", lambda _c: test_course),
            patch.object(main, "record_face_attempt", lambda **k: self.recorded.append(k)),
            patch.object(main, "action_fallback", store),
            patch.object(ls, "action_fallback", store),
        ]
        self.user = user

    def __enter__(self):
        for item in self.patches:
            item.start()
        main.app.dependency_overrides[security.get_current_user] = lambda: self.user
        self.client = TestClient(main.app, base_url="http://localhost")
        return self

    def __exit__(self, *exc):
        main.app.dependency_overrides.pop(security.get_current_user, None)
        for item in reversed(self.patches):
            item.stop()

    def token(self, action):
        with patch.object(self.store, "forced_action", lambda _u: action):
            return ls.create_attendance_liveness_challenge(CHALLENGE_ID, self.user.id, SESSION_ID, self.db.expires_at).token

    def verify(self, token):
        files = [("liveness_passive_images", (f"p{i}.jpg", b"x", "image/jpeg")) for i in range(3)]
        files += [("liveness_action_image", ("a.jpg", b"x", "image/jpeg")),
                  ("liveness_recovery_image", ("r.jpg", b"x", "image/jpeg"))]
        data = {"challenge_id": CHALLENGE_ID, "liveness_token": token, "liveness_evidence": "{}"}
        return self.client.post("/api/v1/attendance/verify", data=data, files=files)


def blink_fails(action, _on_pass):
    if action == "blink":
        raise BlinkActionFailure(status_code=422, detail="คำสั่งกะพริบตาไม่ผ่าน กรุณาหลับตา")
    return VerifiedLivenessFrames(final_embedding=np.asarray([1.0, 0.0], np.float32))


class RetryChallengeEndpointTests(unittest.TestCase):
    def test_second_blink_failure_returns_a_move_closer_retry_for_the_same_claim(self):
        store = af.ActionFallbackStore()
        with Harness(FakeDb(), blink_fails, store) as h:
            blink_token = h.token("blink")
            first = h.verify(blink_token)
            self.assertEqual(first.status_code, 422)
            self.assertIsInstance(first.json()["detail"], str)
            self.assertIsNone(first.json().get("retry_challenge"))
            second = h.verify(blink_token)
            self.assertEqual(second.status_code, 422)
            body = second.json()
            self.assertIn("คำสั่งกะพริบตาไม่ผ่าน", body["detail"])
            retry = body["retry_challenge"]
            self.assertEqual(retry["liveness_action"], "move_closer")
            self.assertEqual((retry["challenge_id"], retry["session_id"]), (CHALLENGE_ID, SESSION_ID))
            self.assertLessEqual(datetime.fromisoformat(retry["challenge_expires_at"]), h.db.expires_at)
            self.assertLessEqual(retry["challenge_ttl_seconds"], 400)
            self.assertEqual((retry["course_code"], retry["course_name"]), ("CS101", "Intro"))
            payload = ls._decode_and_verify_token(retry["liveness_token"])
            self.assertEqual((payload["action"], payload["session_id"], payload["challenge_id"]),
                             ("move_closer", SESSION_ID, CHALLENGE_ID))
            self.assertLessEqual(payload["exp"], int(h.db.expires_at.timestamp()))
            self.assertEqual(set(retry), {
                "status", "session_id", "course_code", "course_name", "challenge_id", "challenge_expires_at",
                "challenge_ttl_seconds", "liveness_protocol_version", "liveness_token", "liveness_mode",
                "liveness_sample_count", "liveness_action", "liveness_prompt_delay_ms",
            })

            # The old blink token is refused before any image work, with the replacement again.
            calls = len(h.verifier_calls)
            stale = h.verify(blink_token)
            self.assertEqual(stale.status_code, 422)
            self.assertEqual(len(h.verifier_calls), calls)
            self.assertEqual(stale.json()["retry_challenge"]["liveness_action"], "move_closer")
            self.assertIn("ขยับเข้าใกล้กล้อง", stale.json()["detail"])

            # The replacement succeeds and ends the fallback.
            done = h.verify(retry["liveness_token"])
            self.assertEqual(done.status_code, 200, done.text)
            self.assertIsNone(store.forced_action(USER.id))

    def test_non_blink_failures_never_get_a_retry_or_a_fallback(self):
        def pad_fails(action, _on_pass):
            raise HTTPException(status_code=422, detail="ตรวจพบความเสี่ยงจากภาพถ่ายหรือหน้าจอ")

        store = af.ActionFallbackStore()
        with Harness(FakeDb(), pad_fails, store) as h:
            token = h.token("blink")
            for _ in range(3):
                response = h.verify(token)
                self.assertEqual(response.status_code, 422)
                self.assertNotIn("retry_challenge", response.json())
        self.assertIsNone(store.forced_action(USER.id))

    def test_a_passing_blink_check_breaks_the_streak(self):
        state = {"n": 0}

        def alternate(action, on_pass):
            state["n"] += 1
            if state["n"] == 2:  # blink check passes, then PAD refuses
                on_pass()
                raise HTTPException(status_code=422, detail="ตรวจพบความเสี่ยงจากภาพถ่ายหรือหน้าจอ")
            raise BlinkActionFailure(status_code=422, detail="คำสั่งกะพริบตาไม่ผ่าน")

        store = af.ActionFallbackStore()
        with Harness(FakeDb(), alternate, store) as h:
            token = h.token("blink")
            for _ in range(3):
                response = h.verify(token)
                self.assertNotIn("retry_challenge", response.json())
        self.assertIsNone(store.forced_action(USER.id))  # fail, pass, fail: not consecutive

    def test_closed_session_and_expired_or_short_claims_get_no_retry(self):
        for name, db in (
            ("closed", FakeDb(session_status="closed")),
            ("short", FakeDb(claim_seconds=10)),
            ("expired", FakeDb(claim_seconds=-5)),
            ("consumed", FakeDb(consumed=True)),
        ):
            store = af.ActionFallbackStore()
            store.record_blink_failure(USER.id)
            store.record_blink_failure(USER.id)
            with self.subTest(case=name), patch.object(main, "supabase", db), patch.object(main, "action_fallback", store), \
                 patch.object(ls, "action_fallback", store):
                self.assertIsNone(main._attendance_retry_challenge(CHALLENGE_ID, USER))
        store = af.ActionFallbackStore()
        store.record_blink_failure(USER.id)
        store.record_blink_failure(USER.id)
        with patch.object(main, "supabase", FakeDb()), patch.object(main, "action_fallback", store), \
             patch.object(ls, "action_fallback", store):
            self.assertIsNotNone(main._attendance_retry_challenge(CHALLENGE_ID, USER))
            self.assertIsNone(main._attendance_retry_challenge(CHALLENGE_ID, OTHER))  # not their claim / no fallback

    def test_the_test_mode_path_is_the_same_and_logged(self):
        store = af.ActionFallbackStore()
        with Harness(FakeDb(), blink_fails, store, test_course=True) as h:
            token = h.token("blink")
            h.verify(token)
            second = h.verify(token)
            self.assertEqual(second.json()["retry_challenge"]["liveness_action"], "move_closer")
            stale = h.verify(token)
            self.assertEqual(stale.status_code, 422)
            stages = [row["failure_stage"] for row in h.recorded]
            self.assertEqual(stages, ["blink", "blink", "action_fallback"])
            done = h.verify(second.json()["retry_challenge"]["liveness_token"])
            self.assertEqual(done.status_code, 200, done.text)
            self.assertEqual(h.recorded[-1]["outcome"], "success")

    def test_the_client_cannot_choose_the_action(self):
        """The QR step ignores any action the client sends; a forced student always gets move_closer."""
        store = af.ActionFallbackStore()
        store.record_blink_failure(USER.id)
        store.record_blink_failure(USER.id)
        db = FakeDb()
        db.tables["attendance_records"] = []
        db.tables["attendance_checkin_challenges"] = []
        with patch.object(main, "supabase", db), patch.object(main, "ensure_qr_token_is_current", lambda *_a: None), \
             patch.object(main, "require_course_enrollment", lambda *_a: None), \
             patch.object(main, "action_fallback", store), patch.object(ls, "action_fallback", store):
            db.table = lambda name, _db=db: _InsertingQuery(_db, name)
            main.app.dependency_overrides[security.get_current_user] = lambda: USER
            try:
                client = TestClient(main.app, base_url="http://localhost")
                for _ in range(10):
                    response = client.post(
                        f"/api/v1/sessions/{SESSION_ID}/validate",
                        json={"token": "qr", "liveness_action": "blink", "action": "blink"},
                    )
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()["liveness_action"], "move_closer")
                    payload = ls._decode_and_verify_token(response.json()["liveness_token"])
                    self.assertEqual(payload["action"], "move_closer")
            finally:
                main.app.dependency_overrides.pop(security.get_current_user, None)


class _InsertingQuery(_Query):
    def insert(self, row):
        self.inserted_row = dict(row, id=CHALLENGE_ID)
        return self

    def execute(self):
        if getattr(self, "inserted_row", None):
            return SimpleNamespace(data=[self.inserted_row])
        return super().execute()


class EnrollmentEndpointTests(unittest.TestCase):
    def run_enrollment(self, store, verifier):
        def verify_frames(*args, on_blink_passed=None, **_kwargs):
            return verifier(args[3], on_blink_passed)

        def verify_submission(token, _evidence, _challenge_id, _user_id):
            return SimpleNamespace(action=ls._decode_and_verify_token(token)["action"], sample_count=3)

        expires = datetime.now(timezone.utc) + timedelta(minutes=3)
        with patch.object(ls, "action_fallback", store):
            token = ls.create_liveness_challenge("enroll-1", USER.id, expires).token
        patches = [
            patch.object(main, "load_face_enrollment_challenge", lambda *_a: None),
            patch.object(main, "verify_liveness_submission", verify_submission),
            patch.object(main, "claim_face_enrollment_challenge", lambda *_a: None),
            patch.object(main, "release_face_enrollment_challenge", lambda *_a: None),
            patch.object(main, "keep_face_enrollment_claim_alive", fake_keep_alive),
            patch.object(main, "read_validated_image", fake_read),
            patch.object(main, "prepare_face_image", lambda _c: np.zeros((8, 8, 3), np.uint8)),
            patch.object(main, "verify_hybrid_liveness_frames", verify_frames),
            patch.object(main, "finalize_face_enrollment", lambda *_a: None),
            patch.object(main, "action_fallback", store),
        ]
        for item in patches:
            item.start()
        main.app.dependency_overrides[security.get_current_user] = lambda: USER
        try:
            client = TestClient(main.app, base_url="http://localhost")
            files = [("liveness_passive_images", (f"p{i}.jpg", b"x", "image/jpeg")) for i in range(3)]
            files += [("liveness_action_image", ("a.jpg", b"x", "image/jpeg")),
                      ("liveness_recovery_image", ("r.jpg", b"x", "image/jpeg"))]
            data = {"student_id": USER.student_id, "enrollment_challenge_id": "enroll-1",
                    "liveness_token": token, "liveness_evidence": json.dumps({})}
            return client.post("/api/v1/enrollment/register-face", data=data, files=files)
        finally:
            main.app.dependency_overrides.pop(security.get_current_user, None)
            for item in reversed(patches):
                item.stop()

    def test_enrollment_counts_blink_failures_and_clears_on_success(self):
        store = af.ActionFallbackStore()

        def always_blink_fail(_action, _on_pass):
            raise BlinkActionFailure(status_code=422, detail="คำสั่งกะพริบตาไม่ผ่าน")

        for _ in range(2):
            with patch.object(store, "forced_action", lambda _u: "blink"):
                self.assertEqual(self.run_enrollment(store, always_blink_fail).status_code, 422)
        self.assertEqual(store.forced_action(USER.id), "move_closer")
        ok = self.run_enrollment(store, lambda _a, _p: VerifiedLivenessFrames(np.asarray([1.0, 0.0], np.float32)))
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertIsNone(store.forced_action(USER.id))


if __name__ == "__main__":
    unittest.main()
