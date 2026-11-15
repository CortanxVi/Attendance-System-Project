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

from services import attempt_diagnostics as ad
from services import failure_diagnostics as fd
from services import liveness_frame_service as lfs
from services import liveness_service as ls
from services import test_mode_service as tms
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
            patch.object(fd, "ATTENDANCE_TEST_MODE", enabled),
            patch.object(ad, "ATTENDANCE_TEST_MODE", enabled),
        ]

    def __enter__(self):
        for item in self.patches:
            item.start()
        return self

    def __exit__(self, *exc):
        for item in self.patches:
            item.stop()
        ad.end()


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

    def test_a_valid_submission_still_passes_and_records_its_timing(self):
        with test_mode(True):
            collector = ad.begin()
            verified = ls.verify_liveness_submission(
                self.challenge.token, json.dumps(self.evidence()), "challenge-1", "student-1", now=self.now
            )
            timing = collector.snapshot()["timing"]
        self.assertEqual(verified.action, self.challenge.action)
        self.assertEqual(timing["intervals_ms"], [500, 500])
        self.assertEqual(timing["recovery_after_action_ms"], 300)
        self.assertEqual(timing["fps"], 20)
        self.assertEqual(timing["prompt_delay_ms"], self.challenge.prompt_delay_ms)
        self.assertIn("duration_ms", timing)

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
        self.assertEqual(tms.classify_failure(detail), "timing_interval")
        plain = self.submit(evidence, enabled=False)
        self.assertNotIn("รหัส", plain)
        self.assertTrue(plain.startswith("ช่วงเวลาหลักฐานภาพไม่เป็นธรรมชาติ"))
        self.assertEqual(tms.classify_failure(plain), "timing_interval")

    def test_a_too_short_interval_is_reported_too(self):
        detail = self.submit(self.set_frame_time(self.evidence(), 1, 1_600))  # 100 ms then 900 ms
        self.assertIn("ช่วงที่ 1 (เฟรม 1→2) 100 มิลลิวินาที", detail)

    def test_a_slow_return_after_the_action_reports_the_span(self):
        evidence = self.evidence()
        action_at = evidence["frames"][3]["timestampMs"]
        evidence["frames"][4]["timestampMs"] = action_at + 3_400
        evidence["completedAtMs"] = action_at + 3_500
        detail = self.submit(evidence)
        self.assertIn("[รหัส timing_action_span", detail)
        self.assertIn("3400 มิลลิวินาที (เกณฑ์ ≤3000)", detail)
        self.assertIn("ภายใน 3 วินาที", detail)
        self.assertEqual(tms.classify_failure(detail), "timing_action_span")
        plain = self.submit(evidence, enabled=False)
        self.assertTrue(plain.startswith("เวลาคำสั่งสุ่มไม่ต่อเนื่อง"))
        self.assertEqual(tms.classify_failure(plain), "timing")

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
        self.assertEqual(tms.classify_failure(detail), "token_binding")

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
            self.assertNotEqual(tms.classify_failure(sentence), "other", sentence)


# ---------------------------------------------------------------- Phase 2: collector


class CollectorTests(unittest.TestCase):
    def tearDown(self):
        ad.end()

    def test_off_outside_test_mode(self):
        with test_mode(False):
            self.assertIsNone(ad.begin())
            ad.record("pad", {"live": [0.9]})
            self.assertIsNone(ad.current())

    def test_records_merge_and_lists_are_bounded(self):
        with test_mode(True):
            collector = ad.begin()
            ad.record("timing", {"fps": 20})
            ad.record("timing", {"duration_ms": 4000})
            for value in range(20):
                ad.append("frame_similarity", value / 100)
            snap = collector.snapshot()
        self.assertEqual(snap["v"], 1)
        self.assertEqual(snap["timing"], {"fps": 20, "duration_ms": 4000})
        self.assertEqual(len(snap["frame_similarity"]), ad.MAX_LIST_ITEMS)

    def test_sanitiser_keeps_numbers_only_and_drops_personal_text(self):
        collector = ad.AttemptDiagnostics()
        collector.record("pad", {
            "live": [np.float32(0.81), np.float64(0.7), 0.66],
            "name": "Somchai Jaidee",
            "email": "someone@example.com",
            "student": "6601234567890x",
            "embedding": np.ones(512, dtype=np.float32),
            "ok": True,
            "nan": float("nan"),
        })
        collector.record("Bad Key", 1)
        snap = collector.snapshot()
        self.assertEqual(snap["pad"]["live"], [0.81, 0.7, 0.66])
        self.assertTrue(snap["pad"]["ok"])
        for forbidden in ("name", "email", "embedding", "nan"):
            self.assertNotIn(forbidden, snap["pad"])
        self.assertNotIn("Bad Key", snap)
        text = json.dumps(snap)
        self.assertNotIn("@", text)
        self.assertNotIn("Somchai", text)

    def test_identifier_strings_are_kept_but_free_text_is_not(self):
        self.assertEqual(ad.sanitise("move_closer", 1), "move_closer")
        self.assertIsNone(ad.sanitise("ปิดตา", 1))
        self.assertIsNone(ad.sanitise("a" * 40, 1))
        self.assertIsNone(ad.sanitise(10**13, 1))

    def test_size_is_bounded_by_dropping_low_priority_sections(self):
        collector = ad.AttemptDiagnostics()
        collector.record("pad", {"live": [0.9, 0.8, 0.7]})
        for index in range(8):
            collector.append("pose", {f"k{i}": 0.123456 for i in range(24)} | {"frame": f"f{index}"})
        collector.record("frame_diff", {f"k{i}": [1.2345] * 8 for i in range(24)})
        snap = collector.snapshot()
        self.assertLessEqual(ad.json_size(snap), ad.MAX_JSON_BYTES)
        self.assertTrue(snap["truncated"])
        self.assertIn("pad", snap)  # the most valuable section survives
        self.assertNotIn("frame_diff", snap)

    def test_the_collector_reaches_the_worker_thread_and_requests_stay_apart(self):
        from starlette.concurrency import run_in_threadpool

        async def one_request(value):
            collector = ad.begin()
            await run_in_threadpool(ad.record, "move_closer", {"scale_ratio": value})
            await asyncio.sleep(0)
            return collector.snapshot()

        async def both():
            return await asyncio.gather(
                asyncio.create_task(one_request(1.1)), asyncio.create_task(one_request(1.3))
            )

        with test_mode(True):
            first, second = asyncio.run(both())
        self.assertEqual(first["move_closer"]["scale_ratio"], 1.1)
        self.assertEqual(second["move_closer"]["scale_ratio"], 1.3)


class FrameVerifierCaptureTests(unittest.TestCase):
    frames = [np.full((120, 160, 3), value, dtype=np.uint8) for value in (10, 60, 120, 180, 240)]

    def run_verifier(self, sequence, action, logits=((3.0, 0.0),) * 3):
        session = MagicMock()
        session.run.return_value = [np.asarray(logits, dtype=np.float32)]
        with patch.object(lfs.face_service, "extract_strict_face_observation", side_effect=sequence), \
             patch.object(lfs.face_service, "calculate_similarity", return_value=0.9), \
             patch.object(passive_pad_service, "_session", session), test_mode(True):
            collector = ad.begin()
            error = None
            try:
                lfs.verify_hybrid_liveness_frames(self.frames[:3], self.frames[3], self.frames[4], action)
            except HTTPException as exc:
                error = exc
            return collector.snapshot(), error

    def test_a_successful_move_closer_records_pad_pose_scale_and_similarity(self):
        snap, error = self.run_verifier([obs(), obs(yaw=0.02), obs(), obs(scale=0.46), obs()], "move_closer")
        self.assertIsNone(error)
        self.assertEqual(len(snap["pad"]["live"]), 3)
        self.assertAlmostEqual(snap["pad"]["min"], 0.9526, places=3)
        self.assertEqual(snap["pad"]["threshold"], 0.60)  # active (median) rule
        self.assertEqual(snap["pad"]["all_frames_threshold"], 0.65)
        self.assertEqual([p["frame"] for p in snap["pose"]], ["f2", "f3", "action", "recovery"])
        self.assertEqual(snap["pose"][0]["yaw"], 0.02)
        self.assertAlmostEqual(snap["move_closer"]["scale_ratio"], 1.15, places=3)
        self.assertEqual(len(snap["frame_similarity"]), 4)
        self.assertEqual(len(snap["frame_diff"]["passive"]), 2)
        self.assertEqual(snap["reference"]["width"], 0.4)

    def test_a_failed_pad_still_records_every_frame_score(self):
        snap, error = self.run_verifier(
            [obs(), obs(), obs(), obs(scale=0.46), obs()], "move_closer",
            logits=((2.0, 0.0), (-2.6, 0.0), (0.5, 0.0)),
        )
        self.assertEqual(fd.failure_code(error.detail), "pad")
        self.assertEqual(snap["pad"]["live"], [0.8808, 0.0691, 0.6225])
        self.assertNotIn("move_closer", snap)  # not reached

    def test_a_failed_blink_records_ratios_and_baselines(self):
        closed_too_little = obs(left=0.27, right=0.27)
        snap, error = self.run_verifier([obs(), obs(), obs(), closed_too_little, obs()], "blink")
        self.assertEqual(fd.failure_code(error.detail), "blink")
        blink = snap["blink"]
        self.assertEqual((blink["open_left"], blink["open_right"]), (0.3, 0.3))
        self.assertEqual(blink["closed_left"], 0.9)
        self.assertEqual(blink["limit_left"], 0.78)
        self.assertEqual(blink["back_right"], 1.0)

    def test_a_nodding_blink_now_reports_its_pose(self):
        nod = obs(left=0.05, right=0.05, pitch=0.25)
        _snap, error = self.run_verifier([obs(), obs(), obs(), nod, obs()], "blink")
        self.assertEqual(fd.failure_code(error.detail), "blink_pose")
        self.assertIn("+0.25 (เกณฑ์ ±0.20)", error.detail)
        self.assertEqual(tms.classify_failure(error.detail), "blink_pose")

    def test_nothing_is_collected_outside_test_mode(self):
        session = MagicMock()
        session.run.return_value = [np.asarray(((3.0, 0.0),) * 3, dtype=np.float32)]
        with patch.object(lfs.face_service, "extract_strict_face_observation",
                          side_effect=[obs(), obs(), obs(), obs(scale=0.46), obs()]), \
             patch.object(lfs.face_service, "calculate_similarity", return_value=0.9), \
             patch.object(passive_pad_service, "_session", session), test_mode(False):
            self.assertIsNone(ad.begin())
            lfs.verify_hybrid_liveness_frames(self.frames[:3], self.frames[3], self.frames[4], "move_closer")
            self.assertIsNone(ad.current())


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


class AttemptWriterTests(unittest.TestCase):
    def setUp(self):
        tms._diagnostics_column_missing = False
        tms._diagnostics_column_missing_at = 0.0

    def tearDown(self):
        tms._diagnostics_column_missing = False
        tms._diagnostics_column_missing_at = 0.0

    def write(self, db, diagnostics):
        return tms.record_face_attempt(
            student_id="s1", course_id="c1", session_id="x1", outcome="success",
            attendance_status="present", similarity_score=0.7, threshold_used=0.45,
            liveness_action="blink", diagnostics=diagnostics, db=db,
        )

    def test_diagnostics_are_written_sanitised(self):
        db = _Db([])
        self.assertTrue(self.write(db, {"v": 1, "pad": {"live": [0.9, 0.8, 0.7]}, "note": "free text"}))
        self.assertEqual(db.rows[0]["diagnostics"], {"v": 1, "pad": {"live": [0.9, 0.8, 0.7]}})

    def test_a_missing_column_is_retried_once_without_the_field_and_remembered(self):
        db = _Db([_MissingColumnError()])
        self.assertTrue(self.write(db, {"v": 1, "pad": {"live": [0.9, 0.8, 0.7]}}))
        self.assertEqual(len(db.rows), 2)
        self.assertIn("diagnostics", db.rows[0])
        self.assertNotIn("diagnostics", db.rows[1])
        self.assertTrue(tms._diagnostics_column_missing)
        self.assertTrue(self.write(db, {"v": 1, "pad": {"live": [0.9, 0.8, 0.7]}}))
        self.assertEqual(len(db.rows), 3)
        self.assertNotIn("diagnostics", db.rows[2])

    def test_other_errors_are_not_retried(self):
        db = _Db([RuntimeError("network down")])
        self.assertFalse(self.write(db, {"v": 1, "pad": {"live": [0.9]}}))
        self.assertEqual(len(db.rows), 1)
        self.assertFalse(tms._diagnostics_column_missing)

    def test_a_missing_column_is_probed_again_after_the_reprobe_interval(self):
        db = _Db([_MissingColumnError()])
        self.write(db, {"v": 1, "pad": {"live": [0.9, 0.8, 0.7]}})
        self.assertTrue(tms._diagnostics_column_missing)
        tms._diagnostics_column_missing_at -= tms.DIAGNOSTICS_REPROBE_SECONDS + 1
        self.assertTrue(self.write(db, {"v": 1, "pad": {"live": [0.9, 0.8, 0.7]}}))
        self.assertIn("diagnostics", db.rows[-1])  # the migration was applied meanwhile
        self.assertFalse(tms._diagnostics_column_missing)

    def test_a_check_violation_on_diagnostics_keeps_the_attempt_row(self):
        violation = RuntimeError(
            'new row for relation "face_checkin_attempts" violates check constraint '
            '"face_checkin_attempts_diagnostics_shape"'
        )
        violation.code = "23514"
        db = _Db([violation])
        self.assertTrue(self.write(db, {"v": 1, "pad": {"live": [0.9, 0.8, 0.7]}}))
        self.assertEqual(len(db.rows), 2)
        self.assertNotIn("diagnostics", db.rows[1])
        self.assertFalse(tms._diagnostics_column_missing)  # one bad object, the column exists
        self.assertTrue(self.write(db, {"v": 1, "pad": {"live": [0.9]}}))
        self.assertIn("diagnostics", db.rows[-1])

    def test_other_check_violations_are_not_retried(self):
        violation = RuntimeError('violates check constraint "face_checkin_attempts_outcome_check"')
        violation.code = "23514"
        db = _Db([violation])
        self.assertFalse(self.write(db, {"v": 1, "pad": {"live": [0.9]}}))
        self.assertEqual(len(db.rows), 1)

    def test_a_failing_retry_is_still_only_a_warning(self):
        db = _Db([_MissingColumnError(), RuntimeError("still down")])
        self.assertFalse(self.write(db, {"v": 1, "pad": {"live": [0.9]}}))

    def test_too_large_or_empty_diagnostics_are_left_out(self):
        db = _Db([])
        self.write(db, {f"k{i}": {f"n{j}": [123456.789] * 8 for j in range(8)} for i in range(24)})
        self.write(db, None)
        self.write(db, {"only": "free text"})
        for row in db.rows:
            self.assertNotIn("diagnostics", row)

    def test_the_missing_column_detector(self):
        self.assertTrue(tms._is_missing_diagnostics_column(_MissingColumnError()))
        error = Exception('column "diagnostics" of relation "face_checkin_attempts" does not exist')
        self.assertTrue(tms._is_missing_diagnostics_column(error))
        other = Exception("x")
        other.code = "PGRST204"
        other.message = "Could not find the 'app_version' column"
        self.assertFalse(tms._is_missing_diagnostics_column(other))
        self.assertFalse(tms._is_missing_diagnostics_column(RuntimeError("timeout")))


class MigrationAndWiringTests(unittest.TestCase):
    def test_the_migration_is_test_only_nullable_and_bounded(self):
        path = PROJECT_ROOT / "supabase/test-only/20261115090000_face_attempt_diagnostics.sql"
        sql = path.read_text(encoding="utf-8").lower()
        self.assertIn("add column if not exists diagnostics jsonb;", sql)
        self.assertNotIn("not null", sql.split("add column", 1)[1].split(";", 1)[0])
        self.assertIn("pg_column_size(diagnostics) <= 4000", sql)
        self.assertIn("jsonb_typeof(diagnostics) = 'object'", sql)
        code = [line for line in sql.splitlines() if not line.strip().startswith("--")]
        self.assertFalse([line for line in code if "grant" in line or "policy" in line or "disable" in line])
        migrations = list((PROJECT_ROOT / "supabase/migrations").glob("*diagnostics*"))
        self.assertEqual(migrations, [])
        self.assertLessEqual(ad.MAX_JSON_BYTES, 4000)

    def test_the_endpoint_collects_and_passes_diagnostics_on_both_paths(self):
        main = (PROJECT_ROOT / "backend/main.py").read_text(encoding="utf-8")
        verify = main.split('@app.post("/api/v1/attendance/verify")', 1)[1].split("@app.post", 1)[0]
        self.assertIn("diagnostics_collector = attempt_diagnostics.begin()", verify)
        self.assertEqual(verify.count("_attempt_diagnostics_snapshot(diagnostics_collector, attempt)"), 2)
        self.assertIn("attempt_diagnostics.end()", verify.split("finally:", 1)[1])
        self.assertIn("diagnostics=diagnostics,", main.split("def _log_test_attempt_failure", 1)[1])


# ---------------------------------------------------------------- offline PAD ROC evaluator


def load_evaluator():
    path = PROJECT_ROOT / "scripts/evaluate_pad_roc.py"
    spec = importlib.util.spec_from_file_location("evaluate_pad_roc", path)
    module = importlib.util.module_from_spec(spec)
    import sys

    sys.modules[spec.name] = module  # dataclasses look the module up by name
    spec.loader.exec_module(module)
    return module


class PadRocEvaluatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ev = load_evaluator()

    def samples(self, genuine, attack):
        S = self.ev.Sample
        return [S("genuine", tuple(g)) for g in genuine] + [S("attack_print", tuple(a)) for a in attack]

    def test_rates_at_the_current_threshold_for_each_rule(self):
        genuine = [(0.9, 0.9, 0.9)] * 8 + [(0.07, 0.68, 0.63), (0.9, 0.9, 0.5)]
        attack = [(0.1, 0.2, 0.1)] * 9 + [(0.7, 0.8, 0.9)]
        result = self.ev.evaluate(self.samples(genuine, attack))
        rules = result["rules"]
        self.assertEqual(rules["min"]["at_current"]["frr"], 0.2)    # both odd genuine rows refused
        self.assertEqual(rules["min"]["at_current"]["far"], 0.1)
        # median: (0.07,0.68,0.63) median 0.63 -> refused; (0.9,0.9,0.5) median 0.9, min 0.5 -> live
        self.assertEqual(rules["median"]["at_current"]["frr"], 0.1)
        # mean logit of (0.9, 0.9, 0.5) = 2*2.197/3 = 1.46 -> 0.81 live; (0.07,0.68,0.63) -> refused
        self.assertEqual(rules["meanlogit"]["at_current"]["frr"], 0.1)
        self.assertFalse(result["enough_data"])

    def test_the_median_floor_rejects_one_very_low_frame(self):
        floor_case = [(0.10, 0.95, 0.95)]
        result = self.ev.evaluate(self.samples(floor_case, [(0.1, 0.1, 0.1)]), floor=0.30)
        self.assertEqual(result["rules"]["median"]["at_current"]["frr"], 1.0)
        relaxed = self.ev.evaluate(self.samples(floor_case, [(0.1, 0.1, 0.1)]), floor=0.05)
        self.assertEqual(relaxed["rules"]["median"]["at_current"]["frr"], 0.0)

    def test_roc_is_monotone_and_best_threshold_meets_the_far_target(self):
        rng = np.random.default_rng(7)
        genuine = np.clip(rng.normal(0.85, 0.08, size=(250, 3)), 0, 1)
        attack = np.clip(rng.normal(0.30, 0.15, size=(120, 3)), 0, 1)
        result = self.ev.evaluate(self.samples(genuine.tolist(), attack.tolist()))
        self.assertTrue(result["enough_data"])
        for rule in result["rules"].values():
            frr = [p["frr"] for p in rule["roc"]]
            far = [p["far"] for p in rule["roc"]]
            self.assertEqual(frr, sorted(frr))
            self.assertEqual(far, sorted(far, reverse=True))
            best = rule["best_under_far_target"]
            self.assertIsNotNone(best)
            self.assertLessEqual(best["far"], 0.01)
            allowed = [p for p in rule["roc"] if p["far"] <= 0.01]
            self.assertEqual(best["frr"], min(p["frr"] for p in allowed))

    def test_labels_windows_and_rows_without_pad_scores(self):
        rows = [
            {"created_at": "2026-11-20T10:00:05Z", "outcome": "failed", "diagnostics": {"pad": {"live": [0.1, 0.2, 0.1]}}},
            {"created_at": "2026-11-20T10:30:00+00:00", "outcome": "success", "diagnostics": json.dumps({"pad": {"live": [0.9, 0.9, 0.9]}})},
            {"created_at": "2026-11-20T10:00:06Z", "outcome": "failed", "diagnostics": {"timing": {"fps": 20}}},
            {"created_at": "2026-11-20T10:00:07Z", "outcome": "failed", "diagnostics": None},
        ]
        with tempfile.TemporaryDirectory() as folder:
            labels = Path(folder) / "labels.csv"
            labels.write_text("start_iso,end_iso,label\n2026-11-20T10:00:00Z,2026-11-20T10:10:00Z,attack_screen\n",
                              encoding="utf-8")
            samples, skipped = self.ev.build_samples(rows, self.ev.load_labels(labels))
        self.assertEqual(skipped, 2)
        self.assertEqual([s.label for s in samples], ["attack_screen", "genuine"])

    def test_bad_labels_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            labels = Path(folder) / "labels.csv"
            labels.write_text("start_iso,end_iso,label\n2026-11-20T10:00:00Z,2026-11-20T10:10:00Z,mask\n",
                              encoding="utf-8")
            with self.assertRaises(ValueError):
                self.ev.load_labels(labels)

    def test_the_command_refuses_to_recommend_on_small_data_and_prints_no_ids(self):
        rows = [
            {"id": "row-uuid-1", "student_id": "student-uuid-1", "created_at": "2026-11-20T09:00:00Z",
             "outcome": "success", "diagnostics": {"pad": {"live": [0.9, 0.8, 0.7]}}},
            {"id": "row-uuid-2", "student_id": "student-uuid-2", "created_at": "2026-11-20T10:01:00Z",
             "outcome": "failed", "diagnostics": {"pad": {"live": [0.2, 0.1, 0.3]}}},
        ]
        with tempfile.TemporaryDirectory() as folder:
            attempts = Path(folder) / "attempts.json"
            attempts.write_text(json.dumps(rows), encoding="utf-8")
            labels = Path(folder) / "labels.csv"
            labels.write_text("start_iso,end_iso,label\n2026-11-20T10:00:00Z,2026-11-20T10:10:00Z,attack_print\n",
                              encoding="utf-8")
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(self.ev.main([str(attempts), str(labels)]), 0)
        text = out.getvalue()
        self.assertIn("NO RECOMMENDATION", text)
        self.assertIn("genuine attempts: 1", text)
        self.assertIn("attack attempts: 1", text)
        self.assertIn("[min]", text)
        self.assertIn("[median]", text)
        self.assertIn("[meanlogit]", text)
        for secret in ("row-uuid", "student-uuid", "2026-11-20"):
            self.assertNotIn(secret, text)


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
        ad.end()

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
                    ad.begin()
                    self.assertIsNone(ins.face_service._eye_apertures_106(np.zeros((10, 10, 3), np.uint8), object()))
        loader.assert_not_called()
        source = (PROJECT_ROOT / "backend/services/insightface_service.py").read_text(encoding="utf-8")
        modules = source.split("allowed_modules=", 1)[1].split("]", 1)[0]
        self.assertNotIn("landmark_2d_106", modules)

    def test_test_mode_with_a_collector_measures_both_eyes(self):
        model = MagicMock()
        model.get.return_value = landmarks_106(3.0, 1.0)
        with patch.object(ins.face_service, "_landmark_106_model", return_value=model), \
             test_mode(True):
            ad.begin()
            left, right = ins.face_service._eye_apertures_106(np.zeros((10, 10, 3), np.uint8), object())
        self.assertAlmostEqual(left, 0.3, places=5)
        self.assertAlmostEqual(right, 0.1, places=5)

    def test_a_model_error_never_fails_the_scan(self):
        model = MagicMock()
        model.get.side_effect = RuntimeError("onnx failure")
        with patch.object(ins.face_service, "_landmark_106_model", return_value=model), \
             test_mode(True), \
             self.assertLogs(ins.logger, level="WARNING"):
            ad.begin()
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


class Blink106CaptureTests(unittest.TestCase):
    frames = FrameVerifierCaptureTests.frames
    run_verifier = FrameVerifierCaptureTests.run_verifier

    def test_a_failed_blink_records_and_tags_the_106_point_ratios(self):
        passive = [obs106(0.30, 0.32), obs106(0.28, 0.30), obs106(0.30, 0.31)]
        # 68-pt barely moved (0.97, above the 0.94 photo ceiling), 106-pt closed
        action = obs106(0.06, 0.08, left=0.29, right=0.29)
        recovery = obs106(0.30, 0.30)
        snap, error = self.run_verifier([*passive, action, recovery], "blink")
        self.assertEqual(fd.failure_code(error.detail), "blink")
        self.assertEqual(tms.classify_failure(error.detail), "blink")
        blink = snap["blink"]
        self.assertEqual(blink["open_left_106"], 0.3)
        self.assertEqual(blink["open_right_106"], 0.31)
        self.assertEqual(blink["closed_left_106"], 0.2)
        self.assertAlmostEqual(blink["closed_right_106"], 0.2581, places=3)
        self.assertEqual(blink["back_left_106"], 1.0)
        self.assertAlmostEqual(blink["closed_left"], 0.9667, places=3)  # the 68-point numbers are still there
        self.assertIn("กฎ106 ไม่ผ่าน:ceiling_68", error.detail)
        self.assertIn("106จุด ปิดตา 0.20/0.26 กลับมาเปิด 1.00/0.97 ฐาน 0.30/0.31]", error.detail)
        self.assertLessEqual(len(error.detail), fd.MAX_REASON_CHARS)
        self.assertNotIn("truncated", snap)

    def test_a_68_point_pass_does_not_need_the_106_point_values(self):
        # 106-pt says "open", 68-pt says "closed": the blink passes on the 68-pt rule alone (the
        # 106-pt rule can only ADD a pass, and only for a listed test course).
        passive = [obs106(0.30, 0.30)] * 3
        snap, error = self.run_verifier(
            [*passive, obs106(0.30, 0.30, left=0.05, right=0.05), obs106(0.30, 0.30)], "blink"
        )
        self.assertIsNone(error)
        self.assertEqual(snap["blink"]["closed_left_106"], 1.0)

    def test_one_frame_without_106_values_skips_them(self):
        snap, error = self.run_verifier(
            [obs106(0.3, 0.3), obs(), obs106(0.3, 0.3), obs106(0.05, 0.05, left=0.27, right=0.27), obs106(0.3, 0.3)],
            "blink",
        )
        self.assertNotIn("closed_left_106", snap["blink"])
        self.assertNotIn("106จุด", error.detail)


if __name__ == "__main__":
    unittest.main()
