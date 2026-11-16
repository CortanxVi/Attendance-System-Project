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

### 8.4 โหมดทดสอบ: ไม่ต้องสแกน QR และไม่มีตัวจับเวลา

ใช้เมื่อต้องทดลองโมเดลใบหน้าซ้ำหลายครั้งโดยไม่ต้องให้ผู้สอนแสดง QR ทุกรอบ ระบบเปลี่ยนเฉพาะขั้น QR:
นักศึกษาที่เป็นสมาชิกวิชานั้นเห็นรายการคาบที่เปิดอยู่และกด "เริ่มสแกนใบหน้า" ได้ทันที

| ถูกข้าม | ยังทำงานเหมือนเดิม |
|---|---|
| QR token และการหมุน QR, ตัวกันสแกนถี่ 3 วินาที, อายุสิทธิ์ 420 วินาที (ใน test mode อายุ 4 ชั่วโมง), ตัวปิดคาบอัตโนมัติฝั่งผู้สอน | ล็อกอินและตรวจ token, บทบาท, การเป็นสมาชิกวิชา, คาบต้องเปิดอยู่, เช็คชื่อได้ครั้งเดียวต่อคาบ, Liveness (รวมเวลาภายใน), PAD, เทียบใบหน้า, บันทึกผลจริงลงฐานข้อมูล |

ประตูกันพลาด (ตรวจด้วยชุดทดสอบอัตโนมัติ)

1. เปิดได้ต่อเมื่อมี `ATTENDANCE_TEST_MODE=1` ร่วมกับ `ATTENDANCE_TEST_MODE_ACK` ที่เป็นข้อความยืนยันตรงตัว มิฉะนั้นไม่เปิด
2. ขอบเขตมี 2 แบบ เลือกอย่างใดอย่างหนึ่ง (ระบุทั้งสองพร้อมกัน Backend ไม่ยอมเริ่ม)
   - **ระบุวิชา (ค่าเริ่มต้น):** `ATTENDANCE_TEST_COURSE_IDS` เป็น UUID ของรายวิชา วิชานอกรายการถูกปฏิเสธ (403)
   - **ทุกวิชา:** `ATTENDANCE_TEST_ALL_COURSES_ACK` เป็นข้อความยืนยันตรงตัวอีกชุด ใช้กับทุกรายวิชาที่นักศึกษาเป็นสมาชิก
     **รวมวิชาจริง** สคริปต์เปิดแบบนี้ต่อเมื่อสั่ง `--all-courses` เท่านั้น การลบหรือเว้นรายการวิชาว่างไม่ทำให้เปิดแบบทุกวิชา
3. ไฟล์ติดตั้ง production ต้องไม่มีตัวแปรเหล่านี้ `scripts/production_preflight.py` และ `scripts/build_release_bundle.sh`
   ปฏิเสธ `ATTENDANCE_TEST_*` และ `VITE_TEST_MODE`

วิธีใช้

1. ดูรายวิชาจริงในตาราง `courses` ของ Supabase ด้วย `scripts/start_backend_ngrok.sh courses` (อ่านอย่างเดียว ไม่แสดงข้อมูลส่วนบุคคล แสดงจำนวนสมาชิกและรายชื่อที่รอเข้าสู่ระบบ) แล้วเลือก UUID ของวิชาทดสอบ ห้ามเลือกวิชาที่ `pending` มากกว่า 0 เพราะมีนักศึกษาจริงรอเข้าวิชานั้น (ใช้ UUID ไม่ใช่รหัสวิชา เพราะรหัสเดียวกันมีได้หลายตอน/ภาคเรียน)
2. ใส่ใน `~/.config/km-attendance/staging.env`: `STAGING_TEST_COURSE_IDS=<uuid>,<uuid>`
3. รัน `scripts/start_backend_ngrok.sh start --test-mode` (ใช้วิชาใน `STAGING_TEST_COURSE_IDS`)
   ถ้าต้องการให้ครอบคลุมทุกวิชาที่นักศึกษาเป็นสมาชิก รวมวิชาจริง ให้ลบบรรทัด `STAGING_TEST_COURSE_IDS` แล้วสั่ง
   `scripts/start_backend_ngrok.sh start --test-mode --all-courses` ขณะเปิดอยู่ ผู้ที่ใช้ Backend ทดสอบนี้เช็คชื่อวิชาจริงจากที่ไหนก็ได้
   โดยไม่ต้องสแกน QR และผลถูกบันทึกจริง (ดู `courses` ว่าวิชาไหนมีรายชื่อ pending ที่ยังไม่เคยล็อกอิน เพราะคนเหล่านั้นจะเข้าวิชาอัตโนมัติ)
4. ใน Vercel Preview ของ branch ทดสอบ ตั้ง `VITE_TEST_MODE=1` แล้ว redeploy หน้าเว็บจะมีแถบแดง "โหมดทดสอบ"
5. ผู้สอนทดสอบเปิดคาบของวิชาทดสอบตามปกติ (จะยังเห็น QR ได้แต่ไม่จำเป็นต้องใช้) นักศึกษาทดสอบกดเริ่มสแกนใบหน้าจากรายการ

**ในรุ่นทดสอบ (`VITE_TEST_MODE=1` หรือ `--host-frontend --test-mode`) QR ถูกซ่อนทั้งสองฝั่ง:** ฝั่งอาจารย์หลังเปิดคาบจะเห็นข้อความ
"โหมดทดสอบ: ไม่ใช้ QR Code" แทนภาพ QR (ไม่มีการสุ่ม token และไม่มีปุ่มเต็มจอ/หน้าต่างลอย) ฝั่งนักศึกษาที่เข้าร่วมวิชานั้นแล้ว
เห็นคาบใน "คาบทดสอบที่เปิดอยู่" ภายใน 2 วินาที (และทันทีเมื่อกลับมาที่แท็บ) รุ่นปกติที่ไม่ใช้ธง ยังมี QR เหมือนเดิม

**วิชาที่สร้างใหม่ต้องเพิ่มเข้ารายการวิชาทดสอบก่อน** (รายการเก็บเป็น UUID ของวิชา วิชาใหม่รหัสเดียวกับวิชาเก่าก็เป็นคนละแถว):

```bash
scripts/start_backend_ngrok.sh courses
```

```bash
scripts/start_backend_ngrok.sh add-test-course <course_id>
```

`courses` เรียงวิชาใหม่สุดก่อนและมีคอลัมน์ `test` บอกว่าวิชาไหนอยู่ในรายการแล้ว `add-test-course` ปฏิเสธวิชาที่มีรายชื่อรอเข้าสู่ระบบ
(นักศึกษาจริง) แล้วต้องหยุดและรันสคริปต์ใหม่เพื่อให้มีผล

ข้อควรรู้ (เปลี่ยนจากรุ่นก่อน): การเช็คชื่อ **ของวิชาทดสอบ** ไม่เขียนตาราง `attendance_records` อีกแล้ว ผลทุกครั้ง
(สำเร็จ/ไม่สำเร็จ, สถานะ, คะแนนความเหมือน, เหตุผลที่ไม่ผ่าน) ถูกเก็บในตาราง `face_checkin_attempts` จึงเช็คชื่อซ้ำในคาบเดียวได้ไม่จำกัด
ตารางนี้สร้างด้วยไฟล์ใน `supabase/test-only/` (นอกโฟลเดอร์ `migrations` จึงไม่ถูกรวมใน `supabase db push` ของระบบจริง) ดูหัวข้อ 8.6

### 8.5 โฮสต์ทั้งเว็บและ Backend บนเครื่องนี้ ผ่าน ngrok URL เดียว (ไม่ใช้ Vercel)

```text
ผู้ใช้ภายนอก --HTTPS--> ngrok (URL เดียว) --> เว็บเซิร์ฟเวอร์ในเครื่อง 127.0.0.1:4173
                                               ├─ /      ไฟล์เว็บที่ build ไว้ (React/PWA)
                                               └─ /api   ส่งต่อไป Backend 127.0.0.1:8079 --> Light OCR 127.0.0.1:3001
```

เปิดด้วยคำสั่งเดียว (ปิดด้วย Ctrl+C):

```bash
scripts/start_backend_ngrok.sh start --host-frontend --test-mode
```

(ตัด `--test-mode` ออกถ้าต้องการให้นักศึกษาสแกน QR ตามปกติ)

สิ่งที่สคริปต์ทำตามลำดับ

1. ตรวจ Node 22, venv, โมเดลใบหน้า, พอร์ตว่าง, ค่า `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` ใน `frontend/.env.local`
2. build เว็บด้วยค่า `VITE_API_ORIGIN` ว่าง (เรียก API แบบ `/api` ใน origin เดียวกัน) เก็บผลที่ `~/.local/state/km-attendance-staging/web-dist`
   ไม่ใช่ `frontend/dist` และใส่ `VITE_TEST_MODE=1` เฉพาะเมื่อมี `--test-mode`
3. เปิด ngrok ที่พอร์ตของเว็บ อ่านโดเมนสาธารณะ
4. เปิด Light OCR และ Backend (`APP_ENV=production` ปิด `/docs`) โดย CORS อนุญาตเฉพาะ URL ngrok นี้
5. เปิดเว็บเซิร์ฟเวอร์ (`frontend/vite.hosting.config.mts`) ฟังเฉพาะ loopback ส่งต่อเฉพาะ `/api` และปฏิเสธ Host header อื่นนอกจาก ngrok/loopback
6. ตรวจตัวเอง: `/` ต้องได้ 200, `/api/v1/auth/me` ต้องได้ 401, `/docs` ของ Backend ต้องได้ 404

ตั้งค่าที่ต้องทำเอง (ครั้งเดียว): เพิ่ม URL ngrok ที่สคริปต์พิมพ์ ใน Supabase → Authentication → URL Configuration → Redirect URLs
(โดเมน dev ของ ngrok แผนฟรีคงที่ จึงเพิ่มครั้งเดียว) ไม่ต้องตั้ง `STAGING_FRONTEND_ORIGINS` และไม่ต้องตั้งค่า Vercel ในโหมดนี้

ข้อควรรู้

- ngrok แผนฟรีแสดงหน้าเตือนครั้งแรกที่ผู้ใช้แต่ละเครื่องเข้า ต้องกด "Visit Site" หนึ่งครั้ง (ไม่ใช่ข้อผิดพลาด) หน้าเตือนนี้ข้ามฝั่งเซิร์ฟเวอร์ไม่ได้ในแผนฟรี
- ทราฟฟิก **ทั้งเว็บและ API** ผ่าน ngrok จึงใช้โควตาฟรีเร็วขึ้น (1 GB ข้อมูลออกและ 20,000 request ต่อเดือน ตามเอกสาร ngrok)
  ไฟล์เว็บที่ build มีขนาดรวมประมาณ 42 MB (ส่วนใหญ่เป็น MediaPipe WASM และโมเดลใบหน้าที่โหลดเมื่อเริ่มสแกนใบหน้าครั้งแรก)
  ขนาดที่เครื่องผู้ใช้โหลดจริงต่อเครื่องยังไม่ได้วัด
- เครื่องนี้ต้องเปิดค้างตลอดการทดสอบ และทุกครั้งที่แก้โค้ดเว็บต้องรันสคริปต์ใหม่เพื่อ build ใหม่
- `vite preview` เป็นเซิร์ฟเวอร์สำหรับทดสอบ ไม่ใช่เซิร์ฟเวอร์ production: ไม่มี rate limit ฝั่งขอบ และไม่ใช่ทางเลือกแทน Nginx/Cloudflare ที่ Mini PC
- ใช้ร่วมกับ `--test-mode` ได้ เว็บที่ build ในครั้งนั้นมีแถบแดง "โหมดทดสอบ" และอยู่ใน `web-dist` ที่เดียว ไม่ปนกับ `frontend/dist` ที่ใช้ทำไฟล์ release

### 8.6 ชุดทดสอบเต็ม: อีเมลภายนอก, ไม่ใช้บัตร/OCR, เข้าวิชา Test อัตโนมัติ, ตารางผลเช็คชื่อ

ทั้งหมดเปิดได้เฉพาะรุ่นทดสอบ (`--test-mode`) ระบบจริงคงเดิม

| ความสามารถ | ทำงานอย่างไร |
|---|---|
| อีเมลภายนอกเข้าสู่ระบบ | ต้องเปิด 2 ชั้น: (1) Backend รันด้วย `--allow-external-email` (2) ฐานข้อมูลทดสอบเปิดแฟลก `allow_external_email` ในตาราง `test_mode_flags` ค่าเริ่มต้นปิด สคริปต์ **ไม่ยอมให้ใช้ `--allow-external-email` ถ้าไม่มี `--test-database`** |
| ไม่ใช้บัตร/OCR และไม่ต้องมีรหัส นศ. | รุ่นเว็บทดสอบไม่แสดงขั้นตอนบัตร ผู้ใช้อีเมลภายนอกได้รหัสสำรอง 13 หลักที่ไม่ซ้ำ (ขึ้นต้น `0000`) ระบบจริงยังบังคับภาพบัตร (422) |
| เข้าวิชา Test อัตโนมัติ | หลังลงทะเบียนใบหน้าสำเร็จ ระบบเพิ่มนักศึกษาเข้าทุกวิชาใน `STAGING_TEST_COURSE_IDS` (ซ้ำไม่เป็นไร) |
| ตารางผลเช็คชื่อ `face_checkin_attempts` | คอลัมน์ `outcome` (success/failed), `attendance_status`, `similarity_score`, `threshold_used`, `liveness_action`, `failure_stage`, `failure_reason`, เวลา ไม่เก็บรูป เวกเตอร์ใบหน้า อีเมล หรือชื่อ |
| เช็คชื่อซ้ำไม่จำกัด | วิชาทดสอบไม่เขียน `attendance_records` และ challenge ไม่ถูกใช้ทิ้ง ปุ่ม "เช็คชื่ออีกครั้ง" ใช้ได้เรื่อยๆ |

โปรเจกต์ Supabase ทดสอบแยก (ทำโดยเจ้าของโปรเจกต์ ไม่ใส่ค่าลับในที่เก็บโค้ด)

1. สร้างโปรเจกต์ใหม่ในแดชบอร์ด Supabase (แผนฟรีจำกัด 2 โปรเจกต์ที่ใช้งาน ต้องหยุดหรือลบอันที่ไม่ใช้ก่อน)
2. คัดลอกโครงสร้างจากระบบจริงเฉพาะ schema ไม่มีข้อมูล เช่น `supabase db dump --schema-only` แล้วนำไปรันในโปรเจกต์ใหม่ (หรือรัน `supabase/migrations/*` ตามลำดับ)
3. รัน `supabase/test-only/20261113120000_test_external_email_and_face_attempts.sql` ในโปรเจกต์ใหม่เท่านั้น แล้วเปิดแฟลก:
   `update public.test_mode_flags set enabled = true where key = 'allow_external_email';`
4. ตั้ง Google provider และ Redirect URLs ของโปรเจกต์ใหม่ และ (ถ้าต้องการให้อีเมลใดก็ได้เข้าได้) ตั้ง OAuth consent screen เป็น External และ Publish
5. ใส่ค่าใน `~/.config/km-attendance/staging.env`: `STAGING_TEST_SUPABASE_URL`, `STAGING_TEST_SUPABASE_SERVICE_KEY`, `STAGING_TEST_SUPABASE_ANON_KEY`
6. วิชา "Test" ของฐานข้อมูลทดสอบใส่ใน `STAGING_TEST_DB_COURSE_IDS` (ตัวแปรแยกจาก `STAGING_TEST_COURSE_IDS` ของฐานจริง) คำสั่ง `courses` และ `add-test-course` อ่านเฉพาะฐานใน `backend/.env` จึงใช้กับฐานทดสอบไม่ได้
   ผู้สอนในฐานทดสอบต้องมีคำเชิญบทบาท teacher ก่อนเข้าสู่ระบบ เช่นรันใน SQL editor ของโปรเจกต์ทดสอบ:
   `insert into public.profile_invites (email, full_name, role) values ('<อีเมล Google ของผู้สอนทดสอบ>', 'Test Teacher', 'teacher');`
   แล้วกำหนดผู้สอนให้วิชา Test: `update public.courses set teacher_id = (select id from public.profiles where email = '<อีเมลเดียวกัน>') where course_code = 'TEST';` (หลังผู้สอนเข้าสู่ระบบครั้งแรก)
7. รัน:

```bash
scripts/start_backend_ngrok.sh start --host-frontend --test-mode --test-database --allow-external-email
```

สคริปต์ปฏิเสธถ้า URL ฐานข้อมูลทดสอบซ้ำกับ `STAGING_PROTECTED_SUPABASE_URL` (URL โปรเจกต์จริง ตั้งในไฟล์ตั้งค่าส่วนตัว และบังคับต้องมีเมื่อใช้ `--allow-external-email`) ค่าฐานข้อมูลส่งผ่าน environment ของรอบนั้นเท่านั้น ไม่แก้ `backend/.env` หรือ `frontend/.env.local` (จะชี้ไปโปรเจกต์ไหนก็ได้ ไม่มีผลกับการตรวจนี้)

**วิชาทดสอบถาวร (ฐานข้อมูลทดสอบ):** ใช้วิชา `030513702` ชื่อ `Select Topic React` section 1 ภาคเรียน 1 เป็นวิชาทดสอบตลอด
ไฟล์ `supabase/test-only/20261113130000_permanent_test_course.sql` สร้างวิชานี้เมื่อยังไม่มี (ถ้ามีแล้วคงข้อมูลเดิม) เพิ่มนักศึกษาที่ลงทะเบียนใบหน้าแล้วเข้าวิชา
และใส่ตัวกันลบ (ถ้าต้องลบจริงให้ `alter table public.courses disable trigger protect_permanent_test_course;`)
UUID ของวิชาต้องอยู่ใน `STAGING_TEST_DB_COURSE_IDS` ของไฟล์ตั้งค่าส่วนตัว ถ้าไม่ตรง นักศึกษาจะไม่เห็นคาบของวิชานี้ในหน้าเช็คชื่อ
และจะไม่ถูกเพิ่มเข้าวิชาอัตโนมัติ เมื่อแก้ไฟล์ตั้งค่าแล้วต้องหยุดและรันสคริปต์ใหม่

**คาบของวิชาทดสอบเปิดค้างตลอด (เมื่อเปิดโหมดทดสอบ):** Backend ตรวจทุก 30 วินาที (และตอนเริ่มทำงาน และทุกครั้งที่นักศึกษาโหลดรายการคาบ) ว่าวิชาทดสอบแต่ละวิชามีคาบเปิดอยู่หรือไม่
ถ้าไม่มี (เช่นผู้สอนกดปิด) จะเปิดคาบใหม่ให้ในนามผู้สอนเจ้าของวิชา วิชาต้องมีผู้สอนก่อน มิฉะนั้นจะเปิดไม่ได้ (มีคำเตือนใน log) ส่วนวิชาอื่นไม่ถูกแตะ
และจะไม่ทำงานในโหมด `--all-courses` ข้อจำกัด: ฐานข้อมูลอนุญาตให้ผู้สอนมีคาบเปิดได้ครั้งละหนึ่งคาบ ถ้าผู้สอนเปิดคาบของวิชาอื่นค้างไว้ คาบของวิชาทดสอบจะเปิดให้ไม่ได้จนกว่าจะปิดคาบนั้น
นอกจากนี้ระบบเพิ่มนักศึกษาที่ลงทะเบียนใบหน้าแล้วทุกคนเข้าวิชาทดสอบ (ตอนเริ่มทำงานและทุก 5 นาที)
สถานะที่บันทึกของวิชาทดสอบเป็น `present` เสมอเมื่อใบหน้าตรง เพราะคาบที่ไม่ปิดไม่มีเวลาเริ่มให้คำนวณ มาสาย/ขาด ส่วนวิชาปกติยังคำนวณตามเดิม
ความล้มเหลวที่เกิดตั้งแต่ขั้นตรวจ liveness ก็ถูกบันทึกลง `face_checkin_attempts` แล้ว (ยกเว้นสิทธิ์เช็คชื่อที่ไม่ถูกต้องตั้งแต่ต้น ซึ่งยังไม่รู้ว่าเป็นคาบไหน)

**อุปกรณ์ที่รองรับการสแกนใบหน้า:** Android 11 ขึ้นไป, iPhone, และคอมพิวเตอร์ที่มีกล้อง Android 10 และเก่ากว่าจะเห็นข้อความ "อุปกรณ์นี้ยังไม่รองรับการสแกนใบหน้า" ทั้งที่หน้าลงทะเบียนและก่อนเปิดกล้องสแกน
(การตรวจอ่านเวอร์ชันจริงจาก Client Hints เพราะ Chrome ล็อกเวอร์ชันใน User-Agent ไว้ที่ Android 10 ถ้าอ่านเวอร์ชันไม่ได้จะอนุญาตให้ใช้ต่อ) นี่เป็นนโยบายการรองรับที่แจ้งผู้ใช้ ไม่ใช่การควบคุมความปลอดภัย Backend ไม่พึ่งค่านี้

**การประมวลผลใบหน้าบน Android:** ใช้ GPU เป็นค่าเริ่มต้น ถอยกลับ CPU อัตโนมัติถ้า GPU เริ่มไม่ได้ (error หรือเกิน 20 วินาที) หรือประมวลผลล้มระหว่างใช้งาน iPhone ใช้ CPU ตามเดิม
ค่า blendshape (ใช้ตรวจกะพริบตา) ถูกปิดจนถึงขั้นก่อนคำสั่งกะพริบตา และไม่เปิดเลยเมื่อคำสั่งเป็น "ขยับเข้าใกล้กล้อง"
ในรุ่นทดสอบกล่องตัวเลขมุมซ้ายบนแสดง "ตัวประมวลผล: GPU/CPU" และเวลาสลับโหมดตา เพื่อเปรียบเทียบเปิด URL ต่อท้าย `?delegate=cpu` หรือ `?delegate=gpu` และ `?blendshapes=always`

### 8.7 ผมปิดหน้าผาก ตาแคบ/ตากว้าง: ผลวัดและวิธีทดสอบซ้ำ

**ผมปิดหน้าผาก (วัดกับโมเดลจริง ภาพตัวอย่างสาธารณะ 7 ใบหน้า จำลองผมม้า 3 แบบต่อระดับ)**

| ผมปิดโซนหน้าผาก | ตรวจพบหน้า | คะแนนความเหมือนต่ำสุด (เกณฑ์ผ่าน 0.45) | ตรวจภาพปลอมไม่ผ่าน |
|---|---|---|---|
| 0% | 7/7 | 1.00 | 1/7 |
| 50% | 21/21 | 0.86 | 0/21 |
| 100% (ถึงคิ้ว) | 21/21 | 0.66 | 2/21 |
| 125% (ทับคิ้ว/ตา) | 21/21 | 0.50 | 2/21 |

หมายเหตุ 2026-11-16: เกณฑ์ความเหมือนปรับเป็น 0.50 แล้ว แถว 125% (ต่ำสุด 0.50) จึงอยู่บนเส้นเกณฑ์พอดี แถวอื่นยังผ่านสบาย

ผมปิดหน้าผาก 50% ไม่ต้องปรับเกณฑ์ความเหมือนหรือการตรวจจับ สิ่งที่เพิ่มคือข้อความแนะนำ ("เปิดหน้าผากและเก็บผมที่ปิดคิ้วหรือตา ถอดแว่นหรือหน้ากาก และอยู่ในที่สว่างพอ")
ที่ขึ้นเมื่ออ่านใบหน้าไม่ได้นานเกิน 2.5 วินาที, เมื่อหมดเวลาสแกน, เมื่อ Backend หาใบหน้าไม่พบ, เมื่อคะแนนความเหมือนไม่ผ่าน และเมื่อกะพริบตาไม่ผ่าน
ข้อจำกัด: ตัวเลขข้างบนเทียบกับภาพเดียวกันที่ไม่มีผม จึงเป็นขอบบน และการตรวจภาพปลอมของภาพที่ไม่มีผมเองก็ตก 1/7 (ผลแกว่งไม่ขึ้นกับระดับผม) รันซ้ำได้ด้วย
`cd backend && OUT_DIR=/tmp/face-robustness .venv/bin/python ../scripts/evaluate_forehead_occlusion.py`

**ตาแคบ/ตากว้าง (การกะพริบตา)**
- ชุดจำลองตรรกะ: `cd frontend && npm run test:blink-profiles` (รูปตา 8 แบบ x จังหวะกะพริบ 9 แบบ x กล้อง 30/20/17/12 fps แบบละ 300 ครั้ง) และ `backend/tests/test_blink_aperture_profiles.py`
- เกณฑ์ปิดตายืดตามความกว้างตาเปิดของแต่ละคน (หน้าเว็บ 0.75 -> 0.88, Backend 0.78 -> 0.88 เมื่อตาเปิดแคบ) การกลับมาลืมตาต้อง >= 0.70 ของตอนเริ่ม
  กะพริบเร็วบนกล้อง 17 fps ผ่านจาก 25-67% เป็น 94-100% และกรณีที่ต้องปฏิเสธ (ภาพนิ่ง, ขยิบตา, หรี่ตา, พยักหน้า) ยังไม่ผ่าน
- คำสั่งบนจอเปลี่ยนเป็น "หลับตาทั้งสองข้างให้สนิทค้างไว้ราว 1 วินาที แล้วลืมตา" (ค้างไว้ผ่านครบทุกรูปตาที่ 12 fps ขึ้นไป)

**ทดสอบกับมือถือจริง (ผู้ที่ตาแคบ ตากว้าง ตาไม่เท่ากัน)** ใช้รุ่นทดสอบ แล้วอ่านกล่องตัวเลขมุมซ้ายบน:
1. บรรทัด "ตาเปิด(ฐาน) ซ้าย/ขวา" แสดงค่าความเปิดของตาตอนเริ่ม, สัดส่วนตาต่ำสุด และคะแนนบลิงก์สูงสุดใน 1 วินาทีล่าสุด ขณะหลับตาสัดส่วนต้องต่ำกว่า "เกณฑ์ปิดตา" ที่แสดงบรรทัดล่างสุด
2. ถ้ากะพริบไม่ผ่านที่ Backend ข้อความล้มเหลวในตาราง `face_checkin_attempts` จะมีวงเล็บ [วัดได้ ปิดตา ซ้าย/ขวา ..., กลับมาเปิด ..., ตาเปิดฐาน ...] ใช้ตัวเลขนี้ปรับเกณฑ์ใน `liveness_frame_service.py`
3. ให้แต่ละคนทดลอง 5 รอบ: ลืมตาปกติ, ตาโตสุด, หลับตาค้าง 1 วินาที, กะพริบเร็ว, หรี่ตา (หรี่ตาต้องไม่ผ่าน) แล้วจดตัวเลข

### 8.8 เข้าร่วมวิชาทดสอบอัตโนมัติตั้งแต่เข้าสู่ระบบ

ในโหมดทดสอบ นักศึกษาที่เข้าสู่ระบบเสร็จจะถูกเพิ่มเข้าวิชาทดสอบที่ตั้งไว้ใน `STAGING_TEST_DB_COURSE_IDS` ทันที (ผ่านคำขอ `/api/v1/auth/me` ที่แอปเรียกหลังล็อกอิน)
ไม่ต้องกรอกรหัสคลาสและไม่ต้องรอผู้สอนกดอนุมัติ เพิ่มเฉพาะบัญชีนักศึกษา (อาจารย์และผู้ดูแลไม่ถูกเพิ่ม) และจะเพิ่มซ้ำไม่ได้
ตอนเริ่มระบบ ตัวดูแลวิชาทดสอบยังเพิ่มนักศึกษาทุกบัญชีที่มีอยู่แล้วให้ด้วย (ไม่ต้องลงทะเบียนใบหน้าก่อนอีกต่อไป) ปิดโหมดทดสอบแล้วฟีเจอร์นี้ไม่ทำงาน

### 8.9 ข้อความล้มเหลวของการสแกนใบหน้า: แยกเงื่อนไขและตัวเลขที่วัดได้ (ระยะ 0)

ทุกด่านตรวจของ Backend ตอนนี้แจ้งเงื่อนไขที่ตกเพียงข้อเดียวเป็นภาษาไทย (เช่น "ศีรษะหันไปด้านข้างระหว่างสแกน", "ใบหน้าเข้าใกล้กล้องมากเกินไป", "พบใบหน้ามากกว่า 1 ใบในภาพ")
ในโหมดทดสอบ ข้อความจะลงท้ายด้วย `[รหัส <ด่าน> · ค่าที่วัดได้ (เกณฑ์ ...)]` และตาราง `face_checkin_attempts` เก็บรหัสนั้นไว้ในคอลัมน์ `failure_stage`

| รหัส | ความหมาย | ตัวเลขที่แนบ |
|---|---|---|
| `detect_none` / `detect_multi` / `detect_low_score` / `detect_landmarks` | ไม่พบหน้า / หลายใบหน้า / ใบหน้าไม่ชัด / อ่านตา-ปากไม่ได้ | จำนวนใบหน้า, คะแนนตรวจจับ (เกณฑ์ 0.50 และ 0.55) |
| `framing_small/large/center/yaw/pitch/roll/scale` | เฟรมที่ 1-3 ของการสแกนนิ่ง | ค่าที่เบี่ยงเทียบเกณฑ์ (yaw 0.14, pitch 0.18, roll 0.18, ขนาด ±22%, กลางกรอบ 0.30) และเลขเฟรม |
| `recovery_*` | เฟรมสุดท้ายหลังทำคำสั่ง | เช่นเดียวกับ framing |
| `move_closer_small/large/center/yaw/pitch` | คำสั่งขยับเข้าใกล้ | อัตราส่วนขนาดหน้า (เกณฑ์ 1.08–1.70) และมุม |
| `blink` | คำสั่งกะพริบตา | สัดส่วนตาซ้าย/ขวาตอนหลับและตอนกลับมาเปิด |
| `pad`, `pad_size` | ตรวจภาพปลอม | คะแนน "คนจริง" ต่อเฟรม ค่ากลางและค่าต่ำสุด (กฎ `median`: ค่ากลาง ≥0.60 และทุกเฟรม ≥0.30; กฎเดิม `all_frames`: ≥0.65 ทุกเฟรม), ขนาดกรอบหน้า |
| `same_person`, `static_passive`, `static_action` | ตัวตนต่อเนื่อง, ภาพนิ่ง | ความเหมือนระหว่างเฟรม (≥0.35/0.30), ความต่างระหว่างเฟรม |
| `fps`, `duration` | อัตราภาพ, ระยะเวลา | fps ที่หน้าเว็บรายงาน (เกณฑ์ 8–35), วินาทีที่ใช้ |
| `identity` | คะแนนความเหมือนกับใบหน้าที่ลงทะเบียน | คะแนนเทียบ 0.50 (เดิม 0.45, เจ้าของปรับเมื่อ 2026-11-16) |

นอกโหมดทดสอบไม่มีตัวเลขและไม่มีรหัสต่อท้าย ผู้ใช้เห็นเฉพาะประโยคภาษาไทยเงื่อนไขเดียว

### 8.10 สแกนใบหน้า: ตรวจท่าทางนิ่งก่อนเก็บภาพ และหยุดเองเมื่อเครื่องช้าเกินไป

- **ท่าทางนิ่ง (3 เฟรมแรก):** หน้าเว็บไม่เก็บเฟรมที่ท่าทางต่างจากเฟรมแรกเกิน yaw 0.08, pitch 0.09, roll (เอียง) 0.12, ขนาดหน้า ±15% หรือใบหน้าห่างกลางกรอบเกิน 0.22 แล้วบอกเหตุผลเป็นประโยค ("ถือโทรศัพท์ให้ระดับสายตา" ฯลฯ) ถ้าท่าทางยังไม่นิ่งต่อเนื่อง 2.5 วินาทีจะเริ่มเก็บใหม่ ค่าอยู่ใน `PASSIVE_POSE_LIMITS` ที่ `frontend/src/utils/liveness.ts` ตั้งให้เข้มกว่า Backend (0.14/0.18/0.18/22%)
- **อัตราภาพ:** หน้าเว็บวัด fps แบบเดียวกับ Backend ถ้าเครื่องช้ามาก (ต่ำกว่า 6 fps หลัง 24 เฟรมและ 3 วินาที) จะหยุดทันที และตรวจซ้ำตอนจบด้วยเกณฑ์ 8 fps ก่อนส่ง ข้อความแจ้งค่าที่วัดได้และบอกให้ปิดแอปอื่น/ใช้เครื่องอื่น เนื่องจากไม่ได้ส่งให้ Backend สิทธิ์ Liveness จึงยังไม่ถูกใช้ กด "ลองตรวจอีกครั้ง" ได้เลย

### 8.11 ท่าทางขณะทำคำสั่งสุ่มและเฟรมสุดท้าย: วัดเทียบเฟรมแรก

หน้าเว็บเทียบท่าทางของเฟรมคำสั่งและเฟรมสุดท้ายกับ "เฟรมแรกของ 3 เฟรมนิ่ง" (เหมือนที่ Backend ทำ) ไม่ใช้ค่ากลางของ 3 เฟรมอีกต่อไป เกณฑ์อยู่ใน `HYBRID_POSE_LIMITS` ที่ `frontend/src/utils/liveness.ts`: yaw 0.11, pitch 0.12, เอียง (roll) 0.14 (เฟรมสุดท้ายเท่านั้น), ขนาดหน้าไม่เปลี่ยนเกิน ±17% (เฟรมสุดท้าย), ห่างกลางกรอบไม่เกิน 0.22 ผู้ใช้ต้องมองตรงและถือเครื่องให้นิ่งตอนหลับตา/ขยับเข้าใกล้ และตอนลืมตากลับมา

### 8.12 รอบปรับจากข้อมูลมือถือจริง (2026-11-15): กะพริบตา, ขยับเข้าใกล้, เวลา, แสง, เก็บตัวเลขทุกครั้ง

- **กะพริบตา:** หน้าเว็บเก็บ "เฟรมที่หลับสนิทที่สุด" ระหว่างหลับตา (ไม่ใช่เฟรมแรกที่เริ่มหลับ) ต้องหลับลึก (สัดส่วนตา ≤ 0.55 ของตาเปิด และคะแนนบลิงก์ทั้งสองตา ≥ 0.50) อย่างน้อย 2 เฟรม คำสั่งบนจอเปลี่ยนเป็น "หลับตาทั้งสองข้างให้สนิทสักครู่ แล้วลืมตามองตรง" (แทน "ค้างไว้ราว 1 วินาที" ในหัวข้อ 8.7) การกะพริบเบาหรือกะพริบเองตามธรรมชาติจะไม่ถูกนับโดยตั้งใจ
- **ขยับเข้าใกล้:** หน้าเว็บต้องการขนาดหน้า 1.12–1.60 เท่าของเฟรมแรก (Backend 1.08–1.70) และบอก "เข้าใกล้อีก/ถอยออกนิดหนึ่ง"
- **เวลา:** หน้าเว็บเริ่มเก็บเฟรมนิ่งใหม่ถ้าช่องว่างเกิน 1.8 วินาที, เริ่มคำสั่งใหม่ถ้าลืมตากลับมาช้ากว่า 2.7 วินาที และตรวจกฎเวลาทั้งหมดของ Backend ก่อนส่ง ถ้าไม่ผ่านจะไม่ส่ง (สิทธิ์ยังไม่ถูกใช้)
- **คำเตือน (ไม่บล็อก):** แสงน้อย (ความสว่างเฉลี่ย < 60/255 นาน 1.5 วินาที ค่าตั้งต้นที่ยังไม่ได้วัด) และเปิดจากเบราว์เซอร์ในแอป LINE/Facebook/Instagram/WeChat/TikTok
- **ตัวเลขทุกครั้ง (โหมดทดสอบ):** คอลัมน์ `face_checkin_attempts.diagnostics` (ไฟล์ `supabase/test-only/20261115090000_face_attempt_diagnostics.sql`) เก็บคะแนน PAD ต่อเฟรม, ท่าทาง, ขนาดคำสั่ง, สัดส่วนตา (68 จุดและ 106 จุด), เวลา, fps ทั้งครั้งที่ผ่านและไม่ผ่าน เป็นตัวเลขเท่านั้น (การบันทึกตัวเลขยังเป็นโหมดทดสอบเท่านั้น) — ตั้งแต่ 2026-11-15 ระบบจริงใช้โมเดล 106 จุด (`2d106det.onnx`) เป็นกฎกะพริบตาชุดที่สองด้วย ปิดได้ด้วย `LIVENESS_BLINK_106_ENABLED=false`
- **รหัสใหม่ใน `failure_stage`:** `timing_interval`, `timing_action_span`, `timing_prompt_delay`, `timing_start`, `timing_action_early`, `timing_recovery_order`, `timing_recovery_late`, `token_*`, `evidence_*`, `sequence_*`, `blink_pose`, `pad_count`, `frames_*`
- **ประเมิน PAD (ระยะ 2):** `python3 scripts/evaluate_pad_roc.py attempts.json labels.csv` (labels: `start_iso,end_iso,label` ของช่วงทดสอบภาพปลอมที่ผู้ยินยอมทำ) เปรียบเทียบกติกา 3 แบบ และจะไม่แนะนำค่าใหม่จนกว่ามีผู้ใช้จริง ≥ 200 ครั้งและภาพปลอม ≥ 100 ครั้ง

### 8.13 ปิดแผน 4 ระยะ (2026-11-15): Android, คุณภาพภาพ, กะพริบตา 106 จุดในระบบจริง

- **Android "กรุณาอัปเดตเบราว์เซอร์":** เดิมเกิดจาก error ชั่วคราวเพียงเฟรมเดียวแล้วหยุดสแกน และข้อความนี้ทับ error จริง ตอนนี้ข้ามเฟรมที่ผิดพลาดชั่วคราว หยุดเมื่อผิดพลาดต่อเนื่อง ≥3 วินาที และแสดงข้อความตามสาเหตุจริง รุ่นทดสอบแสดงชื่อ error จริงในกล่องตัวเลข
- **คุณภาพภาพเพื่อ PAD:** รอกล้องปรับแสง 1 วินาทีก่อนเฟรมนิ่งแรก ข้ามเฟรมเบลอ JPEG 0.92 สำหรับ 3 เฟรมนิ่ง ห้ามก้ม/เงยระหว่างเฟรมนิ่ง (0.05) กติกา PAD เปลี่ยนเป็น `median` ตั้งแต่ 2026-11-15 (เจ้าของตัดสิน ดูหัวข้อด้านล่าง)
- **กะพริบตา 106 จุด (ระบบจริงทุกวิชาและการลงทะเบียน, เจ้าของอนุมัติ 2026-11-15):** ผ่านเมื่อกฎ 68 จุดเดิมผ่าน หรือ 106 จุด ≤0.50 ทั้งสองตา + 68 จุด ≤0.90 (กันภาพนิ่ง) + ลืมตากลับ ≥0.70 ทั้งสองตัววัด ค่าที่อ่านไม่ได้/NaN ถือว่าไม่ผ่าน
  - สวิตช์ `LIVENESS_BLINK_106_ENABLED` (ค่าเริ่มต้น `true`) ตั้ง `false` แล้วรีสตาร์ต Backend เพื่อกลับไปใช้กฎ 68 จุดอย่างเดียว
  - **ก่อน deploy ต้องวาง `2d106det.onnx` (จากชุด buffalo_s) คู่กับอีก 3 ไฟล์** และให้ผู้ใช้ที่รัน Backend อ่านไฟล์ได้ มิฉะนั้น preflight/systemd จะไม่เปิดระบบ
  - ใช้เวลาเพิ่มราว 7 มิลลิวินาทีต่อเฟรม (~36 มิลลิวินาทีต่อการสแกนกะพริบตา)
- **การวัดตาของหน้าเว็บ:** คิดสัดส่วนภาพแล้ว (หน่วยเดียวกับ Backend) มือถือแนวตั้งเข้มขึ้น แล็ปท็อปตรงกับ Backend มากขึ้น
- **กติกา PAD ใหม่ (2026-11-15, เจ้าของตัดสิน ใช้ทั้งระบบจริงและการลงทะเบียนใบหน้า):** ผ่านเมื่อค่ากลางของคะแนน 3 เฟรม ≥ `LIVENESS_PAD_MEDIAN_THRESHOLD` (0.60) และทุกเฟรม ≥ `LIVENESS_PAD_MIN_FRAME_FLOOR` (0.30) จากการสแกนของคนจริง 42 ครั้ง กฎเดิมปฏิเสธ 16 ครั้ง กฎใหม่ 11 ครั้ง **ยังไม่มีข้อมูลภาพปลอมจากผู้ยินยอม** จึงยังไม่ทราบอัตรายอมรับภาพปลอม สวิตช์ฉุกเฉิน `LIVENESS_PAD_RULE=all_frames` กลับไปใช้กฎเดิม (≥ `LIVENESS_PAD_THRESHOLD` 0.65 ทุกเฟรม) ได้ทันทีหลังรีสตาร์ต; preflight ไม่ยอมให้ค่ากลาง < 0.50 หรือค่าต่ำสุด < 0.20
- **สิ่งที่ยังทำไม่ได้โดยไม่มีข้อมูล:** ปรับเกณฑ์ PAD ต่อจากนี้ (ต้องมีชุดภาพปลอมจากผู้ยินยอม), ขอบท่าทางจากเปอร์เซนไทล์, ลด fps ขั้นต่ำ, งานระยะ 3 (ไม่เข้าเงื่อนไขและบางข้อลดความปลอดภัย)

### 8.14 รอบ Realme 16 Pro+ และกติกา PAD ใหม่ (2026-11-15, เจ้าของอนุมัติ)

- **PAD (ระบบจริง):** ผ่านเมื่อค่ากลางของ 3 เฟรม ≥ 0.60 และเฟรมต่ำสุด ≥ 0.30 (เดิมทุกเฟรม ≥ 0.65) ในข้อมูลคนจริง 42 สแกน ตกลดจาก 16 เหลือ 11 ครั้ง ยังไม่มีชุดภาพปลอมจากผู้ยินยอม จึงไม่รู้อัตรายอมรับภาพปลอม ตั้ง `LIVENESS_PAD_RULE=all_frames` แล้วรีสตาร์ตเพื่อกลับกติกาเดิม preflight ไม่ยอมค่ากลาง < 0.50 หรือเฟรมต่ำสุด < 0.20
- **กะพริบตา 106 จุด:** ด่านกันภาพถ่าย (68 จุด) 0.90 → 0.94 ตั้งจากข้อมูล (คนจริง 0.55–0.91, ภาพนิ่ง ≥ ~0.96) และค่าตาเปิดฐาน 106 จุดต้อง ≥ 0.10
- **สลับเป็น "ขยับเข้าใกล้":** กะพริบตาตก 2 ครั้งติด → คำสั่งถัดไปเป็นขยับเข้าใกล้ 30 นาทีหรือจนเช็คชื่อ/ลงทะเบียนสำเร็จ Backend ตัดสิน (จำในหน่วยความจำ รีสตาร์ตแล้วลืม) ตอนเช็คชื่อ Backend ส่งสิทธิ์ใหม่ (อายุไม่เกินสิทธิ์ QR เดิม) กลับมากับ error 422 ให้กดลองใหม่ได้ทันทีโดยไม่ต้องสแกน QR ใหม่
- **Android ช้า (เช่น Realme):** หน้าเว็บวัดความเร็ว GPU ช่วงแรก ถ้าช้ากว่า ~9 fps ลอง CPU แล้วเลือกตัวที่เร็วกว่า จำไว้ 7 วัน (`localStorage` คีย์ `face-delegate-choice.v1`) สลับได้ครั้งเดียวต่อรอบ
- **ขยับเข้าใกล้ง่ายขึ้น:** แถบบอกระยะสด, ถอยกลับหลังขยับเข้าใกล้ยอม ±0.15 (Backend ±0.20; ความเสี่ยงที่ยอมรับ ดู `recovery_scale` หลัง deploy)
- **เฟรมนิ่งแรก:** ต้องเห็นใบหน้าต่อเนื่อง 500 ms และมีประวัติความคมก่อน (เดิมเก็บเร็วเกินไปขณะกล้องยังปรับแสง ทำให้ PAD เฟรมแรกต่ำ)
- **อัปเดตหน้าเว็บ:** service worker ตรวจเวอร์ชันใหม่ทุก 5 นาที/เมื่อกลับมาที่หน้า และรีโหลดเมื่อไม่ได้สแกนหรือถือสิทธิ์ QR อยู่ รุ่นทดสอบแสดงรหัส build บนแถบด้านบน; หลัง PAD ตกแสดงรายการคำแนะนำ (หันเข้าแสง, ระดับสายตา 30–40 ซม., ถือนิ่ง, เช็ดเลนส์, เปิดใน Chrome/Safari)

### 8.15 ตารางเก็บผลการเช็คชื่อสำหรับเก็บข้อมูลตัวอย่าง 30–50 คน (2026-11-15, ฐานทดสอบเท่านั้น)

- **ไฟล์:** `supabase/test-only/20261115180000_pilot_checkin_log.sql` (apply แล้วที่โปรเจกต์ทดสอบ ห้าม apply ที่ระบบจริง)
- **ตาราง `public.pilot_checkin_log`:** 1 แถวต่อการสแกน 1 ครั้ง ทั้งผ่านและตก
  - คอลัมน์: `user_id` (uuid), `email`, `student_code`, `course_code`, `attempt_no` (ครั้งที่เท่าไรของคนนั้น), `outcome`, `attendance_status`, `similarity_score`, `threshold_used`, `face_match`, `liveness_action`, `failure_stage`, `failure_reason`
  - ระบบคัดลอกให้เองด้วย trigger บน `face_checkin_attempts` จึงไม่ต้องแก้ Backend ถ้าการคัดลอกมีปัญหา การเช็คชื่อยังทำงานตามปกติ
  - ตารางนี้เก็บเฉพาะการสแกนที่ระบบบันทึกลง `face_checkin_attempts` อยู่แล้ว คือวิชาทดสอบในโหมดทดสอบ
- **view `public.pilot_checkin_summary`:** 1 แถวต่อคน ได้แก่ จำนวนครั้ง, ผ่าน/ตก, ผ่านครั้งแรกหรือไม่, ต้องลองกี่ครั้งถึงผ่าน, คะแนนเฉลี่ยและต่ำสุดตอนผ่าน, สาเหตุที่ตกบ่อยที่สุด
- **อ่านผล:** ใช้ SQL Editor ของ Supabase หรือกด Export CSV ได้ทันที
  ```sql
  select * from public.pilot_checkin_summary order by attempts desc;
  select created_at, email, student_code, attempt_no, outcome, similarity_score, failure_stage, failure_reason
  from public.pilot_checkin_log order by created_at;
  ```
- **ปิด/เปิดการเก็บ:** `update public.test_mode_flags set enabled = false, updated_at = now() where key = 'pilot_checkin_log';` ใช้ `true` เพื่อเปิดใหม่
- **ข้อมูลส่วนบุคคล:** ตารางมีอีเมลและรหัสนักศึกษาอยู่คู่กับคะแนนใบหน้า
  - เก็บเฉพาะจากผู้ที่ยินยอม
  - เมื่อจบการเก็บ ให้ export แล้วลบด้วย `truncate public.pilot_checkin_log;`
  - ถ้าลบโปรไฟล์ แถวของคนนั้นจะถูกลบตาม
  - ไม่มีรูปภาพ, embedding หรือชื่อในตารางนี้
  - เบราว์เซอร์อ่านไม่ได้ (RLS ปฏิเสธทั้งหมด)
- **ระยะ B ที่ทำพร้อมกัน:**
  - `backend/.dockerignore` และ `ocr-service/.dockerignore` ไม่คัดลอก `.env.*` (เช่น `.env.old`) เข้า image แล้ว
  - เทสต์ `backend/tests/test_deploy_guards.py` บังคับ `--workers 1` ใน Dockerfile/systemd และห้าม compose override คำสั่ง เพราะการสลับเป็นขยับเข้าใกล้จำสถานะไว้ในหน่วยความจำของ process เดียว
