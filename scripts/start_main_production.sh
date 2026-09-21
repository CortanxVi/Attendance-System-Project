#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$project_root/deployment/docker/compose.production.yml"
compose_env="${ATTENDANCE_COMPOSE_ENV:-/etc/km-attendance/compose.env}"
skip_build=false
skip_public_check=false

usage() {
  cat <<'EOF'
Usage: scripts/start_main_production.sh [--no-build] [--skip-public-check]

Build and start the Production Backend/OCR Docker stack from branch main,
wait for Backend readiness, validate/reload host Nginx, and check public liveness.

Environment:
  ATTENDANCE_COMPOSE_ENV  Compose environment file (default: /etc/km-attendance/compose.env)
  RELEASE_ID_OVERRIDE     Optional immutable image tag; defaults to the current Git SHA
EOF
}

while (($#)); do
  case "$1" in
    --no-build) skip_build=true; shift ;;
    --skip-public-check) skip_public_check=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

for command_name in git docker curl awk sudo; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required (the 'docker compose' command)." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "The current user cannot access Docker. Start Docker and add this user to the docker group." >&2
  exit 1
fi
if [[ ! -r "$compose_env" ]]; then
  echo "Compose environment file is missing or unreadable: $compose_env" >&2
  exit 1
fi
for config_file in /etc/km-attendance/backend.env /etc/km-attendance/ocr.env; do
  if [[ ! -r "$config_file" ]]; then
    echo "Production configuration is missing or unreadable: $config_file" >&2
    exit 1
  fi
done

branch_name="$(git -C "$project_root" branch --show-current)"
if [[ "$branch_name" != "main" ]]; then
  echo "Production startup is allowed only from branch main; current branch: ${branch_name:-detached HEAD}" >&2
  exit 1
fi
if [[ -n "$(git -C "$project_root" status --porcelain --untracked-files=normal)" ]]; then
  echo "Production startup requires a clean main worktree. Commit or safely move pending work first." >&2
  exit 1
fi

release_id="${RELEASE_ID_OVERRIDE:-$(git -C "$project_root" rev-parse --short=12 HEAD)}"
if [[ ! "$release_id" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
  echo "Invalid release identifier." >&2
  exit 1
fi
export RELEASE_ID="$release_id"

model_root="$(awk -F= '$1 == "INSIGHTFACE_MODEL_ROOT_HOST" { sub(/^[^=]*=/, ""); print; exit }' "$compose_env")"
if [[ "$model_root" != /* ]]; then
  echo "INSIGHTFACE_MODEL_ROOT_HOST must be an absolute path in $compose_env" >&2
  exit 1
fi
INSIGHTFACE_MODEL_ROOT="$model_root" "$project_root/scripts/verify_face_models.sh"

compose=(docker compose --env-file "$compose_env" -f "$compose_file")
"${compose[@]}" config --quiet

if [[ "$skip_build" != "true" ]]; then
  "${compose[@]}" build --pull
fi
"${compose[@]}" up -d --remove-orphans

ready=false
for _attempt in $(seq 1 180); do
  if curl --silent --show-error --fail --max-time 4 \
    -H 'Host: localhost' \
    http://127.0.0.1:8000/health/ready >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  "${compose[@]}" ps >&2
  echo "Backend did not become ready within 180 seconds. Inspect Docker logs before retrying." >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "Host Nginx is required but was not found." >&2
  exit 1
fi
sudo nginx -t
sudo systemctl enable --now nginx >/dev/null
sudo systemctl reload nginx

api_host="$(awk -F= '$1 == "API_HOST" { sub(/^[^=]*=/, ""); print; exit }' "$compose_env")"
if [[ ! "$api_host" =~ ^[A-Za-z0-9.-]+$ || "$api_host" != *.* ]]; then
  echo "API_HOST is missing or invalid in $compose_env" >&2
  exit 1
fi

if [[ "$skip_public_check" != "true" ]]; then
  curl --silent --show-error --fail --max-time 15 \
    "https://$api_host/health/live" >/dev/null
fi

"${compose[@]}" ps
echo "Production release $release_id is ready."
echo "Internal readiness: http://127.0.0.1:8000/health/ready"
echo "Public liveness:    https://$api_host/health/live"
