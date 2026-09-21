import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from core.security import AuthenticatedUser
from routers.teacher import (
    AttendancePeriodRollover,
    AttendanceSessionRestore,
    AttendanceSessionSelection,
    archive_course_attendance_sessions,
    restore_course_attendance_sessions,
    rollover_course_attendance_period,
)


class _RpcClient:
    def __init__(self):
        self.function = None
        self.arguments = None

    def rpc(self, function, arguments):
        self.function = function
        self.arguments = arguments
        return self

    def execute(self):
        return SimpleNamespace(data={"changed": 1})


class AttendancePeriodSecurityTests(unittest.TestCase):
    def setUp(self):
        self.teacher = AuthenticatedUser(
            id="11111111-1111-4111-8111-111111111111",
            role="teacher",
            base_role="teacher",
            auth_session_id="session-1",
        )
        self.session_id = "22222222-2222-4222-8222-222222222222"

    def test_period_payloads_reject_invalid_inputs(self):
        with self.assertRaises(ValueError):
            AttendanceSessionSelection(session_ids=[])
        with self.assertRaises(ValueError):
            AttendanceSessionRestore(session_ids=["not-a-uuid"])
        with self.assertRaises(ValueError):
            AttendancePeriodRollover(semester=3, year=2026)
        with self.assertRaises(ValueError):
            AttendancePeriodRollover(semester=1, year=1999)

    def test_archive_and_restore_use_backend_only_rpcs_after_authorization(self):
        for endpoint, payload, function_name in (
            (
                archive_course_attendance_sessions,
                AttendanceSessionSelection(session_ids=[self.session_id], reason="duplicate"),
                "archive_attendance_sessions",
            ),
            (
                restore_course_attendance_sessions,
                AttendanceSessionRestore(session_ids=[self.session_id]),
                "restore_attendance_sessions",
            ),
        ):
            client = _RpcClient()
            with (
                patch("routers.teacher.require_course_management_permission") as authorize,
                patch("routers.teacher.supabase", client),
            ):
                result = endpoint("course-1", payload, self.teacher)

            authorize.assert_called_once_with("course-1", self.teacher)
            self.assertEqual(client.function, function_name)
            self.assertEqual(client.arguments["actor_id"], self.teacher.id)
            self.assertEqual(client.arguments["target_session_ids"], [self.session_id])
            self.assertEqual(result["status"], "success")

    def test_rollover_is_atomic_rpc_and_preserves_same_course(self):
        client = _RpcClient()
        payload = AttendancePeriodRollover(semester=2, year=2026, reason="term complete")
        with (
            patch("routers.teacher.require_course_management_permission") as authorize,
            patch("routers.teacher.supabase", client),
        ):
            result = rollover_course_attendance_period("course-1", payload, self.teacher)

        authorize.assert_called_once_with("course-1", self.teacher)
        self.assertEqual(client.function, "rollover_attendance_period")
        self.assertEqual(client.arguments["target_course_id"], "course-1")
        self.assertEqual(client.arguments["new_semester"], 2)
        self.assertEqual(result["status"], "success")

    def test_migration_keeps_history_and_restricts_mutation_to_service_role(self):
        root = Path(__file__).resolve().parents[2]
        migration = (
            root / "supabase/migrations/20260921111209_attendance_reporting_periods.sql"
        ).read_text(encoding="utf-8").lower()
        self.assertIn("archived_at timestamptz", migration)
        self.assertNotIn("delete from public.attendance_records", migration)
        self.assertIn("security definer", migration)
        self.assertIn("set search_path = ''", migration)
        self.assertIn("from public, anon, authenticated", migration)
        self.assertIn("to service_role", migration)
        self.assertIn("status <> 'closed'", migration)


if __name__ == "__main__":
    unittest.main()
