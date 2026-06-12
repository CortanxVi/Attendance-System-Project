import os
import json
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional, Any
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

admin_router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])

# --- Models ---
class UpdateRoleRequest(BaseModel):
    role: str # 'student', 'teacher', 'admin'
    admin_id: str # รหัสแอดมินที่ทำการแก้ไข (เพื่อเก็บ Log)

class AuditLogRequest(BaseModel):
    admin_id: str
    action: str
    target_type: str
    target_id: str
    details: Optional[Any] = None

# --- Utilities ---
def log_admin_action(admin_id: str, action: str, target_type: str, target_id: str, details: Any = None):
    """ฟังก์ชันช่วยบันทึกประวัติการทำงานของระบบ (Audit Log)"""
    try:
        supabase.table("audit_logs").insert({
            "admin_id": admin_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "details": details
        }).execute()
    except Exception as e:
        print(f"Failed to log admin action: {e}")
        # ไม่โยน Error เพื่อให้การทำงานหลักดำเนินต่อไปได้แม้ Log จะบันทึกไม่สำเร็จ

# --- Endpoints: User Management ---

@admin_router.get("/users")
async def get_all_users():
    """ดึงข้อมูลโปรไฟล์ผู้ใช้ทั้งหมดในระบบ"""
    try:
        # ดึงฟิลด์ที่จำเป็น ไม่เอา face_embedding เพื่อลดขนาดข้อมูล
        response = supabase.table("profiles").select("id, student_id, full_name, role, face_registered, nfc_uid").execute()
        return {"status": "success", "users": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@admin_router.put("/users/{user_id}/role")
async def update_user_role(user_id: str, payload: UpdateRoleRequest):
    """เปลี่ยนสิทธิ์การใช้งาน (Role) ของผู้ใช้"""
    if payload.role not in ['student', 'teacher', 'admin']:
        raise HTTPException(status_code=400, detail="Role ไม่ถูกต้อง")
        
    try:
        # อัปเดตข้อมูล
        response = supabase.table("profiles").update({"role": payload.role}).eq("id", user_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบ")
            
        # บันทึก Log
        log_admin_action(
            admin_id=payload.admin_id,
            action="UPDATE_USER_ROLE",
            target_type="USER",
            target_id=user_id,
            details={"new_role": payload.role}
        )
        
        return {"status": "success", "message": f"เปลี่ยนสิทธิ์เป็น {payload.role} สำเร็จ"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Endpoints: Course Management ---

@admin_router.get("/courses")
async def get_all_courses():
    """ดึงข้อมูลรายวิชาทั้งหมดในระบบ โดยแสดงชื่ออาจารย์ผู้สอนด้วย"""
    try:
        # ใช้ Supabase relational query เพื่อดึงชื่ออาจารย์จาก profiles
        response = supabase.table("courses").select("*, profiles(full_name)").execute()
        return {"status": "success", "courses": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Endpoints: Audit Logs ---

@admin_router.get("/logs")
async def get_audit_logs():
    """ดึงประวัติการทำงานในระบบทั้งหมด"""
    try:
        # ดึงประวัติพร้อมชื่อแอดมินที่ทำรายการ
        response = supabase.table("audit_logs") \
            .select("*, profiles(full_name)") \
            .order("created_at", desc=True) \
            .limit(100) \
            .execute()
        return {"status": "success", "logs": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Endpoints: Export Data ---

@admin_router.get("/export/attendance/{course_id}")
async def get_export_attendance_data(course_id: str):
    """ดึงข้อมูลสำหรับนำไปสร้างไฟล์ Excel/CSV/PDF ที่หน้าบ้าน"""
    try:
        # ดึงข้อมูลวิชา
        course_res = supabase.table("courses").select("*").eq("id", course_id).execute()
        if not course_res.data:
             raise HTTPException(status_code=404, detail="ไม่พบวิชา")
        course = course_res.data[0]

        # ดึงประวัติการเข้าเรียนทั้งหมดของวิชานี้ (Join ข้อมูลเซสชัน และข้อมูลนักศึกษา)
        records_res = supabase.table("attendance_records") \
            .select("check_in_time, status, method, profiles(student_id, full_name), attendance_sessions!inner(course_id)") \
            .eq("attendance_sessions.course_id", course_id) \
            .order("check_in_time", desc=False) \
            .execute()

        # จัดรูปแบบข้อมูลให้ส่งเป็น Array เข้าใจง่าย
        export_data = []
        for r in records_res.data:
            export_data.append({
                "student_id": r["profiles"]["student_id"] if r["profiles"] else "N/A",
                "full_name": r["profiles"]["full_name"] if r["profiles"] else "Unknown",
                "check_in_time": r["check_in_time"],
                "status": r["status"],
                "method": r["method"]
            })

        return {
            "status": "success", 
            "course": course,
            "records": export_data
        }
    except Exception as e:
         raise HTTPException(status_code=500, detail=str(e))
