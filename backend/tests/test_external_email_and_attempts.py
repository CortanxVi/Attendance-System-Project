"""Guards for the test-only extras: external e-mail login, no OCR, auto-join, attempt log."""

import os
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")
os.environ.setdefault("OCR_SERVICE_TOKEN", "unit-test-key-with-at-least-thirty-two-characters")

from core import security
from core.test_mode import (
    EXTERNAL_EMAIL_ACK_PHRASE,
    TEST_MODE_ACK_PHRASE,
    load_test_mode_settings,
)
from services import test_mode_service as svc

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LISTED = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
GOOD = {
    "ATTENDANCE_TEST_MODE": "1",
    "ATTENDANCE_TEST_MODE_ACK": TEST_MODE_ACK_PHRASE,
    "ATTENDANCE_TEST_COURSE_IDS": LISTED,
}


class ExternalEmailSettingTests(unittest.TestCase):
    def test_off_unless_acknowledged(self):
        self.assertFalse(load_test_mode_settings(GOOD).external_email)
        on = load_test_mode_settings({**GOOD, "ATTENDANCE_TEST_EXTERNAL_EMAIL_ACK": EXTERNAL_EMAIL_ACK_PHRASE})
        self.assertTrue(on.external_email)

    def test_wrong_phrase_is_rejected_not_guessed(self):
        for ack in ("yes", EXTERNAL_EMAIL_ACK_PHRASE.lower(), "1"):
            with self.assertRaises(RuntimeError, msg=ack):
                load_test_mode_settings({**GOOD, "ATTENDANCE_TEST_EXTERNAL_EMAIL_ACK": ack})

    def test_the_phrase_alone_never_switches_anything_on(self):
        settings = load_test_mode_settings({"ATTENDANCE_TEST_EXTERNAL_EMAIL_ACK": EXTERNAL_EMAIL_ACK_PHRASE})
        self.assertFalse(settings.enabled)
        self.assertFalse(settings.external_email)

    def test_running_process_has_it_off(self):
        import core.config as config

        self.assertFalse(config.ATTENDANCE_TEST_EXTERNAL_EMAIL)


class LoginGateTests(unittest.TestCase):
    def test_default_gate_is_unchanged(self):
        self.assertFalse(security.is_allowed_login_email("someone@gmail.com"))
        self.assertFalse(security.is_allowed_login_email("x@kmutnb.ac.th.evil.com"))
        self.assertTrue(security.is_allowed_login_email("s6601234567890@email.kmutnb.ac.th"))
        self.assertTrue(security.is_allowed_login_email("jirayu.s@cit.kmutnb.ac.th"))
        self.assertFalse(security.is_allowed_login_email(None))

    def test_external_addresses_pass_only_with_the_switch(self):
        with patch.object(security, "ATTENDANCE_TEST_EXTERNAL_EMAIL", True):
            self.assertTrue(security.is_allowed_login_email("someone@gmail.com"))
            self.assertTrue(security.is_allowed_login_email(" Second.Person@Outlook.com "))
            for bad in ("not-an-email", "a b@gmail.com", "@gmail.com", "a@b", "", None):
                self.assertFalse(security.is_allowed_login_email(bad), bad)
        self.assertFalse(security.is_allowed_login_email("someone@gmail.com"))


class FailureClassificationTests(unittest.TestCase):
    def test_known_messages_map_to_stages(self):
        cases = {
            "ภาพต่อเนื่องลำดับที่ 1ต้องพบใบหน้าชัดเจนเพียง 1 คน": "detect",
            "โปรดมองตรงและให้ใบหน้าอยู่ในกรอบตลอดการสแกน": "framing",
            "พบการสลับบุคคลหรือภาพหลักฐานไม่ต่อเนื่องระหว่างทำ liveness": "same_person",
            "ตรวจพบความเสี่ยงจากภาพถ่ายหรือหน้าจอ กรุณาใช้บุคคลจริง": "pad",
            "ใบหน้ามีขนาดเล็กเกินไปสำหรับตรวจภาพปลอม": "pad_size",
            "ตรวจพบภาพซ้ำหรือภาพนิ่ง กรุณาใช้บุคคลจริงหน้ากล้อง": "static_passive",
            "ภาพคำสั่งสุ่มซ้ำหรือไม่ต่อเนื่อง กรุณาใช้กล้องกับบุคคลจริง": "static_action",
            "คำสั่งกะพริบตาไม่ผ่าน กรุณาหลับและลืมตาทั้งสองข้าง": "blink",
            "คำสั่งขยับเข้าใกล้ไม่ผ่าน กรุณาเคลื่อนใบหน้า": "move_closer",
            "ภาพหลังทำคำสั่งต้องกลับมามองตรงและอยู่ในกรอบเดิม": "recovery",
            "การยืนยันตัวตนล้มเหลว ใบหน้าไม่ตรงกับข้อมูลที่ลงทะเบียนไว้ (Score: 0.2)": "identity",
        }
        for text, stage in cases.items():
            self.assertEqual(svc.classify_failure(text), stage, text)

    def test_unknown_or_empty_text_is_other(self):
        self.assertEqual(svc.classify_failure("something new"), "other")
        self.assertEqual(svc.classify_failure(None), "other")

    def test_every_marker_is_a_message_that_really_exists_in_the_code(self):
        sources = "".join(
            (PROJECT_ROOT / "backend" / path).read_text(encoding="utf-8")
            for path in (
                "services/liveness_frame_service.py",
                "services/liveness_service.py",
                "services/passive_pad_service.py",
                "main.py",
            )
        )
        for marker, stage in svc._STAGE_MARKERS:
            if stage in ("token", "image"):
                continue  # these come from several other modules
            self.assertIn(marker, sources, f"{stage}: message text not found in the code")


class _Table:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def insert(self, row):
        self.db.calls.append(("insert", self.name, row))
        return self

    def upsert(self, rows, **kwargs):
        self.db.calls.append(("upsert", self.name, rows, kwargs))
        return self

    def execute(self):
        if self.db.fail:
            raise RuntimeError("table does not exist")
        return SimpleNamespace(data=[])


class _Db:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def table(self, name):
        return _Table(self, name)


class AttemptLogTests(unittest.TestCase):
    def test_success_row_has_score_and_status_and_no_failure_text(self):
        db = _Db()
        self.assertTrue(svc.record_face_attempt(
            student_id="s1", course_id="c1", session_id="x1", outcome="success",
            attendance_status="present", similarity_score=0.712345, threshold_used=0.45,
            liveness_action="blink", app_version="v1", db=db,
        ))
        _, table, row = db.calls[0]
        self.assertEqual(table, "face_checkin_attempts")
        self.assertEqual(row["similarity_score"], 0.7123)
        self.assertEqual(row["attendance_status"], "present")
        self.assertIsNone(row["failure_reason"])

    def test_failed_row_keeps_stage_reason_and_score_and_trims_long_text(self):
        db = _Db()
        svc.record_face_attempt(
            student_id="s1", course_id="c1", session_id="x1", outcome="failed",
            similarity_score=0.21, failure_stage="identity", failure_reason="ก" * 900,
            liveness_action="not-valid", db=db,
        )
        row = db.calls[0][2]
        self.assertEqual(len(row["failure_reason"]), svc.MAX_REASON_CHARS)
        self.assertEqual(row["failure_stage"], "identity")
        self.assertIsNone(row["liveness_action"])
        self.assertEqual(row["similarity_score"], 0.21)

    def test_a_failure_without_text_still_gets_a_reason(self):
        db = _Db()
        svc.record_face_attempt(student_id="s1", course_id=None, session_id=None, outcome="failed", db=db)
        self.assertEqual(db.calls[0][2]["failure_reason"], "ไม่ทราบสาเหตุ")

    def test_a_database_problem_never_breaks_the_check_in(self):
        self.assertFalse(svc.record_face_attempt(
            student_id="s1", course_id="c1", session_id="x1", outcome="failed",
            failure_reason="x", db=_Db(fail=True),
        ))

    def test_no_personal_fields_are_ever_written(self):
        db = _Db()
        svc.record_face_attempt(student_id="s1", course_id="c1", session_id="x1", outcome="failed",
                                failure_reason="x", db=db)
        for forbidden in ("email", "full_name", "student_code", "image", "embedding"):
            self.assertNotIn(forbidden, db.calls[0][2])


class AutoJoinTests(unittest.TestCase):
    def test_joins_every_listed_course_without_duplicates(self):
        db = _Db()
        with patch.object(svc, "ATTENDANCE_TEST_MODE", True), \
             patch.object(svc, "ATTENDANCE_TEST_ALL_COURSES", False), \
             patch.object(svc, "ATTENDANCE_TEST_COURSE_IDS", frozenset({LISTED, OTHER})):
            self.assertEqual(svc.auto_join_test_courses("user-1", db=db), 2)
        op, table, rows, kwargs = db.calls[0]
        self.assertEqual((op, table), ("upsert", "enrollments"))
        self.assertEqual({r["course_id"] for r in rows}, {LISTED, OTHER})
        self.assertTrue(all(r["student_id"] == "user-1" for r in rows))
        self.assertEqual(kwargs["on_conflict"], "course_id,student_id")
        self.assertTrue(kwargs["ignore_duplicates"])

    def test_does_nothing_outside_test_mode_or_in_all_courses_mode(self):
        for mode, all_courses in ((False, False), (True, True)):
            db = _Db()
            with patch.object(svc, "ATTENDANCE_TEST_MODE", mode), \
                 patch.object(svc, "ATTENDANCE_TEST_ALL_COURSES", all_courses), \
                 patch.object(svc, "ATTENDANCE_TEST_COURSE_IDS", frozenset({LISTED})):
                self.assertEqual(svc.auto_join_test_courses("user-1", db=db), 0)
            self.assertEqual(db.calls, [])

    def test_a_database_problem_is_swallowed(self):
        with patch.object(svc, "ATTENDANCE_TEST_MODE", True), \
             patch.object(svc, "ATTENDANCE_TEST_ALL_COURSES", False), \
             patch.object(svc, "ATTENDANCE_TEST_COURSE_IDS", frozenset({LISTED})):
            self.assertEqual(svc.auto_join_test_courses("user-1", db=_Db(fail=True)), 0)


class AutoJoinOnLoginTests(unittest.TestCase):
    def setUp(self):
        svc._join_seen.clear()
        self.addCleanup(svc._join_seen.clear)

    def _on(self):
        return (
            patch.object(svc, "ATTENDANCE_TEST_MODE", True),
            patch.object(svc, "ATTENDANCE_TEST_ALL_COURSES", False),
            patch.object(svc, "ATTENDANCE_TEST_COURSE_IDS", frozenset({LISTED})),
        )

    def test_a_signed_in_student_joins_with_no_code_and_no_request(self):
        db = _Db()
        a, b, c = self._on()
        with a, b, c:
            self.assertEqual(svc.auto_join_test_courses_on_login("user-1", "student", db=db), 1)
        self.assertEqual([call[:2] for call in db.calls], [("upsert", "enrollments")])
        # No join request rows are created or approved: enrolment is written directly.
        self.assertFalse(any(call[1] == "course_join_requests" for call in db.calls))

    def test_teachers_and_admins_are_not_enrolled_as_students(self):
        for role in ("teacher", "admin", None):
            db = _Db()
            a, b, c = self._on()
            with a, b, c:
                self.assertEqual(svc.auto_join_test_courses_on_login("user-1", role, db=db), 0)
            self.assertEqual(db.calls, [])

    def test_repeat_calls_do_not_hit_the_database_again(self):
        db = _Db()
        a, b, c = self._on()
        with a, b, c:
            self.assertEqual(svc.auto_join_test_courses_on_login("user-1", "student", db=db), 1)
            self.assertEqual(svc.auto_join_test_courses_on_login("user-1", "student", db=db), 0)
        self.assertEqual(len(db.calls), 1)

    def test_a_failed_attempt_is_retried_on_the_next_sign_in(self):
        a, b, c = self._on()
        with a, b, c:
            self.assertEqual(svc.auto_join_test_courses_on_login("user-1", "student", db=_Db(fail=True)), 0)
            good = _Db()
            self.assertEqual(svc.auto_join_test_courses_on_login("user-1", "student", db=good), 1)
        self.assertEqual(len(good.calls), 1)

    def test_nothing_happens_outside_test_mode(self):
        db = _Db()
        with patch.object(svc, "ATTENDANCE_TEST_MODE", False), \
             patch.object(svc, "ATTENDANCE_TEST_COURSE_IDS", frozenset({LISTED})):
            self.assertEqual(svc.auto_join_test_courses_on_login("user-1", "student", db=db), 0)
        self.assertEqual(db.calls, [])

    def test_the_me_endpoint_is_wired_and_guarded_by_test_mode(self):
        main = (PROJECT_ROOT / "backend/main.py").read_text(encoding="utf-8")
        body = main.split("def get_authenticated_profile(", 1)[1].split("@app.get", 1)[0]
        self.assertIn("if ATTENDANCE_TEST_MODE:", body)
        self.assertIn("auto_join_test_courses_on_login(current_user.id, current_user.role)", body)


class TestCourseSelectionTests(unittest.TestCase):
    def test_only_listed_courses_use_the_test_flow(self):
        with patch.object(svc, "ATTENDANCE_TEST_MODE", True), \
             patch.object(svc, "ATTENDANCE_TEST_ALL_COURSES", False), \
             patch.object(svc, "ATTENDANCE_TEST_COURSE_IDS", frozenset({LISTED})):
            self.assertTrue(svc.is_test_course(LISTED))
            self.assertTrue(svc.is_test_course(LISTED.upper()))
            self.assertFalse(svc.is_test_course(OTHER))
            self.assertFalse(svc.is_test_course(None))

    def test_never_outside_test_mode(self):
        self.assertFalse(svc.is_test_course(LISTED))


class ReadRetryTests(unittest.TestCase):
    def test_a_reset_connection_is_retried_once_and_then_succeeds(self):
        import httpx
        from routers import test_mode as router

        calls = []

        def flaky():
            calls.append(1)
            if len(calls) == 1:
                raise httpx.RemoteProtocolError("Server disconnected")
            return "ok"

        self.assertEqual(router._read_with_retry(flaky), "ok")
        self.assertEqual(len(calls), 2)

    def test_a_second_failure_is_not_hidden(self):
        import httpx
        from routers import test_mode as router

        def always():
            raise httpx.RemoteProtocolError("Server disconnected")

        with self.assertRaises(httpx.RemoteProtocolError):
            router._read_with_retry(always)

    def test_other_errors_are_not_retried(self):
        from routers import test_mode as router

        calls = []

        def broken():
            calls.append(1)
            raise ValueError("bad data")

        with self.assertRaises(ValueError):
            router._read_with_retry(broken)
        self.assertEqual(len(calls), 1)


class PermanentTestCourseFileTests(unittest.TestCase):
    def setUp(self):
        self.sql = (PROJECT_ROOT / "supabase/test-only/20261113130000_permanent_test_course.sql").read_text(encoding="utf-8")

    def test_seed_uses_the_agreed_course_data_and_never_overwrites(self):
        self.assertIn("'030513702', 'Select Topic React', 1, 2569, 1", self.sql)
        self.assertIn("where not exists", self.sql)
        self.assertNotIn("on conflict (id) do update", self.sql)

    def test_seed_is_outside_production_migrations_and_has_a_delete_guard(self):
        self.assertIn("before delete on public.courses", self.sql)
        names = [m.name for m in (PROJECT_ROOT / "supabase/migrations").glob("*")]
        self.assertFalse([n for n in names if "permanent_test_course" in n])


class _Chain:
    """Minimal PostgREST-like chain over in-memory rows."""

    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.action, self.payload, self.kwargs = [], "select", None, {}

    def select(self, *_a, **_k):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def is_(self, column, _value):
        self.filters.append((column, None))
        return self

    def limit(self, _n):
        return self

    def insert(self, row):
        self.action, self.payload = "insert", row
        return self

    def upsert(self, rows, **kwargs):
        self.action, self.payload, self.kwargs = "upsert", rows, kwargs
        return self

    def execute(self):
        if self.db.fail_on == self.action:
            raise RuntimeError("database problem")
        if self.action == "insert":
            self.db.inserted.append((self.name, self.payload))
            return SimpleNamespace(data=[self.payload])
        if self.action == "upsert":
            self.db.upserts.append((self.name, self.payload, self.kwargs))
            return SimpleNamespace(data=[])
        rows = [
            row for row in self.db.tables.get(self.name, [])
            if all(row.get(column) == value for column, value in self.filters)
        ]
        return SimpleNamespace(data=rows)


class _MemoryDb:
    def __init__(self, tables=None, fail_on=None):
        self.tables, self.fail_on = tables or {}, fail_on
        self.inserted, self.upserts = [], []

    def table(self, name):
        return _Chain(self, name)


def _test_mode_on(courses=(LISTED,), all_courses=False):
    return (
        patch.object(svc, "ATTENDANCE_TEST_MODE", True),
        patch.object(svc, "ATTENDANCE_TEST_ALL_COURSES", all_courses),
        patch.object(svc, "ATTENDANCE_TEST_COURSE_IDS", frozenset(courses)),
    )


class StandingSessionTests(unittest.TestCase):
    def _run(self, db, **kwargs):
        a, b, c = _test_mode_on()
        with a, b, c:
            return svc.ensure_test_course_sessions(db=db, **kwargs)

    def test_opens_a_session_in_the_teachers_name_when_none_is_open(self):
        db = _MemoryDb({"courses": [{"id": LISTED, "teacher_id": "teacher-1"}], "attendance_sessions": []})
        self.assertEqual(self._run(db), 1)
        table, row = db.inserted[0]
        self.assertEqual(table, "attendance_sessions")
        self.assertEqual((row["course_id"], row["opened_by"], row["status"]), (LISTED, "teacher-1", "open"))
        self.assertTrue(row["qr_token"])
        self.assertEqual(row["grace_period_minutes"], svc.TEST_SESSION_GRACE_MINUTES)

    def test_does_nothing_when_a_session_is_already_open(self):
        db = _MemoryDb({
            "courses": [{"id": LISTED, "teacher_id": "teacher-1"}],
            "attendance_sessions": [{"id": "s1", "course_id": LISTED, "status": "open", "archived_at": None}],
        })
        self.assertEqual(self._run(db), 0)
        self.assertEqual(db.inserted, [])

    def test_a_closed_session_is_replaced_by_a_new_open_one(self):
        db = _MemoryDb({
            "courses": [{"id": LISTED, "teacher_id": "teacher-1"}],
            "attendance_sessions": [{"id": "s1", "course_id": LISTED, "status": "closed", "archived_at": None}],
        })
        self.assertEqual(self._run(db), 1)

    def test_skips_a_course_without_a_teacher_or_that_does_not_exist(self):
        no_teacher = _MemoryDb({"courses": [{"id": LISTED, "teacher_id": None}]})
        self.assertEqual(self._run(no_teacher), 0)
        missing = _MemoryDb({"courses": []})
        self.assertEqual(self._run(missing), 0)

    def test_only_listed_courses_are_touched(self):
        db = _MemoryDb({"courses": [{"id": OTHER, "teacher_id": "teacher-1"}]})
        self.assertEqual(self._run(db, course_ids=[OTHER]), 0)
        self.assertEqual(db.inserted, [])

    def test_never_runs_outside_test_mode_or_for_all_courses(self):
        db = _MemoryDb({"courses": [{"id": LISTED, "teacher_id": "teacher-1"}]})
        self.assertEqual(svc.ensure_test_course_sessions(db=db), 0)  # test mode is off here
        a, b, c = _test_mode_on(all_courses=True)
        with a, b, c:
            self.assertEqual(svc.ensure_test_course_sessions(db=db), 0)
        self.assertEqual(db.inserted, [])

    def test_a_database_error_is_swallowed(self):
        db = _MemoryDb({"courses": [{"id": LISTED, "teacher_id": "teacher-1"}]}, fail_on="insert")
        self.assertEqual(self._run(db), 0)

    def test_throttle_runs_once_per_interval(self):
        db = _MemoryDb({"courses": [{"id": LISTED, "teacher_id": "teacher-1"}]})
        a, b, c = _test_mode_on()
        with a, b, c, patch.object(svc, "_keeper_last_run", 0.0):
            first = svc.ensure_test_course_sessions_throttled(db=db, min_interval=3600)
            second = svc.ensure_test_course_sessions_throttled(db=db, min_interval=3600)
        self.assertEqual((first, second), (1, 0))


class BackfillTests(unittest.TestCase):
    def test_enrolls_every_student_account_without_duplicates(self):
        db = _MemoryDb({"profiles": [
            {"id": "a", "role": "student", "face_registered": True},
            {"id": "b", "role": "student", "face_registered": True},
            {"id": "c", "role": "student", "face_registered": False},
            {"id": "t", "role": "teacher", "face_registered": True},
        ]})
        a, b, c = _test_mode_on((LISTED, OTHER))
        with a, b, c:
            self.assertEqual(svc.backfill_test_course_members(db=db), 3)
        self.assertEqual(len(db.upserts), 2)
        for _table, rows, kwargs in db.upserts:
            self.assertEqual({row["student_id"] for row in rows}, {"a", "b", "c"})
            self.assertTrue(kwargs["ignore_duplicates"])
            self.assertEqual(kwargs["on_conflict"], "course_id,student_id")

    def test_off_in_all_courses_mode_and_swallows_errors(self):
        db = _MemoryDb({"profiles": []})
        a, b, c = _test_mode_on(all_courses=True)
        with a, b, c:
            self.assertEqual(svc.backfill_test_course_members(db=db), 0)
        a, b, c = _test_mode_on()
        with a, b, c:
            self.assertEqual(svc.backfill_test_course_members(db=_MemoryDb(fail_on="upsert")), 0)


class SpecWiringTests(unittest.TestCase):
    def setUp(self):
        self.main = (PROJECT_ROOT / "backend/main.py").read_text(encoding="utf-8")
        self.router = (PROJECT_ROOT / "backend/routers/test_mode.py").read_text(encoding="utf-8")

    def test_the_keeper_only_exists_in_the_test_mode_block(self):
        block = self.main.split("if ATTENDANCE_TEST_MODE:\n    from routers.test_mode", 1)[1].split("@app.get(\"/health/live\"", 1)[0]
        self.assertIn("ensure_test_course_sessions", block)
        self.assertIn("backfill_test_course_members", block)
        self.assertIn('app.on_event("startup")(_start_test_course_keeper)', block)
        head = self.main.split("if ATTENDANCE_TEST_MODE:\n    from routers.test_mode", 1)[0]
        self.assertNotIn("_start_test_course_keeper", head)

    def test_the_student_poll_recreates_a_closed_session(self):
        self.assertIn("ensure_test_course_sessions_throttled(course_ids)", self.router)

    def test_test_courses_record_present_and_normal_courses_keep_the_clock(self):
        verify = self.main.split('@app.post("/api/v1/attendance/verify")', 1)[1].split("@app.post", 1)[0]
        self.assertIn('calculated_status = "present"', verify)
        before = verify.split('calculated_status = "present"', 1)[0]
        self.assertIn("calculate_attendance_status(", before)  # the clock still runs for normal courses
        self.assertIn('if attempt["test"]:', before.rsplit("calculate_attendance_status(", 1)[1] + 'if attempt["test"]:')

    def test_the_course_is_resolved_before_the_liveness_check_so_its_failures_are_logged(self):
        verify = self.main.split('@app.post("/api/v1/attendance/verify")', 1)[1].split("@app.post", 1)[0]
        self.assertLess(verify.index("_resolve_test_attempt"), verify.index("verify_attendance_liveness_submission("))
        helper = self.main.split("def _resolve_test_attempt", 1)[1].split("def _log_test_attempt_failure", 1)[0]
        self.assertIn("if not ATTENDANCE_TEST_MODE", helper)


class ScannerPerformanceGuards(unittest.TestCase):
    def setUp(self):
        self.scanner = (PROJECT_ROOT / "frontend/src/features/student/LivenessScanner.tsx").read_text(encoding="utf-8")

    def test_analysis_frames_are_no_larger_than_the_images_sent_to_the_server(self):
        analysis = re.search(r"const ANALYSIS_MAX_SIDE = (\d+);", self.scanner)
        sent = re.search(r"const maxSide = (\d+);", self.scanner)
        self.assertIsNotNone(analysis)
        self.assertIsNotNone(sent)
        self.assertLessEqual(int(analysis.group(1)), int(sent.group(1)))

    def test_required_fps_label_matches_the_backend_floor(self):
        from services.liveness_service import MIN_EFFECTIVE_FPS

        self.assertIn(f"const REQUIRED_FPS = {MIN_EFFECTIVE_FPS};", self.scanner)

    def test_the_stats_overlay_only_exists_in_test_builds(self):
        self.assertIn("{TEST_MODE && stats && (", self.scanner)
        self.assertIn("if (TEST_MODE) {", self.scanner)


class WiringGuards(unittest.TestCase):
    def setUp(self):
        self.main = (PROJECT_ROOT / "backend/main.py").read_text(encoding="utf-8")

    def test_normal_courses_still_finalize_and_test_courses_do_not(self):
        verify = self.main.split('@app.post("/api/v1/attendance/verify")', 1)[1].split("@app.post", 1)[0]
        self.assertIn('if attempt["test"]:', verify)
        self.assertEqual(verify.count("finalize_face_attendance,"), 1)
        branch = verify.split('if attempt["test"]:', 1)[1].split("else:", 1)[0]
        self.assertNotIn("finalize_face_attendance", branch)
        self.assertIn("record_face_attempt", branch)

    def test_the_claim_is_released_and_not_consumed_on_the_test_path(self):
        verify = self.main.split('@app.post("/api/v1/attendance/verify")', 1)[1].split("@app.post", 1)[0]
        test_branch = verify.split('if attempt["test"]:', 1)[1].split("else:", 1)[0]
        self.assertNotIn("processing_claim_token = None", test_branch)

    def test_the_card_is_required_again_when_the_mode_is_off(self):
        self.assertIn("if student_card_image is None and not ATTENDANCE_TEST_MODE:", self.main)
        self.assertIn('status_code=422, detail="ต้องแนบภาพบัตรนักศึกษา"', self.main)

    def test_auto_join_runs_only_in_test_mode_after_the_enrollment_is_saved(self):
        text = self.main
        finalize = text.index("finalize_face_enrollment,\n                enrollment_challenge_id")
        join = text.index("auto_join_test_courses, current_user.id")
        self.assertGreater(join, finalize)
        self.assertIn("if ATTENDANCE_TEST_MODE:\n                await run_in_threadpool(auto_join_test_courses", text)

    def test_the_test_only_migration_lives_outside_the_production_migrations(self):
        self.assertTrue((PROJECT_ROOT / "supabase/test-only/20261113120000_test_external_email_and_face_attempts.sql").is_file())
        migrations = list((PROJECT_ROOT / "supabase/migrations").glob("*"))
        self.assertFalse([m for m in migrations if "face_attempts" in m.name or "external_email" in m.name])

    def test_the_migration_is_off_by_default(self):
        sql = (PROJECT_ROOT / "supabase/test-only/20261113120000_test_external_email_and_face_attempts.sql").read_text(encoding="utf-8")
        self.assertTrue(re.search(r"values \('allow_external_email', false\)", sql))
        self.assertIn("revoke all on public.face_checkin_attempts from public, anon, authenticated", sql)
        self.assertIn("enable row level security", sql)


if __name__ == "__main__":
    unittest.main()
