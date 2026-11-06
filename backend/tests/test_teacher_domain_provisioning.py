"""Static guards for the sign-in role rules in handle_new_user().

The behaviour itself was exercised against a throwaway Postgres; these tests
keep the safety-critical lines from being edited away unnoticed.
"""

import re
import unittest
from pathlib import Path

from core.security import is_allowed_kmutnb_email

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def _migration_sql() -> str:
    files = list(MIGRATIONS.glob("*auto_teacher_for_department_domains.sql"))
    assert len(files) == 1
    return files[0].read_text(encoding="utf-8")


class TeacherDomainMigrationTests(unittest.TestCase):
    def test_admin_role_is_never_derived_from_an_email(self):
        sql = _migration_sql()
        assignments = re.findall(r"derived_role := '(\w+)'", sql)
        self.assertEqual(sorted(assignments), ["student", "teacher"])
        self.assertNotIn("'admin'", sql.split("create or replace function")[1])

    def test_student_mailbox_is_checked_before_department_rule(self):
        body = _migration_sql().split("create or replace function")[1]
        self.assertLess(body.index("@email.kmutnb.ac.th"), body.index("derived_role := 'teacher'"))

    def test_teacher_rule_has_guards(self):
        body = _migration_sql().split("create or replace function")[1]
        self.assertIn("email_subdomain <> ''", body)
        self.assertIn("email_local !~ '^s?[0-9]{13}$'", body)
        self.assertIn("public.teacher_domain_exclusions", body)

    def test_invitation_still_wins_over_email_rules(self):
        body = _migration_sql().split("create or replace function")[1]
        self.assertLess(body.index("if found then"), body.index("derived_role := 'teacher'"))

    def test_exclusion_table_is_closed_to_browser_roles(self):
        sql = _migration_sql()
        self.assertIn("enable row level security", sql)
        self.assertIn("revoke all on public.teacher_domain_exclusions from public, anon, authenticated", sql)
        self.assertIn("values ('email'", sql)

    def test_function_stays_locked_down(self):
        sql = _migration_sql()
        self.assertIn("security definer", sql)
        self.assertIn("set search_path = ''", sql)
        self.assertIn("revoke all on function public.handle_new_user() from public, anon, authenticated", sql)


class BackendEmailGateTests(unittest.TestCase):
    def test_department_and_student_domains_pass_but_lookalikes_do_not(self):
        for ok in ("jirayu.s@cit.kmutnb.ac.th", "jirayu.s@eng.kmutnb.ac.th", "a@x.cit.kmutnb.ac.th"):
            self.assertTrue(is_allowed_kmutnb_email(ok), ok)
        for bad in ("x@cit.kmutnb.ac.th.evil.com", "x@evilkmutnb.ac.th", "x@gmail.com"):
            self.assertFalse(is_allowed_kmutnb_email(bad), bad)


if __name__ == "__main__":
    unittest.main()
