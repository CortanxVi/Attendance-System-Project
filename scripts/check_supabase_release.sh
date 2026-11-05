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

echo "== Security advisors ==" # อนุญาตให้เฉพาะ pro plan งั้นไม่เอา
security_json="$(npx --no-install supabase db advisors --linked --type security --level warn --output json 2>/dev/null || true)"

node -e '
const raw = process.argv[1];
const start = raw.indexOf("[");
const end = raw.lastIndexOf("]");
if (start === -1 || end === -1) {
  console.error("อ่านผล security advisors ไม่ได้");
  process.exit(1);
}
const items = JSON.parse(raw.slice(start, end + 1));
const ignored = ["auth_leaked_password_protection"]; // ต้องใช้แผน Pro
const remaining = items.filter(i => !ignored.includes(i.name));
const skipped = items.filter(i => ignored.includes(i.name));
skipped.forEach(i => console.log("ข้าม (ignored): " + i.name));
if (remaining.length > 0) {
  console.error(JSON.stringify(remaining, null, 2));
  console.error("พบ security advisor ที่ต้องแก้ไข");
  process.exit(1);
}
console.log("Security advisors ผ่าน (ไม่นับรายการที่ข้าม)");
' "$security_json"

echo "== Performance advisors =="
npx --no-install supabase db advisors --linked --type performance --level warn --fail-on error

echo "Supabase release checks passed."
