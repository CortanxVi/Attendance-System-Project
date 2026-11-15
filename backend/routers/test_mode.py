"""Test-only endpoints: start a face check-in without the dynamic QR step.

main.py includes this router ONLY when ATTENDANCE_TEST_MODE is on (see
core/test_mode.py for the gates). Everything that protects identity stays:
authenticated student, course membership, an open session, the signed liveness
challenge, PAD, the face comparison and the atomic finalize step. What is
removed is the QR token, the 3-second scan throttle and the short challenge
lifetime, for the courses listed in ATTENDANCE_TEST_COURSE_IDS or, when the
all-courses acknowledgement is set, for every course the student belongs to. A student
may ask for a new check-in right as often as needed: test check-ins are recorded in
face_checkin_attempts and never in attendance_records.
"""

from datetime import datetime, timedelta, timezone
import logging
from typing import Callable, TypeVar

import httpx
from fastapi import APIRouter, Depends, HTTPException

from core.authorization import require_course_enrollment
from core.config import (
    ATTENDANCE_TEST_ALL_COURSES,
    ATTENDANCE_TEST_COURSE_IDS,
    supabase_db as supabase,
)
from core.security import AuthenticatedUser, require_roles
from core.test_mode import TEST_CHALLENGE_SECONDS
from services.liveness_service import create_attendance_liveness_challenge
from services.test_mode_service import ensure_test_course_sessions_throttled


logger = logging.getLogger(__name__)
T = TypeVar("T")


def _read_with_retry(run: Callable[[], T]) -> T:
    """Run one read query again when the pooled HTTP/2 connection was closed by the server.

    The student page polls /open-sessions every 2 seconds, and Supabase drops idle HTTP/2
    connections ("Server disconnected"). Only reads are retried, once, because they are safe
    to repeat.
    """
    try:
        return run()
    except httpx.TransportError as exc:
        logger.warning("Supabase connection was reset; retrying the read once (%s)", type(exc).__name__)
        return run()


router = APIRouter(prefix="/api/v1/test", tags=["Test mode (QR and timers removed)"])


def _require_listed_course(course_id: str) -> None:
    if ATTENDANCE_TEST_ALL_COURSES:
        return
    if str(course_id).lower() not in ATTENDANCE_TEST_COURSE_IDS:
        raise HTTPException(
            status_code=403,
            detail="รายวิชานี้ไม่อยู่ในรายการวิชาทดสอบ จึงใช้โหมดทดสอบไม่ได้ กรุณาสแกน QR ตามปกติ",
        )


@router.get("/open-sessions")
def list_open_test_sessions(
    current_user: AuthenticatedUser = Depends(require_roles("student")),
):
    """Open sessions of the courses (listed, or all) that this student belongs to."""

    enrollment_query = (
        supabase.table("enrollments")
        .select("course_id")
        .eq("student_id", current_user.id)
    )
    if not ATTENDANCE_TEST_ALL_COURSES:
        enrollment_query = enrollment_query.in_("course_id", sorted(ATTENDANCE_TEST_COURSE_IDS))
    enrolled = _read_with_retry(enrollment_query.execute)
    course_ids = [row["course_id"] for row in (enrolled.data or [])]
    if not course_ids:
        return {"status": "success", "sessions": []}

    # A test course always has an open session: recreate it if the teacher closed it.
    ensure_test_course_sessions_throttled(course_ids)

    sessions = _read_with_retry(
        supabase.table("attendance_sessions")
        .select("id, course_id, created_at, courses(course_code, course_name)")
        .in_("course_id", course_ids)
        .eq("status", "open")
        .is_("archived_at", "null")
        .execute
    )
    rows = sorted(sessions.data or [], key=lambda row: row.get("created_at") or "", reverse=True)
    return {
        "status": "success",
        "sessions": [
            {
                "session_id": row["id"],
                "course_id": row["course_id"],
                "course_code": (row.get("courses") or {}).get("course_code"),
                "course_name": (row.get("courses") or {}).get("course_name"),
                "opened_at": row.get("created_at"),
                # Test check-ins never write attendance_records, so a student can always check in again.
                "already_checked_in": False,
            }
            for row in rows
        ],
    }


@router.post("/sessions/{session_id}/challenge")
def issue_test_challenge(
    session_id: str,
    current_user: AuthenticatedUser = Depends(require_roles("student")),
):
    """Issue the same one-time check-in right as the QR step, without a QR token."""

    if not current_user.student_id:
        raise HTTPException(status_code=409, detail="บัญชีนี้ยังไม่มีรหัสนักศึกษา กรุณาติดต่อผู้ดูแลระบบ")

    session_res = (
        supabase.table("attendance_sessions")
        .select("id, course_id, status, archived_at, courses(course_code, course_name)")
        .eq("id", session_id)
        .execute()
    )
    if not session_res.data:
        raise HTTPException(status_code=404, detail="ไม่พบคาบเรียนนี้ในระบบ")
    session_row = session_res.data[0]
    if session_row.get("status") != "open" or session_row.get("archived_at"):
        raise HTTPException(status_code=400, detail="คาบเรียนนี้ปิดระบบเช็คชื่อไปแล้ว")
    _require_listed_course(session_row["course_id"])
    require_course_enrollment(session_row["course_id"], current_user.id)

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=TEST_CHALLENGE_SECONDS)
    challenge_response = supabase.table("attendance_checkin_challenges").insert({
        "session_id": session_id,
        "student_id": current_user.id,
        "expires_at": expires_at.isoformat(),
    }).execute()
    if not challenge_response.data:
        raise HTTPException(status_code=500, detail="ไม่สามารถสร้างสิทธิ์เช็คชื่อได้ กรุณาลองใหม่")

    challenge_id = challenge_response.data[0]["id"]
    liveness_challenge = create_attendance_liveness_challenge(
        challenge_id,
        current_user.id,
        session_id,
        expires_at,
    )
    # Never log who asked; the warning only records that the shortcut was used.
    logger.warning("TEST MODE: QR-free attendance challenge issued")
    course_info = session_row.get("courses") or {}
    return {
        "status": "success",
        "session_id": session_id,
        "course_code": course_info.get("course_code"),
        "course_name": course_info.get("course_name"),
        "challenge_id": challenge_id,
        "challenge_expires_at": expires_at.isoformat(),
        "challenge_ttl_seconds": TEST_CHALLENGE_SECONDS,
        "liveness_protocol_version": liveness_challenge.protocol_version,
        "liveness_token": liveness_challenge.token,
        "liveness_mode": liveness_challenge.mode,
        "liveness_sample_count": liveness_challenge.sample_count,
        "liveness_action": liveness_challenge.action,
        "liveness_prompt_delay_ms": liveness_challenge.prompt_delay_ms,
    }
