"""Signed passive enrollment and hybrid attendance liveness protocols."""

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
ATTENDANCE_PROTOCOL_VERSION = 4
ATTENDANCE_PROTOCOL_MODE = "hybrid"
ATTENDANCE_ACTIONS = ("blink", "move_closer")
MIN_PROMPT_DELAY_MS = 500
MAX_PROMPT_DELAY_MS = 1_400
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
    protocol_version: int = PROTOCOL_VERSION
    action: str | None = None
    prompt_delay_ms: int | None = None


@dataclass(frozen=True)
class VerifiedLivenessEvidence:
    mode: str
    sample_count: int
    total_duration_ms: int
    action: str | None = None


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


def create_attendance_liveness_challenge(
    challenge_id: str,
    student_id: str,
    session_id: str,
    expires_at: datetime,
) -> LivenessChallenge:
    """Issue a signed, account/session-bound random action for attendance.

    The action is intentionally limited to one blink or one short move closer.
    This adds temporal replay resistance without making the ordinary flow a
    multi-step gesture exercise. Browser observations remain untrusted; the
    backend later recomputes the action from the submitted images.
    """

    now = datetime.now(timezone.utc)
    action = secrets.choice(ATTENDANCE_ACTIONS)
    prompt_delay_ms = MIN_PROMPT_DELAY_MS + secrets.randbelow(
        MAX_PROMPT_DELAY_MS - MIN_PROMPT_DELAY_MS + 1
    )
    payload = {
        "v": ATTENDANCE_PROTOCOL_VERSION,
        "challenge_id": challenge_id,
        "student_id": student_id,
        "session_id": session_id,
        "mode": ATTENDANCE_PROTOCOL_MODE,
        "sample_count": PASSIVE_SAMPLE_COUNT,
        "action": action,
        "prompt_delay_ms": prompt_delay_ms,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "nonce": secrets.token_urlsafe(18),
    }
    encoded = _encode_base64url(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    )
    signature = hmac.new(
        _signing_key(), encoded.encode("ascii"), hashlib.sha256
    ).digest()
    return LivenessChallenge(
        token=f"{encoded}.{_encode_base64url(signature)}",
        mode=ATTENDANCE_PROTOCOL_MODE,
        sample_count=PASSIVE_SAMPLE_COUNT,
        protocol_version=ATTENDANCE_PROTOCOL_VERSION,
        action=action,
        prompt_delay_ms=prompt_delay_ms,
    )


def _finite_number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise HTTPException(status_code=422, detail=f"หลักฐานตรวจบุคคลจริงขาดค่า {field}")
    return float(value)


def _decode_and_verify_token(token: str, expected_version: int = PROTOCOL_VERSION) -> dict:
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
    if not isinstance(payload, dict) or payload.get("v") != expected_version:
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


def verify_attendance_liveness_submission(
    token: str,
    evidence_json: str,
    expected_challenge_id: str,
    expected_student_id: str,
    expected_session_id: str,
    *,
    now: datetime | None = None,
) -> VerifiedLivenessEvidence:
    """Validate protocol-v4 metadata before expensive image processing."""

    payload = _decode_and_verify_token(token, ATTENDANCE_PROTOCOL_VERSION)
    if (
        payload.get("challenge_id") != expected_challenge_id
        or payload.get("student_id") != expected_student_id
        or payload.get("session_id") != expected_session_id
    ):
        raise HTTPException(
            status_code=403,
            detail="สิทธิ์ตรวจบุคคลจริงไม่ตรงกับผู้ใช้ ห้องเรียน หรือ QR",
        )

    current_timestamp = int((now or datetime.now(timezone.utc)).timestamp())
    issued_at, expires_at = payload.get("iat"), payload.get("exp")
    if (
        not isinstance(issued_at, int)
        or not isinstance(expires_at, int)
        or issued_at > current_timestamp + 5
        or expires_at <= current_timestamp
    ):
        raise HTTPException(
            status_code=400,
            detail="สิทธิ์ตรวจบุคคลจริงหมดอายุ กรุณาเริ่มใหม่",
        )

    action = payload.get("action")
    prompt_delay_ms = payload.get("prompt_delay_ms")
    if (
        payload.get("mode") != ATTENDANCE_PROTOCOL_MODE
        or payload.get("sample_count") != PASSIVE_SAMPLE_COUNT
        or action not in ATTENDANCE_ACTIONS
        or not isinstance(prompt_delay_ms, int)
        or not MIN_PROMPT_DELAY_MS <= prompt_delay_ms <= MAX_PROMPT_DELAY_MS
    ):
        raise HTTPException(status_code=403, detail="นโยบายตรวจบุคคลจริงไม่ถูกต้อง")

    if not evidence_json or len(evidence_json.encode()) > MAX_EVIDENCE_BYTES:
        raise HTTPException(status_code=422, detail="หลักฐานตรวจบุคคลจริงมีขนาดไม่ถูกต้อง")
    try:
        evidence = json.loads(evidence_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=422, detail="อ่านหลักฐานตรวจบุคคลจริงไม่ได้"
        ) from exc

    frames = evidence.get("frames") if isinstance(evidence, dict) else None
    if (
        not isinstance(evidence, dict)
        or evidence.get("version") != ATTENDANCE_PROTOCOL_VERSION
        or evidence.get("mode") != ATTENDANCE_PROTOCOL_MODE
        or evidence.get("sampleCount") != PASSIVE_SAMPLE_COUNT
        or evidence.get("action") != action
        or evidence.get("promptDelayMs") != prompt_delay_ms
        or not isinstance(frames, list)
        or len(frames) != PASSIVE_SAMPLE_COUNT + 2
    ):
        raise HTTPException(status_code=422, detail="รูปแบบหลักฐานตรวจบุคคลจริงไม่ถูกต้อง")

    started = _finite_number(evidence.get("startedAtMs"), "startedAtMs")
    prompt_at = _finite_number(evidence.get("promptAtMs"), "promptAtMs")
    completed = _finite_number(evidence.get("completedAtMs"), "completedAtMs")
    fps = _finite_number(evidence.get("effectiveFps"), "effectiveFps")
    duration = int(completed - started)
    if not MIN_ATTEMPT_DURATION_MS <= duration <= MAX_ATTEMPT_DURATION_MS:
        raise HTTPException(
            status_code=422,
            detail="ระยะเวลาสแกนใบหน้าไม่เป็นธรรมชาติ กรุณาลองใหม่",
        )
    if not MIN_EFFECTIVE_FPS <= fps <= MAX_EFFECTIVE_FPS:
        raise HTTPException(
            status_code=422,
            detail="อัตราภาพจากกล้องไม่เพียงพอสำหรับตรวจบุคคลจริง",
        )

    timestamps: list[float] = []
    for index, frame in enumerate(frames[:PASSIVE_SAMPLE_COUNT], start=1):
        if (
            not isinstance(frame, dict)
            or frame.get("kind") != "passive_sample"
            or frame.get("sampleIndex") != index
        ):
            raise HTTPException(status_code=422, detail="ลำดับหลักฐานภาพต่อเนื่องไม่ถูกต้อง")
        timestamps.append(_finite_number(frame.get("timestampMs"), "frames.timestampMs"))

    action_frame, recovery_frame = frames[-2:]
    if (
        not isinstance(action_frame, dict)
        or action_frame.get("kind") != "challenge_action"
        or action_frame.get("action") != action
        or not isinstance(recovery_frame, dict)
        or recovery_frame.get("kind") != "challenge_recovery"
        or recovery_frame.get("action") != action
    ):
        raise HTTPException(status_code=422, detail="ลำดับคำสั่งสุ่มไม่ถูกต้อง")
    action_at = _finite_number(action_frame.get("timestampMs"), "frames.action.timestampMs")
    recovery_at = _finite_number(
        recovery_frame.get("timestampMs"), "frames.recovery.timestampMs"
    )
    intervals = [current - previous for previous, current in zip(timestamps, timestamps[1:])]
    if any(
        not MIN_SAMPLE_INTERVAL_MS <= interval <= MAX_SAMPLE_INTERVAL_MS
        for interval in intervals
    ):
        raise HTTPException(status_code=422, detail="ช่วงเวลาหลักฐานภาพไม่เป็นธรรมชาติ")
    if (
        timestamps[0] < started
        or prompt_at < timestamps[-1] + prompt_delay_ms
        or action_at < prompt_at
        or recovery_at <= action_at
        or recovery_at > completed
        or recovery_at - action_at > 3_000
    ):
        raise HTTPException(status_code=422, detail="เวลาคำสั่งสุ่มไม่ต่อเนื่อง")

    return VerifiedLivenessEvidence(
        mode=ATTENDANCE_PROTOCOL_MODE,
        sample_count=PASSIVE_SAMPLE_COUNT,
        total_duration_ms=duration,
        action=action,
    )
