# Docker สำหรับ Staging และ Production

โฟลเดอร์นี้มี Compose แยกสองวัตถุประสงค์:

| ไฟล์ | ใช้เมื่อใด |
|---|---|
| `compose.staging.yml` | ทดสอบ `demo3.1` บนเครื่องพัฒนาและ Supabase Staging |
| `compose.production.yml` | รัน FastAPI และ Light OCR บน Mini PC หลัง Nginx โดยใช้ Supabase Production |

Production ใช้ secret จาก `/etc/km-attendance/backend.env` และ
`/etc/km-attendance/ocr.env` ไม่อ่าน `.env` ใน source tree และ publish FastAPI เฉพาะ
`127.0.0.1:8000` ส่วน OCR ไม่ publish host port ดูขั้นตอนทั้งหมดใน
`docs/HYBRID_VERCEL_MINIPC_DEPLOYMENT_TH.md` (ไฟล์สำรองภายในเครื่องผู้ดูแล ไม่อยู่ใน Git)

ตัวอย่างคำสั่ง Production หลังเตรียมไฟล์ env และโมเดลแล้ว:

```bash
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml \
  config --quiet
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml \
  build --pull
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml \
  up -d --remove-orphans
```

## Docker Staging บนเครื่องพัฒนา

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
- มีโมเดล InsightFace `buffalo_s` ที่ผ่าน checksum ครบ 4 ไฟล์ (`det_500m.onnx`, `w600k_mbf.onnx`, `1k3d68.onnx` และ `2d106det.onnx` ที่ใช้กับกฎกะพริบตาชุดที่สอง)
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

Frontend จะส่ง `ngrok-skip-browser-warning: 1` เฉพาะเมื่อ `VITE_API_ORIGIN`
เป็น hostname `*.ngrok-free.app` หรือ `*.ngrok-free.dev` เพื่อข้ามหน้า HTML
warning ของ ngrok Free ก่อนที่ request จะถึง FastAPI โดย Backend อนุญาต header
นี้ใน CORS preflight แล้ว ห้ามตั้ง header นี้ให้ API origin อื่นโดยไม่จำเป็น

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

## 8. ระบบตรวจใบหน้า: ค่าที่ใช้ในระบบจริงและสิ่งที่ต้องเตรียมก่อน deploy

ค่าทั้งหมดในส่วนนี้มาจากรอบปรับจูนกับโทรศัพท์จริง (branch `tuningModel`, 2026-11-12 ถึง 2026-11-17)
โหมดทดสอบที่ใช้ระหว่างปรับจูน (ไม่ใช้ QR, อีเมลภายนอก, ข้ามบัตร/OCR, เช็คชื่อซ้ำได้ไม่จำกัด,
เข้าวิชาทดสอบอัตโนมัติ, ตารางผลทดสอบ และสคริปต์ ngrok สำหรับทดสอบ) ถูกถอดออกทั้งหมดก่อนรวมเข้า `main`

### 8.1 เกณฑ์ฝั่ง Backend

| เรื่อง | ค่า | ที่อยู่ในโค้ด / สวิตช์ |
|---|---|---|
| ความเหมือนใบหน้า (1:1 กับบัญชีที่เข้าสู่ระบบ) | ≥ 0.50 | `FACE_THRESHOLD` ใน `backend/main.py` |
| ตรวจภาพปลอม (PAD) | ค่ากลางของ 3 เฟรม ≥ 0.60 และทุกเฟรม ≥ 0.30 | `LIVENESS_PAD_RULE=median` (ค่าเริ่มต้น), `LIVENESS_PAD_MEDIAN_THRESHOLD`, `LIVENESS_PAD_MIN_FRAME_FLOOR`; ตั้ง `LIVENESS_PAD_RULE=all_frames` เพื่อกลับไปใช้กฎเดิม (ทุกเฟรม ≥ `LIVENESS_PAD_THRESHOLD`) |
| กะพริบตา กฎที่สองจาก 106 จุด | เปิด | `LIVENESS_BLINK_106_ENABLED` (ค่าเริ่มต้น `true`, ตั้ง `false` เพื่อใช้กฎ 68 จุดอย่างเดียว) |
| เปลี่ยนเป็นคำสั่งขยับเข้าใกล้ | หลังกะพริบตาไม่ผ่าน 2 ครั้งติด | `backend/services/action_fallback.py` (สถานะอยู่ในหน่วยความจำ) |
| เวลา | ทำคำสั่งถึงกลับท่าเดิม ≤ 5 วินาที, ทั้งรอบ ≤ 30 วินาที | `backend/services/liveness_service.py` |

ข้อความล้มเหลวที่ผู้ใช้เห็นเป็นประโยคภาษาไทยบอกเงื่อนไขที่ไม่ผ่านเพียงข้อเดียว ไม่มีตัวเลขที่วัดได้
(`SHOW_MEASUREMENTS = False` ใน `backend/services/failure_diagnostics.py` เป็นค่าคงที่ในโค้ด ไม่ใช่ค่าตั้ง)

### 8.2 ก่อน deploy

- วางไฟล์ `2d106det.onnx` (ชุด buffalo_s) คู่กับโมเดลอีก 3 ไฟล์ และตรวจด้วย `scripts/verify_face_models.sh`
  ถ้าไฟล์หายหรือ hash ไม่ตรง ระบบจะใช้กฎ 68 จุดอย่างเดียวและบันทึกคำเตือน
- รัน Backend ด้วย `--workers 1` เพราะสถานะการเปลี่ยนเป็นคำสั่งขยับเข้าใกล้เก็บในหน่วยความจำของ process
  (บังคับโดย `backend/tests/test_deploy_guards.py`)
- รัน `python3 scripts/production_preflight.py` และ `scripts/verify_release.sh` สคริปต์จะปฏิเสธค่าตั้งของโหมดทดสอบ
  (`ATTENDANCE_TEST_*`, `VITE_TEST_MODE`) หากหลงเหลืออยู่ในไฟล์ environment
- อย่า apply SQL ทดสอบใด ๆ กับฐานข้อมูลจริง (ไฟล์เหล่านั้นถูกลบออกจาก repository แล้ว)

### 8.3 ฝั่งหน้าเว็บ (สรุปพฤติกรรม)

- เก็บ 3 เฟรมนิ่งห่างกัน 550 มิลลิวินาที เฉพาะเมื่อท่าทางใกล้เฟรมแรกและภาพไม่เบลอ
- หยุดเองพร้อมข้อความเมื่อเครื่องประมวลผลได้ช้ากว่าที่ Backend ยอมรับ (8 fps)
- Android: ใช้ GPU ก่อน วัดความเร็ว แล้วสลับเป็น CPU ด้วย worker ตัวใหม่ถ้าช้า และกู้กลับมาบน CPU หนึ่งครั้งถ้า worker ล้ม
- คำสั่งบนจอค้างอย่างน้อย 1.5 วินาที, ก่อนเปิดกล้องมีหน้าต่างเตรียมตัว (ปุ่ม "เข้าใจแล้ว" และปุ่ม X),
  ภาพสุดท้ายหลังหลับตาเก็บเมื่อตาเปิดเกือบสุดค้างไว้ 0.5 วินาที
- PWA ตรวจเวอร์ชันใหม่ทุก 5 นาทีและรีโหลดเมื่อไม่มีการสแกนหรือการส่งเช็คชื่อค้างอยู่
