import cv2
import psycopg2
import pickle
import os
from datetime import datetime
from keras_facenet import FaceNet
from scipy.spatial.distance import euclidean
from pynput import keyboard
import threading

# --- การตั้งค่าพื้นฐาน ---
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
DB_CONFIG = {
    "database": "menu",
    "user": "postgres",
    "password": "161147",
    "host": "127.0.0.1",
    "port": "5432"
}

# โหลด Model และข้อมูลใบหน้า
embedder = FaceNet()
with open('faces_dataset.pkl', 'rb') as f:
    face_db = pickle.load(f)

# ตัวแปรสำหรับ NFC
current_nfc_id = ""

def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)

def recognize_face(embedding, threshold=0.7):
    distances = [euclidean(embedding, kb) for kb in face_db['embeddings']]
    min_dist = min(distances)
    if min_dist < threshold:
        return face_db['names'][distances.index(min_dist)]
    return "Unknown"

# --- ฟังก์ชันหลัก (นิยามครั้งเดียว) ---
def check_and_save(identifier, is_nfc=False):
    """
    identifier = NFC card ID (str)  ถ้า is_nfc=True
    identifier = ชื่อจาก face recognition (str)  ถ้า is_nfc=False
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        now = datetime.now()
        today = now.date()

        real_id = 0
        real_name = "Unknown"

        if is_nfc:
            # แตะบัตร: เอา ID ไปหาชื่อในตาราง student
            cursor.execute("SELECT id, name FROM student WHERE id = %s", (identifier,))
            result = cursor.fetchone()
            if result:
                real_id, real_name = result[0], result[1]
            else:
                real_id, real_name = identifier, "New_NFC_User"
        else:
            # สแกนหน้า: เอาชื่อไปหา ID ในตาราง student
            cursor.execute("SELECT id, name FROM student WHERE name = %s", (identifier,))
            result = cursor.fetchone()
            if result:
                real_id, real_name = result[0], result[1]
            else:
                real_id, real_name = 0, identifier  # ไม่มีใน student แต่มีใน pkl

        # เช็คว่าวันนี้ลงเวลาไปหรือยัง (ป้องกันบันทึกซ้ำภายใน 10 วินาที)
        cursor.execute("""
            SELECT check_time FROM attendance_logs 
            WHERE id = %s AND CAST(check_time AS DATE) = %s 
            ORDER BY check_time DESC LIMIT 1
        """, (real_id, today))
        last_log = cursor.fetchone()

        if last_log is None or (now - last_log[0]).total_seconds() > 20:
            status = "IN" if last_log is None else "OUT"
            cursor.execute(
                "INSERT INTO attendance_logs (id, name, check_time, status) VALUES (%s, %s, %s, %s)",
                (real_id, real_name, now, status)
            )
            conn.commit()
            print(f"💾 {real_name} (ID: {real_id}) บันทึก {status} เรียบร้อย!")
        else:
            print(f"⏩ {real_name} ลงเวลาไปแล้วเมื่อ {last_log[0].strftime('%H:%M:%S')}")

        cursor.close()
        conn.close()

    except Exception as e:
        print(f"❌ Database Error: {e}")

# --- NFC Keyboard Listener ---
def on_press(key):
    global current_nfc_id
    try:
        if hasattr(key, 'char') and key.char is not None:
            current_nfc_id += key.char
        elif key == keyboard.Key.enter:
            if current_nfc_id != "":
                print(f"💳 แตะบัตร ID: {current_nfc_id}")
                check_and_save(current_nfc_id, is_nfc=True)  # ✅ เรียกถูก signature
                current_nfc_id = ""
    except Exception:
        pass

listener = keyboard.Listener(on_press=on_press)
listener.start()

# --- ส่วนกล้อง (Face Recognition) ---
cap = cv2.VideoCapture(0)
print("🚀 ระบบเริ่มทำงาน... สแกนหน้าอัตโนมัติหรือแตะบัตรก็ได้ (กด Q เพื่อออก)")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    detections = embedder.extract(rgb_frame, threshold=0.95)

    for det in detections:
        x, y, w, h = det['box']
        name = recognize_face(det['embedding'])

        if name != "Unknown":
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            cv2.putText(frame, f"{name} (Verified)", (x, y - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            check_and_save(name, is_nfc=False)  # ✅ ส่งชื่อ ไม่ใช่ 0
        else:
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 0, 255), 2)
            cv2.putText(frame, "Unknown", (x, y - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

    cv2.imshow('Hybrid Attendance System', frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
listener.stop()