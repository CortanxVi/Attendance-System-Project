"""Release guards for the deployment files (Phase B, 2026-11-15).

1. Single worker: services/action_fallback.py keeps the "two blink failures -> move_closer" state
   in process memory. With several uvicorn workers a student's failures would land on different
   processes and the switch could never trigger, so every launcher must pin `--workers 1`.
   (uvicorn also reads WEB_CONCURRENCY when --workers is absent, so the flag must be explicit.)
2. Image secrets: the backend Dockerfile does `COPY . /app`, so any env backup such as .env.old
   (real keys) would be baked into the image unless .dockerignore excludes it.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def _read(relative: str) -> str:
    return (REPO / relative).read_text(encoding="utf-8")


def _workers(text: str) -> list[str]:
    return re.findall(r"""--workers["',\s]+["']?(\d+)""", text)


class SingleWorkerTests(unittest.TestCase):
    def test_dockerfile_runs_one_worker(self) -> None:
        self.assertEqual(_workers(_read("backend/Dockerfile")), ["1"])

    def test_systemd_unit_runs_one_worker(self) -> None:
        unit = _read("deployment/systemd/km-attendance-backend.service")
        self.assertEqual(_workers(unit), ["1"])

    def test_compose_files_do_not_override_the_image_command(self) -> None:
        for name in ("compose.production.yml", "compose.staging.yml"):
            text = _read(f"deployment/docker/{name}")
            self.assertNotRegex(text, r"(?m)^\s+(command|entrypoint):", name)
            self.assertNotIn("WEB_CONCURRENCY", text, name)

    def test_regex_reads_both_forms(self) -> None:
        self.assertEqual(_workers('"--workers", "2"'), ["2"])
        self.assertEqual(_workers("--workers 3 --limit"), ["3"])


class DockerContextSecretTests(unittest.TestCase):
    def _patterns(self, relative: str) -> list[str]:
        return [line.strip() for line in _read(relative).splitlines() if line.strip() and not line.startswith("#")]

    def test_backend_image_excludes_env_files_and_backups(self) -> None:
        patterns = self._patterns("backend/.dockerignore")
        self.assertIn(".env", patterns)
        self.assertIn(".env.*", patterns)
        self.assertIn("tests", patterns)

    def test_ocr_image_excludes_env_files_and_backups(self) -> None:
        patterns = self._patterns("ocr-service/.dockerignore")
        self.assertIn(".env", patterns)
        self.assertIn(".env.*", patterns)


if __name__ == "__main__":
    unittest.main()
