"""Backend recomputation for protocol-v2 transient liveness frames."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Sequence

import cv2
import numpy as np
from fastapi import HTTPException

from services.insightface_service import FaceObservation, face_service
from services.passive_pad_service import passive_pad_service


LIVENESS_FRAME_IDENTITY_THRESHOLD = 0.35
BLINK_FRAME_IDENTITY_THRESHOLD = 0.30


@dataclass(frozen=True)
class VerifiedLivenessFrames:
    final_embedding: np.ndarray


def _frame_difference(first: np.ndarray, second: np.ndarray) -> float:
    first_gray = cv2.resize(cv2.cvtColor(first, cv2.COLOR_BGR2GRAY), (160, 120))
    second_gray = cv2.resize(cv2.cvtColor(second, cv2.COLOR_BGR2GRAY), (160, 120))
    return float(np.mean(cv2.absdiff(first_gray, second_gray)))


def _extract(image: np.ndarray, label: str) -> FaceObservation:
    observation = face_service.extract_strict_face_observation(image)
    if observation is None:
        raise HTTPException(
            status_code=422,
            detail=f"{label}ต้องพบใบหน้าชัดเจนเพียง 1 คน",
        )
    return observation


def _same_person(reference: FaceObservation, candidate: FaceObservation, *, blink: bool = False) -> None:
    threshold = BLINK_FRAME_IDENTITY_THRESHOLD if blink else LIVENESS_FRAME_IDENTITY_THRESHOLD
    if face_service.calculate_similarity(reference.embedding, candidate.embedding) < threshold:
        raise HTTPException(
            status_code=422,
            detail="พบการสลับบุคคลหรือภาพหลักฐานไม่ต่อเนื่องระหว่างทำ liveness",
        )


def _frontal(reference: FaceObservation, candidate: FaceObservation, *, scale_tolerance: float) -> bool:
    return (
        abs(candidate.yaw_proxy - reference.yaw_proxy) <= 0.14
        and abs(candidate.pitch_proxy - reference.pitch_proxy) <= 0.18
        and abs(candidate.roll_proxy - reference.roll_proxy) <= 0.18
        and abs(candidate.face_width_ratio / max(reference.face_width_ratio, 0.001) - 1) <= scale_tolerance
        and candidate.center_offset <= 0.30
    )


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
        if (
            left_closed_ratio > 0.78
            or right_closed_ratio > 0.78
            or left_open_ratio < 0.78
            or right_open_ratio < 0.78
            or abs(closed.yaw_proxy - baseline.yaw_proxy) > 0.15
            or abs(closed.pitch_proxy - baseline.pitch_proxy) > 0.20
            or not _frontal(baseline, reopened, scale_tolerance=0.20)
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
