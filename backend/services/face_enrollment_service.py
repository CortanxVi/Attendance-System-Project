from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import math
import uuid

from fastapi import HTTPException, status

from core.config import FACE_ENROLLMENT_CHALLENGE_SECONDS, supabase_db
from services.liveness_service import LivenessChallenge, create_liveness_challenge


def issue_face_enrollment_challenge(user_id: str, student_id: str) -> tuple[str, datetime, LivenessChallenge]:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=FACE_ENROLLMENT_CHALLENGE_SECONDS)
    challenge_id = str(uuid.uuid4())

    profile_response = (
        supabase_db.table("profiles")
        .select("id, face_registered")
        .eq("id", user_id)
        .eq("student_id", student_id)
        .execute()
    )
    if not profile_response.data:
        raise HTTPException(status_code=404, detail="ไม่พบโปรไฟล์นักศึกษาที่ตรงกับบัญชีนี้")
    if profile_response.data[0].get("face_registered"):
        raise HTTPException(
            status_code=409,
            detail="บัญชีนี้ลงทะเบียนใบหน้าแล้ว หากต้องการเปลี่ยนข้อมูลกรุณาติดต่อผู้ดูแลระบบ",
        )

    # Keep only one unconsumed token per account. Issuing a fresh challenge
    # invalidates an older unfinished one and bounds challenge spam.
    supabase_db.table("face_enrollment_challenges").delete().eq(
        "student_user_id", user_id
    ).is_("consumed_at", "null").execute()
    response = supabase_db.table("face_enrollment_challenges").insert(
        {
            "id": challenge_id,
            "student_user_id": user_id,
            "student_id": student_id,
            "expires_at": expires_at.isoformat(),
        }
    ).execute()
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="สร้างสิทธิ์ตรวจสอบใบหน้าสำหรับลงทะเบียนไม่สำเร็จ กรุณาลองใหม่",
        )
    return challenge_id, expires_at, create_liveness_challenge(challenge_id, user_id, expires_at)


def load_face_enrollment_challenge(challenge_id: str, user_id: str, student_id: str) -> dict:
    response = (
        supabase_db.table("face_enrollment_challenges")
        .select("id, student_user_id, student_id, expires_at, consumed_at")
        .eq("id", challenge_id)
        .eq("student_user_id", user_id)
        .eq("student_id", student_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=403, detail="ไม่พบสิทธิ์ Liveness สำหรับลงทะเบียนใบหน้า")
    challenge = response.data[0]
    if challenge.get("consumed_at"):
        raise HTTPException(status_code=409, detail="สิทธิ์ลงทะเบียนใบหน้านี้ถูกใช้แล้ว")
    expires_at = datetime.fromisoformat(str(challenge["expires_at"]).replace("Z", "+00:00"))
    if datetime.now(timezone.utc) >= expires_at:
        raise HTTPException(status_code=400, detail="สิทธิ์ลงทะเบียนใบหน้าหมดอายุ กรุณาเริ่มตรวจใหม่")
    return challenge


def claim_face_enrollment_challenge(challenge_id: str, user_id: str, claim_token: str) -> None:
    response = supabase_db.rpc(
        "claim_face_enrollment_challenge",
        {
            "target_challenge_id": challenge_id,
            "target_user_id": user_id,
            "claim_token": claim_token,
        },
    ).execute()
    result = response.data if isinstance(response.data, dict) else {}
    outcome = result.get("result")
    if outcome == "claimed":
        return
    messages = {
        "challenge_invalid": (403, "ไม่พบสิทธิ์ Liveness สำหรับลงทะเบียนใบหน้า"),
        "challenge_used": (409, "สิทธิ์ลงทะเบียนใบหน้านี้ถูกใช้แล้ว"),
        "challenge_expired": (400, "สิทธิ์ลงทะเบียนใบหน้าหมดอายุ กรุณาเริ่มตรวจใหม่"),
        "challenge_busy": (409, "คำขอลงทะเบียนนี้กำลังประมวลผลอยู่ กรุณารอผลเดิม"),
    }
    code, detail = messages.get(outcome, (503, "ไม่สามารถล็อกคำขอลงทะเบียนใบหน้าได้"))
    raise HTTPException(status_code=code, detail=detail)


def release_face_enrollment_challenge(challenge_id: str, user_id: str, claim_token: str) -> None:
    supabase_db.rpc(
        "release_face_enrollment_challenge",
        {
            "target_challenge_id": challenge_id,
            "target_user_id": user_id,
            "claim_token": claim_token,
        },
    ).execute()


def renew_face_enrollment_challenge(challenge_id: str, user_id: str, claim_token: str) -> bool:
    response = supabase_db.rpc(
        "renew_face_enrollment_challenge",
        {
            "target_challenge_id": challenge_id,
            "target_user_id": user_id,
            "claim_token": claim_token,
        },
    ).execute()
    return response.data is True


def finalize_face_enrollment(
    challenge_id: str,
    user_id: str,
    student_id: str,
    embedding: list[float],
    claim_token: str,
) -> None:
    if len(embedding) != 512 or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
        for value in embedding
    ):
        raise HTTPException(status_code=422, detail="เวกเตอร์ใบหน้าที่ตรวจสอบแล้วมีรูปแบบไม่ถูกต้อง")
    response = supabase_db.rpc(
        "finalize_face_enrollment",
        {
            "target_challenge_id": challenge_id,
            "target_user_id": user_id,
            "target_student_id": student_id,
            "target_embedding": json.dumps(embedding, separators=(",", ":")),
            "claim_token": claim_token,
        },
    ).execute()
    result = response.data if isinstance(response.data, dict) else {}
    outcome = result.get("result")
    if outcome == "registered":
        return
    messages = {
        "challenge_invalid": (403, "ไม่พบสิทธิ์ Liveness สำหรับลงทะเบียนใบหน้า"),
        "challenge_used": (409, "สิทธิ์ลงทะเบียนใบหน้านี้ถูกใช้แล้ว"),
        "challenge_expired": (400, "สิทธิ์ลงทะเบียนใบหน้าหมดอายุ กรุณาเริ่มตรวจใหม่"),
        "claim_invalid": (409, "สถานะคำขอลงทะเบียนเปลี่ยนไป กรุณาเริ่มตรวจใหม่"),
        "profile_missing": (404, "ไม่พบโปรไฟล์นักศึกษาที่ตรงกับบัญชีนี้"),
        "already_registered": (409, "บัญชีนี้ลงทะเบียนใบหน้าแล้ว กรุณาติดต่อผู้ดูแลระบบหากต้องการเปลี่ยนข้อมูล"),
    }
    code, detail = messages.get(outcome, (503, "บันทึกข้อมูลใบหน้าไม่สำเร็จชั่วคราว"))
    raise HTTPException(status_code=code, detail=detail)
