"""Passive PAD aggregation: production "median" rule and the "all_frames" kill switch.

Score triples are genuine scans from the round-two test data (pseudonymised, numbers only; the
16 scans the old rule refused). There is NO consented attack data, so these tests only pin the
rule's behaviour on genuine inputs and on boundaries; they say nothing about attack acceptance.
"""

import inspect
import math
import os
import random
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from core import config
from services import failure_diagnostics as fd
from services import liveness_frame_service as lfs
from services import passive_pad_service as pps
from services.insightface_service import FaceObservation

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# (per-frame live probabilities, expected under the median rule). All were refused by the old rule.
GENUINE_REFUSED_BY_OLD_RULE = [
    ((0.07, 0.68, 0.63), False),
    ((0.55, 0.77, 0.71), True),
    ((0.84, 0.47, 0.67), True),
    ((0.01, 0.06, 0.13), False),
    ((0.62, 0.47, 0.07), False),
    ((0.04, 0.77, 0.52), False),
    ((0.12, 0.07, 0.91), False),
    ((0.37, 0.96, 0.83), True),
    ((0.46, 0.78, 0.67), True),
    ((0.47, 0.90, 0.63), True),
    ((0.02, 0.09, 0.87), False),
    ((0.65, 0.00, 0.05), False),
    ((0.07, 0.13, 0.11), False),
    ((0.01, 0.06, 0.46), False),
    ((0.51, 0.33, 0.93), False),  # median 0.51 < 0.60
    ((0.28, 0.01, 0.08), False),
]


def to_logits(probabilities):
    return [pps.logit(min(max(p, 1e-4), 1 - 1e-4)) for p in probabilities]


def old_rule(logits):
    """The exact pre-2026-11-15 code: refuse when any value is non-finite or below logit(0.65)."""
    values = np.asarray(logits, dtype=np.float64)
    threshold = math.log(0.65 / (1 - 0.65))
    return not (not np.all(np.isfinite(values)) or np.any(values < threshold))


class test_mode:
    def __init__(self, enabled):
        self.patches = [patch.object(fd, "SHOW_MEASUREMENTS", enabled)]

    def __enter__(self):
        for item in self.patches:
            item.start()
        return None

    def __exit__(self, *exc):
        for item in self.patches:
            item.stop()


def run_assert_live(logits, enabled=False):
    images = [np.zeros((200, 200, 3), dtype=np.uint8) for _ in range(3)]
    boxes = [(50.0, 50.0, 150.0, 150.0)] * 3
    session = MagicMock()
    session.run.return_value = [np.asarray([[value, 0.0] for value in logits], dtype=np.float32)]
    with patch.object(pps.passive_pad_service, "_session", session), test_mode(enabled) as collector:
        error = None
        try:
            pps.passive_pad_service.assert_live(images, boxes)
        except HTTPException as exc:
            error = exc
        return error, (collector.snapshot() if collector else None)


class MedianRuleDecisionTests(unittest.TestCase):
    def test_defaults_are_the_owner_decision(self):
        self.assertEqual(config.LIVENESS_PAD_RULE, "median")
        self.assertEqual(config.LIVENESS_PAD_MEDIAN_THRESHOLD, 0.60)
        self.assertEqual(config.LIVENESS_PAD_MIN_FRAME_FLOOR, 0.30)
        self.assertEqual(config.LIVENESS_PAD_THRESHOLD, 0.65)

    def test_the_16_genuine_scans(self):
        passed = []
        for probabilities, expected in GENUINE_REFUSED_BY_OLD_RULE:
            with self.subTest(scores=probabilities):
                logits = to_logits(probabilities)
                self.assertEqual(pps.pad_decision(logits).live, expected)
                self.assertFalse(pps.pad_decision(logits, rule="all_frames").live)
                self.assertFalse(old_rule(logits))
                error, _snap = run_assert_live(logits)
                self.assertEqual(error is None, expected)
                if expected:
                    passed.append(probabilities)
        self.assertEqual(len(passed), 5)

    def test_boundaries(self):
        at = pps.logit
        self.assertTrue(pps.pad_decision([at(0.60), at(0.60), at(0.60)]).live)        # median exactly 0.60
        self.assertTrue(pps.pad_decision([at(0.30), at(0.60), at(0.99)]).live)        # min exactly 0.30
        self.assertFalse(pps.pad_decision([at(0.5999), at(0.5999), at(0.99)]).live)  # median just below
        self.assertFalse(pps.pad_decision([at(0.2999), at(0.80), at(0.99)]).live)    # min just below
        self.assertTrue(pps.pad_decision([at(0.65)] * 3, rule="all_frames").live)
        self.assertFalse(pps.pad_decision([at(0.6499), at(0.99), at(0.99)], rule="all_frames").live)

    def test_non_finite_or_wrong_count_fails_closed(self):
        good = to_logits((0.9, 0.9, 0.9))
        for rule in ("median", "all_frames"):
            for index in range(3):
                for bad in (math.nan, math.inf, -math.inf):
                    values = list(good)
                    values[index] = bad
                    with self.subTest(rule=rule, index=index, value=bad):
                        self.assertFalse(pps.pad_decision(values, rule=rule).live)
            self.assertFalse(pps.pad_decision(good[:2], rule=rule).live)
            self.assertFalse(pps.pad_decision(good + good[:1], rule=rule).live)
            self.assertFalse(pps.pad_decision([], rule=rule).live)
        self.assertFalse(pps.pad_decision(good, rule="unknown").live)
        error, _ = run_assert_live([math.nan, 5.0, 5.0])
        self.assertIsNotNone(error)

    def test_kill_switch_restores_the_old_rule_exactly(self):
        rng = random.Random(11)
        threshold = pps.logit(0.65)
        cases = [[rng.uniform(-6, 6) for _ in range(3)] for _ in range(3000)]
        cases += [[threshold, threshold, threshold], [threshold - 1e-9, 5, 5], [math.nan, 5, 5], [math.inf, 5, 5]]
        for logits in cases:
            self.assertEqual(pps.pad_decision(logits, rule="all_frames").live, old_rule(logits), logits)
        with patch.object(pps, "LIVENESS_PAD_RULE", "all_frames"):
            for probabilities, _expected in GENUINE_REFUSED_BY_OLD_RULE:
                error, _ = run_assert_live(to_logits(probabilities))
                self.assertIsNotNone(error)
            self.assertIsNone(run_assert_live(to_logits((0.66, 0.70, 0.99)))[0])

    def test_logit_space_matches_probability_space(self):
        rng = random.Random(3)
        for _ in range(3000):
            p = [rng.uniform(0.001, 0.999) for _ in range(3)]
            expected = sorted(p)[1] >= 0.60 and min(p) >= 0.30
            self.assertEqual(pps.pad_decision([pps.logit(x) for x in p]).live, expected, p)


class PadMessageAndDiagnosticsTests(unittest.TestCase):
    def test_production_message_is_plain_and_actionable(self):
        error, snap = run_assert_live(to_logits((0.07, 0.68, 0.63)), enabled=False)
        detail = error.detail
        self.assertIsNone(snap)
        self.assertTrue(detail.startswith("ตรวจพบความเสี่ยงจากภาพถ่ายหรือหน้าจอ"))
        self.assertIsNone(fd.failure_code(detail))
        for advice in ("แสงสว่าง", "ระดับสายตา", "30–40 ซม.", "นิ่ง", "เลนส์", "Chrome", "Safari", "ในแอป"):
            self.assertIn(advice, detail)
        self.assertNotIn("รหัส", detail)
        self.assertNotIn("0.6", detail)

    def test_measurement_tag(self):
        error, snap = run_assert_live(to_logits((0.51, 0.33, 0.93)), enabled=True)
        detail = error.detail
        self.assertEqual(fd.failure_code(detail), "pad")
        self.assertIn("0.51/0.33/0.93", detail)
        self.assertIn("ค่ากลาง 0.51 ต่ำสุด 0.33", detail)
        self.assertIn("กฎ median: ค่ากลาง ≥0.60 และต่ำสุด ≥0.30", detail)
        self.assertLessEqual(len(detail), fd.MAX_REASON_CHARS)


def obs(scale=0.40):
    return FaceObservation(
        embedding=np.asarray([1.0, 0.0], dtype=np.float32), yaw_proxy=0.0, pitch_proxy=0.0, roll_proxy=0.0,
        detection_score=0.99, left_eye_aperture_proxy=0.30, right_eye_aperture_proxy=0.30,
        face_width_ratio=scale, center_offset=0.02, bbox=(40.0, 20.0, 140.0, 120.0),
    )


class PadRuleEverywhereTests(unittest.TestCase):
    def test_the_hybrid_verifier_uses_the_new_rule(self):
        frames = [np.full((200, 200, 3), value, dtype=np.uint8) for value in (10, 60, 120, 180, 240)]
        session = MagicMock()
        session.run.return_value = [np.asarray([[v, 0.0] for v in to_logits((0.84, 0.47, 0.67))], dtype=np.float32)]
        with patch.object(lfs.face_service, "extract_strict_face_observation",
                          side_effect=[obs(), obs(), obs(), obs(0.46), obs()]), \
             patch.object(lfs.face_service, "calculate_similarity", return_value=0.9), \
             patch.object(pps.passive_pad_service, "_session", session):
            lfs.verify_hybrid_liveness_frames(frames[:3], frames[3], frames[4], "move_closer")  # passes
        with patch.object(lfs.face_service, "extract_strict_face_observation",
                          side_effect=[obs(), obs(), obs(), obs(0.46), obs()]), \
             patch.object(lfs.face_service, "calculate_similarity", return_value=0.9), \
             patch.object(pps.passive_pad_service, "_session", session), \
             patch.object(pps, "LIVENESS_PAD_RULE", "all_frames"), self.assertRaises(HTTPException):
            lfs.verify_hybrid_liveness_frames(frames[:3], frames[3], frames[4], "move_closer")

    def test_attendance_and_enrollment_share_assert_live(self):
        import main

        source = inspect.getsource(main)
        for route in ("/api/v1/enrollment/register-face", "/api/v1/attendance/verify"):
            body = source.split(f'@app.post("{route}")', 1)[1].split("@app.post", 1)[0]
            self.assertIn("verify_hybrid_liveness_frames", body)
        verifier = inspect.getsource(lfs.verify_hybrid_liveness_frames)
        self.assertIn("passive_pad_service.assert_live(", verifier)
        assert_live = inspect.getsource(pps.PassivePadService.assert_live)
        self.assertIn("pad_decision(logit_differences)", assert_live)
        self.assertNotIn("_logit_threshold", assert_live)


class PadSettingsValidationTests(unittest.TestCase):
    def test_config_validation(self):
        check = config.validate_pad_rule_settings
        check("median", 0.60, 0.30)
        check("all_frames", 0.60, 0.30)
        check("median", 0.60, 0.60)
        for rule, median, floor in (
            ("min", 0.60, 0.30), ("", 0.60, 0.30), ("median", 0.60, 0.70), ("median", 1.0, 0.30),
            ("median", 0.60, 0.0), ("median", math.nan, 0.30), ("median", 0.60, math.inf),
        ):
            with self.subTest(rule=rule, median=median, floor=floor), self.assertRaises(RuntimeError):
                check(rule, median, floor)

    def test_float_settings_reject_text(self):
        with patch.dict(os.environ, {"LIVENESS_PAD_MEDIAN_THRESHOLD": "high"}):
            with self.assertRaisesRegex(RuntimeError, "LIVENESS_PAD_MEDIAN_THRESHOLD must be a number"):
                config._float_setting("LIVENESS_PAD_MEDIAN_THRESHOLD", "0.60")
        with patch.dict(os.environ, {"LIVENESS_PAD_MEDIAN_THRESHOLD": "  "}):
            self.assertEqual(config._float_setting("LIVENESS_PAD_MEDIAN_THRESHOLD", "0.60"), 0.60)

    def preflight(self, backend_extra=""):
        script = PROJECT_ROOT / "scripts" / "production_preflight.py"
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            backend_env = tmp_path / "backend.env"
            backend_env.write_text("APP_ENV=production\n" + backend_extra, encoding="utf-8")
            ocr_env = tmp_path / "ocr.env"
            ocr_env.write_text("NODE_ENV=production\n", encoding="utf-8")
            frontend_env = tmp_path / "frontend.env"
            frontend_env.write_text("", encoding="utf-8")
            return subprocess.run(
                [sys.executable, "-I", str(script), "--backend-env", str(backend_env),
                 "--ocr-env", str(ocr_env), "--frontend-env", str(frontend_env),
                 "--model-root", str(tmp_path), "--allow-development"],
                capture_output=True, text=True, timeout=60, check=False,
            ).stdout

    def test_preflight_bounds(self):
        self.assertNotIn("LIVENESS_PAD", self.preflight())  # defaults are fine
        self.assertNotIn("LIVENESS_PAD", self.preflight("LIVENESS_PAD_RULE=all_frames\nLIVENESS_PAD_THRESHOLD=0.65\n"))
        self.assertNotIn("LIVENESS_PAD", self.preflight("LIVENESS_PAD_MEDIAN_THRESHOLD=0.50\nLIVENESS_PAD_MIN_FRAME_FLOOR=0.20\n"))
        for extra, message in (
            ("LIVENESS_PAD_RULE=mean\n", "LIVENESS_PAD_RULE must be median or all_frames"),
            ("LIVENESS_PAD_MEDIAN_THRESHOLD=0.49\n", "LIVENESS_PAD_MEDIAN_THRESHOLD must be between 0.50"),
            ("LIVENESS_PAD_MIN_FRAME_FLOOR=0.19\n", "LIVENESS_PAD_MIN_FRAME_FLOOR must be between 0.20"),
            ("LIVENESS_PAD_MIN_FRAME_FLOOR=0.70\n", "must not exceed LIVENESS_PAD_MEDIAN_THRESHOLD"),
            ("LIVENESS_PAD_MEDIAN_THRESHOLD=abc\n", "LIVENESS_PAD_MEDIAN_THRESHOLD must be a number"),
            ("LIVENESS_PAD_MIN_FRAME_FLOOR=nan\n", "LIVENESS_PAD_MIN_FRAME_FLOOR must be a finite number"),
            ("LIVENESS_PAD_THRESHOLD=0.40\n", "LIVENESS_PAD_THRESHOLD must be between 0.50 and 0.95"),
        ):
            with self.subTest(extra=extra):
                self.assertIn(message, self.preflight(extra))

if __name__ == "__main__":
    unittest.main()
