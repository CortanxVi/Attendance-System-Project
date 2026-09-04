import logging
import io
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

from core.config import SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE, supabase_db as supabase
from core.security import AuthenticatedUser, get_current_user, require_roles
from services.student_support_service import (
    ValidatedSupportAttachment,
    inline_content_disposition,
    read_validated_support_attachment,
)


logger = logging.getLogger(__name__)
BUCKET = "student-request-files"
support_router = APIRouter(prefix="/api/v1/support", tags=["Student support"])


class RequestStatusUpdate(BaseModel):
    status: str


def _api_error_code(exc: Exception) -> str | None:
    return getattr(exc, "code", None)


def _request_query(request_id: str):
    return (
        supabase.table("student_support_requests")
        .select("id, client_token, course_id, student_id, teacher_id, subject, status, created_at, updated_at, last_message_at")
        .eq("id", request_id)
        .limit(1)
        .execute()
    )


def _load_request_for_participant(request_id: str, user: AuthenticatedUser) -> dict:
    response = _request_query(request_id)
    if not response.data:
        raise HTTPException(status_code=404, detail="ไม่พบคำร้องนี้")
    request_row = response.data[0]
    participant_ids = {request_row.get("student_id"), request_row.get("teacher_id")}
    if user.id not in participant_ids:
        raise HTTPException(status_code=403, detail="คุณไม่มีสิทธิ์เข้าถึงคำร้องนี้")
    return request_row


def _profile_map(user_ids: set[str]) -> dict[str, dict]:
    if not user_ids:
        return {}
    response = (
        supabase.table("profiles")
        .select("id, full_name, role")
        .in_("id", sorted(user_ids))
        .execute()
    )
    return {row["id"]: row for row in (response.data or [])}


def _course_map(course_ids: set[str]) -> dict[str, dict]:
    if not course_ids:
        return {}
    response = (
        supabase.table("courses")
        .select("id, course_code, course_name, section, teacher_id")
        .in_("id", sorted(course_ids))
        .execute()
    )
    return {row["id"]: row for row in (response.data or [])}


def _serialize_requests(rows: list[dict]) -> list[dict]:
    course_map = _course_map({row["course_id"] for row in rows})
    profile_map = _profile_map(
        {row["student_id"] for row in rows} | {row["teacher_id"] for row in rows}
    )
    return [
        {
            **row,
            "course": course_map.get(row["course_id"]),
            "student": profile_map.get(row["student_id"]),
            "teacher": profile_map.get(row["teacher_id"]),
        }
        for row in rows
    ]


def _load_request_detail(request_id: str, user: AuthenticatedUser) -> dict:
    request_row = _load_request_for_participant(request_id, user)
    messages_response = (
        supabase.table("student_support_messages")
        .select("id, request_id, sender_id, body, created_at")
        .eq("request_id", request_id)
        .order("created_at")
        .limit(500)
        .execute()
    )
    messages = messages_response.data or []
    message_ids = [row["id"] for row in messages]
    attachments_by_message: dict[str, list[dict]] = {message_id: [] for message_id in message_ids}
    if message_ids:
        attachments_response = (
            supabase.table("student_support_attachments")
            .select("id, message_id, original_name, content_type, size_bytes, created_at")
            .in_("message_id", message_ids)
            .order("created_at")
            .execute()
        )
        for attachment in attachments_response.data or []:
            attachment["preview_url"] = f"/api/v1/support/attachments/{attachment['id']}/preview"
            attachments_by_message[attachment["message_id"]].append(attachment)
    profile_map = _profile_map({row["sender_id"] for row in messages})
    for message in messages:
        message["sender"] = profile_map.get(message["sender_id"])
        message["attachments"] = attachments_by_message.get(message["id"], [])
    detail = _serialize_requests([request_row])[0]
    detail["messages"] = messages
    return detail


async def _validate_attachments(uploads: list[UploadFile]) -> list[ValidatedSupportAttachment]:
    if len(uploads) > SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE:
        raise HTTPException(
            status_code=400,
            detail=f"แนบไฟล์ได้ไม่เกิน {SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE} ไฟล์ต่อข้อความ",
        )
    return [await read_validated_support_attachment(upload) for upload in uploads]


def _store_attachments(
    request_id: str,
    message_id: str,
    attachments: list[ValidatedSupportAttachment],
) -> list[str]:
    uploaded_paths: list[str] = []
    metadata_rows: list[dict] = []
    try:
        for attachment in attachments:
            attachment_id = str(uuid4())
            path = f"{request_id}/{message_id}/{attachment_id}{attachment.extension}"
            supabase.storage.from_(BUCKET).upload(
                path=path,
                file=attachment.content,
                file_options={
                    "content-type": attachment.content_type,
                    "cache-control": "private, max-age=300",
                    "upsert": "false",
                },
            )
            uploaded_paths.append(path)
            metadata_rows.append({
                "id": attachment_id,
                "message_id": message_id,
                "storage_path": path,
                "original_name": attachment.original_name,
                "content_type": attachment.content_type,
                "size_bytes": len(attachment.content),
            })
        if metadata_rows:
            supabase.table("student_support_attachments").insert(metadata_rows).execute()
        return uploaded_paths
    except Exception:
        if uploaded_paths:
            try:
                supabase.storage.from_(BUCKET).remove(uploaded_paths)
            except Exception:
                logger.exception("Could not roll back support attachment uploads")
        raise


@support_router.get("/courses")
async def list_student_support_courses(
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("student"))],
):
    def load() -> list[dict]:
        enrollments = (
            supabase.table("enrollments")
            .select("course_id")
            .eq("student_id", current_user.id)
            .limit(1000)
            .execute()
        )
        ids = {row["course_id"] for row in (enrollments.data or [])}
        courses = list(_course_map(ids).values())
        teacher_profiles = _profile_map(
            {course["teacher_id"] for course in courses if course.get("teacher_id")}
        )
        return sorted(
            [
                course
                for course in courses
                if teacher_profiles.get(course.get("teacher_id"), {}).get("role") == "teacher"
            ],
            key=lambda course: (course.get("course_code") or "", course.get("section") or 0),
        )

    return {"status": "success", "courses": await run_in_threadpool(load)}


@support_router.get("/requests")
async def list_support_requests(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    if current_user.base_role not in {"student", "teacher"}:
        raise HTTPException(status_code=403, detail="ฟีเจอร์คำร้องใช้ได้เฉพาะนักศึกษาและอาจารย์")

    def load() -> list[dict]:
        query = supabase.table("student_support_requests").select(
            "id, client_token, course_id, student_id, teacher_id, subject, status, created_at, updated_at, last_message_at"
        )
        key = "student_id" if current_user.base_role == "student" else "teacher_id"
        response = query.eq(key, current_user.id).order("last_message_at", desc=True).limit(200).execute()
        return _serialize_requests(response.data or [])

    return {"status": "success", "requests": await run_in_threadpool(load)}


@support_router.get("/requests/{request_id}")
async def get_support_request(
    request_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    detail = await run_in_threadpool(_load_request_detail, str(request_id), current_user)
    return {"status": "success", "request": detail}


@support_router.post("/requests", status_code=201)
async def create_support_request(
    current_user: Annotated[AuthenticatedUser, Depends(require_roles("student"))],
    course_id: Annotated[UUID, Form()],
    subject: Annotated[str, Form(min_length=3, max_length=160)],
    message: Annotated[str, Form(max_length=4000)] = "",
    client_token: Annotated[UUID | None, Form()] = None,
    attachments: Annotated[list[UploadFile] | None, File()] = None,
):
    if client_token is None:
        raise HTTPException(status_code=422, detail="ไม่พบรหัสป้องกันการส่งซ้ำ")
    subject_text = subject.strip()
    if len(subject_text) < 3:
        raise HTTPException(status_code=422, detail="หัวข้อคำร้องต้องมีอย่างน้อย 3 ตัวอักษร")
    body = message.strip()
    files = await _validate_attachments(attachments or [])
    if not body and not files:
        raise HTTPException(status_code=400, detail="กรุณาพิมพ์ข้อความหรือแนบไฟล์อย่างน้อยหนึ่งรายการ")

    token = str(client_token)
    existing = await run_in_threadpool(
        lambda: supabase.table("student_support_requests")
        .select("id")
        .eq("client_token", token)
        .eq("student_id", current_user.id)
        .limit(1)
        .execute()
    )
    if existing.data:
        detail = await run_in_threadpool(_load_request_detail, existing.data[0]["id"], current_user)
        return {"status": "success", "request": detail, "duplicate": True}

    course_key = str(course_id)

    def create() -> dict:
        enrollment = (
            supabase.table("enrollments")
            .select("course_id")
            .eq("course_id", course_key)
            .eq("student_id", current_user.id)
            .limit(1)
            .execute()
        )
        if not enrollment.data:
            raise HTTPException(status_code=403, detail="ส่งคำร้องได้เฉพาะรายวิชาที่ลงทะเบียน")
        course_response = (
            supabase.table("courses")
            .select("id, teacher_id")
            .eq("id", course_key)
            .limit(1)
            .execute()
        )
        if not course_response.data:
            raise HTTPException(status_code=404, detail="ไม่พบรายวิชานี้")
        teacher_id = course_response.data[0].get("teacher_id")
        if not teacher_id:
            raise HTTPException(status_code=409, detail="รายวิชานี้ยังไม่มีอาจารย์ผู้รับผิดชอบ")
        teacher_profile = _profile_map({teacher_id}).get(teacher_id)
        if not teacher_profile or teacher_profile.get("role") != "teacher":
            raise HTTPException(
                status_code=409,
                detail="รายวิชานี้ยังไม่มีอาจารย์ผู้รับผิดชอบที่รับคำร้องได้",
            )
        request_id = str(uuid4())
        message_id = str(uuid4())
        stored_paths: list[str] = []
        try:
            supabase.table("student_support_requests").insert({
                "id": request_id,
                "client_token": token,
                "course_id": course_key,
                "student_id": current_user.id,
                "teacher_id": teacher_id,
                "subject": subject_text,
            }).execute()
            supabase.table("student_support_messages").insert({
                "id": message_id,
                "client_token": token,
                "request_id": request_id,
                "sender_id": current_user.id,
                "body": body or None,
            }).execute()
            stored_paths = _store_attachments(request_id, message_id, files)
            return _load_request_detail(request_id, current_user)
        except HTTPException:
            supabase.table("student_support_requests").delete().eq("id", request_id).execute()
            raise
        except Exception as exc:
            if stored_paths:
                try:
                    supabase.storage.from_(BUCKET).remove(stored_paths)
                except Exception:
                    logger.exception("Could not roll back completed support uploads")
            try:
                supabase.table("student_support_requests").delete().eq("id", request_id).execute()
            except Exception:
                logger.exception("Could not roll back failed support request")
            if _api_error_code(exc) == "23505":
                duplicate = (
                    supabase.table("student_support_requests")
                    .select("id")
                    .eq("client_token", token)
                    .eq("student_id", current_user.id)
                    .limit(1)
                    .execute()
                )
                if duplicate.data:
                    return _load_request_detail(duplicate.data[0]["id"], current_user)
            raise

    try:
        detail = await run_in_threadpool(create)
        return {"status": "success", "request": detail}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Support request creation failed")
        raise HTTPException(status_code=503, detail="ส่งคำร้องไม่สำเร็จ กรุณาลองใหม่") from exc


@support_router.post("/requests/{request_id}/messages", status_code=201)
async def send_support_message(
    request_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    message: Annotated[str, Form(max_length=4000)] = "",
    client_token: Annotated[UUID | None, Form()] = None,
    attachments: Annotated[list[UploadFile] | None, File()] = None,
):
    if client_token is None:
        raise HTTPException(status_code=422, detail="ไม่พบรหัสป้องกันการส่งซ้ำ")
    body = message.strip()
    files = await _validate_attachments(attachments or [])
    if not body and not files:
        raise HTTPException(status_code=400, detail="กรุณาพิมพ์ข้อความหรือแนบไฟล์อย่างน้อยหนึ่งรายการ")
    request_key, token = str(request_id), str(client_token)

    def send() -> dict:
        request_row = _load_request_for_participant(request_key, current_user)
        duplicate = (
            supabase.table("student_support_messages")
            .select("id")
            .eq("client_token", token)
            .eq("request_id", request_key)
            .limit(1)
            .execute()
        )
        if duplicate.data:
            return _load_request_detail(request_key, current_user)
        message_id = str(uuid4())
        stored_paths: list[str] = []
        try:
            supabase.table("student_support_messages").insert({
                "id": message_id,
                "client_token": token,
                "request_id": request_key,
                "sender_id": current_user.id,
                "body": body or None,
            }).execute()
            stored_paths = _store_attachments(request_key, message_id, files)
            if request_row.get("status") == "resolved" and current_user.id == request_row.get("student_id"):
                supabase.table("student_support_requests").update({"status": "open"}).eq("id", request_key).execute()
            return _load_request_detail(request_key, current_user)
        except Exception:
            if stored_paths:
                try:
                    supabase.storage.from_(BUCKET).remove(stored_paths)
                except Exception:
                    logger.exception("Could not roll back completed support message uploads")
            try:
                supabase.table("student_support_messages").delete().eq("id", message_id).execute()
            except Exception:
                logger.exception("Could not roll back failed support message")
            raise

    try:
        detail = await run_in_threadpool(send)
        return {"status": "success", "request": detail}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Support message creation failed")
        raise HTTPException(status_code=503, detail="ส่งข้อความไม่สำเร็จ กรุณาลองใหม่") from exc


@support_router.patch("/requests/{request_id}/status")
async def update_support_request_status(
    request_id: UUID,
    payload: RequestStatusUpdate,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    if payload.status not in {"open", "resolved"}:
        raise HTTPException(status_code=422, detail="สถานะคำร้องไม่ถูกต้อง")

    def update() -> dict:
        request_row = _load_request_for_participant(str(request_id), current_user)
        if payload.status == "resolved" and current_user.id != request_row.get("teacher_id"):
            raise HTTPException(status_code=403, detail="เฉพาะอาจารย์ผู้รับผิดชอบเท่านั้นที่ปิดคำร้องได้")
        if payload.status == "open" and current_user.id != request_row.get("student_id"):
            raise HTTPException(status_code=403, detail="เฉพาะนักศึกษาเจ้าของคำร้องเท่านั้นที่เปิดคำร้องอีกครั้งได้")
        supabase.table("student_support_requests").update({
            "status": payload.status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", str(request_id)).execute()
        return _load_request_detail(str(request_id), current_user)

    return {"status": "success", "request": await run_in_threadpool(update)}


@support_router.get("/attachments/{attachment_id}/preview")
async def preview_support_attachment(
    attachment_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    def load() -> tuple[dict, bytes]:
        response = (
            supabase.table("student_support_attachments")
            .select("id, message_id, storage_path, original_name, content_type, size_bytes")
            .eq("id", str(attachment_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบไฟล์แนบ")
        attachment = response.data[0]
        message = (
            supabase.table("student_support_messages")
            .select("request_id")
            .eq("id", attachment["message_id"])
            .limit(1)
            .execute()
        )
        if not message.data:
            raise HTTPException(status_code=404, detail="ไม่พบข้อความของไฟล์แนบ")
        _load_request_for_participant(message.data[0]["request_id"], current_user)
        content = supabase.storage.from_(BUCKET).download(attachment["storage_path"])
        return attachment, content

    try:
        attachment, content = await run_in_threadpool(load)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Support attachment preview failed")
        raise HTTPException(status_code=503, detail="เปิดตัวอย่างไฟล์ไม่สำเร็จ") from exc
    return StreamingResponse(
        io.BytesIO(content),
        media_type=attachment["content_type"],
        headers={
            "Content-Disposition": inline_content_disposition(attachment["original_name"]),
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Cross-Origin-Resource-Policy": "same-origin",
        },
    )
