import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from core.authorization import require_course_delete_permission, require_course_enrollment
from core.security import AuthenticatedUser
from routers.student import StudentProfileUpdate, update_my_student_profile
from routers.teacher import RosterStudentUpdate, update_course_roster_student


class _EnrollmentQuery:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class _EnrollmentClient:
    def __init__(self, rows):
        self.rows = rows

    def table(self, table_name):
        if table_name != "enrollments":
            raise AssertionError(f"unexpected table: {table_name}")
        return _EnrollmentQuery(self.rows)


class _StudentProfileUpdateQuery:
    def __init__(self):
        self.payload = None
        self.filters = []

    def update(self, payload):
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def execute(self):
        return SimpleNamespace(data=[{"academic_year": self.payload["academic_year"]}])


class _StudentProfileUpdateClient:
    def __init__(self):
        self.query = _StudentProfileUpdateQuery()

    def table(self, table_name):
        if table_name != "profiles":
            raise AssertionError(f"unexpected table: {table_name}")
        return self.query


class AuthorizationRegressionTests(unittest.IsolatedAsyncioTestCase):
    def test_unenrolled_student_is_rejected(self):
        with patch("core.authorization.supabase_db", _EnrollmentClient([])):
            with self.assertRaises(HTTPException) as caught:
                require_course_enrollment("course-1", "student-1")

        self.assertEqual(caught.exception.status_code, 403)

    def test_enrolled_student_is_accepted(self):
        with patch(
            "core.authorization.supabase_db",
            _EnrollmentClient([{"course_id": "course-1"}]),
        ):
            self.assertIsNone(require_course_enrollment("course-1", "student-1"))

    def test_student_profile_year_requires_integer_between_one_and_eight(self):
        for invalid_value in (0, 9, True, "2"):
            with self.subTest(value=invalid_value):
                with self.assertRaises(ValueError):
                    StudentProfileUpdate(academic_year=invalid_value)

        with self.assertRaises(ValueError):
            StudentProfileUpdate(academic_year=2, id="another-student")

    def test_student_can_only_update_own_academic_year(self):
        student = AuthenticatedUser(
            id="student-1",
            role="student",
            base_role="student",
            auth_session_id="session-1",
        )
        client = _StudentProfileUpdateClient()

        with patch("routers.student.supabase", client):
            result = update_my_student_profile(
                StudentProfileUpdate(academic_year=4),
                student,
            )

        self.assertEqual(client.query.payload, {"academic_year": 4})
        self.assertEqual(
            client.query.filters,
            [("id", "student-1"), ("role", "student")],
        )
        self.assertEqual(result["profile"]["academic_year"], 4)

    async def test_teacher_cannot_edit_claimed_global_student_profile(self):
        teacher = AuthenticatedUser(
            id="teacher-1",
            role="teacher",
            base_role="teacher",
            auth_session_id="session-1",
        )
        payload = RosterStudentUpdate(
            full_name="Student Name",
            academic_year=2,
            class_level="2/1",
        )

        with patch("routers.teacher.require_course_management_permission", return_value={"id": "course-1"}):
            with self.assertRaises(HTTPException) as caught:
                await update_course_roster_student(
                    "course-1",
                    "active",
                    "student-1",
                    payload,
                    teacher,
                )

        self.assertEqual(caught.exception.status_code, 403)

    def test_temporary_admin_cannot_delete_another_teachers_course(self):
        temporary_admin = AuthenticatedUser(
            id="teacher-1",
            role="admin",
            base_role="teacher",
            temporary_admin=True,
            auth_session_id="session-1",
        )

        with self.assertRaises(HTTPException) as caught:
            require_course_delete_permission(
                {"id": "course-2", "teacher_id": "teacher-2"},
                temporary_admin,
            )

        self.assertEqual(caught.exception.status_code, 403)

    def test_temporary_admin_can_delete_own_course(self):
        temporary_admin = AuthenticatedUser(
            id="teacher-1",
            role="admin",
            base_role="teacher",
            temporary_admin=True,
            auth_session_id="session-1",
        )

        self.assertIsNone(
            require_course_delete_permission(
                {"id": "course-1", "teacher_id": "teacher-1"},
                temporary_admin,
            )
        )


if __name__ == "__main__":
    unittest.main()
