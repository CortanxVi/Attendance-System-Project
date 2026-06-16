import os
import json
import uuid  # นำเข้าเพื่อใช้สร้าง ID ชั่วคราวให้ผู้ใช้ใหม่
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

# เพิ่ม Model สำหรับรับข้อมูลเมื่อแก้ไขโปรไฟล์ผู้ใช้
class UserInfoRequest(BaseModel):
    student_id: str
    full_name: str
    role: str
    admin_id: str

# เพิ่ม Model สำหรับรับข้อมูลเมื่อสร้างผู้ใช้ใหม่
class CreateUserRequest(BaseModel):
    student_id: str
    full_name: str
    role: str
    admin_id: str

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

# --- Endpoints: User Management ---

@admin_router.get("/users")
async def get_all_users():
    """ดึงข้อมูลโปรไฟล์ผู้ใช้ทั้งหมดในระบบ"""
    try:
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
        response = supabase.table("profiles").update({"role": payload.role}).eq("id", user_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบ")
            
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

# ➕ [เพิ่มใหม่] API สำหรับสร้างผู้ใช้ใหม่ (ตาราง profiles)
@admin_router.post("/users")
async def create_user(payload: CreateUserRequest):
    """เพิ่มผู้ใช้งานใหม่เข้าไปในระบบ"""
    try:
        # Best Practice: ตรวจสอบความปลอดภัย ป้องกันข้อมูลรหัสนักศึกษาซ้ำซ้อน
        if payload.student_id:
            existing = supabase.table("profiles").select("id").eq("student_id", payload.student_id).execute()
            if existing.data:
                raise HTTPException(status_code=400, detail="รหัสนักศึกษา/พนักงานนี้มีอยู่ในระบบแล้ว")
        
        # เจนเนอเรต ID แบบสุ่มขึ้นมาให้กับผู้ใช้ใหม่
        user_id = str(uuid.uuid4())
        new_user = {
            "id": user_id,
            "student_id": payload.student_id,
            "full_name": payload.full_name,
            "role": payload.role,
            "face_registered": False,
            "nfc_uid": None
        }
        
        response = supabase.table("profiles").insert(new_user).execute()
        if not response.data:
            raise HTTPException(status_code=400, detail="ไม่สามารถเพิ่มผู้ใช้งานได้")
            
        # บันทึกประวัติการทำงานลง Audit Logs
        log_admin_action(
            admin_id=payload.admin_id,
            action="CREATE_USER",
            target_type="USER",
            target_id=user_id,
            details={"student_id": payload.student_id, "full_name": payload.full_name, "role": payload.role}
        )
        
        return {"status": "success", "message": "เพิ่มผู้ใช้งานสำเร็จ", "user": response.data[0]}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🛠️ [ซ่อมแซม & ปรับปรุง] API สำหรับแก้ไขรายละเอียดผู้ใช้งาน
@admin_router.put("/users/{user_id}/info")
async def update_user_info(user_id: str, payload: UserInfoRequest):
    """แก้ไขข้อมูลรายละเอียดของผู้ใช้ (รหัส, ชื่อ-นามสกุล, สิทธิ์)"""
    try:
        # ตรวจสอบรหัสนักศึกษาซ้ำ (ยกเว้นตัวของเขาเอง)
        if payload.student_id:
            existing = supabase.table("profiles").select("id").eq("student_id", payload.student_id).neq("id", user_id).execute()
            if existing.data:
                raise HTTPException(status_code=400, detail="รหัสนักศึกษา/พนักงานนี้ถูกใช้งานโดยผู้ใช้อื่นแล้ว")

        update_data = {
            "student_id": payload.student_id,
            "full_name": payload.full_name,
            "role": payload.role
        }
        
        response = supabase.table("profiles").update(update_data).eq("id", user_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบ")
            
        # บันทึกประวัติการทำงานลง Audit Logs
        log_admin_action(
            admin_id=payload.admin_id,
            action="UPDATE_USER_INFO",
            target_type="USER",
            target_id=user_id,
            details=update_data
        )
        
        return {"status": "success", "message": "แก้ไขข้อมูลผู้ใช้งานสำเร็จ"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ❌ [เพิ่มใหม่] API สำหรับลบผู้ใช้งาน
@admin_router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin_id: str):
    """ลบผู้ใช้งานออกจากระบบ"""
    try:
        response = supabase.table("profiles").delete().eq("id", user_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบหรือลบไม่สำเร็จ")
            
        # บันทึกประวัติการทำงานลง Audit Logs
        log_admin_action(
            admin_id=admin_id,
            action="DELETE_USER",
            target_type="USER",
            target_id=user_id,
            details=None
        )
        
        return {"status": "success", "message": "ลบผู้ใช้งานออกจากระบบสำเร็จ"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Endpoints: Course Management ---

@admin_router.get("/courses")
async def get_all_courses():
    """ดึงข้อมูลรายวิชาทั้งหมดในระบบ โดยแสดงชื่ออาจารย์ผู้สอนด้วย"""
    try:
        response = supabase.table("courses").select("*, profiles(full_name)").execute()
        return {"status": "success", "courses": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Endpoints: Audit Logs ---

@admin_router.get("/logs")
async def get_audit_logs():
    """ดึงประวัติการทำงานในระบบทั้งหมด (อิงตาม schema ใหม่)"""
    try:
        response = supabase.table("audit_logs") \
            .select("*") \
            .order("created_at", desc=True) \
            .limit(100) \
            .execute()
            
        logs = response.data
        if not logs:
            return {"status": "success", "logs": []}

        admin_ids = list(set([log["admin_id"] for log in logs if log.get("admin_id")]))

        profiles_dict = {}
        if admin_ids:
            profiles_res = supabase.table("profiles").select("id, full_name").in_("id", admin_ids).execute()
            profiles_dict = {p["id"]: p for p in profiles_res.data}

        for log in logs:
            aid = log.get("admin_id")
            log["profiles"] = profiles_dict.get(aid, {"full_name": "System / Unknown"})

        return {"status": "success", "logs": logs}
        
    except Exception as e:
        print(f"DEBUG: Error fetching audit logs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Endpoints: Export Data ---

@admin_router.get("/export/attendance/{course_id}")
async def get_export_attendance_data(course_id: str):
    """ดึงข้อมูลสำหรับนำไปสร้างไฟล์ Excel/CSV/PDF ที่หน้าบ้าน"""
    try:
        course_res = supabase.table("courses").select("*").eq("id", course_id).execute()
        if not course_res.data:
             raise HTTPException(status_code=404, detail="ไม่พบวิชา")
        course = course_res.data[0]

        records_res = supabase.table("attendance_records") \
            .select("check_in_time, status, method, profiles(student_id, full_name), attendance_sessions!inner(course_id)") \
            .eq("attendance_sessions.course_id", course_id) \
            .order("check_in_time", desc=False) \
            .execute()

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