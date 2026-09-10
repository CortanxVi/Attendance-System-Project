import base64
from datetime import datetime, timezone
import hashlib
import json
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from core.config import TEMP_ADMIN_PIN_PEPPER, supabase_db


_PIN_HASHER = PasswordHasher(
    time_cost=2,
    memory_cost=19_456,
    parallelism=1,
    hash_len=32,
    salt_len=16,
)
_DISALLOWED_PINS = {
    "000000", "111111", "222222", "333333", "444444",
    "555555", "666666", "777777", "888888", "999999",
    "012345", "123456", "234567", "345678", "456789",
    "987654", "876543", "765432", "654321", "543210",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def validate_pin(pin: str) -> str:
    if not re.fullmatch(r"[0-9]{6}", pin):
        raise ValueError("PIN ต้องเป็นตัวเลข 6 หลัก")
    if pin in _DISALLOWED_PINS or len(set(pin)) <= 2:
        raise ValueError("PIN เดาง่ายเกินไป กรุณาเลือกตัวเลขที่ไม่ซ้ำหรือเรียงกัน")
    return pin


def hash_pin(teacher_id: str, pin: str) -> str:
    validate_pin(pin)
    return _PIN_HASHER.hash(f"{teacher_id}:{pin}:{TEMP_ADMIN_PIN_PEPPER}")


def verify_pin(pin_hash: str, teacher_id: str, pin: str) -> bool:
    try:
        return _PIN_HASHER.verify(
            pin_hash,
            f"{teacher_id}:{pin}:{TEMP_ADMIN_PIN_PEPPER}",
        )
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_grant_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)


def extract_verified_session_id(access_token: str) -> str:
    """Read session_id only after Supabase has verified this access token."""

    try:
        payload_segment = access_token.split(".")[1]
        payload_segment += "=" * (-len(payload_segment) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_segment).decode("utf-8"))
        session_id = payload.get("session_id")
        if session_id:
            return str(session_id)
    except (IndexError, ValueError, TypeError, json.JSONDecodeError):
        pass
    # Legacy tokens may omit session_id. Bind the grant to this exact verified JWT.
    return f"token:{hashlib.sha256(access_token.encode('utf-8')).hexdigest()}"


def load_valid_grant(
    teacher_id: str,
    auth_session_id: str,
    raw_grant_token: str | None,
) -> dict | None:
    if not raw_grant_token or len(raw_grant_token) > 256:
        return None
    response = (
        supabase_db.table("temporary_admin_grants")
        .select("id, teacher_id, auth_session_id, expires_at, revoked_at")
        .eq("teacher_id", teacher_id)
        .eq("token_hash", token_hash(raw_grant_token))
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    grant = response.data[0]
    if grant.get("revoked_at") or grant.get("auth_session_id") != auth_session_id:
        return None
    expires_at = parse_utc(grant.get("expires_at"))
    if expires_at is None or expires_at <= utc_now():
        return None
    return grant


def log_security_event(
    actor_id: str,
    action: str,
    target_id: str,
    details: dict | None = None,
) -> None:
    supabase_db.table("audit_logs").insert({
        "admin_id": actor_id,
        "action": action,
        "target_type": "TEMPORARY_ADMIN",
        "target_id": target_id,
        "details": details or {},
    }).execute()
