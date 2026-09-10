from dataclasses import dataclass
import os
from pathlib import Path
import threading

import numpy as np
import cv2
from insightface.app import FaceAnalysis


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
        print("InsightFace Model Loaded Successfully!")

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
        if left_eye_aperture <= 0 or right_eye_aperture <= 0 or image_width <= 0:
            return None
        x1, _y1, x2, _y2 = (float(value) for value in face.bbox)
        face_width_ratio = max(0.0, x2 - x1) / image_width
        center_offset = abs(((x1 + x2) / 2.0) / image_width - 0.5)
        return FaceObservation(
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

    def extract_strict_face_observation(self, image_bgr: np.ndarray) -> FaceObservation | None:
        """Return one high-confidence face with geometry for server liveness checks."""

        try:
            # Liveness fails closed on every confidently detected second face.
            # Unlike enrollment, a small background face cannot be ignored here.
            faces = [face for face in self._detect_faces(image_bgr) if float(face.det_score) >= 0.50]
            # Webcam bridges and phone cameras can lose a little confidence to
            # compression. Keep the multi-face fail-closed rule, but tolerate
            # a modest score reduction for the single intended face.
            if len(faces) != 1 or float(faces[0].det_score) < 0.55:
                return None
            return self._observation_from_face(faces[0], image_bgr.shape[1])
        except Exception as exc:
            print(f"FaceObservation Error: {type(exc).__name__}")
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
                return None, "ไม่พบใบหน้า กรุณาถ่ายในที่สว่าง ถอดแว่นตาและหน้ากากอนามัย"

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
                return None, "ภาพใบหน้าไม่ชัดเจน หรือมีสิ่งบดบัง กรุณาถอดแว่น/หน้ากาก แล้วถ่ายใหม่ให้เห็นหน้าเต็มๆ"
                
            return target_face.normed_embedding.tolist(), None
            
        except Exception as e:
            return None, f"เกิดข้อผิดพลาดในการประมวลผลใบหน้า: {str(e)}"

    def calculate_similarity(self, emb_live: np.ndarray, emb_db: np.ndarray) -> float:
        if emb_live is None or emb_db is None:
            return 0.0
        return float(np.dot(emb_live, emb_db))

face_service = FaceService()
