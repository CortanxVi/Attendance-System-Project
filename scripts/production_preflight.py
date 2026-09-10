#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import re
import sys
from urllib.parse import urlparse

from dotenv import dotenv_values


def configured(value: str | None) -> bool:
    return bool(value and not value.startswith("<") and not value.startswith("https://<"))


def parse_exact_https_origin(value: str, *, allow_trailing_slash: bool = False):
    parsed = urlparse(value)
    try:
        _ = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in ({"", "/"} if allow_trailing_slash else {""})
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        return None
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate production configuration without printing secrets")
    parser.add_argument("--backend-env", type=Path, default=Path("backend/.env"))
    parser.add_argument("--ocr-env", type=Path, default=Path("ocr-service/.env"))
    parser.add_argument("--frontend-env", type=Path, default=Path("frontend/.env.production"))
    parser.add_argument("--model-root", type=Path)
    parser.add_argument("--expected-version")
    parser.add_argument("--expected-frontend-origin")
    parser.add_argument("--expected-api-origin")
    parser.add_argument("--require-cross-origin-api", action="store_true")
    parser.add_argument("--allow-development", action="store_true")
    args = parser.parse_args()

    failures: list[str] = []
    for path in (args.backend_env, args.ocr_env, args.frontend_env):
        if not path.is_file():
            failures.append(f"missing file: {path}")
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1

    backend = dotenv_values(args.backend_env)
    ocr = dotenv_values(args.ocr_env)
    frontend = dotenv_values(args.frontend_env)

    if not args.allow_development and backend.get("APP_ENV") != "production":
        failures.append("backend APP_ENV must be production")
    if not configured(backend.get("APP_VERSION")) or backend.get("APP_VERSION") == "development":
        failures.append("backend APP_VERSION must identify the release")
    if args.expected_version and backend.get("APP_VERSION") != args.expected_version:
        failures.append("backend APP_VERSION does not match the selected release")
    required_backend = (
        "SUPABASE_URL",
        "SUPABASE_KEY",
        "OCR_SERVICE_TOKEN",
        "LIVENESS_SIGNING_KEY",
        "TEMP_ADMIN_PIN_PEPPER",
    )
    for name in required_backend:
        if not configured(backend.get(name)):
            failures.append(f"backend {name} is missing")
    supabase_url = urlparse(backend.get("SUPABASE_URL") or "")
    if supabase_url.scheme != "https" or not supabase_url.hostname or supabase_url.username:
        failures.append("backend SUPABASE_URL must be an HTTPS origin without credentials")
    for name in ("OCR_SERVICE_TOKEN", "LIVENESS_SIGNING_KEY", "TEMP_ADMIN_PIN_PEPPER"):
        if len(backend.get(name) or "") < 32:
            failures.append(f"backend {name} must contain at least 32 characters")
    secret_values = [backend.get(name) for name in ("OCR_SERVICE_TOKEN", "LIVENESS_SIGNING_KEY", "TEMP_ADMIN_PIN_PEPPER")]
    if len({value for value in secret_values if value}) != len([value for value in secret_values if value]):
        failures.append("backend internal secrets must be different values")

    cors_origins = [item.strip() for item in (backend.get("CORS_ORIGINS") or "").split(",") if item.strip()]
    parsed_origins = [parse_exact_https_origin(item) for item in cors_origins]
    if not cors_origins or any(parsed is None for parsed in parsed_origins):
        failures.append("CORS_ORIGINS must contain explicit HTTPS origins")
    trusted_hosts = [item.strip() for item in (backend.get("TRUSTED_HOSTS") or "").split(",") if item.strip()]
    if not trusted_hosts or any(
        host == "*" or not re.fullmatch(r"[A-Za-z0-9.-]+", host)
        for host in trusted_hosts
    ):
        failures.append("TRUSTED_HOSTS must contain explicit hostnames")

    ocr_url = urlparse(backend.get("OCR_SERVICE_URL") or "")
    if ocr_url.scheme != "http" or ocr_url.hostname not in {"127.0.0.1", "localhost", "::1"}:
        failures.append("backend OCR_SERVICE_URL must use loopback HTTP")

    if not args.allow_development and ocr.get("NODE_ENV") != "production":
        failures.append("OCR NODE_ENV must be production")
    if ocr.get("HOST", "127.0.0.1") not in {"127.0.0.1", "localhost", "::1"}:
        failures.append("OCR HOST must remain loopback-only")
    if ocr.get("OCR_INCLUDE_RAW_TEXT", "false").lower() != "false":
        failures.append("OCR_INCLUDE_RAW_TEXT must be false")
    if backend.get("OCR_SERVICE_TOKEN") != ocr.get("OCR_SERVICE_TOKEN"):
        failures.append("backend and OCR service tokens do not match")

    for name in ("VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"):
        if not configured(frontend.get(name)):
            failures.append(f"frontend {name} is missing")
    if configured(frontend.get("VITE_API_URL")):
        failures.append("frontend VITE_API_URL is obsolete; use VITE_API_ORIGIN")

    api_origin_value = frontend.get("VITE_API_ORIGIN") or ""
    if args.require_cross_origin_api and not configured(api_origin_value):
        failures.append("frontend VITE_API_ORIGIN is required for split deployment")
    if configured(api_origin_value):
        api_origin = parse_exact_https_origin(api_origin_value, allow_trailing_slash=True)
        if api_origin is None:
            failures.append("frontend VITE_API_ORIGIN must be an exact HTTPS origin")
        normalized_api_origin = (
            f"{api_origin.scheme}://{api_origin.netloc}" if api_origin is not None else ""
        )
        if args.expected_api_origin and normalized_api_origin != args.expected_api_origin.rstrip("/"):
            failures.append("frontend VITE_API_ORIGIN does not match the selected API origin")
        if api_origin is not None and api_origin.hostname.lower() not in trusted_hosts:
            failures.append("frontend VITE_API_ORIGIN hostname is missing from backend TRUSTED_HOSTS")

    if args.expected_frontend_origin:
        frontend_origin = parse_exact_https_origin(args.expected_frontend_origin)
        if frontend_origin is None:
            failures.append("expected frontend origin must be an exact HTTPS origin")
        elif args.expected_frontend_origin.rstrip("/") not in cors_origins:
            failures.append("expected frontend origin is missing from backend CORS_ORIGINS")
    forbidden_frontend_names = {
        "SUPABASE_KEY",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "VITE_SUPABASE_SERVICE_ROLE_KEY",
    }
    if forbidden_frontend_names.intersection(frontend):
        failures.append("frontend environment contains a forbidden server credential name")
    if frontend.get("VITE_SUPABASE_ANON_KEY") in {
        backend.get("SUPABASE_KEY"),
        backend.get("OCR_SERVICE_TOKEN"),
        backend.get("LIVENESS_SIGNING_KEY"),
        backend.get("TEMP_ADMIN_PIN_PEPPER"),
    }:
        failures.append("frontend public key must not equal a backend secret")

    if not args.allow_development:
        for path in (args.backend_env, args.ocr_env):
            if path.stat().st_mode & 0o007:
                failures.append(f"secret environment file is accessible by other users: {path}")

    model_root = (args.model_root or Path(backend.get("INSIGHTFACE_MODEL_ROOT") or "~/.insightface")).expanduser()
    model_dir = model_root / "models" / "buffalo_s"
    expected = {
        "1k3d68.onnx": "df5c06b8a0c12e422b2ed8947b8869faa4105387f199c477af038aa01f9a45cc",
        "det_500m.onnx": "5e4447f50245bbd7966bd6c0fa52938c61474a04ec7def48753668a9d8b4ea3a",
        "w600k_mbf.onnx": "9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f",
    }
    for filename, expected_digest in expected.items():
        path = model_dir / filename
        if not path.is_file():
            failures.append(f"missing pinned face model: {filename}")
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected_digest:
            failures.append(f"face model checksum mismatch: {filename}")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1
    print("Production preflight passed without exposing secret values.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
