"""Server-bound active-liveness challenges and evidence validation."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import math
import secrets

from fastapi import HTTPException, status

from core.config import APP_ENV, LIVENESS_SIGNING_KEY, OCR_SERVICE_TOKEN


PROTOCOL_VERSION = 1
TURN_ACTIONS = {"turn_left", "turn_right"}
ALLOWED_ACTIONS = TURN_ACTIONS | {"blink"}
MAX_TOKEN_BYTES = 4096
MAX_EVIDENCE_BYTES = 8192


@dataclass(frozen=True)
class VerifiedLivenessEvidence:
    actions: tuple[str, str]
    turn_action: str
    total_duration_ms: int


def _signing_key() -> bytes:
    configured = LIVENESS_SIGNING_KEY or (OCR_SERVICE_TOKEN if APP_ENV != "production" else "")
    if len(configured) < 32:
        raise RuntimeError("LIVENESS_SIGNING_KEY must contain at least 32 characters")
    return configured.encode("utf-8")


def _encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode_base64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.b64decode(value + padding, altchars=b"-_", validate=True)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=403, detail="หลักฐาน liveness ไม่ถูกต้อง") from exc


def create_liveness_challenge(
    challenge_id: str,
    student_id: str,
    expires_at: datetime,
) -> tuple[str, list[str]]:
    """Create a random blink+turn sequence bound to one QR challenge and user."""

    turn_action = secrets.choice(sorted(TURN_ACTIONS))
    actions = ["blink", turn_action]
    if secrets.randbelow(2):
        actions.reverse()

    now = datetime.now(timezone.utc)
    payload = {
        "v": PROTOCOL_VERSION,
        "challenge_id": challenge_id,
        "student_id": student_id,
        "actions": actions,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "nonce": secrets.token_urlsafe(18),
    }
    encoded_payload = _encode_base64url(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signature = hmac.new(_signing_key(), encoded_payload.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded_payload}.{_encode_base64url(signature)}", actions


def _finite_number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HTTPException(status_code=422, detail=f"หลักฐาน liveness ขาดค่า {field}")
    number = float(value)
    if not math.isfinite(number):
        raise HTTPException(status_code=422, detail=f"หลักฐาน liveness มีค่า {field} ไม่ถูกต้อง")
    return number


def verify_liveness_submission(
    token: str,
    evidence_json: str,
    expected_challenge_id: str,
    expected_student_id: str,
    *,
    now: datetime | None = None,
) -> VerifiedLivenessEvidence:
    """Verify signature, ownership, expiry, sequence, timing and client measurements.

    Client measurements are only an early rejection layer. The backend must also
    validate the supplied turn-frame geometry before accepting attendance.
    """

    if not token or len(token.encode("utf-8")) > MAX_TOKEN_BYTES or token.count(".") != 1:
        raise HTTPException(status_code=403, detail="ไม่พบ challenge สำหรับ liveness")
    encoded_payload, encoded_signature = token.split(".", 1)
    supplied_signature = _decode_base64url(encoded_signature)
    expected_signature = hmac.new(
        _signing_key(), encoded_payload.encode("ascii"), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise HTTPException(status_code=403, detail="challenge สำหรับ liveness ไม่ถูกต้อง")

    try:
        payload = json.loads(_decode_base64url(encoded_payload))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=403, detail="challenge สำหรับ liveness เสียหาย") from exc
    if not isinstance(payload, dict) or payload.get("v") != PROTOCOL_VERSION:
        raise HTTPException(status_code=403, detail="เวอร์ชัน liveness ไม่รองรับ")
    if (
        payload.get("challenge_id") != expected_challenge_id
        or payload.get("student_id") != expected_student_id
    ):
        raise HTTPException(status_code=403, detail="challenge สำหรับ liveness ไม่ตรงกับผู้ใช้หรือ QR")

    current_time = now or datetime.now(timezone.utc)
    current_timestamp = int(current_time.timestamp())
    issued_at = payload.get("iat")
    expires_at = payload.get("exp")
    if not isinstance(issued_at, int) or not isinstance(expires_at, int):
        raise HTTPException(status_code=403, detail="challenge สำหรับ liveness ไม่มีเวลาใช้งาน")
    if issued_at > current_timestamp + 5 or expires_at <= current_timestamp:
        raise HTTPException(status_code=400, detail="challenge สำหรับ liveness หมดอายุ กรุณาสแกน QR ใหม่")

    actions = payload.get("actions")
    if (
        not isinstance(actions, list)
        or len(actions) != 2
        or set(actions) - ALLOWED_ACTIONS
        or actions.count("blink") != 1
        or sum(action in TURN_ACTIONS for action in actions) != 1
    ):
        raise HTTPException(status_code=403, detail="ลำดับ challenge สำหรับ liveness ไม่ถูกต้อง")

    if not evidence_json or len(evidence_json.encode("utf-8")) > MAX_EVIDENCE_BYTES:
        raise HTTPException(status_code=422, detail="หลักฐาน liveness มีขนาดไม่ถูกต้อง")
    try:
        evidence = json.loads(evidence_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="อ่านหลักฐาน liveness ไม่ได้") from exc
    if not isinstance(evidence, dict) or evidence.get("version") != PROTOCOL_VERSION:
        raise HTTPException(status_code=422, detail="เวอร์ชันหลักฐาน liveness ไม่ถูกต้อง")

    evidence_actions = evidence.get("actions")
    events = evidence.get("events")
    if evidence_actions != actions or not isinstance(events, list) or len(events) != 2:
        raise HTTPException(status_code=422, detail="ทำ liveness ไม่ครบตามลำดับที่กำหนด")

    started_ms = _finite_number(evidence.get("startedAtMs"), "startedAtMs")
    completed_ms = _finite_number(evidence.get("completedAtMs"), "completedAtMs")
    total_duration = int(completed_ms - started_ms)
    if total_duration < 500 or total_duration > 15_000:
        raise HTTPException(status_code=422, detail="ระยะเวลาทำ liveness ไม่เป็นธรรมชาติ กรุณาลองใหม่")

    for expected_action, event in zip(actions, events, strict=True):
        if not isinstance(event, dict) or event.get("action") != expected_action:
            raise HTTPException(status_code=422, detail="ลำดับการเคลื่อนไหว liveness ไม่ถูกต้อง")
        duration = _finite_number(event.get("durationMs"), "durationMs")
        yaw_delta = _finite_number(event.get("yawDelta"), "yawDelta")
        pitch_delta = abs(_finite_number(event.get("pitchDelta"), "pitchDelta"))
        if expected_action == "blink":
            eye_ratio = _finite_number(event.get("eyeRatio"), "eyeRatio")
            if not 60 <= duration <= 700 or eye_ratio > 0.72 or abs(yaw_delta) > 0.10 or pitch_delta > 0.09:
                raise HTTPException(status_code=422, detail="การกะพริบตาไม่ผ่าน กรุณามองตรงและอย่าผงกศีรษะ")
        else:
            direction = -1 if expected_action == "turn_left" else 1
            if not 180 <= duration <= 3_500 or direction * yaw_delta < 0.11 or pitch_delta > 0.11:
                raise HTTPException(status_code=422, detail="การหันหน้าไม่ผ่าน กรุณาหันตามลูกศรโดยไม่ก้มหรือเงย")

    turn_action = next(action for action in actions if action in TURN_ACTIONS)
    return VerifiedLivenessEvidence(tuple(actions), turn_action, total_duration)
