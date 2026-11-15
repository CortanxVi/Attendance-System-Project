"""Backend recomputation for hybrid and legacy transient liveness frames."""

from __future__ import annotations

from dataclasses import dataclass
import math
from collections.abc import Callable, Mapping, Sequence

import cv2
import numpy as np
from fastapi import HTTPException

from core.config import LIVENESS_BLINK_106_ENABLED
from services import attempt_diagnostics
from services.failure_diagnostics import diagnostic, limit
from services.insightface_service import FaceObservation, StrictFaceFailure, face_service
from services.passive_pad_service import passive_pad_service


LIVENESS_FRAME_IDENTITY_THRESHOLD = 0.35
BLINK_FRAME_IDENTITY_THRESHOLD = 0.30

# Blink aperture rules. The 68-point eye aperture cannot shrink below a floor, so a narrow-eyed
# person shows a smaller RELATIVE drop than a wide-eyed one. The allowed "closed" ratio therefore
# grows from the strict value (eyes at least BLINK_WIDE_EAR open) to a looser one (BLINK_NARROW_EAR
# or less). A static photo stays near ratio 1.0 whatever the limit; the frontend scanner adds a
# blend-shape check, and the PAD, identity and frame-difference checks below still apply.
BLINK_CLOSED_RATIO_STRICT = 0.78
BLINK_CLOSED_RATIO_NARROW = 0.88
BLINK_WIDE_EAR = 0.26
BLINK_NARROW_EAR = 0.13
# After the action the eyes only have to be "mostly open" again (people relax after staring wide).
BLINK_RECOVERY_RATIO = 0.70

# Second blink rule, based on the 2d106det eye landmarks. It applies to attendance for every course
# and to face enrollment (same liveness bar everywhere; owner decision 2026-11-15), unless the kill
# switch LIVENESS_BLINK_106_ENABLED is off. A blink passes when the 68-point rule passes, OR when
# ALL of the following hold:
#   * both 106-point closed ratios <= BLINK_106_CLOSED_RATIO_MAX,
#   * both 68-point closed ratios <= BLINK_106_68_CEILING (a static photo reads ~1.0 on the
#     68-point measure, so the ceiling keeps photos out even if the 106-point measure is noisy),
#   * both 106-point recovery ratios >= BLINK_106_RECOVERY_RATIO, and
#   * the 68-point recovery rule (BLINK_RECOVERY_RATIO) passes.
# Provenance (round-two real-phone data, 2026-11-15, tiny n, REVISIT with more data):
#   * two genuine blinks failed the 68-point rule (closed 0.79/0.74 and 0.83/0.84) while the
#     106-point measure read 0.49/0.47 and 0.41/0.39;
#   * genuine successes read 0.25-0.59 on the 106-point measure (their 68-point rule passed);
#   * the worst static-photo open-eye 106-point reading seen offline was 0.59 (small, rotated,
#     upsampled faces), so 0.50 stays below it; the 68-point ceiling is the second guard.
BLINK_106_CLOSED_RATIO_MAX = 0.50
# 68-point photo ceiling, derived from data (owner request, 2026-11-15): genuine closed blinks
# that the 106-point measure confirmed (n=17) read 68-point closed ratios 0.55-0.909 (mean ~0.70;
# the max is a narrow-eyed Android user, 0.909/0.866), while a static photo reads 1.00 +-0.04,
# i.e. no lower than ~0.96. 0.94 is the midpoint: genuine max +0.03, photo min -0.02. Small n;
# revisit with more data. (Was 0.90.)
BLINK_106_68_CEILING = 0.94
BLINK_106_RECOVERY_RATIO = 0.70
# Sanity guard: the 106-point open-eye reference (median of the passive frames) must be at least
# this on both eyes, or the 106 ratios are not trusted (reason "base_106"). Genuine references
# were 0.167-0.315; a broken attempt had 0.055/0.050, giving nonsense ratios (closed 0.15/0.38,
# back 2.08/2.21).
BLINK_106_MIN_OPEN_BASE = 0.10
_BLINK_106_KEYS = (
    "closed_left_106", "closed_right_106", "back_left_106", "back_right_106",
)

CLEAR_FACE_ADVICE = "กรุณาเปิดหน้าผากและเก็บผมที่ปิดคิ้วหรือตา ถอดแว่นหรือหน้ากาก และอยู่ในที่สว่างพอ"


class BlinkActionFailure(HTTPException):
    """The blink action itself failed (eye closure or head pose during the blink).

    Same HTTP behaviour as HTTPException(422); the endpoints use the type to count consecutive
    blink failures for the server-side action fallback (services/action_fallback.py).
    """


@dataclass(frozen=True)
class VerifiedLivenessFrames:
    final_embedding: np.ndarray


def blink_closed_ratio_limit(open_aperture: float) -> float:
    """Largest action/open aperture ratio still accepted as "closed" for an eye this open."""

    if open_aperture >= BLINK_WIDE_EAR:
        return BLINK_CLOSED_RATIO_STRICT
    if open_aperture <= BLINK_NARROW_EAR:
        return BLINK_CLOSED_RATIO_NARROW
    share = (BLINK_WIDE_EAR - open_aperture) / (BLINK_WIDE_EAR - BLINK_NARROW_EAR)
    return BLINK_CLOSED_RATIO_STRICT + share * (BLINK_CLOSED_RATIO_NARROW - BLINK_CLOSED_RATIO_STRICT)


def blink_106_rule_problem(
    left_ratio: float,
    right_ratio: float,
    recovered_68: bool,
    values_106: Mapping[str, float | None] | None,
) -> str | None:
    """Return None when the 106-point blink rule passes, else a short reason code.

    Reason codes: ``off`` (LIVENESS_BLINK_106_ENABLED is off), ``missing`` (no 106-point values,
    e.g. the model file is unavailable), ``nonfinite`` (a NaN/inf ratio), ``base_106`` (106-point
    open reference below BLINK_106_MIN_OPEN_BASE or missing), ``closed_106``,
    ``ceiling_68``, ``back_106``, ``back_68``. Only called after the 68-point rule failed.
    Fail closed: every limit is written as "pass only if the value is inside", so a NaN can never
    slip through a comparison.
    """

    if not LIVENESS_BLINK_106_ENABLED:
        return "off"
    if values_106 is None:
        return "missing"
    numbers = [values_106.get(key) for key in _BLINK_106_KEYS]
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) for value in numbers):
        return "missing"
    closed_left, closed_right, back_left, back_right = (float(value) for value in numbers)
    if not all(math.isfinite(value) for value in (left_ratio, right_ratio, *map(float, numbers))):
        return "nonfinite"
    bases = [values_106.get("open_left_106"), values_106.get("open_right_106")]
    if not all(
        isinstance(base, (int, float)) and not isinstance(base, bool) and float(base) >= BLINK_106_MIN_OPEN_BASE
        for base in bases
    ):
        return "base_106"  # (NaN >= x is False, so a NaN base is refused here too)
    if not (closed_left <= BLINK_106_CLOSED_RATIO_MAX and closed_right <= BLINK_106_CLOSED_RATIO_MAX):
        return "closed_106"
    if not (left_ratio <= BLINK_106_68_CEILING and right_ratio <= BLINK_106_68_CEILING):
        return "ceiling_68"
    if not (back_left >= BLINK_106_RECOVERY_RATIO and back_right >= BLINK_106_RECOVERY_RATIO):
        return "back_106"
    if recovered_68 is not True:
        return "back_68"
    return None


def _open_reference(value: float) -> float:
    """Floor an open-eye reference at 0.001; NaN/inf stays NaN so every later check fails."""

    value = float(value)
    if not math.isfinite(value):
        return math.nan
    return max(value, 0.001)


def blink_aperture_problem(
    open_left: float,
    open_right: float,
    action: FaceObservation,
    recovery: FaceObservation,
    blink_106: Mapping[str, float | None] | None = None,
) -> str | None:
    """Return None when the eyes closed during the action and reopened afterwards, else a hint.

    A blink passes on the 68-point rule, or (when LIVENESS_BLINK_106_ENABLED) on the 2d106det rule
    (see BLINK_106_* above) when ``blink_106`` holds its ratios. Test mode records which rule
    passed as ``blink.blink_rule`` ("68", "106" or "none"); outside test mode nothing is recorded
    and a failure is the plain Thai sentence without numbers.
    """

    open_left = _open_reference(open_left)
    open_right = _open_reference(open_right)
    left_ratio = float(action.left_eye_aperture_proxy) / open_left
    right_ratio = float(action.right_eye_aperture_proxy) / open_right
    left_limit = blink_closed_ratio_limit(open_left)
    right_limit = blink_closed_ratio_limit(open_right)
    left_back = float(recovery.left_eye_aperture_proxy) / open_left
    right_back = float(recovery.right_eye_aperture_proxy) / open_right
    # Fail closed: any NaN/inf value refuses the blink (comparisons with NaN are always False,
    # so every check below is written as "inside the limit", never as "outside the limit").
    finite = all(math.isfinite(value) for value in (
        open_left, open_right, left_ratio, right_ratio, left_limit, right_limit, left_back, right_back,
    ))
    recovered_68 = finite and left_back >= BLINK_RECOVERY_RATIO and right_back >= BLINK_RECOVERY_RATIO
    if finite and left_ratio <= left_limit and right_ratio <= right_limit and recovered_68:
        attempt_diagnostics.record("blink", {"blink_rule": "68"})
        return None
    rule_106 = blink_106_rule_problem(left_ratio, right_ratio, recovered_68, blink_106)
    if rule_106 is None:
        attempt_diagnostics.record("blink", {"blink_rule": "106"})
        return None
    attempt_diagnostics.record("blink", {"blink_rule": "none", "rule_106": rule_106})
    detail = (
        "คำสั่งกะพริบตาไม่ผ่าน กรุณาหลับตาทั้งสองข้างให้สนิทสักครู่ "
        "แล้วลืมตามองตรง และเก็บผมที่ปิดตาออก"
    )
    numbers = [
        f"ปิดตา ซ้าย/ขวา {left_ratio:.2f}/{right_ratio:.2f} (เกณฑ์ ≤{left_limit:.2f}/{right_limit:.2f})",
        f"กลับมาเปิด {left_back:.2f}/{right_back:.2f} (เกณฑ์ ≥{BLINK_RECOVERY_RATIO:.2f})",
        f"ตาเปิดฐาน {open_left:.2f}/{open_right:.2f}",
    ]
    if rule_106 not in ("off", "missing", "nonfinite"):
        numbers.append(
            f"กฎ106 ไม่ผ่าน:{rule_106} (เกณฑ์ 106≤{BLINK_106_CLOSED_RATIO_MAX:.2f}"
            f" 68≤{BLINK_106_68_CEILING:.2f} กลับ106≥{BLINK_106_RECOVERY_RATIO:.2f})"
        )
    detail += diagnostic("blink", *numbers)
    return detail


def verify_hybrid_liveness_frames(
    passive_images: Sequence[np.ndarray],
    action_image: np.ndarray,
    recovery_image: np.ndarray,
    action: str,
    *,
    on_blink_passed: Callable[[], None] | None = None,
) -> VerifiedLivenessFrames:
    """Verify passive PAD plus one server-selected temporal action.

    ``on_blink_passed`` (optional) is called as soon as the blink check itself passes, before the
    remaining checks; the endpoints use it to break the blink-failure streak of the fallback.

    For a blink action every frame is also measured with 2d106det (when enabled) so the second
    blink rule can decide; attendance and enrollment share this verifier and this bar.

    The signed metadata decides which action is required. Geometry and identity
    are recomputed from the uploaded frames, so a browser cannot claim that an
    action happened without supplying matching visual evidence. Enrollment and
    attendance call this same verifier after validating their signed purpose.
    """

    if action not in ("blink", "move_closer"):
        raise HTTPException(
            status_code=422, detail="คำสั่งสุ่มสำหรับ Liveness ไม่ถูกต้อง" + diagnostic("frames_action")
        )
    if len(passive_images) != 3:
        raise HTTPException(
            status_code=422,
            detail="หลักฐาน Passive Liveness ต้องมี 3 เฟรม"
            + diagnostic("frames_count", f"ได้ {len(passive_images)} เฟรม (ต้อง 3)"),
        )

    passive_observations = [
        _extract(image, f"ภาพต่อเนื่องลำดับที่ {index}", with_106=action == "blink")
        for index, image in enumerate(passive_images, start=1)
    ]
    reference = passive_observations[0]
    attempt_diagnostics.record("reference", {
        "width": attempt_diagnostics.number(reference.face_width_ratio),
        "center": attempt_diagnostics.number(reference.center_offset),
        "det": attempt_diagnostics.number(reference.detection_score, 3),
    })
    first_problem = _first_frame_problem(reference)
    if first_problem is not None:
        raise HTTPException(status_code=422, detail=first_problem)
    for index, observation in enumerate(passive_observations[1:], start=2):
        attempt_diagnostics.append("pose", attempt_diagnostics.pose_delta(f"f{index}", reference, observation))
        _same_person(reference, observation)
        problem = _frontal_problem(reference, observation, scale_tolerance=0.22)
        if problem is not None:
            raise HTTPException(
                status_code=422,
                detail=_framing_message(problem, FRAMING_PREFIX, f"เฟรม {index}"),
            )

    action_observation = _extract(action_image, "ภาพขณะทำคำสั่งสุ่ม", with_106=action == "blink")
    recovery_observation = _extract(recovery_image, "ภาพหลังกลับสู่ท่าปกติ", with_106=action == "blink")
    attempt_diagnostics.append("pose", attempt_diagnostics.pose_delta("action", reference, action_observation))
    attempt_diagnostics.append("pose", attempt_diagnostics.pose_delta("recovery", reference, recovery_observation))
    _same_person(reference, action_observation, blink=action == "blink")
    _same_person(reference, recovery_observation)

    passive_pad_service.assert_live(
        passive_images,
        [observation.bbox for observation in passive_observations],
    )
    passive_differences = [
        _frame_difference(first, second)
        for first, second in zip(passive_images, passive_images[1:])
    ]
    attempt_diagnostics.record("frame_diff", {
        "passive": [attempt_diagnostics.number(value, 3) for value in passive_differences],
    })
    if not all(difference >= 0.35 for difference in passive_differences):
        raise HTTPException(
            status_code=422,
            detail="ตรวจพบภาพซ้ำหรือภาพนิ่ง กรุณาใช้บุคคลจริงหน้ากล้อง"
            + diagnostic(
                "static_passive",
                "ความต่างระหว่างเฟรม " + "/".join(f"{value:.2f}" for value in passive_differences) + " (เกณฑ์ ≥0.35)",
            ),
        )
    action_differences = (
        _frame_difference(passive_images[-1], action_image),
        _frame_difference(action_image, recovery_image),
    )
    attempt_diagnostics.record("frame_diff", {
        "passive": [attempt_diagnostics.number(value, 3) for value in passive_differences],
        "action": [attempt_diagnostics.number(value, 3) for value in action_differences],
    })
    if not all(difference >= 0.8 for difference in action_differences):
        raise HTTPException(
            status_code=422,
            detail="ภาพคำสั่งสุ่มซ้ำหรือไม่ต่อเนื่อง กรุณาใช้กล้องกับบุคคลจริง"
            + diagnostic(
                "static_action",
                "ความต่างก่อน→คำสั่ง/คำสั่ง→กลับ " + "/".join(f"{value:.2f}" for value in action_differences) + " (เกณฑ์ ≥0.80)",
            ),
        )

    if action == "blink":
        open_left = float(np.median([
            observation.left_eye_aperture_proxy
            for observation in passive_observations
        ]))
        open_right = float(np.median([
            observation.right_eye_aperture_proxy
            for observation in passive_observations
        ]))
        _record_blink(open_left, open_right, action_observation, recovery_observation)
        blink_106 = _blink_106(passive_observations, action_observation, recovery_observation)
        problem = blink_aperture_problem(
            open_left, open_right, action_observation, recovery_observation, blink_106
        )
        if problem is not None and blink_106 is not None:
            problem = _with_blink_106(problem, blink_106)
        blink_yaw = action_observation.yaw_proxy - reference.yaw_proxy
        blink_pitch = action_observation.pitch_proxy - reference.pitch_proxy
        if (
            problem is not None
            or not abs(blink_yaw) <= 0.15
            or not abs(blink_pitch) <= 0.20
        ):
            raise BlinkActionFailure(
                status_code=422,
                detail=problem
                or "คำสั่งกะพริบตาไม่ผ่าน กรุณามองตรงโดยไม่ผงกศีรษะขณะหลับตา แล้วลืมตามองตรง"
                + diagnostic(
                    "blink_pose",
                    "หัน(yaw) " + limit(blink_yaw, high=0.15, signed=True).replace("เกณฑ์ ≤", "เกณฑ์ ±"),
                    "ก้มเงย(pitch) " + limit(blink_pitch, high=0.20, signed=True).replace("เกณฑ์ ≤", "เกณฑ์ ±"),
                ),
            )
        if on_blink_passed is not None:
            try:
                on_blink_passed()
            except Exception:  # noqa: BLE001 - bookkeeping must never change the verdict
                pass
    else:
        scale_ratio = action_observation.face_width_ratio / max(
            reference.face_width_ratio, 0.001
        )
        attempt_diagnostics.record("move_closer", {"scale_ratio": attempt_diagnostics.number(scale_ratio)})
        problem = _move_closer_problem(reference, action_observation, scale_ratio)
        if problem is not None:
            raise HTTPException(status_code=422, detail=problem)

    recovery_problem = _frontal_problem(reference, recovery_observation, scale_tolerance=0.20)
    if recovery_problem is not None:
        raise HTTPException(
            status_code=422,
            detail=_framing_message(recovery_problem, RECOVERY_PREFIX, "เฟรมสุดท้าย"),
        )
    return VerifiedLivenessFrames(final_embedding=recovery_observation.embedding)


def _record_blink(
    open_left: float, open_right: float, action: FaceObservation, recovery: FaceObservation
) -> None:
    """Test mode only: store the blink ratios the check uses (same formulas, numbers only)."""

    if attempt_diagnostics.current() is None:
        return
    left = max(open_left, 0.001)
    right = max(open_right, 0.001)
    number = attempt_diagnostics.number
    attempt_diagnostics.record("blink", {
        "open_left": number(open_left),
        "open_right": number(open_right),
        "closed_left": number(action.left_eye_aperture_proxy / left),
        "closed_right": number(action.right_eye_aperture_proxy / right),
        "limit_left": number(blink_closed_ratio_limit(left)),
        "limit_right": number(blink_closed_ratio_limit(right)),
        "back_left": number(recovery.left_eye_aperture_proxy / left),
        "back_right": number(recovery.right_eye_aperture_proxy / right),
    })


def _blink_106(
    passive: Sequence[FaceObservation], action: FaceObservation, recovery: FaceObservation
) -> dict[str, float] | None:
    """The same blink ratios measured with the 2d106det landmarks (recorded in test mode only).

    Same formulas and the same reference frames as the 68-point check (open = median of the
    passive frames). These values feed the second blink rule (``blink_106_rule_problem``) and are
    recorded in test mode only. None when the model did not run for any of the frames (rule off,
    file missing or wrong); then only the 68-point rule decides.
    """

    frames = (*passive, action, recovery)
    if any(o.left_eye_aperture_106 is None or o.right_eye_aperture_106 is None for o in frames):
        return None
    if not all(
        math.isfinite(float(o.left_eye_aperture_106)) and math.isfinite(float(o.right_eye_aperture_106))
        for o in frames
    ):
        return None  # unreadable 106-point values: only the 68-point rule decides
    open_left = max(float(np.median([o.left_eye_aperture_106 for o in passive])), 0.001)
    open_right = max(float(np.median([o.right_eye_aperture_106 for o in passive])), 0.001)
    # The rule decides on these UNROUNDED values; only the test-mode record is rounded.
    values = {
        "open_left_106": open_left,
        "open_right_106": open_right,
        "closed_left_106": float(action.left_eye_aperture_106) / open_left,
        "closed_right_106": float(action.right_eye_aperture_106) / open_right,
        "back_left_106": float(recovery.left_eye_aperture_106) / open_left,
        "back_right_106": float(recovery.right_eye_aperture_106) / open_right,
    }
    attempt_diagnostics.record(
        "blink", {key: attempt_diagnostics.number(value) for key, value in values.items()}
    )
    return values


def _with_blink_106(problem: str, values: dict[str, float]) -> str:
    """Append the 2d106det numbers inside an existing test-mode "[รหัส blink ...]" tag."""

    if not problem.endswith("]") or "[รหัส " not in problem:
        return problem
    extra = (
        f" · 106จุด ปิดตา {values['closed_left_106']:.2f}/{values['closed_right_106']:.2f}"
        f" กลับมาเปิด {values['back_left_106']:.2f}/{values['back_right_106']:.2f}"
        f" ฐาน {values['open_left_106']:.2f}/{values['open_right_106']:.2f}"
    )
    return problem[:-1] + extra + "]"


def _frame_difference(first: np.ndarray, second: np.ndarray) -> float:
    first_gray = cv2.resize(cv2.cvtColor(first, cv2.COLOR_BGR2GRAY), (160, 120))
    second_gray = cv2.resize(cv2.cvtColor(second, cv2.COLOR_BGR2GRAY), (160, 120))
    return float(np.mean(cv2.absdiff(first_gray, second_gray)))


def _extract(image: np.ndarray, label: str, *, with_106: bool = False) -> FaceObservation:
    face_service.reset_strict_failure()
    if with_106:
        # Only blink frames need the 2d106det measure (one extra CPU inference per frame).
        observation = face_service.extract_strict_face_observation(image, with_106=True)
    else:
        observation = face_service.extract_strict_face_observation(image)
    if observation is None:
        raise HTTPException(status_code=422, detail=_detect_message(label, face_service.last_strict_failure()))
    return observation


def _detect_message(label: str, failure: StrictFaceFailure | None) -> str:
    """Say which of the face-detection conditions failed (plain Thai; numbers in test mode)."""

    code = failure.code if failure else "detect_unknown"
    scores = "/".join(f"{score:.2f}" for score in (failure.scores if failure else ())) or "-"
    if code == "detect_none":
        text = f"{label} ไม่พบใบหน้าในภาพ ให้ใบหน้าอยู่กลางกรอบ {CLEAR_FACE_ADVICE}"
        numbers = (f"ใบหน้าที่คะแนน ≥{STRICT_FACE_MIN_SCORE:.2f}: 0",)
    elif code == "detect_multi":
        text = f"{label} พบใบหน้ามากกว่า 1 ใบในภาพ กรุณาให้มีเฉพาะใบหน้าของคุณ ไม่มีรูปหรือคนอื่นอยู่ในกรอบ"
        numbers = (f"จำนวนใบหน้า {failure.face_count} (ต้อง 1)", f"คะแนน {scores}")
    elif code == "detect_low_score":
        text = f"{label} ใบหน้าไม่ชัดเจนพอ (เบลอหรือแสงไม่พอ) กรุณาถือโทรศัพท์ให้นิ่งและอยู่ในที่สว่าง {CLEAR_FACE_ADVICE}"
        numbers = (f"คะแนนใบหน้า {scores} (เกณฑ์ ≥{STRICT_FACE_SINGLE_SCORE:.2f})",)
    elif code == "detect_landmarks":
        text = f"{label} อ่านตำแหน่งตาและปากไม่ได้ {CLEAR_FACE_ADVICE}"
        numbers = (f"คะแนนใบหน้า {scores}",)
    else:
        code = "detect_unknown"
        text = f"{label}ต้องพบใบหน้าชัดเจนเพียง 1 คน {CLEAR_FACE_ADVICE}"
        numbers = ()
    return text + diagnostic(code, *numbers)


def _same_person(reference: FaceObservation, candidate: FaceObservation, *, blink: bool = False) -> None:
    threshold = BLINK_FRAME_IDENTITY_THRESHOLD if blink else LIVENESS_FRAME_IDENTITY_THRESHOLD
    similarity = face_service.calculate_similarity(reference.embedding, candidate.embedding)
    attempt_diagnostics.append("frame_similarity", attempt_diagnostics.number(similarity, 3))
    if similarity < threshold:
        raise HTTPException(
            status_code=422,
            detail="พบการสลับบุคคลหรือภาพหลักฐานไม่ต่อเนื่องระหว่างทำ liveness"
            + diagnostic("same_person", f"ความเหมือนระหว่างเฟรม {similarity:.2f} (เกณฑ์ ≥{threshold:.2f})"),
        )


FRAMING_PREFIX = "โปรดมองตรงและให้ใบหน้าอยู่ในกรอบตลอดการสแกน"
RECOVERY_PREFIX = "ภาพหลังทำคำสั่งต้องกลับมามองตรงและอยู่ในกรอบเดิม"
STRICT_FACE_MIN_SCORE = 0.50
STRICT_FACE_SINGLE_SCORE = 0.55
FACE_WIDTH_MIN = 0.17
FACE_WIDTH_MAX = 0.84
FRAME_CENTER_MAX = 0.30
FRAME_YAW_MAX = 0.14
FRAME_PITCH_MAX = 0.18
FRAME_ROLL_MAX = 0.18
MOVE_CLOSER_SCALE_MIN = 1.08
MOVE_CLOSER_SCALE_MAX = 1.70
MOVE_CLOSER_YAW_MAX = 0.15
MOVE_CLOSER_PITCH_MAX = 0.20


@dataclass(frozen=True)
class FramingProblem:
    code: str          # framing_* code, also used as the failure stage in test mode
    text: str          # plain Thai explanation of the one condition that failed
    measured: str      # numbers for test mode


def _first_frame_problem(reference: FaceObservation) -> str | None:
    if not reference.face_width_ratio >= FACE_WIDTH_MIN:
        problem = FramingProblem(
            "framing_small", "ใบหน้าเล็กเกินไป กรุณาขยับเข้าใกล้กล้องอีกเล็กน้อย",
            "ขนาดหน้า " + limit(reference.face_width_ratio, FACE_WIDTH_MIN, FACE_WIDTH_MAX),
        )
    elif not reference.face_width_ratio <= FACE_WIDTH_MAX:
        problem = FramingProblem(
            "framing_large", "ใบหน้าใหญ่เกินไป กรุณาถอยห่างจากกล้องเล็กน้อย",
            "ขนาดหน้า " + limit(reference.face_width_ratio, FACE_WIDTH_MIN, FACE_WIDTH_MAX),
        )
    elif not reference.center_offset <= FRAME_CENTER_MAX:
        problem = FramingProblem(
            "framing_center", "ใบหน้าอยู่ห่างจากกลางกรอบมากเกินไป",
            "ห่างกลางกรอบ " + limit(reference.center_offset, high=FRAME_CENTER_MAX),
        )
    else:
        return None
    return _framing_message(problem, FRAMING_PREFIX, "เฟรม 1")


def _frontal_problem(
    reference: FaceObservation, candidate: FaceObservation, *, scale_tolerance: float
) -> FramingProblem | None:
    """Return the first condition that keeps `candidate` from matching the reference pose, or None."""

    yaw = candidate.yaw_proxy - reference.yaw_proxy
    pitch = candidate.pitch_proxy - reference.pitch_proxy
    roll = candidate.roll_proxy - reference.roll_proxy
    scale = candidate.face_width_ratio / max(reference.face_width_ratio, 0.001) - 1
    if not abs(yaw) <= FRAME_YAW_MAX:
        return FramingProblem(
            "framing_yaw", "ศีรษะหันไปด้านข้างระหว่างสแกน กรุณามองตรงที่กล้องตลอดเวลา",
            "หัน(yaw) " + limit(yaw, high=FRAME_YAW_MAX, signed=True).replace("เกณฑ์ ≤", "เกณฑ์ ±"),
        )
    if not abs(pitch) <= FRAME_PITCH_MAX:
        return FramingProblem(
            "framing_pitch", "ศีรษะก้มหรือเงยระหว่างสแกน กรุณาถือโทรศัพท์ให้ระดับสายตา",
            "ก้มเงย(pitch) " + limit(pitch, high=FRAME_PITCH_MAX, signed=True).replace("เกณฑ์ ≤", "เกณฑ์ ±"),
        )
    if not abs(roll) <= FRAME_ROLL_MAX:
        return FramingProblem(
            "framing_roll", "ศีรษะหรือโทรศัพท์เอียงระหว่างสแกน กรุณาถือให้ตรง",
            "เอียง(roll) " + limit(roll, high=FRAME_ROLL_MAX, signed=True).replace("เกณฑ์ ≤", "เกณฑ์ ±"),
        )
    if not abs(scale) <= scale_tolerance:
        return FramingProblem(
            "framing_scale", "ระยะห่างจากกล้องเปลี่ยนระหว่างสแกน กรุณาถือโทรศัพท์ให้นิ่ง",
            "ขนาดหน้าเปลี่ยน " + limit(scale, high=scale_tolerance, signed=True).replace("เกณฑ์ ≤", "เกณฑ์ ±"),
        )
    if not candidate.center_offset <= FRAME_CENTER_MAX:
        return FramingProblem(
            "framing_center", "ใบหน้าเลื่อนออกจากกลางกรอบ",
            "ห่างกลางกรอบ " + limit(candidate.center_offset, high=FRAME_CENTER_MAX),
        )
    return None


def _framing_message(problem: FramingProblem, prefix: str, where: str) -> str:
    code = problem.code if prefix == FRAMING_PREFIX else problem.code.replace("framing_", "recovery_")
    return f"{prefix} ({problem.text})" + diagnostic(code, where, problem.measured)


def _move_closer_problem(
    reference: FaceObservation, action: FaceObservation, scale_ratio: float
) -> str | None:
    prefix = "คำสั่งขยับเข้าใกล้ไม่ผ่าน"
    yaw = action.yaw_proxy - reference.yaw_proxy
    pitch = action.pitch_proxy - reference.pitch_proxy
    scale_text = "ขนาดหน้าเทียบเฟรมแรก " + limit(scale_ratio, MOVE_CLOSER_SCALE_MIN, MOVE_CLOSER_SCALE_MAX)
    # Every limit is written as "pass only if inside", so a NaN fails closed.
    if not (math.isfinite(scale_ratio) and scale_ratio >= MOVE_CLOSER_SCALE_MIN):
        return f"{prefix} ใบหน้าขยับเข้าใกล้ไม่มากพอ กรุณาเคลื่อนใบหน้าเข้าใกล้กล้องอีกเล็กน้อยโดยมองตรง" + diagnostic("move_closer_small", scale_text)
    if not scale_ratio <= MOVE_CLOSER_SCALE_MAX:
        return f"{prefix} ใบหน้าเข้าใกล้กล้องมากเกินไป กรุณาขยับเข้าใกล้เพียงเล็กน้อย" + diagnostic("move_closer_large", scale_text)
    if not action.center_offset <= FRAME_CENTER_MAX:
        return f"{prefix} ใบหน้าเลื่อนออกจากกลางกรอบขณะขยับ" + diagnostic(
            "move_closer_center", "ห่างกลางกรอบ " + limit(action.center_offset, high=FRAME_CENTER_MAX)
        )
    if not abs(yaw) <= MOVE_CLOSER_YAW_MAX:
        return f"{prefix} ศีรษะหันไปด้านข้างขณะขยับ กรุณามองตรงที่กล้อง" + diagnostic(
            "move_closer_yaw", "หัน(yaw) " + limit(yaw, high=MOVE_CLOSER_YAW_MAX, signed=True).replace("เกณฑ์ ≤", "เกณฑ์ ±")
        )
    if not abs(pitch) <= MOVE_CLOSER_PITCH_MAX:
        return f"{prefix} ศีรษะก้มหรือเงยขณะขยับ กรุณาถือโทรศัพท์ให้ระดับสายตา" + diagnostic(
            "move_closer_pitch", "ก้มเงย(pitch) " + limit(pitch, high=MOVE_CLOSER_PITCH_MAX, signed=True).replace("เกณฑ์ ≤", "เกณฑ์ ±")
        )
    return None


def _frontal(reference: FaceObservation, candidate: FaceObservation, *, scale_tolerance: float) -> bool:
    return _frontal_problem(reference, candidate, scale_tolerance=scale_tolerance) is None


def verify_liveness_frames(
    baseline_image: np.ndarray,
    near_image: np.ndarray,
    returned_image: np.ndarray,
    blink_closed_images: Sequence[np.ndarray],
    blink_open_images: Sequence[np.ndarray],
    final_image: np.ndarray,
    required_blinks: int,
) -> VerifiedLivenessFrames:
    """Recompute movement, bilateral blinks, identity, and frame continuity.

    The images exist only in request memory. Nothing in this service writes them
    to disk, logs their contents, or persists them to Supabase.
    """

    if (
        required_blinks not in (1, 2)
        or len(blink_closed_images) != required_blinks
        or len(blink_open_images) != required_blinks
    ):
        raise HTTPException(status_code=422, detail="จำนวนภาพกระพริบตาไม่ตรงกับ challenge")

    baseline = _extract(baseline_image, "ภาพเริ่มต้น")
    near = _extract(near_image, "ภาพขณะเข้าใกล้กล้อง")
    returned = _extract(returned_image, "ภาพหลังกลับเข้ากรอบ")
    final = _extract(final_image, "ภาพยืนยันสุดท้าย")

    for observation in (near, returned, final):
        _same_person(baseline, observation)

    scale_ratio = near.face_width_ratio / max(baseline.face_width_ratio, 0.001)
    if (
        not 1.08 <= scale_ratio <= 1.85
        or near.center_offset > 0.30
        or abs(near.yaw_proxy - baseline.yaw_proxy) > 0.15
        or abs(near.pitch_proxy - baseline.pitch_proxy) > 0.20
    ):
        raise HTTPException(
            status_code=422,
            detail="หลักฐานการขยับใบหน้าเข้าใกล้กล้องไม่ผ่าน กรุณาเคลื่อนหน้าเข้าหากล้องโดยมองตรง",
        )
    if not _frontal(baseline, returned, scale_tolerance=0.17):
        raise HTTPException(status_code=422, detail="หลักฐานการกลับเข้ากรอบเดิมไม่ผ่าน")
    if not _frontal(baseline, final, scale_tolerance=0.20):
        raise HTTPException(status_code=422, detail="ภาพยืนยันสุดท้ายต้องมองตรงและอยู่ในกรอบเดิม")

    # Three stable, frontal samples are required to pass the local texture PAD.
    # Running this before blink-frame checks rejects common printed-photo and
    # screen-replay attempts without sending biometric media to a third party.
    passive_pad_service.assert_live(
        (baseline_image, returned_image, final_image),
        (baseline.bbox, returned.bbox, final.bbox),
    )

    if _frame_difference(baseline_image, near_image) < 1.5 or _frame_difference(near_image, returned_image) < 1.5:
        raise HTTPException(
            status_code=422,
            detail="ภาพการเคลื่อนไหวซ้ำหรือหยุดนิ่งผิดปกติ ไม่อนุญาตให้ใช้ภาพนิ่งแทนบุคคลจริง",
        )

    open_reference_left = (baseline.left_eye_aperture_proxy + returned.left_eye_aperture_proxy) / 2
    open_reference_right = (baseline.right_eye_aperture_proxy + returned.right_eye_aperture_proxy) / 2
    previous_open_image = returned_image
    for index, (closed_image, open_image) in enumerate(
        zip(blink_closed_images, blink_open_images, strict=True),
        start=1,
    ):
        closed = _extract(closed_image, f"ภาพหลับตาครั้งที่ {index}")
        reopened = _extract(open_image, f"ภาพลืมตาครั้งที่ {index}")
        _same_person(baseline, closed, blink=True)
        _same_person(baseline, reopened)

        left_closed_ratio = closed.left_eye_aperture_proxy / max(open_reference_left, 0.001)
        right_closed_ratio = closed.right_eye_aperture_proxy / max(open_reference_right, 0.001)
        left_open_ratio = reopened.left_eye_aperture_proxy / max(open_reference_left, 0.001)
        right_open_ratio = reopened.right_eye_aperture_proxy / max(open_reference_right, 0.001)
        # Written as "inside the limit" so that a NaN value fails closed.
        if not (
            left_closed_ratio <= 0.78
            and right_closed_ratio <= 0.78
            and left_open_ratio >= 0.78
            and right_open_ratio >= 0.78
            and abs(closed.yaw_proxy - baseline.yaw_proxy) <= 0.15
            and abs(closed.pitch_proxy - baseline.pitch_proxy) <= 0.20
            and _frontal(baseline, reopened, scale_tolerance=0.20)
        ):
            raise HTTPException(
                status_code=422,
                detail="หลักฐานการกระพริบตาไม่ผ่าน ต้องหลับและลืมตาทั้งสองข้างโดยไม่ผงกศีรษะ",
            )
        if (
            _frame_difference(previous_open_image, closed_image) < 0.8
            or _frame_difference(closed_image, open_image) < 0.8
        ):
            raise HTTPException(
                status_code=422,
                detail="เฟรมกระพริบตาซ้ำหรือไม่ต่อเนื่อง กรุณาใช้กล้องกับบุคคลจริง",
            )
        previous_open_image = open_image
        open_reference_left = (open_reference_left + reopened.left_eye_aperture_proxy) / 2
        open_reference_right = (open_reference_right + reopened.right_eye_aperture_proxy) / 2

    return VerifiedLivenessFrames(final_embedding=final.embedding)
