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

        sessions_res = (
            supabase.table("attendance_sessions")
            .select(
                "id, created_at, closed_at, status, report_semester, report_year, "
                "archived_at, archive_reason"
            )
            .eq("course_id", course_id)
            .order("created_at", desc=False)
            .execute()
        )
        all_sessions = sessions_res.data or []
        active_sessions = [row for row in all_sessions if not row.get("archived_at")]
        archived_sessions = sorted(
            (row for row in all_sessions if row.get("archived_at")),
            key=lambda row: row.get("archived_at") or "",
            reverse=True,
        )
        active_session_ids = [row["id"] for row in active_sessions if row.get("id")]

        records = []
        if active_session_ids:
            records_res = (
                supabase.table("attendance_records")
                .select(
                    "id, check_in_time, status, method, session_id, "
                    "profiles(student_id, full_name)"
                )
                .in_("session_id", active_session_ids)
                .order("check_in_time", desc=False)
                .execute()
            )
            records = records_res.data or []

        export_data = []
        for record in records:
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
            "sessions": active_sessions,
            "archived_sessions": archived_sessions,
            "students": students,
        }, None


export_service = AttendanceExportService()
