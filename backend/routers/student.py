import os
from fastapi import APIRouter, HTTPException
from supabase import create_client, Client
from dotenv import load_dotenv

# 📌 หมายเหตุ: ตอนนี้ยังสร้าง Supabase client แยกไว้ในไฟล์นี้เหมือนกับ routers/admin.py และ main.py
# (ในโปรเจกต์นี้ยังไม่ได้รวมจุดเชื่อมต่อ Supabase ไว้ที่เดียว — เป็นเรื่องที่ควรทำความสะอาดในอนาคต
#  แต่ยังไม่แก้ตรงนี้ตอนนี้ เพื่อไม่ให้ปนกับงาน Step นี้)
load_dotenv()
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

student_router = APIRouter(prefix="/api/v1/students", tags=["Student"])


# --- Endpoint: ดูประวัติการเข้าเรียนของตนเอง + สถิติสรุปรายวิชา ---

@student_router.get("/{student_uuid}/attendance-history")
async def get_student_attendance_history(student_uuid: str):
    """
    ดึงประวัติการเช็คชื่อทั้งหมดของนักศึกษา 1 คน พร้อมสรุปสถิติเป็นรายวิชา
    (ตรงตาม requirement 4.1.1: "สามารถดูประวัติการเข้าเรียนของตนเองย้อนหลังพร้อมสถิติสรุปได้")

    student_uuid = profiles.id (ตัวเดียวกับ Supabase Auth user id ที่ได้ตอน login)

    ⚠️ ข้อจำกัดที่ควรรู้:
    1. ระบบนี้ยังไม่มีการใช้งานตาราง 'enrollments' (รายชื่อนักศึกษาที่ลงเรียนแต่ละวิชา)
       ดังนั้นวิชาที่จะเห็นในสรุปนี้ คือ "วิชาที่มีประวัติเช็คชื่ออย่างน้อย 1 ครั้ง" เท่านั้น
       ถ้านักศึกษาขาดเรียนวิชาใดวิชาหนึ่งทุกครั้งเลย (ไม่เคยเช็คชื่อผ่านเลยสักครั้ง) วิชานั้นจะไม่ปรากฏในสรุปนี้
    2. ประวัติที่ "ไม่ได้ผูก session" ไว้ (เช่น บั๊กเดิมของ endpoint /api/v1/attendance/verify ที่ไม่ได้บันทึก
       session_id) จะยังโชว์ในรายการ history ได้ (โชว์ชื่อวิชาว่า "ไม่ทราบชื่อวิชา") แต่จะไม่ถูกนำไปคำนวณ
       สถิติรายวิชา เพราะไม่รู้ว่าเป็นวิชาไหน
    """
    try:
        # 1. ตรวจสอบว่ามีนักศึกษาคนนี้อยู่จริงในระบบไหม
        student_res = supabase.table('profiles') \
            .select('id, student_id, full_name') \
            .eq('id', student_uuid) \
            .execute()

        if not student_res.data:
            raise HTTPException(status_code=404, detail="ไม่พบข้อมูลนักศึกษาในระบบ")

        student_info = student_res.data[0]

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
        course_stats: dict = {}

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
        raise HTTPException(status_code=500, detail=str(e))
