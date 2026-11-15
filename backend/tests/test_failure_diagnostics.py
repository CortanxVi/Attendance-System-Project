"""Phase 0 of TuningModelLog.md: every rejection says WHICH condition failed.

Outside test mode the user sees one plain Thai sentence for the single failing condition.
In test mode the message also ends with a "[รหัส <code> · measured value (limit) ...]" tag so
the failure table shows the code and the numbers. These tests pin both behaviours.
"""

import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from services import failure_diagnostics as fd
from services import liveness_frame_service as lfs
from services import test_mode_service as tms
from services.insightface_service import FaceObservation, StrictFaceFailure, face_service
from services.liveness_service import create_liveness_challenge, verify_liveness_submission
from services.passive_pad_service import passive_pad_service


def obs(*, scale=0.40, yaw=0.0, pitch=0.0, roll=0.0, center=0.02) -> FaceObservation:
    return FaceObservation(
        embedding=np.asarray([1.0, 0.0], dtype=np.float32),
        yaw_proxy=yaw,
        pitch_proxy=pitch,
        roll_proxy=roll,
        detection_score=0.99,
        left_eye_aperture_proxy=0.3,
        right_eye_aperture_proxy=0.3,
        face_width_ratio=scale,
        center_offset=center,
        bbox=(40.0, 20.0, 120.0, 100.0),
    )


class test_mode_on:
    """Context manager: switch the test-mode suffix on or off for the helper module."""

    def __init__(self, enabled: bool):
        self.patch = patch.object(fd, "ATTENDANCE_TEST_MODE", enabled)

    def __enter__(self):
        self.patch.start()

    def __exit__(self, *exc):
        self.patch.stop()


class HelperTests(unittest.TestCase):
    def test_suffix_exists_only_in_test_mode_and_round_trips(self):
        with test_mode_on(False):
            self.assertEqual(fd.diagnostic("fps", "x"), "")
        with test_mode_on(True):
            text = "ข้อความ" + fd.diagnostic("framing_yaw", "เฟรม 2", "yaw +0.21")
        self.assertEqual(fd.failure_code(text), "framing_yaw")
        self.assertIsNone(fd.failure_code("ข้อความธรรมดา"))
        self.assertEqual(tms.classify_failure(text), "framing_yaw")

    def test_limit_text(self):
        self.assertEqual(fd.limit(1.056, 1.08, 1.70), "1.06 (เกณฑ์ 1.08–1.70)")
        self.assertEqual(fd.limit(0.31, high=0.30), "0.31 (เกณฑ์ ≤0.30)")
        self.assertEqual(fd.limit(0.5, low=0.65), "0.50 (เกณฑ์ ≥0.65)")


class DetectReasonTests(unittest.TestCase):
    """Each branch of the strict face extraction reports its own reason."""

    def fake_face(self, score, *, kps=True):
        return SimpleNamespace(
            det_score=score,
            bbox=np.asarray([30.0, 20.0, 130.0, 140.0]),
            kps=np.asarray([[60, 60], [100, 60], [80, 80], [65, 105], [95, 105]], dtype=np.float32) if kps else None,
            landmark_3d_68=np.zeros((68, 3), dtype=np.float32),
            normed_embedding=np.ones(4, dtype=np.float32),
        )

    def run_extract(self, faces):
        image = np.zeros((200, 200, 3), dtype=np.uint8)
        with patch.object(face_service, "_detect_faces", return_value=faces):
            result = face_service.extract_strict_face_observation(image)
        return result, face_service.last_strict_failure()

    def test_no_face(self):
        result, failure = self.run_extract([])
        self.assertIsNone(result)
        self.assertEqual(failure.code, "detect_none")

    def test_faces_below_the_detector_floor_count_as_no_face(self):
        _result, failure = self.run_extract([self.fake_face(0.40)])
        self.assertEqual(failure.code, "detect_none")

    def test_two_confident_faces(self):
        _result, failure = self.run_extract([self.fake_face(0.90), self.fake_face(0.60)])
        self.assertEqual((failure.code, failure.face_count), ("detect_multi", 2))
        self.assertEqual(failure.scores, (0.9, 0.6))

    def test_single_face_with_too_low_a_score(self):
        _result, failure = self.run_extract([self.fake_face(0.52)])
        self.assertEqual((failure.code, failure.scores), ("detect_low_score", (0.52,)))

    def test_landmarks_that_cannot_be_read(self):
        _result, failure = self.run_extract([self.fake_face(0.90, kps=False)])
        self.assertEqual(failure.code, "detect_landmarks")

    def test_reason_is_cleared_on_the_next_successful_call(self):
        self.run_extract([])
        face = self.fake_face(0.90)
        face.landmark_3d_68[36:42] = [[0, 0, 0], [1, 2, 0], [2, 2, 0], [3, 0, 0], [2, -2, 0], [1, -2, 0]]
        face.landmark_3d_68[42:48] = face.landmark_3d_68[36:42] + 10
        result, failure = self.run_extract([face])
        self.assertIsNotNone(result)
        self.assertIsNone(failure)


class DetectMessageTests(unittest.TestCase):
    def message(self, failure, *, test_mode=False):
        with test_mode_on(test_mode):
            return lfs._detect_message("ภาพต่อเนื่องลำดับที่ 3", failure)

    def test_each_reason_has_its_own_plain_sentence_and_stage(self):
        cases = {
            "detect_none": ("ไม่พบใบหน้าในภาพ", StrictFaceFailure("detect_none")),
            "detect_multi": ("พบใบหน้ามากกว่า 1 ใบในภาพ", StrictFaceFailure("detect_multi", 2, (0.9, 0.6))),
            "detect_low_score": ("ใบหน้าไม่ชัดเจนพอ", StrictFaceFailure("detect_low_score", 1, (0.52,))),
            "detect_landmarks": ("อ่านตำแหน่งตาและปากไม่ได้", StrictFaceFailure("detect_landmarks", 1, (0.9,))),
        }
        seen = set()
        for stage, (phrase, failure) in cases.items():
            text = self.message(failure)
            self.assertIn(phrase, text)
            self.assertIn("ภาพต่อเนื่องลำดับที่ 3 ", text)  # the label is followed by a space
            self.assertNotIn("รหัส", text)
            self.assertEqual(tms.classify_failure(text), stage)
            seen.add(text)
        self.assertEqual(len(seen), 4)

    def test_unknown_reason_keeps_the_generic_sentence(self):
        text = self.message(None)
        self.assertIn("ต้องพบใบหน้าชัดเจนเพียง 1 คน", text)
        self.assertEqual(tms.classify_failure(text), "detect")

    def test_test_mode_adds_counts_and_scores(self):
        text = self.message(StrictFaceFailure("detect_multi", 2, (0.9, 0.6)), test_mode=True)
        self.assertIn("[รหัส detect_multi", text)
        self.assertIn("จำนวนใบหน้า 2 (ต้อง 1)", text)
        self.assertIn("0.90/0.60", text)
        low = self.message(StrictFaceFailure("detect_low_score", 1, (0.52,)), test_mode=True)
        self.assertIn("0.52 (เกณฑ์ ≥0.55)", low)

    def test_worst_case_message_fits_the_failure_reason_column(self):
        for failure in (
            StrictFaceFailure("detect_multi", 3, (0.99, 0.98, 0.97)),
            StrictFaceFailure("detect_low_score", 1, (0.52,)),
            StrictFaceFailure("detect_landmarks", 1, (0.9,)),
            StrictFaceFailure("detect_none"),
        ):
            self.assertLessEqual(len(self.message(failure, test_mode=True)), fd.MAX_REASON_CHARS)


class FramingTests(unittest.TestCase):
    def reference(self):
        return obs()

    def problem(self, candidate, tolerance=0.22):
        return lfs._frontal_problem(self.reference(), candidate, scale_tolerance=tolerance)

    def test_a_steady_pose_passes_and_the_bool_wrapper_agrees(self):
        steady = obs(yaw=0.05, pitch=-0.04, roll=0.03, scale=0.42)
        self.assertIsNone(self.problem(steady))
        self.assertTrue(lfs._frontal(self.reference(), steady, scale_tolerance=0.22))

    def test_each_pose_condition_reports_itself(self):
        cases = {
            "framing_yaw": obs(yaw=0.20),
            "framing_pitch": obs(pitch=-0.25),
            "framing_roll": obs(roll=0.22),
            "framing_scale": obs(scale=0.55),
            "framing_center": obs(center=0.35),
        }
        for code, candidate in cases.items():
            with self.subTest(code=code):
                problem = self.problem(candidate)
                self.assertEqual(problem.code, code)
                self.assertFalse(lfs._frontal(self.reference(), candidate, scale_tolerance=0.22))
                with test_mode_on(True):
                    text = lfs._framing_message(problem, lfs.FRAMING_PREFIX, "เฟรม 2")
                self.assertTrue(text.startswith(lfs.FRAMING_PREFIX))
                self.assertIn(f"[รหัส {code}", text)
                self.assertEqual(tms.classify_failure(text), code)
                with test_mode_on(False):
                    plain = lfs._framing_message(problem, lfs.FRAMING_PREFIX, "เฟรม 2")
                self.assertNotIn("รหัส", plain)
                self.assertEqual(tms.classify_failure(plain), code)

    def test_the_first_matching_condition_wins_and_numbers_include_the_limit(self):
        with test_mode_on(True):
            text = lfs._framing_message(self.problem(obs(yaw=0.21)), lfs.FRAMING_PREFIX, "เฟรม 3")
        self.assertIn("เฟรม 3", text)
        self.assertIn("+0.21 (เกณฑ์ ±0.14)", text)

    def test_the_recovery_frame_uses_its_own_prefix_and_codes(self):
        problem = lfs._frontal_problem(self.reference(), obs(pitch=0.30), scale_tolerance=0.20)
        with test_mode_on(True):
            text = lfs._framing_message(problem, lfs.RECOVERY_PREFIX, "เฟรมสุดท้าย")
        self.assertTrue(text.startswith(lfs.RECOVERY_PREFIX))
        self.assertEqual(tms.classify_failure(text), "recovery_pitch")
        with test_mode_on(False):
            plain = lfs._framing_message(problem, lfs.RECOVERY_PREFIX, "เฟรมสุดท้าย")
        self.assertEqual(tms.classify_failure(plain), "recovery")

    def test_first_frame_size_and_position(self):
        self.assertIsNone(lfs._first_frame_problem(obs(scale=0.40)))
        for candidate, code in (
            (obs(scale=0.10), "framing_small"),
            (obs(scale=0.90), "framing_large"),
            (obs(center=0.40), "framing_center"),
        ):
            with test_mode_on(True):
                text = lfs._first_frame_problem(candidate)
            self.assertTrue(text.startswith(lfs.FRAMING_PREFIX))
            self.assertEqual(tms.classify_failure(text), code)
            self.assertIn("เฟรม 1", text)

    def test_the_whole_verifier_reports_the_pose_that_broke_frame_three(self):
        frames = [np.full((120, 160, 3), value, dtype=np.uint8) for value in (10, 60, 120, 180, 240)]
        sequence = [obs(), obs(yaw=0.02), obs(roll=0.30)]
        with patch.object(lfs.face_service, "extract_strict_face_observation", side_effect=sequence), \
             patch.object(lfs.face_service, "calculate_similarity", return_value=0.9), \
             test_mode_on(True):
            with self.assertRaises(HTTPException) as caught:
                lfs.verify_hybrid_liveness_frames(frames[:3], frames[3], frames[4], "move_closer")
        detail = caught.exception.detail
        self.assertIn("เอียง(roll)", detail)
        self.assertIn("เฟรม 3", detail)
        self.assertEqual(tms.classify_failure(detail), "framing_roll")


class MoveCloserTests(unittest.TestCase):
    def problem(self, action, scale_ratio, test_mode=True):
        with test_mode_on(test_mode):
            return lfs._move_closer_problem(obs(), action, scale_ratio)

    def test_a_valid_move_has_no_problem(self):
        self.assertIsNone(self.problem(obs(scale=0.46), 1.15))

    def test_each_condition_reports_itself_and_the_measured_ratio(self):
        cases = {
            "move_closer_small": (obs(), 1.05),
            "move_closer_large": (obs(), 1.90),
            "move_closer_center": (obs(center=0.4), 1.2),
            "move_closer_yaw": (obs(yaw=0.2), 1.2),
            "move_closer_pitch": (obs(pitch=0.3), 1.2),
        }
        texts = set()
        for code, (action, ratio) in cases.items():
            text = self.problem(action, ratio)
            self.assertIn(f"[รหัส {code}", text)
            self.assertEqual(tms.classify_failure(text), code)
            plain = self.problem(action, ratio, test_mode=False)
            self.assertEqual(tms.classify_failure(plain), code)
            self.assertNotIn("รหัส", plain)
            texts.add(plain)
        self.assertEqual(len(texts), 5)
        self.assertIn("1.05 (เกณฑ์ 1.08–1.70)", self.problem(obs(), 1.05))


class PadMessageTests(unittest.TestCase):
    def run_pad(self, logits, test_mode):
        images = [np.zeros((200, 200, 3), dtype=np.uint8) for _ in range(3)]
        boxes = [(50.0, 50.0, 150.0, 150.0)] * 3
        session = MagicMock()
        session.run.return_value = [np.asarray(logits, dtype=np.float32)]
        with patch.object(passive_pad_service, "_session", session), test_mode_on(test_mode):
            passive_pad_service.assert_live(images, boxes)

    def test_passes_when_every_frame_is_live(self):
        self.run_pad([[3.0, 0.0]] * 3, True)

    def test_reports_the_live_probability_of_each_frame(self):
        # median rule (default): 0.88/0.57/0.12 -> median 0.57 < 0.60
        with self.assertRaises(HTTPException) as caught:
            self.run_pad([[2.0, 0.0], [0.3, 0.0], [-2.0, 0.0]], True)
        detail = caught.exception.detail
        self.assertIn("[รหัส pad", detail)
        self.assertIn("0.88/0.57/0.12", detail)
        self.assertIn("ค่ากลาง 0.57 ต่ำสุด 0.12", detail)
        self.assertIn("กฎ median: ค่ากลาง ≥0.60 และต่ำสุด ≥0.30", detail)
        self.assertEqual(tms.classify_failure(detail), "pad")

    def test_the_old_rule_reports_its_limit(self):
        from services import passive_pad_service as pps

        with patch.object(pps, "LIVENESS_PAD_RULE", "all_frames"), self.assertRaises(HTTPException) as caught:
            self.run_pad([[2.0, 0.0], [0.3, 0.0], [2.0, 0.0]], True)
        self.assertIn("0.88/0.57/0.88", caught.exception.detail)
        self.assertIn("กฎ all_frames: เกณฑ์ ≥0.65 ทุกเฟรม", caught.exception.detail)

    def test_no_numbers_outside_test_mode(self):
        with self.assertRaises(HTTPException) as caught:
            self.run_pad([[0.0, 2.0]] * 3, False)
        self.assertNotIn("รหัส", caught.exception.detail)
        self.assertEqual(tms.classify_failure(caught.exception.detail), "pad")

    def test_a_tiny_face_reports_its_size(self):
        images = [np.zeros((200, 200, 3), dtype=np.uint8)] * 3
        with test_mode_on(True), self.assertRaises(HTTPException) as caught:
            passive_pad_service.assert_live(images, [(10.0, 10.0, 50.0, 60.0)] * 3)
        self.assertIn("40×50", caught.exception.detail)
        self.assertEqual(tms.classify_failure(caught.exception.detail), "pad_size")


class IdentityAndRateTests(unittest.TestCase):
    def test_same_person_message_carries_the_similarity(self):
        with patch.object(lfs.face_service, "calculate_similarity", return_value=0.21), test_mode_on(True):
            with self.assertRaises(HTTPException) as caught:
                lfs._same_person(obs(), obs())
        self.assertIn("0.21 (เกณฑ์ ≥0.35)", caught.exception.detail)
        self.assertEqual(tms.classify_failure(caught.exception.detail), "same_person")

    def evidence_for(self, challenge):
        action = challenge.action
        prompt_at = 2_500 + challenge.prompt_delay_ms
        return {
            "version": 4, "mode": "hybrid", "sampleCount": 3, "action": action,
            "promptDelayMs": challenge.prompt_delay_ms,
            "frames": [
                {"kind": "passive_sample", "sampleIndex": 1, "timestampMs": 1_500},
                {"kind": "passive_sample", "sampleIndex": 2, "timestampMs": 2_000},
                {"kind": "passive_sample", "sampleIndex": 3, "timestampMs": 2_500},
                {"kind": "challenge_action", "action": action, "timestampMs": prompt_at + 200},
                {"kind": "challenge_recovery", "action": action, "timestampMs": prompt_at + 500},
            ],
            "startedAtMs": 1_000, "promptAtMs": prompt_at, "completedAtMs": prompt_at + 600,
            "effectiveFps": 20,
        }

    def submit(self, **changes):
        now = datetime.now(timezone.utc).replace(microsecond=0)
        challenge = create_liveness_challenge("challenge-1", "student-1", now + timedelta(minutes=1))
        evidence = self.evidence_for(challenge)
        evidence.update(changes)
        with test_mode_on(True), self.assertRaises(HTTPException) as caught:
            verify_liveness_submission(challenge.token, json.dumps(evidence), "challenge-1", "student-1", now=now)
        return caught.exception.detail

    def test_low_fps_reports_the_value_and_the_range(self):
        detail = self.submit(effectiveFps=5.4)
        self.assertIn("5.4 เฟรม/วินาที (เกณฑ์ 8–35)", detail)
        self.assertEqual(tms.classify_failure(detail), "fps")

    def test_a_too_long_attempt_reports_its_duration(self):
        detail = self.submit(completedAtMs=25_000)
        self.assertIn("[รหัส duration", detail)
        self.assertEqual(tms.classify_failure(detail), "duration")


if __name__ == "__main__":
    unittest.main()
