from datetime import datetime, timezone
import logging
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from core.authorization import require_course_management_permission
from core.config import supabase_db as supabase
from core.security import AuthenticatedUser, require_roles
from services.course_join_service import (
    course_join_limiter,
    format_join_code,
    join_code_is_available,
    load_or_create_join_code,
    normalize_join_code,
    rotate_join_code,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["Course membership"])


class JoinCodeSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: bool | None = None
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def validate_expiry(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("วันหมดอายุต้องระบุเขตเวลา")
        value = value.astimezone(timezone.utc)
        if value <= datetime.now(timezone.utc):
            raise ValueError("วันหมดอายุต้องอยู่ในอนาคต")
        return value


class JoinCourseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=8, max_length=16)


class ReviewJoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def clean_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


def _safe_code(row: dict) -> dict:
    return {
        "id": row["id"],
        "course_id": row["course_id"],
        "join_code": format_join_code(row["join_code"]),
        "is_active": row["is_active"],
        "expires_at": row.get("expires_at"),
        "usage_count": row.get("usage_count", 0),
        "created_at": row.get("created_at"),
        "rotated_at": row.get("rotated_at"),
    }


def _audit(actor_id: str, action: str, target_type: str, target_id: str, details: dict) -> None:
    try:
        supabase.table("audit_logs").insert({
            "admin_id": actor_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "details": details,
        }).execute()
    except Exception:
        logger.exception("Could not write course membership audit event %s", action)


def _course_details(course_id: str, current_user: AuthenticatedUser) -> dict:
    require_course_management_permission(course_id, current_user)
    response = supabase.table("courses").select(
        "id, course_code, course_name, section, semester, year, total_sessions, "
        "late_threshold_minutes, absent_threshold_minutes, max_absence_percent, teacher_id"
    ).eq("id", course_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบรายวิชานี้ในระบบ")
    return response.data[0]


@router.get("/teacher/courses/{course_id}/management")
async def get_course_management(
    course_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    course = await run_in_threadpool(_course_details, str(course_id), current_user)
    return {"status": "success", "course": course}


@router.get("/teacher/courses/{course_id}/join-code")
async def get_course_join_code(
    course_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    course_key = str(course_id)
    await run_in_threadpool(require_course_management_permission, course_key, current_user)
    row = await run_in_threadpool(load_or_create_join_code, course_key, current_user.id)
    return {"status": "success", "join_code": _safe_code(row)}


@router.post("/teacher/courses/{course_id}/join-code/rotate")
async def rotate_course_join_code(
    course_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    course_key = str(course_id)
    await run_in_threadpool(require_course_management_permission, course_key, current_user)
    row = await run_in_threadpool(rotate_join_code, course_key, current_user.id)
    await run_in_threadpool(
        _audit,
        current_user.id,
        "COURSE_JOIN_CODE_ROTATED",
        "course",
        course_key,
        {"course_id": course_key},
    )
    return {"status": "success", "join_code": _safe_code(row)}


@router.patch("/teacher/courses/{course_id}/join-code")
async def update_course_join_code(
    course_id: UUID,
    payload: JoinCodeSettingsUpdate,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    if not payload.model_fields_set:
        raise HTTPException(status_code=400, detail="ไม่มีค่าที่ต้องการแก้ไข")
    course_key = str(course_id)
    await run_in_threadpool(require_course_management_permission, course_key, current_user)
    existing = await run_in_threadpool(load_or_create_join_code, course_key, current_user.id)
    update_data: dict = {}
    if "is_active" in payload.model_fields_set:
        update_data["is_active"] = payload.is_active
    if "expires_at" in payload.model_fields_set:
        update_data["expires_at"] = payload.expires_at.isoformat() if payload.expires_at else None
    response = await run_in_threadpool(
        lambda: supabase.table("course_join_codes").update(update_data).eq(
            "id", existing["id"]
        ).execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบรหัสเข้าร่วมรายวิชา")
    await run_in_threadpool(
        _audit,
        current_user.id,
        "COURSE_JOIN_CODE_SETTINGS_UPDATED",
        "course",
        course_key,
        {
            "course_id": course_key,
            "is_active": response.data[0].get("is_active"),
            "expires_at": response.data[0].get("expires_at"),
        },
    )
    return {"status": "success", "join_code": _safe_code(response.data[0])}


@router.get("/teacher/courses/{course_id}/join-requests")
async def list_course_join_requests(
    course_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
    page: int = 1,
    page_size: int = 25,
    status_filter: Literal["pending", "approved", "rejected", "cancelled", "all"] = "pending",
):
    course_key = str(course_id)
    await run_in_threadpool(require_course_management_permission, course_key, current_user)
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    start = (page - 1) * page_size

    def load() -> tuple[list[dict], int]:
        query = supabase.table("course_join_requests").select(
            "id, course_id, student_id, status, requested_at, reviewed_at, review_note, updated_at",
            count="exact",
        ).eq("course_id", course_key)
        if status_filter != "all":
            query = query.eq("status", status_filter)
        response = query.order("requested_at", desc=True).range(start, start + page_size - 1).execute()
        rows = response.data or []
        student_ids = sorted({row["student_id"] for row in rows})
        profiles: dict[str, dict] = {}
        if student_ids:
            profile_response = supabase.table("profiles").select(
                "id, student_id, full_name, email, academic_year, class_level"
            ).in_("id", student_ids).execute()
            profiles = {row["id"]: row for row in (profile_response.data or [])}
        for row in rows:
            row["student"] = profiles.get(row["student_id"])
        return rows, response.count or 0

    rows, total = await run_in_threadpool(load)
    return {
        "status": "success",
        "requests": rows,
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@router.post("/teacher/courses/{course_id}/join-requests/{request_id}/review")
async def review_course_join_request(
    course_id: UUID,
    request_id: UUID,
    payload: ReviewJoinRequest,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("teacher", "admin"))],
):
    course_key = str(course_id)
    request_key = str(request_id)
    await run_in_threadpool(require_course_management_permission, course_key, current_user)

    request_response = await run_in_threadpool(
        lambda: supabase.table("course_join_requests").select("id, course_id, status").eq(
            "id", request_key
        ).eq("course_id", course_key).limit(1).execute()
    )
    if not request_response.data:
        raise HTTPException(status_code=404, detail="ไม่พบคำขอเข้าร่วมรายวิชานี้")
    if request_response.data[0].get("status") != "pending":
        raise HTTPException(status_code=409, detail="คำขอนี้ได้รับการดำเนินการแล้ว")

    response = await run_in_threadpool(
        lambda: supabase.rpc("review_course_join_request", {
            "target_request_id": request_key,
            "reviewer_id": current_user.id,
            "decision": payload.decision,
            "reviewer_note": payload.note,
        }).execute()
    )
    return {"status": "success", "request": response.data}


@router.get("/students/me/courses")
async def get_my_courses(
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("student"))],
):
    def load() -> tuple[list[dict], list[dict]]:
        enrollment_response = supabase.table("enrollments").select(
            "course_id, courses(id, course_code, course_name, section, semester, year, teacher_id)"
        ).eq("student_id", current_user.id).execute()
        courses = [row.get("courses") for row in (enrollment_response.data or []) if row.get("courses")]

        request_response = supabase.table("course_join_requests").select(
            "id, course_id, status, requested_at, reviewed_at, review_note, updated_at, "
            "courses(id, course_code, course_name, section, semester, year, teacher_id)"
        ).eq("student_id", current_user.id).order("updated_at", desc=True).execute()
        requests = request_response.data or []

        teacher_ids = sorted({
            course.get("teacher_id")
            for course in courses + [row.get("courses") or {} for row in requests]
            if course.get("teacher_id")
        })
        teachers: dict[str, dict] = {}
        if teacher_ids:
            teacher_response = supabase.table("profiles").select("id, full_name").in_(
                "id", teacher_ids
            ).execute()
            teachers = {row["id"]: row for row in (teacher_response.data or [])}
        for course in courses:
            course["teacher"] = teachers.get(course.get("teacher_id"))
        for request_row in requests:
            course = request_row.get("courses") or {}
            course["teacher"] = teachers.get(course.get("teacher_id"))
            request_row["course"] = course
            request_row.pop("courses", None)
        return courses, requests

    courses, requests = await run_in_threadpool(load)
    return {"status": "success", "courses": courses, "join_requests": requests}


@router.post("/students/me/courses/join", status_code=201)
async def request_to_join_course(
    payload: JoinCourseRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("student"))],
):
    client_host = request.client.host if request.client else "unknown"
    course_join_limiter.check(f"{current_user.id}:{client_host}")
    normalized = normalize_join_code(payload.code)
    generic_error = "รหัสไม่ถูกต้อง หมดอายุ หรือรายวิชาปิดรับสมาชิกแล้ว"
    if not normalized:
        raise HTTPException(status_code=400, detail=generic_error)

    code_response = await run_in_threadpool(
        lambda: supabase.table("course_join_codes").select(
            "id, course_id, is_active, expires_at"
        ).eq("join_code", normalized).limit(1).execute()
    )
    if not code_response.data or not join_code_is_available(code_response.data[0]):
        raise HTTPException(status_code=400, detail=generic_error)
    code_row = code_response.data[0]
    course_id = code_row["course_id"]

    enrollment = await run_in_threadpool(
        lambda: supabase.table("enrollments").select("course_id").eq(
            "course_id", course_id
        ).eq("student_id", current_user.id).limit(1).execute()
    )
    if enrollment.data:
        raise HTTPException(status_code=409, detail="คุณเข้าร่วมรายวิชานี้แล้ว")

    existing = await run_in_threadpool(
        lambda: supabase.table("course_join_requests").select("id, status").eq(
            "course_id", course_id
        ).eq("student_id", current_user.id).limit(1).execute()
    )
    now = datetime.now(timezone.utc).isoformat()
    if existing.data and existing.data[0].get("status") == "pending":
        raise HTTPException(status_code=409, detail="คุณส่งคำขอเข้าร่วมรายวิชานี้แล้ว")

    if existing.data:
        response = await run_in_threadpool(
            lambda: supabase.table("course_join_requests").update({
                "join_code_id": code_row["id"],
                "status": "pending",
                "requested_at": now,
                "reviewed_at": None,
                "reviewed_by": None,
                "review_note": None,
                "updated_at": now,
            }).eq("id", existing.data[0]["id"]).execute()
        )
    else:
        response = await run_in_threadpool(
            lambda: supabase.table("course_join_requests").insert({
                "course_id": course_id,
                "student_id": current_user.id,
                "join_code_id": code_row["id"],
            }).execute()
        )

    course_response = await run_in_threadpool(
        lambda: supabase.table("courses").select(
            "id, course_code, course_name, section, semester, year"
        ).eq("id", course_id).limit(1).execute()
    )
    request_row = response.data[0] if response.data else None
    if not request_row:
        raise HTTPException(status_code=503, detail="ไม่สามารถส่งคำขอเข้าร่วมรายวิชาได้")
    await run_in_threadpool(
        _audit,
        current_user.id,
        "COURSE_JOIN_REQUEST_CREATED",
        "course_join_request",
        request_row["id"],
        {"course_id": course_id},
    )
    return {
        "status": "success",
        "message": "ส่งคำขอเข้าร่วมรายวิชาแล้ว กรุณารออาจารย์อนุมัติ",
        "request": request_row,
        "course": course_response.data[0] if course_response.data else None,
    }


@router.delete("/students/me/courses/join-requests/{request_id}")
async def cancel_join_request(
    request_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("student"))],
):
    request_key = str(request_id)
    response = await run_in_threadpool(
        lambda: supabase.table("course_join_requests").update({
            "status": "cancelled",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", request_key).eq("student_id", current_user.id).eq(
            "status", "pending"
        ).execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบคำขอที่สามารถยกเลิกได้")
    await run_in_threadpool(
        _audit,
        current_user.id,
        "COURSE_JOIN_REQUEST_CANCELLED",
        "course_join_request",
        request_key,
        {"course_id": response.data[0]["course_id"]},
    )
    return {"status": "success", "message": "ยกเลิกคำขอแล้ว"}
