# Engineering Change Log

This is the append-only engineering record for the project's two-agent hybrid workflow. Every agent must read the latest entries before editing and append a new English entry after completing a task or making a material change. Existing entries must not be rewritten or deleted. Secrets, tokens, biometric samples, and personally identifiable information must never be recorded here.

## 2026-09-06 — Liveness Protocol v2 and Local Anti-Spoofing Replacement

- **Status:** Implementation complete; production-device calibration remains a release check.
- **Primary actor:** Codex primary agent.
- **Supporting analysis:** Two research agents reviewed blink mathematics and liveness security considerations before implementation.
- **Objective:** Remove the previous head-turn liveness flow and replace it with a short, usable, local-only protocol that requires a real user to align their face, move closer, return to the guide, and complete one or two server-directed bilateral eye blinks. Keep the system suitable for an Ubuntu Server mini PC and protect it against simple photo, replay, frame-substitution, and concurrency attacks.

### Frontend changes

- Replaced the old `blink`, `turn_left`, and `turn_right` state machine with protocol version 2: calibration, move closer, return to the guide, wait for the signed prompt, blink, final-frame capture, and completion.
- Added per-eye EAR and MediaPipe eye-blink blendshape checks. A blink now requires both eyes to close and reopen; a wink, nod, face loss, or insufficient movement does not satisfy the challenge.
- Added a signed random prompt delay and support for one or two required blinks. The client cannot reduce the server-selected count.
- Captured the exact analyzed frames for baseline, near, returned, closed-eye, reopened-eye, and final markers. Images are resized to a maximum width of 640 pixels and encoded as JPEG at quality 0.82 to limit upload and memory pressure while retaining useful eye and face detail.
- Moved MediaPipe Face Landmarker inference into a Web Worker so camera analysis does not block the interface. Added responsive camera selection and accessible Thai live status/error messages.
- Removed the legacy `@mediapipe/face_mesh` dependency and service. Added exact `@mediapipe/tasks-vision` version 1.0.1 with local model and WebAssembly runtime assets, so liveness inference does not depend on a third-party runtime request.
- Updated the QR scanner, student home state, and multipart attendance API contract to require only the version 2 challenge and frame bundle. Legacy turn-image and single-blink-image fields are no longer accepted.

### Backend changes

- Upgraded signed liveness challenges to protocol version 2. The token binds the student, QR challenge, expiry, nonce, ordered actions, required blink count, and prompt delay using the existing HMAC mechanism.
- Added strict evidence validation for payload size, marker order, timing, effective frame rate, movement ratios, bilateral blink ratios, and challenge policy.
- Added server-side frame recomputation. The backend independently detects the face and eye geometry in every submitted marker frame, verifies that exactly one face is present, checks that all frames belong to the same person, validates move-closer and return geometry, rejects duplicate/static transitions, rejects winks and head-motion substitutions, and returns the final verified embedding for recognition.
- Added local passive presentation-attack detection with a checksum-pinned quantized MiniFAS V2 SE ONNX model. Three stable frontal frames are evaluated in one batch. The service is fail-closed when the model is missing, corrupted, or produces an unsafe score.
- Limited passive-PAD concurrency and ONNX Runtime thread counts for an 8 GB CPU-only server. Lowered the aggregate attendance request limit to 16 MB by default, with a 20 MB maximum configuration bound, to reduce burst-memory risk.
- Kept liveness media transient: frames are decoded and evaluated in memory and are not written to permanent attendance storage.

### Database and Supabase impact

- No Supabase schema migration or SQL deployment is required for this replacement.
- Existing challenge rows and atomic claim, renew, release, and finalize RPC operations remain unchanged.
- Protocol version 2 policy is carried inside the signed challenge token and request payload; existing replay protection and single-use challenge behavior remain in place.

### Security and privacy decisions

- Client-reported landmarks and metrics are treated as untrusted hints; acceptance depends on backend recomputation from the submitted marker images.
- The signed challenge prevents action order, blink count, expiry, and prompt delay from being changed by the browser.
- Exact-frame markers and duplicate-frame comparison make basic static-image reuse harder, while local passive PAD adds a separate print/screen-attack signal.
- The implementation does not claim perfect spoof resistance or formal ISO/IEC 30107 certification. Thresholds must be calibrated with the actual phones, webcams, lighting, and student population before production release.
- No external biometric or liveness service is used.

### Files and components changed

- Frontend liveness engine, worker, scanner, QR scanner, student attendance flow, API service, Vite configuration, local MediaPipe assets, package manifest, lockfile, and liveness tests.
- Backend liveness token/evidence service, frame verification service, passive PAD service, face observation service, attendance endpoint, configuration, environment example, model asset, and security tests.
- Project README, design context, UX contract, research plan, and third-party notices.
- The roster-import security test now creates its documented XLSX fixture in memory instead of depending on a developer-local file, making the suite portable across Linux, Windows, and CI.

### Verification completed before this entry

- Frontend lint passed.
- Student-card image test passed.
- Frontend security test passed.
- Liveness state-machine tests passed for valid one/two-blink flows and rejected static, nod, wink, and face-loss cases.
- Frontend production build passed and included the worker, local model, and WebAssembly assets.
- Frontend dependency audit reported zero known high-severity vulnerabilities after pinning the patched `fast-uri` transitive dependency.
- Python dependency consistency check passed.
- Backend unit tests passed prior to the final documentation-only review; a final full-suite result will be appended below.
- Strict frontend design audit reported zero findings.
- Git whitespace validation passed.
- Local development-server checks returned HTTP 200 for the Face Landmarker model and WebAssembly runtime.
- A local three-frame passive-PAD batch completed in approximately 57–78 ms on the development host. This is not a benchmark of the target Intel Core i3-7100T server.

### Remaining release checks and handoff

- Exercise the protected attendance flow end-to-end with an authenticated student, a live dynamic QR challenge, and real front/rear phone cameras plus supported webcams.
- Build a consented presentation-attack evaluation set covering printed photos, phone/tablet replay, varied skin tones, glasses, masks where permitted, dim rooms, backlight, and low-cost cameras. Tune `LIVENESS_PAD_THRESHOLD` against false-accept and false-reject results rather than changing it by intuition.
- Run a 30–40 concurrent-user burst test on the target Intel Core i3-7100T, 8 GB Ubuntu Server machine and observe CPU, memory, queue latency, timeout rate, and Supabase connection behavior.
- Confirm production HTTPS, reverse-proxy body limits, camera permissions, model checksum validation, secrets, and observability before release.
- If any release check changes code or configuration, append a new dated entry instead of modifying this one.

## 2026-09-06 — Canonical Token Validation and Final Regression Run

- **Status:** Completed.
- **Actor:** Codex primary agent.
- **Objective:** Close the final regression failure, verify the full liveness replacement, and establish the permanent two-agent logging convention.
- **Changes:** Added canonical unpadded Base64URL validation to the liveness token decoder. Standard Base64 decoding can accept different final characters when only unused trailing bits change; those alternative strings may decode to the same signature bytes. The server now re-encodes each decoded segment and rejects it unless the visible representation exactly matches the canonical form, ensuring that any textual token mutation is rejected.
- **Workflow:** Added root `AGENTS.md` rules for scoped two-agent work, preserving unrelated changes, proportional testing, append-only English logging, and exclusion of secrets, personal data, and biometric samples from logs.
- **Database/deployment impact:** No schema, Supabase RPC, environment-variable, or external-service change is required for the canonical-token fix. Both `AGENTS.md` and `log.md` must be included in the repository so subsequent agents receive the workflow rules.
- **Security/privacy impact:** Removes token-representation ambiguity without weakening constant-time HMAC comparison. No user data was added to tests or logs.
- **Verification:** Backend full suite passed: 73 tests. Python package consistency passed with no broken requirements. Frontend lint, card-image tests, spreadsheet security tests, liveness state-machine tests, and production build all passed. `npm audit --audit-level=high` reported zero vulnerabilities. The strict frontend design audit reported zero findings.
- **Environment note:** The host's default Node executable is older than the project's test requirements. Final frontend verification used the Codex workspace Node runtime. Deployment machines should use the Node version documented by the project/package tooling rather than relying on an older system binary.
- **Remaining risks/handoff:** No known automated-test failure remains. The real-device, attack-set, and 30–40-user target-server release checks listed in the preceding entry remain mandatory because they require production-like cameras, consented samples, authenticated QR flow, and target hardware.

## 2026-09-06 — Delivery Audit

- **Status:** Completed.
- **Actor:** Codex primary agent.
- **Objective:** Confirm the repository is ready for user review after the liveness replacement and collaboration-workflow addition.
- **Changes:** No runtime code was changed during this audit.
- **Verification:** `git diff --check` passed. Runtime source contains no remaining legacy head-turn action, legacy liveness upload field, or `@mediapipe/face_mesh` dependency reference; the only legacy field names are negative OpenAPI assertions proving they are absent. The dependency tree contains `@mediapipe/tasks-vision@1.0.1` and patched `fast-uri@3.1.6`. The temporary Vite development process was stopped after verification.
- **Database/security/privacy impact:** None beyond the already documented changes. No migration was created and no secret or personal data was accessed.
- **Handoff:** The working tree intentionally contains the complete uncommitted implementation for user inspection. The next agent must read this log and `AGENTS.md`, avoid overlapping edits, and append its own English entry after any further change.

## 2026-09-06 — Face Landmarker ModuleFactory Fix and Pre-QR Preloading

- **Status:** Completed and browser-verified.
- **Actor:** Codex primary agent.
- **Objective:** Fix the student liveness failure `ModuleFactory not set.` and remove model download/compilation from the short-lived post-QR portion of the attendance flow.

### Root cause

- `faceLandmarker.worker.ts` is bundled as an ES-module Web Worker, but `FilesetResolver.forVisionTasks()` was called without its `useModule` argument. This selected MediaPipe's classic Emscripten loader inside a module worker. The classic path could not install the `ModuleFactory` expected by the task runtime, even though the model and WASM files were present locally.
- The worker was also created and terminated by every `LivenessScanner` mount. Consequently, model loading and WASM compilation started only after QR validation and were repeated for later attempts, consuming time from a 10–15 second dynamic-QR workflow.

### Implementation

- Changed the worker to call `FilesetResolver.forVisionTasks(wasmRoot, true)`, selecting the provided `vision_wasm_module_internal.js` and matching module WASM binary.
- Added a guarded 64×64 blank-frame warm-up after Face Landmarker creation. Browsers without compatible `OffscreenCanvas` skip only the warm-up; successful model initialization remains usable.
- Added `faceLandmarkerRuntime.ts` as the single owner of one Face Landmarker worker per application session. Concurrent preload calls share one promise, and liveness screens attach short-lived client IDs without recreating or terminating the model.
- Added a 30-second initialization deadline, recoverable error state, explicit retry, and client cleanup. Late results for a closed liveness screen are discarded and their transferred `ImageBitmap` is closed.
- Started preload automatically when the student attendance page mounts. The QR scanner button is disabled until download, compilation, and warm-up finish, so a liveness challenge is not issued while the model is still loading.
- Added a stable Thai loading/ready/error status panel. The error shown to students is actionable and does not expose internal loader details; retry does not open the camera or issue a QR challenge.
- Reset the liveness tracker when the user changes cameras while retaining the already initialized shared model.
- Added a Workbox Cache First rule for only the local Face Landmarker model and MediaPipe WASM paths. The cache name includes Tasks Vision version 1.0.1 and the model checksum prefix, enabling deliberate invalidation on a future SDK/model update. `/api/**` remains uncached.
- Updated `DESIGN.md`, `UX-CONTRACT.md`, and `README.md` to make pre-QR readiness, failure recovery, singleton ownership, and cache behavior durable project contracts.

### Files changed

- Added `frontend/src/services/faceLandmarkerRuntime.ts`.
- Updated `frontend/src/workers/faceLandmarker.worker.ts`.
- Updated `frontend/src/features/student/LivenessScanner.tsx` and `StudentHome.tsx`.
- Updated `frontend/vite.config.ts`, `frontend/package.json`, `README.md`, `DESIGN.md`, and `UX-CONTRACT.md`.
- Added `frontend/scripts/test-face-runtime.mjs` to prevent regressions to a classic loader, per-scan worker construction, or an ungated QR action.

### Security, privacy, database, and deployment impact

- Model and WASM requests remain same-application assets; no external inference service or biometric transmission was introduced.
- The service worker caches only static face-runtime assets and never caches attendance API responses, QR tokens, liveness evidence, images, or user records.
- No Supabase schema, RPC, RLS policy, environment variable, or backend deployment change is required.
- Production static hosting must serve the module loader as JavaScript, the WASM file as `application/wasm`, and the `.task` model as a readable binary response. HTTPS is still required for non-localhost camera access.

### Verification

- A real browser loaded the Vite-served runtime, selected the module loader, created Face Landmarker, and completed warm-up successfully in approximately 1,875 ms on the development host. Browser error/warning logs were empty and `ModuleFactory not set.` did not recur.
- The module loader, WASM binary, and model returned HTTP 200; the WASM response used `application/wasm`.
- Frontend lint passed.
- Card-image, spreadsheet-security, liveness, and new face-runtime contract tests passed.
- Frontend production build passed and generated the module worker plus the versioned Workbox runtime-cache route.
- `npm audit --audit-level=high` reported zero vulnerabilities.
- Backend regression suite passed: 73 tests; Python package consistency reported no broken requirements.
- Strict premium frontend audit reported zero findings. Changed UI code contained none of the searched native-dialog, non-semantic click-target, false-link, raw-HTML, or `!important` anti-patterns.
- `git diff --check` passed.

### Remaining validation

- The authenticated student screen and camera workflow still require a final test on the supported iPhone/Android/browser matrix because this automated browser run did not use a student account or camera permission.
- Measure cold preload on the real mobile network and production server. The development-host timing is evidence that the loader now works, not a performance guarantee for every device.
- When changing the Tasks Vision package or model file, update the local assets, integrity documentation, runtime-cache version, and browser test together.

## 2026-09-06 — Face Runtime Verification Log Clarification

- **Status:** Documentation correction only; no runtime code changed.
- **Actor:** Codex primary agent.
- **Reason:** The browser developer-log API returned an empty list during the runtime check, but the Vite development terminal later displayed MediaPipe's standard initialization diagnostics. To keep this append-only record accurate, the earlier statement about empty browser warning/error logs must be read together with this clarification.
- **Observed diagnostics:** XNNPACK CPU delegate creation, disabled OpenGL error checking, and feedback-tensor support being disabled for a model without a single inference signature. These messages occurred during successful initialization and did not include `ModuleFactory not set.` or prevent the runtime from reaching `ready` in approximately 1,875 ms.
- **Verification/deployment impact:** No action or Supabase change is required. Production observability should classify these upstream initialization diagnostics separately from application failures so they do not create false alerts.

## 2026-09-06 — Real-Camera Liveness Usability Tuning and Seven-Minute Retry Window

- **Status:** Completed in code and automated tests; awaiting repeat testing on the user's iPhone 15 Plus through Iriun Cam and notebook webcam.
- **Actor:** Codex primary agent.
- **Objective:** Reduce false rejection caused by variable frame rate, bridge latency, compression, and minor pose jitter while retaining the hybrid move/return, bilateral-blink, same-person, duplicate-frame, and passive-PAD controls. Extend the post-QR liveness authorization to seven minutes without keeping one camera attempt active for seven minutes.

### Implementation and rationale

- Centralized browser thresholds in the exported `LIVENESS_TRACKER_LIMITS` object. Calibration now needs 10 rather than 12 good frames, transient poor-quality tolerance is 8 frames rather than 3, supported effective throughput starts at 8 FPS rather than 10 FPS, and stable phase transitions need 2 consecutive analyzed frames rather than 3.
- Moderately widened the client pose, center, scale-return, and bilateral blink tolerances. Approach movement is still mandatory, but its minimum scale change is 8% rather than 12%. Both eyes must still close and reopen, two consecutive closed observations remain mandatory, and a wink does not pass.
- Increased one active camera attempt to 45 seconds, the move/return phase to at most 15 seconds, and the post-prompt blink-response window to 8 seconds. Added an in-place `ลองตรวจอีกครั้ง` action so a failed attempt can restart without rescanning QR while the authorization remains valid.
- Changed the account-bound, signed, one-use post-QR challenge lifetime from the local 150-second setting and the 120-second documented default to 420 seconds. Dynamic classroom QR rotation remains independently constrained to 10–15 seconds. The student screen now explains both the seven-minute authorization and the 45-second per-attempt limit.
- Mirrored the browser tolerance changes in independent backend evidence and image recomputation. The server now accepts moderate center/pose jitter and an 8% approach-scale increase, allows 8 FPS and a 45-second signed evidence sequence, and tolerates modest camera-compression confidence loss by lowering the single-face detection floor from 0.60 to 0.55. The server still rejects multiple faces, identity discontinuity, static movement frames, unilateral eye closure, malformed timing, expired/tampered tokens, and passive-PAD failures.
- Kept `LIVENESS_PAD_THRESHOLD=0.65`, the face-identity thresholds, duplicate-frame checks, signed random prompt delay, randomized one/two-blink step-up, course enrollment validation, and atomic single-use challenge consumption unchanged. No captured biometric image is newly persisted.
- Documented the exact tuning locations and restart requirement in `README.md`, and updated `DESIGN.md` and `UX-CONTRACT.md` so the retry and variable-camera behavior remains part of the product contract.
- During dependency verification, pinned `qs` 6.16.0 for the Light OCR service to remove two moderate denial-of-service advisories inherited through Express. Also pinned root-tooling `postcss` 8.5.28 and `nanoid` 3.3.18 to clear two high-severity development dependency advisories. These pins do not change the application API or OCR behavior.

### Files and components changed

- Browser tracking and retry UX: `frontend/src/utils/liveness.ts`, `frontend/src/features/student/LivenessScanner.tsx`, `frontend/src/features/student/QRScanner.tsx`, `frontend/src/features/student/StudentHome.tsx`, and `frontend/scripts/test-liveness.mts`.
- Backend policy and image verification: `backend/services/liveness_service.py`, `backend/services/liveness_frame_service.py`, `backend/services/insightface_service.py`, `backend/core/config.py`, `backend/.env.example`, the local `backend/.env`, `backend/tests/test_liveness_security.py`, and `backend/tests/test_liveness_frames.py`.
- Dependency hardening: root `package.json`/`package-lock.json` and `ocr-service/package.json`/`package-lock.json`.
- Documentation contracts: `README.md`, `DESIGN.md`, and `UX-CONTRACT.md`.

### Security, privacy, Supabase, and deployment impact

- The seven-minute window increases usability and the theoretical lifetime of an intercepted challenge. Its exposure is bounded because the challenge is HMAC-signed, tied to one authenticated student and one validated course session, stored server-side, expires, and is atomically consumable only once. A current rotating QR is still required to create it.
- The relaxed client values are not an authority boundary. Backend timing, frame geometry, face identity, frame continuity, and local passive PAD remain independent gates. The adjustment reduces false rejection but does not claim perfect replay/deepfake resistance or ISO/IEC 30107 certification.
- Supabase needs no new migration: the existing `attendance_checkin_challenges.expires_at` column and claim/finalize RPCs already enforce the server-provided timestamp rather than a fixed duration. New 420-second challenges begin only after the backend process is restarted; already-created rows retain their original expiry.
- Production `.env` files on other machines must set `QR_CHALLENGE_SECONDS=420`. Accepted configuration range is 60–600 seconds. `QR_REFRESH_SECONDS` must remain between 10 and 15 seconds. No secrets, biometric samples, or student data were added to this log.

### Verification

- Frontend ESLint passed.
- Frontend liveness tests passed for normal and variable 9–11 FPS camera streams with moderate pose jitter; static-photo behavior, nod-only movement, one-eye wink, and sustained face loss remained rejected.
- Face-runtime preload/ModuleFactory contract test passed.
- Frontend student-card and spreadsheet-export security tests passed.
- Frontend TypeScript production build passed and emitted the local worker/model/WASM PWA assets.
- Backend full unit suite passed: 75 tests, including new slow-valid-attempt/over-45-second rejection and moderate-webcam-geometry cases.
- Python bytecode compilation and package consistency checks passed.
- Frontend dependency audit reported zero vulnerabilities. OCR service audit reported zero vulnerabilities after the `qs` override. Root tooling audit reported zero vulnerabilities after the `postcss` and `nanoid` overrides.
- OCR environment isolation test passed. `git diff --check` passed.

### Remaining validation and handoff

- Restart all services, create a fresh dynamic QR challenge, and repeat the complete authenticated flow on the iPhone/Iriun and notebook webcam. Existing challenges and an already-running backend do not pick up the new lifetime.
- Record only aggregate pass/fail, attempt duration, device/browser, FPS, lighting category, and backend rejection reason; do not retain student face images for calibration.
- Do not lower passive PAD or identity thresholds based on one failed attempt. If false rejection remains, collect a consented multi-device evaluation set and tune from measured false-reject/false-accept rates while retaining print and screen-replay attack cases.

## 2026-09-07 — Student Mobile Camera and Local-Testing Readiness Audit

- **Status:** Read-only audit completed; no runtime source, configuration, database schema, or launcher was changed.
- **Actor:** Codex primary agent.
- **Objective:** Identify camera-access and image-processing limitations in the student application and define a safe way to test the authenticated workflow on a physical phone without deploying the application.

### Components reviewed and findings

- Reviewed the Linux launcher, Vite development proxy/PWA configuration, Supabase client and Google OAuth redirect behavior, student registration, dynamic-QR scanning, liveness scanner/runtime/worker, card-image preparation, browser HTTP client, backend CORS defaults, OCR service binding, and current model artifacts.
- The current Linux launcher explicitly binds both Vite and FastAPI to loopback. A phone on the same network therefore cannot reach the application when it is started with the existing launcher.
- Merely binding Vite to the LAN is insufficient for camera testing. Browser media capture requires a secure context; a plain HTTP page opened through a LAN IP is not treated as localhost on the phone. Local testing therefore needs a phone-trusted development certificate and HTTPS, or a carefully controlled HTTPS tunnel.
- Relative `/api` requests and the Vite proxy allow FastAPI and Light OCR to remain loopback-only during a LAN test. This is preferred to exposing database-service and OCR ports to the network. Only the HTTPS frontend development port needs temporary LAN reachability.
- Google login uses the current browser origin as `redirectTo`. The temporary HTTPS development origin must therefore be added to the hosted Supabase project's allowed Auth Redirect URLs for the test and removed afterwards. No schema or RLS change is required.
- A cold liveness start downloads roughly 3.8 MB of model data plus approximately 11.8 MB of the selected WebAssembly runtime from the development host. The initialization deadline is 30 seconds. The production PWA runtime cache is generated for builds, while ordinary Vite development testing primarily depends on normal browser HTTP caching.
- Liveness requests an ideal 640×480 front-camera stream, processes at most one transferred `ImageBitmap` at a time in a module Web Worker, and requires at least 8 effective analyzed FPS. Browser constraints are preferences rather than guarantees; camera choice, resolution, frame rate, thermal throttling, low-power mode, tab suspension, and camera ownership can still cause failures.
- The attendance flow submits selected JPEG evidence frames rather than streaming the whole video to FastAPI. With one blink this is six liveness images; the signed two-blink step-up uses eight, plus the student-card image. Images remain transient request data under the current design.
- Card preparation accepts only JPEG and PNG, decodes the source before downscaling to at most 1920×1920, and can temporarily consume substantially more memory than the output file for very high-resolution phone photos. HEIC/HEIF input is not explicitly supported. Base64 evidence copies also add temporary browser memory overhead.
- A complete QR test requires the active teacher QR to be visible on another screen. The current live QR scanner does not provide a gallery-import fallback for a QR displayed on the same phone.
- The browser attendance API timeout is 46 seconds. It is close to the OCR service's 42-second deadline and may be reached under a queue burst even when the seven-minute challenge remains valid.

### Security and privacy impact

- Recommended local HTTPS with a dedicated development CA, trusting only the public CA certificate on the test phone, never transferring its private key, binding only the frontend to the trusted LAN, and keeping FastAPI, OCR, and the Supabase secret key on loopback/server-side paths.
- A Vite development server must not be exposed on a public or untrusted network. Any temporary firewall rule should be limited to the local subnet and removed after testing. A third-party HTTPS tunnel is less preferred for biometric workflow testing because traffic leaves the local network and the generated origin must be added to the Auth redirect allow-list.
- No biometric image, student record, access token, service key, private URL, or device identifier was written to this log.

### Database and deployment impact

- No deployment is required and no Supabase migration is needed. Hosted Supabase Auth/Database remain internet dependencies during the test.
- Temporary Supabase dashboard configuration is limited to an exact HTTPS Auth redirect origin. It should not replace the production Site URL and should be removed after the test.
- The current repository does not yet include a dedicated mobile-test HTTPS launcher or certificate bootstrap. Adding one would be a separate implementation task and must keep generated certificates and private CA material out of version control.

### Verification performed

- Confirmed from `start_all.sh` that FastAPI and Vite are launched with loopback-only host arguments.
- Confirmed Vite API calls are relative and proxy to loopback FastAPI, allowing same-origin mobile requests without exposing backend/OCR ports.
- Confirmed Google OAuth uses `window.location.origin` and therefore requires the test origin in the Supabase Auth redirect allow-list.
- Confirmed liveness model/runtime artifact sizes, the 30-second preload deadline, 640×480 ideal capture, one-frame-at-a-time backpressure, 8 FPS acceptance floor, and transient 640-pixel JPEG evidence encoding from source.
- Checked current MDN secure-context/media-capture guidance, current Google MediaPipe Face Landmarker guidance, and current Supabase Auth redirect documentation. The Supabase changelog markdown endpoint returned an internal fetch error; no implementation or schema decision depended on unavailable changelog content.

### Remaining risks and handoff

- Implement and verify a development-only HTTPS mobile launcher before attempting direct LAN camera testing. Test certificate installation/removal instructions on the actual iOS version.
- Execute a browser/device matrix using current Safari on iPhone first, then current Chrome on Android if supported. Record aggregate cold-load time, analyzed FPS, camera permission result, camera-switch behavior, liveness pass/fail stage, upload duration, and sanitized backend error category.
- Consider a future streaming/memory improvement for large card images and a coordinated client/server request deadline review before the 30–40-user production load test. Do not change these limits without measuring real devices and queue behavior.

## 2026-09-07 — Full-Production Readiness Assessment

- **Status:** Read-only production-readiness assessment completed; no runtime code, liveness threshold, database schema, or deployment configuration was changed.
- **Actor:** Codex primary agent.
- **Objective:** Determine whether the current attendance application is ready for a full production release and identify the remaining release gates after real-device blink-liveness testing showed intermittent false rejection.

### Files or components reviewed

- Reviewed the current working tree and release state, development launchers, environment validation, authentication and CORS configuration, dynamic-QR and liveness flow, initial face-enrollment flow, Light OCR queue/runtime configuration, frontend request deadlines, Supabase migrations and advisors, automated tests, build artifacts, dependency audits, and available deployment/operations files.
- Confirmed that the repository has a large uncommitted working tree and no committed production package, release tag, CI workflow, reverse-proxy configuration, system service definitions, container deployment, or documented rollback artifact.
- Confirmed that `start_all.sh` launches FastAPI on loopback and serves the frontend through the Vite development server. It is a development/test launcher, not a production deployment entry point.
- Confirmed that the active backend environment remains `development`, allows only localhost CORS origins, and does not define the separate production liveness-signing key or temporary-admin PIN pepper required by the configuration guard.
- Confirmed that initial face enrollment captures and submits one still frame. The backend validates identity ownership and extracts an embedding, but the enrollment endpoint does not require liveness proof or teacher approval. This permits an account holder to enroll a different person's face and is a high-priority anti-proxy-attendance gap.
- Confirmed that the current OCR and face-processing concurrency controls are bounded, but no end-to-end 30- or 40-user run has been executed on the target Intel Core i3-7100T/8 GB Ubuntu Server host. Multiple FastAPI workers would duplicate model memory and can oversubscribe this machine, so worker count must be selected from measurements rather than the four-worker source comment.
- Confirmed that the browser, backend, and OCR request deadlines are close enough that a full OCR queue burst can cause client-visible timeout before recovery. The seven-minute QR challenge lifetime does not itself extend those request deadlines.

### Supabase and database assessment

- Ran the linked Supabase migration history check. Local and remote histories match through migration `20260901231720`, but the final three logical migration positions use different local and remote timestamps. Their SQL content must be compared and the migration history reconciled before any production `db push`; blindly applying the local set could duplicate functions or create schema drift.
- Ran the linked Supabase security and performance advisors. The security advisor reported leaked-password protection as disabled. It did not report an RLS error in this snapshot, but this is not a substitute for authenticated role-matrix tests against the real policies and RPC functions.
- The performance advisor reported informational unused-index findings. No index was removed because current development traffic is not representative enough to establish that those indexes are unnecessary.
- Attempted the linked database lint, but the direct database connection was rejected by password authentication. Live database lint therefore remains incomplete and must be rerun with the correct database password through an approved secret channel.
- Reviewed current migration SQL for exposed-table RLS enablement, revoked public execution, explicit `service_role` grants, and `SECURITY DEFINER` functions with a fixed empty `search_path`. Additional integration tests are still required for every student, teacher, administrator, anonymous, and service-role access path.

### Security and privacy impact

- No secret value, project URL, access token, biometric image, face embedding, student record, or private test asset was written to this log.
- Full release remains blocked by intermittent real-device blink false rejection, the non-live face-enrollment path, missing production secret separation, incomplete database lint and migration reconciliation, lack of global/shared abuse controls for expensive endpoints, and the absence of verified HTTPS/reverse-proxy security headers and production monitoring.
- Dynamic QR rotation and one-use account-bound challenges reduce replay but cannot by themselves prove physical classroom presence if a QR image is shared immediately. NFC UID check-in also remains clonable when ordinary UID-only cards are used. Both residual risks require an explicit operating policy or stronger proximity/card technology.
- Production planning must include biometric and student-record purpose limitation, notice/consent or other reviewed legal basis, least-privilege access, deletion and retention schedules, incident response, and a restore-tested backup policy. No permanent attendance photo storage is required by the current product direction.

### Database and deployment impact

- No database or deployment mutation was performed. The linked hosted project was accessed only through read-only migration-history and advisor commands; database lint failed before inspection.
- A production release needs a separate staging environment, production HTTPS origin, exact Supabase Auth Site URL and redirect allow-list, custom production secrets, a production frontend static build behind a reverse proxy, supervised backend/OCR services, health/readiness checks, bounded worker/resource settings, log rotation, monitoring, backup/restore procedures, and a tested rollback path.
- Supabase project hardening still needs SSL enforcement, suitable network restrictions, account/organization MFA, Auth provider and redirect review, leaked-password protection or disabled password auth, custom SMTP when email delivery is used, and plan/backup/PITR decisions appropriate to the required recovery objectives.

### Verification performed

- Frontend lint, card-image tests, spreadsheet-import security tests, liveness tests, face-runtime tests, and the production build completed successfully.
- Backend test discovery completed with 75 passing tests, and Python dependency consistency reported no broken requirements.
- Light OCR security tests completed successfully. The installed native Light OCR runtime reported healthy, the small PP-OCRv6 model package is installed locally, and dependency audits for the frontend, OCR service, and repository root reported zero known vulnerabilities at the requested audit level.
- The production build completed but produced several large JavaScript chunks, including PDF, spreadsheet, main application, and student-home bundles. Model and WebAssembly cold-load behavior still requires real-network measurement and cache validation.
- The current test machine is not the target mini PC, so these passing checks do not establish production capacity. No synthetic, privacy-safe card image was available for the existing OCR concurrency script, and no complete 30/40-user attendance pipeline load or soak test was performed.
- Rechecked the working tree and confirmed that all prior implementation changes remain uncommitted. No unrelated user or second-agent change was discarded.

### Remaining risks and handoff

- Treat the application as development-complete enough for continued QA, not ready for unrestricted full production. A tightly controlled pilot is appropriate only after the critical enrollment, liveness, production-environment, migration, HTTPS, and target-host load-test gates are closed.
- Do not tune blink thresholds from one device or one failed session. On explicit approval, add privacy-preserving phase telemetry and calibrate against a consented multi-device genuine-user set plus printed-photo, screen-replay, and video/deepfake attack cases.
- Reconcile the final three Supabase migration-history entries and rerun database lint and the Security/Performance Advisors before deployment.
- Build a reproducible production service and reverse-proxy setup, then run full staging E2E, 30/40-user burst tests, one- to two-hour soak tests, restart/recovery tests, Supabase role-policy tests, and backup/restore drills on hardware matching the target server.
- Review, commit, and tag the current working tree only after the changes and generated model artifacts have been independently reviewed and all release evidence is attached to the release checklist.

## 2026-09-08 — Mobile Development/Staging Harness, Secure Face Enrollment, and Production Readiness Tooling

- **Status:** Implementation and local automated verification completed. Physical-device authenticated QA, the staging database migration, target-host capacity testing, and production operator actions remain pending.
- **Actor:** Codex primary agent.
- **Objective:** Let the frontend be tested securely from phones on the same trusted LAN while FastAPI and Light OCR remain on the development computer; close the unsafe still-image student enrollment path; add reproducible health, deployment, CI, and release checks; and prepare the repository for unit, integration, burst, and staging validation.

### Implementation and rationale

- Added a development-only HTTPS mobile launcher. It creates a private local development CA and a short-lived server certificate containing the selected LAN host, exposes only Vite over HTTPS, and keeps FastAPI and Light OCR bound to loopback behind the Vite proxy. Port validation, Node.js version validation, dependency/environment checks, child-process monitoring, and coordinated shutdown are included.
- Added a mobile smoke test that verifies the HTTPS page, local Face Landmarker artifact, backend liveness endpoint, and dependency readiness endpoint through the same origin used by the phone. Generated certificates and private keys are excluded from version control.
- Changed normal Vite development binding back to loopback by default. LAN binding and certificate loading occur only when the dedicated launcher opts in. Backend requests deliberately remain relative `/api/v1` paths so mobile testing and production do not rely on an insecure or device-local backend URL.
- Added request-correlation and defensive API response headers without recording query strings, payloads, tokens, OCR text, student data, or biometric material. Production disables interactive API documentation and requires explicit trusted hosts and HTTPS CORS origins.
- Added separate liveness and readiness health endpoints. Readiness checks the hosted database and the authenticated loopback OCR health service with bounded timeouts and returns only generic dependency states.
- Replaced student self-enrollment by a single still image with an account-bound, student-card-verified, signed Liveness v2 flow. The backend now recomputes movement, bilateral blinking, face continuity, duplicate-frame resistance, and passive PAD before storing the embedding from the verified final frame. The browser sends selected evidence frames, not a complete video stream.
- Added a local Supabase migration for a service-role-only face-enrollment challenge table and claim, renew, release, and atomic finalize RPCs. Challenges are short-lived, single-use, tied to the authenticated profile and student identifier, and protected by RLS plus revoked public/anonymous/authenticated grants. A processing lease is renewed while expensive verification is queued so concurrent classroom traffic cannot silently steal an active claim.
- Students cannot replace an already-registered face through self-service. Temporary administrators cannot write face embeddings. The existing permanent-administrator path remains as an explicitly supervised override. Malformed student identifiers are rejected before image/model work.
- Removed the unused legacy `frontend/src/components/Enrollment.tsx` still-image component so it cannot accidentally be wired back into the student route.
- Added multipart request-size enforcement for both enrollment endpoints before framework parsing/spooling, while retaining existing decoded image dimension, pixel-count, MIME/signature, and per-file limits.
- Restricted InsightFace initialization to the detection, recognition, and required landmark modules. Added pinned SHA-256 hashes and an offline verification script for the three required model files, plus a third-party notice that separates code licensing from pretrained-model licensing.
- Added example production environments, hardened one-worker systemd services for the 8 GB target host, an Nginx TLS/static/API reverse-proxy template, a deployment/rollback runbook, a configuration preflight that never prints secret values, a read-only Supabase release-check helper, and a consolidated release-verification script.
- Added GitHub Actions jobs for the backend, frontend, and OCR service. Added a repository-root `.nvmrc`; release verification now fails early with a clear message unless Node.js 22.12+ or 24 is active. The Codex premium UI audit is portable and optional when its local tool is unavailable.
- Updated `README.md`, `DESIGN.md`, and `UX-CONTRACT.md` with the mobile test workflow, same-origin API rule, secure enrollment behavior, deployment gates, and operational responsibilities.

### Files and components changed

- Mobile staging and verification: `.gitignore`, `.nvmrc`, `start_mobile_test.sh`, `scripts/setup_mobile_test_certificate.sh`, `scripts/smoke_mobile_test.sh`, `scripts/verify_release.sh`, `scripts/production_preflight.py`, `scripts/check_supabase_release.sh`, and `scripts/verify_face_models.sh`.
- Backend runtime and security: `backend/main.py`, `backend/core/config.py`, `backend/core/request_limits.py`, `backend/core/operational.py`, `backend/services/face_enrollment_service.py`, `backend/services/insightface_service.py`, `backend/.env.example`, and `backend/models/insightface-buffalo-s.sha256`.
- Frontend enrollment and configuration: `frontend/src/features/student/StudentRegister.tsx`, `frontend/src/services/api.ts`, `frontend/vite.config.ts`, `frontend/.env.local.example`, and removal of `frontend/src/components/Enrollment.tsx`.
- Database: `supabase/migrations/20260907164433_secure_face_enrollment_liveness.sql`; the Supabase CLI local version marker was refreshed during the read-only linked-project check and then restored to its recorded version, leaving only its trailing-newline metadata changed.
- Deployment and automation: `.github/workflows/ci.yml` and the new `deployment` environment, systemd, Nginx, and runbook templates.
- Documentation and notices: `README.md`, `DESIGN.md`, `UX-CONTRACT.md`, and `THIRD_PARTY_NOTICES.md`.
- Tests: `backend/tests/test_face_enrollment_security.py`, `backend/tests/test_operational_security.py`, and the updated liveness OpenAPI contract checks.

### Security and privacy impact

- FastAPI, Light OCR, Supabase server credentials, the development CA private key, face model files, OCR text, and biometric evidence are not exposed directly to the LAN client. Only the phone-trusted Vite HTTPS origin is reachable during local mobile QA.
- Student card OCR must match the authenticated profile before a face-enrollment challenge is issued. A challenge cannot be replayed after successful consumption or concurrently finalized with a different claim token.
- Face images remain transient request data; the change stores only the existing 512-dimensional face embedding and does not add permanent attendance-photo storage.
- Operational logging is intentionally metadata-only. No secret, token, private URL, student record, OCR result, raw biometric image, or embedding was added to this log.
- Residual biometric risk remains: RGB webcam liveness is a layered deterrent, not a guarantee against every sophisticated presentation/deepfake attack and not an ISO/IEC 30107 certification.

### Database and deployment impact

- The new face-enrollment migration is local only and has **not** been pushed to the linked Supabase project. Student self-enrollment will require that migration in staging.
- The linked local/remote migration histories still differ at the three previously identified late migration positions. A database lint attempt could not authenticate. Those histories must be compared and reconciled with the approved database password before applying the new migration; no blind history repair or database push was performed.
- Production templates are not installed services. Operators must supply independent secrets, exact domain/project values, a trusted TLS certificate, model files, permissions, monitoring, backup/restore procedures, and rollback artifacts.
- Supabase dashboard actions remain pending, including leaked-password protection or disabling password auth, exact production redirect/Site URLs, MFA/provider review, SSL/network restrictions, SMTP if applicable, and backup/PITR decisions.
- InsightFace model checksums pass, but the upstream pretrained-model commercial/production license must be confirmed and documented before release.

### Verification performed

- Dedicated LAN HTTPS launch succeeded on isolated ports: Light OCR initialized, FastAPI remained on loopback, Vite served HTTPS to the LAN, and the mobile smoke test passed the frontend, local model, liveness, database, and OCR readiness checks. Test services were shut down cleanly without stopping the user's existing local services.
- The consolidated release verification completed successfully using Node.js 22.23.2: backend tests, Python dependency consistency, frontend lint, card-image tests, spreadsheet-export security, Liveness v2 tests, face-runtime contract, production build, frontend dependency audit, OCR isolation test, Light OCR doctor, OCR dependency audit, model checksums, strict premium UI audit, and `git diff --check` all passed.
- Final backend discovery passed **85 tests**. The focused face-enrollment security suite passed **7 tests**, including legacy still-image rejection, temporary-admin rejection, malformed identifier rejection, backend-only atomic migration checks, lease renewal binding, vector serialization, and non-finite embedding rejection. Python package consistency reported no broken requirements.
- Frontend liveness simulation continued to accept normal and variable-FPS genuine sequences while rejecting static images, nod-only movement, unilateral wink, and face-loss sequences. The production build transformed 1,901 modules and generated the PWA successfully. Frontend and OCR dependency audits reported zero vulnerabilities at the configured threshold.
- Light OCR reported native runtime status `ok` on Linux with the small PP-OCRv6 model tier. A privacy-safe 30-request concurrent burst against an isolated OCR process completed **30/30** successfully in **1,948 ms wall time**, with **988 ms p50**, **1,868 ms p95**, and **1,931 ms maximum** latency. This small synthetic image validates queue behavior, not full-resolution target-hardware capacity.
- The production preflight was intentionally exercised against the current development configuration and correctly rejected development mode, missing/separated production secrets, localhost origins/hosts, development OCR mode, and an insecure legacy API URL without exposing any configured values.

### Remaining risks and handoff work

- Install the development CA on a dedicated test phone, add only the exact temporary HTTPS origin to Supabase Auth Redirect URLs, apply the reviewed migration to a reconciled staging database, and execute the authenticated Google login, profile, course join, QR, face enrollment, attendance, NFC, support attachment/preview, roster import, and role-boundary matrix on real devices.
- Re-test intermittent straight-ahead blink detection on the agreed device/browser/lighting matrix. Preserve the current server-side PAD and identity controls until measured genuine/attack data supports a threshold change.
- Run 30- and 40-user full-resolution OCR plus complete attendance-pipeline burst tests, a one- to two-hour soak, restart/recovery, and memory/CPU measurements on the Intel Core i3 target host. The synthetic burst on the development computer is not a production capacity guarantee.
- Run database lint and Supabase security/performance advisors after the migration is applied, then run explicit anonymous/student/teacher/temporary-admin/permanent-admin/service-role integration tests.
- Test backup restoration and rollback, configure external monitoring and log rotation, independently review the change set, run CI on the remote repository, and create an immutable release/tag only after the staging evidence is accepted.

## 2026-09-08 — Atomic Deployment Packaging and Thai Operations/User Guides

- **Status:** Repository-side deployment implementation completed and verified with a disposable Staging bundle. No production host, DNS, TLS, Supabase migration, Git push, or live service was mutated because the required target details and database release gates are not yet available.
- **Actor:** Codex primary agent.
- **Objective:** Convert the production templates into a reproducible, guarded release process for Ubuntu Server 24.04, close remaining reverse-proxy/service-hardening gaps, add internal health monitoring, and provide complete Thai usage and deployment instructions.

### Implementation and rationale

- Aligned Nginx, systemd, deployment, and rollback around immutable release directories under `/opt/km-attendance/releases` plus one atomic `/opt/km-attendance/current` symlink. This removes the prior mismatch where service files used fixed component paths while the rollback text expected a current-release symlink.
- Added `scripts/build_release_bundle.sh`. It requires absolute paths, rejects output inside the source repository, rejects dirty worktrees for Production, permits explicitly marked dirty Staging builds, runs the full release verification, builds the frontend in a clean temporary copy, excludes environment/private/build/dependency files, creates release metadata, rejects symlinks, and verifies a SHA-256 manifest.
- Added `scripts/install_production_release.sh`. It validates the bundle, clean source state, release ID, domain, Supabase project reference, Node version, TLS files, environment files, database approval, model-license approval, checksums, production preflight, and Nginx syntax. It installs dependencies into the immutable release, switches the symlink only after validation, waits for readiness, and restores the previous application symlink automatically if the new release fails.
- Added `scripts/rollback_production_release.sh`. It requires an exact release ID, rejects unexpected symlinks, validates checksums, switches atomically, restarts services, waits for readiness, and restores the prior symlink when the rollback target is unhealthy.
- Added a one-minute internal readiness timer and service plus `scripts/healthcheck_production.sh`. It checks loopback readiness only and writes a simple pass/failure event to the system journal; an external alert destination remains an operator choice.
- Updated systemd services to execute from the current-release symlink, keep one FastAPI worker on the 8 GB target, verify the pre-provisioned face models before Backend startup, require Node.js 22.12+/24 before OCR startup, and add kernel/device/privilege restrictions compatible with CPU/WASM inference.
- Updated Nginx to serve the immutable current release, hide the version, disable TLS session tickets, enable a bounded TLS session cache, and reuse the upstream HTTP connection. Removed the location-level `add_header` that would suppress inherited HSTS and other server headers.
- Added Backend `Cache-Control: no-store` on every API response so authenticated/API content is not cached by browsers or intermediaries while static model/PWA assets retain explicit cache behavior.
- Expanded production preflight with release-version matching, strict HTTPS Supabase/CORS URL parsing, loopback-only OCR URL validation, strict trusted-host syntax, rejection of ignored `VITE_API_URL`, rejection of server credential names in the frontend environment, public/private secret inequality, and secret-file permission checks.
- Added `docs/USER_GUIDE_TH.md` for student, teacher, temporary-admin, and permanent-admin workflows, including profiles, course codes, roster import, face enrollment, Liveness, Dynamic QR, NFC, requests, reports, troubleshooting, and privacy practices.
- Added `docs/DEPLOYMENT_GUIDE_TH.md` covering architecture, prerequisites, Supabase Staging reconciliation, environment permissions, offline model provisioning, bundle creation, atomic installation, acceptance testing, monitoring, and rollback.
- Added deployment regression tests that assert the release gates, atomic paths, loopback bindings, one-worker constraint, health timer, inherited security-header behavior, and presence of both Thai guides.

### Files and components changed

- Release automation: `scripts/build_release_bundle.sh`, `scripts/install_production_release.sh`, `scripts/rollback_production_release.sh`, `scripts/healthcheck_production.sh`, and `scripts/production_preflight.py`.
- Service/reverse proxy templates: `deployment/systemd/km-attendance-backend.service`, `deployment/systemd/km-attendance-ocr.service`, `deployment/systemd/km-attendance-healthcheck.service`, `deployment/systemd/km-attendance-healthcheck.timer`, and `deployment/nginx/attendance.conf.example`.
- Runtime security: `backend/core/operational.py` and `backend/tests/test_operational_security.py`.
- Regression coverage: `backend/tests/test_launcher_security.py`.
- Documentation: `docs/USER_GUIDE_TH.md`, `docs/DEPLOYMENT_GUIDE_TH.md`, `deployment/README.md`, and `README.md`.

### Security and privacy impact

- Production installation now fails closed when a bundle is dirty, altered, contains symlinks, has an invalid target identifier, lacks approved database/model gates, lacks TLS, exposes server credential names to the frontend, uses non-loopback OCR, has unsafe environment permissions, or fails readiness.
- The bundle includes no `.env`, TLS key/PEM, development CA, Git history, Python virtual environment, Node modules, test data, or raw private configuration. Frontend environment values remain public by design and appear only in the compiled static bundle.
- API responses are non-cacheable. Health monitoring uses only generic readiness state and does not send tokens, OCR output, biometric evidence, student records, or query strings.
- No secret value, access token, database password, project URL, student identifier, face embedding, biometric sample, or private test artifact was added to this log.

### Database and deployment impact

- Reviewed current official Supabase deployment, environment-management, migration, redirect-URL, and production-checklist guidance. Current guidance continues to recommend separate Staging/Production projects, exact Production redirect URLs, load testing in Staging, RLS/security advisor review, and migration deployment through a controlled CI/CD flow. The current breaking-change list does not require an application change for this hosted architecture; Node.js 22 is already selected after the Supabase JavaScript ecosystem dropped Node.js 20 support.
- No linked Supabase schema or migration history was changed. The existing three-position migration mismatch and the unapplied secure face-enrollment migration remain release blockers. The installer requires an explicit database-ready attestation and never runs `db push` or `migration repair` automatically.
- No live server was installed. The active development host does not match the target Mini PC and does not have Nginx installed. The generated installer is intended to run only on the designated Ubuntu Server after DNS, TLS, environment files, model files, and staging acceptance evidence are available.
- Production deployment still requires the actual hostname, Supabase Staging/Production selection, approved database access, SSH/console access to the target host, trusted TLS certificate, model-license decision, and external monitoring/alert destination.

### Verification performed

- Full release verification passed from the latest source with **87 Backend tests**, Python dependency consistency, frontend lint, card-image checks, spreadsheet security checks, Liveness v2 tests, face-runtime contract, TypeScript production build, PWA generation, frontend/OCR dependency audits, OCR isolation, Light OCR doctor, three face-model checksums, strict premium UI audit, and `git diff --check`.
- Focused deployment/operational tests passed **10 tests**. Shell syntax validation passed for every deployment script; Python bytecode compilation passed for the expanded preflight.
- systemd unit verification parsed all service/timer definitions without syntax errors. It reported only the expected missing `/opt/km-attendance/current` executable paths because the development machine has not installed a release.
- Negative preflight testing correctly rejected placeholder credentials, a mismatched release version, and world-readable example environment files without printing any configured value.
- Built a disposable Staging bundle from the current dirty worktree with Node.js 22.23.2. The script ran all checks, rebuilt 1,901 frontend modules, generated the PWA, produced the minimal runtime package, and marked it `dirty-staging-build`.
- Independently rescanned the bundle: checksums passed; no `.env`, key, PEM, symbolic link, legacy requirement copy, Windows launcher, or OCR test script was present. The disposable bundle was moved to the desktop trash after verification.
- Nginx runtime validation could not run on the development host because Nginx is not installed. The Production installer always runs `nginx -t` on the target and restores the prior configuration if validation fails.

### Remaining risks and handoff work

- Provide the deployment hostname, indicate whether the first target is Staging or Production, and provide an approved SSH/console path to the Ubuntu Server. Do not send passwords or service keys in chat; place them directly in root-owned `/etc/km-attendance` environment files on the target.
- Reconcile and apply Supabase migrations to a separate Staging project, run database lint and both advisors, and complete the role matrix plus real-device acceptance checklist before declaring the database ready.
- Confirm the InsightFace pretrained-model license and place the pinned model files on the target before using the model-license attestation flag.
- Commit and independently review the current working tree before creating a clean Production bundle. The current source remains intentionally uncommitted and can only create a Staging-marked bundle.
- Install/validate Nginx and TLS on the actual host, run 30/40-user full-resolution attendance load plus soak/restart/restore tests, connect health timer failures to an external alert channel, and verify the application rollback and database compensating-migration procedure before opening unrestricted Production traffic.

## 2026-09-10 — Hybrid Cloud Frontend and Mini PC API-Only Deployment

- **Status:** Repository-side hybrid deployment support and Thai deployment documentation completed and verified. No Vercel project, DNS record, TLS certificate, router/firewall, Supabase project, migration history, production database, or Mini PC service was changed because no live deployment target or credentials were supplied.
- **Actor:** Codex primary agent.
- **Objective:** Allow the Vite/PWA frontend to run on Vercel or another static cloud while FastAPI, Light OCR, and InsightFace remain on the agreed Ubuntu Server Mini PC; provide a detailed, security-conscious operating guide and preserve the existing same-origin development/deployment mode.

### Implementation and rationale

- Added an optional `VITE_API_ORIGIN` frontend setting. An empty value preserves the existing relative `/api` flow through the Vite development proxy or same-origin Nginx. A configured value makes the shared Axios client send API requests directly to the Mini PC's public origin, avoiding Vercel proxying of OCR and Liveness multipart evidence.
- Added a centralized API-origin policy that permits only HTTP(S), requires HTTPS in Production, permits explicit HTTP only on loopback during development, rejects credentials/path/query/fragment input, and normalizes a harmless trailing slash. The existing authorization interceptor still attaches Supabase access and temporary-admin grant tokens only to `/api/` requests.
- Extended production preflight with split-deployment flags and cross-checks. It now validates an exact HTTPS API origin, requires its hostname in `TRUSTED_HOSTS`, requires the exact Frontend origin in `CORS_ORIGINS`, rejects malformed/out-of-range ports, and continues to reject legacy `VITE_API_URL` and frontend server credentials without printing values.
- Hardened Backend Production startup so CORS entries must be exact HTTPS origins and Trusted Host entries must be explicit hostname syntax. This makes unsafe path-bearing, credential-bearing, wildcard, or malformed origin configuration fail closed even if the operator bypasses the release preflight.
- Added an API-only Nginx template for the Mini PC. It exposes only `/api/` and generic liveness health, keeps readiness loopback-only, forwards solely to `127.0.0.1:8000`, retains request/body/connection limits and security headers, and returns 404 for all unrelated paths. It never serves the bundled frontend.
- Added `--api-only --frontend-origin <exact HTTPS origin>` to the atomic installer. In this mode the installer selects the API-only Nginx template and requires the Backend CORS, Trusted Host, and compiled Frontend API origin to agree before activating the release. The existing combined same-origin installation path is unchanged.
- Added a Vercel configuration template with Vite SPA fallback and browser security headers. Its CSP contains deliberate hostname/project placeholders so the operator must replace them with the exact API and Supabase endpoints before committing/deploying it.
- Added a comprehensive Thai hybrid-deployment guide covering architecture, environment boundaries, Vercel Dashboard/CLI deployment, Supabase Auth redirects, Google OAuth callback responsibilities, API-only Mini PC installation, TLS/firewall/CORS tests, acceptance tests, 30/40-user capacity verification, rollback, alternate static hosts, CGNAT options, and the privacy trade-off of Cloudflare Tunnel.
- Updated repository and deployment indexes plus the existing Ubuntu deployment guide to route operators to the hybrid guide.
- Added a frontend API-origin contract test and included it in local release verification and GitHub Actions.
- During release verification, the npm advisory database newly reported four Multer multipart-upload issues, including High-severity denial-of-service conditions affecting the installed 2.2.0 release. Updated and exactly pinned the direct OCR dependency to Multer 2.3.0, regenerated the lockfile, and re-ran the OCR isolation/doctor/audit and complete release gate successfully.

### Files and components changed

- Frontend runtime/configuration: `frontend/src/config/apiOrigin.ts`, `frontend/src/services/http.ts`, `frontend/.env.local.example`, and `deployment/frontend.env.production.example`.
- Frontend verification: `frontend/scripts/test-api-origin.mts`, `frontend/package.json`, `scripts/verify_release.sh`, and `.github/workflows/ci.yml`.
- Backend configuration/release validation: `backend/core/config.py`, `scripts/production_preflight.py`, and `backend/tests/test_launcher_security.py`.
- Mini PC/Vercel deployment: `deployment/nginx/attendance-api-only.conf.example`, `deployment/vercel/vercel.json.example`, and `scripts/install_production_release.sh`.
- Documentation: `docs/HYBRID_VERCEL_MINIPC_DEPLOYMENT_TH.md`, `docs/DEPLOYMENT_GUIDE_TH.md`, `deployment/README.md`, and `README.md`.
- OCR supply-chain remediation: `ocr-service/package.json` and `ocr-service/package-lock.json`.

### Security and privacy impact

- Browser uploads for student-card OCR and Liveness are designed to travel directly over HTTPS to the Mini PC API rather than through Vercel. Vercel receives static-site requests but does not become the application API proxy in the documented design. Supabase still receives the Auth/Database/Storage/Realtime traffic defined by the application.
- Only the Supabase publishable/legacy anon key, Supabase public URL, and public API origin may be placed in Vite/Vercel variables. Service-role/server keys, OCR tokens, Liveness signing keys, PIN peppers, student records, and biometric values remain server-only.
- The guide requires exact Production CORS and OAuth redirects, TLS without browser bypass, no public FastAPI/OCR ports, stable Staging domains, CSP customization, and direct inspection that Bearer tokens are not sent to unrelated origins.
- The API-only edge retains body, connection, and request-rate controls. A Cloudflare Tunnel is presented only as an approved alternative because biometric evidence would transit a further processor and client-IP/rate-limit behavior requires a separate privacy and trusted-proxy review.
- The Multer update closes the currently reported crafted multipart field, aborted-upload descriptor leak, async file-filter size bypass, and oversized array-index advisories in the OCR upload layer.
- No access token, service key, private URL, student record, OCR result, raw image, face embedding, or other personal data was written to this log or documentation.

### Database and deployment impact

- No schema, data, RLS policy, Supabase Auth setting, Storage object, or migration history was changed. Current official Supabase guidance was rechecked: use separate Staging/Production environments, use exact Production redirect URLs, run Security/Performance Advisors, and deploy reviewed migrations through a controlled workflow.
- The prior three-position local/remote Supabase migration-history mismatch and unapplied secure face-enrollment migration remain Production blockers. The hybrid installer does not push, repair, or otherwise mutate the database.
- No live Vercel/Cloudflare project or Mini PC was deployed. Production still requires real Frontend/API hostnames, DNS/TLS, Mini PC access, root-owned environment files, approved database state, model-license approval, a clean reviewed Git revision, and monitoring/backup/rollback ownership.
- The target Mini PC must continue with one FastAPI worker initially. Thirty/forty-user support remains conditional on full-resolution WAN-path load and soak testing on the i3-7100T/8 GB target; cloud-hosting the static frontend does not remove API inference or uplink bottlenecks.

### Verification performed

- Complete `scripts/verify_release.sh` passed with Node.js 22.23.2: three pinned face-model checksums, **87 Backend tests**, Python dependency consistency, Frontend lint, card-image sizing, spreadsheet security, Liveness v2, face-runtime preload, new API-origin policy test, TypeScript/Vite/PWA Production build, Frontend dependency audit, OCR environment isolation, Light OCR doctor, OCR dependency audit, strict frontend premium audit, and `git diff --check`.
- Frontend Production build transformed **1,902 modules** and generated the PWA successfully. Both Frontend and OCR npm audits ended with **0 vulnerabilities** at the configured threshold after the Multer update.
- Focused deployment/operational verification passed **10 tests**. Shell syntax validation passed for the installer/release scripts, and Python bytecode compilation passed for Backend configuration and the expanded Production preflight.
- Light OCR 0.5.7 doctor reported the small PP-OCRv6 bundle and native Linux runtime ready after Multer 2.3.0 installation. OCR isolation tests continued to pass.
- Reviewed current official Vercel Vite/SPA, environment-variable, rewrite, and CLI deployment documentation; current Supabase changelog, redirect-URL, environment-management, and Production-checklist documentation; and current Cloudflare Tunnel connectivity documentation. The documented Node 22 requirement already addresses Supabase JavaScript clients ending Node 20 support.

### Remaining risks and handoff work

- Replace every Vercel CSP/API/Supabase placeholder, add and commit the deployment-specific `frontend/vercel.json`, and run a Vercel Preview against a separate Staging API/Supabase project before Production promotion.
- Reconcile Supabase migration history, apply the reviewed face-enrollment migration in Staging, run database lint and both advisors, and complete anonymous/student/teacher/temporary-admin/permanent-admin/service-role tests.
- Confirm whether the Mini PC has a public IP or is behind CGNAT. Obtain institutional privacy/security approval before routing biometric uploads through any tunnel/CDN provider.
- Provision the actual API hostname, trusted certificate, firewall/router policy, root-owned environment files, pinned model files, UPS, external alerting, and backup/restore process, then run the documented CORS/OAuth/TLS/device matrix.
- Run 30/40-user full-resolution attendance bursts and a one- to two-hour soak across the real Internet uplink. Record CPU, RAM, upload bandwidth, queue time, p95 latency, error rate, restart recovery, and rollback evidence before declaring Production capacity.
- The current repository worktree contains the existing uncommitted project changes. Independent review and a clean commit are still required before the release builder will create a Production-marked bundle.

## 2026-09-10 — Docker Staging Runtime on the Development Workstation

- **Status:** Local Docker Staging implementation completed and running. No public tunnel, Frontend cloud deployment, DNS, Supabase migration, or Production data was changed.
- **Actor:** Codex primary agent.
- **Objective:** Provide a repeatable pre-Production environment for branch `demo3.1` in which FastAPI and Light OCR run as isolated Docker services on the development workstation, while remaining ready for a Vercel/Netlify Preview Frontend through an explicitly configured HTTPS tunnel.

### Files and components changed

- Added `backend/Dockerfile` with a Python 3.12 multi-stage CPU runtime, a non-root service user, one Uvicorn worker, required OpenCV runtime libraries, and a liveness health check.
- Added `backend/.dockerignore` so local environments, tests, alternate requirement snapshots, bytecode, and secrets are excluded from the image context.
- Added `ocr-service/Dockerfile` with Node.js 22 on Debian Trixie, a non-root service user, production-only dependencies, and a native-engine health check.
- Added `ocr-service/.dockerignore` so the local environment, host `node_modules`, tests, and logs are excluded from the image context.
- Added `deployment/docker/compose.staging.yml`, a non-secret machine configuration template, an ignored local machine configuration, and `deployment/docker/README_TH.md` with build, local test, ngrok, Preview environment, shutdown, and acceptance instructions.

### Implementation rationale

- FastAPI is published only on `127.0.0.1:8000`; Light OCR is exposed only to the private Compose network. A future ngrok process can provide the HTTPS boundary required by a cloud-hosted Preview without exposing the OCR service or binding Docker directly to the LAN.
- Backend and OCR retain separate environment files so Supabase server credentials are never injected into the OCR container. Compose overrides only runtime topology and Staging origin/host settings.
- The host's pinned InsightFace model directory is bind-mounted read-only. Model artifacts are not copied into the image or repository.
- Conservative CPU and memory ceilings reflect the four-core, approximately 8-GB development workstation. The FastAPI worker count remains one to avoid duplicating face models.
- The initial OCR image used Debian Bookworm and failed safely because the verified Light OCR addon requires `GLIBC_2.38`; switching only the OCR base to Debian Trixie supplied a compatible glibc and the native runtime then initialized successfully.

### Security and privacy impact

- Both application containers drop Linux capabilities and enable `no-new-privileges`; both application processes run as non-root users.
- Neither built image contains its source `.env` file. OCR receives no Supabase configuration, OCR raw-text output remains disabled, untrusted HTTP Host values are rejected, and the current CORS allowlist contains only local development origins.
- No public tunnel was opened because an exact Frontend Preview origin is not yet available. Before opening one, the operator must add the exact Preview origin and assigned tunnel hostname to the ignored Docker configuration and recreate Backend.
- No secret value, access token, database record, OCR output, image, face embedding, or personal identifier was written to Dockerfiles, documentation, Git, or this log.

### Database and deployment impact

- The containers use the already configured Supabase environment; no schema, row, RLS policy, Auth setting, Storage object, or migration history was mutated.
- The local Staging stack is currently running as Compose project `attendance-demo31-staging`. FastAPI is available only at loopback port 8000, and OCR has no published host port.
- This setup is intentionally Staging, not the final Production release. Production still requires separate secrets, reviewed Supabase migrations, stable DNS/TLS, monitoring, backup/restore, tested rollback, and the existing release gates.

### Verification performed

- Docker Engine 29.5.3 and Docker Compose 5.1.4 were detected on the workstation.
- Compose configuration validation passed; both service images built successfully. The resulting local images were approximately 1.52 GB for Backend and 554 MB for OCR.
- All three pinned `buffalo_s` model files passed their repository SHA-256 checks before startup.
- The OCR container initialized Light OCR 0.5.7 with the Linux x64 native runtime and reported native status `ok`; its production dependency installation reported zero vulnerabilities.
- The Backend loaded the expected detection, recognition, and 3D-landmark ONNX models through `CPUExecutionProvider` and started one Uvicorn worker.
- Both containers reached Docker `healthy`. `/health/live` returned HTTP 200, and `/health/ready` returned HTTP 200 with database, OCR, and face dependencies ready.
- A local CORS preflight returned the exact allowed origin, an untrusted Host request returned HTTP 400, Python dependency consistency passed, and direct checks confirmed that neither runtime image contains `/app/.env`.
- Docker Compose configuration parsing and `git diff --check` passed.

### Remaining risks and handoff work

- Deploy the Frontend Preview, put its exact HTTPS origin in `STAGING_FRONTEND_ORIGINS`, start ngrok, add the assigned ngrok hostname to `STAGING_TRUSTED_HOSTS`, recreate Backend, set the Preview `VITE_API_ORIGIN`, and redeploy the Preview build.
- Use a stable/reserved tunnel hostname when possible. A random hostname changes across ngrok sessions and requires Backend Trusted Host plus Frontend rebuild updates.
- The current local Backend environment is a development-origin configuration reused by the Staging container. Before Internet exposure, add independent Staging liveness and temporary-admin secrets and verify that the connected Supabase project is the approved Staging project rather than Production.
- Run authenticated real-device role, QR, OCR, face, Liveness, NFC, upload, export, restart, burst, and soak tests before any Production promotion.

## 2026-09-10 — Vercel Preview Profile-Load CORS Repair

- **Status:** Local Docker Staging configuration repaired and the public API preflight verified. The user must retry the existing authenticated browser session to complete the end-to-end profile check.
- **Actor:** Codex primary agent.
- **Objective:** Diagnose and correct the condition where Google OAuth returned successfully to the current Vercel Preview but the Frontend could not load `/api/v1/auth/me`.

### Files and components changed

- Updated the ignored workstation-only `deployment/docker/.env` CORS allowlist from the obsolete generated Vercel Preview origin to the current stable Vercel Preview origin. Local Vite origins and the existing ngrok Trusted Host entry were preserved.
- Recreated only the Docker Staging Backend service; the healthy OCR service and all application source files were left unchanged.
- Appended this operational record to `log.md`; no secret or private deployment URL is recorded here.

### Implementation rationale

- Sanitized ngrok request inspection showed repeated `OPTIONS /api/v1/auth/me` requests from the current Frontend origin returning HTTP 400 before an authenticated GET could be sent. A request from the obsolete Preview origin returned HTTP 200, isolating the fault to the exact-origin CORS allowlist rather than OAuth, JWT handling, the profile endpoint, or service readiness.
- Exact origins remain preferable to wildcard CORS because the browser sends an Authorization header and the Backend is exposed through a public HTTPS tunnel.

### Security and privacy impact

- The change grants browser API access only to the current exact Vercel Preview origin plus the existing loopback development origins. The obsolete cloud Preview origin is no longer allowed.
- Trusted Host enforcement remains active for the current tunnel hostname. No wildcard origin/host, credential, access token, student record, profile response, email address, private URL, or biometric value was added to source control or this log.
- Backend authentication still validates each Bearer token against Supabase Auth and does not trust Frontend session state or user-editable metadata for authorization.

### Database and deployment impact

- No Supabase Auth setting, database schema, row, RLS policy, Storage object, migration, Vercel setting, or Frontend bundle was changed.
- The local Docker Staging Backend was recreated with the corrected environment and returned to healthy status. This is a workstation runtime change, not a Production deployment.

### Verification performed

- The Backend container reached Docker `healthy`; local `/health/live` and `/health/ready` both returned HTTP 200.
- A public HTTPS CORS preflight from the current Vercel Preview origin returned HTTP 200 and the exact `Access-Control-Allow-Origin`, allowed methods, and Authorization header.
- An unauthenticated public GET to `/api/v1/auth/me` returned the expected HTTP 401 with both the exact CORS allow-origin header and Bearer challenge, proving that requests now pass Host/CORS middleware and reach authentication.
- A preflight from the obsolete Preview origin returned HTTP 400 as intended.

### Remaining risks and handoff work

- Retry the current browser session and confirm an authenticated `GET /api/v1/auth/me` returns HTTP 200 and routes to the correct role dashboard. If it returns HTTP 401, compare the JWT issuer with the Backend Supabase project without logging the token. If it returns HTTP 403, verify the account uses an approved KMUTNB email domain. If it returns HTTP 503, inspect the sanitized Supabase profile lookup error and migration state.
- The free ngrok hostname is temporary. If it changes, update the local Trusted Host, Vercel Preview `VITE_API_ORIGIN`, recreate Backend, and redeploy Frontend. Prefer a reserved tunnel hostname for repeatable Staging tests.

## 2026-09-10 — Staging Tunnel CORS Availability Recovery

- **Status:** The current Vercel Preview-to-ngrok-to-FastAPI CORS path is online and verified. No application source or database change was required.
- **Actor:** Codex primary agent.
- **Objective:** Resolve the browser report that `/api/v1/auth/me` lacked `Access-Control-Allow-Origin` after the previously configured public tunnel URL stopped serving the Backend response.

### Files and components changed

- No Frontend, Backend, Docker, Supabase, Vercel, or runtime environment value was changed. A user-started ngrok process was discovered forwarding the currently assigned public endpoint to loopback FastAPI port 8000.
- Appended this diagnostic and operational verification record to `log.md` without recording the public tunnel URL, tokens, or user data.

### Implementation rationale

- Before the tunnel was available, the public endpoint returned an ngrok-edge response rather than a FastAPI response, so the browser correctly reported that the response had no application CORS header.
- Once the ngrok process was online, the same endpoint reached Uvicorn. The existing exact-origin Docker Staging CORS and Trusted Host settings were already correct, so widening CORS or changing application code would have reduced security without addressing the availability fault.

### Security and privacy impact

- Exact-origin CORS, Authorization-header preflight support, loopback-only FastAPI binding, Trusted Host enforcement, and the private OCR network remain unchanged.
- No wildcard origin, bypass header, access token, Supabase secret, profile response, email address, student record, private URL, image, or biometric value was introduced or logged.

### Database and deployment impact

- No Supabase Auth setting, schema, row, RLS policy, Storage object, migration, or Vercel deployment was changed.
- The local Backend and OCR containers remained healthy. The public Staging path depends on the ngrok process continuing to run on the development workstation.

### Verification performed

- Confirmed the ngrok agent is running and forwards its assigned HTTPS endpoint to `http://localhost:8000`.
- Public `/health/live` returned HTTP 200 from Uvicorn.
- An `OPTIONS /api/v1/auth/me` request from the exact current Vercel Preview origin returned HTTP 200 with the exact `Access-Control-Allow-Origin`, credential allowance, required methods, and Authorization header allowance.
- An unauthenticated GET reached FastAPI and returned the expected HTTP 401 with the same exact CORS allow-origin header and Bearer challenge, proving that the edge, tunnel, Trusted Host, CORS, routing, and authentication boundary are reachable.
- Docker Backend remained healthy; no applicable Supabase Auth/JWT breaking change was found in the current changelog scan.

### Remaining risks and handoff work

- Reload the deployed Frontend and retry with its existing Supabase session, then confirm the authenticated GET returns HTTP 200. A subsequent HTTP 401 indicates a missing/stale token or Supabase-project mismatch; HTTP 403 indicates the account domain/profile authorization path; HTTP 503 indicates profile schema or Supabase availability.
- Keep the ngrok terminal/process running throughout testing. If its assigned hostname changes, update the Docker Trusted Host and Vercel Preview API origin, recreate Backend, and redeploy the Frontend before retesting.

## 2026-09-10 — ngrok Free Browser Interstitial CORS Fix

- **Status:** Source and local Docker Staging runtime fixed and verified; branch deployment is ready to be pushed for a new Vercel Preview build.
- **Actor:** Codex primary agent.
- **Objective:** Fix the repeated browser-only CORS failure on `/api/v1/auth/me` after ordinary command-line preflight checks appeared healthy.

### Files and components changed

- Updated `frontend/src/config/apiOrigin.ts` with a narrowly scoped detector for HTTPS origins under ngrok Free development hostname suffixes.
- Updated `frontend/src/services/http.ts` so relative application API requests add `ngrok-skip-browser-warning: 1` only when the configured API origin is an ngrok Free development hostname.
- Expanded `frontend/scripts/test-api-origin.mts` to cover both supported ngrok Free suffixes and reject HTTP, unrelated HTTPS, and empty origins.
- Updated `backend/main.py` to allow the explicit ngrok warning-bypass header in CORS preflight requests.
- Updated `deployment/docker/README_TH.md` to explain the ngrok Free interstitial behavior and the deliberately scoped bypass.
- Rebuilt and recreated the local Docker Staging Backend image; OCR was not recreated.

### Implementation rationale

- Reproduction with a standard Chrome User-Agent returned HTTP 200 HTML from the ngrok Free warning interstitial without the application's CORS headers. The same request with the documented bypass header reached FastAPI and returned the expected JSON authentication response.
- Adding the header alone initially caused FastAPI CORS to reject the expanded preflight header set. The Backend allow-header list therefore had to be updated in the same change.
- The bypass is derived from the normalized API origin and is not sent to ordinary institutional, Production, Supabase, or third-party origins.

### Security and privacy impact

- Exact Frontend-origin CORS, credential handling, Trusted Host enforcement, loopback-only FastAPI binding, and private OCR networking remain enabled. No wildcard CORS rule was introduced.
- The bypass header contains only the constant value `1`; it is not a credential and does not weaken Backend Bearer-token validation. Authenticated routes still validate the Supabase access token server-side.
- No access token, Supabase secret, profile response, email address, student record, public/private deployment URL, image, or biometric value was added to the log or source.

### Database and deployment impact

- No Supabase Auth setting, schema, row, RLS policy, Storage object, or migration was changed. The current Supabase changelog contains no applicable hosted Auth/JWT breaking change for this failure.
- The local Backend container was rebuilt and returned to healthy status. The Frontend source change requires a new Vercel Preview build before browsers receive the header.
- This workaround is limited to ngrok Free Staging. A stable Production API domain should not rely on the ngrok interstitial bypass.

### Verification performed

- Frontend API-origin policy tests passed under bundled Node.js 24, including scoped ngrok detection; Frontend ESLint passed.
- TypeScript and Vite Production build completed with 1,902 transformed modules; PWA generation completed with 66 precache entries. The emitted JavaScript contains the bypass header once.
- Backend operational middleware tests passed (2 tests); Python bytecode compilation, Compose configuration validation, and `git diff --check` passed.
- Rebuilt/recreated Backend reached Docker `healthy` while remaining bound only to loopback port 8000.
- Public browser-equivalent preflight requesting both Authorization and the ngrok bypass header returned HTTP 200 with the exact Vercel Preview allow-origin and both requested headers allowed.
- A browser-equivalent GET with the bypass header reached FastAPI and returned the expected HTTP 401 JSON response with Bearer challenge and exact CORS header when intentionally sent without a token. Without the bypass header, the same browser-equivalent request reproduced ngrok's HTTP 200 HTML interstitial.

### Remaining risks and handoff work

- Push the reviewed `demo3.1` commit, wait for Vercel Preview to rebuild, then hard-refresh or use an incognito window and confirm an authenticated `/api/v1/auth/me` returns HTTP 200.
- Keep the ngrok process running. If the assigned hostname changes, update the Docker Trusted Host and Vercel Preview API origin, recreate Backend, and redeploy Frontend.
- For final Production, replace ngrok Free with a stable reviewed HTTPS ingress and omit this provider-specific bypass by configuring a non-ngrok API origin.
