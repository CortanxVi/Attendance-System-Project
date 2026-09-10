#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cert_dir="${MOBILE_TEST_CERT_DIR:-$project_root/.certs/mobile-test}"

if [[ ! -f "$cert_dir/host.txt" || ! -f "$cert_dir/mobile-test-ca.crt" ]]; then
  echo "ยังไม่มี Development certificate กรุณารัน ./start_mobile_test.sh ก่อน" >&2
  exit 1
fi

mobile_host="$(<"$cert_dir/host.txt")"
frontend_port="$(<"$cert_dir/frontend-port.txt")"
base_url="https://$mobile_host:$frontend_port"
curl_options=(--silent --show-error --fail --max-time 10 --cacert "$cert_dir/mobile-test-ca.crt")

curl "${curl_options[@]}" "$base_url/" >/dev/null
curl "${curl_options[@]}" "$base_url/models/face_landmarker.task" --range 0-1023 >/dev/null
curl "${curl_options[@]}" "$base_url/health/live" >/dev/null
curl "${curl_options[@]}" "$base_url/health/ready" >/dev/null

echo "Mobile HTTPS, local model, backend, database and OCR readiness checks passed."
