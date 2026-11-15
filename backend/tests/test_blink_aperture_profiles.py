"""Server-side blink rules for narrow, wide and asymmetric eyes.

The aperture numbers here are the 68-point "eye aperture proxy" values the verifier reads.
They are scenario inputs, not measurements of a face model; the field values come from the
test-build overlay and from the failure text stored in face_checkin_attempts.
"""

import os
import unittest
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from services.insightface_service import FaceObservation
from services import liveness_frame_service as lfs
from services.liveness_frame_service import (
    BLINK_CLOSED_RATIO_NARROW,
    BLINK_CLOSED_RATIO_STRICT,
    BLINK_RECOVERY_RATIO,
    blink_aperture_problem,
    blink_closed_ratio_limit,
    verify_hybrid_liveness_frames,
)


def obs(left: float, right: float | None = None, *, pitch: float = 0.0) -> FaceObservation:
    return FaceObservation(
        embedding=np.asarray([1.0, 0.0], dtype=np.float32),
        yaw_proxy=0.0,
        pitch_proxy=pitch,
        roll_proxy=0.0,
        detection_score=0.99,
        left_eye_aperture_proxy=left,
        right_eye_aperture_proxy=left if right is None else right,
        face_width_ratio=0.40,
        center_offset=0.02,
        bbox=(40.0, 20.0, 120.0, 100.0),
    )


# (name, open left, open right, shut left, shut right): the eyelid is shut to `shut` during the action.
# `shut` is what a landmark model can reach: it cannot go below an absolute floor, so narrow eyes drop less.
SHAPES = {
    "very_wide": (0.42, 0.42, 0.14, 0.14),
    "wide": (0.34, 0.34, 0.12, 0.12),
    "normal": (0.27, 0.27, 0.12, 0.12),
    "narrow": (0.20, 0.20, 0.11, 0.11),
    "monolid": (0.15, 0.15, 0.10, 0.10),
    "very_narrow": (0.12, 0.12, 0.07, 0.07),
    "asymmetric": (0.30, 0.18, 0.12, 0.10),
}


class BlinkLimitCurveTests(unittest.TestCase):
    def test_limit_is_strict_for_open_eyes_and_looser_for_narrow_eyes(self):
        self.assertEqual(blink_closed_ratio_limit(0.40), BLINK_CLOSED_RATIO_STRICT)
        self.assertEqual(blink_closed_ratio_limit(lfs.BLINK_WIDE_EAR), BLINK_CLOSED_RATIO_STRICT)
        self.assertEqual(blink_closed_ratio_limit(0.05), BLINK_CLOSED_RATIO_NARROW)
        self.assertEqual(blink_closed_ratio_limit(lfs.BLINK_NARROW_EAR), BLINK_CLOSED_RATIO_NARROW)

    def test_limit_never_decreases_as_the_eye_gets_narrower(self):
        values = [blink_closed_ratio_limit(ear / 100) for ear in range(40, 4, -1)]
        self.assertEqual(values, sorted(values))
        self.assertTrue(all(BLINK_CLOSED_RATIO_STRICT <= v <= BLINK_CLOSED_RATIO_NARROW for v in values))

    def test_a_static_photo_never_passes_for_any_eye_shape(self):
        # A photo keeps ratio ~1.0 (the experiment measured 0.8-1.4% relative jitter).
        for name, (open_l, open_r, _sl, _sr) in SHAPES.items():
            for jitter in (-0.04, -0.02, 0.0, 0.02, 0.04):
                with self.subTest(shape=name, jitter=jitter):
                    still = obs(open_l * (1 + jitter), open_r * (1 + jitter))
                    self.assertIsNotNone(blink_aperture_problem(open_l, open_r, still, still))


class BlinkAperturePerShapeTests(unittest.TestCase):
    def test_every_eye_shape_passes_with_a_real_closure_and_reopening(self):
        for name, (open_l, open_r, shut_l, shut_r) in SHAPES.items():
            for relaxed in (0.78, 0.85, 0.95, 1.0):
                with self.subTest(shape=name, reopen=relaxed):
                    problem = blink_aperture_problem(
                        open_l,
                        open_r,
                        obs(shut_l, shut_r),
                        obs(open_l * relaxed, open_r * relaxed),
                    )
                    self.assertIsNone(problem, problem)

    def test_a_wink_is_rejected_for_every_eye_shape(self):
        for name, (open_l, open_r, shut_l, _shut_r) in SHAPES.items():
            with self.subTest(shape=name):
                wink = obs(shut_l, open_r)
                self.assertIsNotNone(blink_aperture_problem(open_l, open_r, wink, obs(open_l, open_r)))

    def test_eyes_that_stay_shut_after_the_action_are_rejected(self):
        for name, (open_l, open_r, shut_l, shut_r) in SHAPES.items():
            with self.subTest(shape=name):
                shut = obs(shut_l, shut_r)
                self.assertIsNotNone(blink_aperture_problem(open_l, open_r, shut, shut))

    def test_wide_eyes_keep_the_strict_limit(self):
        # A barely narrowed wide eye (ratio 0.84) must not count as a blink for a wide-eyed person.
        self.assertIsNotNone(blink_aperture_problem(0.34, 0.34, obs(0.34 * 0.84), obs(0.34)))
        self.assertIsNone(blink_aperture_problem(0.34, 0.34, obs(0.34 * 0.70), obs(0.34)))

    def test_very_narrow_eyes_accept_a_proportionally_smaller_drop(self):
        # 0.12 -> 0.10 is ratio 0.83: not a blink for wide eyes, accepted for very narrow ones.
        self.assertIsNone(blink_aperture_problem(0.12, 0.12, obs(0.10), obs(0.12)))
        self.assertIsNotNone(blink_aperture_problem(0.34, 0.34, obs(0.34 * 0.83), obs(0.34)))

    def test_recovery_threshold_tolerates_people_who_relax_after_staring_wide(self):
        self.assertIsNone(blink_aperture_problem(0.30, 0.30, obs(0.10), obs(0.30 * 0.75)))
        self.assertIsNotNone(blink_aperture_problem(0.30, 0.30, obs(0.10), obs(0.30 * 0.60)))
        self.assertLess(BLINK_RECOVERY_RATIO, 0.78)


class BlinkResolutionLimitTests(unittest.TestCase):
    def test_closed_and_open_windows_overlap_only_when_the_lid_barely_moves(self):
        """Documented limit: for an eye whose closed aperture stays at 0.70-0.88 of the open one
        (floor-limited landmarks on very narrow eyes) a closed frame cannot be told from a relaxed
        open one by aperture alone. The closure still passes; the frontend blend-shape score and the
        PAD / frame-difference checks carry the rest, so this is a limit to watch, not a hidden pass."""
        self.assertIsNone(blink_aperture_problem(0.12, 0.12, obs(0.10), obs(0.12)))
        overlap = set(
            round(x / 100, 2) for x in range(0, 101)
            if x / 100 <= BLINK_CLOSED_RATIO_NARROW and x / 100 >= BLINK_RECOVERY_RATIO
        )
        self.assertTrue(overlap)  # the overlap exists, so it must never grow unnoticed
        self.assertLessEqual(BLINK_CLOSED_RATIO_NARROW - BLINK_RECOVERY_RATIO, 0.20)


class BlinkMessageTests(unittest.TestCase):
    def test_failure_text_tells_the_person_to_hold_the_eyes_shut_and_clear_hair(self):
        problem = blink_aperture_problem(0.3, 0.3, obs(0.3), obs(0.3))
        self.assertIn("คำสั่งกะพริบตาไม่ผ่าน", problem)  # keeps the failure classifier marker
        self.assertIn("ให้สนิทสักครู่", problem)  # same wording as the web BLINK_PROMPT
        self.assertNotIn("1 วินาที", problem)
        self.assertIn("เก็บผมที่ปิดตา", problem)

    def test_measured_ratios_are_only_added_in_test_mode(self):
        from services import failure_diagnostics as fd

        with patch.object(fd, "ATTENDANCE_TEST_MODE", False):
            self.assertNotIn("รหัส", blink_aperture_problem(0.3, 0.3, obs(0.3), obs(0.3)))
        with patch.object(fd, "ATTENDANCE_TEST_MODE", True):
            text = blink_aperture_problem(0.3, 0.3, obs(0.3), obs(0.3))
            self.assertIn("[รหัส blink", text)
            self.assertIn("1.00/1.00", text)

    def test_no_face_message_asks_to_clear_the_face(self):
        def frame(value):
            return np.full((120, 160, 3), value, dtype=np.uint8)

        with patch("services.liveness_frame_service.face_service.extract_strict_face_observation", return_value=None):
            with self.assertRaises(HTTPException) as caught:
                verify_hybrid_liveness_frames([frame(1), frame(2), frame(3)], frame(4), frame(5), "blink")
        detail = caught.exception.detail
        self.assertIn("ต้องพบใบหน้าชัดเจนเพียง 1 คน", detail)  # keeps the failure classifier marker
        self.assertIn("เปิดหน้าผาก", detail)
        self.assertIn("เก็บผมที่ปิดคิ้วหรือตา", detail)


if __name__ == "__main__":
    unittest.main()
