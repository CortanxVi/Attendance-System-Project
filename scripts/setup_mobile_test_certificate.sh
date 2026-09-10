#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cert_dir="${MOBILE_TEST_CERT_DIR:-$project_root/.certs/mobile-test}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "ไม่พบ openssl กรุณาติดตั้งแพ็กเกจ openssl ก่อน" >&2
  exit 1
fi

detect_host() {
  if [[ -n "${MOBILE_TEST_HOST:-}" ]]; then
    printf '%s' "$MOBILE_TEST_HOST"
    return
  fi
  local candidate
  candidate="$(hostname -I 2>/dev/null | tr ' ' '\n' | awk '/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/ { print; exit }')"
  if [[ -z "$candidate" ]]; then
    echo "หา private LAN IPv4 ไม่พบ กำหนด MOBILE_TEST_HOST ก่อนรัน" >&2
    exit 1
  fi
  printf '%s' "$candidate"
}

mobile_host="$(detect_host)"
if [[ ! "$mobile_host" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "MOBILE_TEST_HOST ต้องเป็น hostname หรือ IPv4 ที่ไม่มี path/port" >&2
  exit 1
fi

mkdir -p "$cert_dir"
chmod 700 "$cert_dir"

ca_key="$cert_dir/mobile-test-ca.key"
ca_cert="$cert_dir/mobile-test-ca.crt"
server_key="$cert_dir/mobile-test-server.key"
server_cert="$cert_dir/mobile-test-server.crt"
server_csr="$cert_dir/mobile-test-server.csr"
openssl_config="$cert_dir/mobile-test-openssl.cnf"

if [[ ! -f "$ca_key" || ! -f "$ca_cert" ]]; then
  openssl genrsa -out "$ca_key" 3072 >/dev/null 2>&1
  chmod 600 "$ca_key"
  openssl req -x509 -new -sha256 -days 825 \
    -key "$ca_key" \
    -out "$ca_cert" \
    -subj "/CN=KMUTNB Attendance Mobile Test CA/O=Local Development Only" >/dev/null 2>&1
fi

if [[ "$mobile_host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  subject_alt_name="IP.1 = $mobile_host"
else
  subject_alt_name="DNS.1 = $mobile_host"
fi

cat >"$openssl_config" <<EOF
[req]
distinguished_name = subject
prompt = no
req_extensions = extensions

[subject]
CN = $mobile_host
O = KMUTNB Attendance Local Development

[extensions]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
$subject_alt_name
IP.2 = 127.0.0.1
DNS.2 = localhost
EOF

openssl genrsa -out "$server_key" 2048 >/dev/null 2>&1
chmod 600 "$server_key"
openssl req -new -sha256 -key "$server_key" -out "$server_csr" -config "$openssl_config" >/dev/null 2>&1
openssl x509 -req -sha256 -days 90 \
  -in "$server_csr" \
  -CA "$ca_cert" \
  -CAkey "$ca_key" \
  -CAcreateserial \
  -out "$server_cert" \
  -extensions extensions \
  -extfile "$openssl_config" >/dev/null 2>&1
chmod 644 "$ca_cert" "$server_cert"
printf '%s\n' "$mobile_host" >"$cert_dir/host.txt"

echo "สร้างใบรับรอง Development HTTPS สำหรับ $mobile_host แล้ว"
echo "ติดตั้งเฉพาะไฟล์ CA นี้บนโทรศัพท์: $ca_cert"
echo "ห้ามคัดลอกไฟล์ .key ออกจากเครื่องพัฒนา"
