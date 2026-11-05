import unittest
from datetime import datetime

from types import SimpleNamespace

from services.student_year_service import (
    current_academic_year,
    derive_admission_year,
    derive_study_year,
    normalize_student_id,
    resolve_student_id,
    student_id_from_email,
    sync_stored_study_year,
    with_derived_study_year,
)


class StudentYearServiceTests(unittest.TestCase):
    def test_derives_current_study_year_from_buddhist_admission_prefix(self):
        now = datetime(2026, 9, 21)
        self.assertEqual(derive_study_year("6902041520261", now=now), 1)
        self.assertEqual(derive_study_year("6803013610010", now=now), 2)
        self.assertEqual(derive_study_year("6612345678901", now=now), 4)
        self.assertEqual(derive_study_year("6203021620181", now=now), 8)

    def test_rejects_invalid_or_out_of_supported_range_ids(self):
        now = datetime(2026, 9, 21)
        self.assertIsNone(derive_study_year(None, now=now))
        self.assertIsNone(derive_study_year("not-a-student-id", now=now))
        self.assertIsNone(derive_study_year("6103021620181", now=now))

    def test_normalizes_surrounding_whitespace(self):
        self.assertEqual(normalize_student_id(" 6902041520261 "), "6902041520261")
        self.assertEqual(
            derive_admission_year(" 6902041520261 ", buddhist_year=2569),
            2569,
        )

    def test_explicit_roster_academic_year_uses_same_formula(self):
        self.assertEqual(
            derive_study_year("6803013610010", buddhist_year=2569),
            2,
        )

    def test_response_helper_overrides_stale_stored_year_without_mutation(self):
        stored = {"student_id": "6803013610010", "academic_year": None}
        derived = with_derived_study_year(stored, buddhist_year=2569)
        self.assertIsNone(stored["academic_year"])
        self.assertEqual(derived["academic_year"], 2)
        self.assertEqual(derived["admission_year"], 2568)
        self.assertEqual(derived["academic_year_source"], "student_id")


class AcademicYearRolloverTests(unittest.TestCase):
    def test_academic_year_starts_on_first_of_june(self):
        self.assertEqual(current_academic_year(now=datetime(2026, 11, 5)), 2569)
        self.assertEqual(current_academic_year(now=datetime(2027, 1, 1)), 2569)
        self.assertEqual(current_academic_year(now=datetime(2027, 3, 31)), 2569)
        self.assertEqual(current_academic_year(now=datetime(2027, 5, 31)), 2569)
        self.assertEqual(current_academic_year(now=datetime(2027, 6, 1)), 2570)
        self.assertEqual(current_academic_year(now=datetime(2027, 10, 31)), 2570)

    def test_study_year_does_not_change_on_new_year_day(self):
        before = derive_study_year("6902041520261", now=datetime(2026, 12, 31))
        after = derive_study_year("6902041520261", now=datetime(2027, 1, 1))
        self.assertEqual((before, after), (1, 1))

    def test_study_year_moves_up_on_first_of_june(self):
        self.assertEqual(derive_study_year("6902041520261", now=datetime(2027, 5, 31)), 1)
        self.assertEqual(derive_study_year("6902041520261", now=datetime(2027, 6, 1)), 2)

    def test_bounds_are_one_to_eight_and_outside_is_not_shown(self):
        now = datetime(2026, 11, 5)
        self.assertEqual(derive_study_year("6902041520261", now=now), 1)
        self.assertEqual(derive_study_year("6203021620181", now=now), 8)
        self.assertIsNone(derive_study_year("6103021620181", now=now))  # would be year 9
        self.assertIsNone(derive_study_year("7002041520261", now=now))  # admission in the future


class StudentIdFromEmailTests(unittest.TestCase):
    def test_cuts_the_thirteen_digit_id_out_of_the_student_mailbox(self):
        self.assertEqual(student_id_from_email("s6902041520261@email.kmutnb.ac.th"), "6902041520261")
        self.assertEqual(student_id_from_email(" S6902041520261@EMAIL.KMUTNB.AC.TH "), "6902041520261")

    def test_other_addresses_do_not_match(self):
        self.assertIsNone(student_id_from_email("teacher@kmutnb.ac.th"))
        self.assertIsNone(student_id_from_email("s690204152026@email.kmutnb.ac.th"))
        self.assertIsNone(student_id_from_email("s6902041520261@email.kmutnb.ac.th.evil.com"))
        self.assertIsNone(student_id_from_email(None))

    def test_email_wins_over_the_stored_profile_id(self):
        self.assertEqual(
            resolve_student_id("s6902041520261@email.kmutnb.ac.th", "6803013610010"),
            "6902041520261",
        )

    def test_stored_id_is_used_when_email_has_no_id(self):
        self.assertEqual(resolve_student_id("a@kmutnb.ac.th", "6803013610010"), "6803013610010")
        self.assertIsNone(resolve_student_id("a@kmutnb.ac.th", "bad"))

    def test_year_is_derived_from_email_even_when_stored_id_is_missing(self):
        now = datetime(2026, 11, 5)
        self.assertEqual(
            derive_study_year(None, now=now, email="s6803013610010@email.kmutnb.ac.th"),
            2,
        )

    def test_response_helper_uses_the_email_id(self):
        profile = {"student_id": None, "email": "s6803013610010@email.kmutnb.ac.th"}
        result = with_derived_study_year(profile, buddhist_year=2569)
        self.assertEqual(result["academic_year"], 2)
        self.assertEqual(result["admission_year"], 2568)


class _ProfilesClient:
    def __init__(self, fail=False):
        self.fail = fail
        self.updates = []

    def table(self, name):
        assert name == "profiles"
        return self

    def update(self, values):
        self.updates.append(values)
        return self

    def eq(self, *_args):
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("database down")
        return SimpleNamespace(data=[])


class SyncStoredStudyYearTests(unittest.TestCase):
    def test_writes_when_value_changed(self):
        client = _ProfilesClient()
        self.assertTrue(sync_stored_study_year(client, "user-1", None, 2))
        self.assertEqual(client.updates, [{"academic_year": 2}])

    def test_skips_write_when_value_is_already_stored(self):
        client = _ProfilesClient()
        self.assertFalse(sync_stored_study_year(client, "user-1", 2, 2))
        self.assertEqual(client.updates, [])

    def test_skips_write_when_year_cannot_be_derived(self):
        client = _ProfilesClient()
        self.assertFalse(sync_stored_study_year(client, "user-1", 3, None))
        self.assertEqual(client.updates, [])

    def test_failed_write_never_raises(self):
        self.assertFalse(sync_stored_study_year(_ProfilesClient(fail=True), "user-1", None, 2))


if __name__ == "__main__":
    unittest.main()
