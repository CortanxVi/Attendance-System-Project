#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
premium_root="${FRONTEND_PREMIUM_AUDIT_ROOT:-/home/cortanadesu/.codex/plugins/cache/openai-curated-remote/frontend-design-premium/1.4.0/skills/frontend-design-premium}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required (Node.js 22.12+ or 24)." >&2
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 || (major === 22 && minor >= 12) ? 0 : 1)'; then
  echo "Node.js 22.12+ or 24 is required; current version is $(node --version). Run: nvm use" >&2
  exit 1
fi

cd "$project_root"
git diff --check
scripts/verify_face_models.sh

(
  cd backend
  .venv/bin/python -m unittest discover -s tests
  .venv/bin/python -m pip check
)

(
  cd frontend
  npm run lint
  npm run test:card-image
  npm run test:security
  npm run test:liveness
  npm run test:face-runtime
  npm run test:api-origin
  npm run build
  npm audit --audit-level=moderate
)

(
  cd ocr-service
  npm run test:security
  npm run doctor
  npm audit --audit-level=moderate
)

if [[ -f "$premium_root/scripts/audit_project.py" ]]; then
  python3 "$premium_root/scripts/audit_project.py" "$project_root" --mode strict --no-write
else
  echo "Optional frontend premium audit skipped (tool not installed at configured path)."
fi
echo "Release verification completed successfully."
