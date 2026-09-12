import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from core.security import AuthenticatedUser
from main import register_face
from services.face_enrollment_service import finalize_face_enrollment, renew_face_enrollment_challenge


def user(*, role: str, temporary: bool = False) -> AuthenticatedUser:
    return AuthenticatedUser(
        id="00000000-0000-0000-0000-000000000001",
        email="student@email.kmutnb.ac.th",
        role=role,
        base_role="teacher" if temporary else role,
        temporary_admin=temporary,
        auth_session_id="session-1",
        student_id="1234567890123" if role == "student" else None,
    )


class StudentFaceEnrollmentBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_malformed_student_id_is_rejected_before_image_processing(self):
        with self.assertRaises(HTTPException) as caught:
            await register_face(
                student_id="../../not-a-student",
                face_image=None,
                enrollment_challenge_id=None,
                liveness_token=None,
                liveness_evidence=None,
                liveness_passive_images=None,
                current_user=user(role="admin"),
            )
        self.assertEqual(caught.exception.status_code, 422)

    async def test_student_cannot_use_legacy_still_image_contract(self):
        with self.assertRaises(HTTPException) as caught:
            await register_face(
                student_id="1234567890123",
                face_image=None,
                enrollment_challenge_id=None,
                liveness_token=None,
                liveness_evidence=None,
                liveness_passive_images=None,
                current_user=user(role="student"),
            )
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("Liveness", caught.exception.detail)

    async def test_temporary_admin_cannot_replace_face_embedding(self):
        with self.assertRaises(HTTPException) as caught:
            await register_face(
                student_id="1234567890123",
                face_image=None,
                enrollment_challenge_id=None,
                liveness_token=None,
                liveness_evidence=None,
                liveness_passive_images=None,
                current_user=user(role="admin", temporary=True),
            )
        self.assertEqual(caught.exception.status_code, 403)


class FaceEnrollmentMigrationTests(unittest.TestCase):
    def test_challenge_table_and_rpcs_are_backend_only_and_atomic(self):
        migration = (
            Path(__file__).parents[2]
            / "supabase"
            / "migrations"
            / "20260907164433_secure_face_enrollment_liveness.sql"
        ).read_text(encoding="utf-8").lower()
        self.assertIn("alter table public.face_enrollment_challenges enable row level security", migration)
        self.assertIn("revoke all on table public.face_enrollment_challenges from public, anon, authenticated", migration)
        self.assertIn("security invoker", migration)
        self.assertIn("processing_token is distinct from claim_token", migration)
        self.assertIn("renew_face_enrollment_challenge", migration)
        self.assertIn("challenge.expires_at > now()", migration)
        self.assertIn("target_embedding::extensions.vector(512)", migration)
        self.assertLess(
            migration.index("update public.profiles profile"),
            migration.index("set consumed_at = now()"),
        )
        self.assertNotIn("grant execute on function public.finalize_face_enrollment(uuid, uuid, text, text, uuid)\n  to authenticated", migration)

    @patch("services.face_enrollment_service.supabase_db")
    def test_renewal_uses_account_bound_claim_token(self, database):
        response = Mock()
        response.data = True
        database.rpc.return_value.execute.return_value = response

        renewed = renew_face_enrollment_challenge(
            "00000000-0000-0000-0000-000000000010",
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000020",
        )

        self.assertTrue(renewed)
        database.rpc.assert_called_once_with(
            "renew_face_enrollment_challenge",
            {
                "target_challenge_id": "00000000-0000-0000-0000-000000000010",
                "target_user_id": "00000000-0000-0000-0000-000000000001",
                "claim_token": "00000000-0000-0000-0000-000000000020",
            },
        )

    @patch("services.face_enrollment_service.supabase_db")
    def test_embedding_is_sent_to_rpc_as_vector_text_not_logged_json(self, database):
        response = Mock()
        response.data = {"result": "registered"}
        database.rpc.return_value.execute.return_value = response
        finalize_face_enrollment(
            "00000000-0000-0000-0000-000000000010",
            "00000000-0000-0000-0000-000000000001",
            "1234567890123",
            [0.0] * 512,
            "00000000-0000-0000-0000-000000000020",
        )
        arguments = database.rpc.call_args.args[1]
        self.assertIsInstance(arguments["target_embedding"], str)
        self.assertTrue(arguments["target_embedding"].startswith("["))

    @patch("services.face_enrollment_service.supabase_db")
    def test_non_finite_embedding_is_rejected_before_database_call(self, database):
        with self.assertRaises(HTTPException) as caught:
            finalize_face_enrollment(
                "00000000-0000-0000-0000-000000000010",
                "00000000-0000-0000-0000-000000000001",
                "1234567890123",
                [0.0] * 511 + [float("nan")],
                "00000000-0000-0000-0000-000000000020",
            )
        self.assertEqual(caught.exception.status_code, 422)
        database.rpc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
