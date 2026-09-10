#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if ! npx --no-install supabase --version >/dev/null 2>&1; then
  echo "ไม่พบ Supabase CLI ใน dependencies ของโปรเจกต์" >&2
  exit 1
fi

echo "== Migration history =="
npx --no-install supabase migration list --linked
echo
echo "ตรวจให้แน่ใจว่าแต่ละแถวมีทั้ง Local และ Remote ก่อนดำเนินการต่อ"

echo "== Database lint =="
npx --no-install supabase db lint --linked --schema public --level warning --fail-on error

echo "== Security advisors =="
npx --no-install supabase db advisors --linked --type security --level warn --fail-on warn

echo "== Performance advisors =="
npx --no-install supabase db advisors --linked --type performance --level warn --fail-on error

echo "Supabase release checks passed."
