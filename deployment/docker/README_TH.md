# Docker Staging บนเครื่องพัฒนา

ชุดนี้ใช้ทดสอบ `demo3.1` ก่อน Production โดยรัน FastAPI และ Light OCR ใน Docker
บนเครื่องพัฒนา ส่วน Frontend จะรันในเครื่องหรือ deploy เป็น Preview บน Vercel/Netlify

```text
Vercel/Netlify Preview --HTTPS--> ngrok --HTTP loopback--> FastAPI container
                                                        `--> OCR container
FastAPI/OCR containers ------------------------------------> Supabase Staging
```

พอร์ต OCR ไม่ถูก publish ออกจาก Docker network และ FastAPI ถูก publish เฉพาะ
`127.0.0.1:8000` จึงต้องผ่าน tunnel เมื่อต้องการทดสอบจาก Internet

## 1. เงื่อนไขก่อนเริ่ม

- checkout branch `demo3.1`
- Docker Engine และ Docker Compose ทำงาน
- `backend/.env` มี Supabase Staging key และ `OCR_SERVICE_TOKEN`
- `ocr-service/.env` มี `OCR_SERVICE_TOKEN` ค่าเดียวกับ Backend
- `OCR_SERVICE_TOKEN` ยาวอย่างน้อย 32 ตัวอักษร
- มีโมเดล InsightFace `buffalo_s` ที่ผ่าน checksum
- ห้ามใช้ฐานข้อมูล Production ในการทดสอบนี้

OCR image ใช้ Debian Trixie เพราะ Light OCR native addon ต้องการ glibc 2.38+
และไม่สามารถเริ่มบน Debian Bookworm ที่มี glibc 2.36 ได้

ตรวจโมเดล:

```bash
INSIGHTFACE_MODEL_ROOT=/absolute/path/to/.insightface scripts/verify_face_models.sh
```

## 2. สร้าง Docker staging configuration

```bash
cp deployment/docker/.env.example deployment/docker/.env
```

แก้ `INSIGHTFACE_MODEL_ROOT_HOST` ให้เป็น absolute path จริง เช่น:

```dotenv
INSIGHTFACE_MODEL_ROOT_HOST=/home/your-user/.insightface
```

ไฟล์ `deployment/docker/.env` ถูก Git ignore โดยอัตโนมัติ ห้าม commit ค่าเฉพาะเครื่อง
หรือ URL ภายในที่ไม่ต้องการเปิดเผย

## 3. Build และเปิด Backend/OCR

```bash
docker compose -f deployment/docker/compose.staging.yml build
docker compose -f deployment/docker/compose.staging.yml up -d
docker compose -f deployment/docker/compose.staging.yml ps
```

ดู log โดยไม่แสดงไฟล์ environment:

```bash
docker compose -f deployment/docker/compose.staging.yml logs -f --tail=100 backend ocr
```

ตรวจสุขภาพ:

```bash
curl http://127.0.0.1:8000/health/live
curl http://127.0.0.1:8000/health/ready
```

`/health/live` ตรวจ process ส่วน `/health/ready` ตรวจทั้ง Supabase และ OCR

## 4. ทดสอบกับ Frontend ในเครื่อง

คงค่าเริ่มต้นใน `deployment/docker/.env` แล้วตั้ง `frontend/.env.local`:

```dotenv
VITE_API_ORIGIN=http://127.0.0.1:8000
```

จากนั้นรัน Frontend ด้วย Node.js 22.12+ หรือ 24:

```bash
cd frontend
npm ci
npm run dev
```

## 5. เปิด HTTPS tunnel สำหรับ Vercel/Netlify Preview

เปิด terminal ใหม่:

```bash
ngrok http 8000
```

คัดลอก HTTPS URL ที่ ngrok แสดง เช่น `https://random-name.ngrok-free.app`

แก้ `deployment/docker/.env`:

```dotenv
STAGING_FRONTEND_ORIGINS=https://your-stable-preview.vercel.app
STAGING_TRUSTED_HOSTS=127.0.0.1,localhost,random-name.ngrok-free.app
```

แล้ว apply เฉพาะค่าของ Backend:

```bash
docker compose -f deployment/docker/compose.staging.yml up -d --force-recreate backend
```

ที่ Vercel/Netlify Preview ตั้งค่า:

```dotenv
VITE_SUPABASE_URL=https://YOUR_STAGING_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_STAGING_PUBLIC_KEY
VITE_API_ORIGIN=https://random-name.ngrok-free.app
```

จากนั้น redeploy Frontend Preview เพราะค่า `VITE_*` ถูกฝังตอน build

ข้อสำคัญ:

- ใช้ exact Frontend origin ใน CORS ห้ามใช้ `*`
- ngrok URL แบบสุ่มอาจเปลี่ยนเมื่อเริ่มใหม่ ต้องแก้ทั้ง Trusted Hosts และ
  `VITE_API_ORIGIN` แล้ว redeploy Frontend
- หากมี static/reserved ngrok domain ให้ใช้เพื่อให้ Staging URL คงที่
- อย่าเปิด Docker port `8000` เป็น `0.0.0.0` และอย่า publish port `3001`
- Tunnel เป็นทางเข้าสาธารณะ ให้ใช้เฉพาะข้อมูลทดสอบและปิดทันทีเมื่อจบ QA

## 6. ปิดระบบ

หยุด ngrok ด้วย `Ctrl+C` แล้วรัน:

```bash
docker compose -f deployment/docker/compose.staging.yml down
```

คำสั่งนี้ไม่ลบ Docker images และไม่ลบโมเดลบน host หากต้องการ build ใหม่:

```bash
docker compose -f deployment/docker/compose.staging.yml build --no-cache
```

## 7. Acceptance checklist ก่อน Production

- Login และ Supabase redirect ทำงานจาก Preview URL
- `/health/ready` ได้ HTTP 200
- role Student/Teacher/Admin ถูกจำกัดถูกต้อง
- QR, Liveness, OCR และ Face Recognition ผ่านบนโทรศัพท์จริง
- NFC, roster import, support attachment และ export ผ่าน
- restart containers แล้วระบบกลับมา ready
- ทดสอบ burst ด้วยข้อมูลจำลองและบันทึก CPU/RAM/p95/error rate
- ไม่มี secret ใน browser bundle, Git หรือ Docker image
- ปิด tunnel และลบข้อมูลทดสอบเมื่อจบ QA

ชุด Staging นี้ไม่แทน Production deployment: Production ต้องใช้ hostname/TLS คงที่,
environment secrets แยก, Supabase Production ที่ผ่าน migration review, monitoring,
backup/restore และ rollback ที่ทดสอบแล้ว
