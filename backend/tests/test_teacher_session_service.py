import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from services.teacher_session_service import (
    DEFAULT_LATE_THRESHOLD_MINUTES,
    elapsed_seconds_since,
    find_active_teacher_session,
    normalize_late_threshold_minutes,
)


class _Query:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []
        self.ordering = None
        self.maximum = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def order(self, field, **kwargs):
        self.ordering = (field, kwargs)
        return self

    def limit(self, maximum):
        self.maximum = maximum
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class _Database:
    def __init__(self, sessions, courses=None):
        self.sessions = _Query(sessions)
        self.courses = _Query(courses or [])

    def table(self, name):
        if name == "attendance_sessions":
            return self.sessions
        if name == "courses":
            return self.courses
        raise AssertionError(f"unexpected table: {name}")


class TeacherSessionServiceTests(unittest.TestCase):
    def test_returns_none_when_teacher_has_no_open_session(self):
        database = _Database([])

        self.assertIsNone(find_active_teacher_session(database, "teacher-1"))
        self.assertEqual(
            database.sessions.filters,
            [("opened_by", "teacher-1"), ("status", "open")],
        )
        self.assertEqual(database.sessions.ordering, ("created_at", {"desc": True}))
        self.assertEqual(database.sessions.maximum, 1)

    def test_returns_safe_course_metadata_without_qr_token(self):
        database = _Database(
            [{
                "id": "session-1",
                "course_id": "course-1",
                "opened_by": "teacher-1",
                "status": "open",
                "created_at": "2026-09-13T08:00:00Z",
                "qr_token": "must-not-leak",
            }],
            [{
                "id": "course-1",
                "course_code": "CS101",
                "course_name": "Software Design",
                "section": 1,
            }],
        )

        result = find_active_teacher_session(database, "teacher-1")

        self.assertEqual(result["id"], "session-1")
        self.assertEqual(result["course_code"], "CS101")
        self.assertNotIn("qr_token", result)

    def test_returns_course_late_threshold_and_server_elapsed_time(self):
        database = _Database(
            [{
                "id": "session-1",
                "course_id": "course-1",
                "opened_by": "teacher-1",
                "status": "open",
                "created_at": "2026-09-13T08:00:00Z",
            }],
            [{
                "id": "course-1",
                "course_code": "CS101",
                "course_name": "Software Design",
                "section": 1,
                "late_threshold_minutes": 20,
            }],
        )

        result = find_active_teacher_session(database, "teacher-1")

        self.assertEqual(result["late_threshold_minutes"], 20)
        self.assertIsInstance(result["elapsed_seconds"], int)
        self.assertGreaterEqual(result["elapsed_seconds"], 0)

    def test_missing_or_invalid_late_threshold_falls_back_to_default(self):
        for value in (None, 0, -5, "abc", ""):
            with self.subTest(value=value):
                self.assertEqual(
                    normalize_late_threshold_minutes(value),
                    DEFAULT_LATE_THRESHOLD_MINUTES,
                )
        self.assertEqual(normalize_late_threshold_minutes("30"), 30)

    def test_elapsed_seconds_uses_the_supplied_server_clock(self):
        now = datetime(2026, 9, 13, 8, 10, 30, tzinfo=timezone.utc)

        self.assertEqual(elapsed_seconds_since("2026-09-13T08:00:00Z", now), 630)
        self.assertEqual(elapsed_seconds_since("2026-09-13T08:00:00+00:00", now), 630)
        # A creation time in the future, or a bad value, must never go negative.
        self.assertEqual(elapsed_seconds_since("2026-09-13T09:00:00Z", now), 0)
        self.assertEqual(elapsed_seconds_since(None, now), 0)
        self.assertEqual(elapsed_seconds_since("not-a-date", now), 0)


if __name__ == "__main__":
    unittest.main()
