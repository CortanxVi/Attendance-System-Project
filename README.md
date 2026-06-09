# 🏫 Attendance System - วิธีการรันโปรเจกต์

ระบบนี้แบ่งออกเป็น 2 ส่วนหลักคือ **Backend (FastAPI)** และ **Frontend (React + Vite)** คุณจำเป็นต้องเปิด Terminal (หรือ Command Prompt) 2 หน้าต่าง เพื่อรันทั้งสองส่วนพร้อมกัน

---

## ⚙️ 1. วิธีรัน Backend (FastAPI)

Backend จะทำหน้าที่เชื่อมต่อกับฐานข้อมูล SQLite และ Supabase พร้อมให้บริการ API

1. เปิด Terminal หน้าต่างที่ 1
2. เข้าไปที่โฟลเดอร์ `backend`:
   ```bash
   cd D:\code\attendance_system\backend
   ```
3. เปิดใช้งาน Virtual Environment (สำหรับ Windows):
   ```bash
   .\venv\Scripts\activate
   ```
   *(ถ้าสำเร็จ จะมีคำว่า `(venv)` ขึ้นหน้าบรรทัดคำสั่ง)*
4. สั่งรันเซิร์ฟเวอร์:
   ```bash
   uvicorn main:app --reload
   ```
5. **สำเร็จ!** Backend จะรันอยู่ที่ `http://localhost:8000`
   - คุณสามารถดูหน้าทดสอบ API (Swagger UI) ได้ที่ `http://localhost:8000/docs`

---

## 🎨 2. วิธีรัน Frontend (React + Vite)

Frontend คือหน้าเว็บสำหรับแสดงผลและอัพโหลดไฟล์

1. เปิด Terminal หน้าต่างที่ 2
2. เข้าไปที่โฟลเดอร์ `frontend`:
   ```bash
   cd D:\code\attendance_system\frontend
   ```
3. สั่งรันเว็บเซิร์ฟเวอร์:
   ```bash
   npm run dev
   ```
4. **สำเร็จ!** จะมีลิงก์ปรากฏขึ้นมา ให้กด Ctrl + คลิก ที่ลิงก์ `http://localhost:5173/` เพื่อเปิดหน้าเว็บใช้งานได้ทันที

---

## 🛠️ โครงสร้างไฟล์ที่สำคัญ
- `backend/.env` - ไฟล์สำหรับตั้งค่า `SUPABASE_URL` และ `SUPABASE_KEY`
- `backend/attendance.db` - ฐานข้อมูล SQLite ในเครื่อง
- `frontend/src/services/api.ts` - ไฟล์ที่ Frontend ใช้กำหนดที่อยู่ของ Backend (ชี้ไปที่พอร์ต 8000)
