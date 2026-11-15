"""Lightweight local presentation-attack detection for frontal evidence frames."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path
import threading
from collections.abc import Sequence

import cv2
import numpy as np
import onnxruntime as ort
from fastapi import HTTPException

from core.config import (
    LIVENESS_PAD_CONCURRENCY,
    LIVENESS_PAD_MEDIAN_THRESHOLD,
    LIVENESS_PAD_MIN_FRAME_FLOOR,
    LIVENESS_PAD_RULE,
    LIVENESS_PAD_THRESHOLD,
)
from services import attempt_diagnostics
from services.failure_diagnostics import diagnostic


MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "minifas_v2_se_quantized.onnx"
MODEL_SHA256 = "fde20585635cae62ed1d41796f76b6f8bc4b92cd91ec1cf0f1bc6485d2d587a9"
MODEL_SIZE = 128
EXPANSION_FACTOR = 1.5

# Production failure text. The first phrase is the classifier marker (test_mode_service) and
# must stay. The rest tells a genuine user what usually fixes a low score.
PAD_FAILURE_MESSAGE = (
    "ตรวจพบความเสี่ยงจากภาพถ่ายหรือหน้าจอ กรุณาลองใหม่: หันหน้าเข้าหาแสงสว่าง "
    "(ไม่ให้แสงอยู่ด้านหลัง) ถือโทรศัพท์ระดับสายตาห่างประมาณ 30–40 ซม. และนิ่งไว้ระหว่างสแกน "
    "เช็ดเลนส์กล้องให้สะอาด และเปิดลิงก์ด้วย Chrome หรือ Safari ไม่ใช่เบราว์เซอร์ในแอปแชต"
)


def logit(probability: float) -> float:
    return math.log(probability / (1 - probability))


@dataclass(frozen=True)
class PadDecision:
    live: bool
    rule: str
    median_logit: float
    min_logit: float


def pad_decision(
    logit_differences: Sequence[float],
    *,
    rule: str | None = None,
    median_threshold: float | None = None,
    floor: float | None = None,
    all_frames_threshold: float | None = None,
) -> PadDecision:
    """Aggregate the per-frame live logits (live minus spoof) into one decision.

    Compared in logit space (sigmoid is monotone, so median-of-logits >= logit(t) is exactly
    median-of-probabilities >= t). Fail closed: anything but exactly 3 finite values is refused.
    "median": median >= logit(median_threshold) AND min >= logit(floor).
    "all_frames" (old rule, kill switch): min >= logit(all_frames_threshold).
    Unknown rules are refused.
    """

    rule = LIVENESS_PAD_RULE if rule is None else rule
    median_threshold = LIVENESS_PAD_MEDIAN_THRESHOLD if median_threshold is None else median_threshold
    floor = LIVENESS_PAD_MIN_FRAME_FLOOR if floor is None else floor
    all_frames_threshold = LIVENESS_PAD_THRESHOLD if all_frames_threshold is None else all_frames_threshold
    values = [float(value) for value in logit_differences]
    if len(values) != 3 or not all(math.isfinite(value) for value in values):
        return PadDecision(False, rule, math.nan, math.nan)
    median_logit = float(np.median(values))
    min_logit = min(values)
    if rule == "median":
        live = median_logit >= logit(median_threshold) and min_logit >= logit(floor)
    elif rule == "all_frames":
        live = min_logit >= logit(all_frames_threshold)
    else:
        live = False
    return PadDecision(bool(live), rule, median_logit, min_logit)


def _rule_text(rule: str) -> str:
    if rule == "median":
        return (
            f"กฎ median: ค่ากลาง ≥{LIVENESS_PAD_MEDIAN_THRESHOLD:.2f}"
            f" และต่ำสุด ≥{LIVENESS_PAD_MIN_FRAME_FLOOR:.2f}"
        )
    return f"กฎ all_frames: เกณฑ์ ≥{LIVENESS_PAD_THRESHOLD:.2f} ทุกเฟรม"


def _validate_model() -> None:
    if not MODEL_PATH.is_file():
        raise RuntimeError("Passive PAD model is missing")
    digest = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
    if digest != MODEL_SHA256:
        raise RuntimeError("Passive PAD model checksum does not match the pinned artifact")


def _crop_face(image_bgr: np.ndarray, bbox: tuple[float, float, float, float]) -> np.ndarray:
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    height, width = image_rgb.shape[:2]
    x1, y1, x2, y2 = bbox
    face_width = x2 - x1
    face_height = y2 - y1
    if face_width < 64 or face_height < 64:
        raise HTTPException(
            status_code=422,
            detail="ใบหน้ามีขนาดเล็กเกินไปสำหรับตรวจภาพปลอม กรุณาขยับเข้าใกล้กล้อง"
            + diagnostic("pad_size", f"กรอบหน้า {face_width:.0f}×{face_height:.0f} พิกเซล (เกณฑ์ ≥64×64)"),
        )
    crop_size = int(max(face_width, face_height) * EXPANSION_FACTOR)
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    crop_x1 = int(center_x - crop_size / 2)
    crop_y1 = int(center_y - crop_size / 2)
    crop_x2 = crop_x1 + crop_size
    crop_y2 = crop_y1 + crop_size

    source_x1 = max(0, crop_x1)
    source_y1 = max(0, crop_y1)
    source_x2 = min(width, crop_x2)
    source_y2 = min(height, crop_y2)
    crop = image_rgb[source_y1:source_y2, source_x1:source_x2]
    if crop.size == 0:
        raise HTTPException(
            status_code=422,
            detail="ไม่สามารถตัดบริเวณใบหน้าสำหรับตรวจภาพปลอมได้" + diagnostic("pad_crop"),
        )
    crop = cv2.copyMakeBorder(
        crop,
        max(0, -crop_y1),
        max(0, crop_y2 - height),
        max(0, -crop_x1),
        max(0, crop_x2 - width),
        cv2.BORDER_REFLECT_101,
    )
    interpolation = cv2.INTER_AREA if crop.shape[0] > MODEL_SIZE else cv2.INTER_LANCZOS4
    resized = cv2.resize(crop, (MODEL_SIZE, MODEL_SIZE), interpolation=interpolation)
    return resized.transpose(2, 0, 1).astype(np.float32) / 255.0


class PassivePadService:
    def __init__(self) -> None:
        _validate_model()
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self._session = ort.InferenceSession(
            str(MODEL_PATH),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self._input_name = self._session.get_inputs()[0].name
        self._slots = threading.BoundedSemaphore(LIVENESS_PAD_CONCURRENCY)

    def assert_live(
        self,
        images: Sequence[np.ndarray],
        bboxes: Sequence[tuple[float, float, float, float]],
    ) -> None:
        if len(images) != 3 or len(bboxes) != 3:
            raise HTTPException(
                status_code=422,
                detail="หลักฐานตรวจภาพปลอมต้องมี 3 เฟรม"
                + diagnostic("pad_count", f"ได้ {len(images)} ภาพ/{len(bboxes)} กรอบ (ต้อง 3)"),
            )
        batch = np.stack([
            _crop_face(image, bbox)
            for image, bbox in zip(images, bboxes, strict=True)
        ])
        with self._slots:
            logits = self._session.run([], {self._input_name: batch})[0]
        if logits.shape != (3, 2):
            raise RuntimeError("Passive PAD model returned an unexpected result")
        logit_differences = logits[:, 0] - logits[:, 1]
        live_probability = 1.0 / (1.0 + np.exp(-np.clip(logit_differences, -30, 30)))
        decision = pad_decision(logit_differences)
        _record_pad(logit_differences, live_probability, decision)
        if not decision.live:
            raise HTTPException(
                status_code=422,
                detail=PAD_FAILURE_MESSAGE
                + diagnostic(
                    "pad",
                    "คะแนนคนจริงต่อเฟรม " + "/".join(f"{value:.2f}" for value in live_probability),
                    f"ค่ากลาง {float(np.median(live_probability)):.2f} ต่ำสุด {float(np.min(live_probability)):.2f}",
                    f"({_rule_text(decision.rule)})",
                ),
            )


def _record_pad(logit_differences: np.ndarray, live_probability: np.ndarray, decision: PadDecision) -> None:
    """Test mode only: keep the per-frame scores for the offline ROC study (numbers only)."""

    if attempt_diagnostics.current() is None:
        return
    number = attempt_diagnostics.number
    attempt_diagnostics.record("pad", {
        "live": [number(value) for value in live_probability],
        "logit": [number(value) for value in logit_differences],
        "min": number(np.min(live_probability)),
        "median": number(np.median(live_probability)),
        # "threshold" is the ACTIVE rule's main threshold (median rule: the median threshold);
        # the old rule's per-frame threshold is kept separately as "all_frames_threshold".
        "threshold": number(
            LIVENESS_PAD_MEDIAN_THRESHOLD if decision.rule == "median" else LIVENESS_PAD_THRESHOLD
        ),
        "all_frames_threshold": number(LIVENESS_PAD_THRESHOLD),
        "rule": decision.rule,
        "median_threshold": number(LIVENESS_PAD_MEDIAN_THRESHOLD),
        "floor": number(LIVENESS_PAD_MIN_FRAME_FLOOR),
        "passed": decision.live,
    })


passive_pad_service = PassivePadService()
