from pathlib import Path
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class LauncherSecurityTests(unittest.TestCase):
    def test_linux_ocr_uses_dedicated_environment_without_supabase_key(self):
        launcher = (PROJECT_ROOT / "start_all.sh").read_text(encoding="utf-8")

        self.assertIn('node --env-file="$project_root/ocr-service/.env"', launcher)
        self.assertIn("major === 22 && minor >= 12", launcher)
        self.assertIn("-u SUPABASE_KEY", launcher)
        self.assertIn("-u SUPABASE_SERVICE_ROLE_KEY", launcher)
        self.assertIn("-u SUPABASE_SECRET_KEY", launcher)
        self.assertIn("-u SUPABASE_URL", launcher)
        self.assertNotIn('node --env-file="$project_root/backend/.env"', launcher)

    def test_windows_launcher_uses_current_environment_and_virtualenv(self):
        launcher = (PROJECT_ROOT / "start_all.bat").read_text(encoding="utf-8")

        self.assertIn(r"backend\.venv-windows\Scripts\python.exe", launcher)
        self.assertIn(r"ocr-service\start_windows.cmd", launcher)
        self.assertIn("major === 22 && minor >= 12", launcher)
        self.assertNotIn(r"backend\.venv\Scripts\python.exe", launcher)
        self.assertNotIn(r"backend\venv\Scripts", launcher)
        self.assertNotIn("Demo0.2", launcher)

    def test_windows_setup_preserves_env_and_uses_a_separate_virtualenv(self):
        setup = (PROJECT_ROOT / "setup_windows.bat").read_text(encoding="utf-8")

        self.assertIn(r"backend\.venv-windows\Scripts\python.exe", setup)
        self.assertIn("struct.calcsize('P') * 8 == 64", setup)
        self.assertIn("('amd64', 'x86_64')", setup)
        self.assertIn("major === 22 && minor >= 12", setup)
        self.assertIn("call npm.cmd ci", setup)
        self.assertIn("call npm.cmd run doctor", setup)
        for destination in (
            r"backend\.env",
            r"ocr-service\.env",
            r"frontend\.env.local",
        ):
            self.assertIn(f'if not exist "%PROJECT_ROOT%\\{destination}"', setup)

    def test_windows_ocr_removes_database_and_frontend_credentials(self):
        launcher = (PROJECT_ROOT / "ocr-service" / "start_windows.cmd").read_text(encoding="utf-8")

        for variable in (
            "SUPABASE_URL",
            "SUPABASE_KEY",
            "SUPABASE_SECRET_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "VITE_SUPABASE_URL",
            "VITE_SUPABASE_ANON_KEY",
            "VITE_SUPABASE_PUBLISHABLE_KEY",
        ):
            self.assertIn(f'set "{variable}="', launcher)
        self.assertIn('node --env-file="%~dp0.env"', launcher)

    def test_backend_requirements_do_not_force_linux_gpu_packages(self):
        requirements = (PROJECT_ROOT / "backend" / "requirement.txt").read_text(encoding="utf-8")

        for package in ("nvidia-", "cuda-", "triton==", "torch==", "torchvision==", "opencv-python-headless"):
            self.assertNotIn(package, requirements)
        self.assertIn("onnxruntime==", requirements)
        self.assertIn("opencv-python==", requirements)

    def test_node_lockfiles_include_windows_native_packages(self):
        ocr_lock = (PROJECT_ROOT / "ocr-service" / "package-lock.json").read_text(encoding="utf-8")
        frontend_lock = (PROJECT_ROOT / "frontend" / "package-lock.json").read_text(encoding="utf-8")

        self.assertIn("@arcships/light-ocr-win32-x64", ocr_lock)
        self.assertIn("@arcships/light-ocr-win32-arm64", ocr_lock)
        self.assertIn("@rollup/rollup-win32-x64-msvc", frontend_lock)

    def test_production_deployment_is_atomic_and_requires_release_gates(self):
        installer = (PROJECT_ROOT / "scripts" / "install_production_release.sh").read_text(encoding="utf-8")
        rollback = (PROJECT_ROOT / "scripts" / "rollback_production_release.sh").read_text(encoding="utf-8")
        nginx = (PROJECT_ROOT / "deployment" / "nginx" / "attendance.conf.example").read_text(encoding="utf-8")
        api_only_nginx = (PROJECT_ROOT / "deployment" / "nginx" / "attendance-api-only.conf.example").read_text(encoding="utf-8")
        backend_unit = (PROJECT_ROOT / "deployment" / "systemd" / "km-attendance-backend.service").read_text(encoding="utf-8")
        ocr_unit = (PROJECT_ROOT / "deployment" / "systemd" / "km-attendance-ocr.service").read_text(encoding="utf-8")
        health_timer = (PROJECT_ROOT / "deployment" / "systemd" / "km-attendance-healthcheck.timer").read_text(encoding="utf-8")

        self.assertIn("--confirm-database-ready", installer)
        self.assertIn("--confirm-model-license", installer)
        self.assertIn("source_state", installer)
        self.assertIn("sha256sum --check", installer)
        self.assertIn("production_preflight.py", installer)
        self.assertIn("previous_release", installer)
        self.assertIn("/opt/km-attendance/current", installer)
        self.assertIn("/opt/km-attendance/current", rollback)
        self.assertIn("root /opt/km-attendance/current/frontend/dist", nginx)
        self.assertNotIn('add_header Cache-Control "no-store"', nginx)
        self.assertIn("127.0.0.1:8000", nginx)
        self.assertIn("--api-only", installer)
        self.assertIn("--frontend-origin", installer)
        self.assertIn("attendance-api-only.conf.example", installer)
        self.assertIn("127.0.0.1:8000", api_only_nginx)
        self.assertNotIn("frontend/dist", api_only_nginx)
        self.assertIn("return 404", api_only_nginx)
        self.assertIn("/opt/km-attendance/current/backend", backend_unit)
        self.assertIn("--workers 1", backend_unit)
        self.assertIn("/opt/km-attendance/current/ocr-service", ocr_unit)
        self.assertIn("HOST=127.0.0.1", (PROJECT_ROOT / "deployment" / "ocr.env.example").read_text(encoding="utf-8"))
        self.assertIn("OnUnitActiveSec=1min", health_timer)

    def test_thai_user_and_deployment_guides_exist(self):
        user_guide = (PROJECT_ROOT / "docs" / "USER_GUIDE_TH.md").read_text(encoding="utf-8")
        deploy_guide = (PROJECT_ROOT / "docs" / "DEPLOYMENT_GUIDE_TH.md").read_text(encoding="utf-8")
        hybrid_guide = (PROJECT_ROOT / "docs" / "HYBRID_VERCEL_MINIPC_DEPLOYMENT_TH.md").read_text(encoding="utf-8")

        self.assertIn("คู่มือสำหรับนักศึกษา", user_guide)
        self.assertIn("คู่มือสำหรับอาจารย์", user_guide)
        self.assertIn("ผู้ดูแลระบบถาวร", user_guide)
        self.assertIn("Supabase Staging", deploy_guide)
        self.assertIn("install_production_release.sh", deploy_guide)
        self.assertIn("rollback_production_release.sh", deploy_guide)
        self.assertIn("VITE_API_ORIGIN", hybrid_guide)
        self.assertIn("--api-only", hybrid_guide)
        self.assertIn("CORS_ORIGINS", hybrid_guide)


if __name__ == "__main__":
    unittest.main()
