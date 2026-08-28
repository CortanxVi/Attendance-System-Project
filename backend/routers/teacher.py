import csv
import io
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile
from pydantic import BaseModel, field_validator

from services.attendance_export_service import export_service
from core.authorization import require_course_enrollment, require_owned_course, require_owned_session
from core.config import supabase_db as supabase
from core.security import AuthenticatedUser, require_roles

teacher_router = APIRouter(
    prefix="/api/v1/teacher",
    tags=["Teacher"],
    dependencies=[Depends(require_roles("teacher", "admin"))],
)

@teacher_router.get("/export/attendance/{course_id}")
async def get_teacher_export_attendance(
    course_id: str,
    current_user: Annotated[
        AuthenticatedUser,
        Depends(require_roles("teacher", "admin")),
    ],
):
    """ดึงข้อมูลสำหรับการ Export รายงานสำหรับอาจารย์"""
    try:
        require_owned_course(course_id, current_user)
        data, error = export_service.get_export_data(course_id)
        if error:
            raise HTTPException(status_code=404, detail=error)
            
        return {
            "status": "success",
            "course": data["course"],
            "records": data["records"],
            "sessions": data.get("sessions", []),
            "students": data.get("students", []),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

class ManualAttendanceUpdate(BaseModel):
    status: str # present, late, absent

@teacher_router.put("/attendance/{record_id}")
async def update_attendance_manual(
    record_id: str,
    payload: ManualAttendanceUpdate,
    current_user: Annotated[
        AuthenticatedUser,
        Depends(require_roles("teacher", "admin")),
    ],
):
    """แก้ไขสถานะการเข้าเรียนแบบ Manual (กรณีระบบผิดพลาด)"""
    try:
        if payload.status not in ["present", "late", "absent"]:
            raise HTTPException(status_code=400, detail="สถานะไม่ถูกต้อง")
        record = supabase.table("attendance_records").select("session_id").eq("id", record_id).execute()
        if not record.data or not record.data[0].get("session_id"):
            raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการเช็คชื่อ")
        require_owned_session(record.data[0]["session_id"], current_user)
            
        update_data = {
            "status": payload.status,
            "method": "manual"
        }
        
        response = supabase.table("attendance_records").update(update_data).eq("id", record_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการเช็คชื่อ")
            
        return {"status": "success", "message": "อัปเดตสถานะสำเร็จ", "data": response.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

class ManualAttendanceCreate(BaseModel):
    student_id: str
    session_id: str
    status: str

@teacher_router.post("/attendance")
async def create_attendance_manual(
    payload: ManualAttendanceCreate,
    current_user: Annotated[
        AuthenticatedUser,
        Depends(require_roles("teacher", "admin")),
    ],
):
    """เพิ่มข้อมูลการเข้าเรียนแบบ Manual (กรณีไม่มีข้อมูลเลย)"""
    try:
        if payload.status not in ["present", "late", "absent"]:
            raise HTTPException(status_code=400, detail="สถานะไม่ถูกต้อง")
        session = require_owned_session(payload.session_id, current_user)
            
        # ตรวจสอบว่ามี user หรือไม่
        profile_res = supabase.table("profiles").select("id").eq("student_id", payload.student_id).execute()
        if not profile_res.data:
            raise HTTPException(status_code=404, detail="ไม่พบนักศึกษาในระบบ")
        require_course_enrollment(
            session["course_id"],
            profile_res.data[0]["id"],
        )
            
        insert_data = {
            "student_id": profile_res.data[0]["id"],
            "session_id": payload.session_id,
            "status": payload.status,
            "method": "manual"
        }
        
        response = supabase.table("attendance_records").insert(insert_data).execute()
        return {"status": "success", "message": "เพิ่มข้อมูลสำเร็จ", "data": response.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e


class RosterStudentCreate(BaseModel):
    email: str
    student_id: str
    full_name: str
    academic_year: int | None = None
    class_level: str | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^@]+@email\.kmutnb\.ac\.th", normalized):
            raise ValueError("ต้องใช้อีเมลนักศึกษา @email.kmutnb.ac.th")
        return normalized

    @field_validator("student_id")
    @classmethod
    def validate_student_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not re.fullmatch(r"[0-9]{13}", cleaned):
            raise ValueError("รหัสนักศึกษาต้องเป็นตัวเลข 13 หลัก")
        return cleaned

    @field_validator("full_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not 2 <= len(cleaned) <= 150:
            raise ValueError("ชื่อ-นามสกุลต้องมีความยาว 2–150 ตัวอักษร")
        return cleaned

    @field_validator("academic_year")
    @classmethod
    def validate_year(cls, value: int | None) -> int | None:
        if value is not None and not 1 <= value <= 8:
            raise ValueError("ชั้นปีต้องอยู่ระหว่าง 1–8")
        return value

    @field_validator("class_level")
    @classmethod
    def validate_class(cls, value: str | None) -> str | None:
        cleaned = value.strip() if value else None
        if cleaned and len(cleaned) > 50:
            raise ValueError("ห้องเรียนต้องไม่เกิน 50 ตัวอักษร")
        return cleaned


class RosterStudentUpdate(BaseModel):
    full_name: str
    academic_year: int | None = None
    class_level: str | None = None

    _name = field_validator("full_name")(RosterStudentCreate.validate_name.__func__)
    _year = field_validator("academic_year")(RosterStudentCreate.validate_year.__func__)
    _class = field_validator("class_level")(RosterStudentCreate.validate_class.__func__)


@teacher_router.get("/courses/{course_id}/roster")
async def get_course_roster(
    course_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
    page: int = 1,
    page_size: int = 25,
    search: str = "",
):
    require_owned_course(course_id, current_user)
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    enrollments = supabase.table("enrollments").select("student_id").eq("course_id", course_id).limit(1000).execute()
    student_ids = [row["student_id"] for row in (enrollments.data or [])]
    profiles = []
    if student_ids:
        result = supabase.table("profiles").select(
            "id, email, student_id, full_name, academic_year, class_level"
        ).in_("id", student_ids).eq("role", "student").execute()
        profiles = [{**row, "roster_kind": "active"} for row in (result.data or [])]

    links = supabase.table("profile_invite_courses").select("invite_id").eq("course_id", course_id).limit(1000).execute()
    invite_ids = [row["invite_id"] for row in (links.data or [])]
    invites = []
    if invite_ids:
        result = supabase.table("profile_invites").select(
            "id, email, student_id, full_name, academic_year, class_level"
        ).in_("id", invite_ids).is_("claimed_at", "null").eq("role", "student").execute()
        invites = [{**row, "roster_kind": "pending"} for row in (result.data or [])]

    needle = search.strip().casefold()
    all_rows = profiles + invites
    if needle:
        all_rows = [row for row in all_rows if needle in " ".join(str(row.get(key) or "") for key in ("full_name", "student_id", "email")).casefold()]
    all_rows.sort(key=lambda row: (str(row.get("student_id") or ""), str(row.get("full_name") or "")))
    total = len(all_rows)
    start = (page - 1) * page_size
    return {"status": "success", "students": all_rows[start:start + page_size], "page": page, "page_size": page_size, "total": total}


@teacher_router.post("/courses/{course_id}/roster", status_code=201)
async def add_course_roster_student(
    course_id: str,
    payload: RosterStudentCreate,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    require_owned_course(course_id, current_user)
    profile_by_id = supabase.table("profiles").select("id, email, student_id, role").eq("student_id", payload.student_id).limit(1).execute()
    profile_by_email = supabase.table("profiles").select("id, email, student_id, role").eq("email", payload.email).limit(1).execute()
    profile = (profile_by_id.data or profile_by_email.data or [None])[0]
    if profile:
        if profile.get("role") != "student" or profile.get("email", "").lower() != payload.email or profile.get("student_id") != payload.student_id:
            raise HTTPException(status_code=409, detail="อีเมลหรือรหัสนักศึกษาตรงกับบัญชีอื่น")
        response = supabase.table("enrollments").upsert(
            {"course_id": course_id, "student_id": profile["id"]}, on_conflict="course_id,student_id"
        ).execute()
        return {"status": "success", "message": "เพิ่มนักศึกษาในรายวิชาแล้ว", "roster_kind": "active", "data": response.data[0] if response.data else None}

    invite_email = supabase.table("profile_invites").select("id, email, student_id, role").eq("email", payload.email).is_("claimed_at", "null").limit(1).execute()
    invite_id = None
    if invite_email.data:
        invite = invite_email.data[0]
        if invite.get("role") != "student" or invite.get("student_id") != payload.student_id:
            raise HTTPException(status_code=409, detail="อีเมลหรือรหัสนักศึกษาตรงกับคำเชิญอื่น")
        invite_id = invite["id"]
        supabase.table("profile_invites").update({"full_name": payload.full_name, "academic_year": payload.academic_year, "class_level": payload.class_level}).eq("id", invite_id).execute()
    else:
        invite_by_id = supabase.table("profile_invites").select("id").eq("student_id", payload.student_id).is_("claimed_at", "null").execute()
        if invite_by_id.data:
            raise HTTPException(status_code=409, detail="รหัสนักศึกษานี้มีคำเชิญด้วยอีเมลอื่นแล้ว")
        created = supabase.table("profile_invites").insert({
            "email": payload.email, "student_id": payload.student_id, "full_name": payload.full_name,
            "role": "student", "academic_year": payload.academic_year, "class_level": payload.class_level,
            "invited_by": current_user.id,
        }).execute()
        invite_id = created.data[0]["id"]
    link = supabase.table("profile_invite_courses").upsert({"invite_id": invite_id, "course_id": course_id}, on_conflict="invite_id,course_id").execute()
    return {"status": "success", "message": "สร้างคำเชิญและเพิ่มในรายวิชาแล้ว", "roster_kind": "pending", "data": link.data[0] if link.data else None}


@teacher_router.put("/courses/{course_id}/roster/{roster_kind}/{student_ref}")
async def update_course_roster_student(
    course_id: str,
    roster_kind: str,
    student_ref: str,
    payload: RosterStudentUpdate,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    require_owned_course(course_id, current_user)
    table = "profiles" if roster_kind == "active" else "profile_invites" if roster_kind == "pending" else None
    if table is None:
        raise HTTPException(status_code=400, detail="ประเภทสมาชิกไม่ถูกต้อง")
    if roster_kind == "active" and current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="อาจารย์แก้ไขข้อมูลส่วนกลางได้เฉพาะคำเชิญที่ยังไม่ถูกใช้งาน",
        )
    if roster_kind == "active":
        member = supabase.table("enrollments").select("student_id").eq("course_id", course_id).eq("student_id", student_ref).limit(1).execute()
    else:
        member = supabase.table("profile_invite_courses").select("invite_id").eq("course_id", course_id).eq("invite_id", student_ref).limit(1).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="ไม่พบนักศึกษาในรายวิชานี้")
    response = supabase.table(table).update(payload.model_dump()).eq("id", student_ref).execute()
    return {"status": "success", "message": "แก้ไขข้อมูลนักศึกษาแล้ว", "student": response.data[0] if response.data else None}


@teacher_router.delete("/courses/{course_id}/roster/{roster_kind}/{student_ref}")
async def remove_course_roster_student(
    course_id: str,
    roster_kind: str,
    student_ref: str,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    require_owned_course(course_id, current_user)
    if roster_kind == "active":
        response = supabase.table("enrollments").delete().eq("course_id", course_id).eq("student_id", student_ref).execute()
    elif roster_kind == "pending":
        response = supabase.table("profile_invite_courses").delete().eq("course_id", course_id).eq("invite_id", student_ref).execute()
    else:
        raise HTTPException(status_code=400, detail="ประเภทสมาชิกไม่ถูกต้อง")
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบนักศึกษาในรายวิชานี้")
    return {"status": "success", "message": "นำรายชื่อออกจากรายวิชาแล้ว"}

@teacher_router.post("/import/students")
async def import_students_csv(
    file: UploadFile = File(...),
    course_id: str = Form(...),
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    """อัปโหลดไฟล์ CSV เพื่อนำเข้ารายชื่อนักศึกษาเข้าระบบ"""
    try:
        require_owned_course(course_id, current_user)
        if not file.filename or not file.filename.lower().endswith('.csv'):
            raise HTTPException(status_code=400, detail="กรุณาอัปโหลดไฟล์นามสกุล .csv เท่านั้น")
            
        content = await file.read(2 * 1024 * 1024 + 1)
        if len(content) > 2 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="ไฟล์ CSV ต้องมีขนาดไม่เกิน 2 MB")
        # ใช้ io.StringIO ช่วยอ่านเป็น text
        text = content.decode('utf-8-sig') # ใช้ utf-8-sig เพื่อรองรับไฟล์ที่มี BOM จาก Excel
        csv_reader = csv.DictReader(io.StringIO(text))
        
        # ตรวจสอบ header
        fieldnames = csv_reader.fieldnames or []
        if not {'email', 'student_id', 'full_name'}.issubset(fieldnames):
             raise HTTPException(status_code=400, detail="ไฟล์ CSV ต้องมีคอลัมน์ email, student_id และ full_name")

        invite_count = 0
        enrollment_count = 0
        error_count = 0
        
        for row in csv_reader:
            student_id = str(row.get('student_id', '')).strip()
            full_name = str(row.get('full_name', '')).strip()
            email = str(row.get('email', '')).strip().lower()
            academic_year_text = str(row.get('academic_year', '')).strip()
            class_level = str(row.get('class_level', '')).strip() or None
            academic_year = int(academic_year_text) if academic_year_text.isdigit() and 1 <= int(academic_year_text) <= 8 else None
            
            if (
                not re.fullmatch(r"[0-9]{13}", student_id)
                or not 2 <= len(full_name) <= 150
                or not re.fullmatch(r"[^@]+@email\.kmutnb\.ac\.th", email)
                or (class_level is not None and len(class_level) > 50)
            ):
                error_count += 1
                continue
                
            existing_profile = supabase.table("profiles").select("id, email").eq("student_id", student_id).execute()
            existing_invite = supabase.table("profile_invites").select("id, student_id").eq("email", email).is_("claimed_at", "null").execute()
            if existing_profile.data:
                profile = existing_profile.data[0]
                if str(profile.get("email", "")).lower() != email:
                    error_count += 1
                    continue
                enrollment = supabase.table("enrollments").upsert(
                    {"course_id": course_id, "student_id": profile["id"]},
                    on_conflict="course_id,student_id",
                ).execute()
                if enrollment.data:
                    enrollment_count += 1
                else:
                    error_count += 1
                continue

            invite_id = None
            if existing_invite.data:
                invite = existing_invite.data[0]
                if invite.get("student_id") != student_id:
                    error_count += 1
                    continue
                invite_id = invite["id"]
            else:
                new_invite = {
                    "email": email,
                    "student_id": student_id,
                    "full_name": full_name,
                    "role": "student",
                    "invited_by": current_user.id,
                    "academic_year": academic_year,
                    "class_level": class_level,
                }
                res = supabase.table("profile_invites").insert(new_invite).execute()
                if res.data:
                    invite_id = res.data[0]["id"]
                    invite_count += 1
                else:
                    error_count += 1
                    continue

            roster_link = supabase.table("profile_invite_courses").upsert(
                {"invite_id": invite_id, "course_id": course_id},
                on_conflict="invite_id,course_id",
            ).execute()
            if roster_link.data:
                enrollment_count += 1
            else:
                error_count += 1
                
        return {
            "status": "success",
            "message": f"ผูกรายวิชาสำเร็จ {enrollment_count} รายการ, สร้างคำเชิญใหม่ {invite_count} รายการ, ข้าม/ผิดพลาด {error_count} รายการ"
        }
        
    except HTTPException:
        raise
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="ไฟล์ CSV ต้องเข้ารหัสเป็น UTF-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e
