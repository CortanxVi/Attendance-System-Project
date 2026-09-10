"""Lightweight local presentation-attack detection for frontal evidence frames."""

from __future__ import annotations

import hashlib
import math
from pathlib import Path
import threading
from collections.abc import Sequence

import cv2
import numpy as np
import onnxruntime as ort
from fastapi import HTTPException

from core.config import LIVENESS_PAD_CONCURRENCY, LIVENESS_PAD_THRESHOLD


MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "minifas_v2_se_quantized.onnx"
MODEL_SHA256 = "fde20585635cae62ed1d41796f76b6f8bc4b92cd91ec1cf0f1bc6485d2d587a9"
MODEL_SIZE = 128
EXPANSION_FACTOR = 1.5


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
        raise HTTPException(status_code=422, detail="ใบหน้ามีขนาดเล็กเกินไปสำหรับตรวจภาพปลอม")
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
        raise HTTPException(status_code=422, detail="ไม่สามารถตัดบริเวณใบหน้าสำหรับตรวจภาพปลอมได้")
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
        self._logit_threshold = math.log(LIVENESS_PAD_THRESHOLD / (1 - LIVENESS_PAD_THRESHOLD))

    def assert_live(
        self,
        images: Sequence[np.ndarray],
        bboxes: Sequence[tuple[float, float, float, float]],
    ) -> None:
        if len(images) != 3 or len(bboxes) != 3:
            raise HTTPException(status_code=422, detail="หลักฐานตรวจภาพปลอมต้องมี 3 เฟรม")
        batch = np.stack([
            _crop_face(image, bbox)
            for image, bbox in zip(images, bboxes, strict=True)
        ])
        with self._slots:
            logits = self._session.run([], {self._input_name: batch})[0]
        if logits.shape != (3, 2):
            raise RuntimeError("Passive PAD model returned an unexpected result")
        logit_differences = logits[:, 0] - logits[:, 1]
        if not np.all(np.isfinite(logit_differences)) or np.any(logit_differences < self._logit_threshold):
            raise HTTPException(
                status_code=422,
                detail="ตรวจพบความเสี่ยงจากภาพถ่ายหรือหน้าจอ กรุณาใช้บุคคลจริงในที่สว่างและลองใหม่",
            )


passive_pad_service = PassivePadService()
