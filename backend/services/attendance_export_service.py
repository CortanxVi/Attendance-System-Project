import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

class AttendanceExportService:
    def get_export_data(self, course_id: str):
        """ดึงข้อมูลสำหรับการ Export รายงานการเข้าเรียนของรายวิชานั้น"""
        course_res = supabase.table("courses").select("*").eq("id", course_id).execute()
        if not course_res.data:
            return None, "ไม่พบข้อมูลรายวิชานี้"
            
        course = course_res.data[0]

        records_res = supabase.table("attendance_records") \
            .select("id, check_in_time, status, method, session_id, profiles(student_id, full_name), attendance_sessions!inner(course_id)") \
            .eq("attendance_sessions.course_id", course_id) \
            .order("check_in_time", desc=False) \
            .execute()

        export_data = []
        for r in records_res.data:
            export_data.append({
                "id": r["id"],
                "student_id": r["profiles"]["student_id"] if r["profiles"] else "N/A",
                "full_name": r["profiles"]["full_name"] if r["profiles"] else "Unknown",
                "check_in_time": r["check_in_time"],
                "status": r["status"],
                "method": r["method"],
                "session_id": r["session_id"]
            })

        sessions_res = supabase.table("attendance_sessions") \
            .select("id, created_at, status") \
            .eq("course_id", course_id) \
            .order("created_at", desc=False) \
            .execute()

        return {
            "course": course,
            "records": export_data,
            "sessions": sessions_res.data
        }, None

export_service = AttendanceExportService()
