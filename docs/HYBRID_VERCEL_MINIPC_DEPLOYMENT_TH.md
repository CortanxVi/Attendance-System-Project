# คู่มือ Deployment ฉบับ Production: Vercel + Nginx + Docker บน Mini PC

อัปเดต: 14 กันยายน 2026

คู่มือนี้อธิบายการนำโปรเจกต์ AttendanceDemo1.2 ขึ้นใช้งานจริงตั้งแต่เตรียม Git branch, ตรวจและ build โค้ด, ตั้ง Supabase, Environment Variables, DNS/TLS, Docker Compose, Nginx, Vercel, การเชื่อม URL ระหว่างระบบ, การทดสอบ และการ rollback

สถาปัตยกรรมที่เลือกคือ:

- **Frontend React/Vite/PWA** โฮสต์บน Vercel
- **Nginx** รันบน Ubuntu ของ Mini PC เป็น Public HTTPS Reverse Proxy
- **FastAPI Backend และ Light OCR** รันใน Docker Compose บน Mini PC
- **InsightFace model** เก็บบน Mini PCแล้ว mount เข้า Backend container แบบอ่านอย่างเดียว
- **Supabase** ยังคงเป็นบริการ BaaS สำหรับ Auth, PostgreSQL, Storage และ Realtime ไม่ได้รันใน Docker ชุดนี้

> ตัวอย่างทั้งหมดใช้ชื่อสมมติ ห้ามคัดลอก key หรือ secret ตัวอย่างไปใช้จริง

## 1. ภาพรวมสถาปัตยกรรม

```text
ผู้ใช้บนโทรศัพท์/Browser/PWA
  │
  ├── HTTPS ──> app.attendance.example.ac.th
  │               └── Vercel: React/Vite static files + PWA
  │
  ├── HTTPS ──> api.attendance.example.ac.th
  │               └── Router :443
  │                    └── Mini PC Nginx :443
  │                         └── 127.0.0.1:8000
  │                              └── FastAPI container
  │                                   ├── Docker DNS: ocr:3001
  │                                   │    └── Light OCR container
  │                                   ├── InsightFace model (read-only mount)
  │                                   └── HTTPS outbound ไป Supabase
  │
  └── HTTPS/WSS ──> YOUR_PROJECT_REF.supabase.co
                  ├── Google OAuth / Auth
                  ├── PostgreSQL Data API
                  ├── Storage
                  └── Realtime
```

Nginx เป็นช่องทางสาธารณะเพียงจุดเดียวของ Mini PC ห้ามเปิดพอร์ต FastAPI `8000` หรือ OCR `3001` ออก Internet

### 1.1 URL ตัวอย่างที่ใช้ตลอดคู่มือ

| หน้าที่ | ค่าตัวอย่าง | รูปแบบที่ต้องใช้ |
|---|---|---|
| Frontend Production | `https://app.attendance.example.ac.th` | origin แบบ HTTPS ไม่มี slash ท้ายเมื่อใส่ใน CORS |
| Backend API | `https://api.attendance.example.ac.th` | origin เท่านั้น ไม่มี `/api` หรือ `/api/v1` |
| Supabase | `https://YOUR_PROJECT_REF.supabase.co` | URL จากหน้า Connect/API Settings |
| Vercel Production branch | `main` | branch ที่ผู้ใช้จริงได้รับ |
| Vercel Preview branch | `demo3.1` | branch สำหรับ QA ก่อน merge |

Vercel ไม่ได้บังคับว่าต้องอ่าน `main` เสมอ แต่หนึ่ง Project จะมี **Production Branch** หนึ่ง branch ซึ่งโดยทั่วไป Vercelเลือก `main` ให้ตอน import ส่วน branch อื่นจะเป็น Preview สามารถเปลี่ยนได้ที่ **Project Settings -> Environments -> Production -> Branch Tracking**

## 2. สิ่งที่ผู้ดูแลต้องเข้าใจก่อนเริ่ม

1. **Git release flow** — `demo3.1` เป็น Preview และ `main` เป็น Production; ห้าม force-push ทับประวัติ Production
2. **Build-time environment** — ค่า `VITE_*` ถูกฝังลง JavaScript ตอน build การแก้ค่าใน Vercelต้อง redeploy
3. **Secret boundary** — ค่าใน Browser เปิดดูได้ทั้งหมด; `SUPABASE_KEY`, OCR token และ signing keys ต้องอยู่เฉพาะ Mini PC
4. **CORS** — Backend ต้องอนุญาต Frontend origin แบบตรงตัว ไม่ใช่ API origin และไม่ใช้ `*` ใน Production
5. **Trusted Host** — Backend ต้องเชื่อถือ hostname ของ API เช่น `api.attendance...` ไม่ใช่ hostname ของ Vercel
6. **DNS/TLS/NAT** — domain ต้องชี้ถูก, certificate ต้องใช้ได้, Router ต้อง forward เฉพาะ 80/443
7. **Docker lifecycle** — image, container, network, healthcheck, restart policy, logs และ resource limit
8. **Nginx reverse proxy** — รับ HTTPS แล้วส่งเฉพาะ request ที่กำหนดไป FastAPI บน loopback
9. **Supabase Auth/RLS/Migrations** — Frontend ใช้ publishable/anon key; Backend ใช้ server-only key และต้องตรวจสิทธิ์ทุก API
10. **Operational availability** — ถ้า Mini PC ปิด, ไฟดับ หรือ Internet บ้านล่ม API จะใช้งานไม่ได้ แม้ Vercel และ Supabase ยังออนไลน์

## 3. เตรียมค่าจริงก่อนลงมือ

บันทึกค่าเหล่านี้ใน password manager หรือระบบ secret management ขององค์กร ไม่บันทึกลง Git, ticket สาธารณะ หรือ `log.md`

```text
FRONTEND_ORIGINS=https://<frontend-domain>
API_ORIGIN=https://<api-domain>
API_HOST=<api-domain-without-https>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<browser-safe-key>
SUPABASE_SERVER_KEY=<server-only-key>
OCR_SERVICE_TOKEN=<random-at-least-32-characters>
LIVENESS_SIGNING_KEY=<different-random-at-least-32-characters>
TEMP_ADMIN_PIN_PEPPER=<different-random-at-least-32-characters>
RELEASE_ID=<unique-git-tag-or-release-name>
```

ใช้ secret คนละค่าในแต่ละหน้าที่และแต่ละ environment ห้ามใช้ token เดียวกันสำหรับ OCR, Liveness และ Temporary Admin

## 4. เตรียม Git branch และ release

### 4.1 ตรวจ branch ก่อนแก้ไข

```bash
cd /path/to/AttendanceDemo1.2
git fetch origin
git status --short --branch
git branch -vv
```

ถ้ามีไฟล์ที่ยังไม่ commit ให้ตรวจว่าเป็นงานของใคร อย่าใช้ `git reset --hard`, `git clean -fd` หรือ force-push เพื่อลบทิ้ง

### 4.2 ทดสอบ `demo3.1` เป็น Preview

```bash
git switch demo3.1
git pull --ff-only origin demo3.1
scripts/verify_release.sh
git push origin demo3.1
```

เมื่อ push branch ที่ไม่ใช่ Production Branch Vercel จะสร้าง Preview Deployment ให้ ทดสอบ Preview กับ **Supabase Staging และ Staging API** ก่อน ไม่ควรให้ Preview build เข้าถึงข้อมูล Production โดยไม่จำเป็น

### 4.3 Promote ไป `main`

วิธีที่แนะนำคือเปิด Pull Request จาก `demo3.1` ไป `main`, ให้ checks ผ่านและ review ก่อน merge หากทำจาก command line:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff demo3.1
scripts/verify_release.sh
git push origin main
```

สร้าง tag หลังผลตรวจผ่าน:

```bash
git tag -a v1.0.0 -m "Production release v1.0.0"
git push origin v1.0.0
```

เปลี่ยน `v1.0.0` ทุก release ห้ามนำ tag เดิมกลับมาใช้กับ source ใหม่ ให้บันทึก commit SHA ด้วย:

```bash
git rev-parse HEAD
```

> ใน Project นี้ `main` และ `origin/main` มี release จาก `demo3.1` อยู่แล้ว ณ วันที่อัปเดตคู่มือ แต่ทุกครั้งต้องตรวจสถานะใหม่ อย่าอาศัยข้อความนี้เป็นหลักฐานแทน Git

## 5. ตรวจและ build โปรเจกต์ก่อน Production

โปรเจกต์รองรับ Node.js `22.12+` หรือ `24`; แนะนำ Node.js 24 บนเครื่อง build ปัจจุบัน Supabase client libraries ยุติการรองรับ Node.js 20 แล้ว

### 5.1 ตรวจแบบรวม

```bash
node --version
npm --version
scripts/verify_release.sh
```

สคริปต์นี้ตรวจ Git diff, face models, Backend tests, Python dependencies, Frontend lint/tests/build, OCR security/doctor/audit และ Frontend design audit

### 5.2 Build Frontend แยกเพื่อวิเคราะห์ปัญหา

```bash
cd frontend
npm ci
npm run lint
npm run test:api-origin
npm run test:liveness
npm run test:face-runtime
npm run test:report-export
npm run build
```

ผลลัพธ์อยู่ใน `frontend/dist` และไม่ควร commit เพราะ Vercel จะ build ใหม่จาก source และ lockfile

ทดลองไฟล์ build:

```bash
npm run preview
```

### 5.3 ตรวจ Backend และ OCR แยก

```bash
cd ../backend
.venv/bin/python -m unittest discover -s tests
.venv/bin/python -m pip check

cd ../ocr-service
npm ci
npm run test:security
npm run doctor
npm audit --audit-level=moderate
```

ถ้า check ใดไม่ผ่าน ให้หยุด release และแก้สาเหตุก่อน ไม่ควร deploy ด้วยการข้าม test โดยไม่บันทึกความเสี่ยง

## 6. เตรียม Supabase Production

Supabase เป็น hosted BaaS ในสถาปัตยกรรมนี้ จึงไม่ต้องติดตั้ง Supabase ลง Mini PC แต่ต้องตั้ง Auth, migrations, RLS และ key ให้ถูก

### 6.1 แยก Staging และ Production

- Staging ใช้ข้อมูลทดสอบและเชื่อมกับ Vercel Preview `demo3.1`
- Production ใช้ข้อมูลจริงและเชื่อมกับ Vercel Production `main`
- ห้ามนำ service-role/secret key ของ Production ไปใส่ Preview หรือ Frontend

### 6.2 ตรวจ migration

จาก repository root:

```bash
npx --no-install supabase migration list --linked
npx --no-install supabase db push --dry-run
npx --no-install supabase db lint --linked --schema public --level warning
```

ตรวจว่า migration ทั้ง 19 ไฟล์ของ repository มี Local/Remote timestamp ตรงกัน ปัจจุบันประวัติที่เคยไม่ตรงได้รับการ reconcile แล้ว จึงไม่ควรใช้ `migration repair` ซ้ำโดยเดา

ถ้ามี migration ใหม่:

1. อ่าน SQL และผลกระทบต่อ RLS/index/lock/ข้อมูลเดิม
2. backup หรือยืนยัน Supabase Point-in-Time Recovery ตาม plan ที่ใช้
3. ทดสอบกับ Staging ก่อน
4. รัน `db push --dry-run`
5. ให้ผู้มีสิทธิ์เพียงคนเดียวรัน `npx --no-install supabase db push`
6. รัน migration list, lint และ application smoke test ซ้ำ

ห้ามแก้ schema Production จาก Table Editor/SQL Editor แล้วปล่อยให้ migration ใน Git ไม่ตรงกับของจริง

### 6.3 ตรวจ RLS และ Advisors

```bash
scripts/check_supabase_release.sh
```

ต้องตรวจ Security Advisor และ Performance Advisor ปัจจุบันมี policy decision ที่ต้องพิจารณาเรื่อง **Leaked password protection** หากเปิด password login; Google-only login ช่วยลดช่องทางแต่ไม่แทนการตัดสินใจด้าน Auth policy

ตั้งแต่ 30 ตุลาคม 2026 Supabase จะไม่ expose ตารางใหม่ผ่าน Data API อัตโนมัติในทุก project ดังนั้น migration ที่เพิ่มตารางใหม่ต้องกำหนด exposure, grants และ RLS อย่างชัดเจน อย่าแก้ด้วยการเปิด `public` กว้างทั้ง schema

### 6.4 ตั้ง Google OAuth และ Redirect URL

ใน Supabase Dashboard:

1. ไป **Authentication -> Providers -> Google** และเปิด provider
2. ใส่ Google Client ID/Secret ใน Supabase เท่านั้น
3. ไป **Authentication -> URL Configuration**
4. ตั้ง **Site URL** เป็น `https://app.attendance.example.ac.th`
5. เพิ่ม Redirect URL ที่ตรงกับ `redirectTo` ของแอป คือ Production origin เดียวกัน
6. Preview ให้เพิ่มเฉพาะ URL ที่ใช้จริง หรือ stable branch domain; หลีกเลี่ยง wildcard กว้างใน Production

ใน Google Cloud Console ให้ใส่ Authorized redirect URI เป็น:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

ไม่ใช่ Vercel URL และไม่ใช่ Mini PC API URL ลำดับจริงคือ Frontend -> Supabase Auth -> Google -> Supabase callback -> Frontend origin

## 7. เตรียม Mini PC

ตัวอย่างนี้ใช้ Ubuntu Server 24.04 LTS และผู้ดูแลที่มี `sudo`

### 7.1 เตรียมเครื่องและเครือข่าย

1. อัปเดต BIOS/firmware และตั้ง **Restore on AC Power Loss = Power On**
2. ใช้ UPS ถ้าเป็นระบบใช้งานจริง
3. ตั้ง DHCP reservation หรือ static LAN IP ให้ Mini PC
4. ตั้งเวลาและ timezone ให้ถูก เพราะ JWT และ certificate อาศัยเวลา
5. ใช้ SSH key; ปิด password/root SSH เมื่อยืนยันว่า key ใช้ได้
6. จำกัด SSH ให้เข้าผ่าน management VLAN/VPN หรือ IP ที่กำหนด

```bash
sudo timedatectl set-timezone Asia/Bangkok
timedatectl status
sudo apt update
sudo apt full-upgrade
sudo reboot
```

### 7.2 ติดตั้ง Docker Engine จาก official repository

หลังกลับเข้าระบบ:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

เพิ่ม Docker repository ตาม Ubuntu codename ของเครื่อง:

```bash
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

การเข้า Docker daemon เทียบเท่าสิทธิ์ root ในคู่มือนี้จึงใช้ `sudo docker` ไม่เพิ่มผู้ใช้ทั่วไปเข้า group `docker` โดยอัตโนมัติ

### 7.3 ติดตั้ง Nginx, Certbot และ firewall

```bash
sudo apt install -y nginx certbot ufw git
sudo systemctl enable --now nginx
```

อนุญาต SSH source ที่ถูกต้อง **ก่อน** เปิด UFW:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <MANAGEMENT_CIDR> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

อย่าใช้ `<MANAGEMENT_CIDR>` ตามตัวอย่างจริง ต้องแทน subnet/IP ที่ผู้ดูแลเข้าถึงได้ มิฉะนั้นอาจล็อกตัวเองออกจาก SSH

### 7.4 สร้าง directory

```bash
sudo install -d -m 0750 /opt/km-attendance
sudo install -d -m 0750 /etc/km-attendance
sudo install -d -m 0750 /var/lib/km-attendance/insightface
sudo install -d -m 0755 /var/www/certbot
```

Clone repository ด้วย deploy user ที่กำหนด ไม่ควรทำงานพัฒนาโดยตรงใน directory นี้:

```bash
sudo chown <DEPLOY_USER>:<DEPLOY_USER> /opt/km-attendance
git clone <GIT_REPOSITORY_URL> /opt/km-attendance/repository
cd /opt/km-attendance/repository
git fetch --tags origin
git checkout --detach v1.0.0
git status --short --branch
git rev-parse HEAD
```

ต้องได้ detached HEAD ที่ tag/commit เดียวกับ release ที่ตรวจแล้ว และ working tree สะอาด

## 8. ตั้ง Environment ของ Backend และ OCR

### 8.1 สร้าง Backend secret file

```bash
cd /opt/km-attendance/repository
sudo install -m 0600 deployment/backend.env.example /etc/km-attendance/backend.env
sudoedit /etc/km-attendance/backend.env
```

ตัวอย่างค่าหลัก:

```dotenv
APP_ENV=production
APP_VERSION=v1.0.0
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_KEY=<server-only-service-role-or-secret-key>
OCR_SERVICE_URL=http://ocr:3001
OCR_SERVICE_TOKEN=<random-at-least-32-characters>
LIVENESS_SIGNING_KEY=<different-random-at-least-32-characters>
TEMP_ADMIN_PIN_PEPPER=<different-random-at-least-32-characters>
INSIGHTFACE_MODEL_ROOT=/models/insightface
CORS_ORIGINS=https://app.attendance.example.ac.th
TRUSTED_HOSTS=api.attendance.example.ac.th,127.0.0.1,localhost
```

คงค่า upload limits, timeout, QR lifetime, liveness threshold และ concurrency จาก template จนกว่าจะมีผล load test/calibration รองรับการเปลี่ยน

### 8.2 สร้าง OCR secret file

```bash
sudo install -m 0600 deployment/ocr.env.example /etc/km-attendance/ocr.env
sudoedit /etc/km-attendance/ocr.env
```

ค่า `OCR_SERVICE_TOKEN` ต้องตรงกับ Backend ส่วน `HOST=0.0.0.0` ภายใน container ใช้ได้เพราะ Compose ไม่ publish พอร์ต OCR ออก host

### 8.3 สร้าง Compose topology file

```bash
sudo install -m 0640 deployment/docker/production.compose.env.example /etc/km-attendance/compose.env
sudoedit /etc/km-attendance/compose.env
```

ตัวอย่าง:

```dotenv
RELEASE_ID=v1.0.0
FRONTEND_ORIGINS=https://app.attendance.example.ac.th
API_HOST=api.attendance.example.ac.th
ATTENDANCE_CONFIG_DIR=/etc/km-attendance
INSIGHTFACE_MODEL_ROOT_HOST=/var/lib/km-attendance/insightface
BACKEND_BIND_ADDRESS=127.0.0.1
BACKEND_PORT=8000
```

แต่ละค่าใน `FRONTEND_ORIGINS` ต้องไม่มี slash ท้าย ถ้ามีหลาย origin ให้คั่นด้วย comma โดยไม่ใช้ `*` ส่วน `API_HOST` ต้องไม่มี `https://` และไม่มี path ค่าเหล่านี้ใน Compose จะ override CORS/Trusted Host ใน `backend.env` เพื่อให้ topology ที่รันจริงเป็นค่าหลัก

### 8.4 สร้าง secret แบบสุ่ม

สร้างแต่ละ secret แยกกัน เช่น:

```bash
openssl rand -hex 32
```

คัดลอกเข้าระบบ secret/password manager และไฟล์ env ด้วย `sudoedit` อย่า paste ลง command line ที่บันทึก shell history และอย่าพิมพ์ไฟล์ env ด้วย `cat` ระหว่าง screen sharing

### 8.5 วาง InsightFace model

วาง model ที่องค์กรอนุมัติ license แล้วให้โครงสร้างสอดคล้องกับสคริปต์ตรวจ เช่น:

```text
/var/lib/km-attendance/insightface/
└── models/
    └── buffalo_s/
        ├── 1k3d68.onnx
        ├── 2d106det.onnx
        └── det_500m.onnx
```

ตรวจ checksum/ไฟล์:

```bash
cd /opt/km-attendance/repository
sudo env INSIGHTFACE_MODEL_ROOT=/var/lib/km-attendance/insightface scripts/verify_face_models.sh
```

อย่าเก็บภาพใบหน้า/บัตรนักศึกษาหรือ production exports ไว้ใน repository หรือ Docker build context

## 9. Build และเปิด Backend/OCR ด้วย Docker Compose

ไฟล์ Production ที่ใช้คือ `deployment/docker/compose.production.yml`

### 9.1 ตรวจ config โดยไม่แสดงค่าออกหน้าจอ

```bash
cd /opt/km-attendance/repository
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml \
  config --quiet
```

อย่าใช้ `docker compose config` แบบพิมพ์ผลเต็มลง CI log เพราะค่าจาก `env_file` อาจถูกแสดงในบาง workflow

### 9.2 Build image

```bash
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml \
  build --pull
```

ตรวจ image:

```bash
sudo docker image ls 'km-attendance-*'
```

Production Compose ตั้งชื่อ image ตาม `RELEASE_ID`; ใช้ release ID ใหม่ทุกครั้งเพื่อ rollback ได้

### 9.3 เปิดบริการ

```bash
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml \
  up -d --remove-orphans

sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml \
  ps
```

รอให้ `ocr` และ `backend` เป็น healthy แล้วตรวจ:

```bash
curl --fail --show-error http://127.0.0.1:8000/health/live
curl --fail --show-error http://127.0.0.1:8000/health/ready
```

- `/health/live` ตรวจ process
- `/health/ready` ตรวจ Supabase, OCR และ face runtime
- OCR ไม่มี host port; FastAPI publish เฉพาะ `127.0.0.1:8000`

ดู log โดยไม่เปิด env file:

```bash
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml \
  logs --tail=100 backend ocr
```

Compose มี log rotation, memory/CPU limits, healthcheck, `no-new-privileges`, dropped Linux capabilities และ `restart: unless-stopped`

### 9.4 ตรวจการกลับมาหลัง reboot

```bash
sudo systemctl is-enabled docker
sudo reboot
```

หลังกลับเข้าระบบ:

```bash
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f /opt/km-attendance/repository/deployment/docker/compose.production.yml \
  ps
curl --fail http://127.0.0.1:8000/health/ready
```

`unless-stopped` จะไม่เริ่ม container ที่ผู้ดูแลสั่ง stop ไว้เอง หากต้องการให้กลับมาอัตโนมัติห้ามหยุดถาวรก่อน reboot

## 10. ตั้ง DNS, Public IP และ Router

### 10.1 Frontend DNS

เพิ่ม custom domain ใน Vercel ก่อน แล้วทำ DNS record ตามค่าที่ Vercel แสดง อย่าเดา A/CNAME เอง เพราะค่าขึ้นกับ DNS provider และชนิด domain

### 10.2 Backend DNS

ตั้ง `api.attendance.example.ac.th` ให้ชี้ Public IP ของสถานที่ติดตั้ง Mini PC:

```bash
dig +short api.attendance.example.ac.th A
dig +short api.attendance.example.ac.th AAAA
```

ถ้ามี AAAA record แต่ Router/Firewall IPv6 ยังไม่พร้อม ให้ลบหรือแก้ AAAA มิฉะนั้นอุปกรณ์บางเครื่องจะพยายามเข้า IPv6 แล้วล้มเหลว

### 10.3 Router/NAT

- Forward TCP 443 -> Mini PC TCP 443
- Forward TCP 80 -> Mini PC TCP 80 สำหรับ ACME HTTP challenge และ redirect
- **ห้าม** forward 8000, 3001, 22 แบบสาธารณะ
- ถ้า Public IP เปลี่ยน ให้ใช้ DDNS updater ที่เชื่อถือได้และตรวจ TTL
- ถ้า ISP ใช้ CGNAT การทำ port forwarding จะไม่สำเร็จ ต้องขอ Public IP, ใช้ reverse proxy ของมหาวิทยาลัย หรือ tunnel ที่ผ่าน security/privacy review

ทดสอบจากเครือข่ายมือถือ ไม่ใช่ Wi-Fi วงเดียวกับ Mini PC เพื่อหลีกเลี่ยงความสับสนจาก NAT loopback

## 11. ออก TLS Certificate และตั้ง Nginx

### 11.1 เปิด HTTP bootstrap ก่อนมี certificate

สร้าง `/etc/nginx/sites-available/km-attendance-api` ด้วย `sudoedit`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.attendance.example.ac.th;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    location / {
        return 404;
    }
}
```

เปิด site:

```bash
sudo ln -s /etc/nginx/sites-available/km-attendance-api /etc/nginx/sites-enabled/km-attendance-api
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

ถ้า symlink มีอยู่แล้ว ไม่ต้องสร้างซ้ำ การลบ `default` ให้ทำเฉพาะไฟล์ตัวอย่างที่ยืนยันว่าไม่ได้ใช้กับเว็บอื่น

### 11.2 ขอ certificate ด้วย webroot

```bash
sudo certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --domain api.attendance.example.ac.th
```

Certificate จะอยู่ใต้ `/etc/letsencrypt/live/api.attendance.example.ac.th/`

### 11.3 เปิด full reverse proxy

```bash
cd /opt/km-attendance/repository
sudo cp deployment/nginx/attendance-api-only.conf.example /etc/nginx/sites-available/km-attendance-api
sudoedit /etc/nginx/sites-available/km-attendance-api
```

แทน `api.attendance.example.ac.th` ทุกตำแหน่งด้วย API hostname จริง ตรวจว่า `proxy_pass` ยังเป็น `http://127.0.0.1:8000` จากนั้น:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl enable nginx
```

Nginx template ทำหน้าที่:

- redirect HTTP ไป HTTPS ยกเว้น ACME challenge
- terminate TLS 1.2/1.3
- จำกัด request rate/connection และ body สูงสุด 32 MiB
- proxy `/api/` และ `/health/live` ไป FastAPI loopback
- จำกัด `/health/ready` ให้เรียกจากเครื่องเดียวกัน
- ส่ง Host/forwarded headers และ security headers
- ตอบ 404 สำหรับ path อื่น

อย่าเพิ่ม CORS header ซ้ำใน Nginx เพราะ FastAPI เป็นเจ้าของ CORS ถ้าทั้งสองชั้นตั้งคนละค่า Browser อาจปฏิเสธ response

### 11.4 ตรวจ renewal

```bash
sudo systemctl status certbot.timer --no-pager
sudo certbot renew --dry-run
```

### 11.5 ตรวจ API สาธารณะ

```bash
curl --fail --show-error https://api.attendance.example.ac.th/health/live
```

ต้องผ่านโดยไม่ใช้ `-k` การใช้ `-k` เพียงซ่อนปัญหา certificate และไม่ใช่เกณฑ์ Production

## 12. ตั้ง Frontend สำหรับ Vercel

### 12.1 ตรวจ SPA routing และ security headers

ไฟล์ `frontend/vercel.json` ปัจจุบันรองรับ SPA rewrite ส่วน template ที่เพิ่ม security headers/CSP อยู่ที่ `deployment/vercel/vercel.json.example`

ก่อน Production ให้คัดลอก template แล้วแทน API domain และ Supabase project ref จริง:

```bash
cp deployment/vercel/vercel.json.example frontend/vercel.json
```

ตรวจ `frontend/vercel.json`:

- `rewrites` ต้องส่งทุก route ไป `/index.html`
- `connect-src` ต้องมี API origin, Supabase HTTPS และ Supabase WSS ที่ใช้งานจริง
- `camera=(self)` ต้องคงไว้เพราะระบบสแกน QR/ใบหน้า
- อย่าใส่ secret, `unsafe-eval`, wildcard API หรือ `https:` แบบเหมารวม
- commit ไฟล์ที่แทน placeholder แล้วก่อนให้ Vercel build

ตรวจ diff และ build ใหม่:

```bash
git diff -- frontend/vercel.json
cd frontend
npm run build
```

## 13. Import Git repository เข้า Vercel

### 13.1 เชื่อม Git

1. Login Vercel
2. เลือก **Add New -> Project**
3. เลือก GitHub/GitLab/Bitbucket และอนุญาตเฉพาะ repository ที่ต้องใช้
4. กด **Import** repository AttendanceDemo1.2
5. ตั้ง **Root Directory = `frontend`**
6. Framework Preset = **Vite**
7. Install Command = `npm ci`
8. Build Command = `npm run build`
9. Output Directory = `dist`
10. Node.js = รุ่นที่รองรับ Node 22.12+; แนะนำ 24 ตาม release checks ของโปรเจกต์
11. ตรวจ Production Branch เป็น `main`

Vercel ต้องเห็น `frontend/package.json`, `package-lock.json` และ `vercel.json` ภายใต้ Root Directory ที่ตั้งไว้

### 13.2 ตั้ง Environment Variables

ไป **Project Settings -> Environment Variables** และเพิ่มสำหรับ Production:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
VITE_API_ORIGIN=https://api.attendance.example.ac.th
```

กฎสำคัญ:

- `VITE_API_ORIGIN` ห้ามต่อ `/api`, `/api/v1` หรือ slash ท้าย
- ใส่เฉพาะ publishable/anon key ใน Frontend
- ห้ามใส่ `SUPABASE_KEY`, service-role/secret key หรือ Backend tokens
- เลือก target **Production** ให้ถูก
- เมื่อแก้ค่า ต้องสร้าง deployment ใหม่ เพราะเป็น build-time variables

สำหรับ Preview branch `demo3.1` ให้เลือก **Preview** และกำหนด branch-specific variables ไป Supabase/API Staging ถ้าใช้ random Preview URL กับ OAuth/CORS จะดูแลยาก ควรใช้ stable branch domain หรือ Vercel Custom Environment ตาม plan

กำหนด Frontend Production URL ที่เป็น canonical เพียงชื่อเดียวและให้ผู้ใช้เข้าผ่านชื่อนั้น หากยังเปิดทั้ง custom domain และชื่อ `*.vercel.app` ให้ใส่ทั้งสอง origin แบบตรงตัวใน `FRONTEND_ORIGINS`/Supabase Redirect URLs หรือกำหนด redirect ไป canonical domain มิฉะนั้น build เดียวกันอาจใช้งานผ่าน domain หนึ่งได้แต่อีก domain ติด CORS/OAuth

### 13.3 Deploy ครั้งแรก

กด Deploy แล้วตรวจ Build Logs ต้องเห็น `npm ci`, TypeScript และ Vite build ผ่าน หาก import หลังจาก repository มี `main` อยู่ การ deploy แรกจะเป็น Production

วิธี CLI ทางเลือก:

```bash
cd frontend
npx vercel link
npx vercel env ls
npx vercel deploy
# ทดสอบ Preview ก่อน
npx vercel deploy --prod
```

ถ้าเชื่อม Git อยู่แล้วให้เลือก workflow หลักเพียงแบบเดียวเพื่อลดการ deploy revision ผิด

### 13.4 ผูก custom domain

1. ไป **Project -> Settings -> Domains**
2. เพิ่ม `app.attendance.example.ac.th`
3. สร้าง DNS record ตามที่ Vercel แสดง
4. รอ Vercel ออก certificate
5. เปิดทั้ง root route และ deep link เช่น `/student/profile`

หลัง custom domain พร้อม ให้กลับไปยืนยันอีกครั้ง:

- Supabase Site URL/Redirect URL ใช้ custom Frontend domain
- Backend `FRONTEND_ORIGINS`/CORS ใช้ custom Frontend origin
- Vercel `VITE_API_ORIGIN` ใช้ custom API origin
- CSP มี custom API/Supabase origins

## 14. ตาราง Link URLs ที่ต้องตรงกัน

| จุดตั้งค่า | ต้องใส่อะไร | ตัวอย่าง |
|---|---|---|
| Vercel custom domain | Frontend hostname | `app.attendance.example.ac.th` |
| Vercel `VITE_API_ORIGIN` | Backend origin | `https://api.attendance.example.ac.th` |
| Vercel `VITE_SUPABASE_URL` | Supabase project URL | `https://YOUR_PROJECT_REF.supabase.co` |
| Backend `CORS_ORIGINS` / Compose `FRONTEND_ORIGINS` | Frontend origin | `https://app.attendance.example.ac.th` |
| Backend `TRUSTED_HOSTS` / Compose `API_HOST` | API hostname | `api.attendance.example.ac.th` |
| Supabase Site URL | Frontend Production URL | `https://app.attendance.example.ac.th` |
| Supabase Redirect URL | ค่า `window.location.origin` ของ Frontend | `https://app.attendance.example.ac.th` |
| Google Authorized redirect URI | Supabase Auth callback | `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` |
| Public DNS A/AAAA ของ API | Public IP ของ Router/Mini PC | ค่าจริงของสถานที่ |
| Nginx upstream | FastAPI loopback | `http://127.0.0.1:8000` |
| Backend `OCR_SERVICE_URL` | Docker service DNS | `http://ocr:3001` |

จำง่าย ๆ: **Browser รู้ Vercel + API + Supabase public URL; Nginx รู้ FastAPI loopback; Backend รู้ Supabase secret + OCR service; OCR ไม่ต้องรู้ Public Internet URL**

## 15. ตรวจ CORS ให้จบก่อนเปิดใช้งาน

ทดสอบ preflight จากเครื่องภายนอก:

```bash
curl -i -X OPTIONS 'https://api.attendance.example.ac.th/api/v1/auth/me' \
  -H 'Origin: https://app.attendance.example.ac.th' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

ผลที่คาดหวัง:

```text
HTTP/2 200
access-control-allow-origin: https://app.attendance.example.ac.th
access-control-allow-credentials: true
```

ทดสอบ origin ที่ไม่ได้อนุญาต ต้อง **ไม่มี** `access-control-allow-origin`:

```bash
curl -i -X OPTIONS 'https://api.attendance.example.ac.th/api/v1/auth/me' \
  -H 'Origin: https://evil.example' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

ห้ามแก้ด้วย `mode: no-cors` เพราะ response จะเป็น opaque และแอปอ่านข้อมูลไม่ได้

ถ้า CORS header หาย:

1. ตรวจว่า API domain ตอบจาก Nginx/FastAPI จริง ไม่ใช่ Router, captive portal หรือ error page
2. ตรวจ `curl https://api.../health/live`
3. ตรวจ `FRONTEND_ORIGINS` ไม่มี slash/path และมีค่าที่ตรงกับ Browser `window.location.origin`
4. recreate Backend หลังแก้ env:

```bash
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f /opt/km-attendance/repository/deployment/docker/compose.production.yml \
  up -d --force-recreate backend
```

5. ตรวจ Docker/Nginx logs โดยไม่พิมพ์ secret

## 16. Acceptance Test ก่อนเปิด Production

### 16.1 Infrastructure

- DNS A/AAAA ถูกต้องจาก Internet อย่างน้อยสองเครือข่าย
- TLS chain ผ่านและ `certbot renew --dry-run` ผ่าน
- UFW เปิดเฉพาะ port ที่จำเป็น
- 8000/3001 เข้าไม่ได้จาก Internet
- Docker containers healthy หลัง reboot
- `/health/live` ภายนอกผ่าน; `/health/ready` ภายนอกถูกปฏิเสธ
- Supabase migrations ตรงและ Advisors ได้รับการ review

### 16.2 Frontend/Auth

- Production build มาจาก commit/tag ที่บันทึกไว้
- Google login กลับ custom Frontend domain ไม่กลับ Preview/localhost
- logout แล้ว session ถูกล้าง
- refresh deep route ไม่ 404
- PWA ติดตั้งและอัปเดต service worker ได้
- Browser bundle ไม่มี server key/token

### 16.3 Role และฟังก์ชัน

- Student, Teacher, Admin เข้าถึงเฉพาะสิทธิ์ของตน
- Dynamic QR, passive liveness, face matching, NFC และ manual attendance ทำงาน
- Teacher session คงอยู่เมื่อเปลี่ยนหน้าและปิดได้โดยอาจารย์
- Support requests/attachments, roster import และ report exports ทำงาน
- Export Excel/CSV/PDF แสดง `1`, `/`, `X` และเกณฑ์รายวิชาถูกต้อง
- ทดลอง iPhone Safari/PWA และ Android Chrome/PWA ด้วยกล้องจริง

### 16.4 Failure และ Load Test

- restart OCR แล้ว Backend readiness กลับมาได้
- restart Backend แล้ว Nginx กลับมาให้บริการ
- จำลอง Supabase timeout/Internet หลุดและตรวจข้อความผิดพลาด
- ทดสอบ burst 30–40 คนด้วย payload ใกล้ของจริงบน Mini PC/uplink จริง
- บันทึก CPU, RAM, temperature, p95 latency และ error rate

Mini PC 4-core/RAM 8 GB ใช้ FastAPI 1 worker ตาม Dockerfile เพราะแต่ละ worker อาจโหลด face model ซ้ำ อย่าเพิ่ม worker/concurrency จากการคาดเดา

## 17. ลำดับ Go-live ที่แนะนำ

สำหรับ release ที่ Frontend และ Backend ต้องเปลี่ยนพร้อมกัน:

1. ประกาศ maintenance window หรือใช้ backward-compatible API
2. ยืนยัน backup และ rollback revision
3. Apply reviewed Supabase migrations ก่อน เฉพาะ migration ที่ backward-compatible
4. Deploy Backend/OCR Docker release ใหม่และรอ `/health/ready`
5. Deploy/Promote Vercel Production จาก `main`
6. ทดสอบ Google login, `/api/v1/auth/me` และหนึ่ง attendance flow
7. เฝ้าดู logs/health/load ระยะแรก
8. ปิด maintenance เมื่อ acceptance ผ่าน

เหตุผลที่ Backend มาก่อนคือ Frontend ใหม่อาจเรียก API contract ใหม่ หาก migration เป็น breaking change ต้องใช้ expand-and-contract หลาย release ไม่ควรเปลี่ยน schema แบบทำให้ Backend เก่าหยุดทันที

## 18. การอัปเดต release ครั้งต่อไป

บนเครื่องพัฒนา:

```bash
git switch main
git pull --ff-only origin main
scripts/verify_release.sh
git tag -a v1.0.1 -m "Production release v1.0.1"
git push origin v1.0.1
```

บน Mini PC:

```bash
cd /opt/km-attendance/repository
git fetch --tags origin
git checkout --detach v1.0.1
git status --short --branch
sudoedit /etc/km-attendance/compose.env
# เปลี่ยน RELEASE_ID=v1.0.1

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

ตรวจ health และ acceptance ทุกครั้ง ไม่ใช้ `--no-cache` เป็นค่าเริ่มต้นเพราะ lockfile และ Docker layers ถูกออกแบบให้ build ทำซ้ำได้ ใช้เมื่อสืบสวน cache problem เท่านั้น

## 19. Rollback

### 19.1 Backend/OCR

1. checkout tag ก่อนหน้า
2. เปลี่ยน `RELEASE_ID` ใน `/etc/km-attendance/compose.env`
3. รัน `config --quiet`, `build` และ `up -d`
4. ตรวจ live/ready และ authenticated flow

```bash
cd /opt/km-attendance/repository
git fetch --tags origin
git checkout --detach v1.0.0
sudoedit /etc/km-attendance/compose.env

sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml \
  up -d --remove-orphans
```

ถ้า image ของ release เก่ายังอยู่ Compose จะใช้ได้ทันที; หาก source tag เปลี่ยนต้อง build image ของ tag นั้น ห้ามแก้ tag เดิม

### 19.2 Frontend

ใน Vercel เลือก Production Deployment ก่อนหน้าที่ผ่าน acceptance แล้วกด Promote/Rollback หรือ revert commit บน Git ด้วย commit ใหม่ ห้าม force-push `main`

### 19.3 Database

อย่าลบ migration ที่ apply แล้ว ใช้ reviewed compensating migration การ restore database มีผลมากกว่าการ rollback application และต้องผ่านแผน incident/backup ขององค์กร

ถ้า Frontend/Backend API contract เปลี่ยนเป็นคู่ ให้ rollback ทั้งสองฝั่งเพื่อไม่ให้ revision ไม่เข้ากัน

## 20. Monitoring, Backup และงานดูแลประจำ

### ทุกวัน/อัตโนมัติ

- ตรวจ `https://api.../health/live` จากระบบ monitor ภายนอก
- แจ้งเตือนเมื่อ Mini PC offline, disk/RAM/temperature สูง หรือ certificate ใกล้หมดอายุ
- ตรวจ Docker container restart count และ Nginx 4xx/5xx rate
- ไม่ส่ง request body, token, ภาพ หรือข้อมูลนักศึกษาเข้า external monitoring

### ทุกสัปดาห์

```bash
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f /opt/km-attendance/repository/deployment/docker/compose.production.yml \
  ps
sudo docker system df
sudo journalctl -u nginx --since '7 days ago' --no-pager
```

อย่ารัน `docker system prune -a` แบบอัตโนมัติ เพราะอาจลบ rollback images

### Backup

- ใช้ Supabase backup/PITR ตาม plan และทดสอบ restore
- backup `/etc/km-attendance` แบบเข้ารหัสและจำกัดผู้เข้าถึง
- backup Nginx config และ inventory ของ certificate แต่ไม่คัดลอก private key ไปที่ไม่ปลอดภัย
- source และ migrations อยู่ใน Git remote
- model ต้องมี checksum และแหล่งดาวน์โหลด/สิทธิ์ใช้งานที่ตรวจสอบได้
- ระบบนี้ไม่เก็บ PostgreSQL ใน Docker จึงไม่มี database volume ให้ backup บน Mini PC

## 21. ปัญหาที่พบบ่อย

### Vercel build ไม่พบ `package.json`

ตั้ง Root Directory เป็น `frontend`

### Vercel เปิด deep link แล้ว 404

ตรวจ `frontend/vercel.json` และ SPA rewrite ไป `/index.html`

### แก้ Env แล้วเว็บยังใช้ URL เก่า

ค่า `VITE_*` ถูกฝังตอน build ต้อง redeploy และอาจต้อง refresh/reinstall PWA เพื่อให้ service worker รับ bundle ใหม่

### OAuth กลับ Preview/Production ผิดตัว

ตรวจ `redirectTo: window.location.origin`, Supabase Site URL, exact Redirect URLs และ environment ของ deployment ที่กำลังเปิด

### `400 Invalid host header`

ตรวจ `API_HOST`/`TRUSTED_HOSTS` เป็น hostname ของ API ที่ Nginx ส่งใน `Host`

### `502 Bad Gateway`

```bash
curl -i http://127.0.0.1:8000/health/live
sudo docker compose \
  --env-file /etc/km-attendance/compose.env \
  -f /opt/km-attendance/repository/deployment/docker/compose.production.yml \
  ps
sudo journalctl -u nginx -n 100 --no-pager
```

ถ้า loopback ไม่ตอบให้ตรวจ Backend container; ถ้า loopback ตอบแต่ HTTPS 502 ให้ตรวจ Nginx upstream/config/firewall local

### `503 Service Unavailable`

ตรวจ `/health/ready`, Backend/OCR logs, token ระหว่าง Backend/OCR และ outbound HTTPS ไป Supabase

### `401 Unauthorized` ที่ `/api/v1/auth/me`

ถ้าไม่มี Bearer token ถือว่าปกติ ถ้าล็อกอินแล้วให้ตรวจว่า Frontend auth interceptor แนบ Supabase access token และเวลา Mini PC/NTP ถูกต้อง

### กล้องใช้ไม่ได้

Frontend ต้องใช้ HTTPS/localhost, Permissions Policy ต้องอนุญาต camera จาก self และผู้ใช้ต้องอนุญาต browser permission

### Mini PC ปิดแล้ว URL ยังเข้าได้หรือไม่

Frontend Vercel และ Supabase ยังเปิดได้ แต่ทุกฟังก์ชันที่เรียก Backend จะล้มเหลว Nginx/Docker ไม่สามารถทำงานเมื่อเครื่องไม่มีไฟ วิธีลดปัญหาคือ:

1. ใช้ Mini PC ที่เปิด 24/7 พร้อม UPS
2. ตั้ง BIOS auto power-on after power loss
3. enable Docker/Nginx และใช้ container restart policy
4. ใช้ stable DNS; ถ้า IP เปลี่ยนใช้ DDNS
5. ใช้ external monitoring
6. ถ้าต้องการ SLA สูง ให้มี second host/failover หรือย้าย API ไป managed server

ไม่ใช้ ngrok free random URL เป็น Production เพราะ URL/lifecycle ไม่ได้ผูกกับความพร้อมใช้งานของเครื่องและเมื่อ agent/เครื่องปิด tunnel จะหาย

## 22. Security และ Privacy Checklist

- [ ] ไม่มี service-role/secret key ใน Vercel, Git, browser bundle หรือ screenshot
- [ ] Backend/OCR env permission จำกัดและ backup แบบเข้ารหัส
- [ ] CORS เป็น exact HTTPS origin ไม่มี `*`
- [ ] Trusted Hosts เป็น exact API host ไม่มี `*`
- [ ] Nginx เป็น public entry point เดียว; 8000/3001 ไม่เปิด Internet
- [ ] TLS renewal ทดสอบแล้ว
- [ ] RLS เปิดทุก table ที่ Browser เข้าถึง และ policies ผ่าน review
- [ ] Backend ตรวจ Supabase JWT และ role/ownership ซ้ำทุก sensitive endpoint
- [ ] ไม่ log Authorization header, image, embedding, OCR raw text หรือข้อมูลนักศึกษา
- [ ] biometric retention/deletion/consent และ model license ผ่านการอนุมัติ
- [ ] Supabase Auth/Security Advisor findings มี owner และคำตัดสิน
- [ ] load test ใช้ข้อมูลจำลอง/ได้รับอนุญาต
- [ ] มี application rollback และ database recovery runbook

## 23. ไฟล์ที่เกี่ยวข้องใน repository

Repository ยังมีตัวติดตั้งแบบ native systemd ที่รองรับ flag `--api-only` อยู่ใน `scripts/install_production_release.sh` แต่แผนในคู่มือนี้เลือก Docker Compose จึง **ไม่ควรรันตัวติดตั้ง `--api-only` และ Compose บนพอร์ต 8000 พร้อมกัน** ให้เลือก runtime owner เพียงแบบเดียว ส่วน Nginx API-only template ใช้ร่วมกับแนวทาง Docker นี้ได้

| ไฟล์ | หน้าที่ |
|---|---|
| `frontend/vercel.json` | SPA rewrite ของ Vercelที่ deploy จริง |
| `deployment/vercel/vercel.json.example` | template security headers/CSP สำหรับ Vercel |
| `frontend/.env.local.example` | Frontend env สำหรับ development |
| `deployment/frontend.env.production.example` | Frontend Production env template |
| `backend/Dockerfile` | FastAPI image, non-root user, 1 worker, healthcheck |
| `ocr-service/Dockerfile` | Light OCR imageบน Debian Trixie-compatible Node runtime |
| `deployment/backend.env.example` | Backend Production env template |
| `deployment/ocr.env.example` | OCR Production env template |
| `deployment/docker/compose.production.yml` | Production FastAPI/OCR Docker Compose |
| `deployment/docker/production.compose.env.example` | Production topology/resource template |
| `deployment/docker/compose.staging.yml` | Staging บนเครื่องพัฒนา ไม่ใช้แทน Production |
| `deployment/nginx/attendance-api-only.conf.example` | Public API-only TLS reverse proxy |
| `scripts/verify_release.sh` | release tests/build gate |
| `scripts/check_supabase_release.sh` | migration/lint/advisor gate |
| `scripts/verify_face_models.sh` | model file/checksum gate |

## 24. Quick Runbook หลังตั้งค่าครั้งแรกแล้ว

```bash
# Development/release machine
git switch main
git pull --ff-only origin main
scripts/verify_release.sh

# Mini PC
cd /opt/km-attendance/repository
git fetch --tags origin
git checkout --detach <RELEASE_TAG>
sudoedit /etc/km-attendance/compose.env
sudo docker compose --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml config --quiet
sudo docker compose --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml build --pull
sudo docker compose --env-file /etc/km-attendance/compose.env \
  -f deployment/docker/compose.production.yml up -d --remove-orphans
curl --fail http://127.0.0.1:8000/health/ready
curl --fail https://api.attendance.example.ac.th/health/live

# Vercel
# Push/merge the reviewed commit to the configured Production Branch,
# then verify the deployment and custom domain in the Dashboard.
```

## 25. เอกสารทางการที่ควรตรวจเมื่อเวอร์ชันเปลี่ยน

- [Vercel: Deploying Git Repositories](https://vercel.com/docs/git)
- [Vercel: Environments](https://vercel.com/docs/deployments/environments)
- [Vercel: Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel: Vite](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel: Deploy from CLI](https://vercel.com/docs/projects/deploy-from-cli)
- [Docker: Install Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker: Use Compose in Production](https://docs.docker.com/compose/how-tos/production/)
- [Nginx: Reverse Proxy](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/)
- [Certbot Documentation](https://eff-certbot.readthedocs.io/)
- [Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase: Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase: Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase: Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase Changelog](https://supabase.com/changelog)

## สรุป

เส้นทาง Production ที่ถูกต้องของระบบนี้คือ **Vercel ส่ง Frontend -> Browser เรียก HTTPS API domain -> Nginx บน Mini PC -> FastAPI container -> OCR container/Supabase** ค่า URL ทั้งห้าจุด—Vercel env, Backend CORS, Backend Trusted Hosts, Supabase redirect และ Google callback—ต้องทำหน้าที่คนละอย่างและต้องตรงตามตารางในหัวข้อ 14

การ deploy สำเร็จไม่ได้จบที่ `docker compose up` หรือ Vercelแสดง Ready ต้องผ่าน health, CORS, OAuth, role, real-device, load, reboot, backup และ rollback tests ก่อนประกาศ Production และต้องยอมรับว่า Mini PC เป็น single point of failure จนกว่าจะมี UPS, monitoring และ failover ที่เหมาะสม
