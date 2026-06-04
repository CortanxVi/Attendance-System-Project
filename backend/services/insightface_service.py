# Work perfectly fine added ระบบคัดกรองลงทะเบียนให้เข้มงวดขึ้น
import numpy as np
import cv2
from insightface.app import FaceAnalysis

class FaceService:
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
            if len(faces) > 1:
                return None, "พบใบหน้ามากกว่า 1 คน กรุณาถ่ายรูปเดี่ยว"
            
            target_face = faces[0]
            
            # เพิ่มการเช็ค Confidence Score (det_score) ของ AI
            # ยิ่งสูงแปลว่าเห็นโครงหน้าชัดเจน ถ้าใส่หน้ากากอนามัยคะแนนมักจะตกไปอยู่ต่ำกว่า 0.6
            if target_face.det_score < 0.80:
                return None, "ภาพใบหน้าไม่ชัดเจน หรือมีสิ่งบดบัง กรุณาถอดแว่น/หน้ากาก แล้วถ่ายใหม่ให้เห็นหน้าเต็มๆ"
                
            return target_face.normed_embedding.tolist(), None
            
        except Exception as e:
            return None, f"เกิดข้อผิดพลาดในการประมวลผลใบหน้า: {str(e)}"

    def calculate_similarity(self, emb_live: np.ndarray, emb_db: np.ndarray) -> float:
        if emb_live is None or emb_db is None:
            return 0.0
        return float(np.dot(emb_live, emb_db))

face_service = FaceService()