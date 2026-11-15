"""Signed hybrid liveness protocol shared by enrollment and attendance."""

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
from services import attempt_diagnostics
from services.action_fallback import action_fallback
from services.failure_diagnostics import diagnostic


PROTOCOL_VERSION = 4
PROTOCOL_MODE = "hybrid"
PASSIVE_SAMPLE_COUNT = 3
LIVENESS_ACTIONS = ("blink", "move_closer")
ENROLLMENT_PURPOSE = "face_enrollment"
ATTENDANCE_PURPOSE = "attendance"
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
MAX_ACTION_SPAN_MS = 3_000


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
        raise HTTPException(
            status_code=403,
            detail="หลักฐานตรวจบุคคลจริงไม่ถูกต้อง" + diagnostic("token_encoding", f"ยาว {len(value)} ตัวอักษร"),
        ) from exc
    if _encode_base64url(decoded) != value:
        raise HTTPException(
            status_code=403,
            detail="หลักฐานตรวจบุคคลจริงไม่ถูกต้อง" + diagnostic("token_encoding", "รูปแบบ base64url ไม่ตรง"),
        )
    return decoded


def create_liveness_challenge(challenge_id: str, student_id: str, expires_at: datetime) -> LivenessChallenge:
    """Issue an enrollment-only hybrid challenge.

    Enrollment deliberately shares the same low-friction action protocol as
    attendance, while the signed purpose prevents cross-flow token reuse.
    """
    return _create_hybrid_challenge(
        challenge_id,
        student_id,
        expires_at,
        purpose=ENROLLMENT_PURPOSE,
    )


def _create_hybrid_challenge(
    challenge_id: str,
    student_id: str,
    expires_at: datetime,
    *,
    purpose: str,
    session_id: str | None = None,
) -> LivenessChallenge:
    now = datetime.now(timezone.utc)
    # Server-side fallback (services/action_fallback.py): after repeated failures of the blink
    # action this student gets move_closer for a while. Keyed by the authenticated user id that is
    # also signed into the token; the client cannot influence it.
    action = action_fallback.forced_action(student_id) or secrets.choice(LIVENESS_ACTIONS)
    prompt_delay_ms = MIN_PROMPT_DELAY_MS + secrets.randbelow(
        MAX_PROMPT_DELAY_MS - MIN_PROMPT_DELAY_MS + 1
    )
    payload = {
        "v": PROTOCOL_VERSION,
        "challenge_id": challenge_id,
        "student_id": student_id,
        "mode": PROTOCOL_MODE,
        "sample_count": PASSIVE_SAMPLE_COUNT,
        "purpose": purpose,
        "action": action,
        "prompt_delay_ms": prompt_delay_ms,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "nonce": secrets.token_urlsafe(18),
    }
    if session_id is not None:
        payload["session_id"] = session_id
    encoded = _encode_base64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = hmac.new(_signing_key(), encoded.encode("ascii"), hashlib.sha256).digest()
    return LivenessChallenge(
        token=f"{encoded}.{_encode_base64url(signature)}",
        mode=PROTOCOL_MODE,
        sample_count=PASSIVE_SAMPLE_COUNT,
        protocol_version=PROTOCOL_VERSION,
        action=action,
        prompt_delay_ms=prompt_delay_ms,
    )


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

    return _create_hybrid_challenge(
        challenge_id,
        student_id,
        expires_at,
        purpose=ATTENDANCE_PURPOSE,
        session_id=session_id,
    )


def _finite_number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise HTTPException(
            status_code=422,
            detail=f"หลักฐานตรวจบุคคลจริงขาดค่า {field}" + diagnostic("evidence_value", "ค่าไม่ใช่ตัวเลขจำกัด"),
        )
    return float(value)


def _decode_and_verify_token(token: str, expected_version: int = PROTOCOL_VERSION) -> dict:
    if not token or len(token.encode()) > MAX_TOKEN_BYTES or token.count(".") != 1:
        raise HTTPException(
            status_code=403,
            detail="ไม่พบสิทธิ์ตรวจบุคคลจริง"
            + diagnostic(
                "token_missing",
                f"ขนาด {len((token or '').encode())} ไบต์ (เกณฑ์ ≤{MAX_TOKEN_BYTES})",
                f"จุดคั่น {(token or '').count('.')} (ต้อง 1)",
            ),
        )
    encoded, encoded_signature = token.split(".", 1)
    supplied = _decode_base64url(encoded_signature)
    expected = hmac.new(_signing_key(), encoded.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=403, detail="สิทธิ์ตรวจบุคคลจริงไม่ถูกต้อง" + diagnostic("token_signature")
        )
    try:
        payload = json.loads(_decode_base64url(encoded))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=403, detail="สิทธิ์ตรวจบุคคลจริงเสียหาย" + diagnostic("token_corrupt")
        ) from exc
    if not isinstance(payload, dict) or payload.get("v") != expected_version:
        version = payload.get("v") if isinstance(payload, dict) else None
        shown = str(version) if isinstance(version, int) and not isinstance(version, bool) else "-"
        raise HTTPException(
            status_code=403,
            detail="เวอร์ชันตรวจบุคคลจริงไม่รองรับ"
            + diagnostic("token_version", f"เวอร์ชัน {shown} (ต้อง {expected_version})"),
        )
    return payload


def verify_liveness_submission(
    token: str,
    evidence_json: str,
    expected_challenge_id: str,
    expected_student_id: str,
    *,
    now: datetime | None = None,
) -> VerifiedLivenessEvidence:
    """Validate enrollment protocol-v4 evidence before image processing."""
    return _verify_hybrid_liveness_submission(
        token,
        evidence_json,
        expected_challenge_id,
        expected_student_id,
        expected_purpose=ENROLLMENT_PURPOSE,
        now=now,
    )


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

    return _verify_hybrid_liveness_submission(
        token,
        evidence_json,
        expected_challenge_id,
        expected_student_id,
        expected_purpose=ATTENDANCE_PURPOSE,
        expected_session_id=expected_session_id,
        now=now,
    )


def _verify_hybrid_liveness_submission(
    token: str,
    evidence_json: str,
    expected_challenge_id: str,
    expected_student_id: str,
    *,
    expected_purpose: str,
    expected_session_id: str | None = None,
    now: datetime | None = None,
) -> VerifiedLivenessEvidence:
    """Validate the shared hybrid contract and its purpose-specific binding."""

    payload = _decode_and_verify_token(token, PROTOCOL_VERSION)
    # Only the NAMES of the mismatching fields are reported, never their values (ids).
    mismatched = [
        name
        for name, bad in (
            ("challenge", payload.get("challenge_id") != expected_challenge_id),
            ("student", payload.get("student_id") != expected_student_id),
            ("purpose", payload.get("purpose") != expected_purpose),
            (
                "session",
                (expected_session_id is not None and payload.get("session_id") != expected_session_id)
                or (expected_session_id is None and "session_id" in payload),
            ),
        )
        if bad
    ]
    if mismatched:
        raise HTTPException(
            status_code=403,
            detail="สิทธิ์ตรวจบุคคลจริงไม่ตรงกับผู้ใช้หรือขั้นตอนที่กำลังทำ"
            + diagnostic("token_binding", "ไม่ตรง: " + "/".join(mismatched)),
        )

    current_timestamp = int((now or datetime.now(timezone.utc)).timestamp())
    issued_at, expires_at = payload.get("iat"), payload.get("exp")
    if (
        not isinstance(issued_at, int)
        or not isinstance(expires_at, int)
        or issued_at > current_timestamp + 5
        or expires_at <= current_timestamp
    ):
        if isinstance(expires_at, int) and expires_at <= current_timestamp:
            measured = f"หมดอายุมาแล้ว {current_timestamp - expires_at} วินาที"
        elif isinstance(issued_at, int):
            measured = f"ออกล่วงหน้า {issued_at - current_timestamp} วินาที (เกณฑ์ ≤5)"
        else:
            measured = "ไม่มีเวลาออกหรือหมดอายุ"
        raise HTTPException(
            status_code=400,
            detail="สิทธิ์ตรวจบุคคลจริงหมดอายุ กรุณาเริ่มใหม่" + diagnostic("token_expired", measured),
        )

    action = payload.get("action")
    prompt_delay_ms = payload.get("prompt_delay_ms")
    if (
        payload.get("mode") != PROTOCOL_MODE
        or payload.get("sample_count") != PASSIVE_SAMPLE_COUNT
        or action not in LIVENESS_ACTIONS
        or not isinstance(prompt_delay_ms, int)
        or not MIN_PROMPT_DELAY_MS <= prompt_delay_ms <= MAX_PROMPT_DELAY_MS
    ):
        raise HTTPException(
            status_code=403, detail="นโยบายตรวจบุคคลจริงไม่ถูกต้อง" + diagnostic("token_policy")
        )
    attempt_diagnostics.record("timing", {"prompt_delay_ms": prompt_delay_ms})

    evidence_bytes = len((evidence_json or "").encode())
    if not evidence_json or evidence_bytes > MAX_EVIDENCE_BYTES:
        raise HTTPException(
            status_code=422,
            detail="หลักฐานตรวจบุคคลจริงมีขนาดไม่ถูกต้อง"
            + diagnostic("evidence_size", f"{evidence_bytes} ไบต์ (เกณฑ์ 1–{MAX_EVIDENCE_BYTES})"),
        )
    try:
        evidence = json.loads(evidence_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=422,
            detail="อ่านหลักฐานตรวจบุคคลจริงไม่ได้" + diagnostic("evidence_json", f"ตำแหน่ง {exc.pos}"),
        ) from exc

    frames = evidence.get("frames") if isinstance(evidence, dict) else None
    if not isinstance(evidence, dict):
        shape_problems = ["object"]
    else:
        shape_problems = [
            name
            for name, bad in (
                ("version", evidence.get("version") != PROTOCOL_VERSION),
                ("mode", evidence.get("mode") != PROTOCOL_MODE),
                ("sampleCount", evidence.get("sampleCount") != PASSIVE_SAMPLE_COUNT),
                ("action", evidence.get("action") != action),
                ("promptDelayMs", evidence.get("promptDelayMs") != prompt_delay_ms),
                (
                    "frames",
                    not isinstance(frames, list) or len(frames) != PASSIVE_SAMPLE_COUNT + 2,
                ),
            )
            if bad
        ]
    if shape_problems:
        frame_count = len(frames) if isinstance(frames, list) else 0
        raise HTTPException(
            status_code=422,
            detail="รูปแบบหลักฐานตรวจบุคคลจริงไม่ถูกต้อง"
            + diagnostic(
                "evidence_shape",
                "ไม่ตรง: " + "/".join(shape_problems),
                f"จำนวนเฟรม {frame_count} (ต้อง {PASSIVE_SAMPLE_COUNT + 2})",
            ),
        )

    started = _finite_number(evidence.get("startedAtMs"), "startedAtMs")
    prompt_at = _finite_number(evidence.get("promptAtMs"), "promptAtMs")
    completed = _finite_number(evidence.get("completedAtMs"), "completedAtMs")
    fps = _finite_number(evidence.get("effectiveFps"), "effectiveFps")
    duration = int(completed - started)
    attempt_diagnostics.record("timing", {"duration_ms": duration, "fps": round(fps, 2)})
    if not MIN_ATTEMPT_DURATION_MS <= duration <= MAX_ATTEMPT_DURATION_MS:
        raise HTTPException(
            status_code=422,
            detail="ระยะเวลาสแกนใบหน้าไม่เป็นธรรมชาติ กรุณาลองใหม่"
            + diagnostic(
                "duration",
                f"ใช้เวลา {duration / 1000:.1f} วินาที (เกณฑ์ {MIN_ATTEMPT_DURATION_MS / 1000:.1f}–{MAX_ATTEMPT_DURATION_MS / 1000:.0f})",
            ),
        )
    if not MIN_EFFECTIVE_FPS <= fps <= MAX_EFFECTIVE_FPS:
        raise HTTPException(
            status_code=422,
            detail="อัตราภาพจากกล้องไม่เพียงพอสำหรับตรวจบุคคลจริง"
            + diagnostic("fps", f"ประมวลผลได้ {fps:.1f} เฟรม/วินาที (เกณฑ์ {MIN_EFFECTIVE_FPS}–{MAX_EFFECTIVE_FPS})"),
        )

    timestamps: list[float] = []
    for index, frame in enumerate(frames[:PASSIVE_SAMPLE_COUNT], start=1):
        if (
            not isinstance(frame, dict)
            or frame.get("kind") != "passive_sample"
            or frame.get("sampleIndex") != index
        ):
            raise HTTPException(
                status_code=422,
                detail="ลำดับหลักฐานภาพต่อเนื่องไม่ถูกต้อง"
                + diagnostic("sequence_passive", f"เฟรมที่ {index} ชนิดหรือลำดับไม่ตรง"),
            )
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
        which = "คำสั่ง" if (
            not isinstance(action_frame, dict)
            or action_frame.get("kind") != "challenge_action"
            or action_frame.get("action") != action
        ) else "กลับท่าปกติ"
        raise HTTPException(
            status_code=422,
            detail="ลำดับคำสั่งสุ่มไม่ถูกต้อง" + diagnostic("sequence_action", f"เฟรม{which}ชนิดหรือคำสั่งไม่ตรง"),
        )
    action_at = _finite_number(action_frame.get("timestampMs"), "frames.action.timestampMs")
    recovery_at = _finite_number(
        recovery_frame.get("timestampMs"), "frames.recovery.timestampMs"
    )
    intervals = [current - previous for previous, current in zip(timestamps, timestamps[1:])]
    attempt_diagnostics.record("timing", {
        "intervals_ms": [round(interval) for interval in intervals],
        "first_sample_after_start_ms": round(timestamps[0] - started),
        "prompt_after_last_sample_ms": round(prompt_at - timestamps[-1]),
        "action_after_prompt_ms": round(action_at - prompt_at),
        "recovery_after_action_ms": round(recovery_at - action_at),
        "complete_after_recovery_ms": round(completed - recovery_at),
    })
    for position, interval in enumerate(intervals, start=1):
        if not MIN_SAMPLE_INTERVAL_MS <= interval <= MAX_SAMPLE_INTERVAL_MS:
            raise HTTPException(
                status_code=422,
                detail="ช่วงเวลาหลักฐานภาพไม่เป็นธรรมชาติ กรุณาถือโทรศัพท์ให้นิ่งและมองตรงตลอดการสแกน แล้วลองใหม่"
                + diagnostic(
                    "timing_interval",
                    f"ช่วงที่ {position} (เฟรม {position}→{position + 1}) {interval:.0f} มิลลิวินาที "
                    f"(เกณฑ์ {MIN_SAMPLE_INTERVAL_MS}–{MAX_SAMPLE_INTERVAL_MS})",
                    "ทุกช่วง " + "/".join(f"{value:.0f}" for value in intervals),
                ),
            )
    timing_problem = _timing_order_problem(
        started=started,
        first_sample=timestamps[0],
        last_sample=timestamps[-1],
        prompt_at=prompt_at,
        prompt_delay_ms=prompt_delay_ms,
        action_at=action_at,
        recovery_at=recovery_at,
        completed=completed,
    )
    if timing_problem is not None:
        code, hint, measured = timing_problem
        raise HTTPException(
            status_code=422,
            detail=f"เวลาคำสั่งสุ่มไม่ต่อเนื่อง {hint}" + diagnostic(code, measured),
        )

    return VerifiedLivenessEvidence(
        mode=PROTOCOL_MODE,
        sample_count=PASSIVE_SAMPLE_COUNT,
        total_duration_ms=duration,
        action=action,
    )


def _timing_order_problem(
    *,
    started: float,
    first_sample: float,
    last_sample: float,
    prompt_at: float,
    prompt_delay_ms: int,
    action_at: float,
    recovery_at: float,
    completed: float,
) -> tuple[str, str, str] | None:
    """Return (code, plain Thai hint, measured numbers) for the first broken timing rule, or None.

    The rules are exactly the ones checked before (same order, same limits); only the report
    is more specific so the attempt log shows which rule failed and by how much.
    """

    if first_sample < started:
        return (
            "timing_start",
            "กรุณาเริ่มสแกนใหม่",
            f"ภาพแรกก่อนเริ่ม {started - first_sample:.0f} มิลลิวินาที (ต้อง ≥0)",
        )
    if prompt_at < last_sample + prompt_delay_ms:
        return (
            "timing_prompt_delay",
            "กรุณาเริ่มสแกนใหม่",
            f"คำสั่งหลังภาพสุดท้าย {prompt_at - last_sample:.0f} มิลลิวินาที (เกณฑ์ ≥{prompt_delay_ms})",
        )
    if action_at < prompt_at:
        return (
            "timing_action_early",
            "กรุณารอให้คำสั่งขึ้นก่อนแล้วจึงทำตาม",
            f"ทำคำสั่งก่อนคำสั่งขึ้น {prompt_at - action_at:.0f} มิลลิวินาที (ต้อง ≥0)",
        )
    if recovery_at <= action_at:
        return (
            "timing_recovery_order",
            "กรุณาทำตามคำสั่งแล้วจึงกลับมามองตรง",
            f"ภาพกลับท่าปกติเร็วกว่าภาพคำสั่ง {action_at - recovery_at:.0f} มิลลิวินาที (ต้อง >0)",
        )
    if recovery_at > completed:
        return (
            "timing_recovery_late",
            "กรุณาเริ่มสแกนใหม่",
            f"ภาพกลับท่าปกติหลังจบการสแกน {recovery_at - completed:.0f} มิลลิวินาที (ต้อง ≤0)",
        )
    if recovery_at - action_at > MAX_ACTION_SPAN_MS:
        return (
            "timing_action_span",
            f"กรุณาทำตามคำสั่งแล้วกลับมามองตรงภายใน {MAX_ACTION_SPAN_MS // 1000} วินาที",
            f"คำสั่ง→กลับท่าปกติ {recovery_at - action_at:.0f} มิลลิวินาที (เกณฑ์ ≤{MAX_ACTION_SPAN_MS})",
        )
    return None
