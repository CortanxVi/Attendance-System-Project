import io
import os
import cv2
import numpy as np
import easyocr
from dotenv import load_dotenv

# โหลดตัวแปรจาก .env
load_dotenv()

# สร้าง Reader Instance ไว้ข้างนอกฟังก์ชัน (โหลดโมเดลแค่ครั้งเดียวตอน Start Server)
# ระบุภาษาที่ต้องการใช้อ่าน ['en'] เพื่อความรวดเร็วเพราะเอาแค่รหัสนักศึกษา (ตัวเลข)
# gpu=False และ quantize=True เพื่อรันบน CPU ให้เร็วที่สุด
print("กำลังโหลดโมเดล EasyOCR...")
reader = easyocr.Reader(['en'], gpu=False, verbose=False, quantize=True)
print("โหลดโมเดล EasyOCR สำเร็จ!")

def process_ocr(image_bytes: bytes) -> dict:
    """
    ฟังก์ชันสำหรับรับไบต์รูปภาพ แล้วทำ OCR ด้วย EasyOCR
    คืนค่าเป็น Dictionary {text, words}
    """
    try:
        # 1. แปลง image_bytes เป็น numpy array ภาพสำหรับ OpenCV (ไม่มีการย่อขนาดแล้ว เพื่อความแม่นยำสูงสุด)
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        # ส่ง numpy image ขนาดต้นฉบับไปให้ EasyOCR
        results = reader.readtext(img, rotation_info=[90, 270])
        
        words = []
        full_text_list = []
        
        vertical_words_count = 0
        valid_words_count = 0
        
        for bbox, text, prob in results:
            # ดึงค่าพิกัด x, y ของมุมทั้งหมด
            x_coords = [p[0] for p in bbox]
            y_coords = [p[1] for p in bbox]
            
            x = int(min(x_coords))
            y = int(min(y_coords))
            w = int(max(x_coords) - x)
            h = int(max(y_coords) - y)
            
            # ทำความสะอาดข้อความ ลบช่องว่างหน้า-หลัง
            clean_text = text.strip()
            
            # กรองเฉพาะคำที่มีค่าความมั่นใจ (Confidence) เกิน 0.1 และมีความยาว
            if prob > 0.1 and len(clean_text) > 0:
                valid_words_count += 1
                
                # เช็คว่ากล่องข้อความเป็นแนวตั้งหรือไม่ (ความสูง > ความกว้าง)
                if h > w:
                    vertical_words_count += 1
                    
                full_text_list.append(clean_text)
                words.append({
                    "text": clean_text,
                    "bbox": {
                        "x": x,
                        "y": y,
                        "w": w,
                        "h": h
                    }
                })
                
        # หากพบว่าข้อความส่วนใหญ่ในรูป (มากกว่า 40%) เป็นแนวตั้ง แสดงว่ารูปภาพตะแคง
        if valid_words_count > 0 and vertical_words_count > (valid_words_count * 0.4):
            raise Exception("ตรวจพบว่ารูปภาพตะแคงผิดมุม กรุณาถ่ายหรือหมุนรูปภาพให้ตัวหนังสืออยู่ในแนวนอนปกติก่อนทำการอัปโหลดครับ")
                
        extracted_text = "\n".join(full_text_list)
        print("=== EXTRACTED TEXT ===")
        print(extracted_text)
        print("======================")

        # ส่งผลลัพธ์กลับ
        return {
            "text": extracted_text,
            "words": words
        }
        
    except Exception as e:
        raise Exception(f"เกิดข้อผิดพลาดระหว่างทำ OCR ด้วย EasyOCR: {str(e)}")

