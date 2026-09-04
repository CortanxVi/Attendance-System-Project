from collections import defaultdict, deque
from datetime import datetime, timezone
import re
import secrets
from threading import Lock
from time import monotonic

from fastapi import HTTPException

from core.config import supabase_db as supabase


JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
JOIN_CODE_LENGTH = 8
JOIN_CODE_PATTERN = re.compile(r"^[A-HJ-NP-Z2-9]{8}$")


def normalize_join_code(value: str) -> str:
    """Normalize human-entered codes while keeping the accepted alphabet strict."""
    normalized = re.sub(r"[\s-]+", "", (value or "").upper())
    return normalized if JOIN_CODE_PATTERN.fullmatch(normalized) else ""


def format_join_code(value: str) -> str:
    normalized = normalize_join_code(value)
    return f"{normalized[:4]}-{normalized[4:]}" if normalized else ""


def generate_join_code() -> str:
    return "".join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(JOIN_CODE_LENGTH))


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def join_code_is_available(row: dict) -> bool:
    if not row.get("is_active"):
        return False
    expires_at = parse_utc(row.get("expires_at"))
    return expires_at is None or expires_at > datetime.now(timezone.utc)


def create_unique_join_code(course_id: str, actor_id: str, attempts: int = 8) -> dict:
    """Create one code for a course, retrying only random-code collisions."""
    for _ in range(attempts):
        try:
            response = supabase.table("course_join_codes").insert({
                "course_id": course_id,
                "join_code": generate_join_code(),
                "created_by": actor_id,
            }).execute()
            if response.data:
                return response.data[0]
        except Exception as exc:
            code = getattr(exc, "code", None)
            if code != "23505":
                raise

            existing = supabase.table("course_join_codes").select("*").eq(
                "course_id", course_id
            ).limit(1).execute()
            if existing.data:
                return existing.data[0]
    raise HTTPException(status_code=503, detail="ไม่สามารถสร้างรหัสเข้าร่วมรายวิชาได้")


def load_or_create_join_code(course_id: str, actor_id: str) -> dict:
    response = supabase.table("course_join_codes").select("*").eq(
        "course_id", course_id
    ).limit(1).execute()
    if response.data:
        return response.data[0]
    return create_unique_join_code(course_id, actor_id)


def rotate_join_code(course_id: str, actor_id: str, attempts: int = 8) -> dict:
    existing = load_or_create_join_code(course_id, actor_id)
    for _ in range(attempts):
        try:
            response = supabase.table("course_join_codes").update({
                "join_code": generate_join_code(),
                "is_active": True,
                "usage_count": 0,
                "rotated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", existing["id"]).execute()
            if response.data:
                return response.data[0]
        except Exception as exc:
            if getattr(exc, "code", None) != "23505":
                raise
    raise HTTPException(status_code=503, detail="ไม่สามารถสร้างรหัสใหม่ได้ กรุณาลองอีกครั้ง")


class SlidingWindowRateLimiter:
    """Small process-local limiter; keys combine verified user and remote address."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> None:
        now = monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= self.limit:
                retry_after = max(1, int(events[0] + self.window_seconds - now) + 1)
                raise HTTPException(
                    status_code=429,
                    detail="ลองรหัสหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
                    headers={"Retry-After": str(retry_after)},
                )
            events.append(now)


course_join_limiter = SlidingWindowRateLimiter(limit=5, window_seconds=60)
