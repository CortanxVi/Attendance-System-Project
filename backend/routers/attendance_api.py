from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import schemas
from supabase_client import supabase

router = APIRouter(
    prefix="/attendance",
    tags=["attendance"]
)

@router.post("/check-in")
def check_in(payload: schemas.AttendanceCheckIn):
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured. Check your .env file.")
        
    attendance_data = {
        "session_id": payload.session_id,
        "student_id": payload.student_uuid,
        "status": payload.status,
        "method": payload.method,
        "similarity_score": payload.similarity_score
    }
    
    try:
        # 2. ทำการบันทึกข้อมูลการเช็คชื่อเข้าตาราง attendance_records บน Supabase
        response = supabase.table("attendance_records").insert(attendance_data).execute()
        return {"message": "Check-in recorded to Supabase successfully", "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to record check-in: {str(e)}")
