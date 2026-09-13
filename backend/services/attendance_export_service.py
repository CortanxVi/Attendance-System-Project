from core.config import supabase_db as supabase


class AttendanceExportService:
    def get_export_data(self, course_id: str):
        """Return one canonical roster/session payload for every report format and role."""
        course_res = (
            supabase.table("courses")
            .select(
                "id, course_code, course_name, teacher_id, section, year, semester, "
                "total_sessions, late_threshold_minutes, absent_threshold_minutes, "
                "max_absence_percent, profiles(full_name)"
            )
            .eq("id", course_id)
            .execute()
        )
        if not course_res.data:
            return None, "ไม่พบข้อมูลรายวิชานี้"

        course = course_res.data[0]

        records_res = (
            supabase.table("attendance_records")
            .select(
                "id, check_in_time, status, method, session_id, "
                "profiles(student_id, full_name), attendance_sessions!inner(course_id)"
            )
            .eq("attendance_sessions.course_id", course_id)
            .order("check_in_time", desc=False)
            .execute()
        )

        export_data = []
        for record in records_res.data or []:
            profile = record.get("profiles") or {}
            export_data.append({
                "id": record["id"],
                "student_id": profile.get("student_id") or "N/A",
                "full_name": profile.get("full_name") or "Unknown",
                "check_in_time": record["check_in_time"],
                "status": record["status"],
                "method": record["method"],
                "session_id": record["session_id"],
            })

        sessions_res = (
            supabase.table("attendance_sessions")
            .select("id, created_at, closed_at, status")
            .eq("course_id", course_id)
            .order("created_at", desc=False)
            .execute()
        )

        enrollments_res = (
            supabase.table("enrollments")
            .select("profiles(student_id, full_name)")
            .eq("course_id", course_id)
            .execute()
        )
        students = sorted(
            (
                {
                    "student_id": row["profiles"]["student_id"],
                    "full_name": row["profiles"].get("full_name") or "ไม่ระบุชื่อ",
                }
                for row in (enrollments_res.data or [])
                if row.get("profiles") and row["profiles"].get("student_id")
            ),
            key=lambda student: student["student_id"],
        )

        return {
            "course": course,
            "records": export_data,
            "sessions": sessions_res.data or [],
            "students": students,
        }, None


export_service = AttendanceExportService()
