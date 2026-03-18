import os
import numpy as np
import cv2
import pickle
from keras_facenet import FaceNet

# ตั้งค่า TensorFlow
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

class IncrementalEmbeddings:
    def __init__(self):
        self.embedder = FaceNet()
        self.dataset_path = 'dataset_raw'
        self.output_file = 'faces_dataset.pkl'

    def load_existing_data(self):
        """โหลดข้อมูลเดิมจากไฟล์ .pkl ถ้าไม่มีให้สร้าง dict เปล่า"""
        if os.path.exists(self.output_file):
            with open(self.output_file, "rb") as f:
                return pickle.load(f)
        return {"embeddings": [], "names": []}

    def update_embeddings(self):
        # 1. โหลดข้อมูลเก่าขึ้นมาก่อน
        data = self.load_existing_data()
        known_embeddings = data["embeddings"]
        known_names = data["names"]
        
        # เช็คว่ามีใครบ้างที่ "ทำไปแล้ว" (Unique Names)
        processed_people = set(known_names)
        
        print(f"--- รายชื่อเดิมในระบบ: {list(processed_people)} ---")

        # 2. วนลูปเช็คโฟลเดอร์ใน dataset_raw
        for person_name in os.listdir(self.dataset_path):
            person_dir = os.path.join(self.dataset_path, person_name)
            if not os.path.isdir(person_dir):
                continue

            # **จุดสำคัญ**: ถ้าชื่อนี้มีในระบบแล้ว ให้ SKIP (ข้าม) ไปเลย
            if person_name in processed_people:
                print(f"⏩ ข้าม {person_name}: มีข้อมูลในระบบอยู่แล้ว")
                continue

            print(f"🆕 พบคนใหม่! กำลังประมวลผล: {person_name}...")
            
            new_count = 0
            for img_name in os.listdir(person_dir):
                img_path = os.path.join(person_dir, img_name)
                img = cv2.imread(img_path)
                if img is None: continue
                
                img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                detections = self.embedder.extract(img_rgb, threshold=0.95)
                
                if len(detections) > 0:
                    embedding = detections[0]['embedding']
                    known_embeddings.append(embedding)
                    known_names.append(person_name)
                    new_count += 1

            print(f"✅ เพิ่ม {person_name} สำเร็จ ({new_count} รูป)")

        # 3. บันทึกทับไฟล์เดิม (คราวนี้จะมีทั้งของเก่าและของใหม่)
        updated_data = {"embeddings": known_embeddings, "names": known_names}
        with open(self.output_file, "wb") as f:
            pickle.dump(updated_data, f)
            
        print(f"\n--- อัปเดตเสร็จสิ้น! รวมทั้งหมด {len(set(known_names))} คน ({len(known_names)} รูป) ---")

if __name__ == "__main__":
    generator = IncrementalEmbeddings()
    generator.update_embeddings()