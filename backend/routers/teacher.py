import hmac
import re
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from services.attendance_export_service import export_service
from services.roster_import_service import (
    MAX_ROSTER_FILE_BYTES,
    ParsedRoster,
    RosterImportError,
    parse_roster_file,
    resolve_roster_actions,
)
from services.student_year_service import with_derived_study_year
from core.authorization import (
    require_course_enrollment,
    require_course_management_permission,
    require_owned_course,
    require_owned_session,
)
from core.config import supabase_db as supabase
from core.security import AuthenticatedUser, require_roles

teacher_router = APIRouter(
    prefix="/api/v1/teacher",
    tags=["Teacher"],
    dependencies=[Depends(require_roles("teacher", "admin"))],
)

@teacher_router.get("/export/attendance/{course_id}")
def get_teacher_export_attendance(
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
            "archived_sessions": data.get("archived_sessions", []),
            "students": data.get("students", []),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e


class AttendanceSessionSelection(BaseModel):
    session_ids: list[UUID] = Field(min_length=1, max_length=1000)
    reason: str | None = Field(default=None, max_length=300)


class AttendanceSessionRestore(BaseModel):
    session_ids: list[UUID] = Field(min_length=1, max_length=1000)


class AttendancePeriodRollover(BaseModel):
    semester: Literal[1, 2]
    year: int = Field(ge=2000, le=3000)
    reason: str | None = Field(default=None, max_length=300)


@teacher_router.post("/courses/{course_id}/attendance-period/archive")
def archive_course_attendance_sessions(
    course_id: str,
    payload: AttendanceSessionSelection,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    """Remove selected closed sessions from the current report without deleting evidence."""
    require_course_management_permission(course_id, current_user)
    try:
        response = supabase.rpc("archive_attendance_sessions", {
            "target_course_id": course_id,
            "actor_id": current_user.id,
            "target_session_ids": [str(session_id) for session_id in payload.session_ids],
            "archive_note": payload.reason,
        }).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=409,
            detail="ไม่สามารถนำคาบที่เลือกออกจากรายงานได้ กรุณาปิดคาบและโหลดข้อมูลใหม่",
        ) from exc
    return {"status": "success", "message": "นำคาบที่เลือกออกจากรายงานแล้ว", "result": response.data or {}}


@teacher_router.post("/courses/{course_id}/attendance-period/restore")
def restore_course_attendance_sessions(
    course_id: str,
    payload: AttendanceSessionRestore,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    """Restore archived sessions only when they belong to the current course period."""
    require_course_management_permission(course_id, current_user)
    try:
        response = supabase.rpc("restore_attendance_sessions", {
            "target_course_id": course_id,
            "actor_id": current_user.id,
            "target_session_ids": [str(session_id) for session_id in payload.session_ids],
        }).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=409,
            detail="คืนคาบเรียนไม่สำเร็จ คืนได้เฉพาะคาบของภาคเรียนปัจจุบัน",
        ) from exc
    return {"status": "success", "message": "คืนคาบเรียนเข้าสู่รายงานแล้ว", "result": response.data or {}}


@teacher_router.post("/courses/{course_id}/attendance-period/rollover")
def rollover_course_attendance_period(
    course_id: str,
    payload: AttendancePeriodRollover,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    """Atomically archive the active report and start a blank semester for the same course."""
    require_course_management_permission(course_id, current_user)
    try:
        response = supabase.rpc("rollover_attendance_period", {
            "target_course_id": course_id,
            "actor_id": current_user.id,
            "new_semester": payload.semester,
            "new_year": payload.year,
            "archive_note": payload.reason,
        }).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=409,
            detail="เริ่มภาคเรียนใหม่ไม่สำเร็จ กรุณาปิดคาบที่เปิดอยู่และลองอีกครั้ง",
        ) from exc
    return {"status": "success", "message": "เริ่มภาคเรียนใหม่และสร้างรายงานเปล่าแล้ว", "result": response.data or {}}

class ManualAttendanceUpdate(BaseModel):
    status: str # present, late, absent

@teacher_router.put("/attendance/{record_id}")
def update_attendance_manual(
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
def create_attendance_manual(
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


class BulkAttendanceUpdate(BaseModel):
    status: Literal["present", "late", "absent"]
    student_ids: list[str] = Field(min_length=1, max_length=1000)

    @field_validator("student_ids")
    @classmethod
    def validate_student_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not re.fullmatch(r"[0-9]{13}", value) for value in normalized):
            raise ValueError("รหัสนักศึกษาทุกรายการต้องเป็นตัวเลข 13 หลัก")
        if len(set(normalized)) != len(normalized):
            raise ValueError("รายการรหัสนักศึกษาต้องไม่ซ้ำกัน")
        return normalized


@teacher_router.post("/attendance/bulk")
def update_attendance_bulk(
    payload: BulkAttendanceUpdate,
    session_id: str,
    current_user: Annotated[
        AuthenticatedUser,
        Depends(require_roles("teacher", "admin")),
    ],
):
    """Atomically create or update attendance for a session roster subset."""
    require_owned_session(session_id, current_user)
    try:
        response = supabase.rpc("bulk_set_attendance_status", {
            "target_session_id": session_id,
            "actor_id": current_user.id,
            "student_numbers": payload.student_ids,
            "new_status": payload.status,
        }).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=409,
            detail="ไม่สามารถอัปเดตแบบกลุ่มได้ ข้อมูลสมาชิกหรือคาบเรียนอาจมีการเปลี่ยนแปลง",
        ) from exc
    return {
        "status": "success",
        "message": "อัปเดตสถานะแบบกลุ่มสำเร็จ",
        "result": response.data or {},
    }


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
    await run_in_threadpool(
        require_course_management_permission, course_id, current_user
    )
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    response = await run_in_threadpool(
        lambda: supabase.rpc("list_course_roster", {
            "target_course_id": course_id,
            "actor_id": current_user.id,
            "requested_page": page,
            "requested_page_size": page_size,
            "search_text": search[:150],
        }).execute()
    )
    result = response.data or {}
    result["students"] = [
        with_derived_study_year(student)
        for student in result.get("students", [])
    ]
    return {"status": "success", **result}


@teacher_router.post("/courses/{course_id}/roster", status_code=201)
def add_course_roster_student(
    course_id: str,
    payload: RosterStudentCreate,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    require_course_management_permission(course_id, current_user)
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
def update_course_roster_student(
    course_id: str,
    roster_kind: str,
    student_ref: str,
    payload: RosterStudentUpdate,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    require_course_management_permission(course_id, current_user)
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
def remove_course_roster_student(
    course_id: str,
    roster_kind: str,
    student_ref: str,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    require_course_management_permission(course_id, current_user)
    if roster_kind == "active":
        response = supabase.table("enrollments").delete().eq("course_id", course_id).eq("student_id", student_ref).execute()
    elif roster_kind == "pending":
        response = supabase.table("profile_invite_courses").delete().eq("course_id", course_id).eq("invite_id", student_ref).execute()
    else:
        raise HTTPException(status_code=400, detail="ประเภทสมาชิกไม่ถูกต้อง")
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบนักศึกษาในรายวิชานี้")
    return {"status": "success", "message": "นำรายชื่อออกจากรายวิชาแล้ว"}

async def _read_roster_upload(file: UploadFile) -> bytes:
    if not file.filename:
        raise HTTPException(status_code=400, detail="กรุณาเลือกไฟล์รายชื่อ")
    content = await file.read(MAX_ROSTER_FILE_BYTES + 1)
    if len(content) > MAX_ROSTER_FILE_BYTES:
        raise HTTPException(status_code=413, detail="ไฟล์รายชื่อต้องมีขนาดไม่เกิน 5 MB")
    return content


def _parse_and_resolve_roster(
    content: bytes,
    file: UploadFile,
    course: dict,
) -> tuple[ParsedRoster, dict[str, int], list[str]]:
    parsed = parse_roster_file(content, file.filename or "", file.content_type)
    blocking_errors: list[str] = []
    detected_code = parsed.detected_course_code
    if detected_code and detected_code != str(course.get("course_code") or "").strip():
        blocking_errors.append(
            f"ไฟล์เป็นรายวิชา {detected_code} แต่หน้าปัจจุบันคือ {course.get('course_code')}"
        )
    summary = resolve_roster_actions(parsed, str(course["id"]))
    return parsed, summary, blocking_errors


@teacher_router.post("/courses/{course_id}/roster/import/preview")
async def preview_course_roster_import(
    course_id: str,
    file: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    course = await run_in_threadpool(
        require_course_management_permission, course_id, current_user
    )
    content = await _read_roster_upload(file)
    try:
        parsed, summary, blocking_errors = await run_in_threadpool(
            _parse_and_resolve_roster, content, file, course
        )
    except RosterImportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    return {
        "status": "success",
        "ready": summary["invalid"] == 0 and not blocking_errors,
        "file": {
            "name": parsed.filename,
            "type": parsed.file_type,
            "sha256": parsed.digest,
            "sheet_name": parsed.sheet_name,
            "encoding": parsed.encoding,
            "header_row": parsed.header_row,
        },
        "detected": {
            "course_code": parsed.detected_course_code,
            "course_name": parsed.detected_course_name,
            "academic_year": parsed.detected_academic_year,
        },
        "summary": summary,
        "warnings": parsed.warnings,
        "blocking_errors": blocking_errors,
        "rows": [row.as_dict() for row in parsed.rows],
    }


@teacher_router.post("/courses/{course_id}/roster/import/commit")
async def commit_course_roster_import(
    course_id: str,
    file: UploadFile = File(...),
    expected_sha256: str = Form(...),
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    course = await run_in_threadpool(
        require_course_management_permission, course_id, current_user
    )
    content = await _read_roster_upload(file)
    try:
        parsed, summary, blocking_errors = await run_in_threadpool(
            _parse_and_resolve_roster, content, file, course
        )
    except RosterImportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    if not hmac.compare_digest(parsed.digest, expected_sha256.strip().lower()):
        raise HTTPException(
            status_code=409,
            detail="ไฟล์เปลี่ยนไปหลังตรวจตัวอย่าง กรุณาตรวจตัวอย่างใหม่",
        )
    if blocking_errors or summary["invalid"]:
        raise HTTPException(
            status_code=409,
            detail="ข้อมูลเปลี่ยนแปลงหรือยังมีแถวไม่ถูกต้อง กรุณาตรวจตัวอย่างใหม่",
        )

    rows = [row.commit_dict() for row in parsed.rows]
    try:
        response = await run_in_threadpool(
            lambda: supabase.rpc("import_course_roster", {
                "target_course_id": course_id,
                "actor_id": current_user.id,
                "roster_rows": rows,
                "source_sha256": parsed.digest,
            }).execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=409,
            detail="ข้อมูลสมาชิกถูกเปลี่ยนระหว่างนำเข้า กรุณาตรวจตัวอย่างอีกครั้ง",
        ) from exc

    result = response.data or {}
    return {
        "status": "success",
        "message": (
            f"นำเข้าสำเร็จ {result.get('row_count', len(rows))} รายการ "
            f"และไม่เปลี่ยนข้อมูลเดิม {result.get('unchanged', 0)} รายการ"
        ),
        "result": result,
    }
