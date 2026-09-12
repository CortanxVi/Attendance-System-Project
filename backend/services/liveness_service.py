"""Signed protocol-v3 passive liveness challenges and evidence validation."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import math
import secrets

from fastapi import HTTPException

from core.config import APP_ENV, LIVENESS_SIGNING_KEY, OCR_SERVICE_TOKEN


PROTOCOL_VERSION = 3
PROTOCOL_MODE = "passive"
PASSIVE_SAMPLE_COUNT = 3
MAX_TOKEN_BYTES = 4096
MAX_EVIDENCE_BYTES = 8192
MIN_EFFECTIVE_FPS = 8
MAX_EFFECTIVE_FPS = 35
MIN_ATTEMPT_DURATION_MS = 900
MAX_ATTEMPT_DURATION_MS = 20_000
MIN_SAMPLE_INTERVAL_MS = 250
MAX_SAMPLE_INTERVAL_MS = 2_000


@dataclass(frozen=True)
class LivenessChallenge:
    token: str
    mode: str
    sample_count: int


@dataclass(frozen=True)
class VerifiedLivenessEvidence:
    mode: str
    sample_count: int
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
        decoded = base64.b64decode(value + padding, altchars=b"-_", validate=True)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=403, detail="หลักฐานตรวจบุคคลจริงไม่ถูกต้อง") from exc
    if _encode_base64url(decoded) != value:
        raise HTTPException(status_code=403, detail="หลักฐานตรวจบุคคลจริงไม่ถูกต้อง")
    return decoded


def create_liveness_challenge(challenge_id: str, student_id: str, expires_at: datetime) -> LivenessChallenge:
    now = datetime.now(timezone.utc)
    payload = {
        "v": PROTOCOL_VERSION,
        "challenge_id": challenge_id,
        "student_id": student_id,
        "mode": PROTOCOL_MODE,
        "sample_count": PASSIVE_SAMPLE_COUNT,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "nonce": secrets.token_urlsafe(18),
    }
    encoded = _encode_base64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = hmac.new(_signing_key(), encoded.encode("ascii"), hashlib.sha256).digest()
    return LivenessChallenge(token=f"{encoded}.{_encode_base64url(signature)}", mode=PROTOCOL_MODE, sample_count=PASSIVE_SAMPLE_COUNT)


def _finite_number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise HTTPException(status_code=422, detail=f"หลักฐานตรวจบุคคลจริงขาดค่า {field}")
    return float(value)


def _decode_and_verify_token(token: str) -> dict:
    if not token or len(token.encode()) > MAX_TOKEN_BYTES or token.count(".") != 1:
        raise HTTPException(status_code=403, detail="ไม่พบสิทธิ์ตรวจบุคคลจริง")
    encoded, encoded_signature = token.split(".", 1)
    supplied = _decode_base64url(encoded_signature)
    expected = hmac.new(_signing_key(), encoded.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=403, detail="สิทธิ์ตรวจบุคคลจริงไม่ถูกต้อง")
    try:
        payload = json.loads(_decode_base64url(encoded))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=403, detail="สิทธิ์ตรวจบุคคลจริงเสียหาย") from exc
    if not isinstance(payload, dict) or payload.get("v") != PROTOCOL_VERSION:
        raise HTTPException(status_code=403, detail="เวอร์ชันตรวจบุคคลจริงไม่รองรับ")
    return payload


def verify_liveness_submission(token: str, evidence_json: str, expected_challenge_id: str, expected_student_id: str, *, now: datetime | None = None) -> VerifiedLivenessEvidence:
    payload = _decode_and_verify_token(token)
    if payload.get("challenge_id") != expected_challenge_id or payload.get("student_id") != expected_student_id:
        raise HTTPException(status_code=403, detail="สิทธิ์ตรวจบุคคลจริงไม่ตรงกับผู้ใช้หรือ QR")
    current_timestamp = int((now or datetime.now(timezone.utc)).timestamp())
    issued_at, expires_at = payload.get("iat"), payload.get("exp")
    if not isinstance(issued_at, int) or not isinstance(expires_at, int) or issued_at > current_timestamp + 5 or expires_at <= current_timestamp:
        raise HTTPException(status_code=400, detail="สิทธิ์ตรวจบุคคลจริงหมดอายุ กรุณาเริ่มใหม่")
    if payload.get("mode") != PROTOCOL_MODE or payload.get("sample_count") != PASSIVE_SAMPLE_COUNT:
        raise HTTPException(status_code=403, detail="นโยบายตรวจบุคคลจริงไม่ถูกต้อง")
    if not evidence_json or len(evidence_json.encode()) > MAX_EVIDENCE_BYTES:
        raise HTTPException(status_code=422, detail="หลักฐานตรวจบุคคลจริงมีขนาดไม่ถูกต้อง")
    try:
        evidence = json.loads(evidence_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="อ่านหลักฐานตรวจบุคคลจริงไม่ได้") from exc
    if not isinstance(evidence, dict) or evidence.get("version") != PROTOCOL_VERSION or evidence.get("mode") != PROTOCOL_MODE or evidence.get("sampleCount") != PASSIVE_SAMPLE_COUNT:
        raise HTTPException(status_code=422, detail="รูปแบบหลักฐานตรวจบุคคลจริงไม่ถูกต้อง")
    started = _finite_number(evidence.get("startedAtMs"), "startedAtMs")
    completed = _finite_number(evidence.get("completedAtMs"), "completedAtMs")
    fps = _finite_number(evidence.get("effectiveFps"), "effectiveFps")
    duration = int(completed - started)
    if not MIN_ATTEMPT_DURATION_MS <= duration <= MAX_ATTEMPT_DURATION_MS:
        raise HTTPException(status_code=422, detail="ระยะเวลาสแกนใบหน้าไม่เป็นธรรมชาติ กรุณาลองใหม่")
    if not MIN_EFFECTIVE_FPS <= fps <= MAX_EFFECTIVE_FPS:
        raise HTTPException(status_code=422, detail="อัตราภาพจากกล้องไม่เพียงพอสำหรับตรวจบุคคลจริง")
    frames = evidence.get("frames")
    if not isinstance(frames, list) or len(frames) != PASSIVE_SAMPLE_COUNT:
        raise HTTPException(status_code=422, detail="หลักฐานภาพต่อเนื่องไม่ครบ")
    timestamps = []
    for index, frame in enumerate(frames, start=1):
        if not isinstance(frame, dict) or frame.get("kind") != "passive_sample" or frame.get("sampleIndex") != index:
            raise HTTPException(status_code=422, detail="ลำดับหลักฐานภาพต่อเนื่องไม่ถูกต้อง")
        timestamps.append(_finite_number(frame.get("timestampMs"), "frames.timestampMs"))
    if timestamps[0] < started or timestamps[-1] > completed:
        raise HTTPException(status_code=422, detail="เวลาหลักฐานภาพไม่ต่อเนื่อง")
    intervals = [current - previous for previous, current in zip(timestamps, timestamps[1:])]
    if any(not MIN_SAMPLE_INTERVAL_MS <= interval <= MAX_SAMPLE_INTERVAL_MS for interval in intervals):
        raise HTTPException(status_code=422, detail="ช่วงเวลาหลักฐานภาพไม่เป็นธรรมชาติ")
    return VerifiedLivenessEvidence(mode=PROTOCOL_MODE, sample_count=PASSIVE_SAMPLE_COUNT, total_duration_ms=duration)
