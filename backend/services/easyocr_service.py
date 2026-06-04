import easyocr
import numpy as np
import re

class OCRService:
    def __init__(self):
        print("🚀 Loading EasyOCR Model...")
        # กำหนด gpu=False เพื่อให้ทำงานบน CPU ได้อย่างเสถียร
        self.reader = easyocr.Reader(['en', 'th'], gpu=False)
        print("✅ EasyOCR Model Loaded Successfully!")

    def extract_student_id(self, image_bgr: np.ndarray) -> str | None:
        """
        ฟังก์ชันสำหรับอ่านรหัสนักศึกษา 13 หลักจากภาพบัตร
        รับค่า: รูปภาพในรูปแบบ Numpy Array (BGR จาก OpenCV)
        คืนค่า: รหัสนักศึกษา 13 หลัก (String) หรือ None หากหาไม่เจอ
        """
        try:
            # 1. ให้ EasyOCR สแกนหาข้อความทั้งหมดในรูป
            results = self.reader.readtext(image_bgr)
            
            # 2. นำข้อความที่อ่านได้ทั้งหมดมาเรียงต่อกันเป็นประโยคเดียว
            all_text = " ".join([text for (bbox, text, prob) in results])
            
            # 3. ล้างข้อมูล: ลบช่องว่างและเครื่องหมายขีด (-) ออก
            clean_text = all_text.replace(" ", "").replace("-", "")
            
            # 4. ใช้ Regex ค้นหาตัวเลขที่เรียงติดกัน 13 ตัว
            match = re.search(r'\d{13}', clean_text)
            
            if match:
                return match.group(0) # คืนค่ารหัสที่เจอ
            
            return None # กรณีหาเลข 13 หลักไม่เจอ
            
        except Exception as e:
            print(f"OCR Error: {str(e)}")
            return None

# สร้าง Instance รอไว้ให้ main.py เรียกใช้งาน
ocr_service = OCRService()