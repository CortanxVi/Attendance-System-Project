# Deployment and staging runbook

Thai operational guides:

- `docs/DEPLOYMENT_GUIDE_TH.md` — staging, release bundles, atomic installation, acceptance testing, and rollback
- `docs/HYBRID_VERCEL_MINIPC_DEPLOYMENT_TH.md` — Vercel/static-cloud frontend with an API-only Mini PC backend
- `docs/USER_GUIDE_TH.md` — student, teacher, and permanent-administrator usage

The files in this directory are templates. Replace every `example` or
`YOUR_PROJECT_REF` value before production. Never commit populated environment
files, TLS private keys, Supabase service-role keys, PIN peppers, or liveness
signing keys.

## Local mobile Development/Staging test

1. Connect the development computer and phone to the same trusted LAN.
2. Run `./start_mobile_test.sh`. Override automatic address detection with
   `MOBILE_TEST_HOST=192.168.x.x ./start_mobile_test.sh` when necessary.
3. Transfer only `.certs/mobile-test/mobile-test-ca.crt` to the phone. Never
   transfer either `.key` file.
4. On iOS, install the CA profile and enable full trust under Certificate Trust
   Settings. On Android, install it as a user CA certificate for the test device.
5. Add the exact printed HTTPS URL to Supabase Auth Redirect URLs, without using
   a broad wildcard. Keep the production Site URL unchanged.
6. Open the printed `https://...:5173` URL. FastAPI and Light OCR remain bound to
   loopback and are reached only through the Vite development proxy.
7. Remove the temporary redirect URL and development CA from the phone after QA.

If the ordinary development launcher is already using the default ports, stop it
first or select an isolated set, for example:

```bash
MOBILE_OCR_PORT=3101 MOBILE_BACKEND_PORT=8100 MOBILE_FRONTEND_PORT=5174 ./start_mobile_test.sh
```

The development CA is intentionally ignored by Git. Delete `.certs/mobile-test`
to rotate it. This launcher is not a production server and must never be exposed
to the public internet.

## Production preparation

1. Resolve the existing local/remote Supabase migration-history mismatch, review
   `20260907164433_secure_face_enrollment_liveness.sql`, then apply it to staging
   before production. Run database lint and both advisors after applying.
2. Confirm the InsightFace pretrained-model license is suitable for the intended
   deployment. Code and pretrained-model licensing are separate. Do not release
   until the project owner has documented this decision.
3. Copy the three required buffalo_s model files into
   `/var/lib/km-attendance/insightface/models/buffalo_s` and run
   `INSIGHTFACE_MODEL_ROOT=/var/lib/km-attendance/insightface scripts/verify_face_models.sh`.
4. Create the `kmattendance` system user, `/opt/km-attendance`,
   `/etc/km-attendance`, and `/var/lib/km-attendance`. Environment files should
   be owned by root, group-readable by `kmattendance`, and mode `0640` or tighter.
5. Create independent random secrets with `openssl rand -hex 32`; do not reuse
   the OCR token as the liveness key or PIN pepper.
6. Build the frontend with its production environment: `cd frontend && npm ci && npm run build`.
7. Build an immutable bundle with `scripts/build_release_bundle.sh`, install it
   with `scripts/install_production_release.sh`, and enable the two systemd units. The initial backend worker count is
   one to avoid duplicating models on the 8 GB target; test one versus two workers
   before changing it.
8. Replace domain/project placeholders in the Nginx template, validate with
   `nginx -t`, install a trusted TLS certificate, and expose only ports 80/443.
9. Run `backend/.venv/bin/python scripts/production_preflight.py`,
   `scripts/verify_release.sh`, `/health/ready`, staging E2E, 30/40-user burst,
   soak, restart, and restore tests before tagging a release.

## Rollback

- Keep the previous frontend `dist` and application release directory until the
  new version passes smoke tests.
- Stop traffic-changing migrations from being combined with unrelated UI changes.
- Back up the hosted database and record the migration version before deployment.
- On application failure, switch the `/opt/km-attendance/current` symlink back to
  the previous immutable release and restart both services.
- Database rollback must use a reviewed compensating migration; never delete or
  rewrite an already-applied production migration file.
