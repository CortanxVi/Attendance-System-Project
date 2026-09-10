#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
model_root="${INSIGHTFACE_MODEL_ROOT:-$HOME/.insightface}"
model_dir="$model_root/models/buffalo_s"
manifest="$project_root/backend/models/insightface-buffalo-s.sha256"

if [[ ! -d "$model_dir" ]]; then
  echo "ไม่พบ InsightFace buffalo_s ที่ $model_dir" >&2
  echo "เตรียมโมเดลไว้ก่อนเปิดระบบ ห้ามพึ่งการดาวน์โหลดระหว่าง Production startup" >&2
  exit 1
fi

(
  cd "$model_dir"
  sha256sum --check "$manifest"
)
