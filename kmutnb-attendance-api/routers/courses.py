from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from auth import get_current_user, verify_role, supabase_client

router = APIRouter(prefix="/courses", tags=["Courses"])

# Pydantic Schemas
class CourseCreate(BaseModel):
    code: str
    name: str

class SectionCreate(BaseModel):
    course_id: str
    number: int
    room_name: str
    latitude: float
    longitude: float

# Endpoints
@router.get("", response_model=List[dict])
async def list_courses(current_user: dict = Depends(get_current_user)):
    """
    ดึงรายชื่อวิชาทั้งหมดที่เปิดสอนในระบบ
    """
    try:
        response = supabase_client.table("courses").select("*").execute()
        return response.data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถดึงรายชื่อวิชาได้: {str(e)}"
        )

@router.get("/{course_id}/sections", response_model=List[dict])
async def list_sections(course_id: str, current_user: dict = Depends(get_current_user)):
    """
    ดึงข้อมูลตอนเรียน (Sections) ทั้งหมดของวิชาที่กำหนด
    """
    try:
        response = supabase_client.table("sections").select("*").eq("course_id", course_id).execute()
        return response.data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถดึงข้อมูลตอนเรียนได้: {str(e)}"
        )

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_course(course: CourseCreate, current_user: dict = Depends(verify_role(["lecturer", "admin"]))):
    """
    เพิ่มข้อมูลวิชาใหม่ (เฉพาะอาจารย์และแอดมิน)
    """
    try:
        # ตรวจสอบว่าวิชารหัสนี้มีอยู่แล้วหรือไม่
        exist = supabase_client.table("courses").select("id").eq("code", course.code).execute()
        if exist.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="มีรหัสวิชานี้อยู่ในระบบแล้ว"
            )
            
        response = supabase_client.table("courses").insert({
            "code": course.code,
            "name": course.name
        }).execute()
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถเพิ่มวิชาใหม่ได้: {str(e)}"
        )

@router.post("/sections", status_code=status.HTTP_201_CREATED)
async def create_section(section: SectionCreate, current_user: dict = Depends(verify_role(["lecturer", "admin"]))):
    """
    เพิ่มตอนเรียน (Section) ใหม่สำหรับวิชา (เฉพาะอาจารย์และแอดมิน)
    """
    try:
        # ตรวจสอบการซ้ำวิชา + เซกชัน
        exist = supabase_client.table("sections").select("id")\
            .eq("course_id", section.course_id)\
            .eq("number", section.number).execute()
        if exist.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="มีเซกชันนี้สำหรับวิชาเรียนนี้ในระบบแล้ว"
            )
            
        response = supabase_client.table("sections").insert({
            "course_id": section.course_id,
            "number": section.number,
            "room_name": section.room_name,
            "latitude": section.latitude,
            "longitude": section.longitude
        }).execute()
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ไม่สามารถเพิ่มตอนเรียนใหม่ได้: {str(e)}"
        )
