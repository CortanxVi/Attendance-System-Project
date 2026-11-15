from dataclasses import dataclass, replace
import hashlib
import logging
import math
import os
from pathlib import Path
import threading
import time

import numpy as np
import cv2
from insightface.app import FaceAnalysis

from core.config import APP_ENV, LIVENESS_BLINK_106_ENABLED

logger = logging.getLogger(__name__)

# Second eye-closure measure from the 2d106det landmark model (buffalo_s/2d106det.onnx, pinned in
# backend/models/insightface-buffalo-s.sha256). It feeds the second blink rule
# (liveness_frame_service.BLINK_106_*) for every course and for face enrollment, and in test mode
# it is also recorded for the threshold study. It runs only while LIVENESS_BLINK_106_ENABLED is on
# (default) and only for blink frames (extract_strict_face_observation(with_106=True)). It is
# loaded lazily on first use, checked against the pinned SHA-256, run on CPU inside the shared
# inference semaphore, and when the file is missing or wrong it is skipped with ONE warning: the
# 68-point rule then decides alone and no scan fails because of it. Production preflight and
# scripts/verify_face_models.sh require the file, so a missing copy is caught at deploy time.
# A failed load (missing file, wrong checksum, unreadable through a bind mount, a file still being
# copied, a transient onnxruntime error) is retried after this many seconds instead of being
# remembered for the life of the process.
LANDMARK_106_RETRY_SECONDS = 300.0
LANDMARK_106_FILE = "2d106det.onnx"
LANDMARK_106_SHA256 = "f001b856447c413801ef5c42091ed0cd516fcd21f2d6b79635b1e733a7109dbf"
# Index groups verified against the model output (image-left eye = keypoint 0 = the same eye as
# the 68-point "left" 36-41; it stays image-left on a mirrored image, i.e. it is positional):
# corners (outer/inner along x) and three upper/lower lid pairs.
EYE_106_LEFT = ((35, 39), ((41, 36), (40, 33), (42, 37)))
EYE_106_RIGHT = ((89, 93), ((95, 90), (94, 87), (96, 91)))


def eye_aperture_106(landmarks: np.ndarray, eye: tuple) -> float | None:
    """Mean lid gap / corner distance for one eye of a (106, 2) landmark array, or None."""

    (corner_a, corner_b), pairs = eye
    horizontal = float(np.linalg.norm(landmarks[corner_a] - landmarks[corner_b]))
    if not np.isfinite(horizontal) or horizontal < 1.0:
        return None
    vertical = float(np.mean([np.linalg.norm(landmarks[upper] - landmarks[lower]) for upper, lower in pairs]))
    value = vertical / horizontal
    return value if np.isfinite(value) else None


@dataclass(frozen=True)
class StrictFaceFailure:
    """Why `extract_strict_face_observation` returned nothing (numbers only, no image data)."""

    code: str            # detect_none | detect_multi | detect_low_score | detect_landmarks | detect_error
    face_count: int = 0
    scores: tuple[float, ...] = ()


@dataclass(frozen=True)
class FaceObservation:
    embedding: np.ndarray
    yaw_proxy: float
    pitch_proxy: float
    roll_proxy: float
    detection_score: float
    left_eye_aperture_proxy: float
    right_eye_aperture_proxy: float
    face_width_ratio: float
    center_offset: float
    bbox: tuple[float, float, float, float]
    # 2d106det eye apertures (blink frames only); None when the rule is off or the model is missing.
    left_eye_aperture_106: float | None = None
    right_eye_aperture_106: float | None = None

    @property
    def eye_aperture_proxy(self) -> float:
        """Compatibility average for non-liveness callers."""

        return (self.left_eye_aperture_proxy + self.right_eye_aperture_proxy) / 2.0

class FaceService:
    # 🌟 [เพิ่มใหม่] ค่าคงที่สำหรับกรอง "หน้าปลอม" ออกก่อนนับจำนวนคนในภาพตอนลงทะเบียน
    # เหตุผล: ค่า det_thresh เริ่มต้นของโมเดล (0.5) ค่อนข้างต่ำ ทำให้บางครั้งจุดที่ไม่ใช่ใบหน้าจริง
    # (ลวดลายผ้า เงา วัตถุพื้นหลัง หรือคนที่อยู่ไกลๆ) หลุดเข้ามาถูกนับเป็น "หน้าคนที่ 2" ได้ ทั้งที่ในภาพ
    # มีผู้ลงทะเบียนอยู่จริงแค่คนเดียว การกรองก่อนนับช่วยลดปัญหานี้ โดยยังจับคนที่ 2 ที่ยืนอยู่ในเฟรม
    # จริงๆ ได้เหมือนเดิม
    MIN_DET_SCORE_FOR_COUNTING = 0.5       # คะแนนต่ำกว่านี้ ไม่นับว่าเป็น "หน้าคน" เลย
    MIN_RELATIVE_SIZE_FOR_COUNTING = 0.3   # ต้องมีพื้นที่อย่างน้อย 30% ของหน้าที่ใหญ่ที่สุดในภาพ ถึงจะนับ

    def __init__(self):
        print("Loading InsightFace Model...")
        model_root = Path(
            os.getenv("INSIGHTFACE_MODEL_ROOT", "~/.insightface")
        ).expanduser().resolve()
        self.app = FaceAnalysis(
            name='buffalo_s',
            root=str(model_root),
            allowed_modules=['detection', 'recognition', 'landmark_3d_68'],
            providers=['CPUExecutionProvider'],
        )
        self.app.prepare(ctx_id=0, det_size=(640, 640))
        inference_concurrency = max(1, min(int(os.getenv("FACE_INFERENCE_CONCURRENCY", "2")), 4))
        self._inference_slots = threading.BoundedSemaphore(inference_concurrency)
        # The reason of the last strict-extraction failure, kept per thread so that the caller
        # (which runs in the same worker thread) can explain the rejection without a second inference.
        self._strict_state = threading.local()
        self._model_root = model_root
        self._landmark_106 = None          # loaded on first blink scan (when the rule is enabled)
        self._landmark_106_unavailable = False
        self._landmark_106_failed_at = 0.0  # time.monotonic() of the last failed load
        self._landmark_106_lock = threading.Lock()
        print("InsightFace Model Loaded Successfully!")

    def _landmark_106_retry_due(self) -> bool:
        return time.monotonic() - self._landmark_106_failed_at >= LANDMARK_106_RETRY_SECONDS

    def _landmark_106_model(self):
        """Load the 2d106det model; None (one log line per failed attempt) when it cannot be used.

        A failure is retried after LANDMARK_106_RETRY_SECONDS. Each failed attempt logs once: an
        ERROR in production (the release checks should have caught it), a WARNING elsewhere.
        """

        if self._landmark_106 is not None:
            return self._landmark_106
        if self._landmark_106_unavailable and not self._landmark_106_retry_due():
            return None
        with self._landmark_106_lock:
            if self._landmark_106 is not None:
                return self._landmark_106
            if self._landmark_106_unavailable and not self._landmark_106_retry_due():
                return None
            path = self._model_root / "models" / "buffalo_s" / LANDMARK_106_FILE
            try:
                if not path.is_file():
                    raise FileNotFoundError("model file is missing")
                # The file is hashed, then loaded again by path. This hash-then-load window (TOCTOU)
                # is the same trust level as the other buffalo_s models, which FaceAnalysis loads from
                # the same read-only model directory after scripts/verify_face_models.sh hashed them.
                if hashlib.sha256(path.read_bytes()).hexdigest() != LANDMARK_106_SHA256:
                    raise ValueError("model checksum does not match the pinned value")
                from insightface.model_zoo import get_model

                model = get_model(str(path), providers=["CPUExecutionProvider"])
                model.prepare(ctx_id=0)
                self._landmark_106 = model
                self._landmark_106_unavailable = False
            except Exception as exc:  # noqa: BLE001 - fall back to the 68-point rule
                self._landmark_106_unavailable = True
                self._landmark_106_failed_at = time.monotonic()
                logger.log(
                    logging.ERROR if APP_ENV == "production" else logging.WARNING,
                    "2d106det eye measure is unavailable; the blink check uses the 68-point rule only "
                    "(retry in %.0f s) (%s: %s)",
                    LANDMARK_106_RETRY_SECONDS, type(exc).__name__, exc,
                )
        return self._landmark_106

    def preload_landmark_106(self) -> str:
        """Eager load at startup when the rule is enabled; never raises. Returns blink_106_status()."""

        if LIVENESS_BLINK_106_ENABLED:
            self._landmark_106_model()
        return self.blink_106_status()

    def blink_106_status(self) -> str:
        """"disabled" (kill switch off), "ready", "unavailable" (last load failed) or "not_loaded"."""

        if not LIVENESS_BLINK_106_ENABLED:
            return "disabled"
        if self._landmark_106 is not None:
            return "ready"
        if self._landmark_106_unavailable:
            return "unavailable"
        return "not_loaded"

    def _eye_apertures_106(self, image_bgr: np.ndarray, face) -> tuple[float, float] | None:
        """(left, right) 2d106det eye apertures, or None (rule off, model unavailable). Never raises."""

        if not LIVENESS_BLINK_106_ENABLED:
            return None
        model = self._landmark_106_model()
        if model is None:
            return None
        try:
            with self._inference_slots:
                landmarks = np.asarray(model.get(image_bgr, face), dtype=np.float32)
            if landmarks.shape != (106, 2):
                return None
            left = eye_aperture_106(landmarks, EYE_106_LEFT)
            right = eye_aperture_106(landmarks, EYE_106_RIGHT)
            if left is None or right is None or not (math.isfinite(left) and math.isfinite(right)):
                return None
            return left, right
        except Exception as exc:  # noqa: BLE001 - a diagnostic must never fail the scan
            logger.warning("2d106det eye measure failed for one frame (%s)", type(exc).__name__)
            return None

    def reset_strict_failure(self) -> None:
        self._strict_state.failure = None

    def last_strict_failure(self) -> StrictFaceFailure | None:
        return getattr(self._strict_state, "failure", None)

    def _detect_faces(self, image_bgr: np.ndarray) -> list:
        """Bound concurrent ONNX inference so bursts do not exhaust CPU/RAM."""

        with self._inference_slots:
            return self.app.get(image_bgr)

    def _add_padding(self, img: np.ndarray, pad_percent: float = 0.25) -> np.ndarray:
        h, w = img.shape[:2]
        pad_h = int(h * pad_percent)
        pad_w = int(w * pad_percent)
        return cv2.copyMakeBorder(img, pad_h, pad_h, pad_w, pad_w, cv2.BORDER_CONSTANT, value=[0, 0, 0])

    def _get_face_area(self, face) -> float:
        """คำนวณพื้นที่ (กว้าง x สูง) ของกรอบใบหน้า (bbox) ใช้เทียบขนาดระหว่างหน้าแต่ละหน้า"""
        x1, y1, x2, y2 = face.bbox
        return max(0.0, x2 - x1) * max(0.0, y2 - y1)

    def _filter_significant_faces(self, faces: list) -> list:
        """
        🌟 [เพิ่มใหม่] กรองหน้าที่ "ไม่น่าจะใช่คนจริง" ออกก่อนนำไปนับจำนวนคนในภาพ
        กติกา: หน้าที่จะถูกนับว่าเป็น "คนจริงในเฟรม" ต้องผ่านทั้งสองเงื่อนไข
          1. det_score (คะแนนความมั่นใจว่าเป็นใบหน้า) ไม่ต่ำกว่า MIN_DET_SCORE_FOR_COUNTING
          2. มีขนาดไม่เล็กกว่า MIN_RELATIVE_SIZE_FOR_COUNTING เท่าของหน้าที่ใหญ่ที่สุดในภาพ

        เหตุผลของเงื่อนไขที่ 2: หน้าที่เล็กกว่าหน้าหลักมากๆ มักเป็นคนไกลๆ ในพื้นหลัง (เช่น เดินผ่าน
        หลังกล้อง) หรือจุดที่ตรวจจับผิดพลาด ไม่ใช่ผู้ที่ตั้งใจเข้ามาถ่ายรูปในเฟรมเดียวกับผู้ลงทะเบียน
        """
        if len(faces) <= 1:
            return faces

        max_area = max(self._get_face_area(f) for f in faces)
        if max_area == 0:
            return faces  # กันหารด้วยศูนย์ในกรณีที่ผิดปกติมากๆ

        significant_faces = [
            f for f in faces
            if f.det_score >= self.MIN_DET_SCORE_FOR_COUNTING
            and (self._get_face_area(f) / max_area) >= self.MIN_RELATIVE_SIZE_FOR_COUNTING
        ]

        # กันเหตุการณ์กรองเข้มไปจนไม่เหลือหน้าเลย (ไม่ควรเกิดขึ้นจริง เพราะหน้าที่ใหญ่สุดจะผ่านเกณฑ์เสมอ)
        return significant_faces if significant_faces else faces

    def extract_face_embedding(self, image_bgr: np.ndarray) -> np.ndarray | None:
        """(ใช้งานจริง) สกัดเวกเตอร์ ยอมรับสภาพแสงและแว่นตาได้"""
        try:
            faces = self._detect_faces(image_bgr)
            if not faces:
                padded_img = self._add_padding(image_bgr)
                faces = self._detect_faces(padded_img)
                if not faces:
                    return None
            
            # ถ้าเจอหลายหน้า เอาหน้าที่ใหญ่ที่สุด
            if len(faces) > 1:
                faces = sorted(faces, key=lambda x: (x.bbox[2]-x.bbox[0]) * (x.bbox[3]-x.bbox[1]), reverse=True)
            return faces[0].normed_embedding
        except Exception as e:
            print(f"FaceExtraction Error: {str(e)}")
            return None

    @staticmethod
    def _observation_from_face(face, image_width: int) -> FaceObservation | None:
        keypoints = np.asarray(getattr(face, "kps", None), dtype=np.float32)
        if keypoints.shape != (5, 2):
            return None
        left_eye, right_eye, nose, left_mouth, right_mouth = keypoints
        eye_mid = (left_eye + right_eye) / 2.0
        mouth_mid = (left_mouth + right_mouth) / 2.0
        eye_distance = float(np.linalg.norm(right_eye - left_eye))
        vertical_distance = float(mouth_mid[1] - eye_mid[1])
        if eye_distance < 1.0 or abs(vertical_distance) < 1.0:
            return None
        face_axis_mid = (eye_mid + mouth_mid) / 2.0
        dense_landmarks = np.asarray(getattr(face, "landmark_3d_68", None), dtype=np.float32)
        if dense_landmarks.shape != (68, 3):
            return None

        def eye_aspect_ratio(indices: tuple[int, int, int, int, int, int]) -> float:
            p1, p2, p3, p4, p5, p6 = (dense_landmarks[index, :2] for index in indices)
            horizontal = float(np.linalg.norm(p1 - p4))
            if horizontal < 1.0:
                return 0.0
            return float((np.linalg.norm(p2 - p6) + np.linalg.norm(p3 - p5)) / (2 * horizontal))

        left_eye_aperture = eye_aspect_ratio((36, 37, 38, 39, 40, 41))
        right_eye_aperture = eye_aspect_ratio((42, 43, 44, 45, 46, 47))
        # Fail closed: a NaN/inf aperture would make every later "value > limit" check False.
        if not (left_eye_aperture > 0 and right_eye_aperture > 0 and image_width > 0):
            return None
        x1, _y1, x2, _y2 = (float(value) for value in face.bbox)
        face_width_ratio = max(0.0, x2 - x1) / image_width
        center_offset = abs(((x1 + x2) / 2.0) / image_width - 0.5)
        observation = FaceObservation(
            embedding=np.asarray(face.normed_embedding, dtype=np.float32),
            yaw_proxy=float((nose[0] - face_axis_mid[0]) / eye_distance),
            pitch_proxy=float((nose[1] - eye_mid[1]) / vertical_distance),
            roll_proxy=float((right_eye[1] - left_eye[1]) / eye_distance),
            detection_score=float(face.det_score),
            left_eye_aperture_proxy=left_eye_aperture,
            right_eye_aperture_proxy=right_eye_aperture,
            face_width_ratio=face_width_ratio,
            center_offset=center_offset,
            bbox=(x1, float(face.bbox[1]), x2, float(face.bbox[3])),
        )
        numbers = (
            observation.yaw_proxy, observation.pitch_proxy, observation.roll_proxy,
            observation.detection_score, observation.left_eye_aperture_proxy,
            observation.right_eye_aperture_proxy, observation.face_width_ratio,
            observation.center_offset, *observation.bbox,
        )
        if not all(math.isfinite(value) for value in numbers):
            return None  # unreadable landmarks (treated like detect_landmarks)
        if not np.all(np.isfinite(observation.embedding)):
            return None
        return observation

    def extract_strict_face_observation(
        self, image_bgr: np.ndarray, *, with_106: bool = False
    ) -> FaceObservation | None:
        """Return one high-confidence face with geometry for server liveness checks."""

        self._strict_state.failure = None
        try:
            # Liveness fails closed on every confidently detected second face.
            # Unlike enrollment, a small background face cannot be ignored here.
            faces = [face for face in self._detect_faces(image_bgr) if float(face.det_score) >= 0.50]
            scores = tuple(sorted((round(float(face.det_score), 3) for face in faces), reverse=True)[:3])
            if not faces:
                self._strict_state.failure = StrictFaceFailure("detect_none")
                return None
            if len(faces) > 1:
                self._strict_state.failure = StrictFaceFailure("detect_multi", len(faces), scores)
                return None
            # Webcam bridges and phone cameras can lose a little confidence to
            # compression. Keep the multi-face fail-closed rule, but tolerate
            # a modest score reduction for the single intended face.
            if float(faces[0].det_score) < 0.55:
                self._strict_state.failure = StrictFaceFailure("detect_low_score", 1, scores)
                return None
            observation = self._observation_from_face(faces[0], image_bgr.shape[1])
            if observation is None:
                self._strict_state.failure = StrictFaceFailure("detect_landmarks", 1, scores)
                return None
            apertures_106 = self._eye_apertures_106(image_bgr, faces[0]) if with_106 else None
            if apertures_106 is not None:
                observation = replace(
                    observation,
                    left_eye_aperture_106=apertures_106[0],
                    right_eye_aperture_106=apertures_106[1],
                )
            return observation
        except Exception as exc:
            print(f"FaceObservation Error: {type(exc).__name__}")
            self._strict_state.failure = StrictFaceFailure("detect_error")
            return None

    def extract_face_for_registration(self, image_bgr: np.ndarray):
        """
        🎯 (ลงทะเบียน) เข้มงวดพิเศษ: ต้องเป็นหน้าตรง ชัดเจน และไม่มีสิ่งบดบังมากเกินไป
        """
        try:
            faces = self._detect_faces(image_bgr)
            if len(faces) == 0:
                padded_img = self._add_padding(image_bgr)
                faces = self._detect_faces(padded_img)
            
            if len(faces) == 0:
                return None, "ไม่พบใบหน้า กรุณาเปิดหน้าผากและเก็บผมที่ปิดคิ้วหรือตา ถ่ายในที่สว่าง ถอดแว่นตาและหน้ากากอนามัย"

            # 🌟 [แก้ไข] กรองหน้าปลอม/เล็กเกินไป (เช่น ลวดลายพื้นหลัง หรือคนไกลๆ) ออกก่อนตัดสินว่า
            # มีมากกว่า 1 คนในภาพ ดูรายละเอียดเหตุผลที่ _filter_significant_faces
            faces = self._filter_significant_faces(faces)

            if len(faces) > 1:
                return None, "พบใบหน้ามากกว่า 1 คน กรุณาถ่ายรูปเดี่ยว"
            
            # เลือกหน้าที่ใหญ่ที่สุดมาใช้งาน (เผื่อกรณีพิเศษที่กรองแล้วยังเหลือมากกว่า 1 หน้า)
            target_face = max(faces, key=self._get_face_area)
            
            # เพิ่มการเช็ค Confidence Score (det_score) ของ AI
            # 🌟 [แก้ไข] ปรับ threshold จาก 0.80 → 0.60
            # เดิมตั้งไว้ที่ 0.80 ซึ่งเข้มกว่าที่ตั้งใจจริง (comment เดิมบอกว่ามาสก์ทำให้คะแนนตกต่ำกว่า 0.6
            # แสดงว่า 0.6 คือจุดตัดที่ควรใช้อยู่แล้ว) ค่า 0.80 ทำให้ภาพที่ถ่ายมุมเงย/ก้มเล็กน้อย หรือแสง
            # ข้างเดียว (ซึ่งตาเปล่ามองว่าใช้งานได้ปกติ) ถูกปฏิเสธไปด้วย ยิ่งเมื่อรวมกับการแก้ EXIF
            # orientation ไปแล้ว ภาพที่มุมกล้องเอียงเล็กน้อยจะได้คะแนนใกล้เคียงปกติมากขึ้น จึงลด
            # threshold ลงมาที่ 0.60 ให้ตรงกับจุดที่ตั้งใจไว้แต่แรก
            if target_face.det_score < 0.60:
                return None, "ภาพใบหน้าไม่ชัดเจน หรือมีสิ่งบดบัง กรุณาเปิดหน้าผาก เก็บผมที่ปิดคิ้วหรือตา ถอดแว่น/หน้ากาก แล้วถ่ายใหม่ให้เห็นหน้าเต็มๆ"
                
            return target_face.normed_embedding.tolist(), None
            
        except Exception as e:
            return None, f"เกิดข้อผิดพลาดในการประมวลผลใบหน้า: {str(e)}"

    def calculate_similarity(self, emb_live: np.ndarray, emb_db: np.ndarray) -> float:
        if emb_live is None or emb_db is None:
            return 0.0
        return float(np.dot(emb_live, emb_db))

face_service = FaceService()
