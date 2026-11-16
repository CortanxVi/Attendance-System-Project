"""Round three (2026-11-15): data-derived 106-rule photo ceiling + base guard, server-side
blink -> move_closer fallback, and the web build numbers in client diagnostics.

Blink numbers are pseudonymised real readings (numbers only) or scenario inputs.
"""

import inspect
import json
import os
import random
import threading
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import numpy as np
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from services import action_fallback as af
from services import failure_diagnostics as fd
from services import liveness_frame_service as lfs
from services import liveness_service as ls
from services.insightface_service import FaceObservation
from services.passive_pad_service import passive_pad_service


def obs(left=0.30, right=None, left106=None, right106=None, pitch=0.0) -> FaceObservation:
    return FaceObservation(
        embedding=np.asarray([1.0, 0.0], dtype=np.float32), yaw_proxy=0.0, pitch_proxy=pitch, roll_proxy=0.0,
        detection_score=0.99, left_eye_aperture_proxy=left,
        right_eye_aperture_proxy=left if right is None else right,
        face_width_ratio=0.40, center_offset=0.02, bbox=(40.0, 20.0, 140.0, 120.0),
        left_eye_aperture_106=left106, right_eye_aperture_106=right106,
    )


def v106(closed_l, closed_r, back_l=1.0, back_r=1.0, base_l=0.26, base_r=0.26):
    return {"open_left_106": base_l, "open_right_106": base_r,
            "closed_left_106": closed_l, "closed_right_106": closed_r,
            "back_left_106": back_l, "back_right_106": back_r}


class rule_on:
    def __init__(self, test_mode=False):
        self.patches = [patch.object(lfs, "LIVENESS_BLINK_106_ENABLED", True),
                        patch.object(fd, "SHOW_MEASUREMENTS", test_mode)]

    def __enter__(self):
        for item in self.patches:
            item.start()
        return None

    def __exit__(self, *exc):
        for item in self.patches:
            item.stop()


class CeilingAndBaseTests(unittest.TestCase):
    def test_the_narrow_eyed_android_case_now_passes(self):
        # 68-pt closed 0.909/0.866 (above the old 0.90 ceiling), 106-pt 0.209/0.223, base 0.167/0.159.
        open_l = open_r = 0.25
        action = obs(open_l * 0.909, open_r * 0.866)
        recovery = obs(open_l, open_r)
        values = v106(0.209, 0.223, base_l=0.167, base_r=0.159)
        with rule_on(True) as collector:
            self.assertIsNone(lfs.blink_aperture_problem(open_l, open_r, action, recovery, values))
        with rule_on(False):
            self.assertIsNone(lfs.blink_aperture_problem(open_l, open_r, action, recovery, values))

    def test_static_photo_with_jitter_and_fooled_106_never_passes(self):
        rng = random.Random(5)
        with rule_on(False):
            for _ in range(2000):
                open_l, open_r = rng.uniform(0.10, 0.42), rng.uniform(0.10, 0.42)
                j = [1 + rng.uniform(-0.04, 0.04) for _ in range(4)]
                action, recovery = obs(open_l * j[0], open_r * j[1]), obs(open_l * j[2], open_r * j[3])
                for values in (v106(0.05, 0.05), v106(rng.uniform(0.59, 1), rng.uniform(0.59, 1))):
                    self.assertIsNotNone(lfs.blink_aperture_problem(open_l, open_r, action, recovery, values))

    def test_ceiling_boundary(self):
        with rule_on(False):
            self.assertIsNone(lfs.blink_106_rule_problem(0.94, 0.94, True, v106(0.3, 0.3)))
            self.assertEqual(lfs.blink_106_rule_problem(0.9401, 0.5, True, v106(0.3, 0.3)), "ceiling_68")

    def test_a_tiny_106_base_is_refused(self):
        with rule_on(True) as collector:
            problem = lfs.blink_aperture_problem(
                0.30, 0.30, obs(0.30 * 0.85), obs(0.30), v106(0.15, 0.38, 2.08, 2.21, base_l=0.055, base_r=0.050)
            )
            self.assertIsNotNone(problem)
            self.assertIn("กฎ106 ไม่ผ่าน:base_106", problem)
        with rule_on(False):
            for base_l, base_r in ((0.05, 0.26), (0.26, 0.0999), (float("nan"), 0.26), (None, 0.26)):
                with self.subTest(base=(base_l, base_r)):
                    self.assertEqual(
                        lfs.blink_106_rule_problem(0.85, 0.85, True, v106(0.3, 0.3, base_l=base_l, base_r=base_r)),
                        "base_106",
                    )
            self.assertIsNone(lfs.blink_106_rule_problem(0.85, 0.85, True, v106(0.3, 0.3, base_l=0.10, base_r=0.10)))


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class ActionFallbackStoreTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.store = af.ActionFallbackStore(clock=self.clock)

    def test_two_consecutive_blink_failures_force_move_closer(self):
        self.assertIsNone(self.store.forced_action("u1"))
        self.store.record_blink_failure("u1")
        self.assertIsNone(self.store.forced_action("u1"))
        self.store.record_blink_failure("u1")
        self.assertEqual(self.store.forced_action("u1"), "move_closer")
        self.clock.now += af.FALLBACK_SECONDS - 1
        self.assertEqual(self.store.forced_action("u1"), "move_closer")

    def test_success_resets(self):
        self.store.record_blink_failure("u1")
        self.store.record_blink_failure("u1")
        self.store.record_success("u1")
        self.assertIsNone(self.store.forced_action("u1"))
        self.store.record_blink_failure("u1")  # streak starts again from zero
        self.assertIsNone(self.store.forced_action("u1"))

    def test_ttl_expiry_resets(self):
        self.store.record_blink_failure("u1")
        self.store.record_blink_failure("u1")
        self.clock.now += af.FALLBACK_SECONDS
        self.assertIsNone(self.store.forced_action("u1"))
        self.assertEqual(len(self.store), 0)
        # an old single failure does not combine with a new one
        self.store.record_blink_failure("u2")
        self.clock.now += af.FALLBACK_SECONDS + 1
        self.store.record_blink_failure("u2")
        self.assertIsNone(self.store.forced_action("u2"))

    def test_students_are_independent(self):
        self.store.record_blink_failure("u1")
        self.store.record_blink_failure("u1")
        self.store.record_blink_failure("u2")
        self.assertEqual(self.store.forced_action("u1"), "move_closer")
        self.assertIsNone(self.store.forced_action("u2"))
        self.assertIsNone(self.store.forced_action("u3"))
        self.store.record_success("u2")
        self.assertEqual(self.store.forced_action("u1"), "move_closer")

    def test_empty_ids_are_ignored(self):
        for key in ("", None):
            self.store.record_blink_failure(key)
            self.store.record_blink_failure(key)
            self.assertIsNone(self.store.forced_action(key))
        self.assertEqual(len(self.store), 0)

    def test_size_cap_is_lru(self):
        store = af.ActionFallbackStore(clock=self.clock, max_entries=3)
        for key in ("a", "b", "c"):
            store.record_blink_failure(key)
            store.record_blink_failure(key)
        store.forced_action("a")  # touch "a"
        store.record_blink_failure("d")
        self.assertEqual(len(store), 3)
        self.assertIsNone(store.forced_action("b"))  # oldest evicted
        self.assertEqual(store.forced_action("a"), "move_closer")

    def test_thread_safety(self):
        store = af.ActionFallbackStore(max_entries=500)

        def work(offset):
            for i in range(2000):
                key = f"k{(i + offset) % 700}"
                store.record_blink_failure(key)
                store.forced_action(key)
                if i % 7 == 0:
                    store.record_success(key)

        threads = [threading.Thread(target=work, args=(n * 13,)) for n in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertLessEqual(len(store), 500)

    def test_defaults(self):
        self.assertEqual(af.BLINK_FAILURES_BEFORE_FALLBACK, 2)
        self.assertEqual(af.FALLBACK_SECONDS, 1800)
        self.assertEqual(af.MAX_ENTRIES, 10_000)


class ChallengeIssueTests(unittest.TestCase):
    def issue(self, store, user="user-1", purpose="attendance"):
        expires = datetime.now(timezone.utc) + timedelta(minutes=5)
        with patch.object(ls, "action_fallback", store):
            if purpose == "attendance":
                return ls.create_attendance_liveness_challenge("challenge-1", user, "session-1", expires)
            return ls.create_liveness_challenge("challenge-1", user, expires)

    def test_forced_challenge_is_move_closer_with_the_same_signed_format(self):
        store = af.ActionFallbackStore()
        store.record_blink_failure("user-1")
        store.record_blink_failure("user-1")
        for purpose in ("attendance", "enrollment"):
            with self.subTest(purpose=purpose):
                actions = {self.issue(store, purpose=purpose).action for _ in range(40)}
                self.assertEqual(actions, {"move_closer"})
                forced = self.issue(store, purpose=purpose)
                normal = self.issue(af.ActionFallbackStore(), user="user-2", purpose=purpose)
                forced_payload = ls._decode_and_verify_token(forced.token)  # signature verifies
                normal_payload = ls._decode_and_verify_token(normal.token)
                self.assertEqual(set(forced_payload), set(normal_payload))
                self.assertEqual(forced_payload["action"], "move_closer")
                self.assertEqual(forced_payload["student_id"], "user-1")

    def test_other_students_still_get_the_random_choice(self):
        store = af.ActionFallbackStore()
        store.record_blink_failure("user-1")
        store.record_blink_failure("user-1")
        actions = {self.issue(store, user="user-2").action for _ in range(80)}
        self.assertEqual(actions, {"blink", "move_closer"})

class BlinkFailureTypeTests(unittest.TestCase):
    frames = [np.full((200, 200, 3), value, dtype=np.uint8) for value in (10, 60, 120, 180, 240)]

    def run_verifier(self, sequence, action="blink", logits=((3.0, 0.0),) * 3, similarity=0.9):
        session = MagicMock()
        session.run.return_value = [np.asarray(logits, dtype=np.float32)]
        with patch.object(lfs.face_service, "extract_strict_face_observation", side_effect=sequence), \
             patch.object(lfs.face_service, "calculate_similarity", return_value=similarity), \
             patch.object(passive_pad_service, "_session", session):
            try:
                lfs.verify_hybrid_liveness_frames(self.frames[:3], self.frames[3], self.frames[4], action)
            except HTTPException as exc:
                return exc
        return None

    def test_blink_aperture_and_blink_pose_failures_are_typed(self):
        error = self.run_verifier([obs(), obs(), obs(), obs(0.29), obs()])  # eyes did not close
        self.assertIsInstance(error, lfs.BlinkActionFailure)
        self.assertEqual(error.status_code, 422)
        error = self.run_verifier([obs(), obs(), obs(), obs(0.05, pitch=0.30), obs()])  # nodded
        self.assertIsInstance(error, lfs.BlinkActionFailure)

    def test_other_failures_are_not_counted(self):
        pad = self.run_verifier([obs(), obs(), obs(), obs(0.05), obs()], logits=((-3.0, 0.0),) * 3)
        self.assertIsInstance(pad, HTTPException)
        self.assertNotIsInstance(pad, lfs.BlinkActionFailure)
        identity = self.run_verifier([obs(), obs(), obs(), obs(0.05), obs()], similarity=0.1)
        self.assertNotIsInstance(identity, lfs.BlinkActionFailure)
        move = self.run_verifier([obs(), obs(), obs(), obs(), obs()], action="move_closer")
        self.assertNotIsInstance(move, lfs.BlinkActionFailure)
        self.assertIsNone(self.run_verifier([obs(), obs(), obs(), obs(0.05), obs()]))

class ReviewRoundThreeTests(unittest.TestCase):
    def test_a_passing_blink_check_resets_the_streak(self):
        clock = FakeClock()
        store = af.ActionFallbackStore(clock=clock)
        store.record_blink_failure("u1")
        store.record_blink_pass("u1")
        store.record_blink_failure("u1")
        self.assertIsNone(store.forced_action("u1"))
        store.record_blink_failure("u1")
        self.assertEqual(store.forced_action("u1"), "move_closer")
        store.record_blink_pass("u1")  # an active fallback stays until success or expiry
        self.assertEqual(store.forced_action("u1"), "move_closer")
        store.record_blink_pass("nobody")
        self.assertEqual(len(store), 1)

    def test_the_verifier_reports_a_passed_blink_check_even_if_a_later_check_fails(self):
        frames = [np.full((200, 200, 3), value, dtype=np.uint8) for value in (10, 60, 120, 180, 240)]
        session = MagicMock()
        session.run.return_value = [np.asarray(((3.0, 0.0),) * 3, dtype=np.float32)]
        far = FaceObservation(**{**obs().__dict__, "face_width_ratio": 0.60})  # recovery framing fails
        for sequence, expected_calls, expect_error in (
            ([obs(), obs(), obs(), obs(0.05), obs()], 1, False),
            ([obs(), obs(), obs(), obs(0.05), far], 1, True),
            ([obs(), obs(), obs(), obs(0.29), obs()], 0, True),
        ):
            calls = []
            with patch.object(lfs.face_service, "extract_strict_face_observation", side_effect=sequence), \
                 patch.object(lfs.face_service, "calculate_similarity", return_value=0.9), \
                 patch.object(passive_pad_service, "_session", session):
                try:
                    lfs.verify_hybrid_liveness_frames(
                        frames[:3], frames[3], frames[4], "blink", on_blink_passed=lambda: calls.append(1)
                    )
                    error = None
                except HTTPException as exc:
                    error = exc
            self.assertEqual(len(calls), expected_calls)
            self.assertEqual(error is not None, expect_error)

    def test_the_106_rule_decides_on_unrounded_values(self):
        passive = [obs(0.30, 0.30, 0.26, 0.26)] * 3
        action = obs(0.30 * 0.85, 0.30 * 0.85, 0.26 * 0.50004, 0.26 * 0.40)
        values = lfs._blink_106(passive, action, obs(0.30, 0.30, 0.26, 0.26))
        self.assertGreater(values["closed_left_106"], 0.50)  # 0.50004, would round to 0.5
        with rule_on(False):
            self.assertEqual(lfs.blink_106_rule_problem(0.85, 0.85, True, values), "closed_106")
        with rule_on(True) as collector:
            lfs._blink_106(passive, action, obs(0.30, 0.30, 0.26, 0.26))

    def test_framing_and_move_closer_checks_fail_closed_on_nan(self):
        nan = float("nan")
        ref = obs()
        self.assertIsNotNone(lfs._move_closer_problem(ref, obs(), nan))
        self.assertIsNotNone(lfs._move_closer_problem(ref, FaceObservation(**{**obs().__dict__, "yaw_proxy": nan}), 1.2))
        self.assertIsNotNone(lfs._move_closer_problem(ref, FaceObservation(**{**obs().__dict__, "center_offset": nan}), 1.2))
        self.assertIsNone(lfs._move_closer_problem(ref, obs(), 1.2))
        for field in ("yaw_proxy", "pitch_proxy", "roll_proxy", "face_width_ratio", "center_offset"):
            with self.subTest(field=field):
                bad = FaceObservation(**{**obs().__dict__, field: nan})
                self.assertIsNotNone(lfs._frontal_problem(ref, bad, scale_tolerance=0.2))
        self.assertIsNotNone(lfs._first_frame_problem(FaceObservation(**{**obs().__dict__, "face_width_ratio": nan})))
        self.assertIsNotNone(lfs._first_frame_problem(FaceObservation(**{**obs().__dict__, "center_offset": nan})))

    def test_pad_threshold_blank_means_default(self):
        from core import config

        with patch.dict(os.environ, {"LIVENESS_PAD_THRESHOLD": " "}):
            self.assertEqual(config._float_setting("LIVENESS_PAD_THRESHOLD", "0.65"), 0.65)
        source = inspect.getsource(config)
        self.assertIn('LIVENESS_PAD_THRESHOLD = _float_setting("LIVENESS_PAD_THRESHOLD", "0.65")', source)
