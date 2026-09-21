import unittest
from datetime import datetime

from services.student_year_service import (
    derive_admission_year,
    derive_study_year,
    normalize_student_id,
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


if __name__ == "__main__":
    unittest.main()
