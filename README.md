# ระบบเช็คชื่อนักศึกษาด้วย AI (Face Recognition + OCR + NFC)

คู่มือนี้จัดทำขึ้นเพื่อแนะนำวิธีการติดตั้ง (Installation), การตั้งค่าตัวแปรสภาพแวดล้อม (Environment Variables), และคำสั่งที่ใช้ในการรันระบบแต่ละส่วน (Run Commands) 

## โครงสร้างโปรเจกต์
ระบบประกอบด้วยบริการ 3 ส่วนหลักที่ต้องทำงานร่วมกัน:
1. **Backend** (`/backend`): บริการ API หลัก เขียนด้วย FastAPI (Python) เชื่อมต่อกับ Supabase และประมวลผล Face Recognition (InsightFace)
2. **Frontend** (`/frontend`): ระบบหน้าบ้าน เขียนด้วย React + Vite (TypeScript)
3. **OCR Service** (`/ocr-service`): บริการแยกต่างหากสำหรับอ่านข้อมูลจากบัตรนักศึกษา เขียนด้วย Node.js (Express)

---

## ⚙️ 1. การตั้งค่าระบบ Backend (FastAPI)

**ความต้องการของระบบ:** Python 3.9 หรือใหม่กว่า

### การติดตั้ง Dependencies
เปิด Terminal แล้วรันคำสั่งตามลำดับ:
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### การตั้งค่า Environment Variables (.env)
คัดลอกไฟล์ `.env.example` เป็น `.env` (หรือสร้างไฟล์ `.env` ใหม่) แล้วตั้งค่าตัวแปรดังนี้:
```ini
SUPABASE_URL="https://[YOUR_PROJECT_ID].supabase.co"
SUPABASE_KEY="[YOUR_SERVICE_ROLE_KEY_OR_ANON_KEY]"
# (ตัวเลือก) ตั้งค่าที่เก็บโมเดล InsightFace หากจำเป็น
```

### คำสั่งรันระบบ (รันบนพอร์ต 8000)
```bash
cd backend
venv\Scripts\activate
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
API Docs จะเปิดใช้งานที่: `http://localhost:8000/docs`

---

## 💻 2. การตั้งค่าระบบ Frontend (React + Vite)

**ความต้องการของระบบ:** Node.js v18 หรือใหม่กว่า

### การติดตั้ง Dependencies
```bash
cd frontend
npm install
```

### การตั้งค่า Environment Variables (.env.local)
สร้างไฟล์ `.env.local` ในโฟลเดอร์ `frontend` แล้วตั้งค่าดังนี้:
```ini
VITE_SUPABASE_URL="https://[YOUR_PROJECT_ID].supabase.co"
VITE_SUPABASE_ANON_KEY="[YOUR_ANON_KEY]"
VITE_API_URL="http://localhost:8000"
```

### คำสั่งรันระบบ (รันบนพอร์ต 5173)
```bash
cd frontend
npm run dev
```
เข้าใช้งานเว็บไซต์ที่: `http://localhost:5173`

---

## 🔍 3. การตั้งค่าระบบ OCR Service (Node.js)

บริการนี้ทำหน้าที่สกัดข้อความจากภาพบัตรนักศึกษาแยกต่างหาก เพื่อไม่ให้เป็นภาระของ Backend Python

**ความต้องการของระบบ:** Node.js v18 หรือใหม่กว่า

### การติดตั้ง Dependencies
```bash
cd ocr-service
npm install
```

### คำสั่งรันระบบ (รันบนพอร์ต 3001)
```bash
cd ocr-service
npm start
```
API สำหรับ OCR จะรันอยู่ที่: `http://localhost:3001`

---

## ⚡ สรุปคำสั่งการเปิดระบบพร้อมกันทั้งหมด (Windows)
หากคุณใช้ระบบปฏิบัติการ Windows สามารถดับเบิลคลิกไฟล์ `start_all.bat` ที่ Root ของโปรเจกต์ได้เลย ระบบจะทำการเปิด Terminal ย่อยขึ้นมา 3 หน้าต่าง เพื่อรัน Backend, Frontend และ OCR ให้พร้อมใช้งานทันที

---
---

# สรุปผลการดำเนินการ Phase 2

ผมได้ดำเนินการพัฒนาฟีเจอร์ตามแผนงาน Phase 2 ทั้ง 4 ข้อเสร็จสิ้นเรียบร้อยแล้วครับ โดยมีการเปลี่ยนแปลงดังนี้:

## 1. 🚀 Progressive Web App (PWA) Integration
- ติดตั้ง `vite-plugin-pwa` ในโปรเจกต์ Frontend เพื่อทำให้ระบบกลายเป็น PWA ที่รองรับการติดตั้งลงบนเครื่อง (Add to Home Screen)
- เพิ่มและตั้งค่าไฟล์ `vite.config.ts` ให้เรียกใช้งาน PWA Plugin โดยใส่ Manifest ที่ครบถ้วน
- สร้างไฟล์ไอคอนตัวอย่าง `pwa-192x192.png` และ `pwa-512x512.png` สำหรับ PWA ลงในแฟ้ม `public/`
- ปรับปรุงไฟล์ `index.html` เพื่อเพิ่ม meta tag ที่จำเป็น เช่น `theme-color` และ `apple-touch-icon`

## 2. 🎓 Student Attendance History & Statistics
- สร้าง Backend Router ใหม่ที่ `backend/routers/student.py` สำหรับนักศึกษา เพื่อดึงประวัติการเข้าเรียนทั้งหมดของตนเอง
- ผูก Router เข้ากับแอปหลักใน `backend/main.py`
- สร้างหน้าจอ UI ใหม่ `AttendanceHistory.tsx` (สำหรับนักศึกษา) แสดงกราฟิกสรุปสถิติ "มาเรียน/มาสาย/ขาดเรียน" ด้วย UI ที่สวยงามอ่านง่าย 
- ผูกหน้าจอเข้ากับ `App.tsx` ในเส้นทาง `/student/history`

## 3. 📊 Teacher Export Reports
- สร้าง Service ส่วนกลาง `backend/services/attendance_export_service.py` สำหรับดึงข้อมูลและเตรียมรูปแบบการ Export เพื่อให้สามารถเรียกใช้ซ้ำได้
- ปรับปรุง Logic ใน `admin.py` ให้มาใช้ Service ตัวใหม่นี้แทนการเขียนโค้ดซ้ำ
- สร้าง Backend Router ใหม่ที่ `backend/routers/teacher.py` สำหรับอาจารย์ เพื่อดึงข้อมูลเช็คชื่อและส่งออก
- สร้างหน้าจอ `ExportReports.tsx` สำหรับอาจารย์ โดยรองรับการ Export 3 รูปแบบ: **Excel, CSV, และ PDF** (พร้อมรองรับฟอนต์ภาษาไทย THSarabunNew)
- ผูกหน้าจอเข้ากับเมนูและ `App.tsx`

## 4. 📝 Import Students CSV
- เพิ่ม Endpoint การอัปโหลดไฟล์ใน `backend/routers/teacher.py` เพื่ออ่านไฟล์ CSV และเพิ่มรายชื่อนักศึกษาใหม่ (สร้างโปรไฟล์นักศึกษาโดยอัตโนมัติ)
- สร้างหน้าจอ `ImportStudents.tsx` ให้มี UI แบบ Upload Box รองรับการลากวางและเลือกไฟล์ 
- เพิ่มปุ่มทางลัดไปยังหน้านำเข้าและหน้าส่งออกในหน้าหลักของอาจารย์ `TeacherDashboard.tsx` ทำให้เรียกใช้งานได้ง่าย
- ผูกหน้าจอทั้งหมดเข้ากับ `App.tsx` เรียบร้อย

> [!TIP]
> ตอนนี้คุณสามารถทดสอบรันระบบด้วย `npm run dev` (Frontend) และ `python main.py` (Backend) เพื่อทดสอบฟีเจอร์ต่างๆ ได้ทันทีครับ! หากมีส่วนไหนที่อยากปรับแก้ UI หรือเพิ่ม Logic แจ้งผมได้เลยครับ
