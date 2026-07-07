from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import List
import pytz
from auth import get_current_user, verify_role, supabase_client
from utils.totp import generate_totp_secret, generate_current_totp_token

router = APIRouter(prefix="/sessions", tags=["Attendance Sessions"])

# Pydantic Schemas
class SessionOpenRequest(BaseModel):
    section_id: str
    duration_minutes: int = 15

# Endpoints
@router.post("/open", response_model=dict)
async def open_attendance_session(
    request: SessionOpenRequest, 
    current_user: dict = Depends(verify_role(["lecturer", "admin"]))
):
    """
    เปิดคาบเรียนเช็คชื่อเข้าเรียนแบบใช้ Dynamic QR (เฉพาะอาจารย์)
    ระบบจะสร้างคีย์ลับ TOTP สำหรับสืบทอดไปทำ Dynamic QR Code
    """
    try:
        # ตรวจสอบก่อนว่าเซกชันนี้มีคาบเรียนที่ยังเปิดอยู่ (Active) หรือไม่
        active_exist = supabase_client.table("attendance_sessions")\
            .select("id")\
            .eq("section_id", request.section_id)\
            .eq("is_active", True).execute()
            
        if active_exist.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="มีเซสชันการเช็คชื่อที่ยังเปิดอยู่สำหรับห้องเรียนนี้แล้ว กรุณาปิดเซสชันเก่าก่อน"
            )

        # กำหนดเวลารันเซสชันในหน่วยเขตเวลา UTC
        tz = pytz.utc
        now = datetime.now(tz)
        end_time = now + timedelta(minutes=request.duration_minutes)
        
        # สุ่มคีย์ลับ TOTP
        qr_secret = generate_totp_secret()
        
        response = supabase_client.table("attendance_sessions").insert({
            "section_id": request.section_id,
            "start_time": now.isoformat(),
            "end_time": end_time.isoformat(),
            "is_active": True,
            "qr_secret": qr_secret
        }).execute()
        
        session_data = response.data[0]
        
        # แนบรหัส OTP ตัวแรกสำหรับนำไปแสดงหน้าจอ
        session_data["current_token"] = generate_current_totp_token(qr_secret)
        
        return session_data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถเปิดคาบเช็คชื่อเรียนได้: {str(e)}"
        )

@router.post("/{session_id}/close", response_model=dict)
async def close_attendance_session(
    session_id: str,
    current_user: dict = Depends(verify_role(["lecturer", "admin"]))
):
    """
    ปิดคาบเรียนการเช็คชื่อด้วยตนเองก่อนเวลาสิ้นสุด (เฉพาะอาจารย์)
    """
    try:
        # ตรวจสอบการมีอยู่จริง
        exist = supabase_client.table("attendance_sessions").select("id").eq("id", session_id).execute()
        if not exist.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="ไม่พบเซสชันเช็คชื่อเรียนนี้ในระบบ"
            )
            
        response = supabase_client.table("attendance_sessions")\
            .update({"is_active": False})\
            .eq("id", session_id).execute()
            
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถปิดเซสชันการเช็คชื่อได้: {str(e)}"
        )

@router.get("/active/{section_id}", response_model=List[dict])
async def get_active_session(section_id: str, current_user: dict = Depends(get_current_user)):
    """
    ตรวจสอบเซสชันเช็คชื่อเข้าเรียนที่กำลังเปิดอยู่ของตอนเรียนนั้น (สำหรับหน้าจอเช็คชื่อฝั่งนักศึกษา)
    """
    try:
        now = datetime.now(pytz.utc).isoformat()
        
        # ดึงเซสชันที่ is_active เป็น True และเวลากำหนดไว้ยังไม่หมด
        response = supabase_client.table("attendance_sessions")\
            .select("id, section_id, start_time, end_time, is_active")\
            .eq("section_id", section_id)\
            .eq("is_active", True)\
            .gt("end_time", now).execute()
            
        return response.data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถตรวจสอบคาบเช็คชื่อเรียนได้: {str(e)}"
        )

@router.get("/{session_id}/token", response_model=dict)
async def get_current_session_token(
    session_id: str,
    current_user: dict = Depends(verify_role(["lecturer", "admin"]))
):
    """
    ดึงรหัส Dynamic Token (TOTP) ล่าสุด เพื่อนำไปแสดงในสไลด์โปรเจกเตอร์หรืออัปเดตหน้า QR โค้ด
    """
    try:
        response = supabase_client.table("attendance_sessions")\
            .select("qr_secret, is_active, end_time")\
            .eq("id", session_id).execute()
            
        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="ไม่พบเซสชันเช็คชื่อเรียนนี้ในระบบ"
            )
            
        session = response.data[0]
        if not session["is_active"] or datetime.fromisoformat(session["end_time"].replace("Z", "+00:00")) < datetime.now(pytz.utc):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="เซสชันเช็คชื่อปิดการทำงานแล้ว"
            )
            
        current_token = generate_current_totp_token(session["qr_secret"])
        return {"current_token": current_token}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถสร้าง Token ได้: {str(e)}"
        )
