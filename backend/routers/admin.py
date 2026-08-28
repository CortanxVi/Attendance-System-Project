import re
from typing import Annotated, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from core.config import supabase_db as supabase
from core.security import (
    AuthenticatedUser,
    get_current_user,
    require_permanent_admin,
    require_roles,
)

admin_router = APIRouter(
    prefix="/api/v1/admin",
    tags=["Admin"],
    dependencies=[Depends(require_roles("admin"))],
)

# --- Models ---
class UpdateRoleRequest(BaseModel):
    role: str # 'student', 'teacher', 'admin'

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ['student', 'teacher', 'admin']:
            raise ValueError("Role ต้องเป็น 'student', 'teacher' หรือ 'admin' เท่านั้น")
        return v

# เพิ่ม Model สำหรับรับข้อมูลเมื่อแก้ไขโปรไฟล์ผู้ใช้
class UserInfoRequest(BaseModel):
    student_id: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    academic_year: Optional[int] = None
    class_level: Optional[str] = None

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v is not None and v not in ['student', 'teacher', 'admin']:
            raise ValueError("Role ต้องเป็น 'student', 'teacher' หรือ 'admin' เท่านั้น")
        return v

    @field_validator('academic_year')
    @classmethod
    def validate_academic_year(cls, value):
        if value is not None and not 1 <= value <= 8:
            raise ValueError("ชั้นปีต้องอยู่ระหว่าง 1–8")
        return value

    @field_validator('class_level')
    @classmethod
    def validate_class_level(cls, value):
        cleaned = value.strip() if value else None
        if cleaned and len(cleaned) > 50:
            raise ValueError("ห้องเรียนต้องไม่เกิน 50 ตัวอักษร")
        return cleaned

# เพิ่ม Model สำหรับรับข้อมูลเมื่อสร้างผู้ใช้ใหม่
class CreateUserRequest(BaseModel):
    email: str
    student_id: str
    full_name: str
    role: str
    academic_year: Optional[int] = None
    class_level: Optional[str] = None

    _academic_year = field_validator('academic_year')(UserInfoRequest.validate_academic_year.__func__)
    _class_level = field_validator('class_level')(UserInfoRequest.validate_class_level.__func__)

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ['student', 'teacher', 'admin']:
            raise ValueError("Role ต้องเป็น 'student', 'teacher' หรือ 'admin' เท่านั้น")
        return v

    @field_validator('email')
    @classmethod
    def validate_email(cls, value):
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^@]+@(?:[a-z0-9-]+\.)*kmutnb\.ac\.th", normalized):
            raise ValueError("ต้องใช้อีเมลโดเมน KMUTNB เท่านั้น")
        return normalized

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
        response = supabase.table("profiles").select("id, email, student_id, full_name, role, academic_year, class_level, face_registered, nfc_uid").execute()
        invites = supabase.table("profile_invites").select("id, email, student_id, full_name, role, academic_year, class_level, claimed_at").is_("claimed_at", "null").execute()
        pending_users = [
            {**invite, "face_registered": False, "nfc_uid": None, "pending_invite": True}
            for invite in (invites.data or [])
        ]
        return {"status": "success", "users": [*(response.data or []), *pending_users]}
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

@admin_router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    payload: UpdateRoleRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_permanent_admin)],
):
    """เปลี่ยนสิทธิ์การใช้งาน (Role) ของผู้ใช้"""
    try:
        response = supabase.table("profiles").update({"role": payload.role}).eq("id", user_id).execute()
        if not response.data:
            response = supabase.table("profile_invites").update({"role": payload.role}).eq("id", user_id).is_("claimed_at", "null").execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบ")
            
        log_admin_action(
            admin_id=current_user.id,
            action="UPDATE_USER_ROLE",
            target_type="USER",
            target_id=user_id,
            details={"new_role": payload.role}
        )
        
        return {"status": "success", "message": f"เปลี่ยนสิทธิ์เป็น {payload.role} สำเร็จ"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# API สำหรับสร้างผู้ใช้ใหม่ (ตาราง profiles)
@admin_router.post("/users")
async def create_user(
    payload: CreateUserRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """เพิ่มผู้ใช้งานใหม่เข้าไปในระบบ"""
    try:
        if payload.role == "admin" and current_user.base_role != "admin":
            raise HTTPException(
                status_code=403,
                detail="การสร้างบัญชีผู้ดูแลต้องดำเนินการโดยผู้ดูแลระบบถาวร",
            )
        profile_by_id = supabase.table("profiles").select("id").eq("student_id", payload.student_id).execute()
        profile_by_email = supabase.table("profiles").select("id").eq("email", payload.email).execute()
        existing_invite = supabase.table("profile_invites").select("id").eq("email", payload.email).execute()
        if profile_by_id.data or profile_by_email.data or existing_invite.data:
            raise HTTPException(status_code=409, detail="อีเมลหรือรหัสนี้มีบัญชี/คำเชิญอยู่แล้ว")

        new_user = {
            "email": payload.email,
            "student_id": payload.student_id,
            "full_name": payload.full_name,
            "role": payload.role,
            "invited_by": current_user.id,
            "academic_year": payload.academic_year,
            "class_level": payload.class_level,
        }
        
        response = supabase.table("profile_invites").insert(new_user).execute()
        if not response.data:
            raise HTTPException(status_code=400, detail="ไม่สามารถเพิ่มผู้ใช้งานได้")
            
        log_admin_action(
            admin_id=current_user.id,
            action="CREATE_USER",
            target_type="USER",
            target_id=response.data[0]["id"],
            details={"email": payload.email, "student_id": payload.student_id, "full_name": payload.full_name, "role": payload.role}
        )
        
        return {"status": "success", "message": "สร้างคำเชิญบัญชีสำเร็จ", "user": response.data[0]}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# API สำหรับแก้ไขรายละเอียดผู้ใช้งาน
@admin_router.put("/users/{user_id}/info")
async def update_user_info(
    user_id: str,
    payload: UserInfoRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """แก้ไขข้อมูลรายละเอียดของผู้ใช้ (รหัส, ชื่อ-นามสกุล, สิทธิ์)"""
    try:
        target = supabase.table("profiles").select("role").eq("id", user_id).limit(1).execute()
        target_role = target.data[0].get("role") if target.data else None
        if current_user.temporary_admin and (payload.role is not None or target_role == "admin"):
            raise HTTPException(
                status_code=403,
                detail="สิทธิ์ชั่วคราวไม่สามารถแก้ไข role หรือบัญชีผู้ดูแลถาวร",
            )
        if payload.student_id:
            existing = supabase.table("profiles").select("id").eq("student_id", payload.student_id).neq("id", user_id).execute()
            if existing.data:
                raise HTTPException(status_code=400, detail="รหัสนักศึกษา/พนักงานนี้ถูกใช้งานโดยผู้ใช้อื่นแล้ว")

        update_data = {}
        if payload.student_id is not None:
            update_data["student_id"] = payload.student_id
        if payload.full_name is not None:
            update_data["full_name"] = payload.full_name
        if payload.role is not None:
            update_data["role"] = payload.role
        if "academic_year" in payload.model_fields_set:
            update_data["academic_year"] = payload.academic_year
        if "class_level" in payload.model_fields_set:
            update_data["class_level"] = payload.class_level

        if not update_data:
             return {"status": "success", "message": "ไม่มีข้อมูลให้แก้ไข"}
        
        response = supabase.table("profiles").update(update_data).eq("id", user_id).execute()
        if not response.data:
            response = supabase.table("profile_invites").update(update_data).eq("id", user_id).is_("claimed_at", "null").execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบ")
            
        log_admin_action(
            admin_id=current_user.id,
            action="UPDATE_USER_INFO",
            target_type="USER",
            target_id=user_id,
            details=update_data
        )
        
        return {"status": "success", "message": "แก้ไขข้อมูลผู้ใช้งานสำเร็จ"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# API สำหรับลบผู้ใช้งาน
@admin_router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(require_permanent_admin)],
):
    """ลบผู้ใช้งานออกจากระบบ"""
    try:
        if user_id == current_user.id:
            raise HTTPException(status_code=400, detail="ไม่สามารถลบบัญชีผู้ดูแลที่กำลังใช้งานอยู่")
        response = supabase.table("profiles").delete().eq("id", user_id).execute()
        if not response.data:
            response = supabase.table("profile_invites").delete().eq("id", user_id).is_("claimed_at", "null").execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบหรือลบไม่สำเร็จ")
            
        log_admin_action(
            admin_id=current_user.id,
            action="DELETE_USER",
            target_type="USER",
            target_id=user_id,
            details=None
        )
        
        return {"status": "success", "message": "ลบผู้ใช้งานออกจากระบบสำเร็จ"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e


# --- Endpoints: Course Management ---

@admin_router.get("/courses")
async def get_all_courses():
    """ดึงข้อมูลรายวิชาทั้งหมดในระบบ โดยแสดงชื่ออาจารย์ผู้สอนด้วย"""
    try:
        response = supabase.table("courses").select("*, profiles(full_name)").execute()
        return {"status": "success", "courses": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# ❌ [เพิ่มใหม่ตามโครงสร้างหน้าบ้าน] API สำหรับลบรายวิชาในฐานะ Admin
@admin_router.delete("/courses/{course_id}")
async def delete_course(
    course_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(require_permanent_admin)],
):
    """ลบรายวิชาออกจากระบบโดยสิทธิ์ Admin (รวมถึงประวัติการลงเวลาเรียนที่ผูกกับวิชานี้)"""
    try:
        # 1. ค้นหาข้อมูลวิชาก่อนลบ เพื่อใช้บันทึกใน Audit Log
        course_res = supabase.table("courses").select("course_code, course_name").eq("id", course_id).execute()
        if not course_res.data:
            raise HTTPException(status_code=404, detail="ไม่พบรายวิชานี้ในระบบ")
        
        course_info = course_res.data[0]
        
        # 2. ทำการลบข้อมูลวิชาออก (ตารางที่มี Foreign Key Cascade จะโดนลบตามอัตโนมัติ)
        response = supabase.table("courses").delete().eq("id", course_id).execute()
        if not response.data:
            raise HTTPException(status_code=400, detail="ไม่สามารถลบรายวิชาได้")
            
        # 3. บันทึกประวัติการทำงานของแอดมินลง Audit Logs
        log_admin_action(
            admin_id=current_user.id,
            action="DELETE_COURSE",
            target_type="COURSE",
            target_id=course_id,
            details={"course_code": course_info["course_code"], "course_name": course_info["course_name"]}
        )
        
        return {"status": "success", "message": f"ลบรายวิชา {course_info['course_code']} ออกจากระบบเรียบร้อยแล้ว"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e


# --- Endpoints: Audit Logs ---

@admin_router.get("/logs")
async def get_audit_logs():
    """ดึงประวัติการทำงานในระบบทั้งหมด"""
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
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

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
         raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e
