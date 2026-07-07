from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import pytz
from auth import get_current_user, verify_role, supabase_client
from utils.geo import calculate_gps_distance
from utils.totp import verify_totp_token

router = APIRouter(prefix="/attendance", tags=["Attendance Records"])

# Pydantic Schemas
class FaceRegisterRequest(BaseModel):
    student_id: str
    embedding: List[float] = Field(..., min_items=128, max_items=128)

class CheckInRequest(BaseModel):
    session_id: str
    qr_token: str
    latitude: float
    longitude: float
    embedding: List[float] = Field(..., min_items=128, max_items=128)

class FaceIdentifyRequest(BaseModel):
    embedding: List[float] = Field(..., min_items=128, max_items=128)

# Endpoints
@router.post("/register-face", status_code=status.HTTP_200_OK)
async def register_student_face(
    request: FaceRegisterRequest,
    current_user: dict = Depends(verify_role(["student"]))
):
    """
    ลงทะเบียนข้อมูลใบหน้าผู้เรียนครั้งแรก (สกัดเวกเตอร์ใบหน้าส่งเข้าบันทึก + รหัสนักศึกษาจาก OCR)
    """
    try:
        user_id = current_user["id"]
        
        # 1. อัปเดตรหัสนักศึกษาลงในโปรไฟล์
        supabase_client.table("users").update({"student_id": request.student_id}).eq("id", user_id).execute()
        
        # 2. ตรวจสอบก่อนว่าเคยลงทะเบียนใบหน้าไว้แล้วหรือไม่
        exist = supabase_client.table("face_embeddings").select("id").eq("user_id", user_id).execute()
        
        if exist.data:
            # ทำการอัปเดตข้อมูลใบหน้าเดิม
            response = supabase_client.table("face_embeddings")\
                .update({"embedding": request.embedding})\
                .eq("user_id", user_id).execute()
        else:
            # เพิ่มข้อมูลใบหน้าใหม่
            response = supabase_client.table("face_embeddings").insert({
                "user_id": user_id,
                "embedding": request.embedding
            }).execute()
            
        return {"status": "success", "detail": "ลงทะเบียนใบหน้าสำเร็จเรียบร้อย"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถบันทึกข้อมูลใบหน้าได้: {str(e)}"
        )

@router.post("/check-in", response_model=dict)
async def check_in_student(
    request: CheckInRequest,
    current_user: dict = Depends(verify_role(["student"]))
):
    """
    เช็คชื่อเข้าเรียนสำหรับนักศึกษา (ประมวลผลการคำนวณตำแหน่งพิกัด GPS, รหัส QR, และใบหน้า)
    """
    try:
        user_id = current_user["id"]
        
        # 1. ตรวจสอบการมีอยู่และสถานะของเซสชันเช็คชื่อเรียน
        session_res = supabase_client.table("attendance_sessions")\
            .select("*, sections(*)")\
            .eq("id", request.session_id).execute()
            
        if not session_res.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="ไม่พบเซสชันการเช็คชื่อเรียนนี้ในระบบ"
            )
            
        session = session_res.data[0]
        
        # ตรวจสอบว่ายัง Active หรือไม่
        if not session["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="คาบเรียนการเช็คชื่อนี้ปิดการทำงานแล้ว"
            )
            
        # ตรวจสอบวันเวลาหมดอายุ
        now = datetime.now(pytz.utc)
        end_time = datetime.fromisoformat(session["end_time"].replace("Z", "+00:00"))
        if now > end_time:
            # อัปเดตสถานะเซสชันเป็นปิดตัวลงทันทีเนื่องจากหมดเวลา
            supabase_client.table("attendance_sessions").update({"is_active": False}).eq("id", request.session_id).execute()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="เซสชันหมดเวลาเช็คชื่อเข้าเรียนแล้ว"
            )
            
        # ตรวจสอบว่านักศึกษาเคยเช็คชื่อในเซสชันนี้ไปหรือยัง
        record_exist = supabase_client.table("attendance_records")\
            .select("id")\
            .eq("session_id", request.session_id)\
            .eq("user_id", user_id).execute()
        if record_exist.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="คุณได้ทำการเช็คชื่อเข้าเรียนวิชานี้เรียบร้อยแล้ว"
            )

        # 2. ยืนยันรหัส Dynamic QR Code (TOTP Token)
        is_qr_valid = verify_totp_token(session["qr_secret"], request.qr_token)
        if not is_qr_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="รหัส QR Code สำหรับสแกนผิดพลาดหรือหมดอายุแล้ว กรุณาสแกนรหัสปัจจุบันที่แสดงบนจออาจารย์"
            )

        # 3. คำนวณความห่างพิกัดทางกายภาพ GPS (Geofencing)
        section = session["sections"]
        classroom_lat = section["latitude"]
        classroom_lng = section["longitude"]
        
        distance = calculate_gps_distance(
            request.latitude, request.longitude,
            classroom_lat, classroom_lng
        )
        
        # กำหนดเกณฑ์ขีดจำกัดระยะห่างสูงสุด (เช่น 50 เมตร)
        MAX_DISTANCE_METERS = 50.0
        if distance > MAX_DISTANCE_METERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ตำแหน่งของคุณอยู่ห่างจากห้องเรียนมากเกินไป ({int(distance)} เมตร) กรุณาเช็คชื่อภายในห้องเรียน"
            )

        # 4. ตรวจสอบการจับคู่ใบหน้า (Face Match) บน Supabase ด้วย pgvector
        # ใช้ระยะ threshold ปกติสำหรับ Cosine Distance คือ 0.4 (ยิ่งค่าน้อยความแม่นยิ่งสูง)
        MATCH_THRESHOLD = 0.4
        
        rpc_res = supabase_client.rpc(
            "verify_student_face",
            {
                "target_user_id": user_id,
                "input_embedding": request.embedding,
                "match_threshold": MATCH_THRESHOLD
            }
        ).execute()
        
        if not rpc_res.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ใบหน้าไม่ผ่านการยืนยันตัวตน กรุณาจัดตำแหน่งกล้องและสแกนใหม่อีกครั้ง"
            )
            
        verification = rpc_res.data[0]
        if not verification["is_match"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ใบหน้าของคุณไม่ตรงกับรูปถ่ายที่ลงทะเบียนไว้ในระบบ (Distance: {round(verification['distance'], 3)})"
            )

        # 5. วิเคราะห์สถานะการเช็คชื่อ (เข้าเรียนตรงเวลา vs สาย)
        # ตัวอย่างเกณฑ์: เช็คชื่อช้ากว่าเวลาเปิด 10 นาที ถือว่า "Late (สาย)"
        start_time = datetime.fromisoformat(session["start_time"].replace("Z", "+00:00"))
        time_diff = now - start_time
        status_record = "present"
        if time_diff > timedelta(minutes=10):
            status_record = "late"

        # 6. บันทึกข้อมูลประวัติการเข้าเรียน
        insert_res = supabase_client.table("attendance_records").insert({
            "session_id": request.session_id,
            "user_id": user_id,
            "status": status_record,
            "check_in_time": now.isoformat(),
            "distance_meters": distance
        }).execute()
        
        record = insert_res.data[0]
        record["student_name"] = current_user["full_name"]
        record["student_id"] = current_user["student_id"]
        
        return {
            "status": "success",
            "detail": "บันทึกการเช็คชื่อเข้าเรียนสำเร็จ",
            "data": record
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"เกิดข้อผิดพลาดในการประมวลผลเช็คชื่อ: {str(e)}"
        )

@router.get("/my-history", response_model=List[dict])
async def get_my_attendance_history(current_user: dict = Depends(verify_role(["student"]))):
    """
    ดึงสถิติประวัติการเช็คชื่อของตัวเองย้อนหลังสำหรับนักศึกษา
    """
    try:
        response = supabase_client.table("attendance_records")\
            .select("*, attendance_sessions(*, sections(*, courses(*)))")\
            .eq("user_id", current_user["id"])\
            .order("check_in_time", desc=True).execute()
        return response.data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถประมวลผลประวัติเช็คชื่อย้อนหลังได้: {str(e)}"
        )

@router.get("/session/{session_id}/records", response_model=List[dict])
async def get_session_attendance_records(
    session_id: str,
    current_user: dict = Depends(verify_role(["lecturer", "admin"]))
):
    """
    ดึงรายชื่อสถิตินักศึกษาที่มาเช็คชื่อในคาบเรียนดังกล่าว (สำหรับอาจารย์ตรวจสอบ)
    """
    try:
        response = supabase_client.table("attendance_records")\
            .select("*, users(student_id, full_name)")\
            .eq("session_id", session_id)\
            .order("check_in_time", desc=False).execute()
        return response.data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถดึงข้อมูลเช็คชื่อเข้าชั้นเรียนได้: {str(e)}"
        )

@router.get("/status")
async def get_registration_status(current_user: dict = Depends(verify_role(["student"]))):
    """
    ตรวจสอบสถานะการลงทะเบียนใบหน้าของผู้เรียน
    """
    try:
        user_id = current_user["id"]
        exist = supabase_client.table("face_embeddings").select("id").eq("user_id", user_id).execute()
        return {
            "hasFaceRegistered": len(exist.data) > 0,
            "student_id": current_user.get("student_id")
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถตรวจสอบสถานะได้: {str(e)}"
        )

@router.post("/test-match")
async def test_face_match(request: FaceIdentifyRequest):
    """
    ทดสอบการจดจำใบหน้า (1-to-N Matching) ค้นหาว่าใครเหมือนภาพนี้มากที่สุด
    """
    try:
        # กำหนดความแม่นยำในการระบุตัวบุคคล
        MATCH_THRESHOLD = 0.5 
        
        rpc_res = supabase_client.rpc(
            "identify_face",
            {
                "input_embedding": request.embedding,
                "match_threshold": MATCH_THRESHOLD,
                "match_count": 1
            }
        ).execute()
        
        if rpc_res.data and len(rpc_res.data) > 0:
            match = rpc_res.data[0]
            return {
                "match": True,
                "user": match
            }
            
        return {"match": False, "user": None}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"เกิดข้อผิดพลาดในการตรวจสอบใบหน้า: {str(e)}"
        )
