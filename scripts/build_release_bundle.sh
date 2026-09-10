#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir=""
frontend_env=""
allow_dirty=false

usage() {
  echo "Usage: $0 --output /absolute/path --frontend-env /absolute/path [--allow-dirty]" >&2
}

while (($#)); do
  case "$1" in
    --output) output_dir="${2:-}"; shift 2 ;;
    --frontend-env) frontend_env="${2:-}"; shift 2 ;;
    --allow-dirty) allow_dirty=true; shift ;;
    *) usage; exit 2 ;;
  esac
done

if [[ -z "$output_dir" || -z "$frontend_env" ]]; then
  usage
  exit 2
fi
if [[ "$output_dir" != /* || "$frontend_env" != /* ]]; then
  echo "Output and frontend environment paths must be absolute." >&2
  exit 2
fi
case "$output_dir/" in
  "$project_root/"*)
    echo "Place release output outside the source repository." >&2
    exit 2
    ;;
esac
if [[ ! -f "$frontend_env" ]]; then
  echo "Frontend production environment file does not exist." >&2
  exit 1
fi
if [[ -e "$output_dir" ]]; then
  echo "Output path already exists; choose a new release directory." >&2
  exit 1
fi
if rg -n '(^|_)(SERVICE_ROLE|SECRET_KEY|SUPABASE_KEY|OCR_SERVICE_TOKEN|LIVENESS_SIGNING_KEY|PIN_PEPPER)=' "$frontend_env" >/dev/null; then
  echo "Frontend environment contains a server-only credential name." >&2
  exit 1
fi
if [[ "$allow_dirty" != "true" && -n "$(git -C "$project_root" status --porcelain)" ]]; then
  echo "Production release bundles require a clean Git worktree. Use --allow-dirty only for staging QA." >&2
  exit 1
fi
for command_name in rsync rg sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

"$project_root/scripts/verify_release.sh"

build_root="$(mktemp -d)"
cleanup() {
  rm -rf -- "$build_root"
}
trap cleanup EXIT INT TERM

source_copy="$build_root/source"
mkdir -p "$source_copy"
rsync -a \
  --exclude='.git/' \
  --exclude='.certs/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.venv/' \
  --exclude='.venv-windows/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='__pycache__/' \
  "$project_root/" "$source_copy/"

install -m 0644 "$frontend_env" "$source_copy/frontend/.env.production"
(
  cd "$source_copy/frontend"
  npm ci
  npm run build
)

mkdir -p "$output_dir/backend/core" "$output_dir/backend/models" "$output_dir/backend/routers" \
  "$output_dir/backend/services" "$output_dir/frontend" "$output_dir/ocr-service" \
  "$output_dir/scripts" "$output_dir/deployment" "$output_dir/docs"
install -m 0644 "$source_copy/backend/main.py" "$output_dir/backend/main.py"
install -m 0644 "$source_copy/backend/requirement.txt" "$output_dir/backend/requirement.txt"
rsync -a "$source_copy/backend/core/" "$output_dir/backend/core/"
rsync -a "$source_copy/backend/models/" "$output_dir/backend/models/"
rsync -a "$source_copy/backend/routers/" "$output_dir/backend/routers/"
rsync -a "$source_copy/backend/services/" "$output_dir/backend/services/"
rsync -a "$source_copy/frontend/dist/" "$output_dir/frontend/dist/"
install -m 0644 "$source_copy/ocr-service/package.json" "$output_dir/ocr-service/package.json"
install -m 0644 "$source_copy/ocr-service/package-lock.json" "$output_dir/ocr-service/package-lock.json"
install -m 0644 "$source_copy/ocr-service/ocr-server.js" "$output_dir/ocr-service/ocr-server.js"
install -m 0644 "$source_copy/ocr-service/security.mjs" "$output_dir/ocr-service/security.mjs"
rsync -a "$source_copy/deployment/" "$output_dir/deployment/"
rsync -a "$source_copy/docs/" "$output_dir/docs/" 2>/dev/null || true
install -m 0755 "$source_copy/scripts/verify_face_models.sh" "$output_dir/scripts/verify_face_models.sh"
install -m 0755 "$source_copy/scripts/production_preflight.py" "$output_dir/scripts/production_preflight.py"
install -m 0755 "$source_copy/scripts/healthcheck_production.sh" "$output_dir/scripts/healthcheck_production.sh"
install -m 0755 "$source_copy/scripts/install_production_release.sh" "$output_dir/scripts/install_production_release.sh"
install -m 0755 "$source_copy/scripts/rollback_production_release.sh" "$output_dir/scripts/rollback_production_release.sh"
install -m 0644 "$source_copy/THIRD_PARTY_NOTICES.md" "$output_dir/THIRD_PARTY_NOTICES.md"

commit_id="$(git -C "$project_root" rev-parse --verify HEAD)"
worktree_state="clean"
if [[ -n "$(git -C "$project_root" status --porcelain)" ]]; then
  worktree_state="dirty-staging-build"
fi
{
  printf 'built_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source_commit=%s\n' "$commit_id"
  printf 'source_state=%s\n' "$worktree_state"
  printf 'node_version=%s\n' "$(node --version)"
  printf 'python_version=%s\n' "$(python3 --version 2>&1)"
} >"$output_dir/RELEASE-METADATA.txt"

(
  cd "$output_dir"
  if find . -type l -print -quit | grep -q .; then
    echo "Release bundle unexpectedly contains a symbolic link." >&2
    exit 1
  fi
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS
  sha256sum --check --quiet SHA256SUMS
)

echo "Release bundle created and verified at: $output_dir"
if [[ "$worktree_state" != "clean" ]]; then
  echo "This bundle is marked for staging only because the source worktree was dirty."
fi
