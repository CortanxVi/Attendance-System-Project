#เชื่อม data photo กับ sql เข้าด้วยกัน
import cv2
import psycopg2
import os
import pickle
from datetime import datetime
from keras_facenet import FaceNet
from scipy.spatial.distance import euclidean
from pynput import keyboard

# --- 1. ตั้งค่า Database & Model ---
conn = psycopg2.connect(database="menu", user="postgres", password="161147", host="127.0.0.1", port="5432")
cursor = conn.cursor()

embedder = FaceNet()
with open('faces_dataset.pkl', 'rb') as f:
    face_db = pickle.load(f)

# --- 2. ตัวแปรสำหรับเก็บค่าจาก NFC และหน้าจอ ---
current_nfc_id = ""
current_detected_name = "Unknown"

def recognize_face(embedding, threshold=0.7):
    distances = [euclidean(embedding, kb) for kb in face_db['embeddings']]
    min_dist = min(distances)
    return face_db['names'][distances.index(min_dist)] if min_dist < threshold else "Unknown"

# --- 3. ฟังก์ชันดักจับคีย์บอร์ด (เครื่องอ่าน NFC) ---
def on_press(key):
    global current_nfc_id, current_detected_name
    try:
        # ถ้าเครื่องอ่านส่งตัวเลขมา
        if hasattr(key, 'char'):
            current_nfc_id += key.char
        # ถ้าเครื่องอ่านส่ง 'Enter' (สิ้นสุดการอ่านบัตร)
        elif key == keyboard.Key.enter:
            if current_nfc_id != "":
                process_attendance(current_nfc_id, current_detected_name)
                current_nfc_id = "" # ล้างค่ารอใบถัดไป
    except Exception as e:
        print(f"Error reading keyboard: {e}")

def process_attendance(nfc_id, name):
    if name != "Unknown":
        try:
            now = datetime.now()
            # สำคัญ: ถ้า ID เป็นตัวเลขยาวๆ ใน SQL ควรเป็น BIGINT หรือ VARCHAR
            sql = "INSERT INTO student (id, name, time) VALUES (%s, %s, %s)"
            cursor.execute(sql, (nfc_id, name, now))
            conn.commit()
            print(f"✅ [SUCCESS] ID: {nfc_id} | Name: {name} | Time: {now.strftime('%H:%M:%S')}")
        except Exception as e:
            conn.rollback()
            print(f"❌ [DB ERROR]: {e}")
    else:
        print(f"⚠️ [REJECTED] ID: {nfc_id} สแกนผ่าน แต่กล้องไม่ยืนยันใบหน้า!")
        
    
# เริ่มตัวดักฟังคีย์บอร์ดใน Background
listener = keyboard.Listener(on_press=on_press)
listener.start()

# --- 4. Loop กล้องหลัก ---
cap = cv2.VideoCapture(0)
# สร้าง Label       # วางต่อลงมาเรื่อยๆ
# my_label.grid(row=0, column=0)  # วางตามตำแหน่ง แถว/คอลัมน์
print("🚀 ระบบพร้อมทำงาน... วางบัตร NFC ได้เลย (กด 'q' เพื่อออก)")

while True:
    ret, frame = cap.read()
    if not ret: break

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    detections = embedder.extract(rgb_frame, threshold=0.95)

    if detections:
        current_detected_name = recognize_face(detections[0]['embedding'])
        x, y, w, h = detections[0]['box']
        color = (0, 255, 0) if current_detected_name != "Unknown" else (0, 0, 255)
        cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
        cv2.putText(frame, current_detected_name, (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
    else:
        current_detected_name = "Unknown"

    cv2.imshow('NFC + Face Attendance System', frame)
    if cv2.waitKey(1) & 0xFF == ord('q'): break

cap.release()
conn.close()
cv2.destroyAllWindows()