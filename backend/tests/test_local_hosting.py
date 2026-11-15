"""Static guards for hosting the web app and the API on this machine behind one ngrok URL.

The runtime behaviour was checked by running scripts/start_backend_ngrok.sh with
--host-frontend; these tests keep the safety-relevant lines from being edited away.
"""

import re
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _read(relative: str) -> str:
    return (PROJECT_ROOT / relative).read_text(encoding="utf-8")


class HostingConfigTests(unittest.TestCase):
    def setUp(self):
        self.config = _read("frontend/vite.hosting.config.mts")

    def test_web_server_listens_on_loopback_only(self):
        self.assertIn("host: '127.0.0.1'", self.config)
        self.assertNotIn("0.0.0.0", self.config)

    def test_only_the_api_path_is_forwarded_to_the_backend(self):
        proxy_block = self.config.split("proxy:", 1)[1]
        paths = re.findall(r"^\s*'(/[^']*)'\s*:\s*\{", proxy_block, flags=re.MULTILINE)
        self.assertEqual(paths, ["/api"])
        for exposed in ("/health", "/docs", "/openapi", "/redoc"):
            self.assertNotIn(exposed, self.config)

    def test_host_header_is_restricted_not_wildcarded(self):
        self.assertIn("allowedHosts:", self.config)
        self.assertNotIn("allowedHosts: true", self.config)


class HostingScriptTests(unittest.TestCase):
    def setUp(self):
        self.script = _read("scripts/start_backend_ngrok.sh")

    def test_flag_exists_and_tunnels_the_web_port_only_in_that_mode(self):
        self.assertIn("--host-frontend", self.script)
        self.assertIn('tunnel_port="$backend_port"', self.script)
        self.assertIn('tunnel_port="$web_port"', self.script)
        self.assertIn('ngrok http "127.0.0.1:${tunnel_port}"', self.script)

    def test_frontend_is_built_for_same_origin_into_a_private_directory(self):
        self.assertIn('"VITE_API_ORIGIN=" "VITE_API_URL="', self.script)
        self.assertIn("-u VITE_TEST_MODE", self.script)
        self.assertIn('--outDir "$web_dist"', self.script)
        self.assertIn('web_dist="$state_dir/web-dist"', self.script)
        self.assertNotIn("npm run build", self.script)

    def test_test_build_flag_is_added_only_for_test_mode(self):
        self.assertIn('[[ "$test_mode" == true ]] && build_env+=("VITE_TEST_MODE=1")', self.script)

    def test_backend_allows_only_the_public_origin_in_hosting_mode(self):
        self.assertIn('[[ "$host_frontend" == true ]] && origins="$public_url"', self.script)

    def test_hosting_processes_are_stopped_by_stop_and_cleanup(self):
        self.assertIn('safe_kill web "vite"', self.script)
        self.assertIn('"${web_pid:-}"', self.script)

    def test_release_scripts_do_not_know_the_hosting_directory(self):
        for relative in ("scripts/build_release_bundle.sh", "scripts/install_production_release.sh"):
            self.assertNotIn("web-dist", _read(relative), relative)


class TestDatabaseAndExternalEmailScriptTests(unittest.TestCase):
    def setUp(self):
        self.script = _read("scripts/start_backend_ngrok.sh")

    def test_phrases_match_the_backend(self):
        from core.test_mode import (
            ALL_COURSES_ACK_PHRASE,
            EXTERNAL_EMAIL_ACK_PHRASE,
            TEST_MODE_ACK_PHRASE,
        )

        self.assertIn(f'external_email_ack="{EXTERNAL_EMAIL_ACK_PHRASE}"', self.script)
        self.assertIn(f'test_mode_ack="{TEST_MODE_ACK_PHRASE}"', self.script)
        self.assertIn(f'all_courses_ack="{ALL_COURSES_ACK_PHRASE}"', self.script)

    def test_external_email_needs_test_mode_and_the_separate_database(self):
        self.assertIn('"$allow_external" == true && "$test_mode" != true', self.script)
        self.assertIn('"$allow_external" == true && "$test_database" != true', self.script)
        self.assertIn('"$test_database" == true && "$test_mode" != true', self.script)

    def test_test_database_is_never_the_production_project(self):
        self.assertIn('prod_url="$(get_var "$secrets_file" STAGING_PROTECTED_SUPABASE_URL)"', self.script)
        self.assertIn('"${t_url%/}" != "${prod_url%/}"', self.script)
        # backend/.env may point at the test project, so it must not be the reference.
        self.assertNotIn('prod_url="$(get_var "$project_root/backend/.env"', self.script)
        # External e-mail is refused unless the real project is named.
        self.assertIn("--allow-external-email ต้องมี STAGING_PROTECTED_SUPABASE_URL", self.script)

    def test_database_values_come_only_from_the_private_settings_file(self):
        for name in ("STAGING_TEST_SUPABASE_URL", "STAGING_TEST_SUPABASE_SERVICE_KEY", "STAGING_TEST_SUPABASE_ANON_KEY"):
            self.assertIn(f'get_var "$secrets_file" {name}', self.script)

    def test_database_values_reach_only_the_backend_and_the_frontend_build(self):
        backend = self.script.split("# ---------- 3) Backend", 1)[1].split("# ---------- 3b)", 1)[0]
        self.assertIn('"${db_env[@]}"', backend)
        ocr = self.script.split("# ---------- 2) Light OCR", 1)[1].split("# ---------- 3) Backend", 1)[0]
        self.assertNotIn("db_env", ocr)
        self.assertIn("-u SUPABASE_URL -u SUPABASE_KEY", ocr)

    def test_test_database_has_its_own_course_list(self):
        self.assertIn("STAGING_TEST_DB_COURSE_IDS", self.script)

    def test_the_script_never_contains_a_project_url_or_key(self):
        import re

        self.assertIsNone(re.search(r"[a-z0-9]{20}\.supabase\.co", self.script))
        self.assertIsNone(re.search(r"eyJ[A-Za-z0-9_-]{20,}", self.script))
        self.assertIsNone(re.search(r"sb_(secret|publishable)_", self.script))


if __name__ == "__main__":
    unittest.main()
