"""Tests for the duplicate-course guard and the "one open session" database rule."""

import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

import main
from core.security import AuthenticatedUser
from services.course_duplicate_service import ensure_course_not_duplicate, is_unique_violation


class _CoursesQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def execute(self):
        rows = self.rows
        for column, value in self.filters:
            rows = [row for row in rows if row.get(column) == value]
        return SimpleNamespace(data=rows)


class _CoursesClient:
    def __init__(self, rows):
        self.rows = rows

    def table(self, table_name):
        if table_name != "courses":
            raise AssertionError(f"unexpected table: {table_name}")
        return _CoursesQuery(self.rows)


EXISTING = [
    {
        "id": "course-1",
        "course_code": "CS101",
        "teacher_id": "teacher-1",
        "section": 1,
        "year": 2569,
        "semester": 1,
    }
]


def _check(client, **overrides):
    values = {
        "teacher_id": "teacher-1",
        "course_code": "CS101",
        "section": 1,
        "year": 2569,
        "semester": 1,
    }
    values.update(overrides)
    return ensure_course_not_duplicate(client, **values)


class DuplicateCourseGuardTests(unittest.TestCase):
    def setUp(self):
        self.client = _CoursesClient(EXISTING)

    def test_same_teacher_same_course_section_term_is_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            _check(self.client)
        self.assertEqual(caught.exception.status_code, 409)

    def test_course_code_comparison_ignores_case_and_spaces(self):
        with self.assertRaises(HTTPException):
            _check(self.client, course_code="  cs101 ")

    def test_different_section_is_allowed(self):
        self.assertIsNone(_check(self.client, section=3))

    def test_different_term_is_allowed(self):
        self.assertIsNone(_check(self.client, semester=2))
        self.assertIsNone(_check(self.client, year=2570))

    def test_different_teacher_may_teach_the_same_course_and_section(self):
        self.assertIsNone(_check(self.client, teacher_id="teacher-2"))

    def test_editing_a_course_does_not_clash_with_itself(self):
        self.assertIsNone(_check(self.client, exclude_course_id="course-1"))

    def test_sql_wildcard_characters_are_not_treated_as_wildcards(self):
        self.assertIsNone(_check(self.client, course_code="CS%"))
        self.assertIsNone(_check(self.client, course_code="CS_01"))


class UniqueViolationDetectionTests(unittest.TestCase):
    def test_detects_code_attribute_and_message(self):
        error_with_code = Exception("boom")
        error_with_code.code = "23505"
        self.assertTrue(is_unique_violation(error_with_code))
        self.assertTrue(is_unique_violation(Exception("{'code': '23505', 'message': 'duplicate key'}")))

    def test_other_errors_are_not_unique_violations(self):
        self.assertFalse(is_unique_violation(Exception("connection reset")))


class StartSessionUniqueIndexTests(unittest.TestCase):
    """If two start requests race, the database index rejects the loser with a clear 409."""

    def test_unique_violation_on_insert_becomes_409_not_500(self):
        teacher = AuthenticatedUser(
            id="teacher-1",
            role="teacher",
            base_role="teacher",
            auth_session_id="auth-session-1",
        )

        class _FailingInsert:
            def table(self, _name):
                return self

            def insert(self, _payload):
                return self

            def execute(self):
                error = Exception("duplicate key value violates unique constraint")
                error.code = "23505"
                raise error

        with (
            patch.object(main, "find_active_teacher_session", return_value=None),
            patch.object(main, "require_owned_course", return_value={"id": "course-1"}),
            patch.object(main, "supabase", _FailingInsert()),
        ):
            with self.assertRaises(HTTPException) as caught:
                main.start_attendance_session(
                    main.SessionStartRequest(course_id="course-1"),
                    current_user=teacher,
                )
        self.assertEqual(caught.exception.status_code, 409)


class OpenSessionMigrationTests(unittest.TestCase):
    def test_migration_defines_both_partial_unique_indexes(self):
        migrations = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
        sql = "\n".join(
            path.read_text(encoding="utf-8")
            for path in migrations.glob("*one_open_session_per_course.sql")
        )
        self.assertIn("attendance_sessions_one_open_per_course_idx", sql)
        self.assertIn("attendance_sessions_one_open_per_opener_idx", sql)
        self.assertEqual(sql.count("where status = 'open'"), 4)


if __name__ == "__main__":
    unittest.main()
