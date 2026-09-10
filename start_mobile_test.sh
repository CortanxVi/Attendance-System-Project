#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cert_dir="${MOBILE_TEST_CERT_DIR:-$project_root/.certs/mobile-test}"
ocr_port="${MOBILE_OCR_PORT:-3002}"
backend_port="${MOBILE_BACKEND_PORT:-8001}"
frontend_port="${MOBILE_FRONTEND_PORT:-5174}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ไม่พบ Node.js/npm กรุณาติดตั้ง Node.js 22.12+ หรือ 24" >&2
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 || (major === 22 && minor >= 12) ? 0 : 1)'; then
  echo "ต้องใช้ Node.js 22.12+ หรือ 24 ปัจจุบันคือ $(node --version)" >&2
  echo "ถ้าใช้ nvm ให้รัน: nvm use 22" >&2
  exit 1
fi
for port in "$ocr_port" "$backend_port" "$frontend_port"; do
  if ! [[ "$port" =~ ^[0-9]+$ ]] || ((port < 1024 || port > 65535)); then
    echo "พอร์ตทดสอบต้องเป็นตัวเลขระหว่าง 1024-65535" >&2
    exit 1
  fi
done

port_in_use() {
  (exec 9<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}
for port in "$ocr_port" "$backend_port" "$frontend_port"; do
  if port_in_use "$port"; then
    echo "พอร์ต $port ถูกใช้งานอยู่ กรุณาปิดระบบเดิมหรือกำหนด MOBILE_OCR_PORT, MOBILE_BACKEND_PORT และ MOBILE_FRONTEND_PORT ใหม่" >&2
    exit 1
  fi
done

"$project_root/scripts/setup_mobile_test_certificate.sh"
mobile_host="$(<"$cert_dir/host.txt")"

if [[ ! -x "$project_root/backend/.venv/bin/python" ]]; then
  echo "ไม่พบ backend/.venv กรุณาติดตั้ง backend dependencies ก่อน" >&2
  exit 1
fi
for required_file in backend/.env ocr-service/.env frontend/.env.local; do
  if [[ ! -f "$project_root/$required_file" ]]; then
    echo "ไม่พบ $required_file" >&2
    exit 1
  fi
done

cleanup() {
  trap - EXIT INT TERM
  kill "${backend_pid:-}" "${ocr_pid:-}" "${frontend_pid:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(
  cd "$project_root/ocr-service"
  exec env \
    -u SUPABASE_URL -u SUPABASE_KEY -u SUPABASE_SECRET_KEY \
    -u SUPABASE_SERVICE_ROLE_KEY -u VITE_SUPABASE_URL \
    -u VITE_SUPABASE_ANON_KEY -u VITE_SUPABASE_PUBLISHABLE_KEY \
    -u OCR_SERVICE_TOKEN \
    PORT="$ocr_port" node --env-file="$project_root/ocr-service/.env" ocr-server.js
) &
ocr_pid=$!

echo "กำลังรอ Light OCR โหลดโมเดล..."
ocr_ready=false
for _attempt in $(seq 1 120); do
  if ! kill -0 "$ocr_pid" 2>/dev/null; then
    echo "Light OCR หยุดทำงานระหว่างเริ่มระบบ" >&2
    exit 1
  fi
  if node -e "fetch('http://127.0.0.1:$ocr_port/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ocr_ready=true
    break
  fi
  sleep 0.5
done
if [[ "$ocr_ready" != "true" ]]; then
  echo "Light OCR ไม่พร้อมภายใน 60 วินาที" >&2
  exit 1
fi

(
  cd "$project_root/backend"
  exec env OCR_SERVICE_URL="http://127.0.0.1:$ocr_port" \
    .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port "$backend_port"
) &
backend_pid=$!

backend_ready=false
for _attempt in $(seq 1 60); do
  if curl --silent --fail "http://127.0.0.1:$backend_port/health/live" >/dev/null 2>&1; then
    backend_ready=true
    break
  fi
  sleep 0.5
done
if [[ "$backend_ready" != "true" ]]; then
  echo "Backend ไม่พร้อมภายใน 30 วินาที" >&2
  exit 1
fi

(
  cd "$project_root/frontend"
  exec env \
    DEV_MOBILE_HTTPS=1 \
    DEV_HTTPS_CERT="$cert_dir/mobile-test-server.crt" \
    DEV_HTTPS_KEY="$cert_dir/mobile-test-server.key" \
    DEV_BACKEND_PORT="$backend_port" \
    npm run dev -- --port "$frontend_port"
) &
frontend_pid=$!

printf '%s\n' "$frontend_port" >"$cert_dir/frontend-port.txt"

echo
echo "Mobile test URL : https://$mobile_host:$frontend_port"
echo "Backend/OCR     : เปิดเฉพาะ loopback และเข้าผ่าน Vite proxy"
echo "CA สำหรับมือถือ : $cert_dir/mobile-test-ca.crt"
echo "เพิ่ม https://$mobile_host:$frontend_port ใน Supabase Auth Redirect URLs ชั่วคราว"
echo "กด Ctrl+C เพื่อหยุดทุก service"
wait -n "$backend_pid" "$ocr_pid" "$frontend_pid"
