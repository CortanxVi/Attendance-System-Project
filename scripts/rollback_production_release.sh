#!/usr/bin/env bash
set -euo pipefail

release_id="${1:-}"
if ((EUID != 0)); then
  echo "Run this rollback command with sudo on the deployment host." >&2
  exit 1
fi
if [[ ! "$release_id" =~ ^[A-Za-z0-9._-]{1,80}$ || "$release_id" == "." || "$release_id" == ".." ]]; then
  echo "Usage: sudo $0 RELEASE_ID" >&2
  exit 2
fi

target="/opt/km-attendance/releases/$release_id"
if [[ ! -d "$target" || ! -f "$target/SHA256SUMS" ]]; then
  echo "The requested release does not exist or has no checksum manifest." >&2
  exit 1
fi
if find "$target" -type l -print -quit | grep -q .; then
  echo "Rollback target contains an unexpected symbolic link." >&2
  exit 1
fi
(
  cd "$target"
  sha256sum --check --quiet SHA256SUMS
)

previous="$(readlink -f /opt/km-attendance/current 2>/dev/null || true)"
ln -sfn "$target" /opt/km-attendance/current
systemctl restart km-attendance-ocr.service km-attendance-backend.service

ready=false
for _attempt in $(seq 1 120); do
  if curl --silent --fail --max-time 3 -H 'Host: localhost' http://127.0.0.1:8000/health/ready >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "Rollback target failed readiness." >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" /opt/km-attendance/current
    systemctl restart km-attendance-ocr.service km-attendance-backend.service || true
  fi
  exit 1
fi

systemctl reload nginx
echo "Rollback completed; active release is $release_id."
