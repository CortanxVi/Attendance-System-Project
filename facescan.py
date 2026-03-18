import cv2
import os
import numpy as np
import pickle
from keras_facenet import FaceNet
from scipy.spatial.distance import euclidean

# 1. ตั้งค่า Model และโหลดฐานข้อมูล
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
embedder = FaceNet()

# โหลดไฟล์ .pkl ที่เราสร้างไว้
with open('faces_dataset.pkl', 'rb') as f:
    database = pickle.load(f)

known_embeddings = database['embeddings']
known_names = database['names']

# 2. ฟังก์ชันหาชื่อที่ใกล้เคียงที่สุด
def recognize_face(face_embedding, threshold=0.7):
    # คำนวณระยะห่าง (Distance) ระหว่างหน้าใหม่ กับหน้าทั้งหมดในฐานข้อมูล
    distances = [euclidean(face_embedding, known_emb) for known_emb in known_embeddings]
    min_dist = min(distances)
    
    if min_dist < threshold:
        # หา Index ของค่าที่น้อยที่สุด (ใกล้เคียงที่สุด)
        index = distances.index(min_dist)
        return known_names[index], min_dist
    else:
        return "Unknown", min_dist

# 3. เปิดกล้องเช็คชื่อ
cap = cv2.VideoCapture(0)

print("--- ระบบเช็คชื่อเริ่มทำงาน (กด 'q' เพื่อปิด) ---")

while True:
    ret, frame = cap.read()
    if not ret: break

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # ใช้ FaceNet extract ทั้งหน้าและ embedding ในคำสั่งเดียว (สะดวกกว่า)
    detections = embedder.extract(rgb_frame, threshold=0.95)

    for det in detections:
        x, y, w, h = det['box']
        embedding = det['embedding']
        
        # ค้นหาว่าเป็นใคร
        name, confidence = recognize_face(embedding)
        
        # วาดกรอบและชื่อ
        color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
        cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
        cv2.putText(frame, f"{name} ({confidence:.2f})", (x, y-10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

    cv2.imshow('Face Recognition Check-in', frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()

#ตัวเทส