# คู่มือ Deploy แบบ Hybrid: Frontend บน Vercel และ Backend บน Mini PC

อัปเดต: 10 กันยายน 2026

## คำตอบโดยสรุป

ทำได้ และเหมาะกับโปรเจกต์นี้ โดยให้ Vercel หรือบริการ Static Hosting ส่งไฟล์ React/Vite, PWA, MediaPipe WASM และโมเดลตรวจจับใบหน้าไปยัง Browser ส่วน Mini PC Ubuntu Server 24.04 LTS รัน FastAPI, Light OCR และ InsightFace

รูปภาพบัตรและหลักฐาน Liveness ควรถูกส่งจาก Browser ไปยังโดเมน HTTPS ของ Mini PC โดยตรง ไม่ควร proxy ผ่าน Vercel เพราะไฟล์มีขนาดใหญ่ มีข้อมูลชีวมิติ และไม่จำเป็นต้องผ่าน Serverless/CDN อีกชั้นหนึ่ง

```text
โทรศัพท์ / Browser
  ├─ HTTPS ──> app.attendance.example.ac.th (Vercel: static frontend/PWA)
  ├─ HTTPS ──> api.attendance.example.ac.th (Mini PC: Nginx -> FastAPI)
  └─ HTTPS/WSS ──> Supabase (Auth, Database API, Storage, Realtime)

Mini PC
  Nginx :443
    └─ FastAPI 127.0.0.1:8000
         ├─ Light OCR 127.0.0.1:3001
         ├─ InsightFace/ONNX บน CPU
         └─ HTTPS outbound ไป Supabase
```

ตัวอย่างในคู่มือนี้ใช้โดเมนสมมติ ต้องแทนค่าก่อนใช้งานจริง:

- Frontend: `https://app.attendance.example.ac.th`
- Backend: `https://api.attendance.example.ac.th`
- Supabase project ref: `YOUR_PROJECT_REF`

ห้ามนำ hostname, key หรือ secret ตัวอย่างไปใช้จริง

## 1. สิ่งที่ต้องมี

1. โดเมนหรือ subdomain อย่างน้อย 2 ชื่อ คือ `app...` และ `api...`
2. Vercel account หรือ Static Hosting อื่นที่รองรับ HTTPS และ SPA fallback
3. Mini PC Ubuntu Server 24.04 LTS ที่ใช้ IP ภายในคงที่
4. Public IP ที่เข้าถึง Mini PC ได้ หรือ reverse proxy/tunnel ที่องค์กรอนุมัติ
5. TLS certificate ที่เชื่อถือได้สำหรับ API domain
6. Supabase Staging แยกจาก Production
7. Node.js 22.12+ หรือ 24, Python 3.12, Nginx และ systemd บน Mini PC
8. การอนุมัติ license ของ InsightFace pretrained model ก่อน Production
9. Git revision เดียวกันสำหรับ Frontend และ Backend ใน release เดียวกัน

> ถ้า Internet เป็น CGNAT และไม่มี Public IP การทำ port forwarding จะใช้ไม่ได้ ให้ขอ Public IP จาก ISP/หน่วยงาน, ใช้ reverse proxy ของมหาวิทยาลัย หรือใช้ Cloudflare Tunnel หลังผ่านการพิจารณาความเป็นส่วนตัว ดูหัวข้อ 11

## 2. ค่า Environment ที่ใช้

### 2.1 Frontend บน Vercel

ค่าที่ขึ้นต้น `VITE_` จะถูกฝังใน JavaScript และผู้ใช้เปิดดูได้ จึงใส่ได้เฉพาะค่าฝั่งสาธารณะ:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
VITE_API_ORIGIN=https://api.attendance.example.ac.th
```

กฎของ `VITE_API_ORIGIN`:

- ใส่เฉพาะ origin ห้ามเติม `/api`, `/api/v1`, query string หรือ user/password
- Production ต้องเป็น `https://`
- หากไม่กำหนด ระบบยังทำงานแบบเดิมผ่าน same-origin `/api` สำหรับ Vite proxy หรือ Nginx ที่รวม Frontend/Backend ไว้เครื่องเดียว
- ห้ามใส่ `SUPABASE_KEY`, service-role key, OCR token, PIN pepper หรือ Liveness signing key ใน Vercel

### 2.2 Backend บน Mini PC

สร้าง `/etc/km-attendance/backend.env` จาก `deployment/backend.env.example` และแก้ส่วนสำคัญดังนี้:

```dotenv
APP_ENV=production
APP_VERSION=<release-id>
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_KEY=<server-only-key>
OCR_SERVICE_URL=http://127.0.0.1:3001
CORS_ORIGINS=https://app.attendance.example.ac.th
TRUSTED_HOSTS=api.attendance.example.ac.th,127.0.0.1,localhost
```

ให้ `CORS_ORIGINS` เป็น Frontend origin แบบตรงตัวและไม่มี `*` ส่วน `TRUSTED_HOSTS` ต้องเป็น hostname ของ Backend ไม่ใช่ hostname ของ Vercel

สร้าง `/etc/km-attendance/frontend.env.production` แม้ Mini PC จะทำงานแบบ API-only เพราะตัวติดตั้งใช้ตรวจว่าค่า release ฝั่ง Frontend ตรงกับ API:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
VITE_API_ORIGIN=https://api.attendance.example.ac.th
```

ตั้ง permission:

```bash
sudo chown root:kmattendance /etc/km-attendance/backend.env /etc/km-attendance/ocr.env
sudo chmod 0640 /etc/km-attendance/backend.env /etc/km-attendance/ocr.env
sudo chown root:root /etc/km-attendance/frontend.env.production
sudo chmod 0644 /etc/km-attendance/frontend.env.production
```

Frontend env เป็นข้อมูลสาธารณะ แต่ Backend/OCR env เป็นความลับ ห้าม commit หรือส่งผ่านแชต

## 3. เตรียม Supabase

ทำใน Supabase Dashboard ของ Staging ก่อน แล้วจึงทำซ้ำกับ Production หลังผลทดสอบผ่าน:

1. ไปที่ **Authentication -> URL Configuration**
2. ตั้ง **Site URL** เป็น `https://app.attendance.example.ac.th`
3. เพิ่ม Redirect URL ที่ตรงกับ production origin/path ที่ระบบใช้ หลีกเลี่ยง wildcard ใน Production
4. สำหรับ Google OAuth ให้ตรวจ Authorized redirect URI ใน Google Cloud Console ให้ตรงกับ callback URL ที่ Supabase แสดง ไม่ใช่ API domain ของ Mini PC
5. ตรวจ provider, email domain policy และ session policy
6. เปิด RLS และตรวจ policy ของทุกตารางที่ expose ผ่าน Data API
7. รัน Supabase Security Advisor และ Performance Advisor
8. ตรวจ migration ด้วย `supabase migration list` และ `supabase db push --dry-run` ก่อน apply

โปรเจกต์นี้ยังมีประเด็นที่ต้องปิดก่อน Production: ประวัติ migration ฝั่ง local/remote เคยไม่ตรงกัน 3 ตำแหน่ง และ migration ลงทะเบียนใบหน้าแบบ Liveness ยังต้องผ่าน Staging ห้ามใช้ `migration repair` หรือ `db push` แบบเดาสุ่ม

สำหรับ Vercel Preview ให้ใช้ Supabase Staging และ frontend hostname ที่คงที่ เช่น `staging-app...` เป็นหลัก การอนุญาต preview URL แบบสุ่มทุกอันจะทำให้ CORS และ OAuth กว้างเกินความจำเป็น

## 4. เตรียม Frontend สำหรับ Vercel

โปรเจกต์รองรับ split deployment ผ่าน `VITE_API_ORIGIN` แล้ว ทุก request ที่เดิมเรียก `/api/...` จะถูกส่งไป API origin ที่กำหนด โดย Authorization token ยังอยู่ใน memory และ Backend ตรวจ token ซ้ำ

### 4.1 เพิ่ม SPA routing และ Security Headers

คัดลอก template:

```bash
cd /path/to/AttendanceDemo1.2
cp deployment/vercel/vercel.json.example frontend/vercel.json
```

แก้ `frontend/vercel.json`:

- แทน `api.attendance.example.ac.th` ด้วย API domain จริง
- แทน `YOUR_PROJECT_REF` ด้วย Supabase project ref จริง
- ตรวจ CSP ให้ `connect-src` มีเฉพาะ API/Supabase ที่ใช้งานจริง
- อย่าเพิ่ม `'unsafe-eval'`, `https:` แบบเหมารวม หรือ wildcard API

ไฟล์นี้มี rewrite ไป `index.html` เพื่อให้เปิด route เช่น `/student/profile` โดยตรงแล้วไม่ 404 และกำหนด HSTS, frame protection, camera permission policy และ CSP

### 4.2 ทดสอบ build ก่อนส่งขึ้น Vercel

```bash
cd frontend
npm ci
npm run test:api-origin
npm run lint
npm run build
npm run preview
```

ตรวจด้วย `node --version` และใช้ Node 22.12+ หรือ 24 ห้ามใช้ Node 20

## 5. Deploy Frontend บน Vercel

### วิธี A: เชื่อม Git repository

1. Push revision ที่ผ่าน review ไป Git provider
2. Vercel Dashboard -> **Add New -> Project** แล้ว import repository
3. ตั้ง **Root Directory** เป็น `frontend`
4. Framework Preset เลือก **Vite**
5. Install Command ใช้ `npm ci`
6. Build Command ใช้ `npm run build`
7. Output Directory ใช้ `dist`
8. ตั้ง Node.js เป็นรุ่น 22 ที่รองรับ ห้ามใช้ Node 20
9. เพิ่ม Environment Variables สามค่าจากหัวข้อ 2.1 แยก Production และ Preview
10. Deploy Preview และทดสอบกับ Supabase Staging/API Staging ก่อน
11. ผูก custom domain `app.attendance.example.ac.th`
12. เมื่อผ่าน acceptance test จึง Promote/Deploy Production

Environment ของ Vite ถูกอ่านตอน build การแก้ค่าใน Vercel จะไม่ย้อนกลับไปเปลี่ยน deployment เก่า ต้อง redeploy

### วิธี B: Vercel CLI

```bash
cd frontend
npx vercel link
npx vercel env ls
npx vercel deploy
# ทดสอบ preview ก่อน แล้วจึง production
npx vercel deploy --prod
```

อย่าส่งค่า secret ใน command line หรือ URL ให้เพิ่มค่าผ่าน Vercel Dashboard/CLI prompt แทน

## 6. เปิด API domain มายัง Mini PC

### 6.1 เครือข่ายแบบ Public IP

1. ตั้ง DHCP reservation/static LAN IP ให้ Mini PC
2. ตั้ง DNS `api.attendance.example.ac.th` ไป Public IP
3. Router forward TCP 443 ไป Mini PC; เปิด 80 เฉพาะเมื่อใช้ HTTP challenge/redirect
4. ห้าม forward 8000 และ 3001
5. จำกัด SSH ให้เข้าจาก management network/VPN เท่านั้น
6. ขอ TLS certificate ด้วย Certbot หรือ ACME/DNS challenge ตามมาตรฐานของหน่วยงาน

ตัวอย่าง UFW ต้องปรับ SSH source ก่อนใช้เพื่อไม่ให้ล็อกตัวเองออกจากเครื่อง:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <management-cidr> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

ถ้า certificate ใช้ DNS challenge และไม่ต้อง redirect HTTP สามารถปิด inbound 80 หลังตรวจ renewal แล้ว

### 6.2 ตรวจ TLS

```bash
curl --fail --show-error https://api.attendance.example.ac.th/health/live
```

ผลที่คาดหวังคือ JSON สถานะ `ok` และ certificate chain ต้องผ่านโดยไม่ใช้ `-k`

## 7. Build และติดตั้ง Backend/OCR บน Mini PC

### 7.1 สร้าง release bundle บนเครื่องพัฒนา

Production bundle ต้องมาจาก clean Git worktree และ revision ที่ review แล้ว:

```bash
cd /path/to/AttendanceDemo1.2
scripts/verify_release.sh
scripts/build_release_bundle.sh \
  --output /absolute/path/outside-repository/km-attendance-<release-id> \
  --frontend-env /absolute/path/frontend.env.production
```

ห้ามใช้ `--allow-dirty` กับ Production จากนั้นส่ง bundle ไป Mini PC ผ่านช่องทางที่เชื่อถือได้และตรวจ `SHA256SUMS`

### 7.2 เตรียม Mini PC

ทำตาม `docs/DEPLOYMENT_GUIDE_TH.md` เพื่อสร้าง user/directory, ติดตั้ง Node/Python/Nginx, วาง face model ที่ผ่าน checksum, สร้าง Backend/OCR secrets และวาง TLS certificate

### 7.3 ติดตั้งแบบ API-only

```bash
sudo /path/to/bundle/scripts/install_production_release.sh \
  --bundle /absolute/path/to/bundle \
  --release-id <release-id> \
  --domain api.attendance.example.ac.th \
  --project-ref YOUR_PROJECT_REF \
  --api-only \
  --frontend-origin https://app.attendance.example.ac.th \
  --confirm-database-ready \
  --confirm-model-license
```

แฟล็กยืนยันสองตัวให้ใช้เมื่อได้ตรวจฐานข้อมูลและ license จริงเท่านั้น ตัวติดตั้งจะ:

- ตรวจ checksum และ clean release
- ตรวจ `VITE_API_ORIGIN`, CORS และ Trusted Host ว่าตรงกัน
- ติดตั้ง FastAPI/OCR เป็น systemd services บน loopback
- ใช้ Nginx API-only ซึ่งไม่เสิร์ฟ Frontend จาก Mini PC
- ตรวจ `nginx -t`, readiness และ rollback application symlinkอัตโนมัติถ้า release ใหม่ไม่พร้อม

ตรวจหลังติดตั้ง:

```bash
sudo systemctl status km-attendance-backend km-attendance-ocr --no-pager
sudo systemctl status km-attendance-healthcheck.timer --no-pager
curl --fail http://127.0.0.1:8000/health/ready
curl --fail https://api.attendance.example.ac.th/health/live
```

`/health/ready` ภายนอกถูกปิดไว้โดยตั้งใจ ส่วน `/health/live` ไม่ตรวจฐานข้อมูล/OCR และไม่มีข้อมูลส่วนบุคคล

## 8. ตรวจ CORS และ Authentication

ทดสอบ preflight จากเครื่องอื่น:

```bash
curl -i -X OPTIONS 'https://api.attendance.example.ac.th/api/v1/auth/me' \
  -H 'Origin: https://app.attendance.example.ac.th' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

ต้องเห็น `access-control-allow-origin: https://app.attendance.example.ac.th` ไม่ใช่ `*`

จาก Browser DevTools -> Network:

1. Request `/api/v1/...` ต้องไป `api.attendance...` ไม่ใช่ Vercel domain
2. Request ต้องเป็น HTTPS ไม่มี mixed-content warning
3. `Authorization: Bearer ...` ควรมีเฉพาะ request ไป Backend ที่กำหนด
4. ห้ามมี service-role key ใน JavaScript, Local Storage หรือ request
5. การเรียก `/api/v1/auth/me` โดยไม่มี token ได้ `401` ถือว่าปกติ; `503` หมายถึง dependency/configuration มีปัญหา

## 9. Acceptance Test ก่อน Production

ทำกับ Staging และอุปกรณ์จริงอย่างน้อย iPhone/Android/Webcam:

- Google login/logout และ callback กลับ custom Frontend domain
- role boundary: student, teacher, temporary admin และ permanent admin
- โปรไฟล์, ชั้นปี, course join code และ roster import CSV/XLSX
- Dynamic QR หมุนทุก 10–15 วินาทีและ challenge หมดอายุถูกต้อง
- Face enrollment, Liveness blink/move, OCR และ face recognition
- NFC และการแจ้งเตือนชื่อผู้เช็คชื่อแบบทันที
- คำร้องพร้อมแนบ/preview ไฟล์โดยไม่มี object URL ค้าง
- PWA install, reload, deep link และ service-worker update
- Network ขาด/Backend restart/OCR restart/Supabase timeout
- Burst 30 และ 40 คนด้วยรูปขนาดจริง, soak test 1–2 ชั่วโมง และบันทึก CPU/RAM/uplink/latency/error rate
- Backup restore และ application rollback

Mini PC สเปก i3-7100T/RAM 8 GB ต้องเริ่มจาก FastAPI 1 worker ตาม template เพราะแต่ละ worker อาจโหลด model ซ้ำ การรองรับ 30–40 คนต้องยืนยันด้วย full-pipeline load test บนเครื่องและ Internet uplink จริง ไม่สามารถสรุปจากจำนวนผู้เปิดหน้าเว็บพร้อมกันเพียงอย่างเดียว

## 10. Rollback

Frontend และ Backend rollback แยกกันได้ แต่ควรรักษา API contract ให้เข้ากัน:

- Vercel: Promote deployment ก่อนหน้าที่ผ่านการทดสอบ
- Mini PC: ใช้ `scripts/rollback_production_release.sh` ไป release ID ก่อนหน้า
- Database: ใช้ reviewed compensating migration ห้ามแก้หรือลบ migration ที่ apply แล้ว
- ถ้า Backend ใหม่เสียแต่ Frontend ใหม่เรียก API ใหม่ ให้ rollback Frontend และ Backend เป็นคู่

หลัง rollback ให้ทดสอบ login, `/health/live`, authenticated `/api/v1/auth/me` และ attendance flow หนึ่งรอบ

## 11. กรณีไม่มี Public IP

ตัวเลือกตามลำดับที่แนะนำ:

1. ขอ reverse proxy/public API hostname จากฝ่าย IT ของมหาวิทยาลัย
2. ขอ Public IP และทำ direct TLS/Nginx ตามหัวข้อ 6
3. ใช้ Cloudflare Tunnel เมื่อองค์กรอนุมัติ

Cloudflare Tunnel สร้าง outbound-only connection และไม่ต้องเปิด inbound port จึงแก้ CGNAT ได้ แต่รูปบัตรและหลักฐาน Liveness จะ transit ผ่าน Cloudflare และ origin จะไม่เห็น client IP เดิมโดยตรงหากยังไม่ตั้ง trusted proxy/real-IP อย่างถูกต้อง ผลกระทบต่อ PDPA, retention/logging, DPA, WAF upload limit และ rate limiting ต้องได้รับการอนุมัติก่อน คู่มือนี้จึงไม่เปิด Tunnel ให้อัตโนมัติ

ห้ามชี้ Tunnel ตรงไป `127.0.0.1:8000` โดยข้าม Nginx โดยไม่มี security review เพราะจะข้าม rate limit, body limit และ edge headers ที่เตรียมไว้

## 12. ใช้บริการ Cloud อื่นแทน Vercel

Frontend เป็น Vite static build จึงใช้ Cloudflare Pages, Netlify, S3/CloudFront, Azure Static Web Apps หรือ Static Hosting อื่นได้ โดยต้องมีครบ:

1. Build `frontend` ด้วย `npm ci && npm run build`
2. Publish directory `frontend/dist`
3. ตั้งสาม environment variables ในหัวข้อ 2.1 ตอน build
4. ตั้ง SPA fallback ทุก route ไป `index.html`
5. ตั้ง security headers/CSP เทียบเท่า template Vercel
6. ใช้ stable HTTPS custom domain
7. ใส่ origin นั้นใน Backend `CORS_ORIGINS` และ Supabase Site/Redirect URLs
8. ปิด directory listing และห้าม cache `index.html` ยาวจนขัดขวาง PWA update

ไม่แนะนำย้าย FastAPI/Light OCR/InsightFace ไป Vercel Functions เพราะ workload นี้มี native model, CPU inference, request body ขนาดใหญ่ และ latency/timeout ที่ต่างจาก static frontend

## 13. ปัญหาที่พบบ่อย

### CORS error

- ตรวจว่า `CORS_ORIGINS` เป็น Frontend origin ไม่ใช่ API origin
- ไม่มี slash ท้าย, path หรือ wildcard
- restart Backend หลังแก้ env
- ตรวจ OPTIONS ด้วยคำสั่งหัวข้อ 8

### OAuth กลับ localhost หรือโดเมนผิด

- แก้ Supabase Site URL
- เพิ่ม exact Redirect URL
- ตรวจ Google OAuth callback ของ Supabase
- redeploy Frontend หากเปลี่ยน environment

### `401 Unauthorized`

- ถ้าไม่มี Bearer token ถือว่าปกติ
- ถ้าล็อกอินแล้วให้ตรวจ Network ว่า interceptor แนบ token และ request ไป API origin ที่ถูกต้อง
- ตรวจเวลาเครื่อง Mini PC/NTP เพราะ JWT มีอายุ

### `503 Service Unavailable`

- ตรวจ `curl http://127.0.0.1:8000/health/ready` บน Mini PC
- ตรวจ `journalctl -u km-attendance-backend -u km-attendance-ocr`
- ตรวจ Supabase outbound, OCR health และ env โดยไม่พิมพ์ secret

### Vercel route 404 เมื่อ refresh

- ตรวจว่า `frontend/vercel.json` ถูก deploy และ SPA rewrite ทำงาน
- ตรวจว่า Vercel Root Directory คือ `frontend`

### กล้องใช้ไม่ได้

- Frontend ต้องเป็น HTTPS
- ตรวจ Browser permission และ `Permissions-Policy`
- iOS ต้องเปิดผ่าน Safari/PWA origin จริง ไม่ใช่ embedded browser ที่ปิด camera API

## 14. แหล่งอ้างอิงทางการ

- [Vercel: Vite deployment and SPA rewrites](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel: Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel: Deploy from CLI](https://vercel.com/docs/projects/deploy-from-cli)
- [Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase: Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase: Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Cloudflare: Tunnel overview](https://developers.cloudflare.com/tunnel/)

## 15. สรุปค่าคู่กัน

| ตำแหน่ง | ค่า Production |
|---|---|
| Vercel custom domain | `https://app.attendance.example.ac.th` |
| Vercel `VITE_API_ORIGIN` | `https://api.attendance.example.ac.th` |
| Backend `CORS_ORIGINS` | `https://app.attendance.example.ac.th` |
| Backend `TRUSTED_HOSTS` | `api.attendance.example.ac.th,127.0.0.1,localhost` |
| Supabase Site URL | `https://app.attendance.example.ac.th` |
| Nginx/server TLS domain | `api.attendance.example.ac.th` |
| FastAPI bind | `127.0.0.1:8000` |
| Light OCR bind | `127.0.0.1:3001` |

สถาปัตยกรรมนี้แยกความรับผิดชอบชัดเจน: Cloud ให้บริการ static frontend ได้เร็ว ส่วนข้อมูล OCR/Liveness วิ่งตรงเข้า Mini PC และ Backend secrets อยู่บน server เท่านั้น แต่ความพร้อมใช้งานของการเช็คชื่อยังขึ้นกับไฟฟ้า, Internet uplink, DNS/TLS และ Mini PC จึงต้องมี UPS, monitoring, backup และผล load test ก่อนเปิด Production
