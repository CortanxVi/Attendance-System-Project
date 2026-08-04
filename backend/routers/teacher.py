import os
import csv
import io
import uuid
from fastapi import APIRouter, HTTPException, File, UploadFile
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

from services.attendance_export_service import export_service

load_dotenv()
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

teacher_router = APIRouter(prefix="/api/v1/teacher", tags=["Teacher"])

@teacher_router.get("/export/attendance/{course_id}")
async def get_teacher_export_attendance(course_id: str):
    """ดึงข้อมูลสำหรับการ Export รายงานสำหรับอาจารย์"""
    try:
        data, error = export_service.get_export_data(course_id)
        if error:
            raise HTTPException(status_code=404, detail=error)
            
        return {
            "status": "success",
            "course": data["course"],
            "records": data["records"],
            "sessions": data.get("sessions", [])
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ManualAttendanceUpdate(BaseModel):
    status: str # present, late, absent

@teacher_router.put("/attendance/{record_id}")
async def update_attendance_manual(record_id: str, payload: ManualAttendanceUpdate):
    """แก้ไขสถานะการเข้าเรียนแบบ Manual (กรณีระบบผิดพลาด)"""
    try:
        if payload.status not in ["present", "late", "absent", "leave"]:
            raise HTTPException(status_code=400, detail="สถานะไม่ถูกต้อง")
            
        update_data = {
            "status": payload.status,
            "method": "manual"
        }
        
        response = supabase.table("attendance_records").update(update_data).eq("id", record_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการเช็คชื่อ")
            
        return {"status": "success", "message": "อัปเดตสถานะสำเร็จ", "data": response.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ManualAttendanceCreate(BaseModel):
    student_id: str
    session_id: str
    status: str

@teacher_router.post("/attendance")
async def create_attendance_manual(payload: ManualAttendanceCreate):
    """เพิ่มข้อมูลการเข้าเรียนแบบ Manual (กรณีไม่มีข้อมูลเลย)"""
    try:
        if payload.status not in ["present", "late", "absent", "leave"]:
            raise HTTPException(status_code=400, detail="สถานะไม่ถูกต้อง")
            
        # ตรวจสอบว่ามี user หรือไม่
        profile_res = supabase.table("profiles").select("id").eq("student_id", payload.student_id).execute()
        if not profile_res.data:
            raise HTTPException(status_code=404, detail="ไม่พบนักศึกษาในระบบ")
            
        insert_data = {
            "id": str(uuid.uuid4()),
            "student_id": profile_res.data[0]["id"],
            "session_id": payload.session_id,
            "status": payload.status,
            "method": "manual"
        }
        
        response = supabase.table("attendance_records").insert(insert_data).execute()
        return {"status": "success", "message": "เพิ่มข้อมูลสำเร็จ", "data": response.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@teacher_router.post("/import/students")
async def import_students_csv(file: UploadFile = File(...)):
    """อัปโหลดไฟล์ CSV เพื่อนำเข้ารายชื่อนักศึกษาเข้าระบบ"""
    try:
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="กรุณาอัปโหลดไฟล์นามสกุล .csv เท่านั้น")
            
        content = await file.read()
        # ใช้ io.StringIO ช่วยอ่านเป็น text
        text = content.decode('utf-8-sig') # ใช้ utf-8-sig เพื่อรองรับไฟล์ที่มี BOM จาก Excel
        csv_reader = csv.DictReader(io.StringIO(text))
        
        # ตรวจสอบ header
        fieldnames = csv_reader.fieldnames or []
        if 'student_id' not in fieldnames or 'full_name' not in fieldnames:
             raise HTTPException(status_code=400, detail="ไฟล์ CSV ต้องมีคอลัมน์ 'student_id' และ 'full_name'")

        success_count = 0
        error_count = 0
        
        for row in csv_reader:
            student_id = str(row.get('student_id', '')).strip()
            full_name = str(row.get('full_name', '')).strip()
            
            if not student_id or not full_name:
                continue
                
            # ตรวจสอบว่ามีรหัสนี้หรือยัง
            existing = supabase.table("profiles").select("id").eq("student_id", student_id).execute()
            if not existing.data:
                # ถ้ายังไม่มี ให้เพิ่มใหม่
                user_id = str(uuid.uuid4())
                new_user = {
                    "id": user_id,
                    "student_id": student_id,
                    "full_name": full_name,
                    "role": "student",
                    "face_registered": False,
                    "nfc_uid": None
                }
                res = supabase.table("profiles").insert(new_user).execute()
                if res.data:
                    success_count += 1
                else:
                    error_count += 1
            else:
                # ถ้ามีแล้ว ข้ามไป
                error_count += 1
                
        return {
            "status": "success",
            "message": f"นำเข้าสำเร็จ {success_count} รายการ, ข้าม/ผิดพลาด {error_count} รายการ"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
