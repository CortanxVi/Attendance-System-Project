from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from config import settings
from routers import courses, sessions, attendance
from auth import supabase_client

app = FastAPI(
    title="KMUTNB Smart Attendance System API",
    description="ระบบเช็คชื่อเข้าเรียนอัจฉริยะด้วยการตรวจพิกัด GPS, สแกนรหัส Dynamic QR, และการวิเคราะห์จดจำใบหน้า",
    version="1.0.0"
)

# ตั้งค่าการข้ามขอบเขตโดเมนหลัก (CORS Configuration)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# แนบเราเตอร์ย่อย (Include Routers)
app.include_router(courses.router)
app.include_router(sessions.router)
app.include_router(attendance.router)

# Pydantic Schema สำหรับทดสอบขึ้นทะเบียนผู้ใช้ (Helper Endpoint)
class RegisterUserRequest(BaseModel):
    id: str  # UUID จาก Supabase Auth
    email: str
    full_name: str
    role: str
    student_id: Optional[str] = None

@app.get("/")
async def root():
    return {
        "status": "healthy",
        "service": "KMUTNB Smart Attendance System Backend API",
        "version": "1.0.0"
    }

@app.post("/auth/register-profile", status_code=status.HTTP_201_CREATED)
async def register_user_profile(user_data: RegisterUserRequest):
    """
    Helper Endpoint: สร้างข้อมูลโปรไฟล์ผู้ใช้งานในตาราง public.users
    (รันเมื่อเกิดทริกเกอร์หรือใช้สำหรับจำลองการล็อกอิน Google Auth ครั้งแรก)
    """
    try:
        # ตรวจสอบการลงทะเบียนซ้ำ
        exist = supabase_client.table("users").select("id").eq("id", user_data.id).execute()
        if exist.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="มีบัญชีนี้ในตารางประวัติผู้ใช้งานแล้ว"
            )
            
        response = supabase_client.table("users").insert({
            "id": user_data.id,
            "email": user_data.email,
            "full_name": user_data.full_name,
            "role": user_data.role,
            "student_id": user_data.student_id
        }).execute()
        
        return {
            "status": "success",
            "detail": "บันทึกโปรไฟล์ผู้ใช้ลงฐานข้อมูลสำเร็จ",
            "data": response.data[0]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถจัดบันทึกข้อมูลโปรไฟล์ได้: {str(e)}"
        )
