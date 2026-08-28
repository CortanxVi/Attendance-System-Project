from datetime import timedelta
import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, field_validator
from starlette.concurrency import run_in_threadpool

from core.config import (
    TEMP_ADMIN_ENROLLMENT_SECONDS,
    TEMP_ADMIN_GRANT_SECONDS,
    TEMP_ADMIN_LOCK_SECONDS,
    TEMP_ADMIN_MAX_PIN_ATTEMPTS,
    supabase_db,
)
from core.security import AuthenticatedUser, get_current_user, require_permanent_admin
from services.temporary_admin_service import (
    hash_pin,
    issue_grant_token,
    log_security_event,
    parse_utc,
    token_hash,
    utc_now,
    validate_pin,
    verify_pin,
)


router = APIRouter(prefix="/api/v1", tags=["Temporary Admin"])


class RequestTemporaryAdminAccess(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        cleaned = value.strip()
        if not 10 <= len(cleaned) <= 500:
            raise ValueError("เหตุผลต้องมีความยาว 10–500 ตัวอักษร")
        return cleaned


class TemporaryAdminDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str | None = None

    @field_validator("note")
    @classmethod
    def validate_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) > 500:
            raise ValueError("หมายเหตุต้องไม่เกิน 500 ตัวอักษร")
        return cleaned or None


class TemporaryAdminPinEnrollment(BaseModel):
    pin: str
    confirm_pin: str

    @field_validator("pin", "confirm_pin")
    @classmethod
    def pin_must_be_six_digits(cls, value: str) -> str:
        return validate_pin(value)


class TemporaryAdminPinActivation(BaseModel):
    pin: str

    @field_validator("pin")
    @classmethod
    def pin_must_be_six_digits(cls, value: str) -> str:
        if not re.fullmatch(r"[0-9]{6}", value):
            raise ValueError("PIN ต้องเป็นตัวเลข 6 หลัก")
        return value


class RevokeTemporaryAdminEnrollment(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        cleaned = value.strip()
        if not 5 <= len(cleaned) <= 500:
            raise ValueError("เหตุผลต้องมีความยาว 5–500 ตัวอักษร")
        return cleaned


def _require_teacher(current_user: AuthenticatedUser) -> None:
    if current_user.base_role != "teacher":
        raise HTTPException(status_code=403, detail="ฟังก์ชันนี้ใช้ได้เฉพาะบัญชีอาจารย์")


@router.get("/temporary-admin/status")
async def temporary_admin_status(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    _require_teacher(current_user)
    request_response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_requests")
        .select("id, reason, status, review_note, reviewed_at, enrollment_expires_at, created_at")
        .eq("teacher_id", current_user.id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    enrollment_response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_enrollments")
        .select("teacher_id, locked_until, last_used_at, pin_changed_at, revoked_at, created_at")
        .eq("teacher_id", current_user.id)
        .limit(1)
        .execute()
    )
    enrollment = enrollment_response.data[0] if enrollment_response.data else None
    enrolled = bool(enrollment and not enrollment.get("revoked_at"))
    return {
        "status": "success",
        "request": request_response.data[0] if request_response.data else None,
        "enrollment": enrollment,
        "enrolled": enrolled,
        "temporary_admin": current_user.temporary_admin,
        "grant_expires_at": current_user.temporary_admin_expires_at,
        "grant_ttl_seconds": TEMP_ADMIN_GRANT_SECONDS,
    }


@router.post("/temporary-admin/requests", status_code=status.HTTP_201_CREATED)
async def request_temporary_admin(
    payload: RequestTemporaryAdminAccess,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    _require_teacher(current_user)
    enrollment = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_enrollments")
        .select("teacher_id, revoked_at")
        .eq("teacher_id", current_user.id)
        .limit(1)
        .execute()
    )
    if enrollment.data and not enrollment.data[0].get("revoked_at"):
        raise HTTPException(status_code=409, detail="บัญชีนี้ได้รับอนุมัติและตั้ง PIN แล้ว")

    pending = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_requests")
        .select("id")
        .eq("teacher_id", current_user.id)
        .eq("status", "pending")
        .limit(1)
        .execute()
    )
    if pending.data:
        raise HTTPException(status_code=409, detail="มีคำขอที่กำลังรอพิจารณาอยู่แล้ว")

    response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_requests").insert({
            "teacher_id": current_user.id,
            "reason": payload.reason,
        }).execute()
    )
    request_id = response.data[0]["id"]
    await run_in_threadpool(
        log_security_event,
        current_user.id,
        "TEMP_ADMIN_REQUESTED",
        request_id,
        {"reason_length": len(payload.reason)},
    )
    return {"status": "success", "request": response.data[0]}


@router.delete("/temporary-admin/requests/{request_id}")
async def cancel_temporary_admin_request(
    request_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    _require_teacher(current_user)
    response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_requests")
        .update({"status": "cancelled"})
        .eq("id", request_id)
        .eq("teacher_id", current_user.id)
        .eq("status", "pending")
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบคำขอที่ยกเลิกได้")
    return {"status": "success", "message": "ยกเลิกคำขอแล้ว"}


@router.post("/temporary-admin/pin/enroll")
async def enroll_temporary_admin_pin(
    payload: TemporaryAdminPinEnrollment,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    _require_teacher(current_user)
    if payload.pin != payload.confirm_pin:
        raise HTTPException(status_code=400, detail="PIN และการยืนยัน PIN ไม่ตรงกัน")

    approved_response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_requests")
        .select("id, reviewed_by, enrollment_expires_at")
        .eq("teacher_id", current_user.id)
        .eq("status", "approved")
        .order("reviewed_at", desc=True)
        .limit(1)
        .execute()
    )
    if not approved_response.data:
        raise HTTPException(status_code=403, detail="ยังไม่ได้รับอนุมัติจากผู้ดูแลระบบถาวร")
    approved = approved_response.data[0]
    deadline = parse_utc(approved.get("enrollment_expires_at"))
    if deadline is None or deadline <= utc_now():
        raise HTTPException(status_code=410, detail="สิทธิ์ตั้ง PIN หมดอายุ กรุณาส่งคำขอใหม่")

    existing_response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_enrollments")
        .select("teacher_id, revoked_at")
        .eq("teacher_id", current_user.id)
        .limit(1)
        .execute()
    )
    if existing_response.data and not existing_response.data[0].get("revoked_at"):
        raise HTTPException(status_code=409, detail="บัญชีนี้ตั้ง PIN แล้ว")

    pin_hash = await run_in_threadpool(hash_pin, current_user.id, payload.pin)
    enrollment_data = {
        "teacher_id": current_user.id,
        "approved_request_id": approved["id"],
        "approved_by": approved["reviewed_by"],
        "pin_hash": pin_hash,
        "failed_attempts": 0,
        "locked_until": None,
        "last_failed_at": None,
        "pin_changed_at": utc_now().isoformat(),
        "revoked_at": None,
        "revoked_by": None,
        "revoked_reason": None,
    }
    if existing_response.data:
        response = await run_in_threadpool(
            lambda: supabase_db.table("temporary_admin_enrollments")
            .update(enrollment_data)
            .eq("teacher_id", current_user.id)
            .execute()
        )
    else:
        response = await run_in_threadpool(
            lambda: supabase_db.table("temporary_admin_enrollments")
            .insert(enrollment_data)
            .execute()
        )
    if not response.data:
        raise HTTPException(status_code=500, detail="ไม่สามารถบันทึก PIN ได้")
    await run_in_threadpool(
        log_security_event,
        current_user.id,
        "TEMP_ADMIN_PIN_ENROLLED",
        current_user.id,
        {"approved_by": approved["reviewed_by"]},
    )
    return {"status": "success", "message": "ตั้ง PIN สำหรับสิทธิ์ชั่วคราวสำเร็จ"}


@router.post("/temporary-admin/activate")
async def activate_temporary_admin(
    payload: TemporaryAdminPinActivation,
    request: Request,
    response: Response,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    _require_teacher(current_user)
    enrollment_response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_enrollments")
        .select("teacher_id, pin_hash, failed_attempts, locked_until, revoked_at")
        .eq("teacher_id", current_user.id)
        .limit(1)
        .execute()
    )
    if not enrollment_response.data or enrollment_response.data[0].get("revoked_at"):
        raise HTTPException(status_code=403, detail="บัญชีนี้ยังไม่ได้รับอนุมัติและตั้ง PIN")
    enrollment = enrollment_response.data[0]
    locked_until = parse_utc(enrollment.get("locked_until"))
    if locked_until and locked_until > utc_now():
        retry_after = max(1, int((locked_until - utc_now()).total_seconds()))
        raise HTTPException(
            status_code=429,
            detail="กรอก PIN ผิดเกินกำหนด บัญชีถูกล็อกชั่วคราว",
            headers={"Retry-After": str(retry_after)},
        )

    verified = await run_in_threadpool(
        verify_pin,
        enrollment["pin_hash"],
        current_user.id,
        payload.pin,
    )
    if not verified:
        failure_response = await run_in_threadpool(
            lambda: supabase_db.rpc("record_temporary_admin_pin_failure", {
                "target_teacher_id": current_user.id,
                "maximum_attempts": TEMP_ADMIN_MAX_PIN_ATTEMPTS,
                "lock_duration_seconds": TEMP_ADMIN_LOCK_SECONDS,
            }).execute()
        )
        failed_attempts = int(failure_response.data[0]["failed_attempts"]) if failure_response.data else TEMP_ADMIN_MAX_PIN_ATTEMPTS
        await run_in_threadpool(
            log_security_event,
            current_user.id,
            "TEMP_ADMIN_PIN_FAILED",
            current_user.id,
            {
                "failed_attempts": failed_attempts,
                "source_ip": request.client.host if request.client else None,
            },
        )
        raise HTTPException(status_code=401, detail="PIN ไม่ถูกต้อง")

    now = utc_now()
    expires_at = now + timedelta(seconds=TEMP_ADMIN_GRANT_SECONDS)
    raw_token, hashed_token = issue_grant_token()
    await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_grants")
        .update({"revoked_at": now.isoformat()})
        .eq("teacher_id", current_user.id)
        .is_("revoked_at", "null")
        .execute()
    )
    grant_response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_grants").insert({
            "teacher_id": current_user.id,
            "token_hash": hashed_token,
            "auth_session_id": current_user.auth_session_id,
            "expires_at": expires_at.isoformat(),
        }).execute()
    )
    await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_enrollments")
        .update({
            "failed_attempts": 0,
            "locked_until": None,
            "last_used_at": now.isoformat(),
        })
        .eq("teacher_id", current_user.id)
        .execute()
    )
    await run_in_threadpool(
        log_security_event,
        current_user.id,
        "TEMP_ADMIN_ACTIVATED",
        grant_response.data[0]["id"],
        {"expires_at": expires_at.isoformat()},
    )
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return {
        "status": "success",
        "grant_token": raw_token,
        "expires_at": expires_at.isoformat(),
        "expires_in": TEMP_ADMIN_GRANT_SECONDS,
    }


@router.post("/temporary-admin/deactivate")
async def deactivate_temporary_admin(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    admin_grant: Annotated[str | None, Header(alias="X-Admin-Grant")] = None,
):
    _require_teacher(current_user)
    if not admin_grant:
        raise HTTPException(status_code=400, detail="ไม่พบสิทธิ์ชั่วคราวที่ต้องการปิด")
    now = utc_now().isoformat()
    response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_grants")
        .update({"revoked_at": now})
        .eq("teacher_id", current_user.id)
        .eq("token_hash", token_hash(admin_grant))
        .is_("revoked_at", "null")
        .execute()
    )
    if response.data:
        await run_in_threadpool(
            log_security_event,
            current_user.id,
            "TEMP_ADMIN_DEACTIVATED",
            response.data[0]["id"],
        )
    return {"status": "success", "message": "กลับสู่สิทธิ์อาจารย์แล้ว"}


@router.get("/admin/temporary-admin/requests")
async def list_temporary_admin_requests(
    current_user: Annotated[AuthenticatedUser, Depends(require_permanent_admin)],
    request_status: Literal["pending", "approved", "rejected", "cancelled", "all"] = "pending",
):
    del current_user
    query = (
        supabase_db.table("temporary_admin_requests")
        .select("id, teacher_id, reason, status, reviewed_by, reviewed_at, review_note, enrollment_expires_at, created_at")
        .order("created_at", desc=True)
        .limit(100)
    )
    if request_status != "all":
        query = query.eq("status", request_status)
    response = await run_in_threadpool(query.execute)
    rows = response.data or []
    teacher_ids = list({row["teacher_id"] for row in rows})
    profiles_by_id = {}
    if teacher_ids:
        profile_response = await run_in_threadpool(
            lambda: supabase_db.table("profiles")
            .select("id, full_name, email")
            .in_("id", teacher_ids)
            .execute()
        )
        profiles_by_id = {row["id"]: {"full_name": row.get("full_name"), "email": row.get("email")} for row in (profile_response.data or [])}
    for row in rows:
        row["profiles"] = profiles_by_id.get(row["teacher_id"])
    return {"status": "success", "requests": rows}


@router.post("/admin/temporary-admin/requests/{request_id}/decision")
async def decide_temporary_admin_request(
    request_id: str,
    payload: TemporaryAdminDecision,
    current_user: Annotated[AuthenticatedUser, Depends(require_permanent_admin)],
):
    if payload.decision == "rejected" and not payload.note:
        raise HTTPException(status_code=400, detail="กรุณาระบุเหตุผลที่ไม่อนุมัติ")
    existing = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_requests")
        .select("id, teacher_id, status")
        .eq("id", request_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="ไม่พบคำขอนี้")
    request_row = existing.data[0]
    if request_row["status"] != "pending":
        raise HTTPException(status_code=409, detail="คำขอนี้ได้รับการพิจารณาแล้ว")
    if request_row["teacher_id"] == current_user.id:
        raise HTTPException(status_code=403, detail="ไม่สามารถอนุมัติคำขอของตนเอง")

    now = utc_now()
    update_data = {
        "status": payload.decision,
        "reviewed_by": current_user.id,
        "reviewed_at": now.isoformat(),
        "review_note": payload.note,
        "enrollment_expires_at": (
            now + timedelta(seconds=TEMP_ADMIN_ENROLLMENT_SECONDS)
        ).isoformat() if payload.decision == "approved" else None,
    }
    response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_requests")
        .update(update_data)
        .eq("id", request_id)
        .eq("status", "pending")
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=409, detail="สถานะคำขอเปลี่ยนไปแล้ว กรุณาโหลดใหม่")
    await run_in_threadpool(
        log_security_event,
        current_user.id,
        f"TEMP_ADMIN_{payload.decision.upper()}",
        request_id,
        {"teacher_id": request_row["teacher_id"]},
    )
    return {"status": "success", "request": response.data[0]}


@router.post("/admin/temporary-admin/enrollments/{teacher_id}/revoke")
async def revoke_temporary_admin_enrollment(
    teacher_id: str,
    payload: RevokeTemporaryAdminEnrollment,
    current_user: Annotated[AuthenticatedUser, Depends(require_permanent_admin)],
):
    now = utc_now().isoformat()
    response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_enrollments")
        .update({
            "revoked_at": now,
            "revoked_by": current_user.id,
            "revoked_reason": payload.reason,
        })
        .eq("teacher_id", teacher_id)
        .is_("revoked_at", "null")
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบสิทธิ์ที่ยังใช้งานอยู่")
    await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_grants")
        .update({"revoked_at": now})
        .eq("teacher_id", teacher_id)
        .is_("revoked_at", "null")
        .execute()
    )
    await run_in_threadpool(
        log_security_event,
        current_user.id,
        "TEMP_ADMIN_ENROLLMENT_REVOKED",
        teacher_id,
        {"reason": payload.reason},
    )
    return {"status": "success", "message": "เพิกถอนสิทธิ์ชั่วคราวแล้ว"}


@router.get("/admin/temporary-admin/enrollments")
async def list_temporary_admin_enrollments(
    current_user: Annotated[AuthenticatedUser, Depends(require_permanent_admin)],
):
    del current_user
    response = await run_in_threadpool(
        lambda: supabase_db.table("temporary_admin_enrollments")
        .select("teacher_id, approved_by, created_at, last_used_at, pin_changed_at")
        .is_("revoked_at", "null")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    rows = response.data or []
    teacher_ids = [row["teacher_id"] for row in rows]
    profiles_by_id = {}
    if teacher_ids:
        profiles = await run_in_threadpool(
            lambda: supabase_db.table("profiles").select("id, full_name, email").in_("id", teacher_ids).execute()
        )
        profiles_by_id = {row["id"]: {"full_name": row.get("full_name"), "email": row.get("email")} for row in (profiles.data or [])}
    for row in rows:
        row["profiles"] = profiles_by_id.get(row["teacher_id"])
    return {"status": "success", "enrollments": rows}
