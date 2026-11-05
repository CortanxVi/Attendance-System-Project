from datetime import datetime, timezone
from typing import Any


# Mirrors the fallback used when scoring check-ins (`late_threshold_minutes or 15`).
DEFAULT_LATE_THRESHOLD_MINUTES = 15


def normalize_late_threshold_minutes(value: Any) -> int:
    """Return a positive whole-minute late threshold, falling back to the default."""
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return DEFAULT_LATE_THRESHOLD_MINUTES
    return minutes if minutes > 0 else DEFAULT_LATE_THRESHOLD_MINUTES


def elapsed_seconds_since(created_at: Any, now: datetime | None = None) -> int:
    """Seconds since a session opened, measured on the server clock (never negative)."""
    if not isinstance(created_at, str) or not created_at:
        return 0
    try:
        opened = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return 0
    if opened.tzinfo is None:
        opened = opened.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    return max(0, int((current - opened).total_seconds()))


def find_active_teacher_session(database: Any, teacher_id: str) -> dict | None:
    """Return the newest open session owned by a teacher, without exposing its QR token."""
    response = (
        database.table("attendance_sessions")
        .select("id, course_id, opened_by, status, created_at")
        .eq("opened_by", teacher_id)
        .eq("status", "open")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None

    session = response.data[0]
    course_response = (
        database.table("courses")
        .select("id, course_code, course_name, section, late_threshold_minutes")
        .eq("id", session["course_id"])
        .limit(1)
        .execute()
    )
    course = course_response.data[0] if course_response.data else {}
    return {
        "id": session["id"],
        "course_id": session["course_id"],
        "course_code": course.get("course_code") or "",
        "course_name": course.get("course_name") or "",
        "section": course.get("section"),
        "created_at": session.get("created_at"),
        "status": session.get("status"),
        # The browser closes the session when this window ends. Elapsed time is
        # measured here so a wrong clock on the teacher's computer cannot shift it.
        "late_threshold_minutes": normalize_late_threshold_minutes(course.get("late_threshold_minutes")),
        "elapsed_seconds": elapsed_seconds_since(session.get("created_at")),
    }
