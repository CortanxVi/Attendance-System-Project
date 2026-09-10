from io import BytesIO
import os
from pathlib import Path
import unittest
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook


os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from core.request_limits import _is_roster_import
from services.roster_import_service import RosterImportError, parse_roster_file


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def official_roster_fixture() -> bytes:
    """Build the documented two-row-header shape without a developer-local file."""

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "รายชื่อ"
    sheet["A2"] = "ภาคการศึกษา 1/2569"
    sheet["A3"] = "วิชา 030513300 Python Programming 3 (3-0)"
    sheet["A8"] = "รหัส"
    sheet["A9"] = "นักศึกษา"
    sheet["B8"] = "ชื่อ -"
    sheet["B9"] = "สกุล"
    sheet["C8"] = "กลุ่ม"
    sheet["C9"] = "เรียน"
    for index in range(35):
        admission_year = 62 if index == 0 else (68 if index == 34 else 65)
        student_id = f"{admission_year:02d}0302162{index + 181:04d}"[-13:]
        if index == 0:
            student_id = "6203021620181"
        sheet.append([student_id, f"นักศึกษา ทดสอบ {index + 1}", "TDET-DE-RA"])
    buffer = BytesIO()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


class RosterParserTests(unittest.TestCase):
    def test_reads_official_two_row_header_xlsx(self):
        parsed = parse_roster_file(
            official_roster_fixture(),
            "official-roster.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertEqual(parsed.detected_course_code, "030513300")
        self.assertEqual(parsed.detected_academic_year, 2569)
        self.assertEqual(parsed.header_row, 8)
        self.assertEqual(len(parsed.rows), 35)
        self.assertFalse(any(row.errors for row in parsed.rows))
        self.assertEqual(parsed.rows[0].student_id, "6203021620181")
        self.assertEqual(parsed.rows[0].academic_year, 8)
        self.assertEqual(parsed.rows[-1].academic_year, 2)

    def test_reads_normalized_utf8_csv_and_derives_email(self):
        content = (
            "student_id,full_name,class_level,academic_year\n"
            "6803013610010,นายทดสอบ ระบบ,TDET-DE-RA รอบเช้า,2\n"
        ).encode("utf-8")
        parsed = parse_roster_file(content, "roster.csv", "text/csv")
        self.assertEqual(len(parsed.rows), 1)
        self.assertEqual(
            parsed.rows[0].email,
            "s6803013610010@email.kmutnb.ac.th",
        )
        self.assertEqual(parsed.rows[0].class_level, "TDET-DE-RA รอบเช้า")

    def test_reads_windows_thai_csv(self):
        content = (
            "รหัสนักศึกษา,ชื่อ - สกุล,กลุ่มเรียน\n"
            "6803013610010,นายทดสอบ ระบบ,TDET-DE-RA\n"
        ).encode("cp874")
        parsed = parse_roster_file(content, "รายชื่อ.csv", "application/vnd.ms-excel")
        self.assertEqual(parsed.encoding, "cp874")
        self.assertEqual(parsed.rows[0].full_name, "นายทดสอบ ระบบ")

    def test_marks_duplicate_and_formula_like_rows_invalid(self):
        content = (
            "student_id,full_name\n"
            "6803013610010,=HYPERLINK(unsafe)\n"
            "6803013610010,นายทดสอบ ระบบ\n"
            "6803013610011,-2+3\n"
        ).encode("utf-8")
        parsed = parse_roster_file(content, "roster.csv", "text/csv")
        self.assertTrue(all(row.errors for row in parsed.rows))
        self.assertIn("รหัสนักศึกษาซ้ำในไฟล์", parsed.rows[0].errors)
        self.assertIn("ชื่อ-นามสกุลมีอักขระขึ้นต้นที่ไม่ปลอดภัย", parsed.rows[0].errors)
        self.assertIn("ชื่อ-นามสกุลมีอักขระขึ้นต้นที่ไม่ปลอดภัย", parsed.rows[2].errors)

    def test_rejects_disguised_file_type(self):
        with self.assertRaises(RosterImportError):
            parse_roster_file(b"not a zip", "roster.xlsx", "application/octet-stream")

    def test_rejects_xlsx_decompression_bomb(self):
        buffer = BytesIO()
        with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", "types")
            archive.writestr("xl/workbook.xml", "workbook")
            archive.writestr("xl/worksheets/sheet1.xml", "A" * (21 * 1024 * 1024))
        with self.assertRaises(RosterImportError) as caught:
            parse_roster_file(
                buffer.getvalue(),
                "bomb.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        self.assertEqual(caught.exception.status_code, 413)


class RosterImportBoundaryTests(unittest.TestCase):
    def test_upload_middleware_recognizes_preview_and_commit_only(self):
        base = {"type": "http", "method": "POST", "headers": []}
        self.assertTrue(_is_roster_import({**base, "path": "/api/v1/teacher/courses/course-id/roster/import/preview"}))
        self.assertTrue(_is_roster_import({**base, "path": "/api/v1/teacher/courses/course-id/roster/import/commit"}))
        self.assertFalse(_is_roster_import({**base, "path": "/api/v1/teacher/courses/course-id/roster"}))

    def test_migration_keeps_roster_functions_backend_only(self):
        migration = (
            PROJECT_ROOT / "supabase" / "migrations" /
            "20260901160534_optimized_roster_import.sql"
        ).read_text(encoding="utf-8").lower()
        self.assertIn("security definer", migration)
        self.assertIn("set search_path = ''", migration)
        self.assertIn("revoke all on function public.import_course_roster", migration)
        self.assertIn("revoke all on function public.list_course_roster", migration)
        self.assertIn("to service_role", migration)
        self.assertNotIn("to authenticated;", migration)


if __name__ == "__main__":
    unittest.main()
