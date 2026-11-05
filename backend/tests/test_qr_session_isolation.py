"""Regression tests: a QR code only works for the one session (section) it was issued for.

Scenario used throughout: course "A" has two sections, each with its own
course row, its own roster and its own open attendance session.
"""

import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

import main
from core.security import AuthenticatedUser


SEC1_COURSE, SEC3_COURSE = "course-sec1", "course-sec3"
SEC1_SESSION, SEC3_SESSION = "session-sec1", "session-sec3"
SEC1_TOKEN, SEC3_TOKEN = "token-sec1", "token-sec3"


class _FakeQuery:
    """Tiny chainable stand-in for a Supabase query that really applies .eq() filters."""

    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.filters = []
        self.inserted = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def gte(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self.inserted = payload
        return self

    def execute(self):
        if self.inserted is not None:
            return SimpleNamespace(data=[{**self.inserted, "id": "challenge-1"}])
        rows = self.db.rows.get(self.table_name, [])
        for column, value in self.filters:
            rows = [row for row in rows if row.get(column) == value]
        return SimpleNamespace(data=rows)


class _FakeSupabase:
    def __init__(self, rows):
        self.rows = rows

    def table(self, table_name):
        return _FakeQuery(self, table_name)


def _session_row(session_id, course_id, token, *, status="open", age_seconds=1):
    rotated_at = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
    return {
        "id": session_id,
        "course_id": course_id,
        "status": status,
        "qr_token": token,
        "qr_token_rotated_at": rotated_at.isoformat(),
        "qr_refresh_rate_seconds": 12,
        "courses": {"course_code": "A", "course_name": "Course A"},
    }


def _student(user_id="student-1"):
    return AuthenticatedUser(
        id=user_id,
        role="student",
        base_role="student",
        student_id="6401000001",
        auth_session_id="auth-session-1",
    )


class EnsureQrTokenIsCurrentTests(unittest.TestCase):
    def test_matching_fresh_token_is_accepted(self):
        row = _session_row(SEC1_SESSION, SEC1_COURSE, SEC1_TOKEN)
        self.assertIsNone(main.ensure_qr_token_is_current(row, SEC1_TOKEN))

    def test_wrong_token_is_rejected(self):
        row = _session_row(SEC1_SESSION, SEC1_COURSE, SEC1_TOKEN)
        with self.assertRaises(HTTPException) as caught:
            main.ensure_qr_token_is_current(row, "some-other-token")
        self.assertEqual(caught.exception.status_code, 400)

    def test_token_older_than_refresh_window_is_rejected(self):
        row = _session_row(SEC1_SESSION, SEC1_COURSE, SEC1_TOKEN, age_seconds=60)
        with self.assertRaises(HTTPException) as caught:
            main.ensure_qr_token_is_current(row, SEC1_TOKEN)
        self.assertEqual(caught.exception.status_code, 400)

    def test_closed_session_is_rejected_even_with_the_right_token(self):
        row = _session_row(SEC1_SESSION, SEC1_COURSE, SEC1_TOKEN, status="closed")
        with self.assertRaises(HTTPException) as caught:
            main.ensure_qr_token_is_current(row, SEC1_TOKEN)
        self.assertEqual(caught.exception.status_code, 400)

    def test_missing_rotation_time_is_rejected(self):
        row = _session_row(SEC1_SESSION, SEC1_COURSE, SEC1_TOKEN)
        row["qr_token_rotated_at"] = None
        with self.assertRaises(HTTPException) as caught:
            main.ensure_qr_token_is_current(row, SEC1_TOKEN)
        self.assertEqual(caught.exception.status_code, 400)


class ValidateQrAcrossSectionsTests(unittest.TestCase):
    """Calls the real /sessions/{id}/validate handler against an in-memory database."""

    def setUp(self):
        self.rows = {
            "attendance_sessions": [
                _session_row(SEC1_SESSION, SEC1_COURSE, SEC1_TOKEN),
                _session_row(SEC3_SESSION, SEC3_COURSE, SEC3_TOKEN),
            ],
            # student-1 is only in section 1; student-2 is in both sections.
            "enrollments": [
                {"course_id": SEC1_COURSE, "student_id": "student-1"},
                {"course_id": SEC1_COURSE, "student_id": "student-2"},
                {"course_id": SEC3_COURSE, "student_id": "student-2"},
            ],
            "attendance_records": [],
            "attendance_checkin_challenges": [],
        }
        fake = _FakeSupabase(self.rows)
        liveness = SimpleNamespace(
            protocol_version=4,
            token="liveness-token",
            mode="hybrid",
            sample_count=3,
            action="turn_left",
            prompt_delay_ms=500,
        )
        patches = [
            patch.object(main, "supabase", fake),
            patch("core.authorization.supabase_db", fake),
            patch.object(main, "create_attendance_liveness_challenge", return_value=liveness),
        ]
        for active in patches:
            active.start()
            self.addCleanup(active.stop)

    def validate(self, session_id, token, user):
        return main.validate_session_qr_token(
            session_id,
            main.QRValidationRequest(token=token),
            current_user=user,
        )

    def test_student_scanning_own_section_gets_a_challenge_bound_to_that_session(self):
        result = self.validate(SEC1_SESSION, SEC1_TOKEN, _student("student-1"))
        self.assertEqual(result["session_id"], SEC1_SESSION)
        self.assertEqual(result["challenge_id"], "challenge-1")

    def test_student_scanning_another_section_is_rejected_as_not_enrolled(self):
        with self.assertRaises(HTTPException) as caught:
            self.validate(SEC3_SESSION, SEC3_TOKEN, _student("student-1"))
        self.assertEqual(caught.exception.status_code, 403)

    def test_section_one_token_does_not_work_on_section_three_session(self):
        # Attacker edits the QR payload: session_id of sec 3, token copied from sec 1.
        with self.assertRaises(HTTPException) as caught:
            self.validate(SEC3_SESSION, SEC1_TOKEN, _student("student-2"))
        self.assertEqual(caught.exception.status_code, 400)

    def test_student_in_both_sections_is_attributed_to_the_scanned_section_only(self):
        first = self.validate(SEC1_SESSION, SEC1_TOKEN, _student("student-2"))
        self.assertEqual(first["session_id"], SEC1_SESSION)
        second = self.validate(SEC3_SESSION, SEC3_TOKEN, _student("student-2"))
        self.assertEqual(second["session_id"], SEC3_SESSION)

    def test_unknown_session_id_is_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            self.validate("session-does-not-exist", SEC1_TOKEN, _student("student-1"))
        self.assertEqual(caught.exception.status_code, 404)

    def test_student_who_already_checked_in_cannot_scan_again(self):
        self.rows["attendance_records"].append(
            {"session_id": SEC1_SESSION, "student_id": "student-1"}
        )
        with self.assertRaises(HTTPException) as caught:
            self.validate(SEC1_SESSION, SEC1_TOKEN, _student("student-1"))
        self.assertEqual(caught.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
