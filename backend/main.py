import numpy as np
import cv2
import os
import re
import json
import uuid
import asyncio
import io
from PIL import Image, ImageOps
from fastapi import Depends, FastAPI, File, UploadFile, Form, HTTPException, status, APIRouter
from starlette.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Annotated
from enum import Enum
from datetime import datetime, timedelta, timezone

from core.authorization import (
    require_course_delete_permission,
    require_course_enrollment,
    require_owned_course,
    require_owned_session,
)
from core.config import (
    CORS_ORIGINS,
    QR_CHALLENGE_SECONDS,
    QR_REFRESH_SECONDS,
    TEMP_ADMIN_ENROLLMENT_SECONDS,
    TEMP_ADMIN_GRANT_SECONDS,
    supabase_db as supabase,
)
from core.security import AuthenticatedUser, get_current_user, require_roles
from services.light_ocr_service import extract_student_id, read_validated_image
from services.insightface_service import face_service

# นำเข้า Router สำหรับ Admin
from routers.admin import admin_router
# นำเข้า Router สำหรับนักศึกษา (หน้าประวัติ + สถิติ)
from routers.student import student_router
# นำเข้า Router สำหรับอาจารย์
from routers.teacher import teacher_router
from routers.temporary_admin import router as temporary_admin_router

class NFCRegisterRequest(BaseModel):
    student_id: str
    nfc_uid: str

class NFCCheckInRequest(BaseModel):
    nfc_uid: str
    session_id: str

# 🌟 1. กำหนด Enum ให้ค่าตรงกับที่ Supabase ต้องการเป๊ะๆ (ตัวพิมพ์เล็ก)
class SessionStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"

class SessionStartRequest(BaseModel):
    course_id: str


class QRValidationRequest(BaseModel):
    token: str

# เพิ่ม Model สำหรับรับค่าเพิ่มรายวิชาเรียน
class CourseCreateRequest(BaseModel):
    course_code: str
    course_name: str
    section: int
    year: int
    semester: int

# Model สำหรับรับค่าอัปเดตเกณฑ์คะแนน
class CourseSettingsRequest(BaseModel):
    total_sessions: int
    late_threshold_minutes: int
    absent_threshold_minutes: int
    max_absence_percent: int

# Model สำหรับแก้ไขข้อมูลวิชา
class CourseUpdateRequest(BaseModel):
    course_code: str
    course_name: str
    section: int
    semester: int
    year: int

app = FastAPI(title="KMUTNB Face Recognition API")
router = APIRouter()

# เกณฑ์คะแนนความเหมือนใบหน้า (0.45 - 0.50 ถือว่าแม่นยำและปลอดภัยสูงสำหรับ CPU)
FACE_THRESHOLD = 0.45
SUPABASE_ERROR_MESSAGES = {
    '23505': 'นักศึกษาเช็คชื่อในคาบนี้ไปแล้ว',
    '23503': 'ไม่พบ session หรือนักศึกษาในระบบ',
    '23502': 'ข้อมูลไม่ครบถ้วน กรุณาลองใหม่',
    '42501': 'ไม่มีสิทธิ์ดำเนินการ (RLS policy)',
    'PGRST116': 'ไม่พบข้อมูลในฐานข้อมูล',
}

# เปิด CORS เพื่อให้ Frontend (localhost) ยิงหาหลังบ้านได้
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Grant"],
)

app.include_router(admin_router)
app.include_router(student_router)
app.include_router(teacher_router)
app.include_router(temporary_admin_router)


@app.get("/api/v1/auth/me")
async def get_authenticated_profile(
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return {"status": "success", "user": current_user.model_dump()}


@app.get("/api/v1/system/config")
async def get_runtime_config(
    _current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    return {
        "status": "success",
        "qr_refresh_seconds": QR_REFRESH_SECONDS,
        "qr_challenge_seconds": QR_CHALLENGE_SECONDS,
        "temporary_admin_grant_seconds": TEMP_ADMIN_GRANT_SECONDS,
        "temporary_admin_enrollment_seconds": TEMP_ADMIN_ENROLLMENT_SECONDS,
        "ocr_provider": "Light OCR Node.js",
        "attendance_methods": ["face_ocr", "nfc", "manual"],
        "email_policy": "KMUTNB Google accounts only",
    }


@app.post("/api/v1/ocr/student-card")
async def read_student_card(
    image: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_roles("student", "admin")),
):
    uploaded = await read_validated_image(image, "ภาพบัตรนักศึกษา")
    student_id = await extract_student_id(uploaded)
    if current_user.role == "student" and student_id != current_user.student_id:
        raise HTTPException(status_code=403, detail="รหัสบนบัตรไม่ตรงกับบัญชีที่เข้าสู่ระบบ")
    return {"success": True, "foundId": student_id}

def bytes_to_cv2_image(image_bytes: bytes) -> np.ndarray:
    """
    แปลงไฟล์ bytes จากหน้าบ้านให้เป็นภาพ BGR สำหรับ OpenCV

    🌟 [แก้ไข] เพิ่มการแก้ไข EXIF Orientation ก่อนแปลงเป็นภาพ
    เหตุผล: ภาพถ่ายจากมือถือหลายรุ่น (โดยเฉพาะตอนถ่ายแนวตั้ง) จะไม่หมุนพิกเซลจริง แต่จะแนบ
    EXIF tag บอกทิศทางที่ควรหมุนตอนแสดงผลแทน เบราว์เซอร์/แอปดูรูปจะหมุนให้อัตโนมัติตาม tag นี้
    ทำให้ผู้ใช้เห็นภาพหน้าตรงปกติในหน้าพรีวิว แต่ cv2.imdecode (วิธีเดิม) ไม่รู้จัก EXIF เลย
    จะอ่านพิกเซลดิบตามที่บันทึกจริง ซึ่งอาจเอียง/หมุนไป 90/180/270 องศาโดยไม่รู้ตัว ส่งผลให้
    โมเดล AI ตรวจจับใบหน้าผิดพลาด (คะแนนความชัดตก หรือเจอจุดปลอมถูกตีความเป็นใบหน้าที่ 2)

    วิธีแก้: ใช้ Pillow เปิดภาพ แล้วเรียก ImageOps.exif_transpose() เพื่อหมุนพิกเซลจริง
    ให้ตรงกับที่ EXIF ระบุไว้ก่อน ค่อยแปลงเป็น array ให้ OpenCV ใช้งานต่อ
    """
    try:
        # เปิดภาพด้วย Pillow (อ่านค่า EXIF ได้ ต่างจาก cv2.imdecode)
        pil_image = Image.open(io.BytesIO(image_bytes))
        # หมุนพิกเซลจริงตามค่า EXIF Orientation แล้วลบ EXIF tag ทิ้ง (กันไม่ให้ถูกหมุนซ้ำที่อื่น)
        pil_image = ImageOps.exif_transpose(pil_image)
        # แปลงเป็นโหมดสี RGB เสมอ กันกรณีภาพเป็น RGBA/Grayscale/CMYK ที่ถ้าแปลงตรงๆ สีจะเพี้ยน
        pil_image = pil_image.convert("RGB")
        # Pillow ให้ค่าสีแบบ RGB แต่ OpenCV ใช้ลำดับสีแบบ BGR จึงต้องสลับช่องสีก่อนส่งต่อ
        rgb_array = np.array(pil_image)
        return cv2.cvtColor(rgb_array, cv2.COLOR_RGB2BGR)
    except Exception as e:
        # 🛡️ Fallback: ถ้า Pillow เปิดไฟล์ไม่ได้ไม่ว่าด้วยเหตุผลใด (ไฟล์เสีย/ฟอร์แมตแปลกๆ)
        # ให้ใช้วิธีเดิม (cv2.imdecode) แทน เพื่อไม่ให้ทั้งระบบพังเพราะไฟล์เดียว
        print(f"⚠️ อ่านภาพแบบรู้จัก EXIF ไม่สำเร็จ กำลังใช้วิธีสำรอง: {str(e)}")
        nparr = np.frombuffer(image_bytes, np.uint8)
        return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def resize_image_if_needed(img: np.ndarray, max_dimension: int = 1280) -> np.ndarray:
    """
    🌟 [เพิ่มใหม่] ย่อขนาดภาพก่อนส่งเข้าโมเดล AI ถ้าด้านที่ยาวที่สุดเกิน max_dimension พิกเซล
    เหตุผล: รูปถ่ายจากกล้องมือถือมักมีความละเอียดสูงมาก (เช่น 3000x4000 พิกเซลขึ้นไป) ทั้งที่
    Light OCR และ InsightFace ไม่ได้ต้องการความละเอียดขนาดนั้นเพื่อความแม่นยำ ยิ่งภาพใหญ่ยิ่งใช้เวลา
    ประมวลผลนานขึ้นโดยไม่จำเป็น ย่อขนาดลงมาก่อนจะช่วยลดเวลาประมวลผลได้ชัดเจน โดยความคมชัดยังพอ
    สำหรับอ่านตัวเลขบนบัตร/จดจำใบหน้าอยู่ (ถ้าพบว่า OCR อ่านผิดบ่อยขึ้น ให้ลองปรับค่านี้ให้สูงขึ้นได้)
    """
    height, width = img.shape[:2]
    longest_side = max(height, width)
    if longest_side <= max_dimension:
        return img  # ภาพเล็กพออยู่แล้ว ไม่ต้องย่อ
    scale = max_dimension / longest_side
    new_size = (int(width * scale), int(height * scale))
    return cv2.resize(img, new_size, interpolation=cv2.INTER_AREA)

def calculate_attendance_status(session_created_at: str, late_threshold_minutes: int, absent_threshold_minutes: int) -> tuple[str, float]:
    """
    🌟 ฟังก์ชันกลาง: คำนวณว่านักศึกษา "มาเรียน / มาสาย / ขาดเรียน" จากเวลาที่ผ่านไปนับตั้งแต่เปิดคาบ
    เทียบกับเกณฑ์ที่อาจารย์/แอดมินตั้งไว้ในตาราง courses (late_threshold_minutes, absent_threshold_minutes)

    ใช้ร่วมกันทั้งจุดเช็คชื่อด้วย QR (/api/v1/attendance/checkin) และสแกนหน้า+บัตร (/api/v1/attendance/verify)
    เพื่อไม่ให้ต้องเขียนตรรกะเดิมซ้ำสองที่

    คืนค่าเป็น (สถานะ, จำนวนนาทีที่ผ่านไป)
    """
    session_start_time = datetime.fromisoformat(session_created_at.replace('Z', '+00:00'))
    current_time = datetime.now(timezone.utc)
    minutes_diff = (current_time - session_start_time).total_seconds() / 60

    if minutes_diff > absent_threshold_minutes:
        return "absent", round(minutes_diff, 2)
    elif minutes_diff > late_threshold_minutes:
        return "late", round(minutes_diff, 2)
    return "present", round(minutes_diff, 2)

def parse_supabase_error(error_str_or_dict) -> str:
    """
    ฟังก์ชันช่วยแปลง Error จาก Supabase/PostgreSQL ให้เป็นข้อความที่ผู้ใช้งานทั่วไปเข้าใจได้ง่ายขึ้น
    """
    try:
        import ast
        # กรณีที่ error ส่งมาเป็น string แต่มีหน้าตาเหมือน dict (เช่น "{'message': '...'}")
        if isinstance(error_str_or_dict, str) and error_str_or_dict.startswith("{"):
            error_dict = ast.literal_eval(error_str_or_dict)
        elif isinstance(error_str_or_dict, dict):
            error_dict = error_str_or_dict
        else:
            return str(error_str_or_dict)

        code = error_dict.get("code")
        
        # 🌟 คลังคำศัพท์ Error ภาษาไทยที่พบบ่อย 🌟
        if code == "23505":
            return "นักศึกษาคนนี้ได้ทำการเช็คชื่อในคาบเรียนนี้ไปเรียบร้อยแล้ว (ข้อมูลซ้ำ)"
        elif code == "23503":
            return "ข้อมูลอ้างอิงไม่ถูกต้อง (ไม่พบรหัสนักศึกษาหรือรหัสห้องเรียนนี้ในระบบ)"
        elif code == "23502":
            return "ข้อมูลไม่ครบถ้วน (มีช่องว่างที่ฐานข้อมูลบังคับให้ต้องกรอก)"
        
        # ถ้าหาโค้ดไม่เจอ ให้ดึงเอาข้อความ Details ภาษาอังกฤษมาผสมกัน
        return f"ข้อผิดพลาดฐานข้อมูล ({code}): {error_dict.get('message', 'Unknown Error')}"

    except Exception:
        # ถ้าเกิดแปลงร่างไม่สำเร็จ ก็ส่งกลับไปดิบๆ เพื่อป้องกันระบบพังซ้ำซ้อน
        return str(error_str_or_dict)


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def ensure_qr_token_is_current(session_row: dict, token: str) -> None:
    if session_row.get("status") != "open":
        raise HTTPException(status_code=400, detail="คาบเรียนนี้ปิดระบบเช็คชื่อไปแล้ว")
    if session_row.get("qr_token") != token:
        raise HTTPException(status_code=400, detail="QR Code หมดอายุแล้ว กรุณาสแกน QR ล่าสุด")

    rotated_at = session_row.get("qr_token_rotated_at")
    refresh_seconds = int(session_row.get("qr_refresh_rate_seconds") or QR_REFRESH_SECONDS)
    if not rotated_at or datetime.now(timezone.utc) > parse_utc(rotated_at) + timedelta(seconds=refresh_seconds):
        raise HTTPException(status_code=400, detail="QR Code หมดอายุแล้ว กรุณาสแกน QR ล่าสุด")


def load_valid_challenge(challenge_id: str, current_user: AuthenticatedUser) -> dict:
    response = (
        supabase.table("attendance_checkin_challenges")
        .select("id, session_id, student_id, expires_at, consumed_at")
        .eq("id", challenge_id)
        .eq("student_id", current_user.id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=403, detail="ไม่พบสิทธิ์เช็คชื่อจากการสแกน QR")
    challenge = response.data[0]
    if challenge.get("consumed_at"):
        raise HTTPException(status_code=409, detail="สิทธิ์จาก QR นี้ถูกใช้เช็คชื่อแล้ว")
    if datetime.now(timezone.utc) >= parse_utc(challenge["expires_at"]):
        raise HTTPException(status_code=400, detail="สิทธิ์จาก QR หมดอายุ กรุณาสแกน QR ใหม่")
    return challenge

@app.post("/api/v1/enrollment/register-face")
async def register_face(
    student_id: str = Form(...),
    face_image: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_roles("student", "admin")),
):
    try:
        target_student_id = student_id.strip()
        if current_user.role == "student":
            if not current_user.student_id:
                raise HTTPException(status_code=409, detail="บัญชีนี้ยังไม่มีรหัสนักศึกษา กรุณาติดต่อผู้ดูแลระบบ")
            if target_student_id != current_user.student_id:
                raise HTTPException(status_code=403, detail="ลงทะเบียนใบหน้าได้เฉพาะบัญชีของตนเอง")

        face_upload = await read_validated_image(face_image, "ภาพใบหน้า")
        img_selfie = bytes_to_cv2_image(face_upload.content)
        if img_selfie is None:
            raise HTTPException(status_code=400, detail="ไฟล์ภาพใบหน้าเสียหรืออ่านไม่ได้")

        # 🌟 [แก้ไข] ย่อขนาดภาพก่อนส่งเข้าโมเดล เหมือนกับที่ endpoint verify ทำอยู่แล้ว
        # เหตุผล: เดิม endpoint นี้ไม่ได้ย่อขนาดภาพเลย ทำให้ภาพความละเอียดสูงมากจากกล้องมือถือ
        # (เช่น 3000x4000 พิกเซลขึ้นไป) ถูกส่งเข้าโมเดลตรงๆ นอกจากจะช้าลงโดยไม่จำเป็นแล้ว ภาพที่มี
        # รายละเอียดพื้นหลังเยอะๆ ยังเพิ่มโอกาสที่โมเดลจะตรวจจับจุดที่ไม่ใช่ใบหน้าจริงผิดพลาดเป็น
        # "คนที่ 2" ได้ง่ายขึ้นด้วย การย่อขนาดให้เท่ากับฝั่ง verify ช่วยให้พฤติกรรมของทั้งสอง endpoint
        # สอดคล้องกัน และลดปัญหานี้ลง
        img_selfie = resize_image_if_needed(img_selfie)

        # 2. ส่งภาพไปให้ Service ประมวลผลและเช็คกฎเกณฑ์
        embedding_list, error_msg = face_service.extract_face_for_registration(img_selfie)
        
        # ถ้าติดเงื่อนไข (ไม่เจอหน้า/หน้าซ้อน) ให้เตะออกทันที
        if error_msg:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)
        
        # 3. อัปเดต Vector ใบหน้าลงตาราง profiles โดยผูกกับ student_id (ที่เป็น Text ตามโครงสร้างจริง)
        response = supabase.table('profiles').update({
            'face_registered': True,
            'face_embedding': embedding_list
        }).eq('student_id', target_student_id).execute()
        
        # หากค้นหาเลข 13 หลักในตารางโปรไฟล์แล้วไม่เจอใครเลย
        if len(response.data) == 0:
             raise HTTPException(
                 status_code=status.HTTP_404_NOT_FOUND, 
                 detail=f"ไม่พบข้อมูลรหัสนักศึกษา {target_student_id} ในระบบ กรุณาติดต่อผู้ดูแลระบบ"
             )

        return {
            "success": True,
            "student_id": target_student_id,
            "message": f"ลงทะเบียนใบหน้าของรหัสนักศึกษา {target_student_id} สำเร็จ"
        }
        
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="เกิดข้อผิดพลาดภายในระบบ"
        )

@app.post("/api/v1/attendance/verify")
async def verify_FaceReg_OCR_attendance(
    face_image: UploadFile = File(...),
    id_card_image: UploadFile = File(...),
    challenge_id: str = Form(...),
    current_user: AuthenticatedUser = Depends(require_roles("student")),
):
    try:
        if not current_user.student_id:
            raise HTTPException(status_code=409, detail="บัญชีนี้ยังไม่มีรหัสนักศึกษา กรุณาติดต่อผู้ดูแลระบบ")

        challenge = await run_in_threadpool(load_valid_challenge, challenge_id, current_user)
        session_id = challenge["session_id"]
        session_res = await run_in_threadpool(
            lambda: supabase.table("attendance_sessions")
            .select("id, course_id, status, created_at, courses(late_threshold_minutes, absent_threshold_minutes)")
            .eq("id", session_id)
            .execute()
        )
        if not session_res.data or session_res.data[0].get("status") != "open":
            raise HTTPException(status_code=400, detail="คาบเรียนนี้ปิดระบบเช็คชื่อแล้ว")
        await run_in_threadpool(
            require_course_enrollment,
            session_res.data[0]["course_id"],
            current_user.id,
        )

        consumed_at = datetime.now(timezone.utc).isoformat()
        consumed = await run_in_threadpool(
            lambda: supabase.table("attendance_checkin_challenges")
            .update({"consumed_at": consumed_at})
            .eq("id", challenge_id)
            .eq("student_id", current_user.id)
            .is_("consumed_at", "null")
            .execute()
        )
        if not consumed.data:
            raise HTTPException(status_code=409, detail="สิทธิ์จาก QR นี้ถูกใช้แล้ว กรุณาสแกน QR ใหม่")

        face_upload, card_upload = await asyncio.gather(
            read_validated_image(face_image, "ภาพใบหน้าสด"),
            read_validated_image(id_card_image, "ภาพบัตรนักศึกษา"),
        )
        img_live = bytes_to_cv2_image(face_upload.content)
        if img_live is None:
            raise HTTPException(status_code=400, detail="ไฟล์ภาพใบหน้าสดเสียหรืออ่านไม่ได้")
        img_live = resize_image_if_needed(img_live)

        emb_live, extracted_student_id = await asyncio.gather(
            run_in_threadpool(face_service.extract_face_embedding, img_live),
            extract_student_id(card_upload),
        )

        if emb_live is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="ตรวจไม่พบใบหน้าในภาพสแกนสด กรุณาหันหน้าเข้าหากล้องตรงๆ"
            )

        if extracted_student_id != current_user.student_id:
            raise HTTPException(
                status_code=403,
                detail="รหัสบนบัตรไม่ตรงกับบัญชีที่เข้าสู่ระบบ",
            )

        db_response = await run_in_threadpool(
            lambda: supabase.table('profiles')
            .select('id, student_id, face_embedding, full_name')
            .eq('id', current_user.id)
            .execute()
        )
        
        if len(db_response.data) == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, 
                detail=f"ไม่พบรหัสนักศึกษา {extracted_student_id} ในระบบฐานข้อมูลโปรไฟล์"
            )
            
        profile_uuid = current_user.id
        full_name = db_response.data[0].get('full_name') or extracted_student_id

        
        registered_embedding_data = db_response.data[0].get('face_embedding')
        if not registered_embedding_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="นักศึกษาท่านนี้ยังไม่ได้ลงทะเบียนใบหน้าตั้งต้นในระบบ"
            )

        # 🌟 ล้างข้อมูลและแปลงเป็น Numpy Array (Float32) 🌟
        if isinstance(registered_embedding_data, str):
            clean_str = registered_embedding_data.replace('{', '[').replace('}', ']')
            registered_embedding_list = json.loads(clean_str)
        else:
            registered_embedding_list = registered_embedding_data

        registered_embedding = np.array(registered_embedding_list, dtype=np.float32)

        # ─── STEP 5: เปรียบเทียบใบหน้าสด กับ ใบหน้าในฐานข้อมูลโดยตรง ───
        similarity_score = face_service.calculate_similarity(emb_live, registered_embedding)

        # ตรวจสอบเกณฑ์คะแนน
        if similarity_score < FACE_THRESHOLD:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, 
                detail=f"การยืนยันตัวตนล้มเหลว ใบหน้าไม่ตรงกับข้อมูลที่ลงทะเบียนไว้ (Score: {round(similarity_score, 4)})"
            )

        session_row = session_res.data[0]
        course_cfg = session_row.get('courses') or {}
        calculated_status, _minutes_diff = calculate_attendance_status(
            session_row['created_at'],
            course_cfg.get('late_threshold_minutes') or 15,
            course_cfg.get('absent_threshold_minutes') or 45,
        )

        attendance_data = {
            'student_id': profile_uuid,
            'status': calculated_status,
            'method': 'face_ocr', # face_ocr, nfc, manual 
            'similarity_score': round(similarity_score, 4),
            'check_in_time': datetime.now(timezone.utc).isoformat(),
        }
        attendance_data['session_id'] = session_id

        # 🌟 [แก้ใหม่] ห่อด้วย run_in_threadpool เช่นกัน (จุดสุดท้ายที่เหลือของ endpoint นี้)
        await run_in_threadpool(
            lambda: supabase.table('attendance_records').insert(attendance_data).execute()
        )
        # คืนค่าความสำเร็จกลับไปให้หน้าบ้าน (Frontend)
        return {
            "success": True,
            "student_id": extracted_student_id, # ตรงนี้ส่งรหัส 13 หลักกลับไปให้ Frontend โชว์ได้ปกติ
            "student_name": full_name,
            "method": "face_ocr",
            "score": round(similarity_score, 4),
            "calculated_status": calculated_status,  # 🌟 [เพิ่มใหม่] present / late / absent ให้ Frontend โชว์ได้ตรงจริง
            "check_in_time": attendance_data["check_in_time"],
            "message": f"เช็คชื่อคุณ {full_name} สำเร็จเรียบร้อยแล้ว!"
        }

    except Exception as e:
        # หากเกิด HTTPException จากที่เราดักไว้ ให้โยนออกไปตามปกติ
        if isinstance(e, HTTPException):
            raise e
        # หากเกิด Error อื่นๆ ที่คาดไม่ถึง ให้แจ้งข้อผิดพลาดระบบหลังบ้าน
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail="เกิดข้อผิดพลาดภายในระบบ"
        )

@app.post("/api/v1/nfc/register")
async def register_nfc_card(
    payload: NFCRegisterRequest,
    _current_user: AuthenticatedUser = Depends(require_roles("admin")),
):
    try:
        # ทำความสะอาดข้อมูล ตัดช่องว่างหัว-ท้ายออกก่อนนับ
        uid_clean = payload.nfc_uid.strip().upper()
        
        if not re.fullmatch(r"[0-9A-F]{10}", uid_clean):
            raise HTTPException(
                status_code=400, 
                detail="ไม่สามารถลงทะเบียนได้: UID ต้องเป็นเลขฐานสิบหก 10 ตัว"
            )
        
        # where student_id = student_id ที่อ่านค่าได้
        resCheck = supabase.table('profiles') \
            .select("student_id, nfc_uid, full_name") \
            .eq('student_id', payload.student_id) \
            .execute()
        if not resCheck.data:
            raise HTTPException(status_code=404, detail="ไม่พบรหัสนักศึกษาในระบบ กรุณาเพิ่มรายชื่อก่อนผูกบัตร")
        student_data = resCheck.data[0]

        # where nfc_uid = nfc_uid ที่อ่านค่าได้
        card_check = supabase.table('profiles') \
            .select("student_id") \
            .eq('nfc_uid', uid_clean) \
            .execute()

        # รหัสนักศึกษาเลขนี้มีหมายเลข nfc_uid อยู่ในฐานข้อมูลหรือไม่ ถ้ามีคืน error ถ้าไม่มี ปล่อยผ่าน
        if student_data.get('nfc_uid'):
            raise HTTPException(
                status_code=409, # 409 Conflict เหมาะกับกรณีข้อมูลซ้ำ
                detail=f"นักศึกษารหัส {payload.student_id} มีการผูกบัตร NFC ไว้ในระบบเรียบร้อยแล้ว ไม่สามารถผูกซ้ำได้"
            )

        # ดึงค่ารหัสนักศึกษาออกมาดูถ้ามีแสดงว่า nfc_uid ที่อ่านได้ถูกใช้งานไปแล้ว
        if card_check.data:
            raise HTTPException(
                status_code=409,
                detail="บัตร NFC ใบนี้ถูกใช้งานและผูกกับนักศึกษาคนอื่นไปแล้ว กรุณาใช้บัตรใบใหม่"
            )

        response = supabase.table('profiles') \
            .update({'nfc_uid': uid_clean}) \
            .eq('student_id', payload.student_id) \
            .execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบรหัสนักศึกษาในระบบ")
        return {"status": "success",
                "message": f"ผูกบัตร NFC กับรหัส {payload.student_id} สำเร็จ"}
    
    except HTTPException as ea:
        raise ea
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

@app.post("/api/v1/nfc/checkin")
async def nfc_checkin(
    payload: NFCCheckInRequest,
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    try:
        uid_clean = payload.nfc_uid.strip().upper()
        if not re.fullmatch(r"[0-9A-F]{10}", uid_clean):
            raise HTTPException(status_code=400, detail="UID ของบัตรต้องเป็นเลขฐานสิบหก 10 ตัว")
        session = await run_in_threadpool(require_owned_session, payload.session_id, current_user)
        if session.get("status") != "open":
            raise HTTPException(status_code=400, detail="คาบเรียนนี้ปิดระบบเช็คชื่อแล้ว")

        # 1. ตรวจสอบว่าหมายเลขบัตรนี้ตรงกับโปรไฟล์ของใคร
        user_response = supabase.table('profiles') \
            .select('id', 'student_id', 'full_name') \
            .eq('nfc_uid', uid_clean) \
            .execute()
            
        if not user_response.data:
            raise HTTPException(
                status_code=404,
                detail="บัตร NFC ใบนี้ยังไม่ได้ลงทะเบียนในระบบ"
            )
            
        student = user_response.data[0]
        student_uuid = student['id'] # UUID จาก auth.users
        await run_in_threadpool(
            require_course_enrollment,
            session["course_id"],
            student_uuid,
        )

        existing_record = await run_in_threadpool(
            lambda: supabase.table("attendance_records")
            .select("id")
            .eq("session_id", payload.session_id)
            .eq("student_id", student_uuid)
            .limit(1)
            .execute()
        )
        if existing_record.data:
            raise HTTPException(status_code=409, detail="นักศึกษาคนนี้เช็คชื่อในคาบนี้แล้ว")

        course_res = await run_in_threadpool(
            lambda: supabase.table("courses")
            .select("late_threshold_minutes, absent_threshold_minutes")
            .eq("id", session["course_id"])
            .execute()
        )
        course_cfg = course_res.data[0] if course_res.data else {}
        calculated_status, _minutes = calculate_attendance_status(
            session["created_at"],
            course_cfg.get("late_threshold_minutes") or 15,
            course_cfg.get("absent_threshold_minutes") or 45,
        )

        attendance_data = {
            "session_id": payload.session_id,
            "student_id": student_uuid,
            "status": calculated_status,
            "method": "nfc", # face_ocr, nfc, manual 
            "similarity_score": None, # ไม่จำเป็นต้องระบุเพราะไม่ได้ใช้ AI หน้าสแกน
            "check_in_time": datetime.now(timezone.utc).isoformat(),
        }
        
        record_response = supabase.table('attendance_records') \
            .insert(attendance_data) \
            .execute()
            
        if not record_response.data:
            raise HTTPException(
                status_code=400,
                detail="ไม่สามารถบันทึกประวัติการเข้าเรียนลงฐานข้อมูลได้",
            )
        
        return {
            "status": "success",
            "message": "เช็คชื่อผ่าน NFC สำเร็จ",
            "student_info": {
                "student_id": student['student_id'],
                "full_name": student['full_name'],
                "method": "nfc",
                "status": calculated_status,
                "check_in_time": attendance_data["check_in_time"],
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# API สำหรับอาจารย์กดสร้างห้องเรียน (เปิด Session)
@app.post("/api/v1/sessions/start")
async def start_attendance_session(
    payload: SessionStartRequest,
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    try:
        await run_in_threadpool(require_owned_course, payload.course_id, current_user)
        # 🌟 2. เจนเนอเรต Token ก้อนแรกขึ้นมาสำหรับเซสชันนี้
        initial_token = str(uuid.uuid4())

        session_data = {
            "course_id": payload.course_id,
            "opened_by": current_user.id,
            "status": SessionStatus.OPEN.value,
            "qr_token": initial_token,
            "qr_refresh_rate_seconds": QR_REFRESH_SECONDS,
            "qr_token_rotated_at": datetime.now(timezone.utc).isoformat(),
            "grace_period_minutes": 15
        }
        
        response = supabase.table('attendance_sessions').insert(session_data).execute()
        
        if not response.data:
            raise HTTPException(status_code=400, detail="ไม่สามารถสร้างห้องเรียนได้")
            
        new_session_id = response.data[0]['id']
        
        return {
            "status": "success",
            "message": "เปิดระบบเช็คชื่อสำเร็จ",
            "session_id": new_session_id,
            "qr_token": initial_token,
            "qr_refresh_rate_seconds": QR_REFRESH_SECONDS,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [Error] Start Session Failed: {str(e)}")
        # สามารถส่ง str(e) ไปก่อนในช่วงพัฒนานี้ เพื่อให้หน้าบ้านเห็น Error ชัดๆ
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# API สำหรับกดปิดเซสชันแบบ Manual
@app.post("/api/v1/sessions/{session_id}/close")
async def close_attendance_session(
    session_id: str,
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    try:
        await run_in_threadpool(require_owned_session, session_id, current_user)
        # ดึงเวลาปัจจุบัน (UTC) เพื่อบันทึกเป็นเวลาปิด
        close_time = datetime.now(timezone.utc).isoformat()
        
        # อัปเดตสถานะและเวลาปิดลงฐานข้อมูล
        response = supabase.table('attendance_sessions').update({
            "status": SessionStatus.CLOSED.value, # บังคับเป็น "closed"
            "closed_at": close_time
        }).eq('id', session_id).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบเซสชันที่ต้องการปิด")
            
        return {
            "status": "success", 
            "message": "ปิดระบบเช็คชื่อและบันทึกเวลาสำเร็จ",
            "closed_at": close_time
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [Error] Close Session Failed: {str(e)}")
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# 🌟 [เพิ่มใหม่] API สำหรับ "หมุน" QR Token จริงๆ (แก้บั๊กเดิมที่ฝั่ง React เขียนลงคอลัมน์
# current_token/expires_at ที่ไม่มีอยู่จริงในตาราง — ที่ถูกต้องคือต้องอัปเดตคอลัมน์ qr_token
# เพราะ endpoint /api/v1/attendance/checkin เช็คกับคอลัมน์นี้เท่านั้น)
# ฝั่งอาจารย์ (LiveAttendance.tsx) ควรเรียก endpoint นี้ทุกๆ qr_refresh_rate_seconds แทนการยิง Supabase ตรงๆ
@app.post("/api/v1/sessions/{session_id}/rotate-token")
async def rotate_session_qr_token(
    session_id: str,
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    try:
        session_row = await run_in_threadpool(require_owned_session, session_id, current_user)
        if session_row['status'] != 'open':
            raise HTTPException(status_code=400, detail="คาบเรียนนี้ปิดไปแล้ว ไม่สามารถหมุน QR ต่อได้")
        new_token = str(uuid.uuid4())
        rotated_at = datetime.now(timezone.utc).isoformat()
        supabase.table('attendance_sessions').update({
            "qr_token": new_token,
            "qr_token_rotated_at": rotated_at,
        }).eq('id', session_id).execute()

        return {
            "status": "success",
            "qr_token": new_token,
            "qr_refresh_rate_seconds": QR_REFRESH_SECONDS,
            "rotated_at": rotated_at,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# 🌟 [เพิ่มใหม่] API ให้นักศึกษาตรวจสอบว่า QR ที่สแกนมายังใช้ได้อยู่ไหม ก่อนจะไปขั้นตอนสแกนหน้า
# (แก้บั๊กเดิมที่ QRScanner.tsx ไป query ตาราง active_sessions ที่ไม่มีอยู่จริงในระบบ)
@app.post("/api/v1/sessions/{session_id}/validate")
async def validate_session_qr_token(
    session_id: str,
    payload: QRValidationRequest,
    current_user: AuthenticatedUser = Depends(require_roles("student")),
):
    try:
        if not current_user.student_id:
            raise HTTPException(status_code=409, detail="บัญชีนี้ยังไม่มีรหัสนักศึกษา กรุณาติดต่อผู้ดูแลระบบ")

        session_res = supabase.table('attendance_sessions') \
            .select('course_id, status, qr_token, qr_token_rotated_at, qr_refresh_rate_seconds, courses(course_code, course_name)') \
            .eq('id', session_id) \
            .execute()

        if not session_res.data:
            raise HTTPException(status_code=404, detail="ไม่พบคาบเรียนนี้ในระบบ (QR อาจไม่ถูกต้อง)")

        session_row = session_res.data[0]
        ensure_qr_token_is_current(session_row, payload.token)
        await run_in_threadpool(require_course_enrollment, session_row["course_id"], current_user.id)

        existing_record = (
            supabase.table("attendance_records")
            .select("id")
            .eq("session_id", session_id)
            .eq("student_id", current_user.id)
            .execute()
        )
        if existing_record.data:
            raise HTTPException(status_code=409, detail="คุณเช็คชื่อในคาบนี้แล้ว")

        recent_challenge = (
            supabase.table("attendance_checkin_challenges")
            .select("id")
            .eq("student_id", current_user.id)
            .gte("created_at", (datetime.now(timezone.utc) - timedelta(seconds=3)).isoformat())
            .limit(1)
            .execute()
        )
        if recent_challenge.data:
            raise HTTPException(status_code=429, detail="สแกน QR ถี่เกินไป กรุณารอสักครู่")

        expires_at = datetime.now(timezone.utc) + timedelta(seconds=QR_CHALLENGE_SECONDS)
        challenge_response = supabase.table("attendance_checkin_challenges").insert({
            "session_id": session_id,
            "student_id": current_user.id,
            "expires_at": expires_at.isoformat(),
        }).execute()
        if not challenge_response.data:
            raise HTTPException(status_code=500, detail="ไม่สามารถสร้างสิทธิ์เช็คชื่อจาก QR ได้")

        course_info = session_row.get('courses') or {}
        return {
            "status": "success",
            "session_id": session_id,
            "course_code": course_info.get('course_code'),
            "course_name": course_info.get('course_name'),
            "challenge_id": challenge_response.data[0]["id"],
            "challenge_expires_at": expires_at.isoformat(),
            "challenge_ttl_seconds": QR_CHALLENGE_SECONDS,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e


@app.get("/api/v1/sessions/{session_id}/checkins")
async def get_live_session_checkins(
    session_id: str,
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    await run_in_threadpool(require_owned_session, session_id, current_user)
    response = await run_in_threadpool(
        lambda: supabase.table("attendance_records")
        .select("id, check_in_time, status, method, profiles(student_id, full_name)")
        .eq("session_id", session_id)
        .order("check_in_time", desc=True)
        .execute()
    )
    checkins = []
    for row in response.data or []:
        profile = row.get("profiles") or {}
        checkins.append({
            "id": row["id"],
            "check_in_time": row["check_in_time"],
            "status": row.get("status"),
            "method": row.get("method"),
            "student_id": profile.get("student_id") or "-",
            "full_name": profile.get("full_name") or "ไม่ทราบชื่อ",
        })
    return {"status": "success", "checkins": checkins, "count": len(checkins)}

# 1. API สำหรับกดบันทึกเพิ่มรายวิชาใหม่ลงตาราง courses
@app.post("/api/v1/courses")
async def create_course(
    payload: CourseCreateRequest,
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    try:
        course_data = {
            "course_code": payload.course_code.strip(),
            "course_name": payload.course_name.strip(),
            "teacher_id": current_user.id,
            "section": payload.section,
            "year": payload.year,
            "semester": payload.semester
        }
        response = supabase.table('courses').insert(course_data).execute()
        return {"status": "success",
                "course": response.data[0]}
    except Exception as e:
        # 📝 จับและส่ง detail ของ Error ออกไปฟ้องที่หน้าจอ
        raise HTTPException(status_code=500, detail="ไม่สามารถสร้างรายวิชาได้") from e

@app.get(
    "/api/v1/courses",
    dependencies=[Depends(require_roles("admin"))],
)
async def get_all_courses():
    try:
        response = supabase.table('courses').select('*').execute()
        return {"status": "success", "courses": response.data}
    except Exception as e:
        print(f"DEBUG ERROR: {str(e)}") 
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# 2. API สำหรับดึงรายวิชาทั้งหมดของอาจารย์ท่านนั้นมาแสดงผลบน Dashboard
@app.get("/api/v1/courses/{teacher_id}")
async def get_courses_by_teacher(
    teacher_id: str,
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    try:
        if current_user.role != "admin" and teacher_id != current_user.id:
            raise HTTPException(status_code=403, detail="ดูรายวิชาได้เฉพาะบัญชีของตนเอง")
        # ลองดึงข้อมูลแบบตรงไปตรงมา
        response = supabase.table('courses') \
            .select('*') \
            .eq('teacher_id', teacher_id) \
            .execute()
            
        return {"status": "success", "courses": response.data}
    except HTTPException:
        raise
    except Exception as e:
        # 🌟 ตรงนี้สำคัญ: พิมพ์ Error ลงใน Terminal ของหลังบ้านให้เราเห็นด้วย
        print(f"DEBUG ERROR: {str(e)}") 
        # ส่ง Error กลับไปที่หน้าเว็บให้ชัดเจน
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# 3. API บันทึกการตั้งค่าเกณฑ์วิชา
@app.put(
    "/api/v1/courses/{course_id}/settings",
)
async def update_course_settings(
    course_id: str,
    payload: CourseSettingsRequest,
    current_user: Annotated[
        AuthenticatedUser,
        Depends(require_roles("teacher", "admin")),
    ],
):
    try:
        await run_in_threadpool(require_owned_course, course_id, current_user)
        response = supabase.table('courses').update({
            "total_sessions": payload.total_sessions,
            "late_threshold_minutes": payload.late_threshold_minutes,
            "absent_threshold_minutes": payload.absent_threshold_minutes,
            "max_absence_percent": payload.max_absence_percent
        }).eq('id', course_id).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบรายวิชานี้ในระบบ")
            
        # Only the authenticated admin identity can be recorded as an admin actor.
        if current_user.role == "admin":
            supabase.table("audit_logs").insert({
                "admin_id": current_user.id,
                "action": "UPDATE_COURSE_SETTINGS",
                "target_type": "courses",
                "target_id": course_id,
                "details": payload.model_dump(),
            }).execute()

        return {"status": "success", "message": "อัปเดตเกณฑ์สำเร็จ"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# 4. API แก้ไขข้อมูลรายวิชา (Edit)
@app.put(
    "/api/v1/courses/{course_id}",
)
async def update_course_details(
    course_id: str,
    payload: CourseUpdateRequest,
    current_user: Annotated[
        AuthenticatedUser,
        Depends(require_roles("teacher", "admin")),
    ],
):
    try:
        await run_in_threadpool(require_owned_course, course_id, current_user)
        response = supabase.table('courses').update({
            "course_code": payload.course_code.strip(),
            "course_name": payload.course_name.strip(),
            "section": payload.section,
            "semester": payload.semester,
            "year": payload.year
        }).eq('id', course_id).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบรายวิชานี้ในระบบ")
            
        if current_user.role == "admin":
            supabase.table("audit_logs").insert({
                "admin_id": current_user.id,
                "action": "UPDATE_COURSE_DETAILS",
                "target_type": "courses",
                "target_id": course_id,
                "details": payload.model_dump(),
            }).execute()

        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e
    
# 5. API ลบรายวิชา (Delete)
@app.delete("/api/v1/courses/{course_id}")
async def delete_course(
    course_id: str,
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    try:
        course = await run_in_threadpool(require_owned_course, course_id, current_user)
        require_course_delete_permission(course, current_user)
        response = supabase.table('courses').delete().eq('id', course_id).execute()
        # หมายเหตุ: หากฐานข้อมูลมีข้อมูลตารางอื่นผูกอยู่ ต้องแน่ใจว่าตั้งค่า ON DELETE CASCADE ไว้ที่ Supabase
        return {"status": "success", "message": "ลบรายวิชาเรียบร้อยแล้ว"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="ไม่สามารถลบวิชาได้ เนื่องจากอาจมีประวัติการเช็คชื่อผูกอยู่")

@router.get(
    "/api/v1/courses/{course_id}/attendance-summary",
)
async def get_course_attendance_summary(
    course_id: str,
    current_user: AuthenticatedUser = Depends(require_roles("teacher", "admin")),
):
    try:
        await run_in_threadpool(require_owned_course, course_id, current_user)
        # 1. ดึงข้อมูลเกณฑ์ของวิชานี้ออกมาดู
        course_res = supabase.table('courses').select('*').eq('id', course_id).execute()
        if not course_res.data:
            raise HTTPException(status_code=404, detail="ไม่พบข้อมูลรายวิชา")
        course = course_res.data[0]
        
        total_sessions = course['total_sessions']        # เช่น 15 ครั้ง
        max_absent_pct = course['max_absence_percent']  # เช่น 20%
        
        # คำนวณจำนวนครั้งสูงสุดที่ขาดได้: 15 ครั้ง * (20/100) = ขาดได้ไม่เกิน 3 ครั้ง หากขาด >= 4 ครั้ง ได้ Fa
        allowed_absent_count = total_sessions * (max_absent_pct / 100)

        # 2. ดึงรายชื่อนักศึกษาทั้งหมดในวิชานี้พร้อมข้อมูลประวัติการเช็คชื่อ
        # (หมายเหตุ: ปรับโครงสร้าง Query ตามความสัมพันธ์ตารางจริงของคุณ)
        records_res = supabase.table('attendance_records') \
            .select('student_id, status, attendance_sessions!inner(course_id)') \
            .eq('attendance_sessions.course_id', course_id) \
            .execute()
            
        # 3. จัดกลุ่มประมวลผลข้อมูล (Data Aggregation)
        student_summary = {}
        for rec in records_res.data:
            s_id = rec['student_id']
            if s_id not in student_summary:
                student_summary[s_id] = {"present": 0, "late": 0, "absent": 0, "leave": 0}
            student_summary[s_id][rec['status']] += 1

        # 4. วิเคราะห์ตัดเกรดตามเงื่อนไข Production
        final_report = []
        for s_id, summary in student_summary.items():
            absent_count = summary['absent']
            # คำนวณอัตราส่วนการขาดเรียนจริงเป็นเปอร์เซ็นต์
            absence_rate = (absent_count / total_sessions) * 100
            
            # ตัดสินเกรด Fa
            grade_status = "Normal"
            if absent_count > allowed_absent_count:
                grade_status = "Fa"  # สอบตกเนื่องจากเวลาเรียนไม่พอ (Failed Attendance)

            final_report.append({
                "student_id": s_id,
                "attendance_stats": summary,
                "total_absent_count": absent_count,
                "absence_percentage": round(absence_rate, 2),
                "evaluation": grade_status
            })
            
        return {
            "status": "success",
            "course_config": {
                "total_term_sessions": total_sessions,
                "max_allowed_absent_sessions": allowed_absent_count
            },
            "report": final_report
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดภายในระบบ") from e

# Include this router only after all @router operations have been registered.
# FastAPI copies a router's route table at include time.
app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    # 🌟 [หมายเหตุสำคัญสำหรับตอน Deploy จริง] คำสั่งนี้ (reload=True) เหมาะกับตอนพัฒนา/แก้โค้ดเท่านั้น
    # และรันได้แค่ 1 worker process เท่านั้น (reload=True ใช้พร้อม workers หลายตัวไม่ได้)
    #
    # ตอน deploy ใช้งานจริง ควรปิด reload แล้วรันหลาย worker process แทน เพื่อให้ต่อให้ worker
    # ตัวหนึ่งกำลังยุ่งอยู่กับการประมวลผลเช็คชื่อ (หนักๆ) worker ตัวอื่นก็ยังรับ request จาก
    # หน้า Admin/อาจารย์ ได้ตามปกติ (เสริมจากการแก้ให้ไม่บล็อก event loop ในโค้ดข้างบนแล้ว)
    # ตัวอย่างคำสั่งรันจริง (ไม่ต้องใช้ reload=True ในไฟล์นี้แล้ว):
    #   uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
