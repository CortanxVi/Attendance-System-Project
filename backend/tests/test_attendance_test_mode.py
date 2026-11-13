"""Guards for the test-only shortcut that removes the QR step and its timers.

The shortcut must stay OFF by default, must fail closed on inconsistent
settings, must only work for listed test courses, and must never leak into the
production deployment files.
"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from core.security import AuthenticatedUser
from core.test_mode import (
    MAX_TEST_COURSES,
    TEST_CHALLENGE_SECONDS,
    TEST_MODE_ACK_PHRASE,
    load_test_mode_settings,
)
from routers import test_mode as test_mode_router

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LISTED = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
GOOD_ENV = {
    "ATTENDANCE_TEST_MODE": "1",
    "ATTENDANCE_TEST_MODE_ACK": TEST_MODE_ACK_PHRASE,
    "ATTENDANCE_TEST_COURSE_IDS": LISTED,
}


class SettingsGateTests(unittest.TestCase):
    def test_off_by_default_and_for_every_false_value(self):
        for value in (None, "", "0", "false", "no", "off", " False "):
            env = {} if value is None else {"ATTENDANCE_TEST_MODE": value}
            settings = load_test_mode_settings(env)
            self.assertFalse(settings.enabled, value)
            self.assertEqual(settings.course_ids, frozenset())

    def test_course_list_without_the_switch_stays_off(self):
        settings = load_test_mode_settings({"ATTENDANCE_TEST_COURSE_IDS": LISTED})
        self.assertFalse(settings.enabled)

    def test_unknown_switch_value_is_rejected_not_guessed(self):
        with self.assertRaises(RuntimeError):
            load_test_mode_settings({**GOOD_ENV, "ATTENDANCE_TEST_MODE": "maybe"})

    def test_missing_or_wrong_acknowledgement_is_rejected(self):
        for ack in (None, "", "yes", TEST_MODE_ACK_PHRASE.lower()):
            env = dict(GOOD_ENV)
            if ack is None:
                env.pop("ATTENDANCE_TEST_MODE_ACK")
            else:
                env["ATTENDANCE_TEST_MODE_ACK"] = ack
            with self.assertRaises(RuntimeError, msg=str(ack)):
                load_test_mode_settings(env)

    def test_empty_or_invalid_course_list_is_rejected(self):
        for ids in ("", " , ", "030513702", f"{LISTED},not-a-uuid"):
            with self.assertRaises(RuntimeError, msg=ids):
                load_test_mode_settings({**GOOD_ENV, "ATTENDANCE_TEST_COURSE_IDS": ids})

    def test_too_many_courses_are_rejected(self):
        ids = ",".join(f"{index:08x}-1111-4111-8111-111111111111" for index in range(MAX_TEST_COURSES + 1))
        with self.assertRaises(RuntimeError):
            load_test_mode_settings({**GOOD_ENV, "ATTENDANCE_TEST_COURSE_IDS": ids})

    def test_valid_settings_are_normalised(self):
        settings = load_test_mode_settings({
            **GOOD_ENV,
            "ATTENDANCE_TEST_COURSE_IDS": f" {LISTED.upper()} ; {OTHER} ",
        })
        self.assertTrue(settings.enabled)
        self.assertEqual(settings.course_ids, frozenset({LISTED, OTHER}))

    def test_running_process_has_the_shortcut_off(self):
        import core.config as config

        self.assertFalse(config.ATTENDANCE_TEST_MODE)
        self.assertEqual(config.ATTENDANCE_TEST_COURSE_IDS, frozenset())


class _FakeQuery:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters = []
        self.payload = None

    def select(self, *_a, **_k):
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, list(values)))
        return self

    def is_(self, column, _value):
        self.filters.append(("null", column, None))
        return self

    def limit(self, *_a, **_k):
        return self

    def insert(self, payload):
        self.payload = payload
        return self

    def execute(self):
        if self.payload is not None:
            row = {**self.payload, "id": "challenge-1"}
            self.db.inserted.setdefault(self.table, []).append(row)
            return SimpleNamespace(data=[row])
        rows = list(self.db.rows.get(self.table, []))
        for kind, column, value in self.filters:
            if kind == "eq":
                rows = [r for r in rows if r.get(column) == value]
            elif kind == "in":
                rows = [r for r in rows if r.get(column) in value]
            else:
                rows = [r for r in rows if r.get(column) is None]
        return SimpleNamespace(data=rows)


class _FakeDb:
    def __init__(self, rows):
        self.rows = rows
        self.inserted = {}

    def table(self, name):
        return _FakeQuery(self, name)


def _student(student_id="6600000000001"):
    return AuthenticatedUser(
        id="student-1",
        email="s6600000000001@email.kmutnb.ac.th",
        full_name="Test Student",
        role="student",
        base_role="student",
        auth_session_id="session-1",
        student_id=student_id,
    )


def _db(**overrides):
    rows = {
        "enrollments": [
            {"course_id": LISTED, "student_id": "student-1"},
            {"course_id": OTHER, "student_id": "student-1"},
        ],
        "attendance_sessions": [
            {"id": "s-open", "course_id": LISTED, "status": "open", "archived_at": None,
             "created_at": "2026-11-13T01:00:00+00:00",
             "courses": {"course_code": "TEST1", "course_name": "Test course"}},
            {"id": "s-closed", "course_id": LISTED, "status": "closed", "archived_at": None,
             "created_at": "2026-11-12T01:00:00+00:00", "courses": {"course_code": "TEST1", "course_name": "Test course"}},
            {"id": "s-real", "course_id": OTHER, "status": "open", "archived_at": None,
             "created_at": "2026-11-13T02:00:00+00:00", "courses": {"course_code": "REAL1", "course_name": "Real course"}},
        ],
        "attendance_records": [],
    }
    rows.update(overrides)
    return _FakeDb(rows)


class RouterTests(unittest.TestCase):
    def _call(self, func, db, *args, **kwargs):
        with patch.object(test_mode_router, "supabase", db), \
             patch("core.authorization.supabase_db", db), \
             patch.object(test_mode_router, "ATTENDANCE_TEST_COURSE_IDS", frozenset({LISTED})):
            return func(*args, **kwargs)

    def test_lists_only_open_sessions_of_listed_courses_the_student_belongs_to(self):
        result = self._call(test_mode_router.list_open_test_sessions, _db(), current_user=_student())
        self.assertEqual([item["session_id"] for item in result["sessions"]], ["s-open"])
        self.assertFalse(result["sessions"][0]["already_checked_in"])

    def test_marks_a_session_the_student_already_checked_into(self):
        db = _db(attendance_records=[{"session_id": "s-open", "student_id": "student-1"}])
        result = self._call(test_mode_router.list_open_test_sessions, db, current_user=_student())
        self.assertTrue(result["sessions"][0]["already_checked_in"])

    def test_not_enrolled_students_see_nothing(self):
        result = self._call(
            test_mode_router.list_open_test_sessions,
            _db(enrollments=[{"course_id": LISTED, "student_id": "someone-else"}]),
            current_user=_student(),
        )
        self.assertEqual(result["sessions"], [])

    def test_challenge_is_issued_without_a_qr_token(self):
        db = _db()
        result = self._call(
            test_mode_router.issue_test_challenge, db, "s-open", current_user=_student()
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["challenge_id"], "challenge-1")
        self.assertEqual(result["challenge_ttl_seconds"], TEST_CHALLENGE_SECONDS)
        self.assertEqual(result["liveness_mode"], "hybrid")
        self.assertIn(result["liveness_action"], ("blink", "move_closer"))
        self.assertTrue(result["liveness_token"])
        inserted = db.inserted["attendance_checkin_challenges"][0]
        self.assertEqual(inserted["session_id"], "s-open")
        self.assertEqual(inserted["student_id"], "student-1")

    def test_unlisted_course_is_refused_even_when_enrolled_and_open(self):
        db = _db()
        with self.assertRaises(HTTPException) as caught:
            self._call(test_mode_router.issue_test_challenge, db, "s-real", current_user=_student())
        self.assertEqual(caught.exception.status_code, 403)
        self.assertNotIn("attendance_checkin_challenges", db.inserted)

    def test_not_enrolled_closed_unknown_and_duplicate_are_refused(self):
        cases = {
            "not-enrolled": (_db(enrollments=[]), "s-open", 403),
            "closed": (_db(), "s-closed", 400),
            "unknown": (_db(), "missing", 404),
            "duplicate": (_db(attendance_records=[{"id": "r1", "session_id": "s-open", "student_id": "student-1"}]), "s-open", 409),
        }
        for name, (db, session_id, expected) in cases.items():
            with self.subTest(name), self.assertRaises(HTTPException) as caught:
                self._call(test_mode_router.issue_test_challenge, db, session_id, current_user=_student())
            self.assertEqual(caught.exception.status_code, expected)
            self.assertNotIn("attendance_checkin_challenges", db.inserted)

    def test_account_without_student_id_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self._call(test_mode_router.issue_test_challenge, _db(), "s-open", current_user=_student(student_id=None))
        self.assertEqual(caught.exception.status_code, 409)


class NoLeakIntoProductionTests(unittest.TestCase):
    def _read(self, relative):
        return (PROJECT_ROOT / relative).read_text(encoding="utf-8")

    def test_main_registers_the_router_only_inside_the_switch(self):
        main_source = self._read("backend/main.py")
        block = main_source.split("if ATTENDANCE_TEST_MODE:", 1)[1].split("\n\n\n", 1)[0]
        self.assertIn("include_router(test_mode_router)", block)
        self.assertEqual(main_source.count("include_router(test_mode_router)"), 1)
        self.assertEqual(main_source.count("routers.test_mode"), 1)

    def test_production_deployment_files_never_mention_the_switch(self):
        files = [
            "deployment/backend.env.example",
            "deployment/frontend.env.production.example",
            "deployment/docker/compose.production.yml",
            "deployment/docker/production.compose.env.example",
            "scripts/install_production_release.sh",
            "scripts/start_main_production.sh",
            *(str(path.relative_to(PROJECT_ROOT)) for path in (PROJECT_ROOT / "deployment/systemd").glob("*")),
        ]
        for relative in files:
            text = self._read(relative)
            for needle in ("ATTENDANCE_TEST_MODE", "ATTENDANCE_TEST_COURSE_IDS", "VITE_TEST_MODE"):
                self.assertNotIn(needle, text, f"{relative} must not mention {needle}")

    def test_release_bundle_script_refuses_a_test_mode_frontend(self):
        self.assertIn("VITE_TEST_MODE", self._read("scripts/build_release_bundle.sh"))

    def test_ngrok_script_uses_the_same_acknowledgement_phrase(self):
        self.assertTrue(
            TEST_MODE_ACK_PHRASE in self._read("scripts/start_backend_ngrok.sh"),
            "the ngrok script must use the exact acknowledgement phrase",
        )

    def test_production_preflight_rejects_the_switch_in_either_env_file(self):
        script = PROJECT_ROOT / "scripts" / "production_preflight.py"
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            for name, backend_extra, frontend_extra in (
                ("backend", "ATTENDANCE_TEST_MODE=1\n", ""),
                ("frontend", "", "VITE_TEST_MODE=1\n"),
            ):
                backend_env = tmp_path / f"{name}.backend.env"
                backend_env.write_text("APP_ENV=production\n" + backend_extra, encoding="utf-8")
                ocr_env = tmp_path / f"{name}.ocr.env"
                ocr_env.write_text("NODE_ENV=production\n", encoding="utf-8")
                frontend_env = tmp_path / f"{name}.frontend.env"
                frontend_env.write_text(frontend_extra, encoding="utf-8")
                result = subprocess.run(
                    [
                        sys.executable, "-I", str(script),
                        "--backend-env", str(backend_env),
                        "--ocr-env", str(ocr_env),
                        "--frontend-env", str(frontend_env),
                        "--allow-development",
                    ],
                    capture_output=True, text=True, timeout=60, check=False,
                )
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("test mode", result.stdout.lower(), name)


if __name__ == "__main__":
    unittest.main()
