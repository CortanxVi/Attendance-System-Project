import os
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase_client import get_student_profile

router = APIRouter(prefix="/api/auth", tags=["auth"])

class LoginRequest(BaseModel):
    student_id: str

class LoginResponse(BaseModel):
    message: str
    token: str
    user: dict

@router.post("/login-with-id", response_model=LoginResponse)
async def login_with_student_id(request: LoginRequest):
    # ค้นหาใน Supabase
    student_data = get_student_profile(request.student_id)
    
    if not student_data:
        raise HTTPException(status_code=401, detail="ไม่พบรหัสนักศึกษานี้ในระบบ")
        
    # ดึง JWT Secret จาก .env
    jwt_secret = os.getenv("JWT_SECRET")
    if not jwt_secret or jwt_secret == "YOUR_SUPER_SECRET_JWT_KEY":
        raise HTTPException(status_code=500, detail="ระบบยังไม่ได้กำหนด JWT_SECRET")
        
    # สร้าง Payload สำหรับ Token (อายุ 24 ชั่วโมง)
    payload = {
        "sub": student_data["student_id"],
        "name": student_data["full_name"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
        "iat": datetime.now(timezone.utc)
    }
    
    # สร้าง JWT Token
    token = jwt.encode(payload, jwt_secret, algorithm="HS256")
    
    return {
        "message": "เข้าสู่ระบบสำเร็จ",
        "token": token,
        "user": {
            "student_id": student_data["student_id"],
            "full_name": student_data["full_name"]
        }
    }
