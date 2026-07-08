# Work perfectly fine added ระบบคัดกรองลงทะเบียนให้เข้มงวดขึ้น
import numpy as np
import cv2
from insightface.app import FaceAnalysis

class FaceService:
    # 🌟 [เพิ่มใหม่] ค่าคงที่สำหรับกรอง "หน้าปลอม" ออกก่อนนับจำนวนคนในภาพตอนลงทะเบียน
    # เหตุผล: ค่า det_thresh เริ่มต้นของโมเดล (0.5) ค่อนข้างต่ำ ทำให้บางครั้งจุดที่ไม่ใช่ใบหน้าจริง
    # (ลวดลายผ้า เงา วัตถุพื้นหลัง หรือคนที่อยู่ไกลๆ) หลุดเข้ามาถูกนับเป็น "หน้าคนที่ 2" ได้ ทั้งที่ในภาพ
    # มีผู้ลงทะเบียนอยู่จริงแค่คนเดียว การกรองก่อนนับช่วยลดปัญหานี้ โดยยังจับคนที่ 2 ที่ยืนอยู่ในเฟรม
    # จริงๆ ได้เหมือนเดิม
    MIN_DET_SCORE_FOR_COUNTING = 0.5       # คะแนนต่ำกว่านี้ ไม่นับว่าเป็น "หน้าคน" เลย
    MIN_RELATIVE_SIZE_FOR_COUNTING = 0.3   # ต้องมีพื้นที่อย่างน้อย 30% ของหน้าที่ใหญ่ที่สุดในภาพ ถึงจะนับ

    def __init__(self):
        print("👤 Loading InsightFace Model...")
        self.app = FaceAnalysis(name='buffalo_s', providers=['CPUExecutionProvider'])
        self.app.prepare(ctx_id=0, det_size=(640, 640))
        print("✅ InsightFace Model Loaded Successfully!")

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
            faces = self.app.get(image_bgr)
            if not faces:
                padded_img = self._add_padding(image_bgr)
                faces = self.app.get(padded_img)
                if not faces:
                    return None
            
            # ถ้าเจอหลายหน้า เอาหน้าที่ใหญ่ที่สุด
            if len(faces) > 1:
                faces = sorted(faces, key=lambda x: (x.bbox[2]-x.bbox[0]) * (x.bbox[3]-x.bbox[1]), reverse=True)
            return faces[0].normed_embedding
        except Exception as e:
            print(f"FaceExtraction Error: {str(e)}")
            return None

    def extract_face_for_registration(self, image_bgr: np.ndarray):
        """
        🎯 (ลงทะเบียน) เข้มงวดพิเศษ: ต้องเป็นหน้าตรง ชัดเจน และไม่มีสิ่งบดบังมากเกินไป
        """
        try:
            faces = self.app.get(image_bgr)
            if len(faces) == 0:
                padded_img = self._add_padding(image_bgr)
                faces = self.app.get(padded_img)
            
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