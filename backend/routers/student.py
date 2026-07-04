import os
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

student_router = APIRouter(prefix="/api/v1/student", tags=["Student"])

@student_router.get("/history/{student_uuid}")
async def get_student_attendance_history(student_uuid: str):
    """ดึงประวัติการเข้าเรียนทั้งหมดของนักศึกษา (ใช้ UUID ของ profile)"""
    try:
        # ดึงข้อมูลการเข้าเรียน พร้อม join กับ session และ course
        # attendance_records -> attendance_sessions -> courses
        response = supabase.table("attendance_records") \
            .select("*, attendance_sessions(id, created_at, closed_at, courses(id, course_code, course_name))") \
            .eq("student_id", student_uuid) \
            .order("check_in_time", desc=True) \
            .execute()
        
        records = response.data
        if not records:
            return {"status": "success", "history": [], "stats": {"present": 0, "late": 0, "absent": 0}}
        
        # จัดรูปแบบข้อมูลให้หน้าบ้านใช้งานง่ายขึ้น
        history = []
        stats = {"present": 0, "late": 0, "absent": 0}
        
        for record in records:
            session = record.get("attendance_sessions") or {}
            course = session.get("courses") or {}
            
            # นับสถิติ
            rec_status = record.get("status")
            if rec_status in stats:
                stats[rec_status] += 1
                
            history.append({
                "id": record.get("id"),
                "check_in_time": record.get("check_in_time"),
                "status": rec_status,
                "method": record.get("method"),
                "similarity_score": record.get("similarity_score"),
                "course_code": course.get("course_code", "N/A"),
                "course_name": course.get("course_name", "Unknown Course"),
                "session_date": session.get("created_at")
            })
            
        return {
            "status": "success",
            "history": history,
            "stats": stats
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
