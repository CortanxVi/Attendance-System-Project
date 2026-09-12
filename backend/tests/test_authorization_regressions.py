import os
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from core.authorization import require_course_delete_permission, require_course_enrollment
from core.security import AuthenticatedUser
from routers.student import derive_study_year, reject_student_profile_override
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

    def test_student_profile_year_is_derived_from_buddhist_admission_year(self):
        self.assertEqual(derive_study_year("6612345678901", now=datetime(2026, 9, 12)), 4)
        self.assertIsNone(derive_study_year("not-a-student-id", now=datetime(2026, 9, 12)))

    def test_student_cannot_override_derived_academic_year(self):
        student = AuthenticatedUser(
            id="student-1",
            role="student",
            base_role="student",
            auth_session_id="session-1",
        )
        with self.assertRaises(HTTPException) as caught:
            reject_student_profile_override(student)
        self.assertEqual(caught.exception.status_code, 403)

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
