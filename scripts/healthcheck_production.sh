#!/usr/bin/env bash
set -euo pipefail

curl --silent --show-error --fail --max-time 8 \
  -H 'Host: localhost' \
  http://127.0.0.1:8000/health/ready >/dev/null

echo "KMUTNB attendance readiness check passed."
