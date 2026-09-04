from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

from fastapi import HTTPException

from services.course_join_service import (
    JOIN_CODE_ALPHABET,
    SlidingWindowRateLimiter,
    format_join_code,
    generate_join_code,
    join_code_is_available,
    normalize_join_code,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class CourseJoinCodeTests(unittest.TestCase):
    def test_normalizes_only_unambiguous_eight_character_codes(self):
        self.assertEqual(normalize_join_code("abcd-2345"), "ABCD2345")
        self.assertEqual(format_join_code("ABCD2345"), "ABCD-2345")
        self.assertEqual(normalize_join_code("ABCI-2345"), "")
        self.assertEqual(normalize_join_code("short"), "")

    def test_generated_codes_use_secure_display_alphabet(self):
        codes = {generate_join_code() for _ in range(100)}
        self.assertGreater(len(codes), 95)
        self.assertTrue(all(len(value) == 8 for value in codes))
        self.assertTrue(all(set(value) <= set(JOIN_CODE_ALPHABET) for value in codes))

    def test_expired_or_disabled_code_is_unavailable(self):
        future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        self.assertTrue(join_code_is_available({"is_active": True, "expires_at": future}))
        self.assertFalse(join_code_is_available({"is_active": True, "expires_at": past}))
        self.assertFalse(join_code_is_available({"is_active": False, "expires_at": future}))

    def test_rate_limiter_rejects_sixth_attempt(self):
        limiter = SlidingWindowRateLimiter(limit=5, window_seconds=60)
        for _ in range(5):
            limiter.check("student:ip")
        with self.assertRaises(HTTPException) as raised:
            limiter.check("student:ip")
        self.assertEqual(raised.exception.status_code, 429)
        self.assertIn("Retry-After", raised.exception.headers or {})


class CourseJoinMigrationTests(unittest.TestCase):
    def test_tables_are_backend_only_and_rpc_is_not_public(self):
        migration = (
            PROJECT_ROOT
            / "supabase"
            / "migrations"
            / "20260831165330_course_join_codes_and_requests.sql"
        ).read_text(encoding="utf-8").lower()
        self.assertIn("alter table public.course_join_codes enable row level security", migration)
        self.assertIn("alter table public.course_join_requests enable row level security", migration)
        self.assertIn("revoke all on public.course_join_codes from public, anon, authenticated", migration)
        self.assertIn("revoke all on public.course_join_requests from public, anon, authenticated", migration)
        self.assertIn("grant execute on function public.review_course_join_request", migration)
        self.assertIn("to service_role", migration)


if __name__ == "__main__":
    unittest.main()
