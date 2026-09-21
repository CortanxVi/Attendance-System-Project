#!/usr/bin/env bash
set -uo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$project_root/deployment/docker/compose.production.yml"
compose_env="${ATTENDANCE_COMPOSE_ENV:-/etc/km-attendance/compose.env}"
watch_seconds=0

usage() {
  cat <<'EOF'
Usage: scripts/monitor_production_health.sh [--watch SECONDS]

Run one health inspection, or repeat it at the selected interval. The command
checks Docker service state, local Backend liveness/readiness, public API TLS,
and the first configured Production Frontend origin.
EOF
}

while (($#)); do
  case "$1" in
    --watch)
      watch_seconds="${2:-}"
      shift 2
      if [[ ! "$watch_seconds" =~ ^[1-9][0-9]*$ || "$watch_seconds" -gt 3600 ]]; then
        echo "--watch must be between 1 and 3600 seconds." >&2
        exit 2
      fi
      ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

if [[ ! -r "$compose_env" ]]; then
  echo "Compose environment file is missing or unreadable: $compose_env" >&2
  exit 1
fi
for command_name in docker curl awk date; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker Engine and Docker Compose v2 must be available to the current user." >&2
  exit 1
fi

release_id="${RELEASE_ID_OVERRIDE:-$(git -C "$project_root" rev-parse --short=12 HEAD 2>/dev/null || true)}"
if [[ ! "$release_id" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
  release_id="healthcheck"
fi
export RELEASE_ID="$release_id"

api_host="$(awk -F= '$1 == "API_HOST" { sub(/^[^=]*=/, ""); print; exit }' "$compose_env")"
frontend_origin="$(awk -F= '$1 == "FRONTEND_ORIGINS" { sub(/^[^=]*=/, ""); split($0, origins, ","); print origins[1]; exit }' "$compose_env")"
compose=(docker compose --env-file "$compose_env" -f "$compose_file")

check_url() {
  local label="$1"
  local url="$2"
  shift 2
  if curl --silent --show-error --fail --max-time 10 "$@" "$url" >/dev/null 2>&1; then
    printf 'OK   %-24s %s\n' "$label" "$url"
    return 0
  fi
  printf 'FAIL %-24s %s\n' "$label" "$url" >&2
  return 1
}

check_container() {
  local service="$1"
  local container_id
  local state
  container_id="$("${compose[@]}" ps -q "$service" 2>/dev/null)"
  if [[ -z "$container_id" ]]; then
    printf 'FAIL %-24s container not found\n' "Docker $service" >&2
    return 1
  fi
  state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null)"
  if [[ "$state" == "healthy" || "$state" == "running" ]]; then
    printf 'OK   %-24s %s\n' "Docker $service" "$state"
    return 0
  fi
  printf 'FAIL %-24s %s\n' "Docker $service" "${state:-unknown}" >&2
  return 1
}

run_checks() {
  local failures=0
  printf '\n[%s] Production health inspection\n' "$(date --iso-8601=seconds)"

  check_container ocr || failures=$((failures + 1))
  check_container backend || failures=$((failures + 1))
  check_url "Backend local live" "http://127.0.0.1:8000/health/live" -H 'Host: localhost' || failures=$((failures + 1))
  check_url "Backend local ready" "http://127.0.0.1:8000/health/ready" -H 'Host: localhost' || failures=$((failures + 1))

  if [[ "$api_host" =~ ^[A-Za-z0-9.-]+$ && "$api_host" == *.* ]]; then
    check_url "Backend public TLS" "https://$api_host/health/live" || failures=$((failures + 1))
  else
    echo "FAIL Public API host       API_HOST is invalid" >&2
    failures=$((failures + 1))
  fi

  if [[ "$frontend_origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
    check_url "Vercel Frontend" "$frontend_origin/" || failures=$((failures + 1))
  else
    echo "FAIL Vercel Frontend       FRONTEND_ORIGINS is invalid" >&2
    failures=$((failures + 1))
  fi

  if ((failures)); then
    echo "Health inspection failed: $failures check(s)." >&2
    return 1
  fi
  echo "All Production health checks passed."
}

if ((watch_seconds > 0)); then
  overall_status=0
  while true; do
    run_checks || overall_status=1
    sleep "$watch_seconds"
  done
else
  run_checks
fi

