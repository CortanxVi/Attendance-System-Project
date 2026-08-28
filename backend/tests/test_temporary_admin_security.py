import os
import unittest
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("TEMP_ADMIN_PIN_PEPPER", "test-pepper-that-is-long-enough-for-tests")

from services.temporary_admin_service import (
    extract_verified_session_id,
    hash_pin,
    issue_grant_token,
    token_hash,
    validate_pin,
    verify_pin,
)


class TemporaryAdminSecurityTests(unittest.TestCase):
    def test_pin_hash_is_salted_and_verifiable(self):
        with patch(
            "services.temporary_admin_service.TEMP_ADMIN_PIN_PEPPER",
            "separate-test-pepper-value",
        ):
            first = hash_pin("teacher-1", "482951")
            second = hash_pin("teacher-1", "482951")
            self.assertNotEqual(first, second)
            self.assertNotIn("482951", first)
            self.assertTrue(verify_pin(first, "teacher-1", "482951"))
            self.assertFalse(verify_pin(first, "teacher-1", "482952"))
            self.assertFalse(verify_pin(first, "teacher-2", "482951"))

    def test_common_and_malformed_pins_are_rejected(self):
        for pin in ("123456", "000000", "111222", "abcdef", "12345", "1234567"):
            with self.subTest(pin=pin), self.assertRaises(ValueError):
                validate_pin(pin)

    def test_grant_tokens_are_random_and_stored_as_hashes(self):
        token_one, hash_one = issue_grant_token()
        token_two, hash_two = issue_grant_token()
        self.assertNotEqual(token_one, token_two)
        self.assertNotEqual(hash_one, hash_two)
        self.assertEqual(hash_one, token_hash(token_one))
        self.assertNotIn(token_one, hash_one)

    def test_session_id_is_read_from_verified_jwt_payload(self):
        import base64
        import json

        payload = base64.urlsafe_b64encode(
            json.dumps({"session_id": "session-123"}).encode("utf-8")
        ).decode("ascii").rstrip("=")
        self.assertEqual(
            extract_verified_session_id(f"header.{payload}.signature"),
            "session-123",
        )


if __name__ == "__main__":
    unittest.main()
