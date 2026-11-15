"""Helpers for the test-only mode: test-course lookup, auto-join and the attempt log.

Nothing here runs unless ATTENDANCE_TEST_MODE is on (see core/test_mode.py). The attempt log
is best effort: a missing table or a database error is logged and never changes the
result a student sees.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from typing import Any

from core.config import (
    ATTENDANCE_TEST_ALL_COURSES,
    ATTENDANCE_TEST_COURSE_IDS,
    ATTENDANCE_TEST_MODE,
    supabase_db,
)
from services.attempt_diagnostics import MAX_JSON_BYTES as MAX_DIAGNOSTICS_BYTES
from services.attempt_diagnostics import json_size as _diagnostics_size
from services.attempt_diagnostics import sanitise as _sanitise_diagnostics
from services.failure_diagnostics import failure_code

logger = logging.getLogger(__name__)

THRESHOLD_KEY = "face_threshold"
MAX_REASON_CHARS = 500
MAX_STAGE_CHARS = 40
MAX_VERSION_CHARS = 80
# Same grace period the teacher's "start session" endpoint stores.
TEST_SESSION_GRACE_MINUTES = 15
KEEPER_MIN_INTERVAL_SECONDS = 15.0
BACKFILL_MAX_STUDENTS = 2000
BACKFILL_CHUNK = 500

# Set when the database said the `diagnostics` column does not exist (the test-only migration
# 20261115090000_face_attempt_diagnostics.sql is not applied yet); later rows skip the field
# until DIAGNOSTICS_REPROBE_SECONDS have passed, then the field is tried again (so applying the
# migration does not need a Backend restart).
_diagnostics_column_missing = False
_diagnostics_column_missing_at = 0.0
DIAGNOSTICS_REPROBE_SECONDS = 600.0

_keeper_lock = threading.Lock()
_keeper_last_run = 0.0
_warned_no_teacher: set[str] = set()

# First match wins. The texts come from the Thai messages raised by the liveness and
# face-comparison code, so a changed message falls back to "other" instead of failing.
# In test mode every message also carries a "[รหัส <code> ...]" tag (failure_diagnostics);
# that exact code is used first. The phrases below classify messages without a tag.
# Order matters: a specific phrase must come before the generic prefix that also appears in it.
_STAGE_MARKERS: tuple[tuple[str, str], ...] = (
    # Evidence/timing contract (services/liveness_service.py). Specific phrases first.
    ("ช่วงเวลาหลักฐานภาพไม่เป็นธรรมชาติ", "timing_interval"),
    ("เวลาคำสั่งสุ่มไม่ต่อเนื่อง", "timing"),
    ("ลำดับหลักฐานภาพต่อเนื่องไม่ถูกต้อง", "sequence_passive"),
    ("ลำดับคำสั่งสุ่มไม่ถูกต้อง", "sequence_action"),
    ("รูปแบบหลักฐานตรวจบุคคลจริงไม่ถูกต้อง", "evidence_shape"),
    ("อ่านหลักฐานตรวจบุคคลจริงไม่ได้", "evidence_json"),
    ("หลักฐานตรวจบุคคลจริงมีขนาดไม่ถูกต้อง", "evidence_size"),
    ("หลักฐานตรวจบุคคลจริงขาดค่า", "evidence_value"),
    ("หลักฐานตรวจบุคคลจริงไม่ถูกต้อง", "token_encoding"),
    ("ไม่พบสิทธิ์ตรวจบุคคลจริง", "token_missing"),
    ("สิทธิ์ตรวจบุคคลจริงไม่ถูกต้อง", "token_signature"),
    ("สิทธิ์ตรวจบุคคลจริงเสียหาย", "token_corrupt"),
    ("เวอร์ชันตรวจบุคคลจริงไม่รองรับ", "token_version"),
    ("สิทธิ์ตรวจบุคคลจริงไม่ตรงกับผู้ใช้", "token_binding"),
    ("สิทธิ์ตรวจบุคคลจริงหมดอายุ", "token_expired"),
    ("นโยบายตรวจบุคคลจริงไม่ถูกต้อง", "token_policy"),
    ("คำสั่งสุ่มสำหรับ Liveness ไม่ถูกต้อง", "frames_action"),
    ("หลักฐาน Passive Liveness ต้องมี 3 เฟรม", "frames_count"),
    ("จำนวนภาพ Passive Liveness ไม่ตรงกับ challenge", "frames_count"),
    ("หลักฐานตรวจภาพปลอมต้องมี 3 เฟรม", "pad_count"),
    ("ไฟล์ภาพ liveness เสียหรืออ่านไม่ได้", "image_decode"),
    ("คาบเรียนนี้ปิดระบบเช็คชื่อแล้ว", "session_closed"),
    ("ยังไม่ได้ลงทะเบียนใบหน้าตั้งต้น", "not_enrolled"),
    ("ไม่พบโปรไฟล์นักศึกษาในระบบ", "profile_missing"),
    ("เกิดข้อผิดพลาดภายในระบบ", "internal"),
    ("ไม่พบใบหน้าในภาพ", "detect_none"),
    ("พบใบหน้ามากกว่า 1 ใบในภาพ", "detect_multi"),
    ("ใบหน้าไม่ชัดเจนพอ", "detect_low_score"),
    ("อ่านตำแหน่งตาและปากไม่ได้", "detect_landmarks"),
    ("ต้องพบใบหน้าชัดเจนเพียง 1 คน", "detect"),
    ("ภาพหลังทำคำสั่งต้องกลับมามองตรง", "recovery"),
    ("ใบหน้าขยับเข้าใกล้ไม่มากพอ", "move_closer_small"),
    ("ใบหน้าเข้าใกล้กล้องมากเกินไป", "move_closer_large"),
    ("ใบหน้าเลื่อนออกจากกลางกรอบขณะขยับ", "move_closer_center"),
    ("ศีรษะหันไปด้านข้างขณะขยับ", "move_closer_yaw"),
    ("ศีรษะก้มหรือเงยขณะขยับ", "move_closer_pitch"),
    ("คำสั่งขยับเข้าใกล้ไม่ผ่าน", "move_closer"),
    ("ใบหน้าเล็กเกินไป กรุณาขยับเข้าใกล้กล้องอีกเล็กน้อย", "framing_small"),
    ("ใบหน้าใหญ่เกินไป", "framing_large"),
    ("ศีรษะหันไปด้านข้างระหว่างสแกน", "framing_yaw"),
    ("ศีรษะก้มหรือเงยระหว่างสแกน", "framing_pitch"),
    ("ศีรษะหรือโทรศัพท์เอียงระหว่างสแกน", "framing_roll"),
    ("ระยะห่างจากกล้องเปลี่ยนระหว่างสแกน", "framing_scale"),
    ("ใบหน้าอยู่ห่างจากกลางกรอบ", "framing_center"),
    ("ใบหน้าเลื่อนออกจากกลางกรอบ", "framing_center"),
    ("โปรดมองตรงและให้ใบหน้าอยู่ในกรอบ", "framing"),
    ("พบการสลับบุคคล", "same_person"),
    ("ใบหน้ามีขนาดเล็กเกินไป", "pad_size"),
    ("ไม่สามารถตัดบริเวณใบหน้า", "pad_crop"),
    ("ตรวจพบความเสี่ยงจากภาพถ่ายหรือหน้าจอ", "pad"),
    ("ตรวจพบภาพซ้ำหรือภาพนิ่ง", "static_passive"),
    ("ภาพคำสั่งสุ่มซ้ำหรือไม่ต่อเนื่อง", "static_action"),
    ("เปลี่ยนเป็นคำสั่งขยับเข้าใกล้กล้องแทนการกะพริบตา", "action_fallback"),
    ("คำสั่งกะพริบตาไม่ผ่าน", "blink"),
    ("ระยะเวลาสแกนใบหน้าไม่เป็นธรรมชาติ", "duration"),
    ("อัตราภาพจากกล้องไม่เพียงพอ", "fps"),
    ("การยืนยันตัวตนล้มเหลว", "identity"),
    ("สิทธิ์ตรวจบุคคลจริง", "token"),
    ("สิทธิ์จาก QR", "token"),
    ("ไม่พบสิทธิ์เช็คชื่อ", "token"),
    ("ไฟล์ภาพ", "image"),
    ("ไม่ใช่ไฟล์ภาพ", "image"),
)


def classify_failure(detail: str | None) -> str:
    """Map the message shown to the student to a short stage code for the attempt log."""
    text = detail or ""
    tagged = failure_code(text)
    if tagged:
        return tagged[:MAX_STAGE_CHARS]
    for marker, stage in _STAGE_MARKERS:
        if marker in text:
            return stage
    return "other"


def is_test_course(course_id: str | None) -> bool:
    """True when check-ins of this course use the test flow (results go to the attempt log)."""
    if not ATTENDANCE_TEST_MODE or not course_id:
        return False
    return ATTENDANCE_TEST_ALL_COURSES or str(course_id).lower() in ATTENDANCE_TEST_COURSE_IDS


def record_face_attempt(
    *,
    student_id: str,
    course_id: str | None,
    session_id: str | None,
    outcome: str,
    attendance_status: str | None = None,
    similarity_score: float | None = None,
    threshold_used: float | None = None,
    liveness_action: str | None = None,
    failure_stage: str | None = None,
    failure_reason: str | None = None,
    app_version: str | None = None,
    diagnostics: dict[str, Any] | None = None,
    db: Any = None,
) -> bool:
    """Insert one row into face_checkin_attempts. Returns False (and logs) on any problem.

    `diagnostics` is the numbers-only object from services/attempt_diagnostics.py. It is
    sanitised again here and dropped when too large. When the test database does not have the
    `diagnostics` column yet, the row is written without it (once detected, it is skipped).
    """
    global _diagnostics_column_missing, _diagnostics_column_missing_at
    client = db if db is not None else supabase_db
    row: dict[str, Any] = {
        "student_id": student_id,
        "course_id": course_id,
        "session_id": session_id,
        "outcome": outcome,
        "attendance_status": attendance_status,
        "similarity_score": None if similarity_score is None else round(float(similarity_score), 4),
        "threshold_used": threshold_used,
        "liveness_action": liveness_action if liveness_action in ("blink", "move_closer") else None,
        "failure_stage": (failure_stage or None) and failure_stage[:MAX_STAGE_CHARS],
        "failure_reason": (failure_reason or None) and failure_reason[:MAX_REASON_CHARS],
        "app_version": (app_version or None) and app_version[:MAX_VERSION_CHARS],
    }
    if outcome == "failed" and not row["failure_reason"]:
        row["failure_reason"] = "ไม่ทราบสาเหตุ"
    clean = clean_diagnostics(diagnostics)
    skip_field = (
        _diagnostics_column_missing
        and time.monotonic() - _diagnostics_column_missing_at < DIAGNOSTICS_REPROBE_SECONDS
    )
    if clean is not None and not skip_field:
        row["diagnostics"] = clean
    try:
        client.table("face_checkin_attempts").insert(row).execute()
        if "diagnostics" in row:
            _diagnostics_column_missing = False
        return True
    except Exception as exc:  # noqa: BLE001 - logging must never break a check-in
        missing_column = "diagnostics" in row and _is_missing_diagnostics_column(exc)
        shape_violation = "diagnostics" in row and _is_diagnostics_check_violation(exc)
        if missing_column or shape_violation:
            if missing_column:
                _diagnostics_column_missing = True
                _diagnostics_column_missing_at = time.monotonic()
                logger.warning("face_checkin_attempts has no diagnostics column yet; recording without it")
            else:
                # The database size/shape check refused this one object: keep the attempt row.
                logger.warning("face_checkin_attempts refused the diagnostics object; recording without it")
            row.pop("diagnostics")
            try:
                client.table("face_checkin_attempts").insert(row).execute()
                return True
            except Exception as retry_exc:  # noqa: BLE001
                exc = retry_exc
        logger.warning("Could not record the face check-in attempt (%s)", type(exc).__name__)
        return False


def clean_diagnostics(diagnostics: Any) -> dict[str, Any] | None:
    """Sanitise (numbers and short identifiers only) and size-bound a diagnostics object."""
    if not isinstance(diagnostics, dict):
        return None
    clean = _sanitise_diagnostics(diagnostics, 1)
    if not isinstance(clean, dict) or _diagnostics_size(clean) > MAX_DIAGNOSTICS_BYTES:
        return None
    return clean


def _is_missing_diagnostics_column(exc: Exception) -> bool:
    """True for PostgREST "column not in schema cache" (PGRST204) or Postgres 42703 on diagnostics."""
    code = str(getattr(exc, "code", "") or "")
    text = f"{getattr(exc, 'message', '')} {exc}".lower()
    if code in ("PGRST204", "42703"):
        return "diagnostics" in text or not text.strip()
    return "diagnostics" in text and "column" in text


def _is_diagnostics_check_violation(exc: Exception) -> bool:
    """True for Postgres CHECK violation 23514 on the diagnostics shape/size constraint."""
    code = str(getattr(exc, "code", "") or "")
    text = f"{getattr(exc, 'message', '')} {exc}".lower()
    return code == "23514" and "diagnostics" in text


def auto_join_test_courses(user_id: str, *, db: Any = None) -> int:
    """Enroll a student in every listed test course. Returns how many courses were joined or kept."""
    if not ATTENDANCE_TEST_MODE or ATTENDANCE_TEST_ALL_COURSES or not ATTENDANCE_TEST_COURSE_IDS:
        return 0
    client = db if db is not None else supabase_db
    rows = [
        {"course_id": course_id, "student_id": user_id}
        for course_id in sorted(ATTENDANCE_TEST_COURSE_IDS)
    ]
    try:
        client.table("enrollments").upsert(
            rows, on_conflict="course_id,student_id", ignore_duplicates=True
        ).execute()
        return len(rows)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not auto-join the test courses (%s)", type(exc).__name__)
        return 0


_JOIN_RECHECK_SECONDS = 600.0
_JOIN_CACHE_LIMIT = 5000
_join_seen: dict[str, float] = {}
_join_lock = threading.Lock()


def auto_join_test_courses_on_login(user_id: str, role: str | None, *, db: Any = None) -> int:
    """Enroll a student in the listed test courses as soon as they are signed in.

    No join code and no approval step. Only students are enrolled (teachers and admins are not
    students of the course). The call is idempotent and remembered per user for a few minutes, so
    the frequent "who am I" request does not hit the database every time. Never raises.
    """
    if role != "student":
        return 0
    now = time.monotonic()
    with _join_lock:
        last = _join_seen.get(user_id)
        if last is not None and now - last < _JOIN_RECHECK_SECONDS:
            return 0
    joined = auto_join_test_courses(user_id, db=db)
    if joined:
        with _join_lock:
            if len(_join_seen) >= _JOIN_CACHE_LIMIT:
                _join_seen.clear()
            _join_seen[user_id] = now
    return joined


def ensure_test_course_sessions(*, course_ids: list[str] | None = None, db: Any = None) -> int:
    """Keep one open session on every listed test course, so check-in is always available.

    Only the listed course UUIDs are touched (never in all-courses mode, which covers real
    classes). The session is opened in the name of the course's teacher so the teacher's
    dashboard shows it like any other session. Returns how many sessions were created.
    """
    if not ATTENDANCE_TEST_MODE or ATTENDANCE_TEST_ALL_COURSES:
        return 0
    wanted = set(ATTENDANCE_TEST_COURSE_IDS)
    if course_ids is not None:
        wanted &= {str(course_id).lower() for course_id in course_ids}
    client = db if db is not None else supabase_db
    created = 0
    for course_id in sorted(wanted):
        try:
            open_rows = (
                client.table("attendance_sessions")
                .select("id")
                .eq("course_id", course_id)
                .eq("status", "open")
                .is_("archived_at", "null")
                .limit(1)
                .execute()
            )
            if open_rows.data:
                continue
            course_rows = (
                client.table("courses").select("id, teacher_id").eq("id", course_id).limit(1).execute()
            )
            if not course_rows.data:
                continue
            teacher_id = course_rows.data[0].get("teacher_id")
            if not teacher_id:
                if course_id not in _warned_no_teacher:
                    _warned_no_teacher.add(course_id)
                    logger.warning("A test course has no teacher yet, so no session can be kept open for it")
                continue
            client.table("attendance_sessions").insert({
                "course_id": course_id,
                "opened_by": teacher_id,
                "status": "open",
                "qr_token": str(uuid.uuid4()),
                "grace_period_minutes": TEST_SESSION_GRACE_MINUTES,
            }).execute()
            created += 1
            logger.warning("TEST MODE: opened a standing session for a test course")
        except Exception as exc:  # noqa: BLE001 - the keeper must never break a request
            # A unique-index conflict means someone opened a session at the same moment, or the
            # teacher already has another open session; both are fine to skip.
            logger.warning("Could not keep a test-course session open (%s)", type(exc).__name__)
    return created


def ensure_test_course_sessions_throttled(
    course_ids: list[str] | None = None,
    *,
    min_interval: float = KEEPER_MIN_INTERVAL_SECONDS,
    db: Any = None,
) -> int:
    """Same as ensure_test_course_sessions but runs at most once per interval per process."""
    global _keeper_last_run
    now = time.monotonic()
    with _keeper_lock:
        if now - _keeper_last_run < min_interval:
            return 0
        _keeper_last_run = now
    return ensure_test_course_sessions(course_ids=course_ids, db=db)


def backfill_test_course_members(*, db: Any = None) -> int:
    """Enroll every student account in the listed test courses.

    Sign-in normally does this, but accounts created before a course was listed (or before this
    rule existed) would otherwise never see it. Idempotent. Returns the number of students handled.
    """
    if not ATTENDANCE_TEST_MODE or ATTENDANCE_TEST_ALL_COURSES or not ATTENDANCE_TEST_COURSE_IDS:
        return 0
    client = db if db is not None else supabase_db
    try:
        students = (
            client.table("profiles")
            .select("id")
            .eq("role", "student")
            .limit(BACKFILL_MAX_STUDENTS)
            .execute()
        )
        ids = [row["id"] for row in (students.data or [])]
        for course_id in sorted(ATTENDANCE_TEST_COURSE_IDS):
            for start in range(0, len(ids), BACKFILL_CHUNK):
                rows = [
                    {"course_id": course_id, "student_id": student_id}
                    for student_id in ids[start:start + BACKFILL_CHUNK]
                ]
                client.table("enrollments").upsert(
                    rows, on_conflict="course_id,student_id", ignore_duplicates=True
                ).execute()
        return len(ids)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not enroll registered students in the test courses (%s)", type(exc).__name__)
        return 0
