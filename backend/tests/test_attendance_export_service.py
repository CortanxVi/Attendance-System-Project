import unittest
from types import SimpleNamespace
from unittest.mock import patch

from services.attendance_export_service import AttendanceExportService


class _Query:
    def __init__(self, rows):
        self.rows = rows
        self.selected = None
        self.filters = []
        self.ordering = None

    def select(self, columns):
        self.selected = columns
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def order(self, field, **options):
        self.ordering = (field, options)
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class _Database:
    def __init__(self, *, course, records=None, sessions=None, enrollments=None):
        self.queries = {
            "courses": _Query(course),
            "attendance_records": _Query(records or []),
            "attendance_sessions": _Query(sessions or []),
            "enrollments": _Query(enrollments or []),
        }

    def table(self, name):
        return self.queries[name]


class AttendanceExportServiceTests(unittest.TestCase):
    def test_returns_canonical_roster_session_and_record_payload(self):
        database = _Database(
            course=[{
                "id": "course-1",
                "course_code": "ENG101",
                "course_name": "Technical English",
                "section": 2,
                "year": 2026,
                "semester": 1,
                "total_sessions": 16,
                "late_threshold_minutes": 15,
                "absent_threshold_minutes": 45,
                "max_absence_percent": 20,
                "profiles": {"full_name": "Example Instructor"},
            }],
            records=[{
                "id": "record-1",
                "check_in_time": "2026-09-01T08:01:00Z",
                "status": "present",
                "method": "face",
                "session_id": "session-1",
                "profiles": {"student_id": "6500000000001", "full_name": "Student Two"},
            }],
            sessions=[{
                "id": "session-1",
                "created_at": "2026-09-01T08:00:00Z",
                "closed_at": "2026-09-01T09:00:00Z",
                "status": "closed",
            }],
            enrollments=[
                {"profiles": {"student_id": "6500000000002", "full_name": "Student Two"}},
                {"profiles": {"student_id": "6500000000001", "full_name": "Student One"}},
            ],
        )

        with patch("services.attendance_export_service.supabase", database):
            data, error = AttendanceExportService().get_export_data("course-1")

        self.assertIsNone(error)
        self.assertEqual(data["course"]["course_code"], "ENG101")
        self.assertEqual(data["records"][0]["session_id"], "session-1")
        self.assertEqual(data["sessions"][0]["status"], "closed")
        self.assertEqual(
            [student["student_id"] for student in data["students"]],
            ["6500000000001", "6500000000002"],
        )
        self.assertEqual(
            database.queries["attendance_records"].filters,
            [("attendance_sessions.course_id", "course-1")],
        )
        self.assertEqual(
            database.queries["attendance_sessions"].ordering,
            ("created_at", {"desc": False}),
        )

    def test_returns_not_found_without_running_dependent_queries(self):
        database = _Database(course=[])

        with patch("services.attendance_export_service.supabase", database):
            data, error = AttendanceExportService().get_export_data("missing")

        self.assertIsNone(data)
        self.assertEqual(error, "ไม่พบข้อมูลรายวิชานี้")
        self.assertIsNone(database.queries["attendance_records"].selected)


if __name__ == "__main__":
    unittest.main()
