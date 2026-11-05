"""Guards against creating the same course/section twice for one teacher."""

from fastapi import HTTPException

# Postgres error code for "unique constraint violated" (also raised by unique indexes).
UNIQUE_VIOLATION_CODE = "23505"


def is_unique_violation(error: Exception) -> bool:
    """True when a Supabase/Postgres error means a unique index rejected the write."""
    if getattr(error, "code", None) == UNIQUE_VIOLATION_CODE:
        return True
    return UNIQUE_VIOLATION_CODE in str(error)


def ensure_course_not_duplicate(
    client,
    *,
    teacher_id: str,
    course_code: str,
    section: int,
    year: int,
    semester: int,
    exclude_course_id: str | None = None,
) -> None:
    """Reject a second course with the same code + section + year + semester for a teacher.

    Only the same teacher is blocked: team-taught sections are legitimate, and
    each course row keeps its own roster, so they never share a QR code.
    The course code is compared ignoring case and surrounding spaces. This is
    done in Python (not with ilike) so characters like "_" or "%" in a course
    code can never act as wildcards.
    """
    wanted_code = course_code.strip().casefold()
    response = (
        client.table("courses")
        .select("id, course_code")
        .eq("teacher_id", teacher_id)
        .eq("section", section)
        .eq("year", year)
        .eq("semester", semester)
        .execute()
    )
    for row in response.data or []:
        if exclude_course_id is not None and row.get("id") == exclude_course_id:
            continue
        if (row.get("course_code") or "").strip().casefold() == wanted_code:
            raise HTTPException(
                status_code=409,
                detail="มีรายวิชานี้ (รหัสวิชา กลุ่มเรียน ปีการศึกษา และภาคเรียนเดียวกัน) อยู่แล้ว",
            )
