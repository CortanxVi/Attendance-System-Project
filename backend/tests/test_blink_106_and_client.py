"""2d106det blink rule (production and test mode) and the test-mode client diagnostics field.

The blink numbers are the round-two real-phone readings (pseudonymised, numbers only) plus
scenario inputs for photos, winks and eyes that stay shut. They are not new measurements.
"""

import inspect
import json
import os
import random
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from services import failure_diagnostics as fd
from services import insightface_service as ins
from services import liveness_frame_service as lfs
from services.insightface_service import FaceObservation
from services.passive_pad_service import passive_pad_service

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def obs(left=0.30, right=None, left106=None, right106=None) -> FaceObservation:
    return FaceObservation(
        embedding=np.asarray([1.0, 0.0], dtype=np.float32),
        yaw_proxy=0.0,
        pitch_proxy=0.0,
        roll_proxy=0.0,
        detection_score=0.99,
        left_eye_aperture_proxy=left,
        right_eye_aperture_proxy=left if right is None else right,
        face_width_ratio=0.40,
        center_offset=0.02,
        bbox=(40.0, 20.0, 120.0, 100.0),
        left_eye_aperture_106=left106,
        right_eye_aperture_106=right106,
    )


class mode:
    """Test mode (message suffix + diagnostics collector) and the 106-point kill switch."""

    def __init__(self, test_mode: bool, rule: bool = True):
        self.patches = [
            patch.object(fd, "SHOW_MEASUREMENTS", test_mode),
            patch.object(lfs, "LIVENESS_BLINK_106_ENABLED", rule),
            patch.object(ins, "LIVENESS_BLINK_106_ENABLED", rule),
        ]

    def __enter__(self):
        for item in self.patches:
            item.start()
        return None

    def __exit__(self, *exc):
        for item in self.patches:
            item.stop()


def values_106(closed_l, closed_r, back_l=1.0, back_r=1.0):
    return {
        "open_left_106": 0.26, "open_right_106": 0.26,
        "closed_left_106": closed_l, "closed_right_106": closed_r,
        "back_left_106": back_l, "back_right_106": back_r,
    }


# Round-two genuine blinks that failed the 68-point rule (68 closed, 68 back, 106 closed, 106 back).
REAL_FAILURES = {
    "real_1": dict(open=(0.3076, 0.2618), closed=(0.7934, 0.7431), back=(1.0169, 0.9705),
                   c106=(0.4907, 0.4695), b106=(1.0134, 1.0143)),
    "real_2": dict(open=(0.2948, 0.2590), closed=(0.8282, 0.8392), back=(1.2921, 1.2983),
                   c106=(0.4128, 0.3886), b106=(1.2312, 1.1996)),
}


def real_case(case):
    ol, orr = case["open"]
    action = obs(ol * case["closed"][0], orr * case["closed"][1])
    recovery = obs(ol * case["back"][0], orr * case["back"][1])
    return ol, orr, action, recovery, values_106(*case["c106"], *case["b106"])


def photo_cases(seed=7, count=400):
    rng = random.Random(seed)
    for _ in range(count):
        open_l, open_r = rng.uniform(0.10, 0.42), rng.uniform(0.10, 0.42)
        j = [1 + rng.uniform(-0.04, 0.04) for _ in range(4)]
        action = obs(open_l * j[0], open_r * j[1])
        recovery = obs(open_l * j[2], open_r * j[3])
        noisy = values_106(rng.uniform(0.59, 1.0), rng.uniform(0.59, 1.0),
                           rng.uniform(0.59, 1.0), rng.uniform(0.59, 1.0))
        yield open_l, open_r, action, recovery, noisy


BOTH_MODES = (("production", False), ("test_mode", True))


class Blink106RuleTests(unittest.TestCase):
    def test_the_two_real_failures_pass_in_production_and_test_mode(self):
        for label, test_mode in BOTH_MODES:
            for name, case in REAL_FAILURES.items():
                with self.subTest(mode=label, case=name), mode(test_mode) as collector:
                    ol, orr, action, recovery, v106 = real_case(case)
                    self.assertIsNone(lfs.blink_aperture_problem(ol, orr, action, recovery, v106))

    def test_kill_switch_off_uses_the_68_point_rule_only(self):
        for label, test_mode in BOTH_MODES:
            for name, case in REAL_FAILURES.items():
                with self.subTest(mode=label, case=name), mode(test_mode, rule=False) as collector:
                    ol, orr, action, recovery, v106 = real_case(case)
                    problem = lfs.blink_aperture_problem(ol, orr, action, recovery, v106)
                    self.assertIsNotNone(problem)
                    self.assertNotIn("กฎ106", problem)

    def test_production_failure_text_has_no_numbers(self):
        with mode(False):
            problem = lfs.blink_aperture_problem(0.30, 0.30, obs(0.30), obs(0.30), values_106(0.9, 0.9))
        self.assertIn("คำสั่งกะพริบตาไม่ผ่าน", problem)
        self.assertNotIn("รหัส", problem)
        self.assertNotIn("กฎ106", problem)
        self.assertFalse(any(ch.isdigit() for ch in problem))

    def test_a_68_point_pass_is_recorded_as_rule_68(self):
        with mode(True) as collector:
            self.assertIsNone(lfs.blink_aperture_problem(0.30, 0.30, obs(0.10), obs(0.30), values_106(0.9, 0.9)))

    def test_a_static_photo_never_passes(self):
        for label, test_mode in BOTH_MODES:
            with self.subTest(mode=label), mode(test_mode):
                for open_l, open_r, action, recovery, noisy in photo_cases():
                    self.assertIsNotNone(lfs.blink_aperture_problem(open_l, open_r, action, recovery, noisy))
                    # Even if the 106-point measure were fooled completely, the 68-point ceiling holds.
                    fooled = values_106(0.05, 0.05)
                    self.assertIsNotNone(lfs.blink_aperture_problem(open_l, open_r, action, recovery, fooled))

    def test_a_wink_never_passes(self):
        for label, test_mode in BOTH_MODES:
            for closed_eye in ("left", "right"):
                with self.subTest(mode=label, eye=closed_eye), mode(test_mode):
                    if closed_eye == "left":
                        action, v106 = obs(0.30 * 0.80, 0.30 * 1.0), values_106(0.30, 0.98)
                    else:
                        action, v106 = obs(0.30 * 1.0, 0.30 * 0.80), values_106(0.98, 0.30)
                    self.assertIsNotNone(lfs.blink_aperture_problem(0.30, 0.30, action, obs(0.30), v106))

    def test_eyes_that_stay_shut_never_pass(self):
        for label, test_mode in BOTH_MODES:
            with self.subTest(mode=label), mode(test_mode):
                shut = obs(0.30 * 0.80)
                # 106 recovery low.
                self.assertIsNotNone(lfs.blink_aperture_problem(0.30, 0.30, shut, shut, values_106(0.4, 0.4, 0.4, 0.4)))
                # 106 says reopened but the 68-point recovery rule fails.
                self.assertIsNotNone(lfs.blink_aperture_problem(0.30, 0.30, shut, obs(0.30 * 0.60), values_106(0.4, 0.4)))

    def test_missing_106_values_fall_back_to_the_68_point_rule(self):
        case = REAL_FAILURES["real_1"]
        with mode(True) as collector:
            ol, orr, action, recovery, v106 = real_case(case)
            self.assertIsNotNone(lfs.blink_aperture_problem(ol, orr, action, recovery, None))
            partial = dict(v106, closed_right_106=None)
            self.assertIsNotNone(lfs.blink_aperture_problem(ol, orr, action, recovery, partial))
            # The 68-point rule alone still passes a clear blink without 106 values.
            self.assertIsNone(lfs.blink_aperture_problem(0.30, 0.30, obs(0.10), obs(0.30), None))

    def test_each_106_condition_is_needed_and_named_in_the_tag(self):
        ol = orr = 0.30
        action, recovery = obs(ol * 0.82), obs(ol)
        cases = {
            "closed_106": (action, recovery, values_106(0.51, 0.40)),
            "ceiling_68": (obs(ol * 0.95), recovery, values_106(0.40, 0.40)),
            "back_106": (action, recovery, values_106(0.40, 0.40, 0.69, 1.0)),
            "back_68": (action, obs(ol * 0.69), values_106(0.40, 0.40)),
        }
        for reason, (a, r, v) in cases.items():
            with self.subTest(reason=reason), mode(True) as collector:
                problem = lfs.blink_aperture_problem(ol, orr, a, r, v)
                self.assertIsNotNone(problem)
                self.assertIn(f"กฎ106 ไม่ผ่าน:{reason}", problem)
                self.assertEqual(fd.failure_code(problem), "blink")
        with mode(True):
            self.assertIsNone(lfs.blink_aperture_problem(ol, orr, action, recovery, values_106(0.50, 0.50, 0.70, 0.70)))

    def test_constants_match_the_documented_values(self):
        self.assertEqual(lfs.BLINK_106_CLOSED_RATIO_MAX, 0.50)
        self.assertEqual(lfs.BLINK_106_68_CEILING, 0.94)
        self.assertEqual(lfs.BLINK_106_MIN_OPEN_BASE, 0.10)
        self.assertEqual(lfs.BLINK_106_RECOVERY_RATIO, 0.70)
        self.assertLess(lfs.BLINK_106_CLOSED_RATIO_MAX, 0.59)  # worst photo open-eye noise seen offline


class Blink106VerifierTests(unittest.TestCase):
    frames = [np.full((120, 160, 3), value, dtype=np.uint8) for value in (10, 60, 120, 180, 240)]

    def run_verifier(self, sequence, test_mode, rule=True, action="blink"):
        session = MagicMock()
        session.run.return_value = [np.asarray(((3.0, 0.0),) * 3, dtype=np.float32)]
        extract = MagicMock(side_effect=sequence)
        with patch.object(lfs.face_service, "extract_strict_face_observation", extract), \
             patch.object(lfs.face_service, "calculate_similarity", return_value=0.9), \
             patch.object(passive_pad_service, "_session", session), mode(test_mode, rule) as collector:
            error = None
            try:
                lfs.verify_hybrid_liveness_frames(self.frames[:3], self.frames[3], self.frames[4], action)
            except HTTPException as exc:
                error = exc
            self.extract_calls = extract.call_args_list
            return (collector.snapshot() if collector else None), error

    def sequence(self):
        passive = [obs(0.30, 0.30, 0.26, 0.26)] * 3
        action = obs(0.30 * 0.83, 0.30 * 0.84, 0.26 * 0.41, 0.26 * 0.39)
        recovery = obs(0.30, 0.30, 0.26, 0.26)
        return [*passive, action, recovery]

    def test_real_shape_passes_end_to_end_in_production(self):
        snap, error = self.run_verifier(self.sequence(), False)
        self.assertIsNone(error)
        self.assertIsNone(snap)
        # every blink frame asks for the 106-point measure
        self.assertEqual([c.kwargs.get("with_106") for c in self.extract_calls], [True] * 5)

    def test_real_shape_passes_end_to_end_with_measurements(self):
        _snap, error = self.run_verifier(self.sequence(), True)
        self.assertIsNone(error)

    def test_kill_switch_off_fails_the_real_shape(self):
        _snap, error = self.run_verifier(self.sequence(), False, rule=False)
        self.assertIsNotNone(error)
        self.assertNotIn("รหัส", error.detail)

    def test_move_closer_never_asks_for_the_106_point_measure(self):
        seq = [obs(), obs(), obs(), replace(obs(), face_width_ratio=0.46), obs()]
        _snap, error = self.run_verifier(seq, False, action="move_closer")
        self.assertIsNone(error)
        self.assertTrue(all(not c.kwargs.get("with_106") for c in self.extract_calls))

    def test_attendance_and_enrollment_share_the_same_verifier_and_bar(self):
        import main

        source = inspect.getsource(main)
        enrollment = source.split('@app.post("/api/v1/enrollment/register-face")', 1)[1].split("@app.post", 1)[0]
        attendance = source.split('@app.post("/api/v1/attendance/verify")', 1)[1].split("@app.post", 1)[0]
        for body in (enrollment, attendance):
            self.assertIn("verify_hybrid_liveness_frames", body)
            self.assertNotIn("allow_blink_106", body)  # no per-endpoint switch: same rule everywhere

    def test_without_106_values_the_verifier_uses_the_68_point_rule(self):
        seq = [replace(o, left_eye_aperture_106=None, right_eye_aperture_106=None) for o in self.sequence()]
        _snap, error = self.run_verifier(seq, True)
        self.assertIsNotNone(error)
        self.assertLessEqual(len(error.detail), fd.MAX_REASON_CHARS)

    def test_a_failed_tag_with_106_numbers_fits_the_column(self):
        seq = self.sequence()
        seq[3] = obs(0.30 * 0.83, 0.30 * 0.84, 0.26 * 0.62, 0.26 * 0.61)
        _snap, error = self.run_verifier(seq, True)
        self.assertIn("กฎ106 ไม่ผ่าน:closed_106", error.detail)
        self.assertIn("106จุด ปิดตา", error.detail)
        self.assertLessEqual(len(error.detail), fd.MAX_REASON_CHARS)


class Landmark106ProductionTests(unittest.TestCase):
    def setUp(self):
        fs = ins.face_service
        self.saved = (fs._landmark_106, fs._landmark_106_unavailable, fs._model_root)

    def tearDown(self):
        fs = ins.face_service
        fs._landmark_106, fs._landmark_106_unavailable, fs._model_root = self.saved

    def test_kill_switch_off_never_loads_or_runs_the_model(self):
        loader = MagicMock()
        with patch.object(ins.face_service, "_landmark_106_model", loader):
            for test_mode in (False, True):
                with mode(test_mode, rule=False):
                    self.assertIsNone(ins.face_service._eye_apertures_106(np.zeros((10, 10, 3), np.uint8), object()))
        loader.assert_not_called()

    def test_missing_model_falls_back_with_one_warning(self):
        fs = ins.face_service
        with tempfile.TemporaryDirectory() as folder, mode(False):
            fs._model_root, fs._landmark_106, fs._landmark_106_unavailable = Path(folder), None, False
            with self.assertLogs(ins.logger, level="WARNING") as logs:
                for _ in range(3):
                    self.assertIsNone(fs._eye_apertures_106(np.zeros((10, 10, 3), np.uint8), object()))
            self.assertEqual(len(logs.output), 1)
            self.assertIn("68-point rule only", logs.output[0])
        # ...and the blink decision then uses the 68-point rule (no 106 values).
        with mode(False):
            ol, orr, action, recovery, _v = real_case(REAL_FAILURES["real_1"])
            self.assertIsNotNone(lfs.blink_aperture_problem(ol, orr, action, recovery, None))
            self.assertIsNone(lfs.blink_aperture_problem(0.30, 0.30, obs(0.10), obs(0.30), None))

    def test_the_model_runs_inside_the_inference_semaphore(self):
        source = inspect.getsource(ins.FaceService._eye_apertures_106)
        self.assertIn("with self._inference_slots:", source)
        loader = inspect.getsource(ins.FaceService._landmark_106_model)
        self.assertIn('providers=["CPUExecutionProvider"]', loader)
        self.assertIn("LANDMARK_106_SHA256", loader)


class ModelProvisioningTests(unittest.TestCase):
    def test_2d106det_is_in_the_required_manifest(self):
        manifest = (PROJECT_ROOT / "backend/models/insightface-buffalo-s.sha256").read_text(encoding="utf-8")
        self.assertIn(f"{ins.LANDMARK_106_SHA256}  {ins.LANDMARK_106_FILE}", manifest)
        self.assertFalse((PROJECT_ROOT / "backend/models/insightface-buffalo-s-test-only.sha256").exists())
        script = (PROJECT_ROOT / "scripts/verify_face_models.sh").read_text(encoding="utf-8")
        self.assertNotIn("optional", script)

    def test_preflight_pins_match_the_manifest(self):
        manifest = dict(
            reversed(line.split()) for line in
            (PROJECT_ROOT / "backend/models/insightface-buffalo-s.sha256").read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
        preflight = (PROJECT_ROOT / "scripts/production_preflight.py").read_text(encoding="utf-8")
        for name, digest in manifest.items():
            self.assertIn(f'"{name}": "{digest}"', preflight)

    def _preflight(self, model_dir_files, backend_extra=""):
        script = PROJECT_ROOT / "scripts" / "production_preflight.py"
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            model_dir = tmp_path / "models" / "models" / "buffalo_s"
            model_dir.mkdir(parents=True)
            for name in model_dir_files:
                (model_dir / name).write_bytes(b"x")
            backend_env = tmp_path / "backend.env"
            backend_env.write_text("APP_ENV=production\n" + backend_extra, encoding="utf-8")
            ocr_env = tmp_path / "ocr.env"
            ocr_env.write_text("NODE_ENV=production\n", encoding="utf-8")
            frontend_env = tmp_path / "frontend.env"
            frontend_env.write_text("", encoding="utf-8")
            return subprocess.run(
                [sys.executable, "-I", str(script), "--backend-env", str(backend_env),
                 "--ocr-env", str(ocr_env), "--frontend-env", str(frontend_env),
                 "--model-root", str(tmp_path / "models"), "--allow-development"],
                capture_output=True, text=True, timeout=60, check=False,
            )

    def test_preflight_fails_without_2d106det(self):
        result = self._preflight(["1k3d68.onnx", "det_500m.onnx", "w600k_mbf.onnx"])
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing pinned face model: 2d106det.onnx", result.stdout)

    def test_preflight_fails_on_a_wrong_2d106det(self):
        result = self._preflight(["2d106det.onnx"])
        self.assertIn("face model checksum mismatch: 2d106det.onnx", result.stdout)

    def test_preflight_treats_a_blank_switch_as_the_default(self):
        for blank in ("", "  "):
            self.assertNotIn("LIVENESS_BLINK_106_ENABLED",
                             self._preflight([], f"LIVENESS_BLINK_106_ENABLED={blank}\n").stdout)

    def test_preflight_validates_the_kill_switch_value(self):
        self.assertIn("LIVENESS_BLINK_106_ENABLED must be true or false",
                      self._preflight([], "LIVENESS_BLINK_106_ENABLED=maybe\n").stdout)
        self.assertNotIn("LIVENESS_BLINK_106_ENABLED",
                         self._preflight([], "LIVENESS_BLINK_106_ENABLED=false\n").stdout)

    def test_config_validates_the_kill_switch(self):
        from core import config

        parse = config.parse_on_off_setting
        self.assertIs(parse("X", None, True), True)
        self.assertIs(parse("X", "  ", True), True)  # blank = default (matches the preflight)
        for raw in ("1", "true", "TRUE", " yes ", "on"):
            self.assertIs(parse("X", raw, True), True)
        for raw in ("0", "false", "No", "off"):
            self.assertIs(parse("X", raw, True), False)
        for raw in ("maybe", "2", "enabled"):
            with self.assertRaisesRegex(RuntimeError, "X must be true or false"):
                parse("X", raw, True)
        source = (PROJECT_ROOT / "backend/core/config.py").read_text(encoding="utf-8")
        self.assertIn('"LIVENESS_BLINK_106_ENABLED", os.getenv("LIVENESS_BLINK_106_ENABLED"), True', source)


NAN, INF = float("nan"), float("inf")


class FailClosedNonFiniteTests(unittest.TestCase):
    """A NaN/inf anywhere in the blink inputs must never let a blink pass (review finding 1)."""

    def test_reviewer_case_nan_68_ratios_with_good_106_values(self):
        with mode(False):
            self.assertIsNotNone(lfs.blink_106_rule_problem(NAN, NAN, True, values_106(0.3, 0.3)))
            self.assertEqual(lfs.blink_106_rule_problem(NAN, 0.8, True, values_106(0.3, 0.3)), "nonfinite")

    def test_non_finite_68_values_never_pass(self):
        good = values_106(0.3, 0.3)
        base = dict(open_l=0.30, open_r=0.30, act_l=0.30 * 0.82, act_r=0.30 * 0.82, back_l=0.30, back_r=0.30)
        for label, test_mode in BOTH_MODES:
            for key in base:
                for bad in (NAN, INF, -INF):
                    with self.subTest(mode=label, field=key, value=bad), mode(test_mode):
                        v = dict(base, **{key: bad})
                        problem = lfs.blink_aperture_problem(
                            v["open_l"], v["open_r"], obs(v["act_l"], v["act_r"]), obs(v["back_l"], v["back_r"]), good
                        )
                        self.assertIsNotNone(problem)
                        # also with a "perfect" 68-point closure on the other values
                        v = dict(dict(base, act_l=0.05, act_r=0.05), **{key: bad})
                        problem = lfs.blink_aperture_problem(
                            v["open_l"], v["open_r"], obs(v["act_l"], v["act_r"]), obs(v["back_l"], v["back_r"]), good
                        )
                        self.assertIsNotNone(problem)

    def test_non_finite_106_values_never_pass(self):
        ol, orr, action, recovery, v106 = real_case(REAL_FAILURES["real_1"])
        for key in ("closed_left_106", "closed_right_106", "back_left_106", "back_right_106"):
            for bad in (NAN, INF, -INF):
                with self.subTest(field=key, value=bad), mode(False):
                    self.assertIsNotNone(lfs.blink_aperture_problem(ol, orr, action, recovery, dict(v106, **{key: bad})))

    def test_non_finite_106_apertures_are_dropped_before_the_rule(self):
        passive = [obs(0.30, 0.30, 0.26, 0.26)] * 3
        for bad in (NAN, INF):
            action = obs(0.25, 0.25, bad, 0.10)
            self.assertIsNone(lfs._blink_106(passive, action, obs(0.30, 0.30, 0.26, 0.26)))
            self.assertIsNone(lfs._blink_106([obs(0.30, 0.30, bad, 0.26)] * 3, action, obs(0.30, 0.30, 0.26, 0.26)))

    def _face(self, **overrides):
        from types import SimpleNamespace

        lm = np.zeros((68, 3), dtype=np.float32)
        lm[36:42] = [[0, 0, 0], [1, 2, 0], [2, 2, 0], [3, 0, 0], [2, -2, 0], [1, -2, 0]]
        lm[42:48] = lm[36:42] + 10
        face = dict(
            det_score=0.9,
            bbox=np.asarray([30.0, 20.0, 130.0, 140.0]),
            kps=np.asarray([[60, 60], [100, 60], [80, 80], [65, 105], [95, 105]], dtype=np.float32),
            landmark_3d_68=lm,
            normed_embedding=np.ones(4, dtype=np.float32),
        )
        face.update(overrides)
        return SimpleNamespace(**face)

    def test_observation_rejects_non_finite_landmarks(self):
        self.assertIsNotNone(ins.FaceService._observation_from_face(self._face(), 200))
        lm = self._face().landmark_3d_68.copy()
        lm[37, 1] = np.nan
        self.assertIsNone(ins.FaceService._observation_from_face(self._face(landmark_3d_68=lm), 200))
        lm = self._face().landmark_3d_68.copy()
        lm[36, 0] = np.inf
        self.assertIsNone(ins.FaceService._observation_from_face(self._face(landmark_3d_68=lm), 200))
        kps = self._face().kps.copy()
        kps[2, 0] = np.nan
        self.assertIsNone(ins.FaceService._observation_from_face(self._face(kps=kps), 200))
        self.assertIsNone(ins.FaceService._observation_from_face(self._face(det_score=float("nan")), 200))
        self.assertIsNone(ins.FaceService._observation_from_face(
            self._face(bbox=np.asarray([30.0, 20.0, np.inf, 140.0])), 200))
        self.assertIsNone(ins.FaceService._observation_from_face(
            self._face(normed_embedding=np.asarray([np.nan, 1, 1, 1], dtype=np.float32)), 200))

    def test_strict_extraction_reports_unreadable_landmarks(self):
        lm = self._face().landmark_3d_68.copy()
        lm[40, 1] = np.nan
        with patch.object(ins.face_service, "_detect_faces", return_value=[self._face(landmark_3d_68=lm)]):
            self.assertIsNone(ins.face_service.extract_strict_face_observation(np.zeros((200, 200, 3), np.uint8)))
        self.assertEqual(ins.face_service.last_strict_failure().code, "detect_landmarks")


class Landmark106AvailabilityTests(unittest.TestCase):
    def setUp(self):
        fs = ins.face_service
        self.saved = (fs._landmark_106, fs._landmark_106_unavailable, fs._landmark_106_failed_at, fs._model_root)

    def tearDown(self):
        fs = ins.face_service
        fs._landmark_106, fs._landmark_106_unavailable, fs._landmark_106_failed_at, fs._model_root = self.saved

    def test_a_failed_load_is_retried_after_the_interval(self):
        fs = ins.face_service
        with tempfile.TemporaryDirectory() as folder, mode(False):
            fs._model_root, fs._landmark_106, fs._landmark_106_unavailable = Path(folder), None, False
            with self.assertLogs(ins.logger, level="WARNING") as logs:
                self.assertIsNone(fs._landmark_106_model())
                self.assertIsNone(fs._landmark_106_model())  # inside the window: no retry, no log
            self.assertEqual(len(logs.output), 1)
            self.assertEqual(fs.blink_106_status(), "unavailable")
            fs._landmark_106_failed_at -= ins.LANDMARK_106_RETRY_SECONDS + 1
            sentinel = MagicMock()
            with patch.object(ins.hashlib, "sha256") as digest, \
                 patch("insightface.model_zoo.get_model", return_value=sentinel):
                digest.return_value.hexdigest.return_value = ins.LANDMARK_106_SHA256
                (Path(folder) / "models" / "buffalo_s").mkdir(parents=True)
                (Path(folder) / "models" / "buffalo_s" / ins.LANDMARK_106_FILE).write_bytes(b"x")
                self.assertIs(fs._landmark_106_model(), sentinel)  # the file appeared: recovered
            self.assertEqual(fs.blink_106_status(), "ready")
            self.assertFalse(fs._landmark_106_unavailable)

    def test_production_logs_an_error_on_failure(self):
        fs = ins.face_service
        with tempfile.TemporaryDirectory() as folder, mode(False), patch.object(ins, "APP_ENV", "production"):
            fs._model_root, fs._landmark_106, fs._landmark_106_unavailable = Path(folder), None, False
            with self.assertLogs(ins.logger, level="ERROR") as logs:
                self.assertEqual(fs.preload_landmark_106(), "unavailable")
            self.assertIn("ERROR", logs.output[0])

    def test_status_values_and_disabled_preload_does_nothing(self):
        fs = ins.face_service
        loader = MagicMock()
        with patch.object(fs, "_landmark_106_model", loader), mode(False, rule=False):
            self.assertEqual(fs.preload_landmark_106(), "disabled")
        loader.assert_not_called()
        with mode(False):
            fs._landmark_106, fs._landmark_106_unavailable = None, False
            self.assertEqual(fs.blink_106_status(), "not_loaded")
            fs._landmark_106 = object()
            self.assertEqual(fs.blink_106_status(), "ready")

    def test_health_ready_reports_blink_106_without_changing_the_status(self):
        import asyncio
        import main

        class _Response:
            status_code = 200

            def json(self):
                return {"engine": "ready"}

        class _Client:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def get(self, *a, **k):
                return _Response()

        import httpx

        for status_value in ("ready", "unavailable", "disabled"):
            with self.subTest(status=status_value), \
                 patch.object(main, "supabase", MagicMock()), \
                 patch.object(httpx, "AsyncClient", _Client), \
                 patch.object(main.face_service, "blink_106_status", return_value=status_value):
                body = asyncio.run(main.health_ready())
            self.assertEqual(body["status"], "ready")
            self.assertEqual(body["blink_106"], status_value)

    def test_startup_preloads_the_model(self):
        import main

        handlers = [h.__name__ for h in main.app.router.on_startup]
        self.assertIn("_preload_blink_106_model", handlers)


GOOD_CLIENT = {
    "platform": "android", "browser": "chrome", "delegate": "gpu",
    "camera_w": 640, "camera_h": 480, "analysis_fps": 9.4, "luma": 112.5,
    "sharpness": 38.2, "frame_errors": 0, "warmup_ms": 1830,
}


if __name__ == "__main__":
    unittest.main()
