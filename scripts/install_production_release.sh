#!/usr/bin/env bash
set -euo pipefail

bundle_dir=""
release_id=""
domain=""
project_ref=""
database_ready=false
model_license_ready=false
api_only=false
frontend_origin=""

usage() {
  echo "Usage: sudo $0 --bundle /absolute/path --release-id VERSION --domain HOST --project-ref REF --confirm-database-ready --confirm-model-license [--api-only --frontend-origin https://app.example.org]" >&2
}

while (($#)); do
  case "$1" in
    --bundle) bundle_dir="${2:-}"; shift 2 ;;
    --release-id) release_id="${2:-}"; shift 2 ;;
    --domain) domain="${2:-}"; shift 2 ;;
    --project-ref) project_ref="${2:-}"; shift 2 ;;
    --confirm-database-ready) database_ready=true; shift ;;
    --confirm-model-license) model_license_ready=true; shift ;;
    --api-only) api_only=true; shift ;;
    --frontend-origin) frontend_origin="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

if ((EUID != 0)); then
  echo "Run this installer with sudo on the deployment host." >&2
  exit 1
fi
if [[ "$bundle_dir" != /* || ! -d "$bundle_dir" || ! -f "$bundle_dir/SHA256SUMS" ]]; then
  echo "A valid absolute release bundle path is required." >&2
  exit 2
fi
if [[ ! "$release_id" =~ ^[A-Za-z0-9._-]{1,80}$ || "$release_id" == "." || "$release_id" == ".." ]]; then
  echo "Invalid release ID." >&2
  exit 2
fi
if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+$ || "$domain" != *.* || "$domain" == .* || "$domain" == *. || "$domain" == *..* || "$domain" == -* || "$domain" == *- ]]; then
  echo "Invalid deployment hostname." >&2
  exit 2
fi
if find "$bundle_dir" -type l -print -quit | grep -q .; then
  echo "Release bundle contains a symbolic link and will not be installed." >&2
  exit 1
fi
source_state="$(awk -F= '$1 == "source_state" { print $2 }' "$bundle_dir/RELEASE-METADATA.txt" 2>/dev/null || true)"
if [[ "$source_state" != "clean" ]]; then
  echo "Production installation requires a bundle built from a clean Git worktree." >&2
  exit 1
fi
if [[ ! "$project_ref" =~ ^[a-z0-9]{8,64}$ ]]; then
  echo "Invalid Supabase project reference." >&2
  exit 2
fi
if [[ "$database_ready" != "true" || "$model_license_ready" != "true" ]]; then
  echo "Database migration/advisor approval and pretrained-model license approval are required." >&2
  exit 1
fi
if [[ "$api_only" == "true" ]]; then
  if [[ ! "$frontend_origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
    echo "API-only deployment requires an exact HTTPS frontend origin without a path." >&2
    exit 2
  fi
elif [[ -n "$frontend_origin" ]]; then
  echo "--frontend-origin is only valid together with --api-only." >&2
  exit 2
fi

for command_name in python3 node npm nginx systemctl curl sha256sum runuser; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done
if ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major===24||(major===22&&minor>=12)?0:1)'; then
  echo "System Node.js must be 22.12+ or 24; current version is $(node --version)." >&2
  exit 1
fi

for env_file in /etc/km-attendance/backend.env /etc/km-attendance/ocr.env /etc/km-attendance/frontend.env.production; do
  if [[ ! -f "$env_file" ]]; then
    echo "Missing deployment environment file: $env_file" >&2
    exit 1
  fi
done
for certificate_file in "/etc/letsencrypt/live/$domain/fullchain.pem" "/etc/letsencrypt/live/$domain/privkey.pem"; do
  if [[ ! -f "$certificate_file" ]]; then
    echo "Missing trusted TLS certificate file for the selected domain." >&2
    exit 1
  fi
done

if ! id kmattendance >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/km-attendance --create-home --shell /usr/sbin/nologin kmattendance
fi
install -d -o root -g root -m 0755 /opt/km-attendance /opt/km-attendance/releases
install -d -o kmattendance -g kmattendance -m 0750 /var/lib/km-attendance /var/lib/km-attendance/insightface
install -d -o root -g kmattendance -m 0750 /etc/km-attendance
chown root:kmattendance /etc/km-attendance/backend.env /etc/km-attendance/ocr.env
chmod 0640 /etc/km-attendance/backend.env /etc/km-attendance/ocr.env
chown root:root /etc/km-attendance/frontend.env.production
chmod 0644 /etc/km-attendance/frontend.env.production

release_dir="/opt/km-attendance/releases/$release_id"
if [[ -e "$release_dir" ]]; then
  echo "Release destination already exists: $release_dir" >&2
  exit 1
fi
install -d -o kmattendance -g kmattendance -m 0755 "$release_dir"
cp -a "$bundle_dir/." "$release_dir/"
chown -R kmattendance:kmattendance "$release_dir"
(
  cd "$release_dir"
  sha256sum --check --quiet SHA256SUMS
)

runuser -u kmattendance -- python3 -m venv "$release_dir/backend/.venv"
runuser -u kmattendance -- "$release_dir/backend/.venv/bin/python" -m pip install --disable-pip-version-check -r "$release_dir/backend/requirement.txt"
(
  cd "$release_dir/ocr-service"
  runuser -u kmattendance -- npm ci --omit=dev --ignore-scripts=false
)

preflight_extra=()
if [[ "$api_only" == "true" ]]; then
  preflight_extra=(
    --require-cross-origin-api
    --expected-api-origin "https://$domain"
    --expected-frontend-origin "$frontend_origin"
  )
fi
"$release_dir/backend/.venv/bin/python" "$release_dir/scripts/production_preflight.py" \
  --backend-env /etc/km-attendance/backend.env \
  --ocr-env /etc/km-attendance/ocr.env \
  --frontend-env /etc/km-attendance/frontend.env.production \
  --model-root /var/lib/km-attendance/insightface \
  --expected-version "$release_id" \
  "${preflight_extra[@]}"

install -m 0644 "$release_dir/deployment/systemd/km-attendance-backend.service" /etc/systemd/system/km-attendance-backend.service
install -m 0644 "$release_dir/deployment/systemd/km-attendance-ocr.service" /etc/systemd/system/km-attendance-ocr.service
install -m 0644 "$release_dir/deployment/systemd/km-attendance-healthcheck.service" /etc/systemd/system/km-attendance-healthcheck.service
install -m 0644 "$release_dir/deployment/systemd/km-attendance-healthcheck.timer" /etc/systemd/system/km-attendance-healthcheck.timer

nginx_temp="$(mktemp)"
nginx_backup="$(mktemp)"
nginx_had_previous=false
cleanup() {
  rm -f -- "$nginx_temp" "$nginx_backup"
}
trap cleanup EXIT INT TERM
nginx_template="$release_dir/deployment/nginx/attendance.conf.example"
nginx_placeholder="attendance.example.ac.th"
if [[ "$api_only" == "true" ]]; then
  nginx_template="$release_dir/deployment/nginx/attendance-api-only.conf.example"
  nginx_placeholder="api.attendance.example.ac.th"
fi
sed -e "s/$nginx_placeholder/$domain/g" -e "s/YOUR_PROJECT_REF/$project_ref/g" \
  "$nginx_template" >"$nginx_temp"
if [[ -f /etc/nginx/conf.d/km-attendance.conf ]]; then
  cp -a /etc/nginx/conf.d/km-attendance.conf "$nginx_backup"
  nginx_had_previous=true
fi
install -m 0644 "$nginx_temp" /etc/nginx/conf.d/km-attendance.conf
if ! nginx -t; then
  if [[ "$nginx_had_previous" == "true" ]]; then
    install -m 0644 "$nginx_backup" /etc/nginx/conf.d/km-attendance.conf
  else
    unlink /etc/nginx/conf.d/km-attendance.conf
  fi
  echo "Nginx validation failed; the previous configuration was restored." >&2
  exit 1
fi

previous_release=""
if [[ -L /opt/km-attendance/current ]]; then
  previous_release="$(readlink -f /opt/km-attendance/current)"
fi
ln -sfn "$release_dir" /opt/km-attendance/current
systemctl daemon-reload
systemctl enable km-attendance-ocr.service km-attendance-backend.service km-attendance-healthcheck.timer >/dev/null
systemctl restart km-attendance-ocr.service km-attendance-backend.service
systemctl restart km-attendance-healthcheck.timer

ready=false
for _attempt in $(seq 1 120); do
  if curl --silent --fail --max-time 3 -H 'Host: localhost' http://127.0.0.1:8000/health/ready >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "New release did not become ready; restoring the previous application symlink." >&2
  if [[ -n "$previous_release" ]]; then
    ln -sfn "$previous_release" /opt/km-attendance/current
    systemctl restart km-attendance-ocr.service km-attendance-backend.service || true
  else
    unlink /opt/km-attendance/current || true
    systemctl stop km-attendance-backend.service km-attendance-ocr.service || true
  fi
  exit 1
fi

systemctl reload nginx
echo "Release $release_id is active and readiness checks passed."
echo "Keep the previous release directory until production smoke tests and rollback verification pass."
