# 🎓 ระบบสแกนบัตรนักศึกษาเพื่อเช็คชื่อ (Student ID OCR & Attendance System)

แอปพลิเคชันสำหรับการเช็คชื่อเข้าเรียนหรือเข้าร่วมกิจกรรม โดยให้นักศึกษา **สแกนหรือถ่ายรูปบัตรประจำตัวนักศึกษา** ระบบจะใช้ AI ในการถอดรหัส (OCR) รหัสนักศึกษา 13 หลักจากภาพโดยอัตโนมัติ และยืนยันตัวตนผ่านฐานข้อมูล Supabase

> 💡 **ฟีเจอร์เด่น:** อัปเกรดระบบเป็น **Client-Side OCR** (ประมวลผลบนเครื่องของผู้ใช้ด้วย `tesseract.js`) ทำให้เซิร์ฟเวอร์โหลด 0% รองรับนักศึกษาเข้าใช้งานพร้อมกันหลักพันคนได้สบายๆ!

---

## 🏗️ โครงสร้างของระบบ (Architecture)

*   **Frontend:** React (Vite) + Tailwind CSS + SweetAlert2
    *   ทำหน้าที่เปิดกล้อง / รับรูปภาพ
    *   รัน AI (Tesseract.js) เพื่อดึงรหัสนักศึกษาจากรูปภาพ **(Client-Side Processing)**
*   **Backend:** Python (FastAPI)
    *   ทำหน้าที่เป็น API Gateway สำหรับเชื่อมต่อฐานข้อมูล
    *   จัดการระบบ Login และออกเหรียญยืนยันตัวตน (JWT Token)
*   **Database:** Supabase
    *   เก็บข้อมูลรหัสนักศึกษาและชื่อ-นามสกุล

---

## 🚀 วิธีติดตั้งและทดสอบรัน (Getting Started)

### 1. การตั้งค่าฝั่งฐานข้อมูล (Backend)
1. เปิดเข้าไปในโฟลเดอร์ `backend`
2. สร้างไฟล์ `.env` โดยก็อปปี้โครงสร้างมาจาก (หรือตั้งค่า) ข้อมูลดังนี้:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_key
   JWT_SECRET=your_jwt_secret
   ```
3. สร้างและเปิดใช้งาน Virtual Environment:
   ```bash
   python -m venv venv
   # สำหรับ Windows:
   .\venv\Scripts\activate
   ```
4. ติดตั้งไลบรารี:
   ```bash
   pip install -r requirements.txt
   ```
5. สั่งรัน Backend Server:
   ```bash
   uvicorn main:app --reload
   ```

### 2. การตั้งค่าฝั่งหน้าเว็บ (Frontend)
1. เปิด Terminal ใหม่แล้วเข้าไปในโฟลเดอร์ `frontend`
2. ติดตั้ง Dependencies:
   ```bash
   npm install
   ```
3. สั่งรันหน้าเว็บ:
   ```bash
   npm run dev
   ```
4. เปิดเบราว์เซอร์ไปที่ `http://localhost:5173/`

---

## 🛡️ ความปลอดภัย (Security Notes)
*   **ห้าม!** อัปโหลดไฟล์ `.env` ขึ้น GitHub เด็ดขาด (ไฟล์นี้ถูกตั้งค่าให้อยู่ใน `.gitignore` เรียบร้อยแล้ว)
*   รหัส JWT Secret ควรตั้งค่าให้เดายากในระดับ Production

---
*พัฒนาโดย: นักศึกษา / โปรเจกต์วิจัย*
