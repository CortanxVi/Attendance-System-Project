"""Phase 0 gap + Phase 2 data capture (TuningModelLog.md).

* Every rejection of the signed evidence/timing contract carries its own code and numbers in
  test mode (timing_interval, timing_action_span, token_*, evidence_*, sequence_*), and the
  classifier still maps the plain (production) sentences to a stage instead of "other".
* In test mode every attempt stores a numbers-only diagnostics object; the writer survives a
  database without the new column.
* scripts/evaluate_pad_roc.py computes FRR/FAR for the three PAD aggregation rules and refuses
  to recommend a change on too little data.
"""

import asyncio
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from services import failure_diagnostics as fd
from services import liveness_frame_service as lfs
from services import liveness_service as ls
from services.insightface_service import FaceObservation
from services.passive_pad_service import passive_pad_service

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def obs(*, scale=0.40, yaw=0.0, pitch=0.0, roll=0.0, center=0.02, left=0.30, right=0.30) -> FaceObservation:
    return FaceObservation(
        embedding=np.asarray([1.0, 0.0], dtype=np.float32),
        yaw_proxy=yaw,
        pitch_proxy=pitch,
        roll_proxy=roll,
        detection_score=0.99,
        left_eye_aperture_proxy=left,
        right_eye_aperture_proxy=right,
        face_width_ratio=scale,
        center_offset=center,
        bbox=(40.0, 20.0, 120.0, 100.0),
    )


class test_mode:
    """Switch the message suffix AND the diagnostics collector on or off."""

    def __init__(self, enabled: bool):
        self.patches = [
            patch.object(fd, "SHOW_MEASUREMENTS", enabled),
        ]

    def __enter__(self):
        for item in self.patches:
            item.start()
        return self

    def __exit__(self, *exc):
        for item in self.patches:
            item.stop()


# ---------------------------------------------------------------- Phase 0: timing / contract codes


class EvidenceContractCodeTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.challenge = ls.create_liveness_challenge("challenge-1", "student-1", self.now + timedelta(minutes=1))

    def evidence(self, **changes):
        action = self.challenge.action
        prompt_at = 2_500 + self.challenge.prompt_delay_ms
        evidence = {
            "version": 4, "mode": "hybrid", "sampleCount": 3, "action": action,
            "promptDelayMs": self.challenge.prompt_delay_ms,
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
        evidence.update(changes)
        return evidence

    def submit(self, evidence, *, enabled=True, student="student-1", now=None):
        with test_mode(enabled), self.assertRaises(HTTPException) as caught:
            ls.verify_liveness_submission(
                self.challenge.token, json.dumps(evidence), "challenge-1", student, now=now or self.now
            )
        return caught.exception.detail

    def set_frame_time(self, evidence, index, value):
        evidence["frames"][index]["timestampMs"] = value
        return evidence

    def test_a_long_gap_between_passive_samples_reports_which_interval(self):
        evidence = self.set_frame_time(self.evidence(), 2, 4_600)  # 2 000 -> 4 600 = 2 600 ms
        evidence["promptAtMs"] = 4_600 + self.challenge.prompt_delay_ms
        evidence["frames"][3]["timestampMs"] = evidence["promptAtMs"] + 200
        evidence["frames"][4]["timestampMs"] = evidence["promptAtMs"] + 500
        evidence["completedAtMs"] = evidence["promptAtMs"] + 600
        detail = self.submit(evidence)
        self.assertIn("[รหัส timing_interval", detail)
        self.assertIn("ช่วงที่ 2 (เฟรม 2→3) 2600 มิลลิวินาที (เกณฑ์ 250–2000)", detail)
        self.assertIn("ทุกช่วง 500/2600", detail)
        self.assertEqual(fd.failure_code(detail), "timing_interval")
        plain = self.submit(evidence, enabled=False)
        self.assertNotIn("รหัส", plain)
        self.assertTrue(plain.startswith("ช่วงเวลาหลักฐานภาพไม่เป็นธรรมชาติ"))
        self.assertIsNone(fd.failure_code(plain))

    def test_a_too_short_interval_is_reported_too(self):
        detail = self.submit(self.set_frame_time(self.evidence(), 1, 1_600))  # 100 ms then 900 ms
        self.assertIn("ช่วงที่ 1 (เฟรม 1→2) 100 มิลลิวินาที", detail)

    def test_a_slow_return_after_the_action_reports_the_span(self):
        evidence = self.evidence()
        action_at = evidence["frames"][3]["timestampMs"]
        evidence["frames"][4]["timestampMs"] = action_at + 5_400
        evidence["completedAtMs"] = action_at + 5_500
        detail = self.submit(evidence)
        self.assertIn("[รหัส timing_action_span", detail)
        self.assertIn("5400 มิลลิวินาที (เกณฑ์ ≤5000)", detail)
        self.assertIn("ภายใน 5 วินาที", detail)
        self.assertEqual(fd.failure_code(detail), "timing_action_span")
        plain = self.submit(evidence, enabled=False)
        self.assertTrue(plain.startswith("เวลาคำสั่งสุ่มไม่ต่อเนื่อง"))
        self.assertIsNone(fd.failure_code(plain))

    def test_each_timing_order_rule_has_its_own_code(self):
        delay = self.challenge.prompt_delay_ms
        cases = {
            "timing_start": dict(startedAtMs=1_600),
            "timing_prompt_delay": dict(promptAtMs=2_500 + delay - 1),
        }
        for code, change in cases.items():
            with self.subTest(code=code):
                evidence = self.evidence(**change)
                if code == "timing_prompt_delay":
                    evidence["frames"][3]["timestampMs"] = evidence["promptAtMs"] + 200
                self.assertEqual(fd.failure_code(self.submit(evidence)), code)
        early = self.evidence()
        early["frames"][3]["timestampMs"] = early["promptAtMs"] - 50
        self.assertEqual(fd.failure_code(self.submit(early)), "timing_action_early")
        backwards = self.evidence()
        backwards["frames"][4]["timestampMs"] = backwards["frames"][3]["timestampMs"]
        self.assertEqual(fd.failure_code(self.submit(backwards)), "timing_recovery_order")
        late = self.evidence()
        late["completedAtMs"] = late["frames"][4]["timestampMs"] - 1
        self.assertEqual(fd.failure_code(self.submit(late)), "timing_recovery_late")

    def test_shape_and_sequence_problems_name_the_field_not_the_value(self):
        detail = self.submit(self.evidence(effectiveFps=20, sampleCount=4))
        self.assertIn("[รหัส evidence_shape", detail)
        self.assertIn("sampleCount", detail)
        evidence = self.evidence()
        evidence["frames"][1]["sampleIndex"] = 5
        detail = self.submit(evidence)
        self.assertEqual(fd.failure_code(detail), "sequence_passive")
        self.assertIn("เฟรมที่ 2", detail)
        evidence = self.evidence()
        evidence["frames"][4]["kind"] = "other"
        self.assertEqual(fd.failure_code(self.submit(evidence)), "sequence_action")
        evidence = self.evidence(startedAtMs="x")
        self.assertEqual(fd.failure_code(self.submit(evidence)), "evidence_value")

    def test_token_binding_reports_only_field_names(self):
        detail = self.submit(self.evidence(), student="student-2")
        self.assertIn("[รหัส token_binding · ไม่ตรง: student", detail)
        self.assertNotIn("student-1", detail)
        self.assertNotIn("student-2", detail)
        self.assertEqual(fd.failure_code(detail), "token_binding")

    def test_an_expired_token_reports_how_late(self):
        detail = self.submit(self.evidence(), now=self.now + timedelta(minutes=2))
        self.assertIn("[รหัส token_expired", detail)
        self.assertIn("หมดอายุมาแล้ว 60 วินาที", detail)

    def test_the_bad_token_and_bad_json_paths(self):
        with test_mode(True), self.assertRaises(HTTPException) as caught:
            ls.verify_liveness_submission("no-dot", "{}", "challenge-1", "student-1", now=self.now)
        self.assertEqual(fd.failure_code(caught.exception.detail), "token_missing")
        with test_mode(True), self.assertRaises(HTTPException) as caught:
            ls.verify_liveness_submission(self.challenge.token, "{", "challenge-1", "student-1", now=self.now)
        self.assertEqual(fd.failure_code(caught.exception.detail), "evidence_json")
        broken = self.challenge.token[:-2] + ("AA" if not self.challenge.token.endswith("AA") else "BB")
        with test_mode(True), self.assertRaises(HTTPException) as caught:
            ls.verify_liveness_submission(broken, "{}", "challenge-1", "student-1", now=self.now)
        self.assertIn(fd.failure_code(caught.exception.detail), {"token_signature", "token_encoding"})

    def test_every_contract_message_fits_the_reason_column(self):
        evidence = self.set_frame_time(self.evidence(), 1, 1_600)
        self.assertLessEqual(len(self.submit(evidence)), fd.MAX_REASON_CHARS)

    def test_no_liveness_contract_failure_falls_back_to_other(self):
        source = (PROJECT_ROOT / "backend/services/liveness_service.py").read_text(encoding="utf-8")
        import re

        sentences = set(re.findall(r'detail=f?"([^"{]+)', source))
        self.assertGreater(len(sentences), 10)
        for sentence in sentences:
            self.assertNotEqual(fd.failure_code(sentence), "other", sentence)


# ---------------------------------------------------------------- Phase 2: collector


# ---------------------------------------------------------------- Phase 2: writer + migration


class _MissingColumnError(Exception):
    def __init__(self):
        super().__init__("Could not find the 'diagnostics' column of 'face_checkin_attempts' in the schema cache")
        self.code = "PGRST204"


class _Db:
    def __init__(self, failures):
        self.failures = list(failures)
        self.rows = []

    def table(self, name):
        db = self

        class _T:
            def insert(self, row):
                db.rows.append(dict(row))
                return self

            def execute(self):
                if db.failures:
                    raise db.failures.pop(0)
                return SimpleNamespace(data=[])

        return _T()


# ---------------------------------------------------------------- offline PAD ROC evaluator


def load_evaluator():
    path = PROJECT_ROOT / "scripts/evaluate_pad_roc.py"
    spec = importlib.util.spec_from_file_location("evaluate_pad_roc", path)
    module = importlib.util.module_from_spec(spec)
    import sys

    sys.modules[spec.name] = module  # dataclasses look the module up by name
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------- B1: 2d106det eye measure (test mode)

from services import insightface_service as ins  # noqa: E402


def landmarks_106(left_gap=3.0, right_gap=3.0):
    """(106, 2) array with both eyes 10 px wide and the given lid gaps (other points at 0)."""
    points = np.zeros((106, 2), dtype=np.float32)
    for (corner_a, corner_b), pairs, x0, gap in (
        (*ins.EYE_106_LEFT, 0.0, left_gap),
        (*ins.EYE_106_RIGHT, 40.0, right_gap),
    ):
        points[corner_a] = (x0, 50.0)
        points[corner_b] = (x0 + 10.0, 50.0)
        for offset, (upper, lower) in enumerate(pairs, start=1):
            points[upper] = (x0 + 2.5 * offset, 50.0 - gap / 2)
            points[lower] = (x0 + 2.5 * offset, 50.0 + gap / 2)
    return points


def obs106(left106, right106, **kwargs):
    from dataclasses import replace

    return replace(obs(**kwargs), left_eye_aperture_106=left106, right_eye_aperture_106=right106)


class Landmark106Tests(unittest.TestCase):
    def setUp(self):
        self.saved = (face_service_attr("_landmark_106"), face_service_attr("_landmark_106_unavailable"),
                      face_service_attr("_model_root"))

    def tearDown(self):
        fs = ins.face_service
        fs._landmark_106, fs._landmark_106_unavailable, fs._model_root = self.saved

    def test_the_aperture_formula(self):
        self.assertAlmostEqual(ins.eye_aperture_106(landmarks_106(3.0), ins.EYE_106_LEFT), 0.3, places=5)
        self.assertAlmostEqual(ins.eye_aperture_106(landmarks_106(3.0, 0.5), ins.EYE_106_RIGHT), 0.05, places=5)
        self.assertIsNone(ins.eye_aperture_106(np.zeros((106, 2), dtype=np.float32), ins.EYE_106_LEFT))

    def test_the_index_groups_are_the_verified_ones(self):
        self.assertEqual(ins.EYE_106_LEFT, ((35, 39), ((41, 36), (40, 33), (42, 37))))
        self.assertEqual(ins.EYE_106_RIGHT, ((89, 93), ((95, 90), (94, 87), (96, 91))))

    def test_the_kill_switch_stops_the_model_in_every_mode(self):
        # Since 2026-11-15 production runs 2d106det for blink frames (second blink rule); only the
        # LIVENESS_BLINK_106_ENABLED kill switch stops it. It is still never part of FaceAnalysis.
        loader = MagicMock()
        with patch.object(ins.face_service, "_landmark_106_model", loader), \
             patch.object(ins, "LIVENESS_BLINK_106_ENABLED", False):
            for enabled in (False, True):
                with test_mode(enabled):
                    self.assertIsNone(ins.face_service._eye_apertures_106(np.zeros((10, 10, 3), np.uint8), object()))
        loader.assert_not_called()
        source = (PROJECT_ROOT / "backend/services/insightface_service.py").read_text(encoding="utf-8")
        modules = source.split("allowed_modules=", 1)[1].split("]", 1)[0]
        self.assertNotIn("landmark_2d_106", modules)

    def test_a_model_error_never_fails_the_scan(self):
        model = MagicMock()
        model.get.side_effect = RuntimeError("onnx failure")
        with patch.object(ins.face_service, "_landmark_106_model", return_value=model), \
             test_mode(True), \
             self.assertLogs(ins.logger, level="WARNING"):
            self.assertIsNone(ins.face_service._eye_apertures_106(np.zeros((10, 10, 3), np.uint8), object()))

    def test_a_missing_or_wrong_file_is_skipped_with_one_warning(self):
        fs = ins.face_service
        with tempfile.TemporaryDirectory() as folder:
            fs._model_root, fs._landmark_106, fs._landmark_106_unavailable = Path(folder), None, False
            with self.assertLogs(ins.logger, level="WARNING") as logs:
                self.assertIsNone(fs._landmark_106_model())
                self.assertIsNone(fs._landmark_106_model())
            self.assertEqual(len(logs.output), 1)
            self.assertIn("FileNotFoundError", logs.output[0])
            (Path(folder) / "models" / "buffalo_s").mkdir(parents=True)
            (Path(folder) / "models" / "buffalo_s" / ins.LANDMARK_106_FILE).write_bytes(b"not the model")
            fs._landmark_106_unavailable = False
            with self.assertLogs(ins.logger, level="WARNING") as logs:
                self.assertIsNone(fs._landmark_106_model())
            self.assertIn("checksum", logs.output[0])

    def test_the_strict_extraction_attaches_the_values_only_when_asked(self):
        face = SimpleNamespace(
            det_score=0.9,
            bbox=np.asarray([30.0, 20.0, 130.0, 140.0]),
            kps=np.asarray([[60, 60], [100, 60], [80, 80], [65, 105], [95, 105]], dtype=np.float32),
            landmark_3d_68=np.zeros((68, 3), dtype=np.float32),
            normed_embedding=np.ones(4, dtype=np.float32),
        )
        face.landmark_3d_68[36:42] = [[0, 0, 0], [1, 2, 0], [2, 2, 0], [3, 0, 0], [2, -2, 0], [1, -2, 0]]
        face.landmark_3d_68[42:48] = face.landmark_3d_68[36:42] + 10
        image = np.zeros((200, 200, 3), dtype=np.uint8)
        with patch.object(ins.face_service, "_detect_faces", return_value=[face]), \
             patch.object(ins.face_service, "_eye_apertures_106", return_value=(0.31, 0.29)):
            observation = ins.face_service.extract_strict_face_observation(image, with_106=True)
        self.assertEqual((observation.left_eye_aperture_106, observation.right_eye_aperture_106), (0.31, 0.29))
        measure = MagicMock(return_value=(0.31, 0.29))
        with patch.object(ins.face_service, "_detect_faces", return_value=[face]), \
             patch.object(ins.face_service, "_eye_apertures_106", measure):
            plain = ins.face_service.extract_strict_face_observation(image)
        measure.assert_not_called()  # non-blink frames skip the extra inference
        self.assertIsNone(plain.left_eye_aperture_106)
        self.assertEqual(plain.left_eye_aperture_proxy, observation.left_eye_aperture_proxy)

    def test_the_manifests(self):
        required = (PROJECT_ROOT / "backend/models/insightface-buffalo-s.sha256").read_text(encoding="utf-8")
        # 2d106det is required in production since the second blink rule (2026-11-15).
        self.assertIn(f"{ins.LANDMARK_106_SHA256}  {ins.LANDMARK_106_FILE}", required)
        self.assertFalse((PROJECT_ROOT / "backend/models/insightface-buffalo-s-test-only.sha256").exists())
        script = (PROJECT_ROOT / "scripts/verify_face_models.sh").read_text(encoding="utf-8")
        self.assertIn("insightface-buffalo-s.sha256", script)


def face_service_attr(name):
    return getattr(ins.face_service, name)
