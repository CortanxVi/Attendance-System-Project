"""A roster sheet that belongs to another course must be rejected before any matching."""

import os
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import UploadFile

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from routers import teacher
from services.roster_import_service import (
    parse_roster_file,
    roster_course_mismatch,
    roster_mismatch_reason,
    roster_section_mismatch,
)


def roster_csv(
    course_line: str | None = "วิชา 030513300 Python Programming 3 (3-0)",
    section_line: str | None = None,
) -> bytes:
    lines = ["ภาคการศึกษา 1/2569"]
    if course_line:
        lines.append(course_line)
    if section_line:
        lines.append(section_line)
    lines += [
        "รหัสนักศึกษา,ชื่อ-สกุล",
        "6902041520261,นักศึกษา ทดสอบ",
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def parsed_roster(
    course_line: str | None = "วิชา 030513300 Python Programming 3 (3-0)",
    section_line: str | None = None,
):
    return parse_roster_file(roster_csv(course_line, section_line), "roster.csv", "text/csv")


class CourseMismatchHelperTests(unittest.TestCase):
    def test_same_course_is_not_a_mismatch(self):
        self.assertFalse(roster_course_mismatch(parsed_roster(), "030513300"))

    def test_code_formatting_differences_are_ignored(self):
        self.assertFalse(roster_course_mismatch(parsed_roster(), " 030513-300 "))

    def test_different_course_is_a_mismatch(self):
        self.assertTrue(roster_course_mismatch(parsed_roster(), "030513301"))

    def test_file_without_course_line_is_not_a_mismatch(self):
        self.assertFalse(roster_course_mismatch(parsed_roster(course_line=None), "030513301"))


class SectionDetectionTests(unittest.TestCase):
    def test_section_on_the_course_line(self):
        parsed = parsed_roster("วิชา 030513300 Python Programming 3 (3-0) ตอน 3")
        self.assertEqual(parsed.detected_section, 3)
        self.assertEqual(parsed.detected_course_code, "030513300")
        self.assertEqual(parsed.detected_course_name, "Python Programming")

    def test_section_on_its_own_line_with_leading_zeros(self):
        self.assertEqual(parsed_roster(section_line="ตอนเรียน: 003").detected_section, 3)
        self.assertEqual(parsed_roster(section_line="Section 02").detected_section, 2)

    def test_no_section_in_file_means_nothing_to_compare(self):
        parsed = parsed_roster()
        self.assertIsNone(parsed.detected_section)
        self.assertFalse(roster_section_mismatch(parsed, 1))

    def test_header_and_student_rows_are_never_read_as_a_section(self):
        # "กลุ่มเรียน" column header and student rows sit below the preamble.
        content = (
            "ภาคการศึกษา 1/2569\nวิชา 030513300 Python Programming 3 (3-0)\n"
            "รหัสนักศึกษา,ชื่อ-สกุล,กลุ่มเรียน\n6902041520261,นักศึกษา ตอน 5,กลุ่ม 7\n"
        ).encode("utf-8")
        parsed = parse_roster_file(content, "roster.csv", "text/csv")
        self.assertIsNone(parsed.detected_section)

    def test_words_that_merely_contain_sec_are_ignored(self):
        parsed = parsed_roster("วิชา 030513300 Security Basics 3 (3-0)")
        self.assertIsNone(parsed.detected_section)


class SectionMismatchTests(unittest.TestCase):
    def test_same_section_matches(self):
        parsed = parsed_roster(section_line="ตอน 3")
        self.assertFalse(roster_section_mismatch(parsed, 3))
        self.assertFalse(roster_section_mismatch(parsed, "3"))

    def test_different_section_is_a_mismatch(self):
        parsed = parsed_roster(section_line="ตอน 3")
        self.assertTrue(roster_section_mismatch(parsed, 1))

    def test_unusable_course_section_never_blocks(self):
        parsed = parsed_roster(section_line="ตอน 3")
        self.assertFalse(roster_section_mismatch(parsed, None))
        self.assertFalse(roster_section_mismatch(parsed, "abc"))

    def test_reason_reports_course_before_section(self):
        parsed = parsed_roster(section_line="ตอน 3")
        self.assertEqual(roster_mismatch_reason(parsed, {"course_code": "030513301", "section": 3}), "course")
        self.assertEqual(roster_mismatch_reason(parsed, {"course_code": "030513300", "section": 1}), "section")
        self.assertIsNone(roster_mismatch_reason(parsed, {"course_code": "030513300", "section": 3}))


def registrar_sheet(section: int = 1, student_count: int = 5) -> bytes:
    """Synthetic copy of the real registrar layout (fake course owner, names and ids).

    Mirrors what the university export looks like: a title block, the course line
    with credits written as "3(2-3-5)" and the section after "ตอน", two blank rows,
    a two-line header ("เลขประจำตัว" over "นักศึกษา"), dash-separated student ids,
    a week-number row under "สัปดาห์", and a print footer.
    """
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet["A1"] = "มหาวิทยาลัยตัวอย่าง"
    sheet["I1"] = "รายชื่อนักศึกษาลงทะเบียน"
    sheet["A2"] = " มจพ. กรุงเทพฯ  ภาคการศึกษา 1/2569"
    sheet["A3"] = "ระดับปริญญาตรี 4 ปี / 5 ปี"
    sheet["A4"] = f"วิชา  030513300  การโปรแกรมคอมพิวเตอร์   3(2-3-5)  ตอน  {section}"
    sheet["F4"] = "ผู้สอน ผู้สอนสมมติ"
    sheet["A5"] = "วันเวลาเรียน พฤ. 14:00-16:00 ห้องเรียน 62-604"
    sheet["F5"] = "วันเวลาสอบ Final 26/10/69 13:00-16:00, Midterm 21/08/69 15:00-17:00"
    sheet["A8"], sheet["B8"], sheet["C8"], sheet["D8"], sheet["E8"] = (
        "ลำดับ", "เลขประจำตัว", "ชื่อ - สกุล", "กลุ่มเรียน", "สัปดาห์",
    )
    sheet["B9"] = "นักศึกษา"
    for week in range(1, 17):
        sheet.cell(row=9, column=4 + week, value=str(week))
    for index in range(1, student_count + 1):
        sheet.append([
            str(index),
            f"66-030516-{index:04d}-1",
            f"นายตัวอย่าง{index}  ทดสอบ",
            "TEST-GROUP รอบเช้า",
        ])
    sheet.append([])
    sheet.append(["พิมพ์ ณ วันที่ 1/1/2569"])
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class RegistrarLayoutTests(unittest.TestCase):
    def parse(self, **kwargs):
        return parse_roster_file(registrar_sheet(**kwargs), "roster.xlsx", XLSX_TYPE)

    def test_course_section_and_students_are_read_from_the_real_layout(self):
        parsed = self.parse(student_count=5)
        self.assertEqual(parsed.detected_course_code, "030513300")
        self.assertEqual(parsed.detected_course_name, "การโปรแกรมคอมพิวเตอร์")
        self.assertEqual(parsed.detected_section, 1)
        self.assertEqual(parsed.detected_academic_year, 2569)
        self.assertEqual(parsed.header_row, 8)
        self.assertEqual(len(parsed.rows), 5)
        self.assertTrue(all(not row.errors for row in parsed.rows))

    def test_dash_separated_ids_become_thirteen_digits_and_year_is_derived(self):
        row = self.parse().rows[0]
        self.assertEqual(row.student_id, "6603051600011")
        self.assertEqual(row.email, "s6603051600011@email.kmutnb.ac.th")
        self.assertEqual(row.academic_year, 4)  # admitted 2566, semester year 2569
        self.assertEqual(row.class_level, "TEST-GROUP รอบเช้า")

    def test_week_numbers_and_footer_are_not_read_as_students(self):
        self.assertEqual(len(self.parse(student_count=12).rows), 12)

    def test_sheet_for_another_section_is_rejected_for_this_course(self):
        parsed = self.parse(section=3)
        self.assertEqual(parsed.detected_section, 3)
        course = {"course_code": "030513300", "section": 1}
        self.assertEqual(roster_mismatch_reason(parsed, course), "section")
        self.assertIsNone(roster_mismatch_reason(parsed, {**course, "section": 3}))

    def test_sheet_for_another_course_is_rejected_first(self):
        parsed = self.parse()
        self.assertEqual(
            roster_mismatch_reason(parsed, {"course_code": "030513907", "section": 1}),
            "course",
        )


class _FakeUpload:
    filename = "roster.csv"
    content_type = "text/csv"


class ParseAndResolveTests(unittest.TestCase):
    course = {"id": "course-1", "course_code": "030513300"}

    def test_wrong_course_stops_before_database_matching(self):
        wrong_course = {**self.course, "course_code": "030513301"}
        with patch.object(teacher, "resolve_roster_actions") as resolve:
            _parsed, summary, errors = teacher._parse_and_resolve_roster(
                roster_csv(), _FakeUpload(), wrong_course
            )
        resolve.assert_not_called()
        self.assertEqual(len(errors), 1)
        self.assertEqual(summary["invalid"], 0)
        self.assertEqual(sum(summary.values()), 0)

    def test_matching_course_goes_on_to_database_matching(self):
        fake_summary = {"enroll": 1, "create_invite": 0, "link_invite": 0, "unchanged": 0, "invalid": 0}
        with patch.object(teacher, "resolve_roster_actions", return_value=fake_summary) as resolve:
            _parsed, summary, errors = teacher._parse_and_resolve_roster(
                roster_csv(), _FakeUpload(), self.course
            )
        resolve.assert_called_once()
        self.assertEqual(errors, [])
        self.assertEqual(summary, fake_summary)


class PreviewEndpointTests(unittest.IsolatedAsyncioTestCase):
    def upload(self):
        return UploadFile(filename="roster.csv", file=BytesIO(roster_csv()), headers=None)

    async def preview(self, course_code):
        course = {"id": "course-1", "course_code": course_code}
        fake_summary = {"enroll": 1, "create_invite": 0, "link_invite": 0, "unchanged": 0, "invalid": 0}
        with (
            patch.object(teacher, "require_course_management_permission", return_value=course),
            patch.object(teacher, "resolve_roster_actions", return_value=fake_summary),
        ):
            return await teacher.preview_course_roster_import(
                "course-1",
                file=self.upload(),
                current_user=SimpleNamespace(id="teacher-1"),
            )

    async def test_wrong_course_is_flagged_and_returns_no_rows(self):
        result = await self.preview("030513301")
        self.assertTrue(result["course_mismatch"])
        self.assertFalse(result["ready"])
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["expected_course_code"], "030513301")
        self.assertEqual(result["detected"]["course_code"], "030513300")

    async def test_wrong_section_is_flagged_with_its_reason(self):
        course = {"id": "course-1", "course_code": "030513300", "section": 1}
        upload = UploadFile(
            filename="roster.csv",
            file=BytesIO(roster_csv(section_line="ตอน 3")),
            headers=None,
        )
        with (
            patch.object(teacher, "require_course_management_permission", return_value=course),
            patch.object(teacher, "resolve_roster_actions") as resolve,
        ):
            result = await teacher.preview_course_roster_import(
                "course-1", file=upload, current_user=SimpleNamespace(id="teacher-1")
            )
        resolve.assert_not_called()
        self.assertTrue(result["course_mismatch"])
        self.assertEqual(result["mismatch_reason"], "section")
        self.assertEqual(result["detected"]["section"], 3)
        self.assertEqual(result["expected_section"], 1)
        self.assertEqual(result["rows"], [])

    async def test_matching_course_is_ready_with_rows(self):
        result = await self.preview("030513300")
        self.assertFalse(result["course_mismatch"])
        self.assertTrue(result["ready"])
        self.assertEqual(len(result["rows"]), 1)


if __name__ == "__main__":
    unittest.main()
