import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

# Unit tests must not depend on a developer's local backend/.env file.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from core.security import (
    AuthenticatedUser,
    get_current_user,
    is_allowed_kmutnb_email,
    require_permanent_admin,
    require_roles,
)


class _ProfileQuery:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class SecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_bearer_token_is_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            await get_current_user(None)

        self.assertEqual(caught.exception.status_code, 401)

    async def test_invalid_supabase_token_is_rejected(self):
        fake_client = Mock()
        fake_client.auth.get_user.side_effect = RuntimeError("invalid token")
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bad-token")

        with patch("core.security.supabase_db", fake_client):
            with self.assertRaises(HTTPException) as caught:
                await get_current_user(credentials)

        self.assertEqual(caught.exception.status_code, 401)

    async def test_valid_token_loads_role_from_profile_table(self):
        fake_client = Mock()
        fake_client.auth.get_user.return_value = SimpleNamespace(
            user=SimpleNamespace(id="user-1", email="teacher@kmutnb.ac.th")
        )
        fake_client.table.side_effect = lambda _name: _ProfileQuery(
            [{
                "id": "user-1",
                "student_id": "T001",
                "full_name": "Test Teacher",
                "role": "teacher",
            }]
        )
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="valid-token")

        with patch("core.security.supabase_db", fake_client):
            current_user = await get_current_user(credentials)

        self.assertEqual(current_user.id, "user-1")
        self.assertEqual(current_user.role, "teacher")
        fake_client.auth.get_user.assert_called_once_with("valid-token")

    async def test_authenticated_user_without_profile_is_rejected(self):
        fake_client = Mock()
        fake_client.auth.get_user.return_value = SimpleNamespace(
            user=SimpleNamespace(id="user-2", email="unknown@kmutnb.ac.th")
        )
        fake_client.table.side_effect = lambda _name: _ProfileQuery([])
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="valid-token")

        with patch("core.security.supabase_db", fake_client):
            with self.assertRaises(HTTPException) as caught:
                await get_current_user(credentials)

        self.assertEqual(caught.exception.status_code, 403)

    async def test_non_kmutnb_email_is_rejected_even_with_profile(self):
        fake_client = Mock()
        fake_client.auth.get_user.return_value = SimpleNamespace(
            user=SimpleNamespace(id="user-3", email="person@gmail.com")
        )
        fake_client.table.side_effect = lambda _name: _ProfileQuery([
            {"id": "user-3", "student_id": None, "full_name": "External", "role": "student"}
        ])
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="valid-token")

        with patch("core.security.supabase_db", fake_client):
            with self.assertRaises(HTTPException) as caught:
                await get_current_user(credentials)

        self.assertEqual(caught.exception.status_code, 403)

    def test_kmutnb_email_domain_validation(self):
        self.assertTrue(is_allowed_kmutnb_email("student@email.kmutnb.ac.th"))
        self.assertTrue(is_allowed_kmutnb_email("teacher@it.kmutnb.ac.th"))
        self.assertFalse(is_allowed_kmutnb_email("student@kmutnb.ac.th.example.com"))
        self.assertFalse(is_allowed_kmutnb_email("student@gmail.com"))

    async def test_role_guard_rejects_wrong_database_role(self):
        guard = require_roles("admin")
        teacher = AuthenticatedUser(
            id="user-1",
            role="teacher",
            base_role="teacher",
            auth_session_id="session-1",
        )

        with self.assertRaises(HTTPException) as caught:
            await guard(teacher)

        self.assertEqual(caught.exception.status_code, 403)

    async def test_role_guard_accepts_allowed_database_role(self):
        guard = require_roles("teacher", "admin")
        teacher = AuthenticatedUser(
            id="user-1",
            role="teacher",
            base_role="teacher",
            auth_session_id="session-1",
        )

        self.assertEqual(await guard(teacher), teacher)

    async def test_temporary_admin_cannot_perform_permanent_admin_actions(self):
        temporary_admin = AuthenticatedUser(
            id="teacher-1",
            role="admin",
            base_role="teacher",
            temporary_admin=True,
            auth_session_id="session-1",
        )

        with self.assertRaises(HTTPException) as caught:
            await require_permanent_admin(temporary_admin)

        self.assertEqual(caught.exception.status_code, 403)

    async def test_permanent_admin_guard_accepts_only_base_admin(self):
        permanent_admin = AuthenticatedUser(
            id="admin-1",
            role="admin",
            base_role="admin",
            auth_session_id="session-1",
        )

        self.assertEqual(await require_permanent_admin(permanent_admin), permanent_admin)


if __name__ == "__main__":
    unittest.main()
