from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from core.config import supabase_db as supabase
from core.security import AuthenticatedUser, require_roles

student_router = APIRouter(
    prefix="/api/v1/students",
    tags=["Student"],
    dependencies=[Depends(require_roles("student", "admin"))],
)


@student_router.get("/me/profile")
async def get_my_student_profile(
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("student"))],
):
    """Return only the signed-in student's own profile and registration status."""
    try:
        profile_response = supabase.table("profiles").select(
            "id, email, student_id, full_name, academic_year, class_level, face_registered, nfc_uid, created_at"
        ).eq("id", current_user.id).eq("role", "student").limit(1).execute()
        if not profile_response.data:
            raise HTTPException(status_code=404, detail="ไม่พบโปรไฟล์นักศึกษา")
        enrollment_response = supabase.table("enrollments").select(
            "course_id", count="exact"
        ).eq("student_id", current_user.id).execute()
        profile = profile_response.data[0]
        profile["nfc_registered"] = bool(profile.pop("nfc_uid", None))
        profile["enrolled_course_count"] = enrollment_response.count or 0
        return {"status": "success", "profile": profile}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="ไม่สามารถโหลดโปรไฟล์นักศึกษาได้") from exc


# --- Endpoint: ดูประวัติการเข้าเรียนของตนเอง + สถิติสรุปรายวิชา ---

@student_router.get("/{student_uuid}/attendance-history")
async def get_student_attendance_history(
    student_uuid: str,
    current_user: Annotated[
        AuthenticatedUser,
        Depends(require_roles("student", "admin")),
    ],
):
    """
    ดึงประวัติการเช็คชื่อทั้งหมดของนักศึกษา 1 คน พร้อมสรุปสถิติเป็นรายวิชา
    (ตรงตาม requirement 4.1.1: "สามารถดูประวัติการเข้าเรียนของตนเองย้อนหลังพร้อมสถิติสรุปได้")

    student_uuid = profiles.id (ตัวเดียวกับ Supabase Auth user id ที่ได้ตอน login)

    รายวิชาที่แสดงมาจาก enrollments และประวัติจริง จึงยังเห็นวิชาที่ลงทะเบียนไว้
    แม้จะยังไม่มีรายการเช็คชื่อสำเร็จ
    """
    try:
        if current_user.role != "admin" and student_uuid != current_user.id:
            raise HTTPException(status_code=403, detail="ดูประวัติการเข้าเรียนได้เฉพาะบัญชีของตนเอง")
        # 1. ตรวจสอบว่ามีนักศึกษาคนนี้อยู่จริงในระบบไหม
        student_res = supabase.table('profiles') \
            .select('id, student_id, full_name') \
            .eq('id', student_uuid) \
            .execute()

        if not student_res.data:
            raise HTTPException(status_code=404, detail="ไม่พบข้อมูลนักศึกษาในระบบ")

        student_info = student_res.data[0]

        enrollments_res = supabase.table('enrollments') \
            .select('courses(id, course_code, course_name, total_sessions, max_absence_percent)') \
            .eq('student_id', student_uuid) \
            .execute()

        course_stats: dict = {}
        for enrollment in enrollments_res.data or []:
            course = enrollment.get('courses') or {}
            course_id = course.get('id')
            if not course_id:
                continue
            course_stats[course_id] = {
                "course_id": course_id,
                "course_code": course.get('course_code', '-'),
                "course_name": course.get('course_name', 'ไม่ทราบชื่อวิชา'),
                "total_sessions": course.get('total_sessions') or 0,
                "max_absence_percent": course.get('max_absence_percent') or 0,
                "present": 0,
                "late": 0,
                "absent": 0,
            }

        # 2. ดึงประวัติเช็คชื่อทั้งหมดของนักศึกษาคนนี้ พร้อมข้อมูลวิชาที่ผูกไว้ผ่าน session
        #    (ไม่ใส่ !inner ตรง attendance_sessions เพราะต้องการให้ยังเห็นแถวที่ไม่มี session_id ด้วย)
        records_res = supabase.table('attendance_records') \
            .select(
                'check_in_time, status, method, '
                'attendance_sessions(course_id, courses(id, course_code, course_name, total_sessions, max_absence_percent))'
            ) \
            .eq('student_id', student_uuid) \
            .order('check_in_time', desc=True) \
            .execute()

        records = records_res.data or []

        # 3. ไล่ทีละแถว: เก็บลง history list (ดิบ) และรวมยอดสถิติต่อวิชา (course_stats)
        history_list = []
        for rec in records:
            session_info = rec.get('attendance_sessions') or {}
            course = session_info.get('courses') or {}
            course_id = course.get('id')

            history_list.append({
                "course_code": course.get('course_code', '-'),
                "course_name": course.get('course_name', 'ไม่ทราบชื่อวิชา'),
                "check_in_time": rec['check_in_time'],
                "status": rec['status'],
                "method": rec['method'],
            })

            # ข้ามแถวที่ไม่รู้ว่าเป็นวิชาไหน ไม่นำไปรวมสถิติ (แต่ยังอยู่ใน history_list ด้านบนแล้ว)
            if not course_id:
                continue

            if course_id not in course_stats:
                course_stats[course_id] = {
                    "course_id": course_id,
                    "course_code": course.get('course_code', '-'),
                    "course_name": course.get('course_name', 'ไม่ทราบชื่อวิชา'),
                    "total_sessions": course.get('total_sessions') or 0,
                    "max_absence_percent": course.get('max_absence_percent') or 0,
                    "present": 0,
                    "late": 0,
                    "absent": 0,
                }

            status_key = rec['status']
            # นับเฉพาะสถานะที่มีอยู่จริงตาม schema (present, late, absent) — 'pending' ไม่นับเป็นการมา/ขาด
            if status_key in course_stats[course_id]:
                course_stats[course_id][status_key] += 1

        # 4. คำนวณเปอร์เซ็นต์ขาดเรียนและประเมินผล (Fa/Normal) ต่อวิชา ด้วยสูตรเดียวกับฝั่งอาจารย์
        course_summary = []
        for stat in course_stats.values():
            total_sessions = stat["total_sessions"] or 1  # ป้องกันหารด้วย 0 กรณียังไม่ตั้งค่า
            allowed_absent = total_sessions * (stat["max_absence_percent"] / 100)
            absence_rate = round((stat["absent"] / total_sessions) * 100, 2)
            evaluation = "Fa" if stat["absent"] > allowed_absent else "Normal"

            course_summary.append({
                **stat,
                "absence_percentage": absence_rate,
                "evaluation": evaluation,
            })

        return {
            "status": "success",
            "student": {
                "student_id": student_info.get('student_id'),
                "full_name": student_info.get('full_name'),
            },
            "course_summary": course_summary,
            "history": history_list,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e
