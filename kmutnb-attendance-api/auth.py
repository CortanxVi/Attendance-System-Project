from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
from config import settings
import logging

# กำหนดระดับการบันทึก Log
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# เริ่มต้นไคลเอนต์ Supabase
supabase_client: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)

security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    FastAPI Dependency สำหรับแกะและยืนยันสิทธิ์ Token (Supabase Access Token)
    และคืนค่าข้อมูลโปรไฟล์ผู้ใช้จาก Supabase
    """
    token = credentials.credentials
    try:
        # ยืนยันสิทธิ์โทเคนผ่าน Supabase Auth Client
        response = supabase_client.auth.get_user(token)
        user_auth = response.user
        
        if not user_auth:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="ไม่พบข้อมูลผู้ใช้นี้ในระบบยืนยันตัวตน",
                headers={"WWW-Authenticate": "Bearer"},
            )
            
        user_db_response = supabase_client.table("users").select("*").eq("id", user_auth.id).execute()
        user_db = user_db_response.data
        
        if not user_db:
            # ระบบลงทะเบียนอัตโนมัติ (Auto-Registration) สำหรับผู้ใช้ใหม่
            try:
                email = user_auth.email
                # แยกชื่อออกจากอีเมลถ้าไม่มี full_name
                full_name = user_auth.user_metadata.get('full_name', email.split('@')[0])
                # กำหนดบทบาทเบื้องต้น: ถ้านามสกุลอีเมลเป็น kmutnb.ac.th ให้เป็นนักศึกษา
                role = 'student' if 'student' in email.lower() or 'kmutnb.ac.th' in email.lower() else 'lecturer'
                
                new_user_res = supabase_client.table("users").insert({
                    "id": user_auth.id,
                    "email": email,
                    "full_name": full_name,
                    "role": role
                }).execute()
                user_db = new_user_res.data
            except Exception as auto_reg_err:
                import traceback
                logger.error(f"Auto-registration failed: {str(auto_reg_err)}")
                logger.error(f"User data: email={user_auth.email}, id={user_auth.id}")
                logger.error(traceback.format_exc())
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"ผู้ใช้ยังไม่ได้ลงทะเบียนในระบบวิชาการ และระบบลงทะเบียนอัตโนมัติล้มเหลว: {str(auto_reg_err)}",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            
        # ส่งข้อมูลรวมจาก auth และ public.users กลับไป
        return user_db[0]
        
    except Exception as e:
        logger.error(f"เกิดข้อผิดพลาดในการตรวจสอบ Token: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="เซสชันหมดอายุหรือสิทธิ์การเช็คชื่อเข้าเรียนไม่ถูกต้อง",
            headers={"WWW-Authenticate": "Bearer"},
        )

def verify_role(required_roles: list[str]):
    """
    Decorator/Dependency ตรวจสอบบทบาทของผู้ใช้
    """
    def dependency(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") not in required_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="คุณไม่มีสิทธิ์เข้าถึงส่วนงานนี้"
            )
        return current_user
    return dependency
