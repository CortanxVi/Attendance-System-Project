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
