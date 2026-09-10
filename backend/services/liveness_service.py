"""Signed protocol-v2 liveness challenges and untrusted evidence validation."""

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


PROTOCOL_VERSION = 2
PROTOCOL_ACTIONS = ("move_closer", "blink")
MAX_TOKEN_BYTES = 4096
MAX_EVIDENCE_BYTES = 16_384
MIN_PROMPT_DELAY_MS = 400
MAX_PROMPT_DELAY_MS = 1_000
MIN_EFFECTIVE_FPS = 8
MAX_ATTEMPT_DURATION_MS = 45_000
MAX_MOVEMENT_DURATION_MS = 15_000
MAX_BLINK_RESPONSE_MS = 8_000


@dataclass(frozen=True)
class LivenessChallenge:
    token: str
    actions: tuple[str, str]
    required_blinks: int
    prompt_delay_ms: int


@dataclass(frozen=True)
class VerifiedLivenessEvidence:
    actions: tuple[str, str]
    required_blinks: int
    prompt_delay_ms: int
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
        raise HTTPException(status_code=403, detail="หลักฐาน liveness ไม่ถูกต้อง") from exc
    # Reject alternative encodings whose unused trailing bits decode to the
    # same bytes. Tokens have exactly one canonical, unpadded representation,
    # so changing any visible character is always detected as tampering.
    if _encode_base64url(decoded) != value:
        raise HTTPException(status_code=403, detail="หลักฐาน liveness ไม่ถูกต้อง")
    return decoded


def create_liveness_challenge(
    challenge_id: str,
    student_id: str,
    expires_at: datetime,
) -> LivenessChallenge:
    """Create a one-use, user-bound move-near/return then blink challenge.

    Most challenges require one blink. A server-selected 20% step-up requires
    two blinks, making the requested temporal response less predictable without
    increasing the normal path for every student.
    """

    required_blinks = 2 if secrets.randbelow(5) == 0 else 1
    prompt_delay_ms = MIN_PROMPT_DELAY_MS + secrets.randbelow(
        MAX_PROMPT_DELAY_MS - MIN_PROMPT_DELAY_MS + 1
    )
    now = datetime.now(timezone.utc)
    payload = {
        "v": PROTOCOL_VERSION,
        "challenge_id": challenge_id,
        "student_id": student_id,
        "actions": list(PROTOCOL_ACTIONS),
        "required_blinks": required_blinks,
        "prompt_delay_ms": prompt_delay_ms,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "nonce": secrets.token_urlsafe(18),
    }
    encoded_payload = _encode_base64url(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signature = hmac.new(_signing_key(), encoded_payload.encode("ascii"), hashlib.sha256).digest()
    return LivenessChallenge(
        token=f"{encoded_payload}.{_encode_base64url(signature)}",
        actions=PROTOCOL_ACTIONS,
        required_blinks=required_blinks,
        prompt_delay_ms=prompt_delay_ms,
    )


def _finite_number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HTTPException(status_code=422, detail=f"หลักฐาน liveness ขาดค่า {field}")
    number = float(value)
    if not math.isfinite(number):
        raise HTTPException(status_code=422, detail=f"หลักฐาน liveness มีค่า {field} ไม่ถูกต้อง")
    return number


def _decode_and_verify_token(token: str) -> dict:
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
    return payload


def _validate_frame_markers(evidence: dict, required_blinks: int) -> None:
    frames = evidence.get("frames")
    if not isinstance(frames, list):
        raise HTTPException(status_code=422, detail="หลักฐานเฟรม liveness ไม่ครบ")
    expected_kinds = ["baseline_open", "near", "returned"]
    for _index in range(required_blinks):
        expected_kinds.extend(("blink_closed", "blink_open"))
    expected_kinds.append("final_open")
    if [frame.get("kind") if isinstance(frame, dict) else None for frame in frames] != expected_kinds:
        raise HTTPException(status_code=422, detail="ลำดับเฟรม liveness ไม่ถูกต้อง")

    timestamps: list[float] = []
    for frame in frames:
        timestamps.append(_finite_number(frame.get("timestampMs"), "frames.timestampMs"))
    if any(current <= previous for previous, current in zip(timestamps, timestamps[1:])):
        raise HTTPException(status_code=422, detail="เวลาเฟรม liveness ไม่ต่อเนื่อง")
    blink_markers = [frame for frame in frames if frame.get("kind", "").startswith("blink_")]
    expected_indexes = [index for index in range(1, required_blinks + 1) for _ in range(2)]
    if [frame.get("blinkIndex") for frame in blink_markers] != expected_indexes:
        raise HTTPException(status_code=422, detail="หมายเลขเฟรมกระพริบตาไม่ถูกต้อง")


def verify_liveness_submission(
    token: str,
    evidence_json: str,
    expected_challenge_id: str,
    expected_student_id: str,
    *,
    now: datetime | None = None,
) -> VerifiedLivenessEvidence:
    """Verify signed policy, ownership, expiry, timing, and evidence structure.

    All measurements in ``evidence_json`` are untrusted. The caller must also
    recompute face scale, bilateral eye closure, identity continuity, and image
    continuity from the uploaded evidence frames.
    """

    payload = _decode_and_verify_token(token)
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
    required_blinks = payload.get("required_blinks")
    prompt_delay_ms = payload.get("prompt_delay_ms")
    if actions != list(PROTOCOL_ACTIONS):
        raise HTTPException(status_code=403, detail="ลำดับ challenge สำหรับ liveness ไม่ถูกต้อง")
    if required_blinks not in (1, 2):
        raise HTTPException(status_code=403, detail="จำนวนครั้งกระพริบตาใน challenge ไม่ถูกต้อง")
    if (
        not isinstance(prompt_delay_ms, int)
        or not MIN_PROMPT_DELAY_MS <= prompt_delay_ms <= MAX_PROMPT_DELAY_MS
    ):
        raise HTTPException(status_code=403, detail="เวลาสุ่มของ challenge ไม่ถูกต้อง")

    if not evidence_json or len(evidence_json.encode("utf-8")) > MAX_EVIDENCE_BYTES:
        raise HTTPException(status_code=422, detail="หลักฐาน liveness มีขนาดไม่ถูกต้อง")
    try:
        evidence = json.loads(evidence_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="อ่านหลักฐาน liveness ไม่ได้") from exc
    if not isinstance(evidence, dict) or evidence.get("version") != PROTOCOL_VERSION:
        raise HTTPException(status_code=422, detail="เวอร์ชันหลักฐาน liveness ไม่ถูกต้อง")
    if (
        evidence.get("actions") != actions
        or evidence.get("requiredBlinks") != required_blinks
        or evidence.get("promptDelayMs") != prompt_delay_ms
    ):
        raise HTTPException(status_code=422, detail="หลักฐาน liveness ไม่ตรงกับ challenge ที่ลงนามไว้")

    started_ms = _finite_number(evidence.get("startedAtMs"), "startedAtMs")
    prompt_at_ms = _finite_number(evidence.get("promptAtMs"), "promptAtMs")
    completed_ms = _finite_number(evidence.get("completedAtMs"), "completedAtMs")
    effective_fps = _finite_number(evidence.get("effectiveFps"), "effectiveFps")
    total_duration = int(completed_ms - started_ms)
    if total_duration < 900 or total_duration > MAX_ATTEMPT_DURATION_MS:
        raise HTTPException(status_code=422, detail="ระยะเวลาทำ liveness ไม่เป็นธรรมชาติ กรุณาลองใหม่")
    if not MIN_EFFECTIVE_FPS <= effective_fps <= 35:
        raise HTTPException(status_code=422, detail="อัตราภาพจากกล้องไม่เพียงพอสำหรับตรวจการกระพริบตา")

    movement = evidence.get("movement")
    if not isinstance(movement, dict) or movement.get("action") != "move_closer":
        raise HTTPException(status_code=422, detail="หลักฐานการขยับเข้าใกล้กล้องไม่ครบ")
    movement_started = _finite_number(movement.get("startedAtMs"), "movement.startedAtMs")
    peak_at = _finite_number(movement.get("peakAtMs"), "movement.peakAtMs")
    returned_at = _finite_number(movement.get("completedAtMs"), "movement.completedAtMs")
    baseline_scale = _finite_number(movement.get("baselineScale"), "movement.baselineScale")
    peak_scale = _finite_number(movement.get("peakScale"), "movement.peakScale")
    returned_scale = _finite_number(movement.get("returnedScale"), "movement.returnedScale")
    if not started_ms <= movement_started <= peak_at < returned_at <= prompt_at_ms <= completed_ms:
        raise HTTPException(status_code=422, detail="เวลาเคลื่อนไหว liveness ไม่ต่อเนื่อง")
    if not 250 <= returned_at - movement_started <= MAX_MOVEMENT_DURATION_MS:
        raise HTTPException(status_code=422, detail="การขยับเข้าและออกเร็วหรือช้าเกินไป")
    if not 0.17 <= baseline_scale <= 0.84:
        raise HTTPException(status_code=422, detail="ขนาดใบหน้าตอนเริ่มไม่เหมาะสม")
    if not 1.08 <= peak_scale / baseline_scale <= 1.80:
        raise HTTPException(status_code=422, detail="ขยับใบหน้าเข้าใกล้กล้องไม่เพียงพอ")
    if abs(returned_scale / baseline_scale - 1) > 0.16:
        raise HTTPException(status_code=422, detail="ยังไม่กลับมาวางใบหน้าในกรอบเดิม")
    actual_prompt_delay = prompt_at_ms - returned_at
    if not prompt_delay_ms - 100 <= actual_prompt_delay <= prompt_delay_ms + 500:
        raise HTTPException(status_code=422, detail="เวลาแสดงคำสั่งกระพริบตาไม่ตรงกับ challenge")

    blinks = evidence.get("blinks")
    if not isinstance(blinks, list) or len(blinks) != required_blinks:
        raise HTTPException(status_code=422, detail="ทำการกระพริบตาไม่ครบตามจำนวนที่กำหนด")
    previous_reopen = prompt_at_ms
    for index, blink in enumerate(blinks, start=1):
        if (
            not isinstance(blink, dict)
            or blink.get("action") != "blink"
            or blink.get("blinkIndex") != index
        ):
            raise HTTPException(status_code=422, detail="ลำดับการกระพริบตาไม่ถูกต้อง")
        closed_at = _finite_number(blink.get("closedAtMs"), "blink.closedAtMs")
        reopened_at = _finite_number(blink.get("reopenedAtMs"), "blink.reopenedAtMs")
        duration = _finite_number(blink.get("durationMs"), "blink.durationMs")
        left_ratio = _finite_number(blink.get("minLeftEyeRatio"), "blink.minLeftEyeRatio")
        right_ratio = _finite_number(blink.get("minRightEyeRatio"), "blink.minRightEyeRatio")
        if closed_at < previous_reopen or reopened_at <= closed_at or reopened_at > completed_ms:
            raise HTTPException(status_code=422, detail="เวลาในการกระพริบตาไม่ต่อเนื่อง")
        if abs((reopened_at - closed_at) - duration) > 100 or not 60 <= duration <= 900:
            raise HTTPException(status_code=422, detail="ระยะเวลาการกระพริบตาไม่เป็นธรรมชาติ")
        if left_ratio > 0.74 or right_ratio > 0.74:
            raise HTTPException(status_code=422, detail="ต้องกระพริบตาทั้งสองข้างให้ครบ")
        previous_reopen = reopened_at
    if previous_reopen - prompt_at_ms > MAX_BLINK_RESPONSE_MS:
        raise HTTPException(status_code=422, detail="ตอบสนองคำสั่งกระพริบตาช้าเกินไป")

    _validate_frame_markers(evidence, required_blinks)
    return VerifiedLivenessEvidence(
        actions=PROTOCOL_ACTIONS,
        required_blinks=required_blinks,
        prompt_delay_ms=prompt_delay_ms,
        total_duration_ms=total_duration,
    )
