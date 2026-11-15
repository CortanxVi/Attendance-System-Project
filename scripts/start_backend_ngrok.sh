#!/usr/bin/env bash
# Run the Backend and Light OCR of the current branch directly on this machine
# (no Docker) and expose them through ngrok so the system can be tested from the
# Internet. Two shapes:
#   - default: only the Backend is tunnelled; a Frontend Preview hosted elsewhere
#     (for example Vercel) calls it.
#   - --host-frontend: this machine also builds and serves the Frontend and puts
#     both behind ONE ngrok URL (web at /, API at /api). No Vercel is needed.
#
#   scripts/start_backend_ngrok.sh [start]   run in the foreground (Ctrl+C stops all)
#   scripts/start_backend_ngrok.sh start --host-frontend [--test-mode]
#                                            build + serve the Frontend locally too, one URL
#   scripts/start_backend_ngrok.sh start --test-mode
#                                            also skip the QR step and its timers, only for
#                                            the test courses in STAGING_TEST_COURSE_IDS
#   scripts/start_backend_ngrok.sh start --test-mode --all-courses
#                                            same, but for EVERY course a student belongs to
#                                            (real classes included). Deliberate, explicit flag.
#   scripts/start_backend_ngrok.sh start --host-frontend --test-mode --test-database --allow-external-email
#                                            use the SEPARATE test Supabase project (values in the
#                                            private settings file: STAGING_TEST_SUPABASE_URL,
#                                            STAGING_TEST_SUPABASE_SERVICE_KEY,
#                                            STAGING_TEST_SUPABASE_ANON_KEY) and let any Google
#                                            account sign in. --allow-external-email refuses to run
#                                            without --test-database, so the real project is never used.
#   scripts/start_backend_ngrok.sh courses   read-only list of courses (ids, created date, counts,
#                                            pending roster invites, test-list marker)
#   scripts/start_backend_ngrok.sh add-test-course <course-uuid>
#                                            add one course to STAGING_TEST_COURSE_IDS (refuses a
#                                            course with unclaimed roster invites); restart afterwards
#   scripts/start_backend_ngrok.sh status    show what is running
#   scripts/start_backend_ngrok.sh stop      stop a run started from another terminal
#
# This is a TEST helper. It uses backend/.env for Supabase credentials, so it
# talks to whichever Supabase project that file points to. Use test accounts only.
# วิธีการรันก็อปคำสั่งไปวางใน terminal vs code: scripts/start_backend_ngrok.sh start --host-frontend --test-mode --test-database --allow-external-email
# code ~/.config/km-attendance/staging.env
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="${STAGING_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/km-attendance-staging}"
secrets_file="${STAGING_ENV_FILE:-$HOME/.config/km-attendance/staging.env}"
backend_port="${STAGING_BACKEND_PORT:-8079}"
ocr_port="${STAGING_OCR_PORT:-3001}"
web_port="${STAGING_WEB_PORT:-4173}"
web_dist="$state_dir/web-dist"
# Must equal TEST_MODE_ACK_PHRASE in backend/core/test_mode.py (a unit test checks this).
test_mode_ack="REMOVE-QR-AND-TIMERS-FOR-LISTED-TEST-COURSES-ONLY"
all_courses_ack="ALL-COURSES-INCLUDING-REAL-CLASSES-ARE-AFFECTED"
# Must equal EXTERNAL_EMAIL_ACK_PHRASE in backend/core/test_mode.py (a unit test checks this).
external_email_ack="ALLOW-ANY-GOOGLE-EMAIL-FOR-TESTING-ONLY"

die() { echo "ผิดพลาด: $*" >&2; exit 1; }

# Read KEY=value from a dotenv-style file WITHOUT executing it.
get_var() {
  local file="$1" key="$2" value
  [[ -f "$file" ]] || return 0
  value="$(sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" | tail -n 1)"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

port_in_use() { (exec 9<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

node_ok() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major === 24 || (major === 22 && minor >= 12) ? 0 : 1)'
}

ngrok_public_url() {
  # The agent's local inspection API lists the public endpoint URL.
  local port body url
  for port in 4040 4041 4042 4043; do
    body="$(curl -fsS -m 2 "http://127.0.0.1:${port}/api/endpoints" 2>/dev/null)" || continue
    url="$(printf '%s' "$body" | python3 -I -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for item in data.get("endpoints", []):
    u = item.get("url", "")
    if u.startswith("https://"):
        print(u)
        break
')" || true
    if [[ -n "$url" ]]; then printf '%s' "$url"; return 0; fi
  done
  return 1
}

pid_file() { printf '%s/%s.pid' "$state_dir" "$1"; }

# Only signal a PID if its command line still looks like the process we started.
safe_kill() {
  local name="$1" expect="$2" file pid
  file="$(pid_file "$name")"
  [[ -f "$file" ]] || return 0
  pid="$(<"$file")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && [[ -r "/proc/$pid/cmdline" ]] \
     && tr '\0' ' ' <"/proc/$pid/cmdline" | grep -q -- "$expect"; then
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

cmd_status() {
  local name pid url
  for name in ngrok ocr backend web; do
    if [[ -f "$(pid_file "$name")" ]] && kill -0 "$(<"$(pid_file "$name")")" 2>/dev/null; then
      echo "$name: กำลังทำงาน (pid $(<"$(pid_file "$name")"))"
    else
      echo "$name: ไม่ได้ทำงาน"
    fi
  done
  if curl -fsS -m 3 "http://127.0.0.1:${backend_port}/health/ready" 2>/dev/null; then echo; else echo "Backend /health/ready: ไม่ตอบ"; fi
  if url="$(ngrok_public_url)"; then echo "ngrok URL: $url"; else echo "ngrok URL: ไม่พบ"; fi
}

# Read-only helper: shows which courses exist so test courses can be chosen by UUID.
# It prints codes, names, counts and ids only: no student, teacher or e-mail data.
cmd_courses() {
  [[ -x "$project_root/backend/.venv/bin/python" ]] || die "ไม่พบ backend/.venv"
  [[ -f "$project_root/backend/.env" ]] || die "ไม่พบ backend/.env"
  (
    cd "$project_root/backend"
    SECRETS_FILE="$secrets_file" .venv/bin/python -I - <<'PY'
import os, re, sys
sys.path.insert(0, ".")
from core.config import supabase_db as db

def rows(table, columns):
    return db.table(table).select(columns).execute().data or []

listed = set()
try:
    text = open(os.environ["SECRETS_FILE"], encoding="utf8").read()
    found = re.search(r"^STAGING_TEST_COURSE_IDS=(.*)$", text, re.M)
    if found:
        listed = {part.strip().lower() for part in found.group(1).split(",") if part.strip()}
except OSError:
    pass

courses = rows("courses", "id, course_code, course_name, section, year, semester, created_at")
members, pending = {}, {}
for row in rows("enrollments", "course_id"):
    members[row["course_id"]] = members.get(row["course_id"], 0) + 1
invites = {row["id"]: row for row in rows("profile_invites", "id, claimed_at")}
for row in rows("profile_invite_courses", "invite_id, course_id"):
    invite = invites.get(row["invite_id"])
    if invite is not None and invite.get("claimed_at") is None:
        pending[row["course_id"]] = pending.get(row["course_id"], 0) + 1

print(f"{'course_id':36}  {'created':10} {'code':10} {'sec':>3} {'year/sem':9} {'members':>7} {'pending':>7} test  name")
for course in sorted(courses, key=lambda c: str(c.get("created_at")), reverse=True):
    cid = course["id"]
    flag = "  <-- real students are waiting to sign in" if pending.get(cid) else ""
    mark = "YES" if cid.lower() in listed else "-"
    print(f"{cid:36}  {str(course.get('created_at'))[:10]:10} {str(course.get('course_code')):10} {str(course.get('section')):>3} "
          f"{str(course.get('year')) + '/' + str(course.get('semester')):9} "
          f"{members.get(cid, 0):>7} {pending.get(cid, 0):>7} {mark:4}  {course.get('course_name')}{flag}")
print()
print("pending = roster invites not yet claimed. Those students become members automatically at")
print("first sign-in, so a course with pending > 0 is a real class: do not use it as a test course.")
print("test = YES means the course is in STAGING_TEST_COURSE_IDS (the QR-free test mode applies to it).")
print("To add a course: scripts/start_backend_ngrok.sh add-test-course <course_id>, then restart the script.")
PY
  )
}

# Adds ONE course to STAGING_TEST_COURSE_IDS in the private settings file, after checking
# that it exists and has no unclaimed roster invites (those students would be real).
cmd_add_test_course() {
  local target="${1:-}"
  [[ -n "$target" ]] || die "ใช้: scripts/start_backend_ngrok.sh add-test-course <course-uuid> (ดู id ได้จากคำสั่ง courses)"
  [[ -x "$project_root/backend/.venv/bin/python" ]] || die "ไม่พบ backend/.venv"
  [[ -f "$project_root/backend/.env" ]] || die "ไม่พบ backend/.env"
  [[ -f "$secrets_file" ]] || die "ไม่พบ $secrets_file (รัน start หนึ่งครั้งเพื่อสร้างไฟล์ก่อน)"
  (
    cd "$project_root/backend"
    SECRETS_FILE="$secrets_file" TARGET="$target" .venv/bin/python -I - <<'PY'
import os, re, sys, tempfile
sys.path.insert(0, ".")
from core.config import supabase_db as db

UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
secrets, target = os.environ["SECRETS_FILE"], os.environ["TARGET"].strip().lower()
if not UUID.match(target):
    sys.exit("ผิดพลาด: ต้องเป็น UUID ของรายวิชา (ไม่ใช่รหัสวิชา) ดูได้จากคำสั่ง courses")

found = db.table("courses").select("id, course_code, course_name, section, year, semester, created_at").eq("id", target).execute().data
if not found:
    sys.exit("ผิดพลาด: ไม่พบรายวิชานี้ในฐานข้อมูล")
course = found[0]
pending = 0
for link in db.table("profile_invite_courses").select("invite_id").eq("course_id", target).execute().data or []:
    invite = db.table("profile_invites").select("claimed_at").eq("id", link["invite_id"]).execute().data
    if invite and invite[0].get("claimed_at") is None:
        pending += 1
members = len(db.table("enrollments").select("student_id").eq("course_id", target).execute().data or [])
print(f"วิชา: {course['course_code']} {course['course_name']} (sec {course['section']}, {course['year']}/{course['semester']}), "
      f"สร้างเมื่อ {str(course['created_at'])[:10]}, สมาชิก {members}, รอเข้าสู่ระบบ {pending}")
if pending:
    sys.exit("ปฏิเสธ: วิชานี้มีรายชื่อที่ยังไม่เคยล็อกอิน (เป็นนักศึกษาจริงที่จะเข้าวิชาอัตโนมัติ) จึงใช้เป็นวิชาทดสอบไม่ได้")

text = open(secrets, encoding="utf8").read()
match = re.search(r"^STAGING_TEST_COURSE_IDS=(.*)$", text, re.M)
current = [part.strip().lower() for part in match.group(1).split(",") if part.strip()] if match else []
if target in current:
    print("อยู่ในรายการวิชาทดสอบอยู่แล้ว ไม่ต้องทำอะไร")
    sys.exit(0)
line = "STAGING_TEST_COURSE_IDS=" + ",".join(current + [target])
text = re.sub(r"^STAGING_TEST_COURSE_IDS=.*$", line, text, count=1, flags=re.M) if match else text.rstrip("\n") + "\n" + line + "\n"
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(secrets))
with os.fdopen(fd, "w", encoding="utf8") as handle:
    handle.write(text)
os.chmod(tmp, 0o600)
os.replace(tmp, secrets)
print(f"เพิ่มแล้ว ตอนนี้มีวิชาทดสอบ {len(current) + 1} วิชา ต้องหยุดแล้วรันสคริปต์ใหม่เพื่อให้มีผล")
PY
  )
}

cmd_stop() {
  safe_kill backend "uvicorn"
  safe_kill ocr "ocr-server.js"
  safe_kill web "vite"
  safe_kill ngrok "ngrok"
  echo "ส่งสัญญาณหยุด backend / ocr / web / ngrok ที่ถูกเปิดโดยสคริปต์นี้แล้ว"
}

cmd_start() {
  local test_mode=false all_courses=false host_frontend=false allow_external=false test_database=false arg
  for arg in "$@"; do
    case "$arg" in
      --test-mode) test_mode=true ;;
      --all-courses) all_courses=true ;;
      --host-frontend) host_frontend=true ;;
      --allow-external-email) allow_external=true ;;
      --test-database) test_database=true ;;
      *) die "ตัวเลือกไม่ถูกต้อง: $arg (ใช้ได้เฉพาะ --test-mode, --all-courses, --host-frontend, --allow-external-email และ --test-database)" ;;
    esac
  done
  if [[ "$all_courses" == true && "$test_mode" != true ]]; then
    die "--all-courses ใช้ได้เฉพาะคู่กับ --test-mode"
  fi
  if [[ "$allow_external" == true && "$test_mode" != true ]]; then
    die "--allow-external-email ใช้ได้เฉพาะคู่กับ --test-mode"
  fi
  # External e-mails are only ever allowed against the separate test database, so the
  # real project never gets accounts created from non-university addresses.
  if [[ "$allow_external" == true && "$test_database" != true ]]; then
    die "--allow-external-email ต้องใช้คู่กับ --test-database (ฐานข้อมูลทดสอบแยกจากของจริง)"
  fi
  if [[ "$test_database" == true && "$test_mode" != true ]]; then
    die "--test-database ใช้ได้เฉพาะคู่กับ --test-mode"
  fi
  if [[ "$test_database" == true && "$all_courses" == true ]]; then
    die "--test-database ไม่ควรใช้กับ --all-courses (ฐานข้อมูลทดสอบมีเฉพาะวิชาทดสอบ)"
  fi

  # ---------- prerequisites ----------
  command -v ngrok >/dev/null 2>&1 || die "ไม่พบคำสั่ง ngrok"
  command -v curl >/dev/null 2>&1 || die "ไม่พบคำสั่ง curl"
  command -v python3 >/dev/null 2>&1 || die "ไม่พบ python3"
  command -v openssl >/dev/null 2>&1 || die "ไม่พบ openssl"

  if ! node_ok && [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    set +e +u
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1
    nvm use 22 >/dev/null 2>&1
    set -eu
  fi
  node_ok || die "ต้องใช้ Node.js 22.12+ หรือ 24 (ตอนนี้ $(node --version 2>/dev/null || echo 'ไม่พบ')) รัน 'nvm use 22' ก่อน"

  [[ -x "$project_root/backend/.venv/bin/python" ]] || die "ไม่พบ backend/.venv"
  for f in backend/.env ocr-service/.env; do
    [[ -f "$project_root/$f" ]] || die "ไม่พบ $f"
  done
  INSIGHTFACE_MODEL_ROOT="${INSIGHTFACE_MODEL_ROOT:-$HOME/.insightface}" \
    "$project_root/scripts/verify_face_models.sh" >/dev/null \
    || die "ตรวจโมเดลใบหน้าไม่ผ่าน (รัน scripts/verify_face_models.sh เพื่อดูรายละเอียด)"

  local -a check_ports=("$backend_port" "$ocr_port")
  if [[ "$host_frontend" == true ]]; then
    check_ports+=("$web_port")
    [[ -x "$project_root/frontend/node_modules/.bin/vite" ]] || die "ไม่พบ frontend/node_modules (รัน npm ci ใน frontend ก่อน)"
    [[ -n "$(get_var "$project_root/frontend/.env.local" VITE_SUPABASE_URL)" \
       && -n "$(get_var "$project_root/frontend/.env.local" VITE_SUPABASE_ANON_KEY)" ]] \
      || die "frontend/.env.local ต้องมี VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY (ค่าชุดเดียวกับโปรเจกต์ Supabase ของ backend)"
  fi
  for port in "${check_ports[@]}"; do
    [[ "$port" =~ ^[0-9]+$ ]] && ((port >= 1024 && port <= 65535)) || die "พอร์ตต้องเป็นตัวเลข 1024-65535"
    if port_in_use "$port"; then
      die "พอร์ต $port ถูกใช้งานอยู่ (ถ้าเป็น Docker staging ให้หยุดก่อน หรือกำหนด STAGING_BACKEND_PORT / STAGING_OCR_PORT / STAGING_WEB_PORT)"
    fi
  done
  if pgrep -x ngrok >/dev/null 2>&1; then
    die "มี ngrok ทำงานอยู่แล้ว กรุณาปิดก่อนเพื่อไม่ให้ URL สับสน"
  fi

  # ---------- staging secrets (kept OUTSIDE the repository) ----------
  umask 077
  mkdir -p "$state_dir" "$(dirname "$secrets_file")"
  chmod 700 "$state_dir" "$(dirname "$secrets_file")" 2>/dev/null || true

  if [[ ! -f "$secrets_file" ]]; then
    local prefill=""
    if [[ -f "$project_root/deployment/docker/.env" ]]; then
      prefill="$(get_var "$project_root/deployment/docker/.env" STAGING_FRONTEND_ORIGINS \
        | tr ',' '\n' | grep -E '^https://' | paste -sd, - || true)"
    fi
    {
      echo "# Local staging settings for scripts/start_backend_ngrok.sh."
      echo "# Keep this file private (mode 600). Never commit it or paste it into chat."
      echo "LIVENESS_SIGNING_KEY=$(openssl rand -hex 32)"
      echo "TEMP_ADMIN_PIN_PEPPER=$(openssl rand -hex 32)"
      echo "# Exact HTTPS origins of the Frontend Preview, comma separated, no path."
      echo "# Add the Vercel branch URL of the tuningModel Preview here."
      echo "STAGING_FRONTEND_ORIGINS=${prefill}"
      echo "# Only for 'start --test-mode': course UUIDs (not course codes) of TEST courses, comma separated."
      echo "# STAGING_TEST_COURSE_IDS="
    } >"$secrets_file"
    chmod 600 "$secrets_file"
    echo "สร้างไฟล์ตั้งค่า staging ใหม่แล้วที่: $secrets_file"
    echo "ตรวจและแก้ STAGING_FRONTEND_ORIGINS ให้มี URL ของ Preview ที่ต้องการ แล้วรันสคริปต์อีกครั้ง"
    exit 1
  fi

  local liveness_key pepper origins ocr_token_backend ocr_token_ocr
  liveness_key="$(get_var "$secrets_file" LIVENESS_SIGNING_KEY)"
  pepper="$(get_var "$secrets_file" TEMP_ADMIN_PIN_PEPPER)"
  origins="$(get_var "$secrets_file" STAGING_FRONTEND_ORIGINS)"
  origins="${STAGING_FRONTEND_ORIGINS:-$origins}"
  ((${#liveness_key} >= 32)) || die "LIVENESS_SIGNING_KEY ใน $secrets_file ต้องยาวอย่างน้อย 32 ตัวอักษร"
  ((${#pepper} >= 32)) || die "TEMP_ADMIN_PIN_PEPPER ใน $secrets_file ต้องยาวอย่างน้อย 32 ตัวอักษร"
  local origin
  if [[ "$host_frontend" != true ]]; then
    # With --host-frontend the only allowed origin is the ngrok URL, known later.
    [[ -n "$origins" ]] || die "STAGING_FRONTEND_ORIGINS ว่าง ใส่ URL Preview แบบ https://... ใน $secrets_file"
    IFS=',' read -r -a origin_list <<<"$origins"
    for origin in "${origin_list[@]}"; do
      [[ "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] \
        || die "origin ไม่ถูกต้อง (ต้องเป็น https://host ไม่มี / ท้าย ไม่มี path): $origin"
    done
  fi
  ocr_token_backend="$(get_var "$project_root/backend/.env" OCR_SERVICE_TOKEN)"
  ocr_token_ocr="$(get_var "$project_root/ocr-service/.env" OCR_SERVICE_TOKEN)"
  ((${#ocr_token_backend} >= 32)) || die "OCR_SERVICE_TOKEN ใน backend/.env ต้องยาวอย่างน้อย 32 ตัวอักษร"
  [[ "$ocr_token_backend" == "$ocr_token_ocr" ]] || die "OCR_SERVICE_TOKEN ใน backend/.env และ ocr-service/.env ไม่ตรงกัน"

  # Test mode removes the QR step and timers. By default it is limited to the course
  # UUIDs listed as test courses; --all-courses is the only way to widen it.
  local test_course_ids="" course_id test_scope="listed"
  local -a test_env=() course_id_list=()
  if [[ "$test_mode" == true ]]; then
    # Against the separate test database the course list is its own variable, so ids that
    # belong to the real database are never sent to (or auto-joined in) the test one.
    if [[ "$test_database" == true ]]; then
      test_course_ids="$(get_var "$secrets_file" STAGING_TEST_DB_COURSE_IDS)"
      test_course_ids="${STAGING_TEST_DB_COURSE_IDS:-$test_course_ids}"
    else
      test_course_ids="$(get_var "$secrets_file" STAGING_TEST_COURSE_IDS)"
      test_course_ids="${STAGING_TEST_COURSE_IDS:-$test_course_ids}"
    fi
    if [[ "$all_courses" == true ]]; then
      [[ -z "$test_course_ids" ]] || die "ใช้ --all-courses พร้อม STAGING_TEST_COURSE_IDS ไม่ได้ ลบหรือคอมเมนต์บรรทัดนั้นก่อน"
      test_scope="all"
      test_env=(
        "ATTENDANCE_TEST_MODE=1"
        "ATTENDANCE_TEST_MODE_ACK=${test_mode_ack}"
        "ATTENDANCE_TEST_ALL_COURSES_ACK=${all_courses_ack}"
      )
    elif [[ -n "$test_course_ids" ]]; then
      IFS=',' read -r -a course_id_list <<<"$test_course_ids"
      for course_id in "${course_id_list[@]}"; do
        [[ "$course_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
          || die "STAGING_TEST_COURSE_IDS ต้องเป็น UUID ของรายวิชาเท่านั้น (ไม่ใช่รหัสวิชา)"
      done
      test_env=(
        "ATTENDANCE_TEST_MODE=1"
        "ATTENDANCE_TEST_MODE_ACK=${test_mode_ack}"
        "ATTENDANCE_TEST_COURSE_IDS=${test_course_ids}"
      )
    else
      die "--test-mode ต้องมี STAGING_TEST_COURSE_IDS (หรือ STAGING_TEST_DB_COURSE_IDS เมื่อใช้ --test-database) (UUID วิชาทดสอบ) ใน $secrets_file ดูรายวิชาด้วย: scripts/start_backend_ngrok.sh courses หรือใช้ --all-courses ถ้าต้องการให้ครอบคลุมทุกวิชา"
    fi
  fi

  # A separate Supabase project for testing. Its values live only in the private settings
  # file (never in the repository) and are passed to this run's processes through the
  # environment, which wins over backend/.env and frontend/.env.local without editing them.
  local -a db_env=() web_db_env=()
  if [[ "$test_database" == true ]]; then
    local t_url t_key t_anon prod_url
    t_url="$(get_var "$secrets_file" STAGING_TEST_SUPABASE_URL)"
    t_key="$(get_var "$secrets_file" STAGING_TEST_SUPABASE_SERVICE_KEY)"
    t_anon="$(get_var "$secrets_file" STAGING_TEST_SUPABASE_ANON_KEY)"
    [[ -n "$t_url" && -n "$t_key" && -n "$t_anon" ]] \
      || die "--test-database ต้องมี STAGING_TEST_SUPABASE_URL, STAGING_TEST_SUPABASE_SERVICE_KEY และ STAGING_TEST_SUPABASE_ANON_KEY ใน $secrets_file"
    [[ "$t_url" =~ ^https://[a-z0-9]{20}\.supabase\.co$ ]] \
      || die "STAGING_TEST_SUPABASE_URL ต้องอยู่ในรูป https://<project-ref>.supabase.co"
    # The real project is named explicitly in the private settings file. backend/.env is
    # NOT used for this comparison: it may legitimately point at the test project.
    prod_url="$(get_var "$secrets_file" STAGING_PROTECTED_SUPABASE_URL)"
    if [[ -z "$prod_url" ]]; then
      [[ "$allow_external" != true ]] \
        || die "--allow-external-email ต้องมี STAGING_PROTECTED_SUPABASE_URL (URL โปรเจกต์ Supabase ของจริง) ใน $secrets_file เพื่อกันไม่ให้เปิดอีเมลภายนอกกับฐานจริง"
      echo "คำเตือน: ไม่ได้ตั้ง STAGING_PROTECTED_SUPABASE_URL จึงตรวจไม่ได้ว่าฐานทดสอบซ้ำกับฐานจริงหรือไม่" >&2
    fi
    [[ -z "$prod_url" || "${t_url%/}" != "${prod_url%/}" ]] \
      || die "STAGING_TEST_SUPABASE_URL ซ้ำกับโปรเจกต์จริง (STAGING_PROTECTED_SUPABASE_URL) ต้องเป็นโปรเจกต์ทดสอบแยกต่างหาก"
    db_env=("SUPABASE_URL=${t_url}" "SUPABASE_KEY=${t_key}")
    web_db_env=("VITE_SUPABASE_URL=${t_url}" "VITE_SUPABASE_ANON_KEY=${t_anon}")
  fi
  if [[ "$allow_external" == true ]]; then
    test_env+=("ATTENDANCE_TEST_EXTERNAL_EMAIL_ACK=${external_email_ack}")
  fi

  # ---------- cleanup handler ----------
  cleanup() {
    trap - EXIT INT TERM
    kill "${backend_pid:-}" "${ocr_pid:-}" "${web_pid:-}" "${ngrok_pid:-}" 2>/dev/null || true
    wait 2>/dev/null || true
    rm -f "$(pid_file backend)" "$(pid_file ocr)" "$(pid_file web)" "$(pid_file ngrok)"
  }
  trap cleanup EXIT INT TERM

  # ---------- 0) build the Frontend (only with --host-frontend) ----------
  # The API is reached on the same origin (/api), so VITE_API_ORIGIN is forced empty.
  # VITE_TEST_MODE is set only for --test-mode builds and goes to a private output
  # directory, never to frontend/dist, so a release build can not pick it up.
  if [[ "$host_frontend" == true ]]; then
    echo "กำลัง build Frontend (ใช้เวลาประมาณ 1–2 นาที)..."
    local -a build_env=("VITE_API_ORIGIN=" "VITE_API_URL=")
    [[ "$test_mode" == true ]] && build_env+=("VITE_TEST_MODE=1")
    [[ "$test_database" == true ]] && build_env+=("${web_db_env[@]}")
    (
      cd "$project_root/frontend"
      exec env -u VITE_TEST_MODE -u VITE_API_ORIGIN -u VITE_API_URL -u VITE_SUPABASE_URL -u VITE_SUPABASE_ANON_KEY "${build_env[@]}" \
        ./node_modules/.bin/vite build --outDir "$web_dist" --emptyOutDir
    ) >"$state_dir/build.log" 2>&1 || die "build Frontend ไม่สำเร็จ ดู $state_dir/build.log"
    [[ -f "$web_dist/index.html" ]] || die "ไม่พบ index.html หลัง build ดู $state_dir/build.log"
  fi

  # ---------- 1) ngrok first, so the public host is known before Backend starts ----------
  local tunnel_port="$backend_port"
  [[ "$host_frontend" == true ]] && tunnel_port="$web_port"
  ngrok http "127.0.0.1:${tunnel_port}" --log=stdout --log-format=json >"$state_dir/ngrok.log" 2>&1 &
  ngrok_pid=$!
  echo "$ngrok_pid" >"$(pid_file ngrok)"

  local public_url="" public_host=""
  echo "กำลังเปิด ngrok..."
  for _ in $(seq 1 40); do
    kill -0 "$ngrok_pid" 2>/dev/null || die "ngrok หยุดทำงาน ดู $state_dir/ngrok.log"
    if public_url="$(ngrok_public_url)"; then break; fi
    sleep 0.5
  done
  [[ -n "$public_url" ]] || die "อ่าน URL จาก ngrok ไม่ได้ ดู $state_dir/ngrok.log"
  public_host="${public_url#https://}"
  [[ "$public_host" =~ ^[A-Za-z0-9.-]+$ ]] || die "ชื่อโฮสต์จาก ngrok ไม่ถูกต้อง"
  # One origin serves both web and API, so it is the only origin the Backend allows.
  [[ "$host_frontend" == true ]] && origins="$public_url"

  # ---------- 2) Light OCR ----------
  (
    cd "$project_root/ocr-service"
    # The OCR worker must never inherit database or browser credentials.
    exec env \
      -u SUPABASE_URL -u SUPABASE_KEY -u SUPABASE_SECRET_KEY \
      -u SUPABASE_SERVICE_ROLE_KEY -u VITE_SUPABASE_URL \
      -u VITE_SUPABASE_ANON_KEY -u VITE_SUPABASE_PUBLISHABLE_KEY \
      -u OCR_SERVICE_TOKEN \
      HOST=127.0.0.1 PORT="$ocr_port" \
      node --env-file="$project_root/ocr-service/.env" ocr-server.js
  ) >"$state_dir/ocr.log" 2>&1 &
  ocr_pid=$!
  echo "$ocr_pid" >"$(pid_file ocr)"

  echo "กำลังรอ Light OCR โหลดโมเดล..."
  local ready=false
  for _ in $(seq 1 120); do
    kill -0 "$ocr_pid" 2>/dev/null || die "Light OCR หยุดทำงาน ดู $state_dir/ocr.log"
    if curl -fsS -m 2 "http://127.0.0.1:${ocr_port}/health" >/dev/null 2>&1; then ready=true; break; fi
    sleep 0.5
  done
  [[ "$ready" == true ]] || die "Light OCR ไม่พร้อมภายใน 60 วินาที"

  # ---------- 3) Backend (production mode: no /docs, strict CORS and secrets) ----------
  local version
  version="tuningModel-$(git -C "$project_root" rev-parse --short HEAD 2>/dev/null || echo unknown)-local"
  (
    cd "$project_root/backend"
    exec env \
      "${test_env[@]}" \
      "${db_env[@]}" \
      APP_ENV=production \
      APP_VERSION="$version" \
      CORS_ORIGINS="$origins" \
      TRUSTED_HOSTS="${public_host},127.0.0.1,localhost" \
      LIVENESS_SIGNING_KEY="$liveness_key" \
      TEMP_ADMIN_PIN_PEPPER="$pepper" \
      OCR_SERVICE_URL="http://127.0.0.1:${ocr_port}" \
      INSIGHTFACE_MODEL_ROOT="${INSIGHTFACE_MODEL_ROOT:-$HOME/.insightface}" \
      .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port "$backend_port" --workers 1
  ) >"$state_dir/backend.log" 2>&1 &
  backend_pid=$!
  echo "$backend_pid" >"$(pid_file backend)"

  echo "กำลังรอ Backend โหลดโมเดลและตรวจฐานข้อมูล..."
  ready=false
  for _ in $(seq 1 360); do
    kill -0 "$backend_pid" 2>/dev/null || die "Backend หยุดทำงาน ดู $state_dir/backend.log"
    if curl -fsS -m 3 "http://127.0.0.1:${backend_port}/health/ready" >/dev/null 2>&1; then ready=true; break; fi
    sleep 0.5
  done
  [[ "$ready" == true ]] || die "Backend ไม่พร้อมภายใน 180 วินาที ดู $state_dir/backend.log"

  # ---------- 3b) serve the built Frontend and forward /api (only with --host-frontend) ----------
  if [[ "$host_frontend" == true ]]; then
    (
      cd "$project_root/frontend"
      exec env \
        LOCAL_HOSTING_WEB_PORT="$web_port" \
        LOCAL_HOSTING_BACKEND_PORT="$backend_port" \
        LOCAL_HOSTING_PUBLIC_HOST="$public_host" \
        ./node_modules/.bin/vite preview --config vite.hosting.config.mts --outDir "$web_dist"
    ) >"$state_dir/web.log" 2>&1 &
    web_pid=$!
    echo "$web_pid" >"$(pid_file web)"
    ready=false
    for _ in $(seq 1 60); do
      kill -0 "$web_pid" 2>/dev/null || die "เว็บเซิร์ฟเวอร์หยุดทำงาน ดู $state_dir/web.log"
      if curl -fsS -m 2 "http://127.0.0.1:${web_port}/" >/dev/null 2>&1; then ready=true; break; fi
      sleep 0.5
    done
    [[ "$ready" == true ]] || die "เว็บเซิร์ฟเวอร์ไม่พร้อมภายใน 30 วินาที ดู $state_dir/web.log"
  fi

  # ---------- 4) self-checks ----------
  local docs_code public_code web_code="" api_code=""
  docs_code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${backend_port}/docs" || true)"
  if [[ "$host_frontend" == true ]]; then
    web_code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' -H 'ngrok-skip-browser-warning: 1' "${public_url}/" || true)"
    api_code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' -H 'ngrok-skip-browser-warning: 1' "${public_url}/api/v1/auth/me" || true)"
    public_code="$web_code"
  else
    public_code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H 'ngrok-skip-browser-warning: 1' "${public_url}/health/live" || true)"
  fi

  echo
  echo "================ พร้อมทดสอบ ================"
  echo "Backend (ในเครื่อง) : http://127.0.0.1:${backend_port}   รุ่น: ${version}"
  if [[ "$host_frontend" == true ]]; then
    echo "URL เข้าใช้งานระบบ  : ${public_url}   (เว็บที่ / และ API ที่ /api ใน URL เดียวกัน)"
    echo "ตรวจผ่าน ngrok  /                 = ${web_code} (ต้องเป็น 200)"
    echo "ตรวจผ่าน ngrok  /api/v1/auth/me   = ${api_code} (ต้องเป็น 401 เพราะยังไม่ล็อกอิน)"
    echo "ตรวจ /docs ของ Backend ปิดอยู่     = ${docs_code} (ต้องเป็น 404)"
    echo
    echo "ทำครั้งเดียว: เพิ่ม ${public_url} ใน Supabase → Authentication → URL Configuration → Redirect URLs"
    echo "ครั้งแรกที่เปิด ngrok แผนฟรีจะแสดงหน้าเตือน กดปุ่ม Visit Site หนึ่งครั้ง  |  ล็อก: $state_dir"
  else
    echo "URL สาธารณะของ API  : ${public_url}"
    echo "ตรวจผ่าน ngrok /health/live = ${public_code} (ต้องเป็น 200)"
    echo "ตรวจ /docs ปิดอยู่   = ${docs_code} (ต้องเป็น 404)"
    echo
    echo "ตั้งใน Vercel (Preview ของ branch tuningModel):  VITE_API_ORIGIN=${public_url}"
    echo "อย่าลืมเพิ่ม URL ของ Preview ใน STAGING_FRONTEND_ORIGINS ($secrets_file)"
    echo "และใน Supabase Auth Redirect URLs  |  ล็อก: $state_dir"
  fi
  if [[ "$test_mode" == true ]]; then
    echo
    echo "!!! โหมดทดสอบเปิดอยู่: ไม่ต้องสแกน QR และไม่มีตัวจับเวลาของ QR/สิทธิ์/ปิดคาบ !!!"
    if [[ "$test_scope" == all ]]; then
      echo "    ขอบเขต: ทุกรายวิชาที่นักศึกษาเป็นสมาชิก รวมวิชาจริง และผลเช็คชื่อถูกบันทึกลงฐานข้อมูลจริง"
      echo "    ระหว่างเปิดสคริปต์นี้ ผู้ที่ใช้ Backend ทดสอบนี้เช็คชื่อวิชาจริงจากที่ไหนก็ได้โดยไม่ต้องสแกน QR"
      echo "    ปิดทันทีที่ทดลองเสร็จ (Ctrl+C) และอย่าแจกลิงก์ Preview ให้ผู้อื่น"
    else
      echo "    ขอบเขต: เฉพาะรายวิชาที่ระบุ ${#course_id_list[@]} รายวิชา"
    fi
    if [[ "$host_frontend" == true ]]; then
      echo "    เว็บที่ build ในครั้งนี้เป็นรุ่นทดสอบ (มีแถบแดง) และเก็บไว้ที่ $web_dist เท่านั้น"
    else
      echo "    ตั้ง VITE_TEST_MODE=1 ใน Vercel Preview เพื่อให้หน้านักศึกษาแสดงปุ่มเริ่มสแกนใบหน้า"
    fi
  fi
  echo "กด Ctrl+C เพื่อหยุดทั้งหมด"
  echo "============================================"
  if [[ "$host_frontend" == true ]]; then
    [[ "$web_code" == "200" && "$api_code" == "401" && "$docs_code" == "404" ]] \
      || echo "คำเตือน: ผลตรวจด้านบนไม่ตรงที่คาดไว้ ตรวจล็อกก่อนเปิดให้ผู้อื่นใช้" >&2
  else
    [[ "$public_code" == "200" && "$docs_code" == "404" ]] \
      || echo "คำเตือน: ผลตรวจด้านบนไม่ตรงที่คาดไว้ ตรวจล็อกก่อนเปิดให้ผู้อื่นใช้" >&2
  fi

  wait -n "$backend_pid" "$ocr_pid" "$ngrok_pid" ${web_pid:+"$web_pid"}
}

command_name="${1:-start}"
[[ $# -gt 0 ]] && shift
case "$command_name" in
  start) cmd_start "$@" ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  courses) cmd_courses ;;
  add-test-course) cmd_add_test_course "$@" ;;
  -h|--help|help) sed -n '2,27p' "${BASH_SOURCE[0]}" ;;
  *) die "คำสั่งไม่ถูกต้อง: ${command_name}. ใช้ start | status | stop | courses | add-test-course" ;;
esac
