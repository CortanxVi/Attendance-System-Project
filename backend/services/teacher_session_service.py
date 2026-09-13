from typing import Any


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
        .select("id, course_code, course_name, section")
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
    }
