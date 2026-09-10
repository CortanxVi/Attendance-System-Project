# คู่มือ Deployment สำหรับ Ubuntu Server 24.04 LTS

สถาปัตยกรรมนี้ใช้ Supabase แบบ hosted BaaS โดยให้ Mini PC รัน Nginx, Frontend แบบ static, FastAPI และ Light OCR ห้ามใช้ `start_all.sh`, `start_all.bat` หรือ Vite development server เป็น Production

ถ้าต้องการแยก Frontend ไป Vercel/Static Cloud และให้ Mini PC รันเฉพาะ API/OCR/Face inference ให้ใช้คู่มือ `docs/HYBRID_VERCEL_MINIPC_DEPLOYMENT_TH.md` และตัวติดตั้งพร้อมแฟล็ก `--api-only` แทนสถาปัตยกรรม same-origin ในเอกสารนี้

## 1. สถาปัตยกรรมและพอร์ต

```text
โทรศัพท์/Browser
       │ HTTPS :443
       ▼
     Nginx ───── static frontend
       │ /api
       ▼
 FastAPI 127.0.0.1:8000
       ├── HTTPS outbound ── Supabase Auth/Database/Storage/Realtime
       ▼
 Light OCR 127.0.0.1:3001
```

เปิด inbound เฉพาะ 80/443 Backend และ OCR ต้องไม่รับ connection จาก LAN/Internet โดยตรง

## 2. สิ่งที่ต้องเตรียม

- Ubuntu Server 24.04 LTS x86-64
- DNS hostname จริงและ TLS certificate ที่เชื่อถือได้
- Python 3.12 พร้อม `venv`, compiler และ system libraries ของ dependencies
- Node.js 22.12+ หรือ 24 ที่ `/usr/bin/node`
- Nginx, rsync, curl, OpenSSL และ Git
- Supabase Staging project แยกจาก Production
- Supabase server key สำหรับ Backend และ publishable/anon key สำหรับ Frontend
- การอนุมัติ license ของ pretrained InsightFace model เป็นลายลักษณ์อักษร

ตรวจเวอร์ชัน:

```bash
python3 --version
node --version
npm --version
nginx -v
```

## 3. เตรียม Supabase Staging

1. สร้าง project สำหรับ Staging โดยไม่ใช้ข้อมูลนักศึกษาจริง
2. ตรวจ changelog และ CLI help ก่อนใช้คำสั่ง
3. Link repository ไปยัง Staging project
4. ตรวจ migration history:

```bash
npx --no-install supabase --help
npx --no-install supabase migration list --linked
```

ประวัติ local/remote ของ repository นี้เคยต่างกันสามตำแหน่ง ห้ามรัน `db push` หรือ `migration repair` จนกว่าจะเปรียบเทียบ SQL และยืนยันว่า migration ที่ timestamp ต่างกันมีผลลัพธ์เดียวกัน หากต้องใช้ repair ให้เปิด `npx supabase migration repair --help` และเก็บหลักฐานการอนุมัติก่อน

หลัง history ตรงกัน ให้ผู้รับผิดชอบเพียงคนเดียว apply ไป Staging:

```bash
npx --no-install supabase db push --dry-run
npx --no-install supabase db push
./scripts/check_supabase_release.sh
```

ตรวจใน Dashboard เพิ่มเติม:

- RLS ของทุก table ใน exposed schema
- Security Advisor และ Performance Advisor
- Auth Site URL และ Redirect URLs แบบ exact HTTPS
- Google OAuth callback และ allowed domain
- Leaked-password protection หรือปิด password login หากใช้ Google เท่านั้น
- MFA ของเจ้าของ project/organization
- SSL/network restrictions, SMTP, backup และ PITR ตาม RPO/RTO

## 4. เตรียม environment files

บน server สร้าง:

```text
/etc/km-attendance/backend.env
/etc/km-attendance/ocr.env
/etc/km-attendance/frontend.env.production
```

ใช้ไฟล์ตัวอย่างใน `deployment/` เป็นโครง และสร้าง secret แยกกัน ห้ามใช้ค่าซ้ำ:

```bash
openssl rand -hex 32
```

ข้อกำหนดสำคัญ:

- `APP_ENV=production` และ `APP_VERSION` ตรงกับ release
- `SUPABASE_KEY` อยู่ Backend เท่านั้น
- `OCR_SERVICE_URL=http://127.0.0.1:3001`
- `CORS_ORIGINS=https://ชื่อโดเมนจริง`
- `TRUSTED_HOSTS` ใช้ hostname จริง ไม่มี wildcard
- `OCR_INCLUDE_RAW_TEXT=false`
- Frontend มีเฉพาะ Supabase URL และ publishable/anon key
- ไม่ตั้ง `VITE_API_URL`; Browser ใช้ same-origin `/api/v1`

ตั้ง permission หลังสร้าง user `kmattendance`:

```bash
sudo chown root:kmattendance /etc/km-attendance/backend.env /etc/km-attendance/ocr.env
sudo chmod 0640 /etc/km-attendance/backend.env /etc/km-attendance/ocr.env
sudo chown root:root /etc/km-attendance/frontend.env.production
sudo chmod 0644 /etc/km-attendance/frontend.env.production
```

## 5. เตรียม InsightFace model แบบ offline

วางโมเดลที่ใช้งานจริงไว้ที่:

```text
/var/lib/km-attendance/insightface/models/buffalo_s/1k3d68.onnx
/var/lib/km-attendance/insightface/models/buffalo_s/det_500m.onnx
/var/lib/km-attendance/insightface/models/buffalo_s/w600k_mbf.onnx
```

ตรวจ checksum:

```bash
INSIGHTFACE_MODEL_ROOT=/var/lib/km-attendance/insightface ./scripts/verify_face_models.sh
```

ห้ามพึ่งดาวน์โหลดโมเดลตอน service startup

## 6. สร้าง release bundle

บนเครื่องพัฒนา ให้ commit และ review ก่อนสร้าง Production bundle จาก worktree ที่ clean:

```bash
nvm use
./scripts/build_release_bundle.sh \
  --output /tmp/km-attendance-1.0.0 \
  --frontend-env /absolute/path/frontend.env.production
```

สำหรับ Staging QA จาก worktree ที่ยังไม่ commit เพิ่ม `--allow-dirty` ได้ Bundle จะถูกระบุว่าเป็น Staging และห้ามนำขึ้น Production

สคริปต์จะรัน release verification, สร้าง source copy ที่ไม่มี `.env`/private key, build frontend ด้วย `npm ci`, แล้วสร้าง metadata กับ `SHA256SUMS` ส่ง bundle ไป Mini PC ผ่าน `scp`/`rsync` over SSH และตรวจ checksum อีกครั้ง

## 7. ติดตั้ง release แบบ atomic

ก่อนรันต้องมี TLS, environment files, database migration/advisors ผ่าน และ model license ผ่านแล้ว:

```bash
sudo /absolute/path/km-attendance-1.0.0/scripts/install_production_release.sh \
  --bundle /absolute/path/km-attendance-1.0.0 \
  --release-id 1.0.0 \
  --domain attendance.example.ac.th \
  --project-ref PROJECT_REFERENCE \
  --confirm-database-ready \
  --confirm-model-license
```

สคริปต์ตรวจ checksum, Node, TLS, environment permissions, model, production preflight และ Nginx syntaxก่อนสลับ `/opt/km-attendance/current` แล้ว restart service หาก readiness ไม่ผ่านจะคืน symlink ไป release ก่อนหน้าโดยอัตโนมัติ

ตรวจหลังติดตั้ง:

```bash
sudo systemctl status km-attendance-ocr km-attendance-backend --no-pager
sudo systemctl status km-attendance-healthcheck.timer --no-pager
sudo journalctl -u km-attendance-ocr -u km-attendance-backend --since '10 minutes ago'
curl -fsS https://attendance.example.ac.th/health/live
sudo curl -fsS -H 'Host: localhost' http://127.0.0.1:8000/health/ready
```

อย่าคัดลอก access token, OCR text, student identifiers หรือ biometric data จาก log

## 8. Staging acceptance test

ใช้บัญชีและข้อมูลสังเคราะห์ทดสอบตามลำดับ:

1. Google login/logout และ session expiry
2. role matrix: anonymous, student, teacher, temporary admin, permanent admin
3. โปรไฟล์และชั้นปี 1–8
4. สร้างวิชา รหัสคลาส หมุน/ปิด/หมดอายุ และอนุมัติสมาชิก
5. roster `.xlsx`/`.csv`: valid, duplicate, formula, malformed และไฟล์เกินขนาด
6. ลงทะเบียนใบหน้า: genuine, static photo, printed photo, screen replay, wink, nod, multiple faces และ challenge replay
7. Dynamic QR: current, expired, reused, wrong course และปิดคาบ
8. เช็คชื่อใบหน้า/OCR และ NFC พร้อมตรวจ Realtime บนหน้าอาจารย์
9. คำร้อง attachment preview, unauthorized access และไฟล์อันตราย
10. export รายงานและตรวจ spreadsheet formula safety
11. burst 30 และ 40 คนด้วยภาพจำลองความละเอียดจริง
12. soak 1–2 ชั่วโมง, restart OCR/Backend, network interruption และ backup restore

บันทึกเฉพาะผล aggregate, latency, CPU/RAM, HTTP status, Request ID และหมวด error ห้ามเก็บภาพใบหน้าหรือข้อมูลนักศึกษาจริงในหลักฐานทดสอบ

## 9. Rollback

ดู release ที่มีอยู่:

```bash
sudo find /opt/km-attendance/releases -mindepth 1 -maxdepth 1 -type d -printf '%f\n'
```

ย้อน application release:

```bash
sudo /opt/km-attendance/current/scripts/rollback_production_release.sh PREVIOUS_RELEASE_ID
```

สคริปต์ตรวจ checksum สลับ symlink restart และรอ readiness หาก release ที่เลือกไม่พร้อมจะคืน symlinkเดิม Database migration ห้าม rollback ด้วยการลบหรือแก้ไฟล์ที่ apply แล้ว ให้สร้าง compensating migration ที่ review แล้วเท่านั้น

## 10. งานประจำหลังเปิดระบบ

- systemd timer ตรวจ `/health/ready` ภายในทุกหนึ่งนาที ให้เชื่อม journal failure เข้ากับระบบแจ้งเตือนของหน่วยงาน และไม่เปิด endpoint นี้สู่ Internet
- ตั้ง log rotation และ alert สำหรับ restart loop, 5xx, OCR timeout, queue full และ Supabase failure
- ตรวจ Security/Performance Advisor และ dependency audit ตามรอบ
- ทดสอบ restore backup และ rollback ทุก release สำคัญ
- ทบทวนสิทธิ์ admin/teacher, temporary-admin enrollment และ Auth sessions เป็นระยะ
