from fastapi import HTTPException

from core.config import supabase_db
from core.security import AuthenticatedUser


def require_owned_course(course_id: str, current_user: AuthenticatedUser) -> dict:
    response = (
        supabase_db.table("courses")
        .select("id, teacher_id, course_code, course_name")
        .eq("id", course_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบรายวิชานี้ในระบบ")
    course = response.data[0]
    if current_user.role != "admin" and course.get("teacher_id") != current_user.id:
        raise HTTPException(status_code=403, detail="คุณไม่ใช่อาจารย์เจ้าของรายวิชานี้")
    return course


def require_owned_session(session_id: str, current_user: AuthenticatedUser) -> dict:
    response = (
        supabase_db.table("attendance_sessions")
        .select("id, course_id, opened_by, status, created_at")
        .eq("id", session_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบคาบเรียนนี้ในระบบ")
    session = response.data[0]
    if current_user.role != "admin" and session.get("opened_by") != current_user.id:
        raise HTTPException(status_code=403, detail="คุณไม่ใช่เจ้าของคาบเรียนนี้")
    return session


def require_course_enrollment(course_id: str, student_id: str) -> None:
    """Fail closed unless the authenticated student belongs to the course roster."""
    response = (
        supabase_db.table("enrollments")
        .select("course_id")
        .eq("course_id", course_id)
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=403, detail="นักศึกษาไม่ได้ลงทะเบียนในรายวิชานี้")


def require_course_delete_permission(
    course: dict,
    current_user: AuthenticatedUser,
) -> None:
    """Temporary elevation never grants destructive access to another owner."""
    if current_user.temporary_admin and course.get("teacher_id") != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="สิทธิ์ชั่วคราวไม่สามารถลบรายวิชาของอาจารย์คนอื่น",
        )
