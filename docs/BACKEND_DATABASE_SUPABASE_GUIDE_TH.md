# คู่มือ Backend, Database และ Supabase ของระบบบันทึกเวลาเข้าเรียน

เอกสารนี้อธิบายสถาปัตยกรรมและโค้ดของโปรเจกต์ตามสถานะที่ตรวจสอบเมื่อวันที่ 13 กันยายน 2026 ครอบคลุม Frontend, FastAPI Backend, OCR Service, Supabase Auth, PostgreSQL, Storage, Row Level Security (RLS), migration และลำดับการทำงานของฟีเจอร์สำคัญ

> ข้อควรระวัง: ห้ามคัดลอกค่า API key, access token, service-role/secret key, ข้อมูลนักศึกษา, เวกเตอร์ใบหน้า หรือ URL ภายในที่เป็นความลับลง Git, screenshot, issue หรือ log ใด ๆ

## 1. ภาพรวมระบบ

โปรเจกต์แบ่งเป็น 4 ส่วนหลัก

| ส่วน | เทคโนโลยี | หน้าที่ |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, PWA | แสดงหน้าจอ Student/Teacher/Admin, Google Login, กล้อง QR/ใบหน้า และเรียก Backend API |
| Backend | FastAPI, Python, InsightFace, ONNX Runtime | ตรวจ token/สิทธิ์, ประมวลผลธุรกิจ, ตรวจรูปและใบหน้า, อ่าน/เขียน Supabase และออก API |
| OCR Service | Node.js, Light OCR | อ่านรหัสจากภาพบัตรนักศึกษา โดยรับคำขอจาก Backend เท่านั้น |
| BaaS | Supabase Auth, PostgreSQL, Storage | ยืนยันบัญชี Google, เก็บข้อมูลระบบ, RLS, RPC transaction และไฟล์แนบคำร้อง |

เส้นทางข้อมูลหลักเป็นดังนี้

```text
โทรศัพท์หรือ Browser
  ├─ Google Login ───────────────> Supabase Auth
  └─ HTTPS /api/v1/* + Bearer JWT -> FastAPI Backend
                                      ├─ ตรวจ JWT กับ Supabase Auth
                                      ├─ อ่าน role ปัจจุบันจาก profiles
                                      ├─ อ่าน/เขียน PostgreSQL ผ่าน Supabase
                                      ├─ ประมวลผล InsightFace + Passive PAD ในเครื่อง Backend
                                      └─ เรียก OCR Service ผ่าน private/loopback network
```

Frontend ไม่ควรใช้ server key และไม่ควรเป็นผู้ตัดสินสิทธิ์ขั้นสุดท้าย แม้หน้าจอจะแยก route ตาม role แต่ Backend จะตรวจ bearer token และ role จากฐานข้อมูลใหม่ทุกคำขอ

## 2. โครงสร้างโค้ดที่ควรรู้

เปิดโฟลเดอร์รากของโปรเจกต์ใน VS Code แล้วใช้ตำแหน่งต่อไปนี้

| ตำแหน่ง | สิ่งที่อยู่ภายใน |
| --- | --- |
| `frontend/src/App.tsx` | รับ session จาก Supabase, โหลด `/api/v1/auth/me`, แยก route ตาม role |
| `frontend/src/lib/supabaseClient.ts` | สร้าง Supabase browser client จากตัวแปร `VITE_*` |
| `frontend/src/services/http.ts` | ตั้ง Axios base URL และแนบ bearer token/temporary-admin grant |
| `frontend/src/config/apiOrigin.ts` | ตรวจและ normalize URL ของ Backend |
| `frontend/src/features/auth/Login.tsx` | เริ่ม Google OAuth และกำหนด redirect กลับ origin ปัจจุบัน |
| `frontend/src/features/student/StudentHome.tsx` | ควบคุม flow เช็คชื่อ QR → ใบหน้า → ส่งผล |
| `frontend/src/features/student/QRScanner.tsx` | เปิดกล้องหลังเต็มจอ อ่าน QR และขอ challenge จาก Backend |
| `frontend/src/features/student/LivenessScanner.tsx` | เก็บหลักฐาน Passive Liveness 3 เฟรมและ mirror กล้องหน้า |
| `backend/main.py` | FastAPI app และ API หลัก เช่น Auth, OCR, Face, NFC, Session และ Course |
| `backend/core/config.py` | โหลด environment, สร้าง Supabase server client และ validate config |
| `backend/core/security.py` | ตรวจ Supabase access token, อีเมล, profile และ role |
| `backend/core/authorization.py` | ตรวจเจ้าของรายวิชา, เจ้าของ session และสมาชิกวิชา |
| `backend/routers/` | API แยก Student, Teacher, Admin, Support, Join Course และ Temporary Admin |
| `backend/services/` | business logic สำหรับ face, liveness, export, roster, support และสิทธิ์ชั่วคราว |
| `ocr-service/` | Node OCR service ซึ่งไม่ควรเปิดให้ Browser เข้าถึงโดยตรง |
| `supabase/migrations/` | SQL schema, RLS policy, function, trigger และ Storage policy ที่ version control ไว้ |
| `deployment/` | Docker Compose, Nginx, systemd และตัวอย่าง environment สำหรับ staging/production |

### วิธีค้นหาโค้ดจาก Terminal

รันจากโฟลเดอร์รากของโปรเจกต์

```bash
# ดู API ทั้งหมด
rg -n '^@(app|[a-z_]+)\.(get|post|put|patch|delete)' backend/main.py backend/routers

# ดูว่าตารางหนึ่งถูกใช้งานตรงไหน
rg -n 'attendance_sessions|attendance_records' backend frontend supabase/migrations

# ดูการตั้งค่า Supabase โดยไม่พิมพ์ค่าจริงของไฟล์ .env
sed -n '1,220p' frontend/src/lib/supabaseClient.ts
sed -n '1,220p' backend/core/config.py

# ดู migration ตามลำดับเวลา
find supabase/migrations -maxdepth 1 -type f -printf '%f\n' | sort

# ดูเฉพาะการเปิด RLS และ policy
rg -n 'enable row level security|create policy' supabase/migrations
```

อย่าใช้คำสั่ง `cat backend/.env` หรือคัดลอกหน้า API Keys มาแชร์ เพราะอาจแสดง secret ออกทาง terminal history หรือบันทึกการสนทนา

## 3. Authentication และ Authorization

### 3.1 Google Login

1. `Login.tsx` เรียก `supabase.auth.signInWithOAuth()` โดยใช้ provider `google`.
2. `redirectTo` ใช้ `window.location.origin` ดังนั้น Preview ต้องกลับ Preview และ Production ต้องกลับ Production.
3. Google ส่งผลกลับ callback ของ Supabase Auth ก่อน แล้ว Supabase ส่ง browser กลับ URL ที่อนุญาต.
4. `App.tsx` รับ session ผ่าน `onAuthStateChange()` และเก็บ access token ไว้ในหน่วยความจำ.
5. Frontend เรียก `GET /api/v1/auth/me` พร้อม `Authorization: Bearer <access-token>`.
6. `backend/core/security.py` เรียก Supabase Auth เพื่อตรวจ token แล้วอ่าน `profiles` เพื่อเอา role ล่าสุด.
7. Backend อนุญาตเฉพาะอีเมลโดเมน KMUTNB ที่ผ่านรูปแบบที่กำหนด และปฏิเสธบัญชีที่ไม่มี profile หรือ role ไม่ถูกต้อง.

### 3.2 จุดตั้งค่าใน Supabase Dashboard

เข้า Supabase Dashboard → เลือก project ที่ถูกต้อง แล้วตรวจดังนี้

1. **Authentication → Providers → Google**: เปิด Google provider และกำหนด OAuth client ID/secret.
2. **Authentication → URL Configuration**:
   - `Site URL` ให้เป็น Production URL หลัก.
   - `Redirect URLs` เพิ่ม localhost, Preview pattern ที่ควบคุมได้ และ Production URL.
   - หลีกเลี่ยง wildcard ที่กว้างเกินความจำเป็น.
3. ฝั่ง Google Cloud Console ต้องใส่ Supabase callback URL ใน Authorized redirect URIs ตามที่หน้า Google provider ของ Supabase แสดง.
4. ทดลองล็อกอิน Preview และ Production แยกกัน แล้วตรวจว่ากลับ origin เดิม ไม่ใช่บังคับกลับ Production ทุกครั้ง.

เอกสารทางการ: [Google Auth](https://supabase.com/docs/guides/auth/social-login/auth-google) และ [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

### 3.3 การแบ่งสิทธิ์

- Frontend route gate ช่วยด้าน UX เท่านั้น ไม่ใช่ security boundary.
- `require_roles(...)` ใน Backend เป็นด่านบังคับ role ของแต่ละ endpoint.
- `require_owned_course`, `require_owned_session` และ `require_course_enrollment` ป้องกันการใช้ UUID ของผู้อื่นข้ามสิทธิ์.
- Temporary Admin ใช้ token ชั่วคราวที่เก็บใน memory ฝั่ง browser และผูกกับ session; งานอ่อนไหวบางชนิดยังบังคับ permanent admin.
- RLS เป็นด่านใน PostgreSQL สำหรับกรณีมีการใช้ public/authenticated Supabase client โดยตรง.
- Backend ใช้ server-only key ซึ่งมีสิทธิ์สูง จึงต้องบังคับ authorization ใน Python ทุกครั้งและห้ามเชื่อข้อมูล role จาก request body.

## 4. Supabase Environment และ API Keys

### 4.1 Frontend

ไฟล์ local คือ `frontend/.env.local` และตัวอย่าง production คือ `deployment/frontend.env.production.example`

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-legacy-anon-key>
VITE_API_ORIGIN=https://<public-backend-host>
```

- ตัวแปรที่ขึ้นต้น `VITE_` จะถูกฝังใน JavaScript bundle ตอน build จึงต้องมีเฉพาะค่าที่เปิดเผยต่อ browser ได้.
- ห้ามใส่ service-role key หรือ secret key ใน `VITE_*`.
- `VITE_API_ORIGIN` ใช้เมื่อ Frontend กับ Backend คนละ origin; ถ้าใช้ reverse proxy แบบ same-origin ให้เว้นว่าง.
- หลังแก้ Vercel Environment Variables ต้อง redeploy เพราะ bundle เก่าไม่เปลี่ยนตามทันที.

ชื่อ `VITE_SUPABASE_ANON_KEY` ในโค้ดปัจจุบันรองรับทั้ง legacy anon key และค่าฝั่ง browser ที่เปิดเผยได้ แต่ Supabase อยู่ระหว่างเปลี่ยนไปใช้ publishable/secret keys และประกาศเลิกใช้ legacy `anon`/`service_role` ภายในปลายปี 2026 ควรวางแผนเปลี่ยนค่าฝั่ง browser เป็น publishable key และฝั่ง server เป็น secret key โดยทดสอบ SDK/สิทธิ์ก่อนเปลี่ยน Production.

### 4.2 Backend

ไฟล์ local คือ `backend/.env`; ดูรายชื่อตัวแปรจาก `backend/.env.example`

กลุ่มตัวแปรสำคัญ:

- `SUPABASE_URL`, `SUPABASE_KEY`: server connection; key ต้องเก็บเฉพาะ Backend.
- `CORS_ORIGINS`: รายการ exact HTTPS Frontend origins คั่นด้วย comma.
- `TRUSTED_HOSTS`: hostname ที่อนุญาตให้ยิงเข้า FastAPI.
- `OCR_SERVICE_URL`, `OCR_SERVICE_TOKEN`, `OCR_TIMEOUT_SECONDS`: การเชื่อม OCR ภายใน.
- `LIVENESS_SIGNING_KEY`, `LIVENESS_PAD_THRESHOLD`, `LIVENESS_PAD_CONCURRENCY`: signed challenge และ Passive PAD.
- `INSIGHTFACE_MODEL_ROOT`, `FACE_INFERENCE_CONCURRENCY`: ตำแหน่งโมเดลและจำนวนงานใบหน้าพร้อมกัน.
- `QR_REFRESH_SECONDS`, `QR_CHALLENGE_SECONDS`: อายุ token หมุนและสิทธิ์หลังสแกน QR.
- `MAX_IMAGE_*` และ request byte limits: ป้องกันไฟล์ใหญ่, decompression bomb และการใช้หน่วยความจำเกิน.
- `TEMP_ADMIN_*`: pepper, อายุ grant, จำนวนครั้ง PIN ผิดและเวลาล็อก.
- `SUPPORT_*`, `ROSTER_IMPORT_REQUEST_MAX_BYTES`: ขีดจำกัดไฟล์แนบและไฟล์ roster.

ใน Production `CORS_ORIGINS` ต้องเป็น origin แบบ `https://host` เท่านั้น ไม่มี path, ไม่มี slash ท้าย และห้าม `*`. หากมีทั้ง Preview และ Production ให้ใส่ทั้งสอง origin เช่น

```dotenv
CORS_ORIGINS=https://preview.example.test,https://attendance.example.ac.th
TRUSTED_HOSTS=api.example.ac.th,127.0.0.1,localhost
```

เอกสารทางการเรื่อง key: [Supabase API Keys](https://supabase.com/docs/guides/getting-started/api-keys)

## 5. ลำดับการทำงาน QR Check-in แบบใหม่

หน้าสแกนปัจจุบันใช้กล้องหลังเต็ม viewport หลังนักศึกษากดปุ่ม มีกรอบเล็ง, scan line, คำแนะนำ, ปุ่มย้อนกลับ, การแจ้งสถานะตรวจสอบ และ recovery เมื่อกล้องถูกปฏิเสธ/ไม่พบ/ถูกใช้งานอยู่ รูปแบบการใช้งานคล้ายเครื่องสแกน QR ของแอปธนาคาร แต่ไม่ได้เชื่อมระบบ PromptPay หรืออ่านข้อมูลการเงิน

### 5.1 ฝั่งอาจารย์เปิดคาบ

1. อาจารย์เรียก `POST /api/v1/sessions/start` พร้อม `course_id`.
2. Backend ตรวจว่าอาจารย์เป็นเจ้าของวิชาและไม่มีคาบอื่นเปิดอยู่.
3. สร้างแถว `attendance_sessions` สถานะ `open` พร้อม UUID `qr_token`.
4. ฝั่งอาจารย์แสดง QR JSON ที่มีอย่างน้อย `session_id` และ `token`.
5. ระหว่างคาบ Frontend เรียก `POST /api/v1/sessions/{session_id}/rotate-token` ตามช่วงเวลาที่กำหนด.
6. Backend เปลี่ยน `qr_token` และ `qr_token_rotated_at`; QR เก่าจึงหมดอายุเร็ว.
7. การเปลี่ยน route แล้วกลับมาเรียก `GET /api/v1/sessions/active` เพื่อกู้ session จากฐานข้อมูล ไม่ฝากสถานะสำคัญไว้ใน React component อย่างเดียว.
8. มีเพียงอาจารย์เจ้าของ session หรือผู้มีสิทธิ์ที่กำหนดเท่านั้นที่ปิดผ่าน `POST /api/v1/sessions/{session_id}/close`.

### 5.2 ฝั่งนักศึกษาสแกน

1. `StudentHome.tsx` ตรวจว่า face runtime พร้อมก่อนเปิดกล้อง.
2. `QRScanner.tsx` ขอ rear camera ด้วย `facingMode: environment` และจำกัด format เป็น `qr_code`.
3. เมื่ออ่านสำเร็จ กล้อง pause เพื่อไม่ยิง API ซ้ำ.
4. Frontend parse JSON และตรวจชนิดของ `session_id`/`token` ก่อนส่ง.
5. เรียก `POST /api/v1/sessions/{session_id}/validate`.
6. Backend ตรวจพร้อมกันหลายเงื่อนไข:
   - bearer token เป็นนักศึกษาจริง;
   - session มีอยู่และยัง `open`;
   - token ตรงกับค่าล่าสุดและยังอยู่ในกรอบเวลาที่รับได้;
   - นักศึกษาลงทะเบียนในรายวิชา;
   - ยังไม่มี attendance record ของคาบนี้;
   - ไม่สร้าง challenge ถี่เกินกำหนด.
7. Backend สร้าง `attendance_checkin_challenges` ที่มีอายุจำกัด แล้วส่ง signed liveness token แบบ protocol 3, mode `passive`, จำนวน 3 sample กลับมา.
8. หน้าจอแจ้งชื่อวิชา แล้วไปขั้นตอนกล้องหน้า.

### 5.3 Passive Liveness และ Face Matching

1. Frontend เก็บภาพต่อเนื่อง 3 เฟรมและหลักฐานการเคลื่อนไหว/ตำแหน่งใบหน้า; preview กล้องหน้าถูก mirror เพื่อให้ผู้ใช้ขยับตามธรรมชาติ.
2. Frontend ส่งภาพ 3 ไฟล์, `challenge_id`, signed `liveness_token` และ `liveness_evidence` ไป `POST /api/v1/attendance/verify`.
3. Backend ตรวจ signature, audience/user, challenge, วันหมดอายุ, session และ enrollment ซ้ำ.
4. RPC `claim_face_attendance_challenge` ล็อก challenge พร้อม processing token เพื่อกัน double-submit และ concurrent replay; งานยาวมีการ renew lease.
5. ทุกภาพผ่านการตรวจชนิดไฟล์, byte limit, dimension/pixel limit และ decode ก่อนเข้าโมเดล.
6. Passive PAD ตรวจทั้ง 3 เฟรมเพื่อคัดกรองภาพถ่ายหรือหน้าจอ ตาม threshold ที่ตั้งไว้.
7. InsightFace สกัด embedding จากภาพสด แล้วคำนวณ similarity กับ `profiles.face_embedding` ของผู้ใช้ที่ล็อกอินเท่านั้น.
8. ถ้าผ่านเกณฑ์ Backend คำนวณ `present`, `late` หรือ `absent` จากเวลาเปิดคาบและค่ารายวิชา.
9. RPC `finalize_face_attendance` บันทึก attendance แบบ atomic และ consume challenge; ถ้างานล้มเหลวก่อนจบจะ release claim ให้ลองใหม่ได้.

Passive Liveness ลด friction แต่ไม่มีระบบใดป้องกันการโกงได้ 100%. ควรทดสอบด้วยโทรศัพท์จริงหลายรุ่น, แสงต่างกัน, replay จากจอ, ภาพพิมพ์ และติดตาม false accept/false reject ก่อนใช้จริง

## 6. การลงทะเบียนใบหน้า

เส้นทางนักศึกษาปัจจุบันยังมีการตรวจบัตรเฉพาะขั้นตอนลงทะเบียนใบหน้าครั้งแรก ไม่ใช่หลังสแกน QR เช็คชื่อ

1. นักศึกษาส่งภาพบัตรไป `POST /api/v1/enrollment/liveness-challenge`.
2. Backend ส่งรูปไป OCR Service และตรวจว่ารหัสบนบัตรตรงกับ `student_id` ของบัญชี.
3. สร้าง `face_enrollment_challenges`; challenge เก่าที่ยังไม่ใช้ของบัญชีเดียวกันถูกยกเลิก.
4. นักศึกษาทำ Passive Liveness 3 เฟรม.
5. `POST /api/v1/enrollment/register-face` ตรวจ/claim challenge, ตรวจ PAD และสกัด embedding.
6. RPC `finalize_face_enrollment` เขียน embedding 512 ค่าและตั้ง `face_registered=true` แบบ atomic.
7. นักศึกษาไม่สามารถลงทะเบียนซ้ำเอง; การเปลี่ยนข้อมูลต้องผ่านผู้ดูแลระบบถาวร.

ระบบเก็บ face embedding ไม่ใช่ไฟล์ selfie ถาวรในตาราง แต่ embedding ยังเป็นข้อมูลชีวมิติที่อ่อนไหว ต้องจำกัดผู้เข้าถึง, การสำรอง, retention และการลบตามนโยบายสถาบัน

## 7. Database Schema

จาก schema ที่ตรวจแบบ read-only มี 18 ตารางใน `public` และเปิด RLS ทุกตาราง ตารางหลักสัมพันธ์ดังนี้

```text
auth.users 1──1 profiles
profiles(teacher) 1──* courses 1──* attendance_sessions 1──* attendance_records
profiles(student) *──* courses ผ่าน enrollments
profiles(student) 1──* attendance_checkin_challenges
profiles(student) 1──* face_enrollment_challenges
courses 1──1 course_join_codes 1──* course_join_requests
student_support_requests 1──* student_support_messages 1──* student_support_attachments
profile_invites *──* courses ผ่าน profile_invite_courses
temporary_admin_requests/enrollments/grants ผูกกับ profiles(teacher/admin)
```

### 7.1 ตารางตัวตนและรายวิชา

#### `profiles`

- Primary key `id` อ้างถึง `auth.users.id`.
- เก็บ `email`, `full_name`, `student_id`, `role`, `academic_year`, `class_level`.
- `role` จำกัดเป็น `student`, `teacher`, `admin`.
- `face_registered` บอกสถานะลงทะเบียน; `face_embedding` เป็น vector ชีวมิติ.
- `nfc_uid` เก็บตัวระบุ NFC แบบ unique เมื่อมีการลงทะเบียน.
- รหัสนักศึกษาและอีเมลมีข้อกำหนด unique ตาม schema.
- ปีการศึกษาที่แสดงให้นักศึกษาถูกคำนวณจากรหัสใน Backend; นักศึกษาแก้เองไม่ได้.

#### `courses`

- เก็บ `course_code`, `course_name`, `section`, `year`, `semester`.
- `teacher_id` อ้างถึงเจ้าของวิชาใน `profiles`.
- มี `total_sessions`, `late_threshold_minutes`, `absent_threshold_minutes`, `max_absence_percent` สำหรับคำนวณและรายงาน.

#### `enrollments`

- ตารางเชื่อมนักศึกษากับรายวิชา: `course_id` + `student_id`.
- ใช้ตรวจสิทธิ์สแกน QR, ดูประวัติ และเข้าถึงข้อมูลรายวิชา.

#### `profile_invites`

- เก็บคำเชิญสร้าง profile ล่วงหน้า เช่น email, student ID, ชื่อ, role และผู้เชิญ.
- `claimed_at` บอกว่าบัญชี Google มา claim แล้วหรือยัง.
- trigger/function `handle_new_user` เชื่อม auth user ใหม่กับคำเชิญและสร้าง profile.

#### `profile_invite_courses`

- ตารางเชื่อม invite กับรายวิชาที่ต้องลงทะเบียนหลัง claim.
- ใช้ composite key `invite_id`, `course_id`.

### 7.2 ตารางเช็คชื่อ

#### `attendance_sessions`

- หนึ่งแถวต่อการเปิดคาบ มี `course_id`, `opened_by`, `status`, `created_at`, `closed_at`.
- `qr_token` เป็น token ปัจจุบัน; `qr_token_rotated_at` ใช้ตรวจอายุ.
- `qr_refresh_rate_seconds` ถูกจำกัดช่วง 10–15 วินาทีในฐานข้อมูล.
- `grace_period_minutes` เก็บช่วงผ่อนผันของ session.

#### `attendance_records`

- ผลเช็คชื่อหนึ่งคนต่อ session: `session_id`, `student_id`, `check_in_time`.
- `status` เป็น `pending`, `present`, `late`, `absent`.
- `method` เป็น `face_ocr`, `nfc`, `manual`.
- `similarity_score` เก็บคะแนนกรณีตรวจใบหน้า; UI/รายงานไม่ควรตีความคะแนนเป็นความน่าจะเป็นโดยตรง.

#### `attendance_checkin_challenges`

- สิทธิ์ระยะสั้นที่ออกหลัง QR ผ่าน มี `expires_at`, `consumed_at`.
- `processing_at`, `processing_token` ทำหน้าที่เป็น lease ป้องกันคำขอพร้อมกัน/replay.
- Browser ถูกห้ามเข้าถึงโดยตรง; Backend ควบคุม lifecycle ผ่าน RPC.

#### `face_enrollment_challenges`

- challenge สำหรับลงทะเบียนใบหน้าครั้งแรก ผูก `student_user_id` และ `student_id`.
- มี expiry, consumed และ processing lease แบบเดียวกับ attendance challenge.

### 7.3 ตารางเข้าร่วมวิชา

#### `course_join_codes`

- หนึ่ง active code ต่อรายวิชาโดยแนวคิดหลัก มี `join_code`, `is_active`, `expires_at`, `usage_count`.
- code ผ่านข้อกำหนดอักขระ 8 ตัวและถูก rotate ผ่าน Backend.
- Browser ไม่อ่านตารางนี้ตรง ๆ.

#### `course_join_requests`

- คำขอของนักศึกษาเข้าวิชา มีสถานะ `pending`, `approved`, `rejected`, `cancelled`.
- ผูก course, student, code และผู้ review พร้อมเวลา/note.
- unique ต่อคู่ course/student เพื่อกันคำขอซ้ำที่ขัดแย้งกัน.

### 7.4 ตารางคำร้องนักศึกษา

#### `student_support_requests`

- หัวคำร้อง ผูก course, student, teacher; เก็บ subject, status และเวลา message ล่าสุด.
- `client_token` ช่วยให้การ retry จาก Frontend เป็น idempotent ลดรายการซ้ำ.

#### `student_support_messages`

- ข้อความในคำร้อง ผูก `request_id`, `sender_id`, body และเวลา.
- trigger `student_support_message_touch_request` อัปเดตเวลา request หลังเพิ่มข้อความ.

#### `student_support_attachments`

- metadata ของไฟล์ เช่น storage path, ชื่อเดิม, MIME และขนาด.
- เนื้อไฟล์จริงอยู่ใน private Storage bucket `student-request-files`.
- รองรับชนิดภาพที่อนุญาตและ PDF พร้อมขีดจำกัดขนาดระดับ schema/Backend.

### 7.5 ตาราง Temporary Admin และ Audit

#### `temporary_admin_requests`

- คำขอของอาจารย์เพื่อรับสิทธิ์ Admin ชั่วคราว มีเหตุผล, สถานะ, ผู้พิจารณาและวันหมดอายุ enrollment.

#### `temporary_admin_enrollments`

- เก็บ PIN hash, failed attempts, lockout, วันใช้ล่าสุดและข้อมูล revoke.
- PIN จริงไม่ควรถูกเก็บ; hash ยังต้องป้องกันด้วย pepper ฝั่ง Backend.

#### `temporary_admin_grants`

- เก็บ hash ของ grant token, auth session ที่ผูก, วันหมดอายุ/revoke/ใช้ล่าสุด.
- token ดิบส่งให้ client ครั้งเดียวและเก็บใน memory ไม่เขียน localStorage.

#### `audit_logs`

- บันทึก action ของ Admin, target type/id, details และเวลา.
- ห้ามใส่ secret, token, ภาพ/embedding หรือข้อมูลเกินจำเป็นลง `details`.

## 8. RLS, Functions, Trigger และ Storage

### 8.1 RLS ที่ตรวจพบ

- `profiles`: ผู้ใช้ดูของตนเอง; Admin ดูตาม policy.
- `courses`, `enrollments`, `attendance_sessions`, `attendance_records`: เลือกอ่านเฉพาะความสัมพันธ์ที่ได้รับอนุญาต.
- `profile_invites`, `audit_logs`: จำกัด Admin.
- challenge, course join, support และ temporary-admin tables มี policy ปฏิเสธ browser access โดยตรงและให้ผ่าน Backend.
- Storage bucket `student-request-files` เป็น private และ object policy จำกัดเป็น backend-only.

เปิดดูได้ที่ Dashboard → **Database → Tables → เลือกตาราง → Policies** หรือ **Authentication/Database → Policies** ตามหน้าตา Dashboard รุ่นปัจจุบัน

RLS ต้องเปิดพร้อม policy ที่ตั้งใจเสมอ การเปิด RLS โดยไม่มี policy จะทำให้ public/authenticated role อ่านไม่ได้ ซึ่งเป็น fail-closed ที่เหมาะกับตารางอ่อนไหว ดู [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

### 8.2 PostgreSQL Functions/RPC

ฟังก์ชันสำคัญประกอบด้วย

- `handle_new_user`: สร้าง/claim profile จาก Auth event.
- `claim_*`, `renew_*`, `release_*`, `finalize_*`: ทำ challenge lifecycle และ final write แบบ atomic.
- `list_course_roster`, `import_course_roster`: โหลดและนำเข้า roster ที่ผ่าน authorization.
- `bulk_set_attendance_status`: เปลี่ยนหลาย attendance records ใน transaction.
- `review_course_join_request`: อนุมัติ/ปฏิเสธ join request แบบสอดคล้องกัน.
- `record_temporary_admin_pin_failure`: เพิ่ม failed attempt และ lockout แบบ atomic.

ฟังก์ชัน `SECURITY DEFINER` ทำงานด้วยสิทธิ์ของ owner จึงต้องตรวจ `search_path`, ตรวจ caller ภายใน function และจำกัด `GRANT EXECUTE` ทุกครั้งที่แก้ migration ห้ามสร้าง definer function แล้วเปิดให้ `public` โดยไม่ review.

### 8.3 Storage

ไฟล์แนบคำร้องไม่ควรมี public URL ถาวร Backend จะตรวจว่าผู้เรียกเป็นคู่สนทนา แล้วอ่าน object จาก private bucket และ stream preview กลับมา การลบคำร้องหรือผู้ใช้ต้องพิจารณาลบ object ที่สัมพันธ์กันเพื่อไม่ให้เกิด orphan file

ดู [Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) และ [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

## 9. กลุ่ม Backend API

เปิด Swagger ใน development ที่ `http://127.0.0.1:8000/docs` โดยไม่ควรเปิดเอกสาร API สาธารณะถ้า deployment policy ไม่อนุญาต

| กลุ่ม | ตัวอย่าง endpoint | หน้าที่ |
| --- | --- | --- |
| Health/Auth | `/health/live`, `/health/ready`, `/api/v1/auth/me` | ตรวจ process/dependency และโหลดผู้ใช้ |
| Enrollment/Face | `/enrollment/liveness-challenge`, `/enrollment/register-face` | OCR บัตรและลงทะเบียน embedding |
| Attendance | `/attendance/verify`, `/nfc/register`, `/nfc/checkin` | เช็คชื่อด้วยใบหน้าหรือ NFC |
| Sessions | `/sessions/active`, `/sessions/start`, `/sessions/{id}/close`, `/rotate-token`, `/validate`, `/checkins` | วงจรคาบเรียนและ Dynamic QR |
| Courses | `/courses`, `/courses/{teacher_id}`, settings/update/delete | จัดการวิชาและ threshold |
| Student | `/students/me/profile`, `/students/{id}/attendance-history` | โปรไฟล์และประวัตินักศึกษา |
| Teacher | `/teacher/export/...`, `/teacher/attendance/...`, `/teacher/courses/{id}/roster/...` | รายงาน, แก้ attendance, roster/import |
| Admin | `/admin/users`, `/admin/courses`, `/admin/logs`, `/admin/export/...` | จัดการระบบและ audit |
| Membership | `/teacher/courses/{id}/join-code`, `/join-requests`, `/students/me/courses/join` | รหัสเข้าวิชาและอนุมัติสมาชิก |
| Support | `/support/courses`, `/support/requests`, messages/status/attachment preview | คำร้องระหว่างนักศึกษาและอาจารย์ |
| Temporary Admin | `/temporary-admin/...`, `/admin/temporary-admin/...` | ขอ, อนุมัติ, activate และ revoke สิทธิ์ชั่วคราว |

ทุก endpoint ที่เปลี่ยนข้อมูลต้องตรวจทั้ง authentication, role และ object-level authorization ไม่ควรเพิ่ม endpoint ใหม่ด้วยการตรวจ role อย่างเดียวหากรับ `course_id`, `session_id`, `student_id` หรือ `request_id` จาก client

## 10. Migration Workflow

ไฟล์ SQL ใน `supabase/migrations/` คือ source of truth สำหรับ schema ไม่ควรแก้ Production ผ่าน Table Editor แล้วไม่สร้าง migration เพราะ environment อื่นจะไม่ตรงกัน

### ตรวจสถานะ

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase migration list --linked
```

การตรวจล่าสุดพบ local/remote migration ตรงกัน 19 รายการ ห้ามใส่ access token หรือ project secret ใน command ที่ commit ลง script

### สร้าง migration ใหม่

```bash
npx supabase migration new describe_change_in_snake_case
```

จากนั้นแก้ไฟล์ใหม่ด้วย SQL ที่รองรับการ apply เพียงครั้งเดียว ตรวจ constraint/index/RLS/grant และทดสอบกับ Supabase แยกสำหรับ development หรือ staging

### ส่ง migration ขึ้น project ที่ link

```bash
npx supabase migration list --linked
npx supabase db push --linked
npx supabase migration list --linked
```

ก่อน `db push` ต้องตรวจว่า link ไป project ใด, สำรองข้อมูล, review SQL ที่ destructive และมี rollback/forward-fix plan โดยเฉพาะ `DROP`, type change, `NOT NULL`, unique constraint และ function privilege อย่าใช้ `db reset` กับ Production เพราะจะล้างฐานข้อมูล

ดู [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations) และ [Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)

## 11. วิธีเปิดดูข้อมูลและ SQL ใน Supabase Dashboard

1. **Table Editor**: ดูโครงสร้างและตัวอย่างข้อมูลรายตาราง ใช้เฉพาะบัญชีผู้ดูแลที่จำเป็น.
2. **Database → Tables/Policies**: ตรวจ column, key, relationship, index และ RLS.
3. **SQL Editor**: เปิด migration เพื่อเทียบ function/policy; หลีกเลี่ยงการรัน SQL แก้ Production โดยไม่มีไฟล์ migration.
4. **Storage → Buckets**: ยืนยันว่า `student-request-files` เป็น private และตรวจ object policy.
5. **Authentication → Users**: ตรวจ auth user; อย่าแก้ role จาก user metadata เพราะระบบใช้ `profiles.role`.
6. **Authentication → URL Configuration/Providers**: ตรวจ Google OAuth และ redirect.
7. **Project Settings/API Keys**: ดู public/server key ตามหน้าที่; อย่าเปิดเผยหรือดาวน์โหลดลงโฟลเดอร์ Git.
8. **Logs**: ตรวจ Auth, Postgres และ API error โดย redact token/PII ก่อนนำไปแชร์.
9. **Database Advisors/Security Advisors**: ตรวจ missing index, RLS และ security finding หลังทุก schema release.

หากใช้ SQL Editor เพื่อดู schema ควรใช้ query metadata ไม่ใช่ดึงข้อมูลนักศึกษาทั้งตาราง เช่น

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

## 12. การรัน Backend ด้วย Docker บนเครื่องพัฒนา

ชุด staging ใช้ `deployment/docker/compose.staging.yml`; Backend publish เฉพาะ loopback และ OCR อยู่ใน private Docker network

```bash
cp deployment/docker/.env.example deployment/docker/.env
# ตั้ง absolute model path และ staging origins ในไฟล์ที่ถูก ignore

docker compose -f deployment/docker/compose.staging.yml build
docker compose -f deployment/docker/compose.staging.yml up -d
docker compose -f deployment/docker/compose.staging.yml ps

curl http://127.0.0.1:8000/health/live
curl http://127.0.0.1:8000/health/ready
```

- `health/live` บอกว่า process ทำงาน.
- `health/ready` ตรวจ Supabase และ OCR ด้วย; ต้องผ่านก่อนให้รับ traffic.
- อย่า publish OCR port 3001 และอย่าเปลี่ยน Backend เป็น `0.0.0.0` โดยไม่วาง firewall/reverse proxy.
- ถ้า Frontend อยู่ Vercel แต่ Backend อยู่เครื่องนี้ ต้องมี public HTTPS hostname/tunnel คงที่, เครื่องต้องเปิดอยู่, Internet/router ต้องพร้อม และ CORS/Trusted Hosts ต้องตรง.
- ngrok process หยุดหรือเครื่องปิดเมื่อใด Backend จาก Internet จะติดต่อไม่ได้; URL แบบสุ่มอาจเปลี่ยนเมื่อเปิดใหม่. สำหรับใช้งานจริงควรใช้ domain/tunnel แบบ reserved หรือ deploy Backend บน server ที่รันตลอด พร้อม TLS, monitoring และ restart policy.

ดูขั้นตอนเฉพาะ staging เพิ่มเติมใน `deployment/docker/README_TH.md` และ production/hybrid ใน `docs/DEPLOYMENT_GUIDE_TH.md` กับ `docs/HYBRID_VERCEL_MINIPC_DEPLOYMENT_TH.md`

## 13. CORS และการเชื่อม Frontend–Backend

Browser จะส่ง preflight `OPTIONS` เมื่อ request มี Authorization หรือ custom header Backend อนุญาตเฉพาะ methods และ headers ที่ระบบใช้ รวมถึง `Authorization`, `Content-Type`, `X-Admin-Grant` และ ngrok warning header

Checklist เมื่อพบ `Access-Control-Allow-Origin` หาย:

1. ตรวจว่า public Backend URL ตอบ FastAPI จริง ไม่ใช่หน้า ngrok warning, 404 จาก proxy หรือ gateway error.
2. ตรวจ `Origin` ใน DevTools แล้วคัดลอก exact origin ไป `CORS_ORIGINS` โดยไม่ใส่ path/slash ท้าย.
3. ตรวจ hostname ของ tunnel/API ใน `TRUSTED_HOSTS`.
4. recreate Backend container หลังเปลี่ยน environment.
5. redeploy Frontend หลังเปลี่ยน `VITE_API_ORIGIN`.
6. ทดสอบ preflight และ health จาก network ภายนอก.
7. ห้ามแก้ด้วย `mode: no-cors` เพราะ response จะเป็น opaque และ JavaScript อ่านข้อมูลไม่ได้.

## 14. การตรวจสอบก่อน Release

### Frontend

```bash
cd frontend
npm run lint
npm run build
npm run test:api-origin
npm run test:liveness
npm run test:face-runtime
```

Vite รุ่นปัจจุบันต้องใช้ Node.js 20.19+ หรือ 22.12+ แนะนำ Node 22 LTS ตามเอกสารโปรเจกต์

ทดสอบหน้าจอนักศึกษาที่ความกว้างอย่างน้อย 320, 360, 390, 430 และ 480 CSS pixels รวมทั้งหน้าจอสั้น/แนวนอน ตรวจว่าไม่มี horizontal overflow, bottom navigation ไม่บัง action, safe-area ถูกต้อง และตัวอักษรยังอ่านได้เมื่อ zoom 200%

ทดสอบ QR บนโทรศัพท์จริงทั้ง iOS Safari และ Android Chrome:

- allow/deny camera แล้ว recovery ถูกต้อง;
- กล้องหลังเต็มจอและปุ่มกลับกดได้;
- QR ถูกต้อง, QR เก่า, QR วิชาอื่น, session ปิด และสแกนซ้ำ;
- สลับแอป/หมุนจอ/ล็อกจอแล้วกลับมา;
- ทดสอบ reduced motion และ screen reader;
- ทดสอบกล้องหน้า mirror, แสงน้อย, ภาพจากกระดาษ/หน้าจอ และเครือข่ายช้า.

### Backend

```bash
backend/.venv/bin/python -m unittest discover -s backend/tests
npx supabase migration list --linked
docker compose -f deployment/docker/compose.staging.yml config
docker compose -f deployment/docker/compose.staging.yml up -d
curl http://127.0.0.1:8000/health/ready
```

ก่อน Production ต้องมี backup/restore test, monitoring, log retention, incident procedure, biometric consent/retention policy, key rotation และ rollback ที่ทดลองแล้ว

## 15. สิ่งที่เปลี่ยนในหน้าจอนักศึกษารอบนี้

- ถอด custom Pull to Refresh และ indicator ออกจาก Student, Teacher และ Admin ทั้งระบบ; ใช้พฤติกรรม refresh ปกติของ browser/PWA แทน.
- หน้านักศึกษาหลักใช้ `student-page` ร่วมกัน มี padding แบบ responsive, safe-area และความกว้างสูงสุด 480px เพื่อให้สมดุลบนโทรศัพท์หลายรุ่น.
- หน้าสแกน QR เปิดเต็ม viewport, ใช้กล้องหลัง, pause ระหว่างตรวจ API, มีสถานะ success/error และ retry.
- กด Back/Escape เพื่อปิดกล้องได้, focus กลับปุ่มเปิดกล้อง, dialog มี focus trap และข้อความสำหรับ assistive technology.
- ไม่ได้แก้ schema, Backend endpoint หรือ database contract สำหรับการ redesign หน้าสแกน; payload เดิมยังเป็น `session_id` + `token` และขั้นตอนต่อไปยังเป็น Passive Liveness.

## 16. เอกสารอ้างอิง Supabase

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Google Login](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [API Keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)

