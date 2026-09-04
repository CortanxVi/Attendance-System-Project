import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from core.security import AuthenticatedUser
from routers.teacher import BulkAttendanceUpdate, update_attendance_bulk


class _RpcClient:
    def __init__(self):
        self.function = None
        self.arguments = None

    def rpc(self, function, arguments):
        self.function = function
        self.arguments = arguments
        return self

    def execute(self):
        return SimpleNamespace(data={"updated": len(self.arguments["student_numbers"])})


class BulkAttendanceSecurityTests(unittest.TestCase):
    def test_payload_rejects_invalid_or_duplicate_student_ids(self):
        for student_ids in (["123"], ["6500000000001", "6500000000001"]):
            with self.subTest(student_ids=student_ids), self.assertRaises(ValueError):
                BulkAttendanceUpdate(status="present", student_ids=student_ids)

        with self.assertRaises(ValueError):
            BulkAttendanceUpdate(status="leave", student_ids=["6500000000001"])

    def test_endpoint_uses_one_backend_only_rpc_after_session_authorization(self):
        user = AuthenticatedUser(
            id="teacher-1",
            role="teacher",
            base_role="teacher",
            auth_session_id="session-1",
        )
        client = _RpcClient()
        payload = BulkAttendanceUpdate(
            status="absent",
            student_ids=["6500000000001", "6500000000002"],
        )

        with (
            patch("routers.teacher.require_owned_session") as authorize,
            patch("routers.teacher.supabase", client),
        ):
            result = update_attendance_bulk(payload, "class-session-1", user)

        authorize.assert_called_once_with("class-session-1", user)
        self.assertEqual(client.function, "bulk_set_attendance_status")
        self.assertEqual(client.arguments["actor_id"], "teacher-1")
        self.assertEqual(result["result"], {"updated": 2})

    def test_migration_keeps_bulk_rpc_backend_only(self):
        root = Path(__file__).resolve().parents[2]
        migration = (
            root / "supabase/migrations/20260901231720_atomic_bulk_attendance.sql"
        ).read_text(encoding="utf-8").lower()
        self.assertIn("security definer", migration)
        self.assertIn("from public, anon, authenticated", migration)
        self.assertIn("to service_role", migration)
        self.assertIn("s.opened_by = actor_id or actor.role = 'admin'", migration)
        self.assertIn("join public.enrollments", migration)


if __name__ == "__main__":
    unittest.main()
