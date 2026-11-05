"""Teachers can drop problem rows from one import run without touching the uploaded file."""

import hashlib
import os
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, UploadFile

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-server-key")

from routers import teacher
from services.roster_import_service import RosterImportError, parse_roster_file

# File rows: 1 semester, 2 course, 3 header, 4 good, 5 bad id, 6 duplicate A, 7 duplicate A
ROWS = [
    "ภาคการศึกษา 1/2569",
    "วิชา 030513300 Python Programming 3 (3-0) ตอน 1",
    "รหัสนักศึกษา,ชื่อ-สกุล",
    "6902041520261,นักศึกษา หนึ่ง",
    "123,นักศึกษา รหัสผิด",
    "6902041520262,นักศึกษา ซ้ำ ก",
    "6902041520262,นักศึกษา ซ้ำ ข",
]
CSV_BYTES = ("\n".join(ROWS) + "\n").encode("utf-8")


def parse(excluded=frozenset()):
    return parse_roster_file(CSV_BYTES, "roster.csv", "text/csv", excluded)


def errors_by_row(parsed):
    return {row.source_row: row.errors for row in parsed.rows}


class ExcludeRowsParsingTests(unittest.TestCase):
    def test_without_exclusions_problem_rows_are_flagged(self):
        parsed = parse()
        errors = errors_by_row(parsed)
        self.assertEqual(parsed.excluded_count, 0)
        self.assertEqual(sorted(errors), [4, 5, 6, 7])
        self.assertTrue(errors[5])  # bad id
        self.assertTrue(errors[6] and errors[7])  # duplicate in file

    def test_excluded_row_disappears_and_is_counted(self):
        parsed = parse(frozenset({5}))
        self.assertEqual(parsed.excluded_count, 1)
        self.assertEqual(sorted(errors_by_row(parsed)), [4, 6, 7])

    def test_removing_one_of_two_duplicates_clears_the_other(self):
        errors = errors_by_row(parse(frozenset({7})))
        self.assertEqual(errors[6], [])

    def test_unknown_row_numbers_are_ignored(self):
        parsed = parse(frozenset({99, 3000}))
        self.assertEqual(parsed.excluded_count, 0)
        self.assertEqual(len(parsed.rows), 4)

    def test_excluding_every_student_is_rejected_with_a_clear_message(self):
        with self.assertRaises(RosterImportError) as caught:
            parse(frozenset({4, 5, 6, 7}))
        self.assertIn("ไม่เหลือรายชื่อ", caught.exception.message)

    def test_original_bytes_are_never_changed(self):
        before = hashlib.sha256(CSV_BYTES).hexdigest()
        parse(frozenset({5}))
        self.assertEqual(hashlib.sha256(CSV_BYTES).hexdigest(), before)
        self.assertEqual(parse().digest, before)
        self.assertEqual(parse(frozenset({5})).digest, before)


class ExcludedRowsFieldTests(unittest.TestCase):
    def test_empty_field_means_nothing_excluded(self):
        self.assertEqual(teacher._parse_excluded_rows(""), frozenset())
        self.assertEqual(teacher._parse_excluded_rows("  "), frozenset())

    def test_json_list_of_row_numbers_is_accepted(self):
        self.assertEqual(teacher._parse_excluded_rows("[5, 7, 5]"), frozenset({5, 7}))

    def test_malformed_values_are_rejected(self):
        for raw in ("not json", '{"a": 1}', '["5"]', "[true]", "[1.5]", "[0]", "[5001]", "[-3]", "5"):
            with self.subTest(raw=raw):
                with self.assertRaises(HTTPException) as caught:
                    teacher._parse_excluded_rows(raw)
                self.assertEqual(caught.exception.status_code, 400)

    def test_too_many_entries_are_rejected(self):
        raw = "[" + ",".join(str(number) for number in range(1, teacher.MAX_EXCLUDED_ROWS + 2)) + "]"
        with self.assertRaises(HTTPException):
            teacher._parse_excluded_rows(raw)


class EndpointTests(unittest.IsolatedAsyncioTestCase):
    course = {"id": "course-1", "course_code": "030513300", "section": 1}
    summary = {"enroll": 0, "create_invite": 2, "link_invite": 0, "unchanged": 0, "invalid": 0}

    def upload(self):
        return UploadFile(filename="roster.csv", file=BytesIO(CSV_BYTES), headers=None)

    async def test_preview_hides_excluded_rows_and_reports_the_count(self):
        with (
            patch.object(teacher, "require_course_management_permission", return_value=self.course),
            patch.object(teacher, "resolve_roster_actions", return_value=self.summary),
        ):
            result = await teacher.preview_course_roster_import(
                "course-1",
                file=self.upload(),
                excluded_rows="[5]",
                current_user=SimpleNamespace(id="teacher-1"),
            )
        self.assertEqual(result["excluded_count"], 1)
        self.assertEqual([row["source_row"] for row in result["rows"]], [4, 6, 7])

    async def test_preview_rejects_a_bad_exclusion_list_before_reading_the_file(self):
        with patch.object(teacher, "require_course_management_permission", return_value=self.course):
            with self.assertRaises(HTTPException) as caught:
                await teacher.preview_course_roster_import(
                    "course-1",
                    file=self.upload(),
                    excluded_rows="[0]",
                    current_user=SimpleNamespace(id="teacher-1"),
                )
        self.assertEqual(caught.exception.status_code, 400)

    async def test_commit_sends_only_the_remaining_rows_to_the_database(self):
        fake_supabase = MagicMock()
        fake_supabase.rpc.return_value.execute.return_value = SimpleNamespace(
            data={"row_count": 3, "unchanged": 0}
        )
        with (
            patch.object(teacher, "require_course_management_permission", return_value=self.course),
            patch.object(teacher, "resolve_roster_actions", return_value=self.summary),
            patch.object(teacher, "supabase", fake_supabase),
        ):
            result = await teacher.commit_course_roster_import(
                "course-1",
                file=self.upload(),
                expected_sha256=hashlib.sha256(CSV_BYTES).hexdigest(),
                excluded_rows="[5]",
                current_user=SimpleNamespace(id="teacher-1"),
            )
        self.assertEqual(result["status"], "success")
        _name, arguments = fake_supabase.rpc.call_args.args
        self.assertEqual([row["source_row"] for row in arguments["roster_rows"]], [4, 6, 7])
        self.assertEqual(arguments["source_sha256"], hashlib.sha256(CSV_BYTES).hexdigest())

    async def test_commit_without_exclusions_still_blocks_when_rows_are_invalid(self):
        invalid_summary = {**self.summary, "invalid": 1}
        with (
            patch.object(teacher, "require_course_management_permission", return_value=self.course),
            patch.object(teacher, "resolve_roster_actions", return_value=invalid_summary),
        ):
            with self.assertRaises(HTTPException) as caught:
                await teacher.commit_course_roster_import(
                    "course-1",
                    file=self.upload(),
                    expected_sha256=hashlib.sha256(CSV_BYTES).hexdigest(),
                    excluded_rows="",
                    current_user=SimpleNamespace(id="teacher-1"),
                )
        self.assertEqual(caught.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
