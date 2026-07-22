# ==============================
# KMUTNB Smart Attendance System
# ==============================

## 🚀 ภาพรวมโปรเจกต์ (Project Overview)
ระบบเช็คชื่อเข้าเรียนอัจฉริยะ (Smart Attendance System) ที่รวมความสามารถของการเช็คชื่อผ่าน Dynamic QR Code, การยืนยันตำแหน่งด้วย GPS Geofencing, และการยืนยันตัวตนขั้นสูงสุดด้วยระบบ **AI Face Recognition (Hybrid MediaPipe + Face-api)**

โปรเจกต์นี้แบ่งออกเป็น 2 ส่วนหลัก:
1. **Frontend (`kmutnb-attendance-app`)**: หน้าจอเว็บแอปพลิเคชันสำหรับนักศึกษาและอาจารย์ (React + Vite)
2. **Backend (`kmutnb-attendance-api`)**: เซิร์ฟเวอร์ API สำหรับประมวลผลระบบฐานข้อมูล, การจับคู่ใบหน้า 1-to-N, และระบบเข้ารหัส (FastAPI)

---

## 💻 วิธีการติดตั้งและรันโปรเจกต์ (Setup Instructions)

### ข้อกำหนดเบื้องต้น (Prerequisites)
* Node.js (v18 ขึ้นไป)
* Python (v3.10 ขึ้นไป)
* บัญชี Supabase (สำหรับฐานข้อมูล, Auth และ pgvector)

### 1. การตั้งค่าฝั่งฐานข้อมูล (Supabase)
1. นำคำสั่งจากไฟล์ `kmutnb-attendance-api/schema.sql` ทั้งหมด ไปรันในหน้า SQL Editor ของ Supabase
2. ไปที่การตั้งค่า Supabase เพื่อคัดลอก **Project URL**, **Anon Key** และ **Service Role Key**

### 2. การตั้งค่าฝั่ง Backend (API)
```bash
cd kmutnb-attendance-api

# สร้าง Virtual Environment
python3 -m venv venv
source venv/bin/activate  # สำหรับ Mac/Linux
# .\venv\Scripts\activate # สำหรับ Windows

# ติดตั้ง Dependencies
pip install -r requirements.txt

# คัดลอกไฟล์ตั้งค่า
cp .env.example .env
```
> **สำคัญ:** เข้าไปแก้ไขไฟล์ `.env` ในฝั่ง Backend โดยใส่ `SUPABASE_URL` และ `SUPABASE_KEY` (ฝั่ง Backend ให้ใช้ **service_role key** เพื่อหลบข้อจำกัด RLS ในการจัดการผู้ใช้)

รันเซิร์ฟเวอร์ Backend:
```bash
uvicorn main:app --reload --port 8000
```

### 3. การตั้งค่าฝั่ง Frontend (App)
```bash
cd kmutnb-attendance-app

# ติดตั้ง Dependencies
npm install

# คัดลอกไฟล์ตั้งค่า
cp .env.example .env
```
> **สำคัญ:** เข้าไปแก้ไขไฟล์ `.env` ในฝั่ง Frontend โดยใส่ `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` (ฝั่ง Frontend ให้ใช้ **anon key** เท่านั้น)

รันหน้าจอเว็บแอปพลิเคชัน:
```bash
npm run dev
```

---

## ✨ ฟีเจอร์ที่สำคัญ (Key Features)
* **Face Registration**: ลงทะเบียนใบหน้าโดยใช้ Tesseract (OCR) อ่านรหัสนักศึกษาจากบัตร และใช้ Face-api สกัดเวกเตอร์ 128 มิติ
* **Face Checking**: วาดโครงข่ายใบหน้า 478 จุดแบบ 3 มิติ (Real-time) ด้วย Google MediaPipe
* **TOTP Dynamic QR**: QR Code ที่เปลี่ยนแปลงตลอดเวลา ป้องกันการถ่ายรูปส่งให้เพื่อน
* **Face Tester (1-to-N)**: โหมดนักพัฒนาสำหรับใช้กล้องค้นหาและระบุตัวตนใบหน้าแบบสดๆ จากฐานข้อมูลทั้งหมด
