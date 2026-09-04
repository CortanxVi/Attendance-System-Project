# ระบบเช็คชื่อนักศึกษาด้วย AI (Face Recognition + OCR + NFC)

คู่มือนี้จัดทำขึ้นเพื่อแนะนำวิธีการติดตั้ง (Installation), การตั้งค่าตัวแปรสภาพแวดล้อม (Environment Variables), และคำสั่งที่ใช้ในการรันระบบแต่ละส่วน (Run Commands) 

## โครงสร้างโปรเจกต์
ระบบประกอบด้วยบริการ 3 ส่วนหลักที่ต้องทำงานร่วมกัน:
1. **Backend** (`/backend`): บริการ API หลัก เขียนด้วย FastAPI (Python) เชื่อมต่อกับ Supabase และประมวลผล Face Recognition (InsightFace)
2. **Frontend** (`/frontend`): ระบบหน้าบ้าน เขียนด้วย React + Vite (TypeScript)
3. **OCR Service** (`/ocr-service`): บริการแยกต่างหากสำหรับอ่านข้อมูลจากบัตรนักศึกษา เขียนด้วย Node.js (Express)

---

## ⚙️ 1. การตั้งค่าระบบ Backend (FastAPI)

**ความต้องการของระบบ:** Python 3.12 x64, Node.js 22.12+ หรือ 24 และ Windows 10/11 หรือ Linux x64/arm64

### การติดตั้ง Dependencies
Linux:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirement.txt
```

Windows Command Prompt:

```bat
cd backend
py -3.12 -m venv .venv-windows
.venv-windows\Scripts\python.exe -m pip install --upgrade pip
.venv-windows\Scripts\python.exe -m pip install -r requirement.txt
```

`requirement.txt` ใช้ ONNX Runtime แบบ CPU ซึ่งมี wheel สำหรับ Windows และ Linux
และไม่บังคับติดตั้ง CUDA, NVIDIA packages, PyTorch หรือ Triton ที่ไม่ได้ถูกใช้โดยระบบ

### การตั้งค่า Environment Variables (.env)
คัดลอกไฟล์ `.env.example` เป็น `.env` (หรือสร้างไฟล์ `.env` ใหม่) แล้วตั้งค่าตัวแปรดังนี้:
```ini
SUPABASE_URL="https://[YOUR_PROJECT_ID].supabase.co"
SUPABASE_KEY="[YOUR_SERVICE_ROLE_KEY]"
OCR_SERVICE_URL="http://127.0.0.1:3001"
OCR_SERVICE_TOKEN="[RANDOM_INTERNAL_TOKEN]"
LIVENESS_SIGNING_KEY="[DIFFERENT_RANDOM_SECRET_AT_LEAST_32_CHARS]"
OCR_TIMEOUT_SECONDS=42
FACE_INFERENCE_CONCURRENCY=2
MAX_IMAGE_BYTES=8388608
MAX_IMAGE_WIDTH=4096
MAX_IMAGE_HEIGHT=4096
MAX_IMAGE_PIXELS=16000000
ROSTER_IMPORT_REQUEST_MAX_BYTES=6291456
QR_REFRESH_SECONDS=12
QR_CHALLENGE_SECONDS=120
CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
TEMP_ADMIN_PIN_PEPPER="[RANDOM_SECRET_AT_LEAST_32_CHARS]"
TEMP_ADMIN_GRANT_SECONDS=600
TEMP_ADMIN_ENROLLMENT_SECONDS=86400
TEMP_ADMIN_MAX_PIN_ATTEMPTS=5
TEMP_ADMIN_LOCK_SECONDS=900
```

### คำสั่งรันระบบ (รันบนพอร์ต 8000)
```bash
cd backend
source .venv/bin/activate
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Windows:

```bat
cd backend
.venv-windows\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
API Docs จะเปิดใช้งานที่: `http://localhost:8000/docs`

---

## 💻 2. การตั้งค่าระบบ Frontend (React + Vite)

**ความต้องการของระบบ:** Node.js 22.12+ หรือ 24 (Vite 8 และ Supabase JS รุ่นปัจจุบันไม่รองรับ Node 18)

### การติดตั้ง Dependencies
```bash
cd frontend
npm install
```

บน Linux ที่ใช้ `nvm` ให้รัน `nvm use 22` ก่อน ส่วน Windows ใช้ Node.js 22.12+/24
จาก installer หรือ version manager ที่ทำให้ `node.exe` และ `npm.cmd` อยู่ใน `PATH`

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

บริการนี้ใช้ `@arcships/light-ocr` และรับคำขอจาก Backend แบบ server-to-server เพื่อไม่เปิด OCR/ข้อมูลบัตรตรงสู่ browser

**ความต้องการของระบบ:** Node.js 22.12+ หรือ 24

### การติดตั้ง Dependencies
```bash
cd ocr-service
npm ci
```

ไม่ต้องติดตั้งแพ็กเกจ native แยกตามระบบปฏิบัติการ ตัว `@arcships/light-ocr`
จะเลือก runtime ที่ตรงกับ Linux หรือ Windows แบบ x64/arm64 ให้โดยอัตโนมัติ

ตรวจสอบ runtime ก่อนเปิดบริการ:

```bash
nvm install  # อ่านเวอร์ชัน 22 จาก ocr-service/.nvmrc (กรณีใช้ nvm)
nvm use
node --version
npm run doctor
```

บน Ubuntu, Linux Mint และ Fedora ค่า `native.status` ต้องเป็น `ok` และ
`system.platform` ต้องเป็น `linux` หากเครื่องไม่มี Vulkan/WebGPU ระบบจะใช้ CPU ได้

บน Windows ค่า `native.status` ต้องเป็น `ok` และ `system.platform` ต้องเป็น `win32`
โดยไม่ต้องติดตั้ง Python OCR หรือ EasyOCR

### คำสั่งรันระบบ (รันบนพอร์ต 3001)

คัดลอก `ocr-service/.env.example` เป็น `ocr-service/.env` และตั้ง
`OCR_SERVICE_TOKEN` ให้ตรงกับ `backend/.env` ไฟล์นี้ต้องไม่มี Supabase key
หรือค่าของ frontend

```bash
cd ocr-service
cp .env.example .env
# แก้ OCR_SERVICE_TOKEN ใน .env ก่อน แล้วจึงรัน
node --env-file=.env ocr-server.js
```

Windows Command Prompt ใช้ `copy .env.example .env` แทน `cp` ส่วนคำสั่งเปิดบริการ
ยังคงเป็น `node --env-file=.env ocr-server.js`
API สำหรับ OCR จะรันอยู่ที่: `http://localhost:3001`

ตรวจสอบว่าบริการพร้อมใช้งาน:

```bash
curl http://127.0.0.1:3001/health
```

ทดสอบอ่านบัตรด้วยไฟล์จริง (เปิดบริการไว้ในอีก Terminal หนึ่งก่อน):

```bash
OCR_SERVICE_TOKEN="[ค่าเดียวกับ service]" npm run test:ocr -- /absolute/path/to/student-card.jpg
```

Windows PowerShell:

```powershell
$env:OCR_SERVICE_TOKEN = "[ค่าเดียวกับ service]"
npm run test:ocr -- "C:\absolute\path\student-card.jpg"
Remove-Item Env:OCR_SERVICE_TOKEN
```

หากทราบรหัส 13 หลักที่คาดหวัง สามารถให้คำสั่งตรวจผลให้อัตโนมัติได้:

```bash
OCR_SERVICE_TOKEN="[ค่าเดียวกับ service]" npm run test:ocr -- /absolute/path/to/student-card.jpg 1234567890123
```

ตัวแปรสภาพแวดล้อมที่ใช้ได้:

- `PORT` พอร์ตของบริการ ค่าเริ่มต้น `3001`
- `HOST` interface ที่รับการเชื่อมต่อ ค่าเริ่มต้น `127.0.0.1`
- `OCR_SERVICE_TOKEN` shared secret ภายในระหว่าง FastAPI กับ OCR; ต้องตั้งใน production
- production บังคับให้ `OCR_SERVICE_TOKEN` ยาวอย่างน้อย 32 ตัวอักษร; แนะนำ `openssl rand -hex 32`
- `OCR_MAX_FILE_SIZE_MB` ขนาดภาพสูงสุด ค่าเริ่มต้น `8`
- `OCR_PROVIDER=cpu` ใช้ CPU แบบคาดเดาเวลาได้บน Windows และ Linux
- `OCR_QUEUE_CAPACITY=32` รองรับนักศึกษาเข้าคิวพร้อมกัน 30 คนและมี safety slot 2 งาน
- `OCR_REQUEST_TIMEOUT_MS=40000` ตัดงาน OCR ที่เกิน 40 วินาที โดย backend รอไม่เกิน 42 วินาที
- `OCR_DETECTION_MAX_SIDE=960` จำกัดขนาดภาพที่ส่งเข้าโมเดลเพื่อลดเวลาและหน่วยความจำ
- `OCR_INCLUDE_RAW_TEXT=true` ส่งข้อความ OCR ดิบกลับมาเพื่อ debug เท่านั้น ไม่ควรเปิดใน production

ทดสอบ burst 30 คนด้วยภาพบัตรทดสอบที่ไม่ใช่ข้อมูลจริง:

```bash
OCR_SERVICE_TOKEN="[ค่าเดียวกับ service]" npm run test:concurrency -- /absolute/path/to/test-card.jpg 30 1234567890123
```

คำสั่งต้องได้ HTTP 200 ครบ 30 งานและเวลาสูงสุดไม่เกิน 45 วินาที เครื่อง production
ต้องมีทรัพยากรอย่างน้อยเท่ากับเครื่องที่ใช้ผ่านคำสั่งนี้ก่อนเปิดให้ใช้งานจริง

---

## ⚡ เปิดระบบพร้อมกันบน Windows 10/11

### สิ่งที่ต้องติดตั้ง

1. Python 3.12 x64 พร้อม Python Launcher (`py.exe`)
2. Node.js 22.12+ LTS หรือ 24 LTS x64
3. Microsoft Visual C++ Redistributable รุ่นปัจจุบันสำหรับ ONNX Runtime
4. Git for Windows หากต้อง clone/pull โปรเจกต์

ติดตั้งครั้งแรกโดยเปิด Command Prompt ที่โฟลเดอร์โปรเจกต์ แล้วรัน:

```bat
setup_windows.bat
```

สคริปต์จะทำสิ่งต่อไปนี้โดยไม่เขียนทับไฟล์ `.env` ที่มีอยู่:

- ตรวจ Python 3.12 x64 และ Node.js 22.12+/24
- สร้าง `backend\.venv-windows` แยกจาก `.venv` ของ Linux เพื่อป้องกัน native package ปะปนกัน
- ติดตั้ง Backend, Light OCR และ Frontend จากไฟล์ lock/requirements ปัจจุบัน
- รัน `light-ocr doctor`
- คัดลอกไฟล์ตัวอย่าง environment เฉพาะไฟล์ที่ยังไม่มี

จากนั้นแก้ค่าจริงใน:

- `backend\.env` — Supabase URL, service-role key และ OCR token
- `ocr-service\.env` — OCR token เท่านั้น ห้ามใส่ Supabase key
- `frontend\.env.local` — Supabase publishable/anon key เท่านั้น

สร้าง OCR token 32 bytes ด้วย PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
```

คัดลอกผลลัพธ์เดียวกันไปยัง `OCR_SERVICE_TOKEN` ใน `backend\.env` และ
`ocr-service\.env` แล้วเปิดระบบด้วย:

```bat
start_all.bat
```

ระบบจะเปิด Backend, OCR และ Frontend แยกเป็นสามหน้าต่าง ตัว OCR จะล้างตัวแปร
Supabase/Frontend ที่อาจติดมากับเครื่องก่อนอ่าน `ocr-service\.env` เพื่อไม่ให้ service
ซึ่งประมวลผลรูปบัตรได้รับกุญแจฐานข้อมูลโดยไม่จำเป็น

ตรวจบริการจาก Command Prompt อีกหน้าต่าง:

```bat
curl.exe -fsS http://127.0.0.1:3001/health
curl.exe -fsS http://127.0.0.1:8000/docs >nul && echo Backend OK
curl.exe -fsS http://127.0.0.1:5173/ >nul && echo Frontend OK
```

ปิดหน้าต่างบริการทั้งสามเมื่อต้องการหยุดระบบ Windows

---

## ⚡ เปิดระบบพร้อมกันบน Ubuntu / Linux Mint / Fedora

ติดตั้ง Node 22.12+ (คำสั่ง `nvm install 22` จะเลือก 22.x รุ่นล่าสุด) หรือ Node 24 และเตรียมไฟล์ต่อไปนี้ก่อน:

- `backend/.env` — Supabase service-role key และ token ที่ backend ใช้เรียก OCR
- `ocr-service/.env` — เฉพาะค่าของ OCR โดยใช้ token เดียวกัน ห้ามใส่ Supabase key
- `frontend/.env.local` — Supabase publishable/anon key เท่านั้น

สร้าง shared token ด้วย `openssl rand -hex 32` แล้วคัดลอกค่าเดียวกันไปยัง
`OCR_SERVICE_TOKEN` ใน `backend/.env` และ `ocr-service/.env` จากนั้นจำกัดสิทธิ์ไฟล์:

```bash
chmod 600 backend/.env ocr-service/.env frontend/.env.local
chmod +x start_all.sh
./start_all.sh
```

สคริปต์จะแยก environment ของ OCR และลบตัวแปร Supabase ออกจาก OCR process
ก่อนเริ่มบริการโดยอัตโนมัติ

### ติดตั้งแพ็กเกจระบบปฏิบัติการ

Ubuntu / Linux Mint:

```bash
sudo apt update
sudo apt install -y build-essential python3 python3-venv python3-dev curl openssl
```

Fedora:

```bash
sudo dnf group install -y "Development Tools"
sudo dnf install -y python3 python3-devel curl openssl
```

### เตรียมฐานข้อมูล Supabase สำหรับโปรเจกต์ใหม่

migration ล่าสุดใน `supabase/migrations` เพิ่มชั้นปี/ห้องเรียนและระบบสิทธิ์ผู้ดูแลชั่วคราว
ก่อนรันกับ Supabase project จริง ให้เชื่อม project และตรวจรายการเปลี่ยนแปลงจากโฟลเดอร์ราก:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push --dry-run
npx supabase@latest db push
```

หากยังไม่ได้เข้าสู่ระบบ CLI ให้ใช้ `npx supabase@latest login` ซึ่งจะเปิด browser เพื่อยืนยันบัญชี
จากนั้นใช้ Project Reference ที่หน้า Supabase Dashboard → Project Settings → General.
ห้ามนำ service-role key ไปใส่ frontend หรือ OCR service

### แก้ปัญหา `/api/v1/auth/me` ตอบ 503 แล้วตามด้วย 401

ตรวจสอบ migration ก่อน หาก Backend เลือกคอลัมน์โปรไฟล์รุ่นใหม่แต่ฐานข้อมูลยังไม่ได้
ติดตั้ง migration PostgREST จะตอบรหัสเช่น `42703` หรือ `PGRST205` และ Backend จะคืน
`503 Service Unavailable` ส่วน `401` หมายถึงคำขอนั้นไม่มี session/token ที่ใช้ได้แล้ว

```bash
npx supabase@latest migration list --linked
npx supabase@latest db push --dry-run --linked
npx supabase@latest db push --linked --yes
```

หลังแก้แล้ว `db push --dry-run` ต้องรายงาน `upToDate: true` จากนั้นเปิดบริการใหม่และ
เข้าสู่ระบบอีกครั้ง Frontend รุ่นปัจจุบันจะไม่ลบ session เมื่อเกิด `503` ชั่วคราว แต่จะแสดง
สาเหตุพร้อมปุ่มลองใหม่

### ตรวจว่าบริการเริ่มครบ

เปิดอีก Terminal แล้วรัน:

```bash
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:8000/docs >/dev/null && echo "Backend OK"
curl -fsS http://127.0.0.1:5173/ >/dev/null && echo "Frontend OK"
```

จากนั้นเปิด `http://127.0.0.1:5173` และตรวจตามลำดับ:

1. Admin สร้างคำเชิญบัญชีอาจารย์ก่อนล็อกอินครั้งแรก บัญชีอาจารย์ที่ไม่มี invite จะถูกปฏิเสธ
2. อาจารย์สร้างรายวิชา เปิดหน้าจัดการรายชื่อ และนำเข้าไฟล์ `.xlsx` หรือ `.csv` โดยตรวจตัวอย่างก่อนยืนยัน จากนั้นเปิดคาบและหน้า Dynamic QR
3. นักศึกษาสแกน QR ที่กำลังแสดงอยู่ ถ่ายบัตร และทำ liveness ตามลำดับสุ่ม “กะพริบตา + หันซ้าย/ขวา” (รูปบัตร JPEG/PNG จะถูกหมุนตามข้อมูลภาพและย่ออัตโนมัติไม่เกิน 1920×1920 px โดยไม่ตัดภาพ ก่อนส่งให้ Light OCR)
4. ตรวจว่าหน้าจออาจารย์แสดงชื่อและวิธี `Face + OCR` ทันที
5. ทดสอบ NFC จากหน้าอาจารย์และตรวจว่าชื่อพร้อมวิธี `NFC` ปรากฏทันที

ทดสอบ OCR ด้วยภาพบัตรจริงโดยไม่เปิดเผย raw text:

```bash
cd ocr-service
node --env-file=.env scripts/test-ocr.mjs /absolute/path/to/student-card.jpg 1234567890123
```

## Dynamic QR และการแจ้งเตือน

- QR token หมุนทุก 12 วินาทีโดยค่าเริ่มต้น และตั้งได้เฉพาะช่วง 10–15 วินาทีผ่าน `QR_REFRESH_SECONDS`
- นักศึกษาต้องสแกน QR ล่าสุดก่อนเสมอ; server ออก challenge ผูกกับบัญชี ใช้ได้ครั้งเดียวและหมดอายุใน 120 วินาทีโดยค่าเริ่มต้น (`QR_CHALLENGE_SECONDS`)
- การเช็คชื่อแบบใบหน้าต้องผ่านพร้อมกันทั้ง challenge ที่ลงลายเซ็น, Light OCR จากภาพบัตร, ใบหน้าที่ลงทะเบียน และภาพสามสถานะ “หลับตา/หันหน้า/มองตรง”; backend คำนวณการปิดตา ทิศการหันหน้า และยืนยันว่าเป็นบุคคลเดียวกันเอง ไม่เชื่อผลผ่านจาก browser เพียงอย่างเดียว
- หาก OCR หรือการบันทึกฐานข้อมูลขัดข้องชั่วคราว challenge จะยังไม่ถูกใช้; ระบบ consume challenge พร้อมสร้าง attendance record ใน PostgreSQL transaction เดียวเท่านั้น
- ระหว่างรอคิว OCR/ใบหน้า backend จะต่ออายุ processing lease ทุก 20 วินาที เพื่อกันการส่งคำขอซ้ำแย่งงานและไม่ให้คำขอปกติถูกตัดกลางคัน
- NFC ใช้ได้เฉพาะอาจารย์เจ้าของคาบหรือ admin และจะแจ้งชื่อ/วิธีผ่าน Supabase Realtime ทันที
- รูป JPEG/PNG ถูกจำกัดทั้งขนาดไฟล์ มิติ และจำนวนพิกเซลก่อน decode เพื่อป้องกัน compressed-image resource exhaustion
- กล้องหน้า กล้องหลัง และ webcam เลือกได้จากหน้าจอ liveness โดยมี browser เป็นเจ้าของ stream เพียงตัวเดียว; โทรศัพท์ที่เชื่อมผ่านเครือข่ายต้องเปิด frontend ผ่าน HTTPS เพราะ browser ไม่อนุญาตกล้องบน HTTP ที่ไม่ใช่ localhost
- การตรวจภาพสามสถานะลดการใช้ภาพนิ่งตรงเพียงภาพเดียวและแก้กรณีผงกหัวผ่าน แต่ยังไม่ใช่ระบบ presentation-attack detection ที่ผ่านมาตรฐาน ISO/IEC 30107; ก่อนใช้ในงานที่มีความเสี่ยงสูงควรเพิ่มโมเดล anti-spoof ที่ผ่านการประเมินกับกล้อง/สภาพแสงจริง
- นักศึกษาจากโดเมนนักศึกษาสมัครได้ตามรหัส 13 หลัก ส่วนอาจารย์และ admin ต้องมีคำเชิญที่ยังไม่ถูกใช้ก่อนล็อกอินครั้งแรก
- CSV/Excel export จะแปลงค่าที่ขึ้นต้นแบบสูตรให้เป็นข้อความก่อนสร้างไฟล์

## สิทธิ์ผู้ดูแลชั่วคราว Teacher → Admin

1. อาจารย์เปิด `ตั้งค่าระบบ` → `สิทธิ์ผู้ดูแลชั่วคราว` ระบุเหตุผลและส่งคำขอ
2. ผู้ดูแลระบบถาวรเปิด `อนุมัติสิทธิ์ชั่วคราว` เพื่อตรวจคำขอและอนุมัติ/ปฏิเสธ
3. เมื่ออนุมัติ อาจารย์มีเวลา 24 ชั่วโมงตั้งและยืนยัน PIN ตัวเลข 6 หลัก
4. ครั้งต่อไปอาจารย์ใช้ PIN เดิมเปิดสิทธิ์ครั้งละ 10 นาที; บทบาทใน `profiles.role` ยังคงเป็น `teacher`
5. กรอก PIN ผิดครบ 5 ครั้งจะถูกล็อก 15 นาที การนับทำแบบ atomic ใน PostgreSQL
6. grant token ผูกกับ Supabase auth session เก็บในหน่วยความจำ browser เท่านั้น และ backend เก็บเฉพาะ SHA-256 hash
7. ผู้ดูแลชั่วคราวเปลี่ยน role, สร้าง admin, ลบบัญชีผู้ใช้/รายวิชาของผู้อื่น หรืออนุมัติสิทธิ์ให้ผู้อื่นไม่ได้
8. ผู้ดูแลระบบถาวรเพิกถอน PIN และ grant ที่กำลังใช้งานได้จากหน้ารายการเดียวกัน

ตั้ง `TEMP_ADMIN_PIN_PEPPER` เป็น secret แบบสุ่มอย่างน้อย 32 ตัวอักษรใน production เช่น
`openssl rand -hex 32` และอย่าเปลี่ยนค่าระหว่างที่ยังมี PIN ใช้งานอยู่ เพราะ PIN เดิมจะตรวจสอบไม่ได้

## ขอบเขตข้อมูลการเช็คชื่อ

- ระบบนี้เป็น **check-in only** ไม่มีขั้นตอนหรือข้อมูล check-out
- รูปบัตรและภาพ liveness ใช้ประมวลผลระหว่างคำขอเท่านั้น ไม่บันทึกเป็นรูปเช็คชื่อถาวร
- ฐานข้อมูลเก็บผลการยืนยัน/เวลา/วิธีเช็คชื่อและ face embedding ที่จำเป็นต่อการจับคู่ ไม่เก็บไฟล์ภาพเช็คชื่อใน Storage
- Light OCR ไม่ส่ง raw OCR text เว้นแต่เปิดโหมด debug โดยตั้งใจ และไม่ควรเปิดใน production

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

## 4. 📝 Import Students Excel/CSV
- ระบบรับ `.xlsx` และ `.csv` ทั้ง UTF-8/UTF-8 BOM รวมถึง CSV ภาษาไทยแบบ Windows CP874 โดยอ่านรูปแบบใบรายชื่อมหาวิทยาลัยที่มีหัวตารางสองแถวได้
- หน้านำเข้าแสดงผลตรวจทีละแถวและสรุปว่าจะเพิ่มบัญชีเดิม สร้างคำเชิญ ผูกคำเชิญเดิม ข้ามรายการเดิม หรือปฏิเสธรายการใด ก่อนอาจารย์กดยืนยัน
- Backend จำกัดไฟล์ 5 MB และ 1,000 รายชื่อ ตรวจชนิดไฟล์/โครงสร้าง ZIP/สูตรอันตราย/ข้อมูลซ้ำ และตรวจรหัสวิชาในไฟล์ให้ตรงกับรายวิชาที่เลือก
- ขั้นยืนยันจะอ่านและตรวจไฟล์ซ้ำ เทียบ SHA-256 กับไฟล์ที่ preview และบันทึกทั้งชุดด้วย PostgreSQL transaction เดียว จึงไม่เกิดข้อมูลเข้าเพียงบางส่วน
- นักศึกษาที่สมัครแล้วจะถูกเพิ่มเข้า `enrollments` ส่วนผู้ที่ยังไม่สมัครจะถูกสร้างหรือผูก `profile_invites` เพื่อรับสิทธิ์หลังล็อกอินครั้งแรก

## 5. ⚙️ หน้าตั้งค่าระบบของอาจารย์
- `/teacher/settings` เป็นเมนูหลักแบบรายการเลือก ไม่แสดงทุกฟังก์ชันยาวต่อกันในหน้าเดียว
- `คำร้องของนักศึกษา`, `สิทธิ์ผู้ดูแลชั่วคราว` และ `ข้อมูลระบบและความปลอดภัย` เปิดเป็น URL แยกและมีปุ่มย้อนกลับไปหน้าตั้งค่า
- การแบ่ง route ทำให้เปิดลิงก์ตรง ใช้ปุ่ม Back ของ browser และโหลดเฉพาะหน้าที่ต้องใช้งานได้ถูกต้อง

## 6. 🛡️ ความเสถียรและประสิทธิภาพรอบ Production

- Endpoint ที่ใช้ Supabase client แบบ synchronous ทำงานผ่าน FastAPI thread pool แทนการบล็อก asyncio event loop; งานแปลงภาพและ InsightFace ใน endpoint แบบ async ถูกส่งไป worker thread
- การตั้งสถานะนักศึกษาหลายคนในหนึ่งคาบเรียก Backend เพียงครั้งเดียว และ PostgreSQL RPC จะตรวจเจ้าของคาบ/สมาชิกวิชาแล้วบันทึกทั้งชุดใน transaction เดียว
- RPC แบบกลุ่มถูกถอนสิทธิ์จาก `public`, `anon` และ `authenticated`; เรียกได้เฉพาะ Backend `service_role`
- Excel และ PDF engine โหลดเมื่อผู้ใช้กดส่งออกเท่านั้น และไม่อยู่ใน PWA precache ทำให้การเปิด/ติดตั้งหน้าเว็บครั้งแรกไม่ต้องดาวน์โหลด engine ขนาดใหญ่
- Backend ใช้ `onnx`, `Pillow` และ `python-multipart` รุ่นที่อุดช่องโหว่ตาม dependency audit; Frontend และ OCR lockfile ผ่าน `npm audit`
- สถานะการเข้าเรียนใช้ชุดเดียวกับฐานข้อมูลคือ `present`, `late`, `absent` เพื่อไม่ให้ UI ส่งสถานะที่ schema ปฏิเสธ
