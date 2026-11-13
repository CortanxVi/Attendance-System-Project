#!/usr/bin/env bash
# Run the Backend and Light OCR of the current branch directly on this machine
# (no Docker) and expose ONLY the Backend through ngrok, so a Frontend Preview
# hosted elsewhere (for example Vercel) can be tested from the Internet.
#
#   scripts/start_backend_ngrok.sh [start]   run in the foreground (Ctrl+C stops all)
#   scripts/start_backend_ngrok.sh start --test-mode
#                                            also skip the QR step and its timers for the
#                                            test courses listed in STAGING_TEST_COURSE_IDS
#   scripts/start_backend_ngrok.sh status    show what is running
#   scripts/start_backend_ngrok.sh stop      stop a run started from another terminal
#
# This is a TEST helper. It uses backend/.env for Supabase credentials, so it
# talks to whichever Supabase project that file points to. Use test accounts only.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="${STAGING_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/km-attendance-staging}"
secrets_file="${STAGING_ENV_FILE:-$HOME/.config/km-attendance/staging.env}"
backend_port="${STAGING_BACKEND_PORT:-8000}"
ocr_port="${STAGING_OCR_PORT:-3001}"
# Must equal TEST_MODE_ACK_PHRASE in backend/core/test_mode.py (a unit test checks this).
test_mode_ack="REMOVE-QR-AND-TIMERS-FOR-LISTED-TEST-COURSES-ONLY"

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
  for name in ngrok ocr backend; do
    if [[ -f "$(pid_file "$name")" ]] && kill -0 "$(<"$(pid_file "$name")")" 2>/dev/null; then
      echo "$name: กำลังทำงาน (pid $(<"$(pid_file "$name")"))"
    else
      echo "$name: ไม่ได้ทำงาน"
    fi
  done
  if curl -fsS -m 3 "http://127.0.0.1:${backend_port}/health/ready" 2>/dev/null; then echo; else echo "Backend /health/ready: ไม่ตอบ"; fi
  if url="$(ngrok_public_url)"; then echo "ngrok URL: $url"; else echo "ngrok URL: ไม่พบ"; fi
}

cmd_stop() {
  safe_kill backend "uvicorn"
  safe_kill ocr "ocr-server.js"
  safe_kill ngrok "ngrok"
  echo "ส่งสัญญาณหยุด backend / ocr / ngrok ที่ถูกเปิดโดยสคริปต์นี้แล้ว"
}

cmd_start() {
  local test_mode=false arg
  for arg in "$@"; do
    case "$arg" in
      --test-mode) test_mode=true ;;
      *) die "ตัวเลือกไม่ถูกต้อง: $arg (ใช้ได้เฉพาะ --test-mode)" ;;
    esac
  done

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

  for port in "$backend_port" "$ocr_port"; do
    [[ "$port" =~ ^[0-9]+$ ]] && ((port >= 1024 && port <= 65535)) || die "พอร์ตต้องเป็นตัวเลข 1024-65535"
    if port_in_use "$port"; then
      die "พอร์ต $port ถูกใช้งานอยู่ (ถ้าเป็น Docker staging ให้หยุดก่อน หรือกำหนด STAGING_BACKEND_PORT / STAGING_OCR_PORT)"
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
  [[ -n "$origins" ]] || die "STAGING_FRONTEND_ORIGINS ว่าง ใส่ URL Preview แบบ https://... ใน $secrets_file"
  local origin
  IFS=',' read -r -a origin_list <<<"$origins"
  for origin in "${origin_list[@]}"; do
    [[ "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] \
      || die "origin ไม่ถูกต้อง (ต้องเป็น https://host ไม่มี / ท้าย ไม่มี path): $origin"
  done
  ocr_token_backend="$(get_var "$project_root/backend/.env" OCR_SERVICE_TOKEN)"
  ocr_token_ocr="$(get_var "$project_root/ocr-service/.env" OCR_SERVICE_TOKEN)"
  ((${#ocr_token_backend} >= 32)) || die "OCR_SERVICE_TOKEN ใน backend/.env ต้องยาวอย่างน้อย 32 ตัวอักษร"
  [[ "$ocr_token_backend" == "$ocr_token_ocr" ]] || die "OCR_SERVICE_TOKEN ใน backend/.env และ ocr-service/.env ไม่ตรงกัน"

  # Test mode removes the QR step and timers, so it is limited to listed courses.
  local test_course_ids="" course_id
  local -a test_env=()
  if [[ "$test_mode" == true ]]; then
    test_course_ids="$(get_var "$secrets_file" STAGING_TEST_COURSE_IDS)"
    test_course_ids="${STAGING_TEST_COURSE_IDS:-$test_course_ids}"
    [[ -n "$test_course_ids" ]] || die "--test-mode ต้องมี STAGING_TEST_COURSE_IDS (UUID ของวิชาทดสอบ คั่นด้วย ,) ใน $secrets_file"
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
  fi

  # ---------- cleanup handler ----------
  cleanup() {
    trap - EXIT INT TERM
    kill "${backend_pid:-}" "${ocr_pid:-}" "${ngrok_pid:-}" 2>/dev/null || true
    wait 2>/dev/null || true
    rm -f "$(pid_file backend)" "$(pid_file ocr)" "$(pid_file ngrok)"
  }
  trap cleanup EXIT INT TERM

  # ---------- 1) ngrok first, so the public host is known before Backend starts ----------
  ngrok http "127.0.0.1:${backend_port}" --log=stdout --log-format=json >"$state_dir/ngrok.log" 2>&1 &
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

  # ---------- 4) self-checks ----------
  local docs_code public_code
  docs_code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${backend_port}/docs" || true)"
  public_code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H 'ngrok-skip-browser-warning: 1' "${public_url}/health/live" || true)"

  echo
  echo "================ พร้อมทดสอบ ================"
  echo "Backend (ในเครื่อง) : http://127.0.0.1:${backend_port}   รุ่น: ${version}"
  echo "URL สาธารณะของ API  : ${public_url}"
  echo "ตรวจผ่าน ngrok /health/live = ${public_code} (ต้องเป็น 200)"
  echo "ตรวจ /docs ปิดอยู่   = ${docs_code} (ต้องเป็น 404)"
  echo
  echo "ตั้งใน Vercel (Preview ของ branch tuningModel):  VITE_API_ORIGIN=${public_url}"
  echo "อย่าลืมเพิ่ม URL ของ Preview ใน STAGING_FRONTEND_ORIGINS ($secrets_file)"
  echo "และใน Supabase Auth Redirect URLs  |  ล็อก: $state_dir"
  if [[ "$test_mode" == true ]]; then
    echo
    echo "!!! โหมดทดสอบเปิดอยู่: ไม่ต้องสแกน QR และไม่มีตัวจับเวลาของ QR/สิทธิ์/ปิดคาบ !!!"
    echo "    ใช้ได้เฉพาะรายวิชาทดสอบที่ระบุ ${#course_id_list[@]} รายวิชา ห้ามใช้กับวิชาจริง"
    echo "    ตั้ง VITE_TEST_MODE=1 ใน Vercel Preview เพื่อให้หน้านักศึกษาแสดงปุ่มเริ่มสแกนใบหน้า"
  fi
  echo "กด Ctrl+C เพื่อหยุดทั้งหมด"
  echo "============================================"
  [[ "$public_code" == "200" && "$docs_code" == "404" ]] \
    || echo "คำเตือน: ผลตรวจด้านบนไม่ตรงที่คาดไว้ ตรวจล็อกก่อนเปิดให้ผู้อื่นใช้" >&2

  wait -n "$backend_pid" "$ocr_pid" "$ngrok_pid"
}

command_name="${1:-start}"
[[ $# -gt 0 ]] && shift
case "$command_name" in
  start) cmd_start "$@" ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  -h|--help|help) sed -n '2,13p' "${BASH_SOURCE[0]}" ;;
  *) die "คำสั่งไม่ถูกต้อง: ${command_name}. ใช้ start | status | stop" ;;
esac
