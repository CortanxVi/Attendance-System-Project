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

## 8. ทางเลือก: รัน Backend และ OCR ด้วยสคริปต์แทน Docker (สำหรับทดสอบผ่าน ngrok)

ใช้เมื่อต้องการทดสอบโค้ดของ branch ปัจจุบันบนเครื่องพัฒนาโดยตรง และเปิดเฉพาะ Backend ให้ Frontend Preview
ที่โฮสต์อยู่ที่อื่น (เช่น Vercel) เรียกผ่าน ngrok สคริปต์คือ `scripts/start_backend_ngrok.sh`

```text
Vercel Preview --HTTPS--> ngrok --> uvicorn 127.0.0.1:8000 --> Light OCR 127.0.0.1:3001
                                              `--> Supabase (ตามที่ backend/.env ชี้)
```

ข้อควรรู้

- สคริปต์อ่านข้อมูล Supabase จาก `backend/.env` จึงเขียนข้อมูลลงโปรเจกต์เดียวกับที่ไฟล์นั้นชี้ ใช้เฉพาะบัญชีและวิชาทดสอบ
- Backend รันด้วย `APP_ENV=production` เพื่อปิด `/docs`, `/redoc`, `/openapi.json` และบังคับ CORS เป็น HTTPS ตรงตัว
- ต่างจาก Docker: process รันด้วยสิทธิ์ผู้ใช้ปัจจุบัน ไม่มี non-root/`cap_drop`/จำกัดหน่วยความจำของคอนเทนเนอร์
- ngrok สิ้นสุด TLS ที่ปลายทางของ ngrok ภาพใบหน้าและ access token จึงผ่านผู้ให้บริการนี้ระหว่างทาง เปิด tunnel เฉพาะช่วงทดสอบ
- บัญชี ngrok ฟรีมีโควตารายเดือน (ข้อมูลออก 1 GB, HTTP 20,000 request ตามเอกสาร ngrok) ตรวจแผนบัญชีก่อนทดสอบจำนวนมาก

### 8.1 เตรียมครั้งแรก

1. ใช้ Node.js 22.12+ (`nvm use 22`; สคริปต์พยายามโหลด nvm ให้เอง) และมี `backend/.venv`, `backend/.env`, `ocr-service/.env`
2. ถ้าเคยรัน Docker staging ให้หยุดก่อนเพื่อคืนพอร์ต 8000:
   `docker compose -f deployment/docker/compose.staging.yml down`
3. รันสคริปต์ครั้งแรก มันจะสร้างไฟล์ตั้งค่าส่วนตัวนอก repo ที่ `~/.config/km-attendance/staging.env`
   (สิทธิ์ 600) ที่มี `LIVENESS_SIGNING_KEY` และ `TEMP_ADMIN_PIN_PEPPER` ที่สุ่มให้ และ `STAGING_FRONTEND_ORIGINS`
   แล้วออกจากโปรแกรม ให้ตรวจ/แก้ไฟล์นี้ แล้วรันใหม่
   - `STAGING_FRONTEND_ORIGINS` ต้องเป็น origin แบบ `https://host` คั่นด้วย `,` ไม่มี path และไม่มี `/` ท้าย
   - ต้องเพิ่ม URL ของ Preview ของ branch ที่ทดสอบ มิฉะนั้นเบราว์เซอร์จะติด CORS
   - ห้ามส่งไฟล์นี้ใน chat หรือ commit
4. `OCR_SERVICE_TOKEN` ใน `backend/.env` และ `ocr-service/.env` ต้องตรงกันและยาวอย่างน้อย 32 ตัวอักษร

### 8.2 ใช้งาน

```bash
scripts/start_backend_ngrok.sh
```

สคริปต์เปิด ngrok ก่อนเพื่ออ่านโดเมนสาธารณะ จากนั้นเปิด OCR และ Backend (`TRUSTED_HOSTS` ใส่โดเมนนั้นให้อัตโนมัติ)
รอ `/health/ready` แล้วตรวจตัวเองสองข้อ คือเข้า `/health/live` ผ่าน ngrok ได้ 200 และ `/docs` ได้ 404
จากนั้นพิมพ์ `VITE_API_ORIGIN` ที่ต้องตั้งในโฮสต์ Frontend กด Ctrl+C เพื่อหยุดทุกอย่างรวมทั้ง tunnel

```bash
scripts/start_backend_ngrok.sh status
scripts/start_backend_ngrok.sh stop
```

ปรับพอร์ตได้ด้วย `STAGING_BACKEND_PORT` และ `STAGING_OCR_PORT` ล็อกอยู่ที่
`~/.local/state/km-attendance-staging/`

### 8.3 ฝั่ง Frontend Preview และ Supabase

- ตั้งค่า Environment Variables แบบ Preview ของ branch ที่ทดสอบตามตัวอย่าง `frontend/.env.staging.example`
  (`VITE_API_ORIGIN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) แล้ว redeploy เพราะค่าถูกฝังตอน build
- เพิ่ม URL ของ Preview ใน Supabase Authentication → URL Configuration → Redirect URLs
- ถ้า Vercel เปิด Deployment Protection ไว้ ผู้ทดสอบภายนอกอาจต้องล็อกอิน Vercel หรือใช้ลิงก์แชร์

### 8.4 โหมดทดสอบ: ไม่ต้องสแกน QR และไม่มีตัวจับเวลา (เฉพาะวิชาทดสอบ)

ใช้เมื่อต้องทดลองโมเดลใบหน้าซ้ำหลายครั้งโดยไม่ต้องให้ผู้สอนแสดง QR ทุกรอบ ระบบเปลี่ยนเฉพาะขั้น QR:
นักศึกษาที่เป็นสมาชิกวิชาทดสอบเห็นรายการคาบที่เปิดอยู่และกด "เริ่มสแกนใบหน้า" ได้ทันที

| ถูกข้าม | ยังทำงานเหมือนเดิม |
|---|---|
| QR token และการหมุน QR, ตัวกันสแกนถี่ 3 วินาที, อายุสิทธิ์ 420 วินาที (ใน test mode อายุ 4 ชั่วโมง), ตัวปิดคาบอัตโนมัติฝั่งผู้สอน | ล็อกอินและตรวจ token, บทบาท, การเป็นสมาชิกวิชา, คาบต้องเปิดอยู่, เช็คชื่อได้ครั้งเดียวต่อคาบ, Liveness (รวมเวลาภายใน), PAD, เทียบใบหน้า, บันทึกผลจริงลงฐานข้อมูล |

ประตูกันพลาด (ตรวจด้วยชุดทดสอบอัตโนมัติ)

1. เปิดได้ต่อเมื่อมี `ATTENDANCE_TEST_MODE=1` ร่วมกับ `ATTENDANCE_TEST_MODE_ACK` ที่เป็นข้อความยืนยันตรงตัว และ
   `ATTENDANCE_TEST_COURSE_IDS` ที่เป็น UUID ของรายวิชาทดสอบอย่างน้อย 1 รายวิชา มิฉะนั้น Backend ไม่ยอมเริ่มทำงาน
2. ใช้ได้เฉพาะรายวิชาในรายการ วิชาจริงที่นักศึกษาเป็นสมาชิกอยู่ถูกปฏิเสธ (403)
3. ไฟล์ติดตั้ง production ต้องไม่มีตัวแปรเหล่านี้ `scripts/production_preflight.py` และ `scripts/build_release_bundle.sh`
   ปฏิเสธ `ATTENDANCE_TEST_MODE*` และ `VITE_TEST_MODE`

วิธีใช้

1. หา UUID ของวิชาทดสอบ (ไม่ใช่รหัสวิชา เพราะรหัสเดียวกันมีได้หลายตอน/ภาคเรียน) จาก Supabase Table Editor ตาราง `courses`
2. ใส่ใน `~/.config/km-attendance/staging.env`: `STAGING_TEST_COURSE_IDS=<uuid>,<uuid>`
3. รัน `scripts/start_backend_ngrok.sh start --test-mode`
4. ใน Vercel Preview ของ branch ทดสอบ ตั้ง `VITE_TEST_MODE=1` แล้ว redeploy หน้าเว็บจะมีแถบแดง "โหมดทดสอบ"
5. ผู้สอนทดสอบเปิดคาบของวิชาทดสอบตามปกติ (จะยังเห็น QR ได้แต่ไม่จำเป็นต้องใช้) นักศึกษาทดสอบกดเริ่มสแกนใบหน้าจากรายการ

ข้อควรรู้: ผลเช็คชื่อ **ถูกบันทึกจริง** ลงฐานเดียวกับระบบ (เลือกแบบนี้แทน dry-run) จึงเช็คชื่อซ้ำในคาบเดียวไม่ได้
ต้องให้ผู้สอนปิดและเปิดคาบใหม่ สถานะ มาเรียน/สาย/ขาด ยังคำนวณจากเวลาที่ผ่านไปตามเกณฑ์ของวิชา
