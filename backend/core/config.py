import os
from pathlib import Path

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
OCR_TIMEOUT_SECONDS = float(os.getenv("OCR_TIMEOUT_SECONDS", "25"))
OCR_SERVICE_TOKEN = os.getenv("OCR_SERVICE_TOKEN", "")
TEMP_ADMIN_PIN_PEPPER = os.getenv("TEMP_ADMIN_PIN_PEPPER", "")
TEMP_ADMIN_GRANT_SECONDS = int(os.getenv("TEMP_ADMIN_GRANT_SECONDS", "600"))
TEMP_ADMIN_ENROLLMENT_SECONDS = int(os.getenv("TEMP_ADMIN_ENROLLMENT_SECONDS", "86400"))
TEMP_ADMIN_MAX_PIN_ATTEMPTS = int(os.getenv("TEMP_ADMIN_MAX_PIN_ATTEMPTS", "5"))
TEMP_ADMIN_LOCK_SECONDS = int(os.getenv("TEMP_ADMIN_LOCK_SECONDS", "900"))
APP_ENV = os.getenv("APP_ENV", "development").lower()
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
MAX_IMAGE_WIDTH = int(os.getenv("MAX_IMAGE_WIDTH", "4096"))
MAX_IMAGE_HEIGHT = int(os.getenv("MAX_IMAGE_HEIGHT", "4096"))
MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "16000000"))
QR_REFRESH_SECONDS = int(os.getenv("QR_REFRESH_SECONDS", "12"))
QR_CHALLENGE_SECONDS = int(os.getenv("QR_CHALLENGE_SECONDS", "120"))

if not 10 <= QR_REFRESH_SECONDS <= 15:
    raise RuntimeError("QR_REFRESH_SECONDS must be between 10 and 15")
if min(MAX_IMAGE_BYTES, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, MAX_IMAGE_PIXELS) <= 0:
    raise RuntimeError("Image upload limits must be positive integers")
if MAX_IMAGE_WIDTH > 4096 or MAX_IMAGE_HEIGHT > 4096 or MAX_IMAGE_PIXELS > 16_000_000:
    raise RuntimeError(
        "Image upload limits exceed the safe ceiling (4096x4096, 16,000,000 pixels)"
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
if APP_ENV == "production" and (
    not CORS_ORIGINS
    or "*" in CORS_ORIGINS
    or any(not origin.startswith("https://") for origin in CORS_ORIGINS)
):
    raise RuntimeError("Production CORS_ORIGINS must contain explicit HTTPS origins only")
