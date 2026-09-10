import os
from pathlib import Path
import re
from urllib.parse import urlparse

from dotenv import load_dotenv
from supabase import create_client, Client

# Resolve the environment file from this module so startup works from the
# repository root and from the backend directory on every supported Linux OS.
BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

supabase_url = os.getenv("SUPABASE_URL")
supabase_rkey = os.getenv("SUPABASE_KEY")

if not supabase_url or not supabase_rkey:
    raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be configured in backend/.env")

# This client is server-only. Never expose SUPABASE_KEY to the frontend.
supabase_db: Client = create_client(supabase_url, supabase_rkey)

OCR_SERVICE_URL = os.getenv("OCR_SERVICE_URL", "http://127.0.0.1:3001").rstrip("/")
OCR_TIMEOUT_SECONDS = float(os.getenv("OCR_TIMEOUT_SECONDS", "42"))
OCR_SERVICE_TOKEN = os.getenv("OCR_SERVICE_TOKEN", "")
LIVENESS_SIGNING_KEY = os.getenv("LIVENESS_SIGNING_KEY", "")
LIVENESS_PAD_THRESHOLD = float(os.getenv("LIVENESS_PAD_THRESHOLD", "0.65"))
LIVENESS_PAD_CONCURRENCY = int(os.getenv("LIVENESS_PAD_CONCURRENCY", "2"))
FACE_ENROLLMENT_CHALLENGE_SECONDS = int(
    os.getenv("FACE_ENROLLMENT_CHALLENGE_SECONDS", "180")
)
TEMP_ADMIN_PIN_PEPPER = os.getenv("TEMP_ADMIN_PIN_PEPPER", "")
TEMP_ADMIN_GRANT_SECONDS = int(os.getenv("TEMP_ADMIN_GRANT_SECONDS", "600"))
TEMP_ADMIN_ENROLLMENT_SECONDS = int(os.getenv("TEMP_ADMIN_ENROLLMENT_SECONDS", "86400"))
TEMP_ADMIN_MAX_PIN_ATTEMPTS = int(os.getenv("TEMP_ADMIN_MAX_PIN_ATTEMPTS", "5"))
TEMP_ADMIN_LOCK_SECONDS = int(os.getenv("TEMP_ADMIN_LOCK_SECONDS", "900"))
APP_ENV = os.getenv("APP_ENV", "development").lower()
APP_VERSION = os.getenv("APP_VERSION", "development")
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
MAX_IMAGE_WIDTH = int(os.getenv("MAX_IMAGE_WIDTH", "4096"))
MAX_IMAGE_HEIGHT = int(os.getenv("MAX_IMAGE_HEIGHT", "4096"))
MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "16000000"))
OCR_UPLOAD_REQUEST_MAX_BYTES = int(
    os.getenv("OCR_UPLOAD_REQUEST_MAX_BYTES", str(MAX_IMAGE_BYTES + 1024 * 1024))
)
ATTENDANCE_VERIFY_REQUEST_MAX_BYTES = int(
    os.getenv("ATTENDANCE_VERIFY_REQUEST_MAX_BYTES", str(16 * 1024 * 1024))
)
QR_REFRESH_SECONDS = int(os.getenv("QR_REFRESH_SECONDS", "12"))
QR_CHALLENGE_SECONDS = int(os.getenv("QR_CHALLENGE_SECONDS", "420"))
SUPPORT_ATTACHMENT_MAX_BYTES = int(
    os.getenv("SUPPORT_ATTACHMENT_MAX_BYTES", str(10 * 1024 * 1024))
)
SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE = int(
    os.getenv("SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE", "3")
)
SUPPORT_UPLOAD_REQUEST_MAX_BYTES = int(
    os.getenv(
        "SUPPORT_UPLOAD_REQUEST_MAX_BYTES",
        str(
            SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE * SUPPORT_ATTACHMENT_MAX_BYTES
            + 1024 * 1024
        ),
    )
)
ROSTER_IMPORT_REQUEST_MAX_BYTES = int(
    os.getenv("ROSTER_IMPORT_REQUEST_MAX_BYTES", str(6 * 1024 * 1024))
)

if not 10 <= QR_REFRESH_SECONDS <= 15:
    raise RuntimeError("QR_REFRESH_SECONDS must be between 10 and 15")
if not 60 <= QR_CHALLENGE_SECONDS <= 600:
    raise RuntimeError("QR_CHALLENGE_SECONDS must be between 60 and 600")
if min(MAX_IMAGE_BYTES, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, MAX_IMAGE_PIXELS) <= 0:
    raise RuntimeError("Image upload limits must be positive integers")
if not 30 <= OCR_TIMEOUT_SECONDS <= 42:
    raise RuntimeError("OCR_TIMEOUT_SECONDS must be between 30 and 42 seconds")
if MAX_IMAGE_WIDTH > 4096 or MAX_IMAGE_HEIGHT > 4096 or MAX_IMAGE_PIXELS > 16_000_000:
    raise RuntimeError(
        "Image upload limits exceed the safe ceiling (4096x4096, 16,000,000 pixels)"
    )
if not MAX_IMAGE_BYTES + 1024 * 1024 <= ATTENDANCE_VERIFY_REQUEST_MAX_BYTES <= 20 * 1024 * 1024:
    raise RuntimeError(
        "ATTENDANCE_VERIFY_REQUEST_MAX_BYTES must be large enough for one card and at most 20 MiB"
    )
if not 1 <= SUPPORT_ATTACHMENT_MAX_BYTES <= 10 * 1024 * 1024:
    raise RuntimeError("SUPPORT_ATTACHMENT_MAX_BYTES must be between 1 byte and 10 MiB")
if not 1 <= SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE <= 3:
    raise RuntimeError("SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE must be between 1 and 3")
if not SUPPORT_ATTACHMENT_MAX_BYTES <= SUPPORT_UPLOAD_REQUEST_MAX_BYTES <= 32 * 1024 * 1024:
    raise RuntimeError(
        "SUPPORT_UPLOAD_REQUEST_MAX_BYTES must be at least one attachment and at most 32 MiB"
    )
if not 5 * 1024 * 1024 <= ROSTER_IMPORT_REQUEST_MAX_BYTES <= 8 * 1024 * 1024:
    raise RuntimeError(
        "ROSTER_IMPORT_REQUEST_MAX_BYTES must be between 5 MiB and 8 MiB"
    )
if not 300 <= TEMP_ADMIN_GRANT_SECONDS <= 900:
    raise RuntimeError("TEMP_ADMIN_GRANT_SECONDS must be between 300 and 900")
if not 3600 <= TEMP_ADMIN_ENROLLMENT_SECONDS <= 172800:
    raise RuntimeError("TEMP_ADMIN_ENROLLMENT_SECONDS must be between 3600 and 172800")
if not 3 <= TEMP_ADMIN_MAX_PIN_ATTEMPTS <= 10:
    raise RuntimeError("TEMP_ADMIN_MAX_PIN_ATTEMPTS must be between 3 and 10")
if not 300 <= TEMP_ADMIN_LOCK_SECONDS <= 3600:
    raise RuntimeError("TEMP_ADMIN_LOCK_SECONDS must be between 300 and 3600")
if (
    APP_ENV == "production"
    and len(OCR_SERVICE_TOKEN) < 32
):
    raise RuntimeError("OCR_SERVICE_TOKEN must contain at least 32 characters in production")
if APP_ENV == "production" and len(LIVENESS_SIGNING_KEY) < 32:
    raise RuntimeError("LIVENESS_SIGNING_KEY must contain at least 32 characters in production")
if not 0.50 <= LIVENESS_PAD_THRESHOLD <= 0.95:
    raise RuntimeError("LIVENESS_PAD_THRESHOLD must be between 0.50 and 0.95")
if not 1 <= LIVENESS_PAD_CONCURRENCY <= 4:
    raise RuntimeError("LIVENESS_PAD_CONCURRENCY must be between 1 and 4")
if not 90 <= FACE_ENROLLMENT_CHALLENGE_SECONDS <= 300:
    raise RuntimeError("FACE_ENROLLMENT_CHALLENGE_SECONDS must be between 90 and 300")
if (
    APP_ENV == "production"
    and len(TEMP_ADMIN_PIN_PEPPER) < 32
):
    raise RuntimeError("TEMP_ADMIN_PIN_PEPPER must contain at least 32 characters in production")

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
TRUSTED_HOSTS = [
    host.strip().lower()
    for host in os.getenv("TRUSTED_HOSTS", "127.0.0.1,localhost").split(",")
    if host.strip()
]


def _is_exact_https_origin(value: str) -> bool:
    parsed = urlparse(value)
    try:
        _ = parsed.port
    except ValueError:
        return False
    return bool(
        parsed.scheme == "https"
        and parsed.hostname
        and not parsed.username
        and not parsed.password
        and parsed.path == ""
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
    )


if APP_ENV == "production" and (
    not CORS_ORIGINS
    or "*" in CORS_ORIGINS
    or any(not _is_exact_https_origin(origin) for origin in CORS_ORIGINS)
):
    raise RuntimeError("Production CORS_ORIGINS must contain explicit HTTPS origins only")
if APP_ENV == "production" and (
    not TRUSTED_HOSTS
    or "*" in TRUSTED_HOSTS
    or any(not re.fullmatch(r"[A-Za-z0-9.-]+", host) for host in TRUSTED_HOSTS)
):
    raise RuntimeError("Production TRUSTED_HOSTS must contain explicit hostnames only")
