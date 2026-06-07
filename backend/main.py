import numpy as np
import cv2
import os
import re
import json
import uuid
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, status, APIRouter
from supabase import create_client, Client
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from enum import Enum
from datetime import datetime, timezone

# นำเข้าเครื่องมือจาก services ที่เราปรับปรุงใหม่
from services.easyocr_service import ocr_service
from services.insightface_service import face_service

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
    teacher_id: str

# เพิ่ม Model สำหรับรับค่าเพิ่มรายวิชาเรียน
class CourseCreateRequest(BaseModel):
    course_code: str
    course_name: str
    section: int
    teacher_id: str
    year: int
    semester: int

class CheckInPayload(BaseModel):
    student_id: str
    session_id: str
    qr_token: str  # นักศึกษาส่ง Token ที่สแกนได้มาตรวจความถูกต้อง

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

# Config สำหรับการเชื่อมต่อ Supabase (ให้ขอ key กับ team lead)
load_dotenv()
supabase_url = os.getenv("SUPABASE_URL")
supabase_rkey = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_rkey)

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
    allow_origins=["*"], # ใน production จริงควรระบุ url ของ frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

def bytes_to_cv2_image(image_bytes: bytes) -> np.ndarray:
    """แปลงไฟล์ bytes จากหน้าบ้านให้เป็นภาพ BGR สำหรับ OpenCV"""
    nparr = np.frombuffer(image_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

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

@app.post("/api/v1/enrollment/register-face")
async def register_face(
    student_id: str = Form(...),       # รับรหัสนักศึกษาแบบข้อความ (Text) จาก Form Data
    face_image: UploadFile = File(...) # รับไฟล์รูปถ่ายเซลฟี่
):
    try:
        # 1. แปลงไฟล์ภาพที่อัปโหลดมาให้เป็น OpenCV (BGR)
        face_bytes = await face_image.read()
        img_selfie = bytes_to_cv2_image(face_bytes)
        
        # 2. ส่งภาพไปให้ Service ประมวลผลและเช็คกฎเกณฑ์
        embedding_list, error_msg = face_service.extract_face_for_registration(img_selfie)
        
        # ถ้าติดเงื่อนไข (ไม่เจอหน้า/หน้าซ้อน) ให้เตะออกทันที
        if error_msg:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)
        
        # 3. อัปเดต Vector ใบหน้าลงตาราง profiles โดยผูกกับ student_id (ที่เป็น Text ตามโครงสร้างจริง)
        response = supabase.table('profiles').update({
            'face_registered': True,
            'face_embedding': embedding_list
        }).eq('student_id', student_id).execute()
        
        # หากค้นหาเลข 13 หลักในตารางโปรไฟล์แล้วไม่เจอใครเลย
        if len(response.data) == 0:
             raise HTTPException(
                 status_code=status.HTTP_404_NOT_FOUND, 
                 detail=f"ไม่พบข้อมูลรหัสนักศึกษา {student_id} ในระบบฐานข้อมูลโปรไฟล์ กรุณาเพิ่มชื่อในระบบก่อนลงทะเบียนใบหน้า"
             )

        return {
            "success": True,
            "student_id": student_id,
            "message": f"ลงทะเบียนใบหน้าของรหัสนักศึกษา {student_id} เข้าสู่ระบบสำเร็จเรียบร้อยแล้ว!"
        }
        
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"เกิดข้อผิดพลาดในระบบหลังบ้าน: {str(e)}"
        )

@app.post("/api/v1/attendance/verify")
async def verify_FaceReg_OCR_attendance(
    face_image: UploadFile = File(...),
    id_card_image: UploadFile = File(...)
):
    try:
        # ─── STEP 1: แปลงไฟล์เป็นรูปภาพ ───
        img_live = bytes_to_cv2_image(await face_image.read())
        img_card = bytes_to_cv2_image(await id_card_image.read())
        
        # ─── STEP 2: OCR อ่านรหัส 13 หลักจากภาพบัตร ───
        extracted_student_id = ocr_service.extract_student_id(img_card)
        if not extracted_student_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="ไม่สามารถอ่านรหัสนักศึกษาจากบัตรได้ กรุณาถ่ายภาพบัตรให้ชัดเจนและไม่มีแสงสะท้อน"
            )
            
        # ─── STEP 3: ดึงข้อมูล Face Embedding และ UUID จาก Supabase ───
        # 🌟 [แก้ตรงนี้] เพิ่ม 'id' เข้าไปในคำสั่ง select 🌟
        db_response = supabase.table('profiles').select('id, face_embedding').eq('student_id', extracted_student_id).execute()
        
        if len(db_response.data) == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, 
                detail=f"ไม่พบรหัสนักศึกษา {extracted_student_id} ในระบบฐานข้อมูลโปรไฟล์"
            )
            
        # 🌟 เก็บค่า UUID เอาไว้ใช้ตอนบันทึกลง attendance_records 🌟
        profile_uuid = db_response.data[0].get('id') 
        
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

        # ─── STEP 4: AI สกัดใบหน้าจาก 'กล้องสด' เพียงรูปเดียว ───
        emb_live = face_service.extract_face_embedding(img_live)
        if emb_live is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="ตรวจไม่พบใบหน้าในภาพสแกนสด กรุณาหันหน้าเข้าหากล้องตรงๆ"
            )

        # ─── STEP 5: เปรียบเทียบใบหน้าสด กับ ใบหน้าในฐานข้อมูลโดยตรง ───
        similarity_score = face_service.calculate_similarity(emb_live, registered_embedding)

        # ตรวจสอบเกณฑ์คะแนน
        if similarity_score < FACE_THRESHOLD:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, 
                detail=f"การยืนยันตัวตนล้มเหลว ใบหน้าไม่ตรงกับข้อมูลที่ลงทะเบียนไว้ (Score: {round(similarity_score, 4)})"
            )

        # ─── STEP 6: ผ่านเกณฑ์ -> บันทึกประวัติลงตาราง attendance ───
        supabase.table('attendance_records').insert({
            'student_id': profile_uuid, 
            'status': 'present',
            'method': 'face_ocr', # face_ocr, nfc, manual 
            'similarity_score': round(similarity_score, 4)
        }).execute()

        # คืนค่าความสำเร็จกลับไปให้หน้าบ้าน (Frontend)
        return {
            "success": True,
            "student_id": extracted_student_id, # ตรงนี้ส่งรหัส 13 หลักกลับไปให้ Frontend โชว์ได้ปกติ
            "score": round(similarity_score, 4),
            "message": f"เช็คชื่อนักศึกษา รหัส {extracted_student_id} สำเร็จเรียบร้อยแล้ว!"
        }

    except Exception as e:
        # หากเกิด HTTPException จากที่เราดักไว้ ให้โยนออกไปตามปกติ
        if isinstance(e, HTTPException):
            raise e
        # หากเกิด Error อื่นๆ ที่คาดไม่ถึง ให้แจ้งข้อผิดพลาดระบบหลังบ้าน
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail=f"เกิดข้อผิดพลาดในระบบหลังบ้าน: {str(e)}"
        )

@app.post("/api/v1/nfc/register")
async def register_nfc_card(payload: NFCRegisterRequest):
    try:
        # ทำความสะอาดข้อมูล ตัดช่องว่างหัว-ท้ายออกก่อนนับ
        uid_clean = payload.nfc_uid.strip()
        
        # 🌟 เพิ่มการตรวจสอบความยาว 10 ตัวอักษร
        if len(uid_clean) != 10:
            raise HTTPException(
                status_code=400, 
                detail=f"ไม่สามารถลงทะเบียนได้: รหัส UID ต้องมีความยาว 10 หลักเท่านั้น (ค่าที่ส่งมามี {len(uid_clean)} หลัก)"
            )
        
        # where student_id = student_id ที่อ่านค่าได้
        resCheck = supabase.table('profiles') \
            .select("student_id, nfc_uid, full_name") \
            .eq('student_id', payload.student_id) \
            .execute()
        student_data = resCheck.data[0]

        # where nfc_uid = nfc_uid ที่อ่านค่าได้
        card_check = supabase.table('profiles') \
            .select("student_id") \
            .eq('nfc_uid', uid_clean) \
            .execute()

        # ค้นหานักศึกษาและอัปเดตเลข nfc_uid ลงในตาราง profiles
        # where student_id = student_id ที่อ่านค่าได้
        response = supabase.table('profiles') \
            .update({'nfc_uid': uid_clean}) \
            .eq('student_id', payload.student_id) \
            .execute()

        if not resCheck.data:
            raise HTTPException(status_code=404, detail="ไม่พบรหัสนักศึกษาในระบบ กรุณาเพิ่มรายชื่อก่อนผูกบัตร")
        
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
        
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบรหัสนักศึกษาในระบบ")
        return {"status": "success",
                "message": f"ผูกบัตร NFC กับรหัส {payload.student_id} สำเร็จ"}
    
    except HTTPException as ea:
        raise ea
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/nfc/checkin")
async def nfc_checkin(payload: NFCCheckInRequest):
    try:
        # 1. ตรวจสอบว่าหมายเลขบัตรนี้ตรงกับโปรไฟล์ของใคร
        user_response = supabase.table('profiles') \
            .select('id', 'student_id', 'full_name') \
            .eq('nfc_uid', payload.nfc_uid) \
            .execute()
            
        if not user_response.data:
            raise HTTPException(
                status_code=404,
                detail="บัตร NFC ใบนี้ยังไม่ได้ลงทะเบียนในระบบ"
            )
            
        student = user_response.data[0]
        student_uuid = student['id'] # UUID จาก auth.users

        # 2. ทำการบันทึกข้อมูลการเช็คชื่อเข้าตาราง attendance_records
        attendance_data = {
            "session_id": payload.session_id,
            "student_id": student_uuid,
            "status": "present",
            "method": "nfc", # face_ocr, nfc, manual 
            "similarity_score": None # ไม่จำเป็นต้องระบุเพราะไม่ได้ใช้ AI หน้าสแกน
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
                "method": "nfc" # face_ocr, nfc, manual 
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        # 🌟 นำฟังก์ชันมาครอบตรงนี้ 🌟
        error_message = parse_supabase_error(str(e))
        
        raise HTTPException(
            status_code=500, 
            detail=f"เกิดข้อผิดพลาด: {error_message}"
        )

# API สำหรับอาจารย์กดสร้างห้องเรียน (เปิด Session)
@app.post("/api/v1/sessions/start")
async def start_attendance_session(payload: SessionStartRequest):
    try:
        # 🌟 2. เจนเนอเรต Token ก้อนแรกขึ้นมาสำหรับเซสชันนี้
        initial_token = str(uuid.uuid4())

        session_data = {
            "course_id": payload.course_id,
            "opened_by": payload.teacher_id,
            "status": SessionStatus.OPEN.value,
            "qr_token": initial_token,
            "qr_refresh_rate_seconds": 60,
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
            "qr_token": initial_token  # ส่งกลับไปเผื่อหน้าบ้านต้องใช้สร้าง QR Code ตัวแรกทันที
        }
        
    except Exception as e:
        print(f"❌ [Error] Start Session Failed: {str(e)}")
        # สามารถส่ง str(e) ไปก่อนในช่วงพัฒนานี้ เพื่อให้หน้าบ้านเห็น Error ชัดๆ
        raise HTTPException(status_code=500, detail=str(e))

# API สำหรับกดปิดเซสชันแบบ Manual
@app.post("/api/v1/sessions/{session_id}/close")
async def close_attendance_session(session_id: str):
    try:
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
    except Exception as e:
        print(f"❌ [Error] Close Session Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# 1. API สำหรับกดบันทึกเพิ่มรายวิชาใหม่ลงตาราง courses
@app.post("/api/v1/courses")
async def create_course(payload: CourseCreateRequest):
    try:
        course_data = {
            "course_code": payload.course_code.strip(),
            "course_name": payload.course_name.strip(),
            "teacher_id": payload.teacher_id,
            "section": payload.section,
            "year": payload.year,
            "semester": payload.semester
        }
        response = supabase.table('courses').insert(course_data).execute()
        return {"status": "success",
                "course": response.data[0]}
    except Exception as e:
        # 🌟 ปรับตรง detail ให้พ่น Error ออกมาฟ้องที่หน้าเว็บ
        raise HTTPException(status_code=500, detail=f"Supabase POST Error: {str(e)}")

# 2. API สำหรับดึงรายวิชาทั้งหมดของอาจารย์ท่านนั้นมาแสดงผลบน Dashboard
@app.get("/api/v1/courses/{teacher_id}")
async def get_courses_by_teacher(teacher_id: str):
    try:
        # ลองดึงข้อมูลแบบตรงไปตรงมา
        response = supabase.table('courses') \
            .select('*') \
            .eq('teacher_id', teacher_id) \
            .execute()
            
        return {"status": "success", "courses": response.data}
    except Exception as e:
        # 🌟 ตรงนี้สำคัญ: พิมพ์ Error ลงใน Terminal ของหลังบ้านให้เราเห็นด้วย
        print(f"DEBUG ERROR: {str(e)}") 
        # ส่ง Error กลับไปที่หน้าเว็บให้ชัดเจน
        raise HTTPException(status_code=500, detail=str(e))

# 3. API บันทึกการตั้งค่าเกณฑ์วิชา (รองรับ CourseSettings.tsx)
@app.put("/api/v1/courses/{course_id}/settings")
async def update_course_settings(course_id: str, payload: CourseSettingsRequest):
    try:
        response = supabase.table('courses').update({
            "total_sessions": payload.total_sessions,
            "late_threshold_minutes": payload.late_threshold_minutes,
            "absent_threshold_minutes": payload.absent_threshold_minutes,
            "max_absence_percent": payload.max_absence_percent
        }).eq('id', course_id).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบรายวิชานี้ในระบบ")
        return {"status": "success", "message": "อัปเดตเกณฑ์สำเร็จ"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 4. API แก้ไขข้อมูลรายวิชา (Edit)
@app.put("/api/v1/courses/{course_id}")
async def update_course_details(course_id: str, payload: CourseUpdateRequest):
    try:
        response = supabase.table('courses').update({
            "course_code": payload.course_code.strip(),
            "course_name": payload.course_name.strip(),
            "section": payload.section,
            "semester": payload.semester,
            "year": payload.year
        }).eq('id', course_id).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบรายวิชานี้ในระบบ")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 5. API ลบรายวิชา (Delete)
@app.delete("/api/v1/courses/{course_id}")
async def delete_course(course_id: str):
    try:
        response = supabase.table('courses').delete().eq('id', course_id).execute()
        # หมายเหตุ: หากฐานข้อมูลมีข้อมูลตารางอื่นผูกอยู่ ต้องแน่ใจว่าตั้งค่า ON DELETE CASCADE ไว้ที่ Supabase
        return {"status": "success", "message": "ลบรายวิชาเรียบร้อยแล้ว"}
    except Exception as e:
        raise HTTPException(status_code=500, detail="ไม่สามารถลบวิชาได้ เนื่องจากอาจมีประวัติการเช็คชื่อผูกอยู่")

@router.post("/api/v1/attendance/checkin")
async def student_check_in(payload: CheckInPayload):
    try:
        # 5.1. ตรวจสอบว่า เซสชันนี้มีอยู่จริง, เปิดอยู่ และ QR Token ตรงกันปัจจุบันหรือไม่
        session_res = supabase.table('attendance_sessions') \
            .select('*, courses(*)') \
            .eq('id', payload.session_id) \
            .eq('status', 'open') \
            .execute()
            
        if not session_res.data:
            raise HTTPException(status_code=400, detail="QR Code หมดอายุ หรือห้องเรียนปิดระบบแล้ว")
            
        session_info = session_res.data[0]
        course_config = session_info['courses']  # ดึงข้อมูลเกณฑ์ที่อาจารย์ตั้งค่าไว้จากตารางผูก
        
        # ตรวจสอบ Token ว่าตรงกับที่หมุนอยู่ปัจจุบันไหม
        if session_info['qr_token'] != payload.qr_token:
            raise HTTPException(status_code=400, detail="Dynamic QR Code ไม่ถูกต้องหรือหมดอายุแล้ว")
            
        # 5.2. คำนวณเวลาส่วนต่าง (หน่วยนาที)
        created_at_str = session_info['created_at'] # เวลาเปิดเซสชัน (เวลาเริ่มคาบ)
        session_start_time = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
        current_time = datetime.now(timezone.utc)
        
        minutes_diff = (current_time - session_start_time).total_seconds() / 60
        
        # 5.3. ตรวจสอบเกณฑ์แบบ Dynamic ตามที่ตั้งค่าไว้ในตารางวิชานั้นๆ
        late_limit = course_config['late_threshold_minutes']       # ค่าปกติคือ 15
        absent_limit = course_config['absent_threshold_minutes']   # ค่าปกติคือ 45
        
        calculated_status = "present"  # สถานะเริ่มต้น: มาเรียนปกติ
        
        if minutes_diff > absent_limit:
            calculated_status = "absent"  # เกิน 45 นาที -> ขาดเรียน
        elif minutes_diff > late_limit:
            calculated_status = "late"    # เกิน 15 นาที -> มาสาย
            
        # 5.4. บันทึกประวัติการเช็คชื่อลงตารางประวัตินักศึกษา (attendance_records)
        attendance_data = {
            "session_id": payload.session_id,
            "student_id": payload.student_id,
            "check_in_time": current_time.isoformat(),
            "status": calculated_status  # เก็บเป็น 'present', 'late', หรือ 'absent'
        }
        
        record_res = supabase.table('attendance_records').insert(attendance_data).execute()
        
        return {
            "status": "success",
            "calculated_status": calculated_status,
            "minutes_diff": round(minutes_diff, 2)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/v1/courses/{course_id}/attendance-summary")
async def get_course_attendance_summary(course_id: str):
    try:
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)