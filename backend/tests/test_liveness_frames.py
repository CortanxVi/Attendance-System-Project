import os
import unittest
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from services.insightface_service import FaceObservation
from services.liveness_frame_service import verify_liveness_frames


def observation(
    *,
    scale: float,
    left_eye: float = 0.30,
    right_eye: float = 0.30,
    yaw: float = 0.0,
    pitch: float = 0.0,
    center_offset: float = 0.02,
) -> FaceObservation:
    return FaceObservation(
        embedding=np.asarray([1.0, 0.0], dtype=np.float32),
        yaw_proxy=yaw,
        pitch_proxy=pitch,
        roll_proxy=0.0,
        detection_score=0.99,
        left_eye_aperture_proxy=left_eye,
        right_eye_aperture_proxy=right_eye,
        face_width_ratio=scale,
        center_offset=center_offset,
        bbox=(40.0, 20.0, 120.0, 100.0),
    )


def frame(value: int) -> np.ndarray:
    return np.full((120, 160, 3), value, dtype=np.uint8)


class LivenessFrameVerificationTests(unittest.TestCase):
    def valid_observations(self):
        return [
            observation(scale=0.40),
            observation(scale=0.49),
            observation(scale=0.405),
            observation(scale=0.40),
            observation(scale=0.40, left_eye=0.15, right_eye=0.14),
            observation(scale=0.40, left_eye=0.31, right_eye=0.30),
        ]

    @patch("services.liveness_frame_service.face_service.extract_strict_face_observation")
    @patch("services.liveness_frame_service.passive_pad_service.assert_live")
    def test_accepts_move_return_bilateral_blink_and_final_frame(self, _pad, extract):
        extract.side_effect = self.valid_observations()
        result = verify_liveness_frames(
            frame(0), frame(10), frame(20), [frame(30)], [frame(40)], frame(50), 1
        )
        np.testing.assert_array_equal(result.final_embedding, np.asarray([1.0, 0.0], dtype=np.float32))

    @patch("services.liveness_frame_service.face_service.extract_strict_face_observation")
    @patch("services.liveness_frame_service.passive_pad_service.assert_live")
    def test_accepts_moderate_webcam_geometry_noise(self, _pad, extract):
        extract.side_effect = [
            observation(scale=0.40),
            observation(scale=0.435, yaw=0.14, pitch=0.19, center_offset=0.28),
            observation(scale=0.405, yaw=0.12, pitch=0.16, center_offset=0.26),
            observation(scale=0.41, yaw=0.12, pitch=0.16, center_offset=0.26),
            observation(scale=0.40, left_eye=0.17, right_eye=0.16, yaw=0.14, pitch=0.19),
            observation(scale=0.405, left_eye=0.30, right_eye=0.31, yaw=0.12, pitch=0.16),
        ]
        result = verify_liveness_frames(
            frame(0), frame(10), frame(20), [frame(30)], [frame(40)], frame(50), 1
        )
        np.testing.assert_array_equal(result.final_embedding, np.asarray([1.0, 0.0], dtype=np.float32))

    @patch("services.liveness_frame_service.face_service.extract_strict_face_observation")
    @patch("services.liveness_frame_service.passive_pad_service.assert_live")
    def test_rejects_wink_when_one_eye_remains_open(self, _pad, extract):
        observations = self.valid_observations()
        observations[4] = observation(scale=0.40, left_eye=0.15, right_eye=0.29)
        extract.side_effect = observations
        with self.assertRaises(HTTPException):
            verify_liveness_frames(
                frame(0), frame(10), frame(20), [frame(30)], [frame(40)], frame(50), 1
            )

    @patch("services.liveness_frame_service.face_service.extract_strict_face_observation")
    @patch("services.liveness_frame_service.passive_pad_service.assert_live")
    def test_rejects_duplicated_static_movement_frames(self, _pad, extract):
        extract.side_effect = self.valid_observations()
        with self.assertRaises(HTTPException):
            verify_liveness_frames(
                frame(0), frame(0), frame(0), [frame(30)], [frame(40)], frame(50), 1
            )


if __name__ == "__main__":
    unittest.main()
