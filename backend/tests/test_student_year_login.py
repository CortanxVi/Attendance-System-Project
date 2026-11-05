"""Sign-in assigns the calculated study year to a student's account."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.security import HTTPAuthorizationCredentials

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from core.security import get_current_user


class _Table:
    def __init__(self, profile, updates):
        self.profile = profile
        self.updates = updates
        self.pending_update = None

    def select(self, *_args, **_kwargs):
        return self

    def update(self, values):
        self.pending_update = values
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self.pending_update is not None:
            self.updates.append(self.pending_update)
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=[self.profile])


def _sign_in(email, profile):
    updates = []
    client = Mock()
    client.auth.get_user.return_value = SimpleNamespace(user=SimpleNamespace(id="user-1", email=email))
    client.table.side_effect = lambda _name: _Table(profile, updates)
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="valid-token")
    return client, updates, credentials


class StudentYearLoginTests(unittest.IsolatedAsyncioTestCase):
    async def test_year_comes_from_email_and_is_stored_on_the_account(self):
        client, updates, credentials = _sign_in(
            "s6803013610010@email.kmutnb.ac.th",
            {"id": "user-1", "student_id": None, "full_name": "Test Student", "role": "student", "academic_year": None},
        )
        with patch("core.security.supabase_db", client), patch(
            "services.student_year_service.current_academic_year", return_value=2569
        ):
            user = await get_current_user(credentials)

        self.assertEqual(user.academic_year, 2)
        self.assertEqual(user.admission_year, 2568)
        self.assertEqual(updates, [{"academic_year": 2}])

    async def test_no_write_when_stored_year_is_already_correct(self):
        client, updates, credentials = _sign_in(
            "s6902041520261@email.kmutnb.ac.th",
            {"id": "user-1", "student_id": "6902041520261", "full_name": "Test Student", "role": "student", "academic_year": 1},
        )
        with patch("core.security.supabase_db", client), patch(
            "services.student_year_service.current_academic_year", return_value=2569
        ):
            user = await get_current_user(credentials)

        self.assertEqual(user.academic_year, 1)
        self.assertEqual(updates, [])

    async def test_teacher_year_is_never_calculated_or_written(self):
        client, updates, credentials = _sign_in(
            "teacher@kmutnb.ac.th",
            {"id": "user-1", "student_id": None, "full_name": "Test Teacher", "role": "teacher", "academic_year": None},
        )
        with patch("core.security.supabase_db", client):
            user = await get_current_user(credentials)

        self.assertIsNone(user.academic_year)
        self.assertEqual(updates, [])


if __name__ == "__main__":
    unittest.main()
