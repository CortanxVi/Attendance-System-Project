#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "ไม่พบ Node.js: ติดตั้ง Node.js 22.12+ หรือ 24 ก่อน" >&2
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 || (major === 22 && minor >= 12) ? 0 : 1)'; then
  echo "ต้องใช้ Node.js 22.12+ หรือ 24 (ปัจจุบัน $(node -p 'process.versions.node')): รัน 'nvm install 22 && nvm use 22' ก่อน" >&2
  exit 1
fi

if [[ ! -x "$project_root/backend/.venv/bin/python" ]]; then
  echo "ไม่พบ backend/.venv กรุณาสร้าง virtual environment และติดตั้ง backend/requirement.txt" >&2
  exit 1
fi

if [[ ! -f "$project_root/backend/.env" || ! -f "$project_root/ocr-service/.env" || ! -f "$project_root/frontend/.env.local" ]]; then
  echo "กรุณาสร้าง backend/.env, ocr-service/.env และ frontend/.env.local ก่อนเปิดระบบ" >&2
  exit 1
fi

cleanup() {
  trap - EXIT INT TERM
  kill "${backend_pid:-}" "${ocr_pid:-}" "${frontend_pid:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(
  cd "$project_root/backend"
  exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
) &
backend_pid=$!

(
  cd "$project_root/ocr-service"
  # The OCR worker must never inherit database or browser credentials.
  exec env \
    -u SUPABASE_URL \
    -u SUPABASE_KEY \
    -u SUPABASE_SECRET_KEY \
    -u SUPABASE_SERVICE_ROLE_KEY \
    -u VITE_SUPABASE_URL \
    -u VITE_SUPABASE_ANON_KEY \
    -u VITE_SUPABASE_PUBLISHABLE_KEY \
    -u OCR_SERVICE_TOKEN \
    node --env-file="$project_root/ocr-service/.env" ocr-server.js
) &
ocr_pid=$!

(
  cd "$project_root/frontend"
  exec npm run dev -- --host 127.0.0.1
) &
frontend_pid=$!

echo "Backend : http://127.0.0.1:8000"
echo "OCR     : http://127.0.0.1:3001"
echo "Frontend: http://127.0.0.1:5173"
wait -n "$backend_pid" "$ocr_pid" "$frontend_pid"
