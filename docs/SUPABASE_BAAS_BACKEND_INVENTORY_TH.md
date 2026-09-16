# คู่มือสำรวจ Supabase BaaS และโค้ด Backend ของระบบเช็คชื่อ

ปรับปรุง 16 กันยายน 2026 — เอกสารนี้เขียนใหม่จากซอร์สโค้ดใน repository และการตรวจ Supabase โปรเจกต์ที่เชื่อมต่อแบบอ่านอย่างเดียวในวันเดียวกัน ไม่ใช่คำสั่งให้สร้างตารางใหม่หรือเปิดเผยข้อมูลจริงของนักศึกษา ค่าใน Cloud เปลี่ยนได้ภายหลัง จึงควรใช้ขั้นตอนตรวจซ้ำในข้อ 11 ก่อนสรุปสถานะ Production

> ความปลอดภัย: ห้ามส่งออก API secret/service-role key, OAuth client secret, access token, PIN hash, face embedding, raw biometric frame, รายชื่อนักศึกษา หรือเนื้อหาคำร้องลง Git, issue, screenshot หรือไฟล์คู่มือนี้ ใช้คำสั่งดู *โครงสร้าง* ก่อนดูแถวข้อมูล และจำกัดผู้มีสิทธิ์ Dashboard ตามหน้าที่

## 1. คำตอบสั้น ๆ: อะไรอยู่ Cloud และอะไรอยู่เครื่อง Backend

| ส่วน | อยู่ที่ใด | หน้าที่ |
| --- | --- | --- |
| React/Vite/PWA | Vercel หรือ static host | UI, Google sign-in, QR/camera, ส่ง Bearer token ไป API; ไม่มี server secret |
| Supabase Auth | Supabase Cloud | บัญชีผู้ใช้, Google OAuth, session/access token, callback/redirect |
| PostgreSQL + PostgREST | Supabase Cloud | 18 ตาราง `public`, RLS, index/constraint, trigger, 18 ฟังก์ชันที่ตรวจพบ |
| Storage | Supabase Cloud | bucket private `student-request-files` เก็บไฟล์แนบคำร้อง |
| Realtime | Supabase Cloud | publication สำหรับ `attendance_records` เท่านั้นตามสถานะที่ตรวจพบ |
| Edge Functions | Supabase Cloud | **ยังไม่มีฟังก์ชันที่ deploy** ณ วันตรวจสอบ |
| FastAPI + InsightFace/PAD | Mini PC / Docker Backend | ตรวจสิทธิ์, ธุรกิจ, challenge/QR, ใบหน้า, ไฟล์แนบ, API `/api/v1/*` |
| OCR Service | Mini PC / Docker network ภายใน | อ่านรหัสจากรูปบัตรตอนลงทะเบียนใบหน้า; Browser ไม่เรียกตรง |
| Nginx | Mini PC | รับ HTTPS และส่งต่อไป FastAPI ที่ bind ภายใน |

ภาพรวมการไหลของข้อมูล:

```text
Browser/โทรศัพท์ ── Google OAuth ──> Supabase Auth
        │                                │ session/JWT
        ├─ public Supabase client ──────┤ (เฉพาะข้อมูลที่ RLS อนุญาต)
        │
        └─ HTTPS + Bearer JWT ──> Nginx ──> FastAPI
                                            ├─ ตรวจ JWT กับ Supabase Auth
                                            ├─ อ่าน role ปัจจุบันจาก profiles
                                            ├─ CRUD/RPC/Storage ผ่าน server-only Supabase client
                                            ├─ InsightFace/PAD ใน Backend container
                                            └─ OCR container ผ่าน private Docker network
```

ข้อสำคัญ: “Backend Cloud” ของโปรเจกต์นี้ไม่ได้หมายถึง FastAPI รันใน Supabase Edge Functions ตัว Python API และ OCR ยังรันบน Mini PC; Supabase ให้บริการ Auth, Postgres, Storage, Realtime และ RPC ของฐานข้อมูล

## 2. เริ่มดูโค้ดจาก VS Code และ Terminal

1. เปิดโฟลเดอร์ราก `AttendanceDemo1.2` ใน VS Code (File → Open Folder).
2. เปิด Terminal ในโฟลเดอร์รากและตรวจ branch ก่อนอ่าน/แก้: `git status --short --branch`.
3. ใช้ `rg --files backend frontend/src supabase/migrations deployment` เพื่อเห็นไฟล์ที่เกี่ยวข้อง.
4. เปิดไฟล์ผ่าน Explorer หรือใช้ `code backend/core/config.py`; หากคำสั่ง `code` ไม่พร้อม ให้เปิดจาก Explorer แทน.
5. ค้นชื่อ route, table, env หรือฟังก์ชันด้วย `rg -n 'ข้อความที่ต้องการ' backend frontend/src supabase/migrations`.
6. อย่าเปิด `backend/.env`, `deployment/docker/.env`, `/etc/km-attendance/*.env` หรือ secret จริงขึ้นหน้าจอที่กำลังแชร์; อ่านไฟล์ `.example` และไฟล์ Python/TS ที่ใช้ตัวแปรแทน.

แผนที่ไฟล์:

| ไฟล์/โฟลเดอร์ | อ่านเพื่อเข้าใจเรื่องใด |
| --- | --- |
| [`frontend/src/lib/supabaseClient.ts`](../frontend/src/lib/supabaseClient.ts) | สร้าง browser client จาก `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` |
| [`frontend/src/features/auth/Login.tsx`](../frontend/src/features/auth/Login.tsx), [`frontend/src/App.tsx`](../frontend/src/App.tsx) | Google OAuth, redirect กลับ origin ปัจจุบัน, session และ route ตาม role |
| [`frontend/src/services/http.ts`](../frontend/src/services/http.ts) | API origin, Authorization header, temporary-admin grant ใน memory |
| [`backend/core/config.py`](../backend/core/config.py), [`backend/.env.example`](../backend/.env.example) | server-only Supabase client, env, CORS, host และขีดจำกัด |
| [`backend/core/security.py`](../backend/core/security.py), [`backend/core/authorization.py`](../backend/core/authorization.py) | ตรวจ token, domain email, role, owner ของรายวิชา/session |
| [`backend/main.py`](../backend/main.py), [`backend/routers/`](../backend/routers) | FastAPI, route ตรวจใบหน้า/คาบ/NFC/คำร้อง/แอดมิน |
| [`backend/services/`](../backend/services) | ลอจิก InsightFace, liveness, OCR adapter, export, roster, support |
| [`ocr-service/`](../ocr-service) | Node OCR service และ Dockerfile |
| [`supabase/migrations/`](../supabase/migrations) | SQL ที่ version control: schema, RLS, RPC, trigger, Storage policy |
| [`deployment/docker/`](../deployment/docker), [`deployment/nginx/`](../deployment/nginx) | การประกอบ Docker และ HTTPS ingress |

คำสั่งค้นหาที่ใช้บ่อย (อ่านอย่างเดียว):

```bash
rg -n '^@(app|[a-z_]+)\.(get|post|put|patch|delete)' backend/main.py backend/routers
rg -n 'supabase\.table\(|\.rpc\(|storage\.from_' backend
rg -n 'create table|create policy|create.*function|create trigger' supabase/migrations
rg -n 'student_support_attachments|student-request-files' backend supabase/migrations frontend/src
rg --files supabase/migrations | sort
```

## 3. Auth, คีย์ และเส้นแบ่งสิทธิ์

1. `Login.tsx` เรียก `supabase.auth.signInWithOAuth({ provider: 'google', ... })`; redirect กลับ origin ของหน้า Preview/Production ปัจจุบัน.
2. Supabase Auth เก็บผู้ใช้และสร้าง session/JWT. `frontend/src/App.tsx` ติดตาม session; `http.ts` แนบ `Authorization: Bearer ...` กับ Backend API.
3. `backend/core/security.py:get_current_user` ให้ Supabase ตรวจ access token, จำกัดโดเมนอีเมลสถาบัน, อ่าน `public.profiles` ใหม่ และยึด role จากฐานข้อมูล ไม่เชื่อ role ที่ Browser ส่งมา.
4. `require_roles`, `require_permanent_admin` และ `backend/core/authorization.py` ตรวจบทบาท/เจ้าของรายวิชา/สมาชิกคาบตาม endpoint. Temporary Admin ใช้ grant แยกที่ผูกกับ session และมีอายุ/การเพิกถอน.
5. Browser ใช้เฉพาะ **publishable/anon** key. `SUPABASE_KEY` อยู่เฉพาะ Backend และมีสิทธิ์สูง; ฝั่ง Backend ที่ใช้คีย์นี้ต้องตรวจ authorization เองก่อนอ่าน/เขียนทุกครั้ง เพราะคีย์อาจข้าม RLS ได้.
6. RLS ยังเป็นด่านสำคัญสำหรับ browser client และ Data API. ขณะตรวจพบว่า 18 ตาราง `public` เปิด RLS ทั้งหมด แต่ไม่ได้หมายความว่าทุก SELECT/INSERT อนุญาตทุก role; ต้องอ่าน policy รายตาราง.

ดู Dashboard ทีละขั้น: Supabase Dashboard → เลือกโปรเจกต์ระบบเช็คชื่อที่ถูกต้อง → **Authentication → Users** เพื่อดูบัญชี (อย่าคัดลอกข้อมูล) → **Authentication → Providers → Google** ดูสถานะผู้ให้บริการ → **Authentication → URL Configuration** ดู `Site URL` และ `Redirect URLs`. ค่า Google OAuth จริงและ redirect ปัจจุบันเป็นค่า Dashboard ไม่สามารถยืนยันครบจาก repo เพียงอย่างเดียว; ตรวจ Preview/Production origin ทีละรายการ. เอกสารทางการ: [Google Auth](https://supabase.com/docs/guides/auth/social-login/auth-google), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

ดู **Project Settings → API Keys** เพื่อทราบว่ามีคีย์ชนิดใด แต่ห้ามคัดลอกค่าลงเอกสารหรือ Frontend secret. ชื่อตัวแปรใน repo ยังคงเป็น `VITE_SUPABASE_ANON_KEY` และ `SUPABASE_KEY`; ให้เทียบชนิด/สิทธิ์ของค่าจริงใน Dashboard ก่อนหมุนคีย์หรือเปลี่ยนประเภท.

## 4. ตาราง `public` ทั้ง 18 ตาราง

รายการด้านล่างเป็น *schema/หน้าที่* ที่ตรวจพบ ไม่ใช่ข้อมูลแถวจริง. คอลัมน์ `id` เป็น UUID เว้นตารางเชื่อมที่ใช้ composite key ตาม SQL; คอลัมน์เวลาเป็น timestamp ที่ควรอ่านตาม UTC/แสดงใน UI เป็นเวลาไทย. ตรวจชนิด/constraint/FK ล่าสุดด้วย Table Editor และ SQL ในข้อ 11.

| ตาราง | คอลัมน์สำคัญที่ตรวจพบ | ความหมาย/ความสัมพันธ์ |
| --- | --- | --- |
| `profiles` | `id`, `email`, `full_name`, `student_id`, `role`, `face_registered`, `created_at`, `face_embedding`, `nfc_uid`, `academic_year`, `class_level` | โปรไฟล์ผูก `auth.users`; role student/teacher/admin; embedding และ NFC เป็นข้อมูลอ่อนไหว ไม่ export |
| `courses` | `id`, `course_code`, `course_name`, `teacher_id`, `created_at`, `section`, `total_sessions`, `late_threshold_minutes`, `absent_threshold_minutes`, `max_absence_percent`, `year`, `semester` | รายวิชา/กลุ่ม/เจ้าของวิชาและเกณฑ์มาเรียน-สาย-ขาด |
| `enrollments` | `id`, `course_id`, `student_id` | ความสัมพันธ์นักศึกษา↔รายวิชา ใช้ตรวจสิทธิ์เช็คชื่อ/คำร้อง |
| `attendance_sessions` | `id`, `course_id`, `opened_by`, `qr_token`, `qr_refresh_rate_seconds`, `grace_period_minutes`, `status`, `created_at`, `closed_at`, `qr_token_rotated_at` | คาบที่เปิด/ปิดและ QR token หมุนเวียน; token ห้ามเผยแพร่ |
| `attendance_records` | `id`, `session_id`, `student_id`, `check_in_time`, `status`, `method`, `similarity_score` | ผลเช็คชื่อรายคน/คาบ; Realtime publication ใช้ตารางนี้ |
| `attendance_checkin_challenges` | `id`, `session_id`, `student_id`, `expires_at`, `consumed_at`, `created_at`, `processing_at`, `processing_token` | สิทธิ์ชั่วคราวหลังสแกน QR ป้องกันใช้ซ้ำ/แข่งขันกัน |
| `face_enrollment_challenges` | `id`, `student_user_id`, `student_id`, `expires_at`, `consumed_at`, `processing_at`, `processing_token`, `created_at` | สิทธิ์ลงทะเบียนใบหน้าครั้งเดียวหลังตรวจบัตร |
| `profile_invites` | `id`, `email`, `student_id`, `full_name`, `role`, `invited_by`, `claimed_at`, `created_at`, `academic_year`, `class_level` | คำเชิญสร้างโปรไฟล์/บัญชี |
| `profile_invite_courses` | `invite_id`, `course_id`, `created_at` | ผูกคำเชิญกับรายวิชาที่เตรียมลงทะเบียน |
| `audit_logs` | `id`, `admin_id`, `action`, `target_type`, `target_id`, `details` (`jsonb`), `created_at` | ร่องรอยการกระทำของผู้ดูแล; `details` อาจอ่อนไหว |
| `temporary_admin_requests` | `id`, `teacher_id`, `reason`, `status`, `reviewed_by`, `reviewed_at`, `review_note`, `enrollment_expires_at`, `created_at` | อาจารย์ขอสิทธิ์แอดมินชั่วคราวและผลพิจารณา |
| `temporary_admin_enrollments` | `teacher_id`, `approved_request_id`, `approved_by`, `pin_hash`, `failed_attempts`, `locked_until`, `last_failed_at`, `last_used_at`, `pin_changed_at`, `revoked_at`, `revoked_by`, `revoked_reason`, `created_at` | ลงทะเบียน PIN แบบ hash, lockout และการเพิกถอน; ห้ามอ่าน/ส่งออก hash |
| `temporary_admin_grants` | `id`, `teacher_id`, `token_hash`, `auth_session_id`, `expires_at`, `revoked_at`, `last_used_at`, `created_at` | grant อายุสั้นที่ผูก session; ห้ามอ่าน/ส่งออก hash |
| `student_support_requests` | `id`, `client_token`, `course_id`, `student_id`, `teacher_id`, `subject`, `status`, `created_at`, `updated_at`, `last_message_at` | คำร้องนักศึกษาถึงอาจารย์เจ้าของวิชา; token ใช้กันส่งซ้ำ |
| `student_support_messages` | `id`, `client_token`, `request_id`, `sender_id`, `body`, `created_at` | ข้อความในคำร้อง; trigger แตะเวลา `last_message_at` |
| `student_support_attachments` | `id`, `message_id`, `storage_path`, `original_name`, `content_type`, `size_bytes`, `created_at` | metadata ไฟล์แนบ; ตัวไฟล์อยู่ใน Storage private bucket |
| `course_join_codes` | `id`, `course_id`, `join_code`, `is_active`, `expires_at`, `usage_count`, `created_by`, `created_at`, `rotated_at` | รหัสเข้าร่วมรายวิชา อาจารย์หมุน/หมดอายุได้ |
| `course_join_requests` | `id`, `course_id`, `student_id`, `join_code_id`, `status`, `requested_at`, `reviewed_at`, `reviewed_by`, `review_note`, `updated_at` | คำขอเข้าวิชาและผลอนุมัติ; อนุมัติจึงเกิด enrollment |

ความสัมพันธ์หลัก:

```text
auth.users ── profiles
profiles(teacher) ── courses ── attendance_sessions ── attendance_records
profiles(student) ── enrollments ── courses
attendance_sessions + profiles(student) ── attendance_checkin_challenges
profiles(student) ── face_enrollment_challenges
profiles(student) + courses + profiles(teacher) ── student_support_requests
student_support_requests ── student_support_messages ── student_support_attachments
                                             └─ storage.objects (ผ่าน storage_path)
courses ── course_join_codes / course_join_requests
```

RLS ที่ตรวจพบแยกสองแนว: ตารางคำร้อง 3 ตารางและตาราง Temporary Admin 3 ตารางปิด direct browser access แล้วให้ FastAPI ตรวจผู้มีส่วนร่วม/สิทธิ์ก่อนใช้ server client; ตารางหลักอื่นมี policy รายบทบาท/เจ้าของ/สมาชิกใน migration. อย่าตีความ `RLS enabled` ว่า “ปลอดภัยครบ” โดยไม่ตรวจ grants, `SECURITY DEFINER` และ policy ล่าสุด. อ่าน [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) และ [Securing your API](https://supabase.com/docs/guides/api/securing-your-api).

## 5. Storage, ไฟล์คำร้อง และสิ่งที่เปลี่ยนในรอบนี้

Supabase Storage ที่ตรวจพบมี bucket `student-request-files` หนึ่ง bucket เป็น **private**, จำกัดไฟล์ละ 10 MiB และ MIME ที่จัดเก็บได้เป็น JPEG, PNG, WebP, PDF. Policy บน `storage.objects` ทำให้ browser role เข้า bucket นี้ตรงไม่ได้. Blob จริงอยู่ใน Storage; `student_support_attachments` เก็บเพียง path, ชื่อ, MIME, ขนาด และความสัมพันธ์กับข้อความ.

หลังปรับปรุง คำร้องรองรับ PDF และภาพนิ่งที่ถอดรหัสได้: JPG/JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC/HEIF (รวมภาพ iPhone), ICO. Backend **ไม่จัดเก็บ format ต้นฉบับทั้งหมด**: ตรวจ MIME/ข้อมูลจริง, จำกัดขนาดและมิติ, เลือกเฟรมแรกของภาพเคลื่อนไหว, ปรับ orientation, ตัด metadata แล้วแปลงเป็น JPEG หรือ PNG ก่อน upload จึงยังตรงกับ MIME ที่ bucket/table เดิมอนุญาต. SVG ไม่รองรับเพราะเป็นเอกสาร active content ได้; ไฟล์ชนิดใหม่/เสีย/เกินขนาดจะถูกปฏิเสธ. PDF ผ่านการตรวจ header/EOF และ marker อันตรายเบื้องต้น แต่การตรวจนี้ไม่เท่ากับ antivirus หรือ PDF sandbox ที่รับประกันความปลอดภัยทุกกรณี.

ลำดับการส่ง/ดาวน์โหลด:

1. นักศึกษาเลือกไฟล์ใน `frontend/src/features/support/SupportCenter.tsx` (สูงสุด 3 ไฟล์/ข้อความ, ไฟล์ละไม่เกิน 10 MiB); UI แสดงภาพตัวอย่างเมื่อ Browser รองรับ และเก็บ draft หากส่งไม่สำเร็จ.
2. `POST /api/v1/support/requests` หรือ `POST /api/v1/support/requests/{id}/messages` ไป FastAPI; `backend/core/request_limits.py` กัน request ใหญ่ก่อน multipart parse.
3. `backend/routers/support.py` ตรวจ Bearer, ความเป็นนักศึกษาของวิชา/อาจารย์เจ้าของคำร้อง, ความยาวข้อความ, client token และเรียก `backend/services/student_support_service.py` ตรวจไฟล์จริง.
4. Backend upload เข้า bucket private แล้วเพิ่ม metadata ใน `student_support_attachments`; ถ้าขั้นตอนฐานข้อมูลล้มเหลวจะพยายามลบไฟล์ที่เพิ่งอัปโหลด. Trigger `student_support_message_touch_request` อัปเดตเวลากิจกรรมของคำร้อง.
5. อาจารย์เปิดคำร้องผ่าน API ที่ตรวจว่าเป็นอาจารย์ผู้รับผิดชอบ. `GET /api/v1/support/attachments/{id}/preview` และ `/download` ตรวจผู้มีส่วนร่วม **อีกครั้ง** ก่อน Backend อ่านไฟล์จาก Storage. Preview ส่ง `inline`, download ส่ง `attachment`, ทั้งคู่ใช้ `no-store`, `nosniff` และ sandbox CSP; Browser ได้ Blob หลังผ่าน Bearer API ไม่ใช่ public Storage URL.
6. ปุ่ม `−`/`+` ในหน้าอาจารย์ปรับตัวอักษรเนื้อหาคำร้องระหว่าง 14–22 px โดยไม่แก้ข้อมูลจริงในฐานข้อมูล.

ดูใน Dashboard: **Storage → Buckets → student-request-files** เพื่อดูการตั้งค่าและจำนวนไฟล์; หลีกเลี่ยงการเปิดตัวอย่างเอกสารจริงโดยไม่จำเป็น. ดู **Database → Tables → public → student_support_attachments** เพื่อดู schema/relations. อ่าน [Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) และ [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## 6. Database Functions (RPC), Trigger และ Realtime

ตรวจพบ 18 ฟังก์ชันใน schema ที่เกี่ยวข้อง (`public`/`private`):

| ฟังก์ชัน | หน้าที่โดยสรุป |
| --- | --- |
| `private.current_profile_role`, `private.owns_course`, `private.owns_session` | helper ของ policy/การตรวจ role และ ownership; เป็น `SECURITY DEFINER` |
| `public.handle_new_user` | trigger/function สร้างหรือผูกโปรไฟล์เมื่อ Auth มีผู้ใช้ใหม่; เป็น `SECURITY DEFINER` |
| `public.bulk_set_attendance_status` | ปรับสถานะเช็คชื่อเป็นชุดแบบ transaction; เป็น `SECURITY DEFINER` |
| `public.import_course_roster`, `public.list_course_roster` | import/list รายชื่อในรายวิชาโดยตรวจขอบเขต; เป็น `SECURITY DEFINER` |
| `public.record_temporary_admin_pin_failure` | บันทึก PIN ผิดและ lockout; เป็น `SECURITY DEFINER` |
| `public.review_course_join_request` | อนุมัติ/ปฏิเสธคำขอเข้าวิชาแบบ atomic; เป็น `SECURITY DEFINER` |
| `public.touch_student_support_request` | อัปเดตเวลาเมื่อมีข้อความใหม่; เป็น `SECURITY DEFINER` และถูกเรียกโดย trigger |
| `public.claim_face_attendance_challenge`, `release_face_attendance_challenge`, `renew_face_attendance_challenge`, `finalize_face_attendance` | claim/lease/release/finalize challenge เข้าเรียนแบบครั้งเดียว; เป็น `SECURITY INVOKER` ตามที่ตรวจพบ |
| `public.claim_face_enrollment_challenge`, `release_face_enrollment_challenge`, `renew_face_enrollment_challenge`, `finalize_face_enrollment` | วงจร challenge ลงทะเบียนใบหน้า; เป็น `SECURITY INVOKER` ตามที่ตรวจพบ |

Trigger ที่ตรวจพบสำหรับคำร้อง: `student_support_message_touch_request` บน `student_support_messages` หลัง insert. Realtime publication ที่ตรวจพบมี `public.attendance_records` เท่านั้น; UI อาจใช้ polling เป็น fallback. ไม่มี Supabase Edge Function ที่ deploy ณ วันตรวจสอบ. อย่านำคำว่า RPC ไปสับสนกับ FastAPI route: RPC คือ PostgreSQL function ที่เรียกผ่าน Supabase/PostgREST.

### วิธีดู SQL ของฟังก์ชัน

Dashboard → **Database → Functions** → เลือกชื่อฟังก์ชัน → ดู definition, `security definer/invoker`, search path และสิทธิ์ `EXECUTE`. อีกวิธีคือ SQL Editor ใช้ `pg_get_functiondef` กับฟังก์ชันเฉพาะเมื่อเป็นผู้ดูแลที่ได้รับสิทธิ์; อย่าคัดลอกผลลัพธ์ที่อาจมีข้อมูลอ่อนไหวออกนอกทีม:

```sql
select n.nspname as schema_name, p.proname as function_name,
       p.prosecdef as security_definer,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
order by 1, 2;
```

สำหรับ migration ต้นฉบับ ค้นใน repo: `rg -n 'function public.finalize_face_attendance|function public.touch_student_support_request' supabase/migrations` แล้วเปิดไฟล์ SQL ที่พบ. อย่าแก้ฟังก์ชันตรงใน Production ก่อนทำ migration และทดสอบ staging.

## 7. โค้ด FastAPI แต่ละกลุ่มทำอะไร

| ตำแหน่ง | หน้าที่และข้อมูลที่แตะ |
| --- | --- |
| `backend/main.py` | สร้าง FastAPI, CORS/TrustedHost/upload-limit, `/health/live`/`ready`, QR/session, NFC, face enrollment/attendance, course endpoints |
| `backend/routers/student.py` | โปรไฟล์, ประวัติ/สถิตินักศึกษา |
| `backend/routers/teacher.py` | รายการอาจารย์, การจัดการ/ส่งออกข้อมูลที่เกี่ยวข้องกับรายวิชา |
| `backend/routers/admin.py` | งานแอดมินและ audit |
| `backend/routers/support.py` | รายวิชาที่ส่งคำร้องได้, request/message/status, preview/download ไฟล์ private |
| `backend/routers/course_membership.py` | class/join code และอนุมัติเข้าวิชา |
| `backend/routers/temporary_admin.py` | คำขอ, PIN, grant และ revoke สิทธิ์ชั่วคราว |
| `backend/services/liveness_service.py`, `liveness_frame_service.py`, `passive_pad_service.py`, `insightface_service.py` | signed challenge, PAD/anti-replay, face embedding/recognition |
| `backend/services/face_enrollment_service.py` | challenge/การลงทะเบียนใบหน้าที่ผูกกับบัญชี |
| `backend/services/light_ocr_service.py` | ส่งรูปไป OCR service ผ่าน token ภายใน |
| `backend/services/attendance_export_service.py` | แปลงผลเช็คชื่อและเกณฑ์วิชาเป็นรายงาน |
| `backend/services/student_support_service.py` | ตรวจ/normalize ไฟล์คำร้องและชื่อไฟล์/response headers |

เปิด API docs สำหรับเครื่องพัฒนาเมื่อ `APP_ENV` ไม่ใช่ `production`: `/docs` หรือ `/openapi.json` ที่ origin ของ Backend. Production ปิด docs ตาม `backend/main.py`; อย่าเปลี่ยนเพียงเพื่อให้ทุกคนดู endpoint. ค้น route จากซอร์สได้ด้วยคำสั่งข้อ 2.

## 8. Environment และการเชื่อมต่อโดยไม่เปิดเผย secret

Frontend ใช้ `frontend/.env.local.example`/`deployment/frontend.env.production.example`:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
VITE_API_ORIGIN=https://<public-api-origin>
```

`VITE_*` ถูกฝังใน bundle ตอน build จึง **ห้ามมี server secret**; `VITE_API_ORIGIN` เป็น origin เท่านั้น (ไม่มี `/api/v1` หรือ slash/path) และ Production ต้อง HTTPS. เปลี่ยน env ที่ Vercel แล้วต้อง rebuild/redeploy. OAuth Redirect URLs, Backend `CORS_ORIGINS` และ `TRUSTED_HOSTS` เป็นคนละชั้น; เปลี่ยนชื่อโดเมนต้องตรวจทั้งสามจุด.

Backend ดูตัวแปรทั้งหมดใน [`backend/.env.example`](../backend/.env.example) และการตรวจค่าใน [`backend/core/config.py`](../backend/core/config.py):

| กลุ่ม | ตัวแปรหลัก | ความหมาย |
| --- | --- | --- |
| Supabase/Environment | `SUPABASE_URL`, `SUPABASE_KEY`, `APP_ENV`, `APP_VERSION` | Cloud connection แบบ server-only และโหมดแอป |
| Web ingress | `CORS_ORIGINS`, `TRUSTED_HOSTS` | exact frontend HTTPS origins และ hostnames ที่รับ; Production ห้าม `*` |
| OCR | `OCR_SERVICE_URL`, `OCR_SERVICE_TOKEN`, `OCR_TIMEOUT_SECONDS` | private OCR route/secret และ timeout |
| Face/liveness | `INSIGHTFACE_MODEL_ROOT`, `FACE_INFERENCE_CONCURRENCY`, `LIVENESS_SIGNING_KEY`, `LIVENESS_PAD_THRESHOLD`, `LIVENESS_PAD_CONCURRENCY`, `FACE_ENROLLMENT_CHALLENGE_SECONDS` | โมเดล/จำนวนงาน, signature, PAD |
| QR/รูปภาพ | `QR_REFRESH_SECONDS`, `QR_CHALLENGE_SECONDS`, `MAX_IMAGE_*`, `ATTENDANCE_VERIFY_REQUEST_MAX_BYTES` | อายุ QR/challenge และ resource limits |
| Temporary Admin | `TEMP_ADMIN_PIN_PEPPER`, `TEMP_ADMIN_GRANT_SECONDS`, `TEMP_ADMIN_ENROLLMENT_SECONDS`, `TEMP_ADMIN_MAX_PIN_ATTEMPTS`, `TEMP_ADMIN_LOCK_SECONDS` | hash/อายุ/lockout |
| Support/Import | `SUPPORT_ATTACHMENT_MAX_BYTES`, `SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE`, `SUPPORT_UPLOAD_REQUEST_MAX_BYTES`, `ROSTER_IMPORT_REQUEST_MAX_BYTES` | ขนาดไฟล์/จำนวนไฟล์/request |

Production Compose ที่ [`deployment/docker/compose.production.yml`](../deployment/docker/compose.production.yml) build Backend กับ OCR แยก container, OCR เปิดเพียงใน Docker network; Backend bind `127.0.0.1:8000` เป็นค่าเริ่มต้นให้ Nginx ส่งต่อ. โมเดลใบหน้าถูก mount แบบ read-only. Nginx config ตัวอย่างอยู่ที่ [`deployment/nginx/attendance-api-only.conf.example`](../deployment/nginx/attendance-api-only.conf.example); ดูคู่มือ deployment เต็มที่ [`deployment/docker/README_TH.md`](../deployment/docker/README_TH.md). การอธิบายนี้ไม่ใช่การยืนยันว่า Mini PC ปัจจุบันใช้ env/รุ่น container ตรงกับ repo; ตรวจการ deploy จริงแยกต่างหาก.

## 9. Migration: คำสั่ง SQL อยู่ที่ไหน และควรใช้เมื่อใด

ตรวจพบ 19 migration ที่ประยุกต์ใน Cloud ณ วันตรวจสอบ และ repository มีไฟล์ใน `supabase/migrations/` สอดคล้องกับชุด schema/security ของระบบ. เปิดเรียงลำดับ timestamp จะเห็นวิวัฒนาการของ RLS, invite, temporary admin, support, join code, roster และ face challenge.

1. เปิด `supabase/migrations/` ใน VS Code แล้วเรียงไฟล์ตามชื่อ.
2. ค้น `create table`, `alter table`, `create policy`, `create function`, `create trigger`, `storage.buckets` เพื่อดูว่าคำสั่งต้นฉบับสร้างอะไร.
3. ไป Supabase Dashboard → **Database → Migrations** เพื่อดูประวัติที่ Cloud ประยุกต์จริง (ชื่อเมนูอาจเปลี่ยนตาม Dashboard รุ่น); เทียบ timestamp กับไฟล์ใน repo.
4. ถ้าต้องแก้ schema ให้สร้างไฟล์ migration ใหม่ใน branch ทดสอบ, review security/rollback, ทดสอบกับฐานข้อมูลแยกก่อน แล้วจึง deploy; อย่าแก้ SQL เก่าเพื่อหวังให้ Cloud ย้อนประยุกต์เอง.
5. การปรับไฟล์คำร้องรอบนี้ **ไม่ต้อง migration** เพราะจัดเก็บภาพใหม่เป็น JPEG/PNG ซึ่งผ่าน constraint ของ bucket/table เดิม. ต้อง deploy Backend image ใหม่เพื่อให้รองรับ HEIC/AVIF ฯลฯ และ endpoint `/download`; จากนั้น deploy Frontend ใหม่.

## 10. วิธีดูใน Supabase Dashboard แบบทีละหน้าจอ

1. เข้าสู่ Dashboard ด้วยบัญชีผู้ดูแลที่ได้รับสิทธิ์ เลือกโปรเจกต์ให้ตรงกับ `VITE_SUPABASE_URL`/`SUPABASE_URL` โดยเทียบ project reference **บนเครื่องตนเอง**; อย่าโพสต์ URL/private config.
2. **Database → Tables → schema `public`**: เปิดตารางแต่ละตัว, ดู Columns, Primary/Foreign keys, Constraints, Indexes และ RLS Policies. เริ่มจาก `courses`, `enrollments`, `attendance_sessions`, `attendance_records`, `student_support_*` เพื่อเห็นความสัมพันธ์.
3. **Database → Functions**: ดู 18 ฟังก์ชันด้านบน, `SECURITY DEFINER`, `search_path`, grants และ SQL definition. **Database → Triggers** (หรือ SQL Editor) ดู trigger อัปเดตคำร้อง.
4. **Database → Publications / Replication**: ตรวจว่าตารางใดเปิด Realtime; วันที่ตรวจพบ `attendance_records` เท่านั้น.
5. **Storage → Buckets**: เปิด `student-request-files`, ตรวจ private, allowed MIME, 10 MiB และ Policies; อย่าทดสอบด้วย public URL เพราะการถูกปฏิเสธเป็นพฤติกรรมที่ตั้งใจ.
6. **Authentication → Providers/Users/URL Configuration**: ดู Google, account/session และ redirect. การมอง Users มีข้อมูลส่วนบุคคล จึงใช้เฉพาะเมื่อจำเป็นและไม่ export.
7. **Edge Functions**: ตรวจรายการ deploy; วันที่ตรวจพบไม่มี. **Logs/Observability**: ใช้สำหรับวิเคราะห์ error โดยระวัง token/PII ใน filter หรือ screenshot.
8. **Project Settings → API Keys**: ตรวจชนิดคีย์/การหมุนคีย์โดยไม่คัดลอกค่า. ถ้ามีแผนเปลี่ยนคีย์ ให้ประสาน deployment และทดสอบ staging ก่อน.

## 11. SQL สำรวจโครงสร้างแบบ read-only

เปิด Dashboard → **SQL Editor → New query**; วางคำสั่งทีละชุดแล้วกด Run. ชุดนี้อ่าน metadata เท่านั้น ไม่ `SELECT *` จากตารางข้อมูลและไม่เปลี่ยน Cloud. บาง view ต้องมีสิทธิ์ผู้ดูแล; ถ้าไม่มีสิทธิ์ ให้ขอผู้ดูแลตรวจแทน ไม่ยกระดับสิทธิ์ชั่วคราวเพื่อเอาข้อมูลจริง.

```sql
-- 11.1 รายชื่อตาราง public และสถานะ RLS
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

```sql
-- 11.2 คอลัมน์, ชนิดข้อมูล, nullable และ default (โครงสร้างเท่านั้น)
select table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

```sql
-- 11.3 Foreign keys ระหว่างตาราง
select conrelid::regclass as from_table, conname,
       confrelid::regclass as to_table,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'f' and connamespace = 'public'::regnamespace
order by 1, 2;
```

```sql
-- 11.4 Policy: role/command/เงื่อนไขตรวจสิทธิ์
select schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;
```

```sql
-- 11.5 Bucket metadata; ไม่อ่านไฟล์หรือ object path ของผู้ใช้
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;
```

```sql
-- 11.6 Trigger และ publication (metadata)
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;

select pubname, schemaname, tablename
from pg_publication_tables
where schemaname = 'public'
order by pubname, tablename;
```

```sql
-- 11.7 Applied migration versions (ถ้าบทบาทมีสิทธิ์เห็น schema นี้)
select version, name
from supabase_migrations.schema_migrations
order by version;
```

หาก query ข้อสุดท้ายแจ้งไม่มีคอลัมน์ `name` หรือ permission error ให้ดูหน้า Database → Migrations หรือดู schema ของ `supabase_migrations.schema_migrations` ก่อน อย่าตีความว่า migration หาย. สำหรับการตรวจความปลอดภัยเชิงลึก ต้อง review grants, `SECURITY DEFINER` และ policy SQL กับผู้รับผิดชอบฐานข้อมูลด้วย.

## 12. การตรวจหลัง deploy การเปลี่ยนไฟล์คำร้อง

1. อัปเดต Python dependencies และ rebuild Docker Backend image; ตรวจ `pillow-heif` ติดตั้งจาก `backend/requirement.txt`. ไม่ต้องแก้ bucket policy หรือ schema.
2. เปิด Backend `/health/live` และ `/health/ready` ภายในช่องทางที่อนุญาต; ตรวจ Backend/Nginx logs โดยไม่พิมพ์ Bearer token หรือไฟล์จริง.
3. ทดสอบบัญชีนักศึกษาในรายวิชาทดสอบ: ส่ง PDF, JPG/PNG, HEIC และไฟล์ภาพชนิดอื่นที่ต้องใช้จริง; ดูว่ารายการ/preview เปิดได้, รูปที่ส่งถูกแปลงเป็นภาพนิ่ง, และไฟล์ยัง private.
4. ทดสอบอาจารย์เจ้าของวิชา: เปิดคำร้อง, ดาวน์โหลด PDF/รูป, เปิดไฟล์ได้, กดขยาย/ลดตัวอักษร, ลองบนหน้าจอมือถือและ desktop.
5. ทดสอบบัญชีที่ไม่ใช่คู่สนทนา: request detail/preview/download ต้องถูกปฏิเสธ. ทดสอบ SVG, ไฟล์เสีย, เกิน 10 MiB, มากกว่า 3 ไฟล์ และ MIME ไม่ตรงโดยต้องไม่ทำให้บันทึกไฟล์ค้าง.
6. ตรวจ Server log และ Storage ว่าไม่มี orphan object หลัง error, ตรวจ duplicate-submit/client token, และทดสอบ PDF จากแหล่งที่เชื่อถือได้. ห้ามใช้เอกสารนักศึกษาจริงในการทดสอบถ้าไม่มีฐานทางกฎหมาย/นโยบายที่รองรับ.

คู่มือนี้บันทึกสถานะที่ตรวจได้ ณ วันที่ระบุเท่านั้น ไม่ได้เปลี่ยน Cloud, เปิดไฟล์ส่วนตัว หรือยืนยันค่า secret/OAuth redirect/การทำงานจริงบน Mini PC. เอกสาร Supabase อาจปรับตามรุ่นผลิตภัณฑ์ จึงควรเทียบ [เอกสารหลัก](https://supabase.com/docs) และ Dashboard ปัจจุบันเสมอ.
