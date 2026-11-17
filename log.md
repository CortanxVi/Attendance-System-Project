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

## 2026-09-10 — Preview/Production CORS Origin Separation

- **Status:** Docker Staging CORS corrected and verified for the branch Preview origin; the Production frontend origin is intentionally no longer accepted by the Staging API.
- **Actor:** Codex primary agent.
- **Objective:** Resolve repeated browser preflight failures after the active test site changed from the Production Vercel origin to the branch-specific `demo3.1` Preview origin.

### Files and components changed

- Updated the ignored workstation-only `deployment/docker/.env` so `STAGING_FRONTEND_ORIGINS` contains the exact branch Preview origin plus the two existing loopback development origins, replacing the Production Vercel origin.
- Recreated only the Docker Staging Backend service to load the corrected environment. Application source, OCR, Supabase, and Vercel configuration were not modified.
- Appended this record to `log.md` without recording the public Preview or tunnel URL.

### Implementation rationale

- Sanitized ngrok inspection showed the newly deployed Preview bundle requesting both Authorization and the ngrok warning-bypass header, proving the prior Frontend fix was deployed. Every Preview preflight returned HTTP 400 while Production-origin preflights returned HTTP 200.
- The running Backend environment still named the Production origin. Replacing it with the exact Preview origin restores the intended `demo3.1` Staging boundary and prevents the Production frontend from calling the workstation Staging API.

### Security and privacy impact

- CORS remains exact-origin and credential-aware; no wildcard was added. Production-to-Staging cross-environment access was removed.
- Trusted Host validation, loopback-only FastAPI binding, private OCR networking, ngrok warning-bypass scoping, and server-side Supabase JWT validation remain unchanged.
- No credential, access token, email address, profile response, student record, private URL, image, or biometric value was written to source control or this log.

### Database and deployment impact

- No Supabase Auth setting, database schema, row, RLS policy, Storage object, migration, Frontend bundle, or Vercel deployment was changed.
- The local Docker Staging Backend was recreated and returned to healthy status. The change is specific to the development workstation's ignored runtime configuration.

### Verification performed

- Public preflight from the exact `demo3.1` Preview origin requesting Authorization plus the ngrok bypass header returned HTTP 200 with the exact `Access-Control-Allow-Origin` value.
- The same preflight from the Production Vercel origin returned HTTP 400 with no allow-origin header, confirming cross-environment isolation.
- A browser-equivalent GET from the Preview origin with the ngrok bypass header reached FastAPI and returned the expected HTTP 401 JSON response with the exact CORS header when intentionally sent without a Bearer token.
- Docker Backend returned to `healthy` after recreation.

### Remaining risks and handoff work

- Hard-refresh or use an incognito Preview session, then confirm the authenticated GET reaches `/api/v1/auth/me` and returns HTTP 200. Status 401, 403, or 503 after a successful preflight is an Auth/profile/database issue rather than CORS.
- Add the exact branch Preview URL to Supabase Auth Redirect URLs while retaining the official Production Site URL; otherwise OAuth may still fall back to Production after Google login.
- Keep ngrok running. If its hostname changes, update the Staging Trusted Host and Vercel Preview API origin, recreate Backend, and redeploy Frontend.

## 2026-09-10 — Production Frontend Promotion Readiness

- **Status:** Release candidate verified; the workstation API now accepts the exact Preview and Production frontend origins during the cutover.
- **Actor:** Codex primary agent.
- **Objective:** Prepare the accepted `demo3.1` Preview revision for promotion through the repository Production branch without reintroducing browser CORS failures.

### Files and components changed

- Updated the ignored workstation-only Docker environment so the Backend permits both exact Vercel Preview and Production origins during the release transition.
- Recreated only the local Docker Staging Backend service to load the revised origin allowlist.
- No application source, Supabase configuration, database object, or tracked deployment manifest was changed by this preparation step.

### Implementation rationale

- The repository Production branch was behind the accepted Preview branch by three commits, including SPA routing and the scoped ngrok browser-warning bypass.
- Promoting the Frontend before allowing its exact Production origin at the Backend would cause the new live application to fail during CORS preflight. Retaining the exact Preview origin allows post-release comparison without enabling wildcard access.
- The currently deployed Production Frontend bundle already references the intended workstation API endpoint, so the Vercel Production API-origin variable is present; the newer Frontend build is still required for the scoped ngrok bypass behavior.

### Security and privacy impact

- CORS remains limited to explicitly named HTTPS deployments and local development origins; wildcard origin matching was not enabled.
- Trusted Host validation, loopback-only Backend binding, private OCR networking, credential-aware CORS, and server-side access-token validation remain unchanged.
- No secret, token, email address, profile response, student record, biometric data, or deployment URL was written to this log.

### Database and deployment impact

- No Supabase Auth, database schema, row, RLS policy, Storage object, or migration was changed.
- The local Backend container returned to healthy status and is reachable through the active tunnel. This remains a workstation-hosted Staging runtime, not an always-available Production-grade backend.
- The Frontend release still requires the accepted Preview commit to reach the configured Vercel Production branch and a successful Vercel build.

### Verification performed

- Production-origin preflight through the public tunnel returned HTTP 200 with the exact `Access-Control-Allow-Origin`, credential allowance, required methods, Authorization header, and scoped ngrok bypass header.
- The complete release verification passed under Node.js 24: 87 Backend tests, Python dependency checks, Frontend lint and contract/security tests, Vite/PWA Production build, zero npm audit findings for Frontend and OCR, OCR runtime diagnostics, face-model integrity checks, strict Frontend quality audit, and `git diff --check`.
- The Backend and OCR containers are healthy after the Backend recreation.

### Remaining risks and handoff work

- Push or merge the accepted Preview branch into the configured Production branch, wait for the Vercel Production deployment, then verify the live page, Google OAuth return, authenticated profile load, and an application workflow.
- The computer, Docker daemon, Backend container, OCR container, and ngrok agent must all be running for the public API to work. A powered-off computer cannot serve requests.
- Configure ngrok and Docker for boot-time startup if this workstation will remain the temporary ingress. For durable Production availability, migrate the API to an always-on host with a stable reviewed HTTPS domain and monitoring.

## 2026-09-10 — Production Branch Merge and Remote Authentication Blocker

- **Status:** Local Production merge completed; remote publication is blocked only by missing GitHub credentials in the Codex shell.
- **Actor:** Codex primary agent.
- **Objective:** Promote the verified `demo3.1` release candidate into the repository branch tracked by Vercel Production.

### Files and components changed

- Committed the accumulated deployment verification records on `demo3.1`.
- Merged `demo3.1` into the local `main` branch with a dedicated non-fast-forward Production promotion commit.
- No additional runtime code, secret, Supabase setting, database object, or workstation service was changed during the merge.

### Implementation rationale

- Keeping `demo3.1` as the Preview branch and `main` as the Production branch preserves the reviewed promotion workflow and matches the connected hosting provider's branch model.
- A merge commit gives the release a clear audit and rollback boundary while retaining the tested Preview history.

### Security and privacy impact

- The merge contains the previously verified exact-origin CORS rules and narrowly scoped ngrok interstitial bypass; it does not add wildcard cross-origin access.
- No credential was generated, requested, persisted, or printed. The failed HTTPS push stopped before remote mutation because no interactive GitHub credential was available.
- No token, user data, private URL, student record, image, or biometric value was added to this log.

### Database and deployment impact

- No Supabase Auth, database schema, row, RLS policy, Storage object, or migration was changed.
- The local `main` branch now contains the accepted Preview revision, but Vercel Production has not rebuilt because the remote `main` branch has not yet received the merge.

### Verification performed

- Fetched the latest remote refs immediately before merging and confirmed the local Production branch started from the current remote Production tip.
- The merge completed without conflicts and the worktree remained clean before this log append.
- The GitHub HTTPS push was attempted and failed with a missing-credentials error; no partial remote update occurred.

### Remaining risks and handoff work

- An authenticated repository owner must push local `main` to `origin`; Vercel should then build the configured Production branch automatically.
- After the Vercel deployment is ready, verify the Production page, OAuth return, authenticated profile request, and one normal application workflow while the workstation Backend and tunnel remain online.

## 2026-09-10 — Production CORS Incident Revalidation

- **Status:** Live Backend and current Production bundle are correctly configured; remaining failure is isolated to a stale browser/PWA client using the pre-fix JavaScript bundle.
- **Actor:** Codex primary agent.
- **Objective:** Revalidate the reported missing `Access-Control-Allow-Origin` response on the Production profile request after the Preview-to-Production promotion.

### Files and components changed

- Appended this diagnostic record to `log.md` only.
- No Frontend source, Backend source, ignored runtime environment, Supabase setting, ngrok configuration, or database component required modification.

### Implementation rationale

- A standard browser request without the ngrok bypass header is intercepted at the ngrok edge and receives an HTML warning response before FastAPI can add CORS headers.
- The currently published Production JavaScript contains both the current API origin and the scoped ngrok bypass header logic. The current Backend also permits the exact Production origin and bypass header.
- Sanitized local tunnel inspection showed older Production preflights requesting only Authorization, while the current bundle's preflight requests Authorization plus the ngrok bypass header. This distinguishes a stale PWA client from a current server configuration error.

### Security and privacy impact

- Exact-origin CORS, credential-aware requests, Trusted Host enforcement, loopback Backend binding, and JWT validation remain unchanged.
- No wildcard origin, authentication bypass, secret, raw authorization value, email address, profile payload, student record, private URL, image, or biometric data was introduced or logged.

### Database and deployment impact

- No Supabase Auth configuration, schema, row, RLS policy, Storage object, migration, or deployment setting was changed.
- No new Vercel deployment or Docker recreation is required for the validated server-side configuration. A stale client must activate the already published service worker and hashed application bundle.

### Verification performed

- Confirmed local `main` and remote `main` point to the same promoted revision.
- Confirmed Backend and OCR containers are healthy and the active tunnel forwards to the loopback Backend.
- Confirmed the running Backend allowlist contains both exact Preview and Production origins.
- Browser-equivalent Production preflight requesting Authorization and the ngrok bypass header returned HTTP 200 with the exact allow-origin response.
- Browser-equivalent Production GET with the bypass header reached FastAPI and returned the expected JSON authentication boundary plus exact CORS headers; the same request without the bypass reproduced the ngrok HTML interstitial.
- Confirmed the current Production HTML references the newest hashed JavaScript bundle and that bundle contains the scoped bypass logic and current API origin.
- Reviewed the current Supabase Auth session documentation and changelog; no applicable hosted Auth breaking change explains this transport-level failure.

### Remaining risks and handoff work

- Close all tabs for the Production site, unregister its service worker or clear that site's cached data, reopen it, and sign in again so the current bundle controls the page.
- If a fresh private window still fails, capture the failing request's `Access-Control-Request-Headers`, response status, and response content type without exposing the Authorization value; those fields will identify whether the request reached FastAPI or was intercepted at the tunnel edge.
- Replace the free development tunnel with a stable Production ingress to remove dependence on provider-specific browser interstitial behavior.

## 2026-09-10 — End-to-End Deployment Runbook Summary

- **Status:** Current deployment workflow, incident fixes, release promotion, hosting operations, and remaining Production gaps were consolidated for user handoff.
- **Actor:** Codex primary agent.
- **Objective:** Provide a repeatable start-to-finish deployment procedure covering local build verification, Docker Backend/OCR staging, public ingress, Supabase Google OAuth, Vercel Preview and Production, CORS repair, PWA cache recovery, monitoring, and rollback.

### Files and components changed

- Appended this documentation handoff record to `log.md` only.
- No application source, environment file, container, tunnel, Supabase setting, database object, Git branch, or hosting configuration was changed.

### Implementation rationale

- The handoff distinguishes Vite build-time variables from Backend runtime variables and separates the accepted `demo3.1` Preview workflow from the `main` Production promotion path.
- It also distinguishes the currently public workstation/ngrok staging runtime from a durable Production backend, so temporary reachability is not mistaken for 24/7 hosting readiness.

### Security and privacy impact

- The runbook uses placeholders for secrets, retains exact-origin CORS, loopback-only published service ports, private OCR networking, server-side token validation, and restricted Supabase redirect guidance.
- No secret, token, email address, student record, private URL, image, or biometric data was written to this log.

### Database and deployment impact

- No Supabase Auth, schema, row, RLS policy, Storage object, migration, Vercel deployment, Docker runtime, or public endpoint was changed.
- Current health and cross-origin preflight were rechecked read-only before preparing the handoff.

### Verification performed

- Confirmed the local Backend and OCR containers are healthy, Backend readiness reports database/OCR/face dependencies ready, and the public Production-origin preflight returns HTTP 200 with the exact CORS origin and required ngrok bypass header allowance.
- Re-read the repository deployment guides, Docker Compose file, Vercel SPA configuration, environment templates, release verification script, release-bundle script, and Production preflight validator.
- Reviewed current official Vercel Git/environment, Supabase redirect/Google OAuth, Docker Compose health dependency, and ngrok lifecycle documentation; no applicable hosted Supabase Auth change alters this deployment procedure.

### Remaining risks and handoff work

- The Docker Compose stack currently in use is explicitly Staging and the public API depends on a powered-on development workstation plus a running ngrok agent.
- A durable final Production backend still requires an always-on host, stable reviewed HTTPS ingress, separate Production secrets/data, monitoring, backup/restore, load tests, and closure of the previously recorded migration and biometric-model licensing gates.

## 2026-09-12 — English Project Overview and Improvement Plan

- **Status:** Completed a repository-evidenced project overview, role/responsibility matrix, deployment assessment, and prioritized production improvement plan.
- **Actor:** Codex primary agent.
- **Objective:** Produce an English Markdown handoff that explains what the complete attendance system does, what each human and service role may do, which security controls already exist, and what must still be improved for performance, reliability, security, privacy, and production readiness.

### Files and components changed

- Added `docs/PROJECT_OVERVIEW_AND_IMPROVEMENT_PLAN.md`.
- Appended this audit-safe work record to `log.md`.
- Reviewed the React/PWA route and feature inventory, FastAPI authorization and role guards, Light OCR queue/security configuration, face/liveness services, Supabase migrations, test inventory, launch scripts, Docker staging topology, deployment guides, and recent operational handoff records.
- No application source, threshold, dependency, environment file, database object, migration, container, hosting setting, or remote Git reference was modified.

### Implementation rationale

- The overview separates functionality present in source code from functionality proven in a deployed environment so that broad feature coverage is not mistaken for completed Production acceptance.
- It documents anonymous, student, teacher, temporary-administrator, permanent-administrator, Backend, OCR, and database-function responsibilities, including permanent-admin-only restrictions that are enforced in Backend code.
- Remaining work is ordered as release blockers, performance/scalability, security/privacy/fraud resistance, and quality/maintainability, with concrete actions and exit criteria for the highest-priority items.
- The recommended order prioritizes database consistency, durable Backend hosting, authentication hardening, biometric calibration, backup/restore, and measured 30–40-user capacity before additional non-essential UI work.

### Security and privacy impact

- The new document records security architecture, residual biometric/NFC risks, RLS and authorization expectations, data-minimization needs, and privacy/retention work without disclosing operational credentials or personal records.
- No secret, token value, PIN, email address, student record, private endpoint, raw biometric data, image, embedding, or attachment content was added.
- The review explicitly warns that RGB-camera liveness is not impossible to spoof or independently certified and that face embeddings remain sensitive biometric templates even when attendance photographs are not retained.

### Database and deployment impact

- No Supabase write was performed.
- A read-only release check found no database lint errors and no Performance Advisor findings, but retained the Security Advisor warning that leaked-password protection is disabled.
- The review recorded three local/remote migration timestamp mismatches and the remote absence of local secure face-enrollment migration `20260907164433_secure_face_enrollment_liveness.sql`; this is classified as a release blocker requiring staged reconciliation rather than an unreviewed migration-history mutation.
- The document records that the current workstation/tunnel Backend is appropriate for staging verification but must be replaced by the intended always-on Ubuntu Server Mini PC with stable HTTPS before Production acceptance.

### Verification performed

- `git diff --check` completed successfully with exit code 0 before this log append.
- The generated overview contains 552 lines and 4,730 words with all expected top-level and priority sections present.
- Every repository-relative Markdown link in the new document resolved to an existing file; the local-link check completed with exit code 0 and no broken-link output.
- A credential-pattern review found only explanatory uses of the words access token and service role; it found no assignments, JWT-like values, or embedded secrets.
- Re-read the current official Supabase production checklist, Auth session, JWT/signing-key, MFA, and Database Advisor guidance and linked those references in the overview.
- Re-ran `git diff --check` after this log append; it completed successfully with exit code 0. Final Git status showed only the new overview and this expected `log.md` modification.

### Remaining risks and handoff work

- Review the new overview and this log entry before committing them.
- An authorized operator still must reconcile and apply Supabase migrations in staging, close the Auth warning/MFA policy, deploy the permanent Mini PC Backend, calibrate biometric behavior on real devices, and execute representative 30–40-user burst and soak tests.
- Local `main` was two commits ahead of `origin/main` at the start of this task; review and intentionally push all desired local commits rather than assuming remote Production contains this documentation.

## 2026-09-12 — Real-device Navigation, Passive Face Verification, and Admin Usability

- **Status:** Implemented and verified locally; the staging Backend runtime and the required Supabase face-enrollment objects were updated. Frontend source is ready for a deliberate Preview deployment but was not pushed or deployed by this task.
- **Actor:** Codex primary agent.
- **Objective:** Address the real-phone findings for student, teacher, and administrator navigation; add browser/PWA pull-to-refresh and persistent desktop sidebar controls; simplify Dynamic QR attendance to passive face verification only; repair student face enrollment; derive academic year from the student identifier; and improve student history plus administrator report, course, and log discovery.

### Files and components changed

- Added shared navigation and layout utilities: `AppBackButton`, `usePullToRefresh`, `PullToRefreshIndicator`, and `useDesktopSidebar`.
- Updated student, teacher, and administrator layouts with visible back navigation. All three authenticated role shells now use a defined scroll owner and expose pull-to-refresh; teacher and administrator desktop sidebars now persist click-to-collapse state and temporarily expand on fine-pointer hover while retaining the mobile drawer.
- Reworked the student Dynamic QR attendance path, liveness scanner, API client contract, and QR contract to protocol v3 passive capture. Attendance now submits three transient face samples only and no longer requests or submits a student-card image after QR validation. The front-camera preview is mirrored while server-bound frames remain camera-native.
- Reworked Backend liveness token/evidence validation and frame verification for an account-bound, expiring passive challenge, bounded sample timing, one-face and frontal checks, identity continuity, duplicate-frame resistance, local MiniFAS passive presentation-attack detection, and final face-template comparison.
- Updated student enrollment to offer separate camera-capture and existing-image choices for the student card before passive face enrollment, while retaining the verified card in memory for a challenge retry instead of asking for another upload.
- Changed the student profile to display a read-only academic year derived from the two-digit Buddhist admission year in a valid 13-digit student identifier; the student profile update endpoint now rejects manual academic-year overrides. Added a profile logout action.
- Rebuilt student attendance history as a searchable course list with a dedicated per-course detail route, summary counts, check-in timestamps, status, and method.
- Added administrator course search across code, name, instructor, and section; administrator log search across operator, action, target, details, and formatted date; and list/table report display with instructor attribution in the UI and generated files.
- Corrected the teacher live-feed face-method copy so it no longer claims that a student card was used for attendance.
- Updated `DESIGN.md` and `UX-CONTRACT.md` to record the cross-role navigation behavior, passive protocol, no-card attendance contract, read-only derived academic year, and RGB-camera PAD limitation.
- Updated Backend authorization, liveness, frame, and enrollment regression tests and the Frontend liveness contract test.

### Implementation rationale

- Shared layout-level navigation and refresh behavior keeps the three role experiences consistent and avoids duplicating touch gesture listeners across individual pages.
- Sidebar preference is persisted locally but hover expansion is limited to devices reporting a fine pointer, preventing sticky hover behavior on touch phones and tablets.
- Removing card OCR from post-QR attendance reduces user friction and eliminates repeated identity-document processing; the authenticated account, one-use QR claim, registered face template, signed passive evidence, same-person continuity, duplicate-frame check, and server-side PAD remain the attendance controls.
- Student-card OCR remains only in initial self-enrollment because it binds the first face template to the authoritative student identifier. Separate capture and gallery inputs make the mobile choice explicit.
- Academic year is computed on the Backend so a student cannot manipulate it through the UI or direct API calls. Invalid or implausible identifiers return no derived year rather than accepting user input.

### Security and privacy impact

- Attendance no longer transmits a student-card image. Passive face frames are validated in request memory and are not intentionally persisted or logged; the existing face embedding remains sensitive biometric data and must retain its current access restrictions and retention governance.
- Passive RGB presentation-attack detection reduces common printed-photo, replay-screen, duplicate-frame, face-swap, and multi-face attempts but is not impossible to spoof and is not represented as certified liveness assurance.
- Liveness tokens remain HMAC-signed, account/challenge-bound, short-lived, canonical-encoded, and protected by a database-backed one-use claim. Backend timing and image checks do not trust browser evidence alone.
- The face-enrollment table has RLS enabled; anonymous and authenticated roles have no direct table/function access, while the server service role has only the privileges required by the enrollment flow.
- No credential, token, private endpoint, student record, attachment content, raw image, embedding, or other personal data was added to this log.

### Database and deployment impact

- Diagnosed the reported enrollment failure as the remote database missing local migration `20260907164433_secure_face_enrollment_liveness.sql`; the failure occurred while preparing the one-use enrollment challenge, before card-image or camera analysis.
- Applied that idempotent migration through the authenticated Supabase SQL Editor, verified that the challenge table and required claim/finalize routines exist, and marked migration `20260907164433` applied in remote migration history.
- Supabase schema lint subsequently reported no schema errors. Three older local/remote timestamp pairs remain intentionally unreconciled because their schema equivalence was not established in this task.
- Rebuilt and recreated the Docker Compose staging Backend runtime on the development workstation. Compose also recreated its OCR dependency; both services returned healthy. No database row, stored face template, user account, Vercel setting, Git remote, or Production frontend deployment was modified.
- Existing CORS configuration was preserved. Read-only preflight checks for both configured hosted frontend origins returned HTTP 200 and echoed the exact requesting origin.

### Verification performed

- Frontend TypeScript build and ESLint completed with exit code 0 using Node.js 24.19.0.
- Frontend production Vite/PWA build completed successfully: 1,905 modules transformed and 67 service-worker precache entries generated.
- Frontend card-image sizing, spreadsheet export security, passive scanner contract, face-runtime, and API-origin tests all passed. The scanner contract specifically verifies three passive samples, mirrored front preview, and absence of the attendance card-upload field.
- Backend Docker test discovery completed with 90 tests passing and no failures or errors, including passive PAD invocation, still-frame rejection, out-of-frame rejection, one-use challenge, authorization, upload, and profile-year regressions.
- `scripts/verify_face_models.sh` verified all three required InsightFace model files. `pip check` found no broken Backend requirements.
- Frontend and OCR dependency audits reported zero vulnerabilities at the configured moderate threshold. OCR environment-isolation tests passed; OCR doctor found the released native runtime, while its host-side optional model-module flag remained false and the running container readiness check remained healthy.
- The strict frontend design audit reported zero findings, errors, warnings, or unresolved violations.
- Supabase schema lint reported no schema errors. Migration listing showed the repaired face-enrollment migration aligned locally and remotely while retaining the three pre-existing mismatched timestamp pairs.
- Staging `/health/live` returned status `ok`; `/health/ready` returned database, OCR, and face dependencies `ok`. Final `git diff --check` completed with exit code 0 before this log append.

### Remaining risks and handoff work

- Deploy the Frontend changes to the `demo3.1` Preview environment, clear/update the PWA service worker on test phones, and repeat real-device acceptance across iOS Safari/PWA and Android Chrome/PWA. This task did not push, commit, or trigger a Vercel deployment.
- Calibrate passive PAD and face-match thresholds against an authorized representative device/lighting dataset. Provide a supervised fallback because RGB-only passive liveness can reject genuine users or accept sophisticated presentation attacks.
- Confirm the institutional academic-year rollover rule. The implemented rule derives the year from the first two digits of a valid 13-digit identifier and the current Buddhist calendar year, capped at years 1–8; a semester-boundary rule can be added if the institution defines one.
- Reconcile the three older migration timestamp pairs only after comparing their SQL/schema effects; do not use broad migration repair or an unrestricted database push without that review.
- Review the working tree before committing. The pre-existing untracked `start_mobile_test.sh` was deliberately left untouched.

## 2026-09-12 — Reconciled Three Supabase Migration Timestamp Pairs

- **Status:** Completed. Local and remote migration history now align for every repository migration, and the remote schema remains unchanged and up to date.
- **Actor:** Codex primary agent.
- **Objective:** Resolve the three previously documented local/remote migration timestamp mismatches without replaying schema changes or modifying application data.

### Files and components changed

- Appended this audit record to `log.md` only.
- Reconciled the Supabase migration-history entries for the face-attendance finalization, processing-lease claim/release, and claim-renewal migrations.
- No migration SQL file, application source file, environment file, container definition, or generated schema file was modified.

### Implementation rationale

- A fresh read-only dump of the remote `public` schema confirmed that `attendance_checkin_challenges` contains both processing-lease columns and that the current `claim_face_attendance_challenge`, `release_face_attendance_challenge`, seven-argument `finalize_face_attendance`, and `renew_face_attendance_challenge` function bodies canonically match the final definitions in the three local migration files.
- The remote-only timestamps were created minutes after their corresponding local timestamps and represented schema changes already present in the database. The repair therefore removed only the obsolete remote history labels and marked the repository timestamps applied; it did not execute DDL again.
- The previous migration-list snapshot was retained only in a temporary local directory for rollback evidence during the operation and was not added to the repository.

### Security and privacy impact

- The verification confirmed that the attendance claim/finalize functions remain `SECURITY INVOKER`, are revoked from `PUBLIC`, and are granted to the Backend service role.
- No table row, attendance record, account, credential, private endpoint, student record, face image, embedding, or other personal data was read into the project log or changed by the history repair.
- The existing Supabase Security Advisor warning that leaked-password protection is disabled remains. It is unrelated to migration history and was not changed without a separate authentication-policy decision.

### Database and deployment impact

- Marked the three obsolete remote-only migration versions as reverted in Supabase migration history.
- Marked local migrations `20260902065653`, `20260902072732`, and `20260902150753` as applied in Supabase migration history.
- The schema and application data were not altered. No Git push, Vercel deployment, Docker rebuild, or service restart was required.

### Verification performed

- Fetched and reviewed the current Supabase changelog; no relevant migration-repair breaking change applied. Supabase CLI version 2.117.0 and current `migration repair`, `db dump`, and `db advisors` help were consulted before mutation.
- `supabase db dump --linked --schema public` completed successfully. Programmatic whitespace-normalized comparisons reported exact matches for all four current function bodies: claim, release, seven-argument finalize, and renew.
- The post-repair migration list showed every local timestamp paired with the same remote timestamp and no local-only or remote-only entries.
- `supabase db push --dry-run` returned `upToDate: true` with no migrations, seeds, or roles pending.
- `supabase db lint --linked --level warning` reported no schema errors.
- Supabase Performance Advisor reported no issues. Security Advisor reported only the pre-existing leaked-password-protection warning.
- The staging Backend readiness endpoint reported database, OCR, and face dependencies ready.
- `git diff --check` completed with exit code 0 before this log append.

### Remaining risks and handoff work

- Review and enable Supabase leaked-password protection if password authentication is or will be permitted; Google-only sign-in reduces but does not automatically remove the need to define that policy.
- Preserve the canonical repository timestamps in future deployments. Do not recreate the three removed remote-only history labels.
- Review the existing application working tree and this log entry before committing; unrelated user work and the pre-existing untracked mobile-test script remain untouched.

## 2026-09-12 — Production Promotion Gate for `demo3.1` into `main`

- **Status:** Merge conflict resolved and release gates passed; the authorized non-force push to `origin/main` is the next immediate operation after creating the merge commit.
- **Actor:** Codex primary agent.
- **Objective:** Promote the complete accepted `demo3.1` application state into `main` for the Git-connected Production deployment while preserving the commits and documentation that already exist only on `main`.

### Files and components changed

- Merged the two `demo3.1` commits containing the real-device navigation, passive liveness, student workflow, administrator discovery/reporting, tests, design contracts, and engineering logs into the current `main` history.
- Preserved the existing `main`-only deployment and project-overview commits through a normal two-parent merge; no history rewrite, squash, reset, or force update was used.
- Resolved the sole `log.md` conflict by retaining its common history and appending both `demo3.1` engineering entries. No earlier log entry was deleted or rewritten.
- The tracked mobile-test launcher deletion follows the accepted `demo3.1` branch state. A pre-existing user-local copy is preserved outside the merge commit as untracked workspace material and is not part of Production source.

### Implementation rationale

- A normal merge is required because `main` and `demo3.1` both contain unique commits. Replacing `main` with the branch tip would discard Production deployment documentation and violate the no-history-rewrite requirement.
- Resolving the append-only log conflict as a union preserves both agents' audit history while leaving all application files exactly at the accepted `demo3.1` versions.
- Fetching the remote immediately before promotion confirmed that `origin/main` still equals the local pre-merge `main`, so a standard push remains fast-forward from the remote perspective after the merge commit.

### Security and privacy impact

- The promoted application retains exact-origin CORS, server-side authorization, account-bound one-use passive liveness challenges, transient face-frame handling, restricted biometric-template access, spreadsheet export sanitization, and isolated OCR credentials.
- The merge and release checks did not print, persist, or modify credentials, private endpoints, student records, raw images, face embeddings, or other personal data.
- Passive RGB liveness remains a risk-reduction control rather than certified or impossible-to-spoof proof; Production acceptance still requires representative real-device calibration and a supervised fallback.

### Database and deployment impact

- `main` is the Production branch for the connected frontend hosting project, so pushing the merge commit is expected to trigger a Production frontend deployment.
- No database DDL or data mutation was required during this promotion. Supabase migration history was already reconciled, and a fresh dry run reported that the remote database is up to date with no migrations, seeds, or roles pending.
- The Backend/OCR staging services continue to run on the development workstation. Frontend Production availability therefore does not make the Backend independent of workstation power or the configured public tunnel.

### Verification performed

- Fetched `origin` immediately before promotion and confirmed local `HEAD` matched `origin/main`; the merge target was the current `demo3.1` tip already matching `origin/demo3.1`.
- Frontend TypeScript compilation, ESLint, card-image sizing, spreadsheet security, passive-liveness contract, face-runtime contract, API-origin contract, and Vite/PWA Production build all passed. The build transformed 1,905 modules and generated 67 service-worker precache entries.
- Backend Docker test discovery completed with 90 tests passing and no failures or errors.
- Frontend and OCR dependency audits reported zero vulnerabilities at the configured moderate threshold. OCR environment-isolation tests passed and OCR doctor reported the released native runtime available.
- The strict frontend design audit reported zero findings, warnings, or errors.
- `supabase db push --dry-run` returned up to date with no pending database operations.
- The staging Backend readiness endpoint reported database, OCR, and face dependencies ready.
- Repository conflict-marker search returned no matches, and `git diff --check` completed with exit code 0 before this log append.

### Remaining risks and handoff work

- Confirm the Git push succeeds and monitor the hosting provider's Production deployment until it reaches Ready; if the provider fails, inspect its build log rather than rewriting Git history.
- After deployment, test the Production URL in a private browser window and on installed iOS/Android PWAs. Reload or reinstall the PWA if an older service worker keeps the previous frontend bundle.
- Keep the development workstation, Docker Backend/OCR services, and public tunnel running for the current architecture; move the Backend to an always-on host before claiming 24/7 Production availability.
- The existing Supabase Auth warning for leaked-password protection remains a separate policy decision.

## 2026-09-13 — Persistent Teacher Attendance Workspace, Presentation Mode, and Responsive Admin Discovery

- **Status:** Completed in the working tree; implementation and proportional checks passed. No commit, push, database migration, container restart, or hosting deployment was performed.
- **Actor:** Codex primary agent.
- **Objective:** Keep a teacher-owned attendance session available across route changes until it is explicitly closed, add fullscreen presentation controls for Dynamic QR and class-code panels, retain the active support-request workspace across navigation, add administrator report search, and make Audit Log output responsive.

### Files and components changed

- Added `TeacherAttendanceProvider` and its context contract, mounted above the Teacher route shell, and updated `TeacherDashboard`/`TeacherLayout` to use the shared server-backed session state and persistent active-session indicator.
- Added a Backend active-session query service and authenticated recovery endpoint; the session-start endpoint now rejects a second open session for the same caller and returns safe course/session metadata.
- Added the shared `usePresentationMode` hook and applied it to the Dynamic QR panel and class-code panel, including native Fullscreen API support, an app-owned viewport fallback, Escape handling, accessible pressed states, and explicit exit controls.
- Added `SupportWorkspaceProvider` above Student and Teacher route shells. The selected request and unsent reply draft, including in-memory file objects and the idempotency token, survive child-route changes and clear after a successful send or provider unmount.
- Added administrator Export filtering for course code, course name, and instructor name with a URL-restorable query, clear action, result count, and no-results state.
- Reworked Audit Log output to use responsive cards below the wide-desktop breakpoint and a bounded fixed-layout table above it; long actions, targets, and detail values now wrap without expanding the page shell.
- Updated `DESIGN.md`, `UX-CONTRACT.md`, and the runtime presentation z-index token to record the durable session, request-draft, fullscreen, and responsive behavior.
- Added focused Backend unit coverage for active-session filtering, newest-row limiting, course metadata serialization, and QR-token non-disclosure.

### Implementation rationale

- The former attendance identifiers and QR/NFC panel flags were owned by `TeacherDashboard`, so normal React route unmounting discarded them. The provider now survives Teacher child-route changes, while a fresh Backend lookup rehydrates the state after a page reload or tab visibility change.
- Backend state remains authoritative. Browser state never decides whether a session is open, and closing the QR/NFC window only hides the tool; only the explicit close-session mutation changes the stored session status.
- A shared presentation hook avoids divergent fullscreen implementations and supplies a CSS fallback for browsers that do not expose element fullscreen, including affected mobile Safari versions.
- Support reply state is retained only in memory rather than browser persistence because drafts and attachments can contain personal or academic information. This preserves same-login navigation without leaving message content in local storage.
- Export search is local because the existing administrator course endpoint already returns the bounded dataset used by both card and table views. The query is encoded in the route so refresh/back navigation remains predictable.
- Audit Log keeps the existing Backend cap of the newest 100 records, changes to a one-dimensional card layout on constrained widths, and reserves horizontal scrolling only for the genuine wide table.

### Security and privacy impact

- The active-session recovery query is filtered by the authenticated caller's identifier and returns only the session identifier plus non-secret course metadata. It does not return or persist the Dynamic QR token.
- The existing server authorization remains in force for course ownership, token rotation, NFC writes, and session closure. Permanent administrators retain the pre-existing operational override; no client-side context broadens permissions.
- Starting a second open session for the same caller is rejected by the API, reducing accidental parallel sessions after navigation or reload. No database uniqueness constraint was added, so extreme concurrent start requests remain a residual race noted below.
- Support drafts and selected-request state are cleared when the role-scoped provider unmounts; no message text, attachment, student record, credential, private endpoint, or token was written to project logs or persistent browser storage.
- Audit details continue to render as text through React, and long untrusted values are wrapped rather than interpreted as markup.

### Database and deployment impact

- No schema or RLS change is required. The implementation reads existing `attendance_sessions` and `courses` rows through the authenticated Backend boundary.
- Backend deployment must precede or accompany Frontend deployment because the new Frontend provider calls the new active-session endpoint. Deploying only the Frontend would show the recoverable session-check error and keep start controls disabled until the Backend is updated.
- Existing open sessions are not auto-closed, modified, or migrated. No Production or Preview deployment was triggered in this task.

### Verification performed

- Frontend ESLint completed with exit code 0 after the final source changes.
- Frontend TypeScript compilation and Vite/PWA Production build completed with exit code 0; 1,910 modules were transformed and 68 service-worker precache entries were generated.
- Frontend card-image sizing, spreadsheet export security, passive-liveness, face-runtime, and API-origin contract scripts all passed.
- Backend Docker test discovery completed with 92 tests passing and no failures or errors. The focused active-session service rerun completed with 2 tests passing.
- The strict frontend design audit completed with zero findings, warnings, errors, or unresolved violations.
- The built application booted successfully in a local in-app browser at the unauthenticated screen with no console warnings or errors. Authenticated Teacher/Admin visual acceptance was not performed because no test credential was entered.
- Current official Supabase Python query documentation confirms the used descending `order` and `limit(1)` modifiers. The current changelog showed no relevant breaking change for this query; the 2026 transient GET retry change does not alter its contract.
- `git diff --check` completed with exit code 0 before this log append.

### Remaining risks and handoff work

- Exercise the authenticated Teacher workflow on desktop projector, iOS Safari/PWA, and Android Chrome/PWA: open a session, switch among Teacher routes, return through the persistent indicator, expand/exit both presentation surfaces, and explicitly close the session.
- Exercise support navigation with an unsent text/file reply. Browser security intentionally prevents restoring selected files after a full page reload; the provider guarantees only in-app route changes during the current authenticated role session.
- The API pre-check prevents normal duplicate open sessions but is not an atomic database guarantee. If simultaneous start requests from multiple tabs must be impossible, add a reviewed partial unique index or transactional database function after resolving how any legacy duplicate-open rows should be handled.
- Deploy Backend and Frontend together, then verify the hosting service worker is serving the new bundle. Review the working tree and this entry before committing or pushing.

## 2026-09-13 — Removed Pull-to-Refresh, Rebuilt the Student QR Scanner, and Documented Supabase Architecture

- **Status:** Completed in the working tree. Frontend implementation, documentation, static audit, production build, browser inspection, and proportional automated tests passed. No commit, push, database mutation, container restart, or hosting deployment was performed.
- **Actor:** Codex primary agent.
- **Objective:** Remove the custom Pull-to-Refresh feature from every role shell, normalize Student layouts across phone sizes, replace the Student classroom QR experience with a full-viewport rear-camera scanner, and provide a detailed Thai guide to the Backend, database, and Supabase implementation.

### Files and components changed

- Deleted the shared `PullToRefreshIndicator` and `usePullToRefresh` implementation and removed their gesture handlers, refresh indicators, reload behavior, refs, and overscroll containment from the Student, Teacher, and Admin layouts.
- Added shared Student viewport/page spacing tokens in `frontend/src/index.css`, raised application chrome onto the documented layer scale, widened the balanced Student shell cap to 480 CSS pixels, retained a single content scroller, and added a reduced-motion-aware QR scan line.
- Applied the shared responsive Student page container to the home, attendance history, courses, profile, registration, and request screens so 320–480 CSS-pixel phones use consistent clamped spacing, safe-area handling, and no fixed desktop transformation.
- Rebuilt `QRScanner` as an accessible full-viewport dialog using the rear camera, QR-only decoding, a bank-style finder, verification/success/failure states, camera-specific recovery messages, request/timer cancellation, body scroll locking, Escape/Back support, focus containment, and trigger-focus restoration.
- Redesigned the Student check-in entry card in `StudentHome` with a prominent camera action and retained the existing server contract and QR-to-passive-face flow. Removed the obsolete pull-refresh opt-out attribute from the face scanner.
- Added `docs/BACKEND_DATABASE_SUPABASE_GUIDE_TH.md`, covering system boundaries, authentication, authorization, configuration, Dynamic QR and passive face flows, all 18 public tables, RLS/RPC/trigger/storage behavior, API groups, migrations, Dashboard/code inspection, Docker staging, CORS, deployment dependencies, security considerations, and release checks.
- Reconciled `DESIGN.md` and `UX-CONTRACT.md` with the new Student shell/scanner behavior, no-interception refresh policy, current layer mapping, derived read-only academic year, and the canonical roster migration timestamp.
- Preserved the unrelated existing Teacher session, support workspace, Admin reporting, Backend authorization, and other user changes already present in the dirty working tree.

### Implementation rationale

- The removed gesture layer intercepted touch movement and forced a full document reload after a downward drag. Native browser/PWA behavior and explicit screen-level retry controls are more predictable and do not discard in-memory work unexpectedly.
- A shared `student-page` owner prevents each Student screen from choosing slightly different hard-coded padding and widths. Clamp-based spacing and a 480-pixel shell cap provide a stable middle-ground layout across narrow and large phones without turning Student screens into desktop pages.
- The previous QR reader was embedded in a small card and gave no reliable camera-permission recovery. The new dialog dedicates the viewport to aiming, pauses decoding during validation, avoids repeated requests, and keeps error actions reachable on short displays.
- Backend validation remains authoritative: the visual redesign does not weaken current-session token checks, course enrollment checks, one-use challenge issuance, Passive PAD, face matching, or atomic attendance finalization.
- The architecture guide is based on repository migrations and a read-only inspection of the linked Supabase schema rather than inferred sample data, and it deliberately omits project identifiers, credentials, row contents, row counts, biometric values, and private endpoints.

### Security and privacy impact

- The QR dialog aborts an in-flight validation request and clears transition timers when it closes or unmounts, reducing stale state changes and accidental continuation after navigation.
- QR contents remain transient; the scanner does not persist camera frames, QR tokens, Supabase access tokens, or course data. The existing face flow continues to send only bounded transient evidence to the authenticated Backend.
- The guide explicitly separates browser-safe publishable configuration from server-only privileged configuration and records the current Supabase legacy-key transition without exposing any actual value.
- Read-only Supabase inspection confirmed that all 18 public tables have RLS enabled and that the support attachment bucket is private. No database row, Auth user, Storage object, student record, raw camera image, face embedding, key, or environment value was modified or copied into project documentation.

### Database and deployment impact

- No SQL migration, schema, RLS policy, function, trigger, data row, Auth setting, Storage object, Vercel setting, Docker runtime, or public tunnel was changed.
- The linked migration listing showed all 19 repository migrations aligned with the remote history. This was a read-only verification.
- The frontend change is ready to be deployed but has not been deployed. Camera access still requires HTTPS or localhost, and a cross-origin Backend still requires the exact deployed Frontend origin in CORS plus the API hostname in Trusted Hosts.
- Removing custom Pull-to-Refresh does not alter service-worker cache policy or API caching; the PWA continues to avoid caching attendance API responses.

### Verification performed

- Frontend ESLint completed with exit code 0.
- Frontend TypeScript compilation and Vite/PWA production build completed with exit code 0 under Node.js 22.23.2; 1,908 modules were transformed and 69 service-worker precache entries were generated. An initial shell invocation under system Node.js 18.19.1 correctly failed the Vite engine requirement before rerunning with the documented supported runtime.
- Frontend card-image sizing, spreadsheet export security, API-origin, passive-liveness, and face-runtime contract scripts all passed. The liveness contract confirmed three passive frames, mirrored front-camera preview, and no attendance-time card upload.
- Backend unit discovery, run from the required `backend` working directory, completed with 92 tests passing and no failures or errors. An earlier root-directory invocation could not resolve the Backend's top-level `core`/`services` modules; no application defect was involved, and the correctly scoped command passed.
- The strict premium frontend audit returned zero findings, errors, warnings, unresolved items, or violations.
- Official `DESIGN.md` lint completed with zero errors; it reported five pre-existing orphan-token warnings and one informational token summary.
- A temporary isolated QA harness rendered the real `QRScanner` in the in-app browser at a 320×568 CSS-pixel viewport. The scanner occupied the viewport, the rear-camera surface rendered, the finder/instructions remained within bounds, and initial focus landed on the labeled Back control. The viewport override was reset and both temporary source files and the development server were removed/stopped afterward.
- Pull-to-refresh implementation and opt-out symbol search returned no matches in `frontend/src`; the temporary QA files were absent; final `git diff --check` completed with exit code 0 before this log append.

### Remaining risks and handoff work

- Perform authenticated end-to-end acceptance on physical iOS Safari/PWA and Android Chrome/PWA with the real teacher-generated rotating QR. Test allow/deny camera, old QR, closed session, duplicate check-in, app switching, rotation, low light, network loss, and the transition into Passive Liveness.
- The in-app browser inspection validates responsive layout and camera-surface integration but does not replace physical-device safe-area, thermal, focus, camera-selection, or anti-spoof calibration testing.
- RGB Passive PAD and face similarity remain risk-reduction controls rather than a guarantee against every presentation attack. Calibrate thresholds on an authorized representative dataset and maintain a supervised fallback and biometric retention/deletion policy.
- Review the full dirty working tree before committing because it also contains valid changes from the preceding Teacher/Admin task. Deploy all interdependent Backend and Frontend changes together where required, then clear/update installed PWA service workers during acceptance.

## 2026-09-13 — Unified Weekly Attendance Export for Administrators and Teachers

- **Status:** Completed in the working tree. The shared Backend payload, browser export implementation, formula/style verification, production build, and regression tests passed. No commit, push, database mutation, container restart, or hosting deployment was performed.
- **Actor:** Codex primary agent.
- **Objective:** Replace the event-list attendance exports with one weekly roster report shared by Administrator and Teacher workflows, match the supplied register workbook structure, apply the required `1`, `/`, and `X` symbols, calculate attendance summaries against course criteria, and derive PDF output from the same canonical report model.

### Files and components changed

- Refactored `backend/services/attendance_export_service.py` to return an explicitly selected course configuration, instructor name, chronological attendance sessions with close state, enrolled roster, and session-linked attendance records in one canonical payload.
- Replaced the duplicate Administrator export query in `backend/routers/admin.py` with the shared export service while retaining the existing role-protected endpoint and preserving HTTP errors.
- Rebuilt `frontend/src/services/reportExport.ts` around a shared weekly report model used by Excel, CSV, and PDF. It creates one row per student, chronological week columns, symbol legend, course/instructor metadata, completed-session summaries, attendance percentage, and a criteria-based remark.
- Added `frontend/src/services/xlsxStyle.ts`, which applies the workbook typography, orange two-level headers, borders, score number format, frozen panes, landscape print setup, and forced formula recalculation to the browser-generated XLSX package.
- Updated Administrator and Teacher report screens, plus the Teacher attendance-history dialog, to request and export the same complete payload. The Teacher dialog now offers Excel, CSV, and PDF instead of maintaining a separate legacy Excel-only implementation.
- Added the exact-pinned zero-dependency `fflate` package and lockfile entry for safe in-browser XLSX package styling. An evaluated Excel library with a vulnerable transitive dependency was removed before implementation and is not present in the final dependency graph.
- Added `backend/tests/test_attendance_export_service.py` and `frontend/scripts/test-report-export.mts` for the canonical query contract, roster ordering, weekly symbol rules, closed/open session behavior, summary math, identifier formatting, spreadsheet-formula injection defense, XLSX styles/freeze/print metadata, and PDF document structure.
- Added `outputs/attendance-export-redesign/attendance-report-sample.xlsx`, containing synthetic example data only, as the visually verified acceptance sample based on the supplied workbook layout.

### Implementation rationale

- A weekly pivot cannot be reconstructed reliably from the former records-only response because it lacks enrolled students with no check-in and lacks closed sessions whose missing records must be classified as absences. Returning roster, sessions, records, and course rules together makes the report deterministic for both roles.
- A successful `present` record is written as numeric `1`; a stored `late` record is written as `/`; an explicit absence or a missing record in a closed session is written as `X`. Missing records in open sessions and future configured weeks remain blank so incomplete sessions are not prematurely counted as absences.
- Summary calculations include only closed sessions. Attendance percentage is `(present + late) / closed sessions * 100`; late attendance counts as attended because the current course schema has no late-deduction weight. The report states this rule instead of inventing an undocumented penalty.
- The allowed absence count is the floor of `planned weeks * max_absence_percent / 100`. The remark reports pass/fail against that stored course criterion, while also displaying present, late, absent, attended, and percentage columns separately.
- Excel stores live formulas and cached results, so the workbook opens with values immediately and recalculates when marks are edited. CSV contains the same metadata, legend, weekly columns, and computed values as flat text. PDF uses the same report model and two-level table rather than a separate calculation path.
- The existing SheetJS package preserves data and formulas but does not emit custom visual cell styles. Post-processing only the generated Open XML style and worksheet metadata keeps the audited existing spreadsheet writer, avoids a vulnerable spreadsheet dependency, and preserves browser-only download behavior.

### Security and privacy impact

- Existing server-side Administrator role checks and Teacher course-ownership checks remain authoritative. The shared service does not create a new public or client-direct Supabase data path.
- Course and student strings are passed through the existing spreadsheet-cell sanitizer before CSV/XLSX creation, including metadata and names, preventing leading formula characters from being interpreted as spreadsheet formulas. XLSX filenames are restricted to safe character classes.
- PDF font loading remains restricted to the current Frontend origin. No remote arbitrary font or document URL is permitted by the PDF generator.
- The acceptance workbook and automated fixtures use synthetic records only. No production student identifiers, names, attendance rows, credentials, private endpoints, access tokens, or biometric data were written to source, output artifacts, or this log.
- The new ZIP library is pinned exactly and has no transitive dependencies. The final Frontend dependency audit reported zero vulnerabilities at the moderate threshold.

### Database and deployment impact

- No SQL migration, schema change, RLS policy change, table data mutation, Auth change, or Storage operation was required. The implementation reads existing foreign-key relationships and existing course/session/attendance fields through the Backend's privileged database client after API authorization.
- A read-only aggregate verification against the linked Supabase project confirmed the four required course-report criteria columns and found no missing profile/session relationships in the queried course, enrollment, and attendance relationship checks. No row contents were retrieved or logged.
- Current Supabase changelog and official Python filtering/join documentation were reviewed; no relevant breaking change applies to the selected nested relations, `!inner` filter, ordering, or equality filters.
- Backend and Frontend should be deployed together because the Frontend now expects `course`, `students`, `sessions`, and `records` from both export endpoints. No Production or Preview deployment was triggered in this task.

### Verification performed

- The focused Frontend report-model test passed under the supported workspace Node runtime, including weekly ordering, `1`/`/`/`X` marks, closed-versus-open handling, percentage/remark calculations, formula-injection sanitization, generated XLSX style metadata, frozen panes, landscape page setup, and the shared PDF definition.
- The existing spreadsheet security test passed.
- Frontend ESLint completed with exit code 0.
- Frontend TypeScript compilation and Vite/PWA Production build completed with exit code 0 under Node.js 24.19.0; 1,910 modules were transformed and 68 service-worker precache entries were generated. The system Node.js 18 invocation failed only the documented Vite engine requirement before the supported runtime rerun passed.
- Frontend `npm audit --audit-level=moderate` reported zero vulnerabilities after installing the exact-pinned ZIP dependency.
- Full Backend unit discovery completed with 94 tests passing and no failures or errors, including the two new export-service tests.
- The runtime-generated XLSX was re-imported and inspected: the weekly values and formulas were intact, all inspected formula-error patterns returned zero matches, TH Sarabun New styles and orange headers were present, and visual rendering confirmed the table fit, borders, summary area, and 16-week layout.
- The synthetic acceptance workbook was recalculated, inspected, formula-error scanned with zero matches, and rendered for visual review before export. Only the final XLSX remains under `outputs/`.
- `git diff --check` completed with exit code 0 before this log append.

### Remaining risks and handoff work

- Perform an authenticated browser acceptance test as both Administrator and Teacher using a non-sensitive test course, download all three formats, and open Excel/PDF in the institution's supported desktop/mobile viewers. Browser download behavior and physical printer margins can vary by platform.
- Confirm the desired academic policy if late attendance should reduce the percentage or carry a custom weight. The database currently supplies only time thresholds and maximum absence percentage, so the implemented and documented rule counts late attendance as attended.
- If the institution needs excused absence, make-up classes, multiple sessions in one week, a separate attendance-grade weight, or a fixed calendar-week mapping, add explicit schema/business rules before changing report semantics; the current data contract supports only present, late, and absent session outcomes.
- Large rosters and unusually high configured session counts can make the browser-generated workbook/PDF wide or memory-intensive. The PDF automatically moves from A3 to A2 above 18 weeks, but representative high-volume acceptance remains necessary.
- Review and commit the complete working tree before deployment, then deploy Backend and Frontend together and clear/update installed PWA service workers during Production acceptance.

## 2026-09-14 — Documented and Templated the Vercel/Nginx/Docker Mini-PC Production Deployment

- **Status:** Completed and verified in the working tree. Documentation and production runtime templates are ready for operator review; no public deployment was performed.
- **Actor:** Codex primary agent.
- **Objective:** Provide a detailed Thai, step-by-step Production runbook from Git promotion and build verification through Vercel Frontend hosting, Supabase configuration, Mini-PC preparation, Nginx HTTPS ingress, Dockerized FastAPI/OCR operation, URL linkage, acceptance, monitoring, update, and rollback.

### Files and components changed

- Replaced `docs/HYBRID_VERCEL_MINIPC_DEPLOYMENT_TH.md` with a Production-focused runbook covering architecture, prerequisites, Git Preview-to-Production promotion, release tags, local verification, Supabase migrations/Auth/RLS, Ubuntu/Docker installation, external secret files, model provisioning, Docker Compose operation, DNS/NAT, ACME/TLS bootstrap, Nginx, Vercel import/environment/domain configuration, exact URL mappings, CORS diagnosis, acceptance tests, go-live ordering, updates, rollback, monitoring, backups, outage behavior, and security/privacy checks.
- Added `deployment/docker/compose.production.yml` for the FastAPI and Light OCR services. FastAPI is published only on host loopback; OCR remains internal to the Compose network; both services use non-root images, health checks, restart policies, resource limits, capability drops, no-new-privileges, bounded rotating logs, and externally stored environment files.
- Added `deployment/docker/production.compose.env.example` for release identity, exact Frontend origin allowlists, API hostname, model path, loopback binding, and conservative four-core/eight-gigabyte resource controls.
- Expanded `deployment/docker/README_TH.md` to distinguish the existing development Staging stack from the new Mini-PC Production stack and provide the safe Production command sequence.
- Updated `deployment/nginx/attendance-api-only.conf.example` so the HTTP site serves the ACME challenge path before redirecting other requests to HTTPS, enabling deterministic certificate issuance and renewal.

### Implementation rationale

- The former hybrid guide installed Backend/OCR directly as systemd services, which no longer matched the requested container runtime. The new design keeps host Nginx as the sole Internet-facing TLS boundary while Docker Compose owns FastAPI and OCR.
- Deployment secrets live under `/etc/km-attendance` instead of the repository or Docker build context. Compose topology values override CORS, trusted-host, service-discovery, and release metadata so the running network contract is explicit and reviewable.
- One canonical Frontend origin is recommended; multiple required Production origins can be listed explicitly without wildcard CORS. Preview is routed to separate Staging services to avoid exposing Production data to unreviewed builds.
- Image names include an immutable release identifier, and the runbook uses Git tags/detached checkouts so operators can identify and restore the exact application revision.
- Nginx does not duplicate CORS headers. FastAPI remains the single CORS owner, avoiding conflicting allow-origin responses while Nginx provides TLS, request/connection limits, upload limits, proxy headers, and loopback isolation.

### Security and privacy impact

- The templates do not contain credentials, private endpoints, student records, biometric data, or raw images. All example domains and keys are placeholders.
- Backend and OCR secrets are explicitly excluded from Vercel and Git; the runbook treats every `VITE_*` value as browser-visible and restricts the privileged Supabase key to the Backend environment.
- FastAPI binds to `127.0.0.1:8000`, OCR has no published host port, and the guide instructs operators never to expose ports 8000, 3001, or public SSH through the router.
- The guide retains exact HTTPS CORS origins, exact trusted hosts, Supabase RLS/advisor checks, server-side authorization, TLS renewal testing, restricted monitoring data, encrypted secret backup, and biometric/model-governance requirements.
- Current official Supabase documentation and the complete current changelog were reviewed. The runbook records the Node.js 20 client-library support removal and the upcoming all-project Data API table auto-exposure change without broadening existing table grants.

### Database and deployment impact

- No Supabase Auth setting, migration, schema, RLS policy, Storage object, database row, Vercel project, DNS record, router rule, Nginx host service, public endpoint, or running application container was changed.
- Two local Docker images were built from the new Production Compose definition for verification; no Production containers were created or started.
- The guide replaces the stale migration warning with the current repository state: 19 local migrations were previously verified aligned with remote history. Every future release must still rerun the migration, lint, and advisor gates.
- The existing native systemd `--api-only` installer remains available but is documented as mutually exclusive with the Docker Compose runtime on port 8000.

### Verification performed

- Docker Compose v5.1.4 parsed `compose.production.yml` successfully with environment resolution and with `config --quiet` returning exit code 0.
- `docker compose build --pull` completed successfully for both `km-attendance-backend:v1.0.0` and `km-attendance-ocr:v1.0.0`, using the existing build cache where applicable.
- Ephemeral image inspections confirmed that neither image contains `/app/.env` and both configured runtime users have non-zero UIDs.
- Every repository file referenced by the runbook's file inventory was checked for existence.
- The first aggregate release check correctly stopped under unsupported system Node.js 18.19.1. The supported Node.js 22.23.2 rerun initially exposed the deployment-guide regression assertion for the native `--api-only` path; the guide was clarified and the complete rerun passed.
- The final `scripts/verify_release.sh` run passed: all required InsightFace checksums matched, 94 Backend tests passed, Python dependency validation passed, Frontend lint and all contract/security tests passed, the Vite/PWA Production build completed with 1,910 modules and 68 precache entries, Frontend/OCR dependency audits reported zero moderate-or-higher vulnerabilities, OCR security/doctor checks passed, and the strict Frontend design audit reported zero findings.
- Final Compose validation, image secret/user checks, file-reference checks, and `git diff --check` all completed with exit code 0 before this log append.

### Remaining risks and handoff work

- Replace every placeholder with approved real domains, keys, paths, management network, deploy identity, Git remote, and unique release tag before following the runbook. Do not copy example values into Production.
- Install and run `nginx -t` on the target Ubuntu Mini PC after rendering the real hostname and obtaining its certificate; Nginx is not installed on the development workstation, so host-level Nginx syntax/runtime validation was not performed here.
- Confirm whether the installation has a static public IP, dynamic public IP requiring DDNS, or CGNAT requiring an institutionally approved ingress alternative. Direct port forwarding cannot bypass CGNAT.
- Review the existing Supabase leaked-password-protection warning as an Auth policy decision and verify future new-table Data API exposure explicitly before the October 2026 enforcement date.
- Complete real Production operations: provision the Mini PC/UPS, store secrets, verify model licensing, configure DNS/router/TLS, deploy the Docker stack and Vercel build, run physical-device and representative 30–40-user load tests, verify backup/restore and rollback, and establish external monitoring.
- Review and commit the deployment files and this log entry. The pre-existing untracked `outputs/` directory was preserved and not modified by this deployment task.

## 2026-09-15 — Experimental Hybrid Liveness Protocol v4 on `livenessFeature`

- **Status:** Implementation and automated verification completed on the isolated feature branch; representative physical-device and presentation-attack calibration remains required before any Production merge.
- **Actor:** Codex primary agent.
- **Objective:** Add a testable liveness flow that raises resistance to printed photos, images displayed on another phone, ordinary prerecorded video replay, duplicate/concurrent attendance requests, and use of another account's challenge while retaining a short, understandable student interaction.

### Components and files changed

- Added an attendance-only signed protocol v4 in `backend/services/liveness_service.py`. The challenge now binds the database challenge identifier, authenticated account identifier, attendance-session identifier, expiry, nonce, one randomly selected action (`blink` or `move_closer`), and a random 500–1,400 ms prompt delay. Face self-enrollment deliberately remains on protocol v3 passive mode.
- Added `verify_hybrid_attendance_frames` in `backend/services/liveness_frame_service.py`. It independently recomputes one-face presence, same-person continuity, passive three-frame MiniFAS PAD, non-duplicate transitions, the signed action geometry, and a frontal recovery frame from five transient images.
- Updated the attendance validation and verification endpoints in `backend/main.py` to issue protocol v4 metadata and require three passive images, one action image, and one recovery image. Invalid signed metadata is rejected before the challenge processing lease and expensive face inference; successful attendance still uses the existing atomic claim/finalize path.
- Extended Frontend liveness types and pure action/recovery predicates in `frontend/src/utils/liveness.ts`. Updated the shared camera scanner to retain passive v3 behavior for enrollment and run hybrid v4 only when an attendance challenge is supplied.
- Updated the Student QR and attendance flow to validate protocol v4 metadata, keep a stable React challenge object so the camera worker is not restarted by unrelated renders, collect the exact analyzed action/recovery frames, and submit the expanded multipart contract. The user sees only one plain-language action after the initial automatic capture, and front-camera preview remains mirrored.
- Extended Backend and Frontend contract tests for signed action substitution, early-action timing, challenge/account/session mismatch, v3-to-v4 protocol confusion, accepted blink/move flows, wrong geometry, static action-frame replay, multipart fields, and client-side action/recovery thresholds.
- Added `docs/LIVENESS_PROTOCOL_V4_TEST_PLAN_TH.md` with the threat model, test matrix, privacy-safe evidence policy, metrics, Preview deployment constraints, and Production acceptance gate. Reconciled `README.md`, `DESIGN.md`, `UX-CONTRACT.md`, and the Supabase architecture guide with the experimental protocol.

### Implementation rationale

- Passive RGB PAD remains useful against common print and screen attacks but cannot reliably distinguish every prerecorded moving face. One server-selected action plus signed timing adds temporal unpredictability while limiting the normal interaction to a blink or a short move closer.
- Client landmarks remain usability hints only. The Backend derives every security-relevant face, eye, pose, scale, identity, frame-difference, and PAD decision again from the uploaded images.
- Binding the token to both the authenticated account and the database-derived attendance session closes cross-account and cross-session token substitution before expensive processing.
- Existing Supabase processing-token leases, unique attendance constraints, and atomic finalization already provide the correct one-use/concurrent-request boundary, so no duplicate schema or browser-writable security state was introduced.

### Security and privacy impact

- Five bounded JPEG frames are transient request data; no raw image, video, landmark stream, or new face embedding is stored in attendance records or application logs.
- HMAC token contents are not accepted without a canonical signature and are checked against the authenticated account, challenge row, session, protocol version, action, delay, expiry, and evidence order.
- The change raises the cost of ordinary photo, screen, and generic replay attacks but does not claim protection against adaptive deepfake replay, virtual-camera injection, 3D masks, or formal ISO/IEC 30107 compliance. A replay prepared after reading the random action remains a residual browser/RGB-camera risk.
- Test documentation prohibits storing student identifiers, tokens, raw biometric images, or face embeddings in calibration reports and requires consented test participants.

### Database and deployment impact

- No Supabase schema, migration, RLS policy, function, row, Auth configuration, or Storage object was changed. Current challenge tables and backend-only `SECURITY INVOKER` claim/renew/release/finalize RPCs are reused.
- Current Supabase documentation was rechecked: RLS and grants are separate controls, server secret/service credentials bypass RLS and must stay server-side, and database functions should default to invoker with explicit execution grants. The existing challenge RPC migration follows the applicable backend-only execution pattern.
- Frontend protocol v4 and Backend protocol v4 must be deployed from the same commit. Either side paired with protocol v3 will intentionally fail closed. This branch must remain a Preview/test release until the physical attack matrix is completed.

### Verification performed

- Frontend ESLint passed with exit code 0 under Node.js 22.23.2.
- Frontend liveness contract tests passed, including pure blink, wink rejection, move-closer, no-movement, recovery, mirrored-preview, and multipart-contract assertions.
- Frontend TypeScript compilation and Vite/PWA Production build passed; 1,911 modules were transformed and 68 service-worker entries were precached.
- Backend focused liveness suites passed: 27 tests.
- Backend full unit discovery passed: 102 tests with no failures or errors.
- Backend bytecode compilation passed and `pip check` reported no broken requirements.
- Frontend Premium strict audit reported zero findings, warnings, errors, unresolved items, or violations; the installed upstream design skill digest matched the expected revision.
- Changed UI source searches found no browser `alert`/`confirm`/`prompt`, unsafe raw HTML assignment, `dangerouslySetInnerHTML`, or unexplained `!important` usage.
- `git diff --check` passed.
- Two initial verification invocations used system Node.js 18 and system Python without project packages; they failed for environment reasons. The documented Node.js 22.23.2 path and `backend/.venv` reruns passed as recorded above.

### Remaining risks and handoff work

- Run the consented genuine/print/phone-screen/video-replay matrix in `docs/LIVENESS_PROTOCOL_V4_TEST_PLAN_TH.md` on supported iPhone, Android, and notebook cameras. Measure BPCER/APCER and completion latency before changing any threshold.
- Exercise the full authenticated QR-to-attendance workflow against a protocol-v4 Backend. No student test credential or biometric sample was entered during this implementation, so authenticated real-camera acceptance is not claimed.
- Run duplicate/concurrent Request tests against the Preview Supabase environment to confirm the database RPC and network boundary together, even though unit and migration-contract tests pass.
- Measure five-frame upload size, Backend queue latency, CPU, and RAM on the target Mini PC under the intended concurrent-user load.
- Define and test the audited teacher/manual fallback for genuine users who cannot complete the camera action.
- Do not merge into `main` until the measured attack results and residual adaptive-replay risk are reviewed and accepted.

## 2026-09-15 — Protocol v4 Final Release-Check Addendum

- **Status:** Completed; no implementation changed after this verification.
- **Actor:** Codex primary agent.
- **Objective:** Run the repository-owned aggregate release gate after the protocol-v4 implementation and documentation entry.
- **Files or components changed:** This addendum only. Runtime code, database schema, deployment configuration, secrets, biometric data, and test fixtures were not changed by the release check.
- **Implementation rationale:** The aggregate gate covers dependent Frontend, Backend, face-model, OCR, dependency, and UI-contract checks that are broader than the focused liveness suites.
- **Security and privacy impact:** All three required InsightFace model checksums matched; Frontend and OCR dependency audits reported zero vulnerabilities at the configured moderate threshold. No image, token, user record, private endpoint, or embedding was printed or persisted.
- **Database or deployment impact:** None. The release check did not apply migrations, mutate Supabase, restart containers, publish a Preview, or deploy Production.
- **Verification performed:** `scripts/verify_release.sh` completed successfully under Node.js 22.23.2. It reported 102 Backend tests passing, Python dependency consistency passing, Frontend lint plus card-image/spreadsheet/liveness/face-runtime/API-origin contract tests passing, a Vite/PWA build of 1,911 modules with 68 precache entries, OCR environment isolation and doctor checks passing, and a strict Frontend Premium audit with zero findings.
- **Remaining risks or handoff:** Authenticated real-camera, physical presentation-attack, concurrent network-request, and Mini-PC load testing remain the required Preview acceptance work described in `docs/LIVENESS_PROTOCOL_V4_TEST_PLAN_TH.md`.

## 2026-09-15 — Preview QR Liveness Contract Deployment Repair

- **Status:** Completed for the running local Preview stack; the public Backend ingress now exposes the protocol-v4 attendance contract used by the `demo3.1` Frontend.
- **Actor:** Codex primary agent.
- **Objective:** Diagnose and repair the student QR scan failure reporting that the Backend returned incomplete face-scan authorization metadata.
- **Files or components changed:** No application source, Supabase schema, or deployment configuration was edited. The existing Docker Staging OCR and Backend services were rebuilt from commit `2a556f1` on branch `demo3.1` and recreated through `deployment/docker/compose.staging.yml`. This operational record is the only repository file changed.
- **Implementation rationale:** The checked-out Frontend and Backend both implement attendance liveness protocol v4, but the running Backend container still published the older protocol-v3 multipart contract. The Frontend intentionally rejected that mismatch before opening the face scanner. Rebuilding the stack from the same commit restores the required paired-release contract without adding an insecure protocol fallback.
- **Security and privacy impact:** The fail-closed Frontend validation remains unchanged. No token, QR payload, biometric image, face embedding, student record, credential, or private endpoint was recorded. The repair preserves signed account/session-bound challenges, action/recovery evidence, exact Preview-origin CORS, and transient image processing.
- **Database or deployment impact:** No migration, RLS policy, Auth setting, database row, or Storage object changed. The local Preview OCR and Backend containers were recreated; both retain their existing environment and network topology. The tunnel process remained running and immediately routed to the rebuilt loopback Backend.
- **Verification performed:** Before repair, the running Backend OpenAPI contract required only `liveness_passive_images`, `challenge_id`, `liveness_token`, and `liveness_evidence`, proving it was protocol v3. After repair, both loopback and public-ingress OpenAPI contracts require `liveness_passive_images`, `liveness_action_image`, `liveness_recovery_image`, `challenge_id`, `liveness_token`, and `liveness_evidence`. Docker reports both services healthy. `/health/live` returned HTTP 200, and `/health/ready` returned ready with Database, OCR, and face dependencies all healthy. CORS preflight returned HTTP 200 with the exact Preview origin for both QR validation and attendance verification. The 27 focused liveness frame/security tests passed. `git diff --check` had passed before this append. An initial focused-test command was invoked from the repository root and produced two import-path errors; rerunning from `backend/` with the project virtual environment passed all 27 tests.
- **Remaining risks or handoff work:** The operator should refresh or fully close and reopen the installed PWA/browser tab, scan a newly generated teacher QR, and complete one authenticated real-camera check-in. Existing challenge rows and QR tokens may already be expired and should not be reused. The Preview remains dependent on the local computer, Docker services, and tunnel process staying online; physical presentation-attack and concurrent-request acceptance testing is still required before Production promotion.

## 2026-09-16 — Mobile Face-Landmarker Preparation Compatibility Repair

- **Status:** Source repair and aggregate release verification completed on `demo3.1`; a new Preview deployment and physical-phone acceptance test remain required.
- **Actor:** Codex primary agent.
- **Objective:** Diagnose and repair the student mobile-browser failure that stopped the QR flow at “preparing face detection,” while the same deployed site initialized successfully on a desktop browser.

### Files and components changed

- Updated `frontend/src/services/faceLandmarkerRuntime.ts` to allow 120 seconds for first-use model/WASM download and compilation, add a versioned model request, select a bounded DOM/main-thread MediaPipe path on iOS WebKit, preserve the module-worker path elsewhere, warm the iOS fallback before enabling QR, and map timeout, runtime-compatibility, and general network failures to distinct recovery messages.
- Updated `frontend/src/workers/faceLandmarker.worker.ts` to fetch the local model explicitly with Cache First semantics and initialize MediaPipe from `modelAssetBuffer`, avoiding an additional SDK-owned model-path request inside the worker.
- Updated the student attendance and face-enrollment status panels to show the actual recoverable initialization error. The attendance panel now explains that the first browser visit downloads approximately 15 MB before QR becomes available.
- Extended `frontend/scripts/test-face-runtime.mjs` for the 120-second bound, iOS fallback, model-buffer loading, warm-up, and singleton-ready contract.
- Reconciled `README.md`, `DESIGN.md`, and `UX-CONTRACT.md` with the mobile initialization and recovery behavior.

### Implementation rationale

- The deployed model is approximately 3.8 MB and the selected module WASM is approximately 11.8 MB. A first mobile visit therefore downloads about 15.5 MB and compiles WASM; the former fixed 30-second timeout was shorter than a realistic slow cellular first load, while the desktop completed quickly because of faster network/CPU and likely browser cache.
- MediaPipe Tasks Vision has a documented WebKit worker compatibility failure in which the worker path may access DOM `document`. Every browser on iPhone/iPad uses WebKit, so those devices now initialize the same local model through the DOM/main-thread runtime and process one camera frame at a time. Compatible browsers retain worker isolation.
- The fail-closed readiness gate remains in place: a student cannot open QR scanning until a real Face Landmarker instance is initialized. The change does not bypass face preparation or trust a Frontend-only liveness decision.

### Security and privacy impact

- No raw biometric image, video, face embedding, QR token, student record, credential, or private endpoint was added to code, tests, documentation, or logs.
- Browser face landmarks remain advisory. Backend protocol-v4 verification still recomputes face presence, continuity, action geometry, replay resistance, passive PAD, and recognition from transient frames before attendance finalization.
- The iOS fallback is intentionally serialized to one analyzed frame at a time to limit UI starvation and memory pressure. Initialization still fails closed on timeout or incompatibility.

### Database and deployment impact

- No Backend, OCR, Supabase schema, migration, RLS policy, Auth setting, database row, Storage object, environment variable, Docker container, tunnel, or public deployment was changed.
- A Vercel Preview rebuild from this working tree is required before the repair reaches a phone. An installed PWA or existing browser tab may need to be fully closed and reopened once so its service worker loads the new asset version.

### Verification performed

- Direct production-asset inspection returned HTTP 200 for both the local Face Landmarker model and module WASM, confirming that the failure was not a missing deployed asset. Their measured sizes were 3,758,596 and 11,756,972 bytes respectively.
- The repository-owned `scripts/verify_release.sh` completed successfully under Node.js 24.19.0. It reported 102 Backend tests passing, Python dependency consistency passing, Frontend lint and card-image, spreadsheet-security, liveness, face-runtime, and API-origin contract tests passing, a Vite/PWA build of 1,912 modules with 69 precache entries, zero configured-threshold Frontend/OCR dependency vulnerabilities, OCR security/doctor checks passing, and a strict Frontend Premium audit with zero findings.
- All required InsightFace model checksums matched. Searches across the changed UI/runtime files found no browser `alert`, `confirm`, `prompt`, unsafe raw HTML assignment, `dangerouslySetInnerHTML`, or unexplained `!important` usage. `git diff --check` passed.
- The initial build attempt with system Node.js 18.19.1 correctly failed because current Vite requires a supported Node release; the supported Node.js 24.19.0 rerun passed. No physical iPhone or Android biometric sample was used during automated verification.

### Remaining risks and handoff work

- Deploy this exact Frontend change to the `demo3.1` Preview, fully close and reopen the phone browser/PWA, then run one Wi-Fi first-load and one cellular first-load test on the affected phone. Record device model, OS/browser version, elapsed preparation time, and the new exact error message if it still fails; do not record tokens or biometric images.
- Very old browsers or devices with insufficient WebAssembly/WebGL capability can still be unsupported. Keep the teacher/manual attendance fallback available for a genuine student whose device cannot run the model.
- The iOS fallback runs inference on the main thread by necessity and may cause brief CPU/UI pressure on older devices. Measure camera smoothness and the full protocol-v4 completion rate before Production promotion.
- The pre-existing untracked `outputs/` directory was preserved and not modified.

## 2026-09-16 — New Vercel Origin Added to the Running Staging CORS Allowlist

- **Status:** Completed and verified through the public Backend ingress.
- **Actor:** Codex primary agent.
- **Objective:** Restore browser access after the Frontend was recreated under a new Vercel project hostname and its `/auth/me` preflight was rejected by the existing Backend CORS allowlist.
- **Files or components changed:** Updated the ignored local deployment file `deployment/docker/.env` so `STAGING_FRONTEND_ORIGINS` includes the new exact HTTPS Vercel origin while preserving the required existing origins and local development origins. Recreated only the Docker Staging Backend container so Compose applied the new environment; the OCR container was not restarted. This log entry is the only tracked repository change for this operation.
- **Implementation rationale:** Inspection of the live container confirmed that its `CORS_ORIGINS` contained only the former Preview and Production origins. Reproducing the browser preflight from the new origin returned HTTP 400 without `Access-Control-Allow-Origin`. Adding the exact origin is the least-privilege repair; wildcard CORS remains prohibited because the application sends authenticated requests.
- **Security and privacy impact:** Credentials remain allowed only for an explicit origin list. No wildcard, origin reflection, secret, access token, student record, QR payload, biometric data, or face embedding was introduced or logged.
- **Database or deployment impact:** No source build, Vercel deployment, Supabase setting, migration, RLS policy, database row, Storage object, Frontend container, OCR container, or tunnel configuration changed. The Staging Backend container was recreated and returned to healthy state using its existing image and secrets.
- **Verification performed:** The recreated container reports the new exact origin in `CORS_ORIGINS`. Local and public-ingress `OPTIONS /api/v1/auth/me` requests from that origin both returned HTTP 200 with the exact `Access-Control-Allow-Origin`, credentials, method, and requested-header allowances. An unauthenticated public `GET /api/v1/auth/me` correctly returned HTTP 401 while retaining the exact CORS header, proving application errors remain browser-readable. The new Vercel root returned HTTP 200. Public liveness and readiness checks returned HTTP 200 with Database, OCR, and face dependencies ready; Docker reported Backend and OCR healthy. `git diff --check` passed after the operational change.
- **Remaining risks or handoff work:** Fully close and reopen the new Vercel tab/PWA, then log in and repeat `/auth/me`, QR validation, and face-check flows. If Vercel is recreated under another hostname, add that exact origin before switching users; prefer assigning one stable custom domain so CORS, OAuth redirect URLs, and PWA installs do not change with project recreation. Remove obsolete Vercel origins from the allowlist only after confirming no active Preview or Production deployment still uses them.

## 2026-09-16 — Chrome on iPhone Deployment-Version Diagnosis and Release Commit

- **Status:** Root cause confirmed, release checks passed, and the mobile runtime repair was committed locally on `demo3.1`; remote push requires the operator's authenticated Git session.
- **Actor:** Codex primary agent.
- **Objective:** Explain why Face Landmarker preparation still failed only in Chrome on an iPhone while Safari and Brave succeeded, and ensure that the already prepared iOS compatibility repair is packaged for the Vercel Preview branch.
- **Files or components changed:** No additional runtime behavior was added beyond the mobile Face-Landmarker repair recorded above. This entry records deployment inspection and release packaging. The tracked mobile runtime, student recovery UI, tests, contracts, and documentation were committed together; the pre-existing untracked `outputs/` directory remained excluded.
- **Implementation rationale:** Inspection of the live Vercel JavaScript proved that it still contained the former generic network message and did not contain the 120-second timeout, Apple-mobile main-thread fallback, versioned model request, or buffer-loading implementation. Git inspection independently showed that both `origin/demo3.1` and the Vercel source revision remained at the old commit while the repair existed only as an uncommitted local diff. Safari and Brave succeeding did not prove the fix was deployed: each iOS browser has an independent cache/container and the old worker path can succeed or fail depending on cached assets, initialization timing, and browser wrapper behavior. The repaired path deterministically routes every detected iPhone/iPad WebKit browser, including Chrome iOS, through the serialized DOM runtime.
- **Security and privacy impact:** The release keeps exact readiness gating and does not bypass liveness when browser initialization fails. Browser landmarks remain advisory and Backend protocol-v4 verification remains authoritative. No credentials, tokens, biometric samples, student records, or private endpoints were collected during diagnosis.
- **Database or deployment impact:** No Backend container, OCR service, Supabase object, migration, RLS policy, Auth setting, database row, Storage object, or CORS configuration changed in this step. A local release commit was created on `demo3.1`. The attempted HTTPS Git push failed before changing GitHub because this terminal has no configured GitHub credential and no GitHub CLI installation; therefore Vercel cannot deploy this commit until an authenticated operator pushes it.
- **Verification performed:** The live Vercel root and hashed student bundle were fetched directly and compared with the local source. Remote and local pre-release Git revisions were both the old commit, while the deployed bundle lacked every new runtime marker and retained the old recovery text. The complete `scripts/verify_release.sh` gate passed again under Node.js 24.19.0: 102 Backend tests, all required face-model checksums, Python dependency validation, Frontend lint and contract/security tests, a 1,912-module Vite/PWA build with 69 precache entries, Frontend/OCR dependency audits, OCR security/doctor checks, and the strict Frontend Premium audit with zero findings. `git diff --check` and the staged diff check passed before commit.
- **Remaining risks or handoff work:** Run `git push origin demo3.1` from a terminal authenticated to the repository, wait for Vercel to show the new `fix mobile face runtime initialization` commit as Ready, then fully close Chrome on iPhone and reopen the site so its service worker activates the new hashed bundle. Confirm that the loading copy mentions the approximately 15 MB first download; seeing the former generic copy proves Chrome is still controlled by the old deployment/cache. Physical Chrome-iOS face-camera acceptance remains required after the correct commit is live.

## 2026-09-16 — Support Attachments, Teacher Text Controls, and Supabase Inventory Guide

- **Status:** Implementation and source-level release verification completed locally on `main`; no public deployment was performed.
- **Actor:** Codex primary agent.
- **Objective:** Let student-to-teacher support threads accept PDF and common raster image evidence, give the authorized teacher a working download control and adjustable request text size, and create a new detailed Thai guide to the actual Supabase BaaS inventory and Backend code.
- **Files or components changed:** Updated `backend/services/student_support_service.py` to decode common raster formats including HEIC/HEIF and AVIF, enforce existing byte/pixel limits, reject SVG/corrupt or inconsistent input, strip metadata, normalize still images to JPEG/PNG, and build safe filenames/download headers. Added `pillow-heif` to `backend/requirement.txt`. Updated `backend/routers/support.py` to expose a private authenticated download endpoint using the same participant authorization gate as preview. Expanded `backend/tests/test_student_support_security.py` to cover format conversion, metadata/transparency, SVG rejection, filename limits, download headers, and nonparticipant denial before Storage access. Updated `frontend/src/features/support/SupportCenter.tsx` with a broader file picker, supported-format/limit guidance, authenticated Blob download with error recovery, 14–22 px teacher text-size controls, and narrow-screen header wrapping. Reconciled `UX-CONTRACT.md`. Added `docs/SUPABASE_BAAS_BACKEND_INVENTORY_TH.md` as a new guide rather than replacing the prior guide.
- **Implementation rationale:** The existing private Storage bucket and attachment-table MIME constraint accept JPEG/PNG/PDF but not every image format. Normalizing verified raster files server-side broadens phone/document compatibility without loosening Storage or database policy. Both preview and download must re-check request participation before accessing the object; the download button never exposes a public Storage URL. Font scaling is a local presentation control and does not mutate stored messages.
- **Security and privacy impact:** No secret, token, student record, biometric frame, face embedding, private object path, or real file was written to source, tests, documentation, or this log. SVG is excluded because it can contain active content; PDF screening remains best-effort and is not an antivirus guarantee. Response headers retain private no-store, no-sniff, and sandbox controls. The new guide describes structure and safe read-only metadata inspection rather than disclosing row contents.
- **Database or deployment impact:** A read-only inspection of the connected Supabase project found 18 public tables with RLS enabled, one private support-file bucket, 18 relevant database functions, one attendance Realtime publication table, and no deployed Edge Functions. No migration, RLS policy, Storage object, Auth setting, database row, Docker container, Vercel deployment, or public endpoint configuration was changed. Releasing this feature requires a new Backend Docker image with the added Python dependency followed by a Frontend build/deploy; the existing schema and bucket settings need no change because stored images remain JPEG/PNG.
- **Verification performed:** The complete `scripts/verify_release.sh` gate passed with Node.js 22.23.2: 108 Backend unit tests, Python dependency consistency, Frontend lint and all repository-owned card-image/security/liveness/face-runtime/API-origin checks, TypeScript/Vite/PWA production build of 1,912 modules and 70 precache entries, zero dependency vulnerabilities at the configured threshold, OCR security/doctor checks, and the strict Frontend Premium audit with zero findings. The changed UI source was searched for native dialogs, unsafe HTML, false links, and unexplained `!important` with no matches. `git diff --check` passed. No real support document or authenticated browser interaction was used.
- **Remaining risks or handoff work:** Build and deploy the Backend before the Frontend so the new `download_url` field and endpoint are available. Test teacher/student access, HEIC and PDF upload/download, rejected outsider access, mobile layout, and 14–22 px controls on the deployed staging environment with synthetic documents. The file picker intentionally excludes SVG and unsupported/unsafe raster decoders despite the broad `image/*` browser filter; an institutional requirement for additional formats needs explicit format review. The pre-existing untracked `outputs/` directory was preserved.

## 2026-09-19 — Thesis Topic Proposal Draft and Source Consistency Review

- **Status:** Completed as a new Thai Markdown document; application source and deployed services were not changed.
- **Actor:** Codex primary agent.
- **Objective:** Produce a formal, clear thesis-topic proposal from the user-supplied topic outline, use the supplied scanned thesis proposal only as a structural writing reference, correct statements that no longer match the implemented attendance system, and add primary/official sources for further research.
- **Files or components changed:** Added `docs/THESIS_TOPIC_PROPOSAL_TH.md`. The document contains the Thai and English title, background and significance, objectives, role-based and technical scope, expected benefits, architecture and process diagrams, related theory, implementation stages, an explicit June-October 2026 schedule, evaluation criteria, external references, and a source-to-claim consistency appendix. This log entry records the documentation work. No other tracked file was edited.
- **Implementation rationale:** The supplied outline described an older blink-only FaceMesh flow and implied that a student-card image and face image were sent together for every attendance check. Repository evidence shows that the current system uses MediaPipe Face Landmarker with signed protocol-v4 hybrid attendance liveness, Backend passive PAD and temporal verification, while student-card OCR is used only for initial face enrollment. The proposal separates enrollment from attendance, identifies Backend verification as authoritative, and avoids claiming biometric accuracy or spoof resistance that has not been measured.
- **Security and privacy impact:** The proposal contains no secret, access token, private URL, student record, biometric sample, face embedding, real name, or identifying project data. Personal author/advisor fields are placeholders. It states privacy and retention obligations, transient handling of liveness frames, limitations of presentation-attack resistance, server-side authorization, RLS, and secret isolation without exposing operational configuration.
- **Database or deployment impact:** None. No Supabase query, row, schema, migration, RLS policy, Auth setting, Storage object, Realtime configuration, environment file, Docker container, Nginx configuration, Vercel deployment, or Mini PC service was changed. The document describes the verified repository architecture only.
- **Verification performed:** Read the complete 13-page supplied PDF visually after rendering every page, because the scan had no extractable text. Cross-checked proposal statements against the current `main` commit, README, package manifests, liveness/OCR/face/NFC/support services, Frontend flows, Supabase migrations, UX contract, and deployment configuration. Verified the current protocol version, three passive samples, randomized blink/move-closer action, first-enrollment-only OCR, attendance status thresholds, private support Storage, attendance Realtime publication, Docker/Nginx split, and relevant file paths with repository searches. Checked the Supabase changelog and current official/primary documentation. All 15 external reference URLs returned HTTP 200. `git diff --check` passed, and the rendered PDF intermediates were moved to the desktop trash after review while the original attachments remained unchanged.
- **Remaining risks or handoff work:** The institution's exact thesis-proposal form, author names, student identifiers, program name, advisor, and citation style were not supplied and remain placeholders or may need reformatting. Biometric accuracy, presentation-attack rejection, latency, concurrency, and usability figures are explicitly presented as a proposed evaluation plan; they must not be reported as results until a consented, documented physical-device study is completed. The pre-existing untracked `outputs/` directory was preserved.

## 2026-09-19 — Shared Hybrid Liveness Enrollment and Sidebar Account Identity

- **Status:** Implementation, documentation, visual review, and complete local release verification finished on `main`; no commit, push, or public deployment was performed.
- **Actor:** Codex primary agent.
- **Objective:** Replace the student face-enrollment liveness flow with the same signed hybrid liveness protocol used for attendance, while keeping the two operations purpose-bound, and add a clear account/role profile panel at the top of the teacher and administrator sidebars using the validated Google profile image.
- **Files or components changed:** Updated `backend/services/liveness_service.py`, `backend/services/liveness_frame_service.py`, and `backend/main.py` so enrollment and attendance share protocol-v4 challenge generation and verification, the same randomized blink-or-move-closer action, three passive samples, one action frame, one recovery frame, temporal evidence, passive PAD, continuity checks, and final recognition processing. Updated related Backend security/frame/enrollment tests. Updated the shared Frontend liveness utilities and scanner, student enrollment/home/QR flows, and API types so both user journeys submit the same five-frame hybrid contract. Added `frontend/src/components/layout/SidebarAccountCard.tsx`, placed it above navigation in teacher and administrator layouts, and passed the Backend-loaded `/auth/me` profile from `App.tsx`. Added a sidebar-account contract test, included it in the release gate, and reconciled `DESIGN.md`, `UX-CONTRACT.md`, and the Backend/Supabase and liveness test-plan documentation.
- **Implementation rationale:** Reusing one scanner and one Backend verification pipeline prevents enrollment and attendance from drifting into different liveness implementations. Signed challenges still carry an explicit `face_enrollment` or `attendance` purpose and attendance session binding, so a valid enrollment token cannot authorize attendance and an attendance token cannot authorize enrollment. The sidebar account panel is a shared component to keep identity, role labels, fallback initials, responsive behavior, and Google-avatar handling consistent across both privileged layouts.
- **Security and privacy impact:** The Backend remains authoritative; browser evidence alone cannot complete enrollment or attendance. Cross-purpose challenge reuse, user mismatch, session mismatch, action mismatch, premature action, invalid ordering, expiration, and replay are rejected. Student enrollment frames are handled transiently and are not persisted as raw biometric images; the final face embedding follows the existing storage path. The Google avatar URL is supplied through the Backend profile and limited by the existing trusted Google-image validation, while authorization continues to use the database-backed role rather than editable identity-provider metadata. The role label is display-only. No secret, access token, raw biometric image, student record, private URL, or personally identifying value was added to tests, documentation, or this log.
- **Database or deployment impact:** No Supabase schema, migration, RLS policy, Auth setting, database row, Storage object, Realtime configuration, environment variable, Docker container, Nginx configuration, Vercel project, or public deployment changed. The existing liveness-challenge persistence remains compatible. Backend and Frontend API contracts changed together and should be released together; a stale Frontend or Backend pairing will fail closed instead of silently falling back. The permanent administrator's supervised still-image enrollment override remains a separate intentional flow.
- **Verification performed:** Python compilation of the changed Backend modules passed. The focused liveness/enrollment suite reported 33 tests passing, and the complete Backend suite reported 107 tests passing. Under bundled Node.js 24.19.0, Frontend liveness and sidebar-account contract tests, lint, and the production Vite/PWA build all passed; the build processed 1,913 modules and generated 68 precache entries. The complete `scripts/verify_release.sh` gate then passed with all face-model checksums, 107 Backend tests, Python dependency consistency, all Frontend contract/security/runtime tests, production build, configured-threshold dependency audits, OCR security/doctor checks, and a strict Frontend Premium audit with zero findings. `DESIGN.md` lint returned zero errors and five pre-existing orphaned-token warnings. Source searches found no native dialogs, unsafe HTML insertion, or unexplained `!important` in the changed UI scope. A local browser visual review rendered the teacher, administrator, and temporary-administrator cards correctly with readable identity and distinct role badges. `git diff --check` passed. An initial Frontend test attempt with system Node.js 18.19.1 failed because that release does not support the required TypeScript stripping flag; rerunning with the repository-supported bundled Node.js 24.19.0 passed.
- **Remaining risks or handoff work:** Before Production, deploy Backend and Frontend together to Preview and perform physical-device enrollment plus attendance tests for genuine users, printed photos, phone-screen photos, replayed video, token replay, and cross-purpose token substitution. Browser-camera liveness reduces common presentation attacks but cannot guarantee resistance to advanced deepfakes, virtual-camera injection, or every device-specific capture path; retain supervised recovery and monitoring. Confirm Google-avatar rendering with real teacher/admin accounts and collapsed, expanded, hover, and mobile sidebar states. The unrelated pre-existing `docs/THESIS_TOPIC_PROPOSAL_TH.md`, `outputs/`, and earlier `log.md` work were preserved.

## 2026-09-20 — Standalone Thesis Reference List

- **Status:** Completed as a new Markdown reference document; the existing thesis proposal was not modified.
- **Actor:** Codex primary agent.
- **Objective:** Reformat the 15 sources used by `docs/THESIS_TOPIC_PROPOSAL_TH.md` into a standalone, consistently numbered reference list following the user-supplied author, year, title, retrieval date, and source pattern.
- **Files or components changed:** Added `docs/Reference.md` and appended this log entry. The new document contains a descriptive heading, the Thai and English thesis title, a note defining `ม.ป.ป.`, and references numbered `[1]` through `[15]` with clickable source URLs.
- **Implementation rationale:** Official organization names and source titles were retained where possible so readers can locate the material reliably. A publication or update year was used only when it was available from the source or established publication record; `ม.ป.ป.` is used instead of inventing a year for continuously maintained documentation that does not expose one. The retrieval date remains 19 September 2026 / 19 September 2569 to match the source thesis document.
- **Security and privacy impact:** None. The document contains only public technical and academic references. No secret, access token, private URL, student record, biometric data, or personally identifying information was added.
- **Database or deployment impact:** None. No application source, Supabase project, schema, migration, RLS policy, Auth setting, Storage object, environment file, Docker service, Nginx configuration, Vercel deployment, or public system was changed.
- **Verification performed:** Compared every reference against the source list in `docs/THESIS_TOPIC_PROPOSAL_TH.md`, inspected the official or primary source pages for titles, organizations, authors, and available dates, confirmed that the new document contains 15 unique source URLs and sequential entries `[1]` through `[15]`, reviewed the rendered Markdown structure, and ran `git diff --check` successfully.
- **Remaining risks or handoff work:** The institution may require a specific citation standard such as APA 7, IEEE, or a faculty-provided Thai bibliography template. If such a template is supplied, punctuation, author ordering, italics, and no-date notation should be adjusted to that standard without changing the underlying sources. Existing unrelated working-tree changes and the untracked `outputs/` directory were preserved.

## 2026-09-20 — Main-Only Vercel, Docker, and Nginx Production Runbook

- **Status:** Completed as a new Thai Production runbook with two executable operational scripts; no container, DNS record, certificate, Supabase project, Vercel project, Git remote, or public deployment was changed.
- **Actor:** Codex primary agent.
- **Objective:** Document a fresh end-to-end Production deployment using only branch `main`, with the React/Vite Frontend on Vercel, FastAPI and Light OCR in Docker on a PC/Mini PC, host Nginx as the stable HTTPS reverse proxy, reboot recovery, one-command startup, and health monitoring. Explain why ngrok was previously needed and when Nginx can or cannot replace it.
- **Files or components changed:** Added `docs/MAIN_PRODUCTION_DEPLOYMENT_VERCEL_DOCKER_NGINX_TH.md`, `scripts/start_main_production.sh`, and `scripts/monitor_production_health.sh`; added the new guide to `deployment/README.md`; appended this log entry. The startup script enforces a clean `main` worktree, tags images with the Git SHA, verifies face-model checksums and Compose configuration, builds/starts Backend and OCR, waits for readiness, validates/reloads Nginx, and checks public liveness. The monitor script checks both Docker services, local live/readiness endpoints, public API TLS, and the configured Production Frontend, either once or at a bounded watch interval.
- **Implementation rationale:** The former ngrok path solved the development problem of exposing a loopback-only Backend to a cloud-hosted Preview and phone without Router changes, but a random Free tunnel URL is not a stable Production origin and disappears with the agent or PC. The documented Production design uses a stable API hostname, exact CORS/Trusted Host boundaries, Nginx TLS/rate limiting, and loopback-only FastAPI publication. Nginx can replace ngrok only where a public inbound route exists; the guide explicitly calls out CGNAT and recommends a stable tunnel or VPS when port forwarding is impossible. Nginx remains on the host because the repository's current Production Compose and certificate lifecycle are designed for host Nginx, while Backend/OCR remain isolated in Docker.
- **Security and privacy impact:** The guide separates browser-safe `VITE_*` values from server-only Supabase keys and internal secrets, prohibits wildcard credentialed CORS, leaves OCR unexposed, binds FastAPI to host loopback, limits public health disclosure to liveness, recommends exact OAuth redirects, and avoids printing expanded Compose secrets. The scripts do not print environment contents, tokens, biometric data, student records, or private URLs. Docker-group root-equivalent access and the need to restrict operators are documented. No secret or personally identifying value was added to source, documentation, tests, or this log.
- **Database or deployment impact:** No migration, Data API grant, RLS policy, Auth configuration, database row, Storage object, Realtime publication, Docker image/container, Nginx installation, certificate, Router rule, firewall rule, Vercel deployment, or DNS record was modified. The guide records the current Supabase Data API auto-exposure change scheduled for 30 October 2026 and requires explicit grants/RLS for future tables. It uses the existing `compose.production.yml`, Backend/OCR Dockerfiles, Nginx API-only template, Vercel SPA configuration, and Production environment examples.
- **Verification performed:** Read the current repository deployment guides, Docker Compose, Dockerfiles, environment templates, Nginx configuration, health endpoints, Supabase preflight, Vercel configuration, OAuth code, and service scripts before writing. Reviewed current official Supabase changelog/Auth redirect/Google login guidance, Vercel Git/build/environment documentation, Docker restart/startup-order documentation, Nginx reverse-proxy guidance, and Certbot instructions. `bash -n` passed for both new scripts; both `--help` paths executed successfully; the focused Backend launcher/security suite reported 8 tests passing; numbering/headings and main-only scope were checked with repository search; `git diff --check` passed. ShellCheck was not installed, so no ShellCheck result is claimed.
- **Remaining risks or handoff work:** Replace every example domain/key, confirm whether the target ISP provides public inbound connectivity instead of CGNAT, complete Router/DNS/TLS setup, and run the scripts only from a committed clean `main` checkout with real protected environment files and verified models. Physical-device Login, QR, Hybrid Liveness, OCR, Realtime, reboot, power-loss, certificate renewal, restore, and rollback tests remain mandatory before public launch. The health timer records failures but does not itself deliver notifications; connect Journal failures to an institutional alerting service. Existing unrelated application, thesis, reference, and `outputs/` working-tree changes were preserved.

## 2026-09-20 — Persistent Tunnel and Nginx Architecture Explanation

- **Status:** Completed as a new Thai Markdown explanation; no running service or deployment configuration was changed.
- **Actor:** Codex primary agent.
- **Objective:** Expand the earlier explanation of “Nginx behind a persistent tunnel,” explicitly answer whether that layer is Backend hosting space, and document the operational consequences for the current Vercel, Mini PC, Docker, Nginx, Tunnel, and Supabase architecture.
- **Files or components changed:** Added `docs/Explain NginX.md` and appended this log entry. The document separates DNS, Tunnel, Nginx, Docker runtime, FastAPI, OCR, Vercel, and Supabase responsibilities; diagrams direct-ingress and tunnel-ingress request paths; explains shutdown/restart behavior, TLS boundaries, monitoring order, security controls, and the changes required to containerize Nginx in the current repository.
- **Implementation rationale:** A stable Tunnel makes the ingress identity and path persistent but does not supply compute or keep a powered-off Mini PC available. The document therefore identifies the actual Docker host as the Backend deployment location, describes Nginx as the internal HTTP reverse-proxy policy layer, and distinguishes availability, automatic restart, ingress stability, and true high availability so that a Tunnel is not mistaken for Backend hosting.
- **Security and privacy impact:** Documentation only. It recommends exact credentialed CORS origins, trusted hosts, non-public Backend/OCR ports, protected Tunnel credentials, minimal health output, safe logging, replay protection, and controlled updates without publishing operational secrets. All hostnames and addresses are documentation examples; no token, student record, biometric data, private URL, or personally identifying value was added.
- **Database or deployment impact:** None. No Supabase schema, row, RLS policy, Auth setting, Storage object, Realtime configuration, environment file, Docker image/container, Nginx configuration, Tunnel, DNS record, certificate, Router rule, Vercel project, or public endpoint was created or modified.
- **Verification performed:** Compared the explanation with the existing main-only Production runbook, startup scripts, Production Compose layout, and host-Nginx assumptions. Checked all section headings, diagrams, example-only hostnames, local cross-reference, and three official external documentation links. `git diff --check` passed after the documentation and log changes.
- **Remaining risks or handoff work:** The document is architectural guidance rather than an executed migration. Before choosing a permanent ingress, the operator must confirm CGNAT/public-IP conditions, Tunnel-provider terms, DNS ownership, certificate policy, Mini PC power/network availability, monitoring delivery, and whether host Nginx or containerized Nginx will be the maintained target. Existing unrelated working-tree changes were preserved.

## 2026-09-20 — Proxy and Reverse Proxy Video Explanation

- **Status:** Completed as a new Thai Markdown learning document; no application or infrastructure was changed.
- **Actor:** Codex primary agent.
- **Objective:** Explain the user-supplied ByteByteGo video “Proxy vs Reverse Proxy (Real-world Examples)” by topic, provide clear original examples, and map the networking concepts to AttendanceDemo1.2 without reproducing the video's transcript.
- **Files or components changed:** Added `docs/Proxy and reverse proxy Explain YT.md` and appended this log entry. The document covers the proxy intermediary model, Forward Proxy purposes, Transparent Proxy behavior and HTTPS caution, Reverse Proxy protection/load-balancing/cache/TLS roles, multi-layer reverse-proxy architecture, a side-by-side comparison, Nginx `proxy_pass`, common misconceptions, scenario exercises, and a project-specific Vercel/Tunnel/Nginx/FastAPI/Supabase mapping.
- **Implementation rationale:** The source video is concise and conceptual, so the document preserves its topic order while adding diagrams, bounded examples, terminology caveats, trust-boundary notes, and a concrete mapping to the repository. The content was paraphrased rather than copied, and claims were cross-checked with the creator's official companion guide plus NGINX and Cloudflare reference material.
- **Security and privacy impact:** Documentation only. Added cautions about authorized network-policy use, TLS inspection, forwarded-header trust, closed origin ports, cache privacy, authentication, authorization, and rate-limit limitations. No secret, private endpoint, account, student record, biometric sample, raw transcript, or personally identifying value was stored.
- **Database or deployment impact:** None. No source code, build output, Supabase resource, Docker service, Nginx configuration, Tunnel, DNS record, Vercel deployment, or public service was modified.
- **Verification performed:** Confirmed the supplied video's title, publisher, publication date, duration, and topic sequence; cross-checked Forward Proxy, Transparent Proxy, Reverse Proxy, and layered-proxy explanations against the official ByteByteGo companion guide and technical reference pages. Reviewed all headings, code fences, diagrams, comparison tables, local links, source links, and project terminology. `git diff --check` passed after the documentation and log changes.
- **Remaining risks or handoff work:** Product behavior and provider-specific implementations can differ from the conceptual examples, and the video does not constitute a complete Production security design. Operators must validate actual Nginx, Tunnel, CDN, forwarded-header, TLS, caching, and load-balancing settings against their chosen provider and deployment environment. Existing unrelated working-tree changes were preserved.

## 2026-09-21 — Admin Discovery Controls and Recoverable Attendance Reporting Periods

- **Status:** Implementation, migration authoring, documentation reconciliation, and complete local release verification finished on `main`; no Supabase migration, commit, push, Vercel deployment, Docker restart, or public Production change was performed.
- **Actor:** Codex primary agent.
- **Objective:** Correct the administrator Export view switch so List and Grid render the matching presentation, add administrator user search by name/student identifier and role sorting, and let teachers clear all or selected attendance occurrences from the active report, restore current-period occurrences, or start a blank report for the next semester while preserving historical evidence. Change all attendance exports so late attendance contributes 0.5 point and course-specific attendance criteria remain authoritative.
- **Files or components changed:** Updated the administrator Export and User Management screens; added `AttendancePeriodManager.tsx` and integrated it into the teacher attendance-history workspace; updated the shared Excel/CSV/PDF report model and report tests; updated the canonical Backend export service, teacher period APIs, student-history/current-summary filtering, and session authorization; added migration `20260921111209_attendance_reporting_periods.sql`; added focused Backend period-security tests; added the report test to the release gate; and reconciled `DESIGN.md` plus `UX-CONTRACT.md`.
- **Implementation rationale:** List now renders the compact table/list and Grid renders course cards, eliminating the inverted control. User search and role order are deterministic and URL-backed. Attendance clearing is implemented as a recoverable archive of closed sessions rather than deleting attendance records. Every session snapshots its semester/year, selected archive/restore and semester rollover execute as atomic PostgreSQL functions, and a rollover updates the existing course period while keeping roster and course thresholds. The canonical report pipeline excludes archived sessions, restarts occurrence numbering from active sessions, and applies the same `present = 1`, `late = 0.5`, `absent = 0` model to UI summaries and every export format.
- **Security and privacy impact:** Teacher mutations still require Backend ownership/permanent-administrator authorization. Database functions validate the actor again, use an empty `search_path`, reject open sessions, prevent restoration across periods, and revoke execution from public, anonymous, and authenticated Data API roles while granting only the Backend service role. Historical attendance is retained for audit/recovery and is not exposed to students after archival. No attendance record, student identifier, raw biometric data, token, secret, or private endpoint was written to documentation, tests, or this log.
- **Database or deployment impact:** The new migration adds reporting-period snapshots and archive metadata to `attendance_sessions`, supporting indexes, an insert/update snapshot trigger, and three service-role-only RPCs. Deployment must apply this migration before releasing the updated Backend because the Backend selects the new columns; Backend and Frontend should then be released together. No live Supabase table, RLS policy, Auth setting, Storage object, database row, environment file, Docker container, Nginx configuration, or Vercel project was modified in this task. Current Supabase changelog and official Database Function/RLS guidance were reviewed; the migration follows the documented `SECURITY DEFINER`, empty-search-path, and explicit-function-privilege requirements.
- **Verification performed:** The focused period, export, authorization, and bulk-attendance Backend suite passed 16 tests. The complete repository release gate passed: all face-model checksums, 111 Backend tests, Python dependency consistency, Frontend lint, card-image, spreadsheet-security, report-export, liveness, sidebar-account, face-runtime, and API-origin checks, TypeScript/Vite/PWA Production build of 1,914 modules with 69 precache entries, zero configured-threshold Frontend/OCR dependency vulnerabilities, OCR security/doctor checks, and strict Frontend Premium audit with zero findings. The report test verifies numeric `0.5` marks, weighted formulas, the course threshold formula, file styling, and spreadsheet-injection protection. `git diff --check` passed before this log entry.
- **Remaining risks or handoff work:** Apply and verify the migration in Preview before Backend/Frontend release, then test teacher archive-selected, archive-all, restore-current-period, blocked-open-session rollover, semester rollover, new session creation, student-history exclusion, and all three export formats with representative real course data. Confirm institutional policy accepts weighted lateness for pass/fail, not only for displayed score. Older-period records are intentionally retained and cannot be restored into the current report; a future read-only archive-report screen can be added if instructors need direct historical exports. The unrelated pre-existing local changes in `frontend/vite.config.ts` and `start_all.sh` were preserved without modification by this task.

## 2026-09-21 — Attendance Reporting Migration and Active Backend Rollout

- **Status:** The attendance-reporting migration is applied to the linked Supabase project and the active Docker Backend has been rebuilt/recreated successfully; Frontend Git/Vercel promotion is the next release step.
- **Actor:** Codex primary agent.
- **Objective:** Deploy the already-reviewed reporting-period schema, verify its data backfill and privilege boundary, and update the currently serving Backend runtime so it can use the new archive/restore/rollover contract.
- **Files or components changed:** No new application source was added in this operation. Remote Supabase migration history now includes `20260921111209_attendance_reporting_periods.sql`. The active `attendance-demo31-staging-backend-1` container was recreated from the current Backend source while the healthy OCR container remained in place. This log entry records the external changes.
- **Implementation rationale:** `supabase migration list --linked` and `db push --dry-run` showed exactly one pending migration, so the rollout could proceed without replaying or repairing older history. The migration is additive and backfills every existing session before enforcing non-null period snapshots. The active host has no `/etc/km-attendance` Production Compose configuration or host Nginx installation, so the safe in-scope runtime target was the existing Docker stack currently serving the Backend ingress rather than inventing an unconfigured parallel Production stack.
- **Security and privacy impact:** Runtime verification confirmed anonymous and authenticated database roles cannot execute the archive RPC while `service_role` can. No attendance row was archived during deployment, and verification queries returned aggregate counts only. No token, service key, connection string, student record, biometric data, private URL, or identifying value was printed or written to this log. The Supabase security advisor reported one pre-existing warning that leaked-password protection is disabled; this migration introduced no new advisor finding.
- **Database or deployment impact:** The remote database now has five reporting-period/archive columns, one enabled period-snapshot trigger, supporting indexes, and three service-role-only mutation functions. All 51 existing attendance sessions received a non-null period snapshot and zero sessions were archived by the rollout. The Backend Docker image was rebuilt from current dependencies and source, then the Backend container was recreated. The database, OCR, and face-model readiness checks all returned healthy. Frontend deployment is intentionally performed only after committing the matching code to `main`.
- **Verification performed:** Preflight remote schema lint reported no errors. Migration dry-run listed only the intended file; the real push completed successfully; local and remote migration versions then matched. Post-deployment schema lint again reported no errors. Read-only database checks confirmed five required columns, zero missing period snapshots across 51 sessions, one enabled snapshot trigger, and RPC execution privileges of false/false/true for anon/authenticated/service-role. The recreated Backend returned ready with database, OCR, and face dependencies all `ok`.
- **Remaining risks or handoff work:** Push the matching Backend/Frontend commit to `main`, confirm the Vercel Production deployment and public authenticated workflow, and exercise archive/restore/rollover with controlled test-course data. Enabling Supabase Auth leaked-password protection remains an independent administrator decision; this Google OAuth-centered system does not rely on application passwords for the normal sign-in flow, but the advisor warning should still be reviewed if password sign-in is enabled. The existing local-only changes in `frontend/vite.config.ts` and `start_all.sh` remain uncommitted and were not used as release content.

## 2026-09-21 — Public Backend Ingress Recovery and Release-Push Handoff

- **Status:** The public Backend tunnel was restored and verified end to end; the matching source release is committed locally on `main`, but GitHub/Vercel promotion is blocked only by the absence of an authenticated GitHub or Vercel session on this host.
- **Actor:** Codex primary agent.
- **Objective:** Continue the attendance-reporting rollout after the database migration by validating the deployed API contract, restoring the existing stable ngrok ingress, verifying Production-origin CORS, and promoting the source release to the Git-connected Vercel Production project when credentials permit.
- **Files or components changed:** No additional runtime source was changed. The attendance-reporting implementation and migration were packaged in the local `main` release commit. The existing ngrok endpoint was started against the loopback-only Docker Backend on port 8000. The unrelated local edits in `frontend/vite.config.ts` and `start_all.sh` remained outside the release commit.
- **Implementation rationale:** The Backend container was healthy, but the public endpoint returned ngrok offline error `ERR_NGROK_3200` because no agent process was running. Reusing the already configured stable endpoint restored the same API origin expected by Vercel without changing Frontend environment values, CORS policy, or trusted-host boundaries. Direct Git and Vercel CLI promotion were attempted only after local verification; both stopped before any remote source or Frontend deployment changed because this shell has neither an HTTPS Git credential nor a Vercel credential.
- **Security and privacy impact:** FastAPI remains published only on `127.0.0.1:8000`; OCR remains private inside the Compose network. The public preflight check confirmed the exact Production Vercel origin, credentials mode, allowed methods, and required request headers rather than a wildcard origin. No token, credential, configuration secret, student record, attendance row, biometric sample, private endpoint, or personally identifying value was printed or stored in this log.
- **Database or deployment impact:** No further database mutation occurred after the applied migration. The Backend and OCR containers remained healthy. Starting ngrok restored public HTTPS traffic to the existing Backend container for the lifetime of the agent process; it does not add boot persistence. GitHub remained unchanged because push authentication failed, and Vercel remained unchanged because no CLI credential was available.
- **Verification performed:** Local OpenAPI inspection confirmed the archive, restore, and rollover attendance-period endpoints. Public `/health/ready` returned ready with database, OCR, and face dependencies all `ok`. A real preflight request from the Production Vercel origin returned HTTP 200 with the exact `Access-Control-Allow-Origin`, credential, method, and header policy. `git diff --check` passed before packaging. The Git push failure was limited to missing HTTPS credentials, and Vercel CLI independently reported that no existing credentials were present.
- **Remaining risks or handoff work:** Authenticate GitHub on this host and run `git push origin main`; the connected Vercel project can then build the new Production Frontend. Confirm the Vercel deployment is Ready and run an authenticated teacher smoke test for archive, restore, rollover, and export. The ngrok process must be supervised or started automatically after reboot; otherwise the stable URL will again be offline even though its hostname does not change. Review the pre-existing Supabase leaked-password-protection advisor warning separately.

## 2026-09-21 — Student Camera Quality Controls and Canonical Derived Study Year

- **Status:** Implementation, documentation reconciliation, and complete local release verification finished on `main`; no commit, push, Vercel deployment, Docker restart, public endpoint change, or database mutation was performed.
- **Actor:** Codex primary agent.
- **Objective:** Improve the student QR and liveness camera image quality, let students select an available physical camera lens, expose supported focus/sharpness/zoom controls without breaking unsupported devices, and correct missing or stale study-year results by deriving the value consistently from the validated student identifier.
- **Files or components changed:** Added the shared Frontend camera-quality hook and control panel in `frontend/src/hooks/useCameraQuality.ts` and `frontend/src/components/camera/CameraQualityControls.tsx`; updated `LivenessScanner.tsx` and `QRScanner.tsx` to request HD/Full-HD ideal streams, enumerate/select lenses, report the negotiated resolution, enable continuous autofocus when supported, and expose capability-gated sharpness and zoom. Updated student profile types and explanatory text. Added `backend/services/student_year_service.py` as the canonical student-number normalization, admission-year, and study-year service; integrated it with `/auth/me`, the student profile, administrator user lists, teacher rosters, teacher course-join requests, and roster import. Added focused Backend and Frontend contract tests, included the camera test in the release gate, and updated `DESIGN.md` plus `UX-CONTRACT.md`.
- **Implementation rationale:** The previous liveness stream was constrained to 640×480 and the QR scanner supplied only a rear-facing hint, so mobile browsers could negotiate visibly soft streams and the application could not switch among wide, main, telephoto, or front cameras. The replacement requests a higher ideal resolution while retaining safe minimums, then inspects the actual track instead of assuming the request was honored. Camera features vary by browser and device, so controls are rendered only for capabilities reported by the active track and a rejected constraint leaves the native stream running. Study year had been derived only in one student endpoint while other screens returned the nullable stored `profiles.academic_year`; one pure service now recalculates every student-facing response from the first two admission-year digits and current Buddhist year, with an eight-year supported range and deterministic test inputs.
- **Security and privacy impact:** Camera processing remains local until the existing QR or signed hybrid-liveness submission; the new controls do not record or persist video, add a second stream, weaken challenge binding, alter evidence ordering, or bypass the Backend verifier. The front-camera preview remains mirrored for usability while captured evidence preserves the real camera orientation. Invalid student identifiers fail closed to no calculated year instead of trusting stale database values. A read-only aggregate check confirmed all existing student identifiers were structurally derivable while four of six stored study-year fields were null; no identifier, profile row, image, biometric sample, token, secret, private URL, or personally identifying value was printed or written to this log.
- **Database or deployment impact:** No Supabase schema, migration, RLS policy, Auth setting, Storage object, Realtime configuration, database row, environment variable, Docker container, Nginx configuration, ngrok process, Vercel project, or public deployment changed. Stored `academic_year` data remains untouched for backward compatibility, but updated API responses now make the derived value authoritative for student accounts. Backend and Frontend should be released together so the explanatory fields and API behavior remain aligned.
- **Verification performed:** `git diff --check` and the changed-UI anti-pattern search passed. The complete `scripts/verify_release.sh` gate passed under bundled Node.js 24.19.0: all face-model checksums, 116 Backend tests, Python dependency consistency, Frontend lint, card-image, spreadsheet-security, report-export, liveness, sidebar-account, face-runtime, camera-quality, and API-origin tests; the TypeScript/Vite/PWA Production build processed 1,916 modules and generated 69 precache entries; Frontend and OCR configured-threshold dependency audits found zero vulnerabilities; OCR security/doctor checks passed; and strict Frontend Premium audit returned zero findings, errors, or warnings. The camera contract specifically verifies HD/Full-HD constraints, device selection, continuous focus, sharpness, and zoom integration.
- **Remaining risks or handoff work:** Browser camera APIs expose only features supported by the selected device and browser; iPhone browsers may ignore ideal resolution or omit manual sharpness/zoom even though automatic focus and lens selection continue to work. Before Production, test QR and liveness on representative iPhone Safari/Chrome, Android Chrome, front/rear/wide/telephoto lenses, low light, permission denial, camera switching, and device rotation, and confirm actual negotiated resolution shown in the panel. Verify study-year output with institutional edge cases such as leave of absence, re-entry, unusually old identifiers, or a policy that advances year by academic semester rather than Buddhist calendar year. No physical-device camera test or public deployment was performed in this task.

## 2026-09-21 — Student QR Viewport Isolation, Compact Camera Settings, and Silent Scans

- **Status:** Implementation, contract reconciliation, and complete local release verification finished on `main`; no commit, push, Vercel deployment, Backend restart, or public-system change was performed.
- **Actor:** Codex primary agent.
- **Objective:** Ensure the student QR scanner completely covers application-owned header and bottom navigation on mobile browsers, restore the normal Student shell after success or cancellation, reduce camera-setting obstruction over the scan target, identify the scan-completion sound source, and remove that sound.
- **Files or components changed:** Updated `frontend/src/features/student/QRScanner.tsx` to render the scanner through a React portal attached to `document.body`, lock both document and body scrolling, mark the application root inert and hidden from assistive technology while the modal takeover is active, restore the prior root/scroll state on every unmount path, and explicitly pass `sound={false}` to the QR library. Extended the shared `CameraQualityControls.tsx` with a compact disclosure variant and placed that small control in the scanner's own header. Updated the camera contract test and reconciled `DESIGN.md` plus `UX-CONTRACT.md`.
- **Implementation rationale:** The scanner previously rendered inside the Student shell's WebKit momentum-scroll container. On iPhone this created an ancestor stacking context in which the application header and bottom navigation could be painted above the supposedly fixed dialog. A document-level portal removes the takeover from that constrained stacking context and keeps the existing global dialog layer authoritative. The camera panel now defaults to one small labeled button; lens, autofocus state, resolution, sharpness, and zoom remain available only after explicit expansion. Inspection of installed `@yudiel/react-qr-scanner` documentation and type definitions confirmed that its `sound` prop defaults to `true`, which was the beep heard when a barcode was detected; the application now disables it explicitly.
- **Security and privacy impact:** The QR and liveness authorization protocols, decoded payload validation, signed challenge contract, API request, camera stream lifetime, and biometric flow were not changed. Making the background inert prevents accidental navigation or duplicate interaction while the camera dialog owns the screen. The portal remains inside the same trusted application document and introduces no cross-origin content, persistence, telemetry, image storage, token exposure, or new permission. No secret, token, QR payload, student record, biometric sample, private URL, or personally identifying value was logged.
- **Database or deployment impact:** None. No Supabase schema, migration, RLS policy, Auth setting, database row, Storage object, environment variable, Backend service, Docker container, Nginx configuration, tunnel, Vercel project, or public deployment changed. This is a Frontend-only release and can be shipped through the existing `main` Vercel workflow.
- **Verification performed:** Inspected the supplied original-resolution iPhone screenshot and traced the Student shell, scroll owner, layer tokens, scanner lifecycle, installed QR-library documentation, source map, and public TypeScript API. Frontend lint, the updated camera-quality contract test, and a standalone TypeScript/Vite/PWA Production build passed. The complete `scripts/verify_release.sh` gate then passed with all face-model checksums, 116 Backend tests, Python dependency consistency, all Frontend contract/security/runtime tests, a Production build of 1,916 modules with 69 precache entries, zero configured-threshold Frontend/OCR dependency vulnerabilities, OCR security/doctor checks, and strict Frontend Premium audit with zero findings. A separate strict Premium audit and changed-file anti-pattern search also returned zero findings, and `git diff --check` passed before this log entry.
- **Remaining risks or handoff work:** Physical verification on the affected iPhone browser remains required after Preview deployment because mobile WebKit viewport and browser-toolbar behavior cannot be reproduced by the local build alone. Confirm that the application header and bottom navigation are absent during scanning, the scanner's own back button and compact camera disclosure remain reachable at portrait/landscape and narrow/short viewports, no beep plays after QR detection, and Student chrome returns after cancel, validation error recovery, and successful transition to face scanning. Browser-owned address/tab bars are outside the application's control and may remain visible unless the installed PWA/browser provides its own fullscreen capability.

## 2026-09-22 — Fullscreen Face Camera, Account Profile Modal, and Topmost Confirmations

- **Status:** Frontend implementation, shared overlay hardening, contract documentation, and complete local release verification finished on `main`; no commit, push, Vercel deployment, Backend restart, Supabase change, or public-system mutation was performed.
- **Actor:** Codex primary agent.
- **Objective:** Make the post-QR face-check camera and face-enrollment camera occupy the full application viewport without Student header or bottom navigation, keep camera settings compact, let teacher and administrator account cards open a full profile modal with an explicit close control, and ensure every confirmation dialog appears above an already-open workflow dialog such as attendance-report period management.
- **Files or components changed:** Refactored `LivenessScanner.tsx` into an accessible document-level fullscreen portal and wired explicit close behavior from `StudentHome.tsx` and `StudentRegister.tsx`; reused the compact `CameraQualityControls` disclosure for both attendance and enrollment. Added `useModalIsolation.ts` and adopted it in both camera portals, the shared confirmation/reason dialogs, and the teacher/administrator account profile modal. Converted `SidebarAccountCard.tsx` into an interactive profile trigger with Google avatar, verified role, name, email, backdrop/Escape close, focus trap, and top-right X control. Moved `ConfirmDialog.tsx` to a document portal, added portal-based `TextPromptDialog.tsx`, migrated temporary-administrator rejection/revocation prompts to it, and added the dedicated `--z-confirmation` layer above ordinary dialogs and presentation mode but below toasts. Added overlay/camera/profile regression assertions, added the overlay test to the release gate, and reconciled `DESIGN.md` plus `UX-CONTRACT.md`.
- **Implementation rationale:** The face scanner previously remained inside the Student shell after a successful QR scan, so mobile WebKit continued painting the application header and bottom navigation around it. Rendering the shared liveness scanner beside the application root removes ancestor stacking and scroll constraints for both check-in and enrollment. A small collapsed camera disclosure preserves lens, negotiated resolution, autofocus, zoom, and sharpness access without permanently covering the face target. Confirmation dialogs now portal directly to the document and use a layer reserved for decision prompts, preventing a child confirmation from being trapped behind the attendance-period manager's stacking context. The shared account card keeps role/profile behavior consistent across teacher, permanent administrator, and temporary administrator shells.
- **Security and privacy impact:** Existing signed protocol-v4 challenges, passive/action/recovery evidence, Backend liveness verification, one-use protection, camera constraints, and QR authorization were preserved. Camera video remains transient and local until the existing bounded evidence submission; the profile modal exposes only account fields already available to the authenticated shell and continues to label role from Backend-verified state. Making the application root inert while a portal owns interaction prevents accidental background navigation or duplicate actions. No secret, token, QR value, image, biometric sample, student record, private endpoint, or personally identifying value was added to tests, documentation, or this log.
- **Database or deployment impact:** None. No Supabase table, migration, row, RLS policy, Auth setting, Storage object, Realtime configuration, environment value, Docker image/container, Nginx configuration, tunnel, Vercel project, DNS record, or public endpoint changed. This is a Frontend-only release that can be delivered through the existing `main` Vercel workflow after commit and push.
- **Verification performed:** `git diff --check` passed. Focused Frontend lint, camera-quality, shared-liveness, sidebar-profile, overlay-layer, and Production build checks passed. The complete `scripts/verify_release.sh` gate then passed under Node.js 22.23.2: all face-model checksums, 116 Backend tests, Python dependency consistency, every Frontend contract/security/runtime test including the new overlay contract, a TypeScript/Vite/PWA Production build of 1,918 modules with 69 precache entries, zero configured-threshold Frontend and OCR dependency vulnerabilities, OCR isolation/doctor checks, and strict Frontend Premium audit with zero findings, errors, warnings, or unresolved items.
- **Remaining risks or handoff work:** Physical-device verification is still required after Preview or Production deployment, especially iPhone Safari/Chrome and Android Chrome. Confirm that Student application chrome is absent during QR and face scanning, the browser-owned toolbar behaves as expected, camera controls remain reachable without covering the target in portrait/landscape and short viewports, cancel/success restores the correct screen, the teacher/admin profile modal closes by X/backdrop/Escape, and attendance-period confirmations render above their parent dialog. No automated browser session could exercise authenticated camera permissions or hardware lenses in the local release gate.

## 2026-09-22 — Complete `docs/` Current-System Reconciliation

- **Status:** All twelve Markdown documents currently present under `docs/` were reviewed against the `main` source baseline and updated in place; no application code, Supabase resource, runtime service, or public deployment was changed.
- **Actor:** Codex primary agent.
- **Objective:** Replace stale documentation with a detailed, internally consistent description of the current system, including user workflows, protocol-v4 liveness, canonical study-year derivation, recoverable attendance reporting periods, Production deployment, Supabase inventory, Nginx/tunnel boundaries, thesis scope, and references.
- **Files or components changed:** Updated the seven tracked documents `docs/BACKEND_DATABASE_SUPABASE_GUIDE_TH.md`, `docs/DEPLOYMENT_GUIDE_TH.md`, `docs/HYBRID_VERCEL_MINIPC_DEPLOYMENT_TH.md`, `docs/LIVENESS_PROTOCOL_V4_TEST_PLAN_TH.md`, `docs/PROJECT_OVERVIEW_AND_IMPROVEMENT_PLAN.md`, `docs/SUPABASE_BAAS_BACKEND_INVENTORY_TH.md`, and `docs/USER_GUIDE_TH.md`. Also reconciled the five existing locally ignored documents `docs/Explain NginX.md`, `docs/MAIN_PRODUCTION_DEPLOYMENT_VERCEL_DOCKER_NGINX_TH.md`, `docs/Proxy and reverse proxy Explain YT.md`, `docs/Reference.md`, and `docs/THESIS_TOPIC_PROPOSAL_TH.md`. The user guide was rewritten around the current student, teacher, administrator, camera, reporting, support, profile-modal, and topmost-confirmation behavior.
- **Implementation rationale:** Earlier documents described student-editable study year, repeated card OCR after QR, a fixed `demo3.1` Preview workflow, unreconciled migrations, a missing secure-enrollment migration, and an older movement-plus-blink sequence. The current documentation treats `main` as the Production source of truth, records the matched nineteen-migration baseline and latest reporting-period migration, describes three passive frames plus one random `blink` or `move_closer` action and recovery, distinguishes source readiness from actual Mini PC/Nginx runtime readiness, and documents attendance report scores of present 1, late 0.5, and absent 0 with spreadsheet symbols `1`, `/`, and `X`.
- **Security and privacy impact:** Documentation only. The revision reinforces exact-origin CORS, trusted hosts, backend-only service credentials, RLS and explicit Data API exposure, single-use face challenges, private support attachments, server-side authorization, biometric minimization, and the limitation that RGB-camera PAD cannot guarantee resistance to every presentation or deepfake attack. No secret, token, private URL, student record, face embedding, biometric frame, attachment, or other personally identifying value was read into or written to the documentation or log.
- **Database or deployment impact:** None. No migration was created, repaired, or pushed; no database row, policy, function, trigger, Storage object, Auth setting, environment value, Vercel project, Docker image/container, Nginx service, DNS record, certificate, tunnel, or public endpoint was modified. The documents record that all nineteen migrations were matched/applied at the latest known check, while the permanent Mini PC/Nginx ingress remains a runtime acceptance item distinct from the currently reachable Docker backend through temporary tunnel infrastructure.
- **Verification performed:** Read `log.md`, repository status, all twelve Markdown files, the current migrations, package scripts, deployment assets, and relevant source files before editing. Reviewed the current Supabase changelog and noted the future explicit Data API exposure requirement plus the end of Node.js 20 client support; the project release uses Node.js 22.23.2. A local-link validator confirmed every relative Markdown target across all twelve documents exists. Stale-statement searches found no old review commit/date, student-editable year instruction, repeated card capture after QR, unreconciled migration status, or fixed `demo3.1` release dependency. `git diff --check` passed. The complete `scripts/verify_release.sh` gate passed after one documentation-contract wording correction: all model checksums, 116 Backend tests, Python dependency consistency, Frontend lint and all specialized contract/security/runtime tests, Vite 8.1.0 Production build of 1,918 modules, PWA precache of 69 entries, zero Frontend/OCR configured-threshold dependency vulnerabilities, OCR security/doctor checks, and strict Frontend Premium audit with zero findings.
- **Remaining risks or handoff work:** Five documents under `docs/` are currently excluded by the repository's existing `docs/` ignore rule and therefore do not appear in normal Git status even though their local files were updated; explicitly decide whether to force-track them or change the ignore policy before expecting another clone or Vercel checkout to receive those files. Re-run Supabase migration/advisor checks and verify actual Mini PC containers, Nginx, DNS, TLS, reboot recovery, public health, CORS, OAuth redirects, real-device camera behavior, and representative load before declaring Production runtime readiness. Review, commit, and push the seven tracked documentation changes intentionally.

## 2026-09-22 — Detailed Role-Based System User Manual

- **Status:** The current Thai user guide was expanded and verified; no application, database, infrastructure, or public deployment was changed.
- **Actor:** Codex primary agent.
- **Objective:** Provide a detailed operational manual covering the overall system plus student, teacher, permanent-administrator, and temporary-administrator workflows, using the names and behavior of the current `main` implementation.
- **Files or components changed:** Reworked `docs/USER_GUIDE_TH.md` from a short reference into a 746-line manual. It now covers system purpose and role boundaries, device preparation, Google sign-in and navigation, Student profile and derived study year, class join requests, face enrollment, Dynamic QR attendance, protocol-v4 hybrid liveness, camera controls, attendance history and support requests, Teacher course/member/class-code/session/NFC/report-period/export workflows, permanent-administrator user/course/enrollment/audit/export/temporary-access workflows, attendance scoring and symbols, privacy controls, troubleshooting, readiness checklists, and a glossary. This append-only `log.md` entry records the documentation change.
- **Implementation rationale:** The earlier guide correctly summarized the primary flows but was too concise to serve as a step-by-step operating manual. The replacement separates each role, gives ordered instructions for routine and high-risk actions, explains status meanings and recovery paths, and distinguishes recoverable report-period operations from destructive deletion. Exact current menu labels and current behavior were checked against the Student, Teacher, Administrator, support, camera, liveness, report, and layout source files.
- **Security and privacy impact:** Documentation only. The guide reinforces institutional Google accounts, HTTPS and camera permissions, single-use challenges, private support attachments, server-side role verification, Backend-only service credentials, RLS, safe incident reporting, and biometric-data minimization. It explicitly prohibits sharing tokens, cookies, service keys, PINs, student-card images, face images, and personal records. No secret, token, private endpoint, student record, biometric sample, attachment, or personally identifying value was added.
- **Database or deployment impact:** None. No Supabase table, migration, row, RLS policy, Auth setting, Storage object, Realtime configuration, environment value, Docker image/container, Nginx configuration, tunnel, Vercel project, DNS record, certificate, or public endpoint was modified.
- **Verification performed:** Confirmed the required Student, Teacher, and permanent-administrator guide headings and reviewed the manual against the current menu and feature source. The documentation contract test `LauncherSecurityTests.test_thai_user_and_deployment_guides_exist` passed. `git diff --check` passed after removing the only trailing-whitespace finding. The final guide contains 746 lines and 2,750 words.
- **Remaining risks or handoff work:** This manual is source-verified but was not accompanied by a new authenticated physical-device walkthrough. Before formal distribution, capture organization-approved screenshots if desired and perform a role-by-role acceptance run on Production, especially mobile QR/liveness, NFC hardware, report exports, temporary-administrator timing, and destructive confirmation wording. Existing unrelated documentation changes in the working tree were preserved.

## 2026-11-03 — Thai Software Requirements Specification Drafted from Source Code

- **Status:** A nine-section Thai SRS was written and reviewed section by section with the project owner; it lives outside this repository, so no application, database, or deployment file changed. This is the only repository edit made for the task.
- **Actor:** Claude Code (Claude Sonnet 5.5).
- **Objective:** Produce an SRS covering title, background, objectives, user requirements, system requirements, functional requirements, non-functional requirements, stakeholders, and UML diagrams (use case with scenarios, class, sequence, activity, state), derived from the current `main` source rather than from Markdown documentation, per the owner's instruction.
- **Files or components changed:** Created `SRS_AttendanceSystem_TH.md` in the owner-designated directory `/home/cortanadesu/Documents/Claude/` (about 2,750 lines, 34 Mermaid diagrams). Appended this entry to `log.md`. No source, migration, configuration, or existing documentation file was modified.
- **Implementation rationale:** Requirements were read from routers, services, middleware, frontend screens, Dockerfiles, Compose, CI, and Supabase migrations; each requirement carries a code reference so it can be re-verified. Where the code defines no target (response-time goals, concurrency, availability, retention, minimum browser), the SRS says so instead of inventing numbers. Review of the code surfaced behaviors recorded as observations in the document, not changed here.
- **Security and privacy impact:** Documentation only. No secret, token, key, private URL, student record, or biometric data was read into or written to the SRS or this log; only configuration names, default values, and thresholds from source were cited.
- **Database or deployment impact:** None. No migration, row, policy, function, Storage object, environment value, container, Nginx configuration, or public endpoint was created or changed. A temporary local static server and a browser tab were used only to validate Mermaid syntax and were stopped afterwards.
- **Verification performed:** Every Mermaid block (34) was parsed and rendered with Mermaid 11.4.1 in the built-in browser with no errors. Thresholds, endpoints, RPC names, role guards, and status values were cross-checked against the cited source files while writing; corrections made during review include NFC UID format (10 hexadecimal characters, not digits), temporary-administrator reach over other teachers' sessions and courses, and the absence of audit entries for single-record manual attendance edits. No automated tests, builds, or runtime checks of the application were run because no application code changed.
- **Remaining risks or handoff work:** (1) Sections 2 and 3 were drafted before the "code only" instruction; the pilot targets in section 3.3 (first-attempt success, completion time, 30–40 concurrent users) came from repository Markdown and were left unchanged by the owner's decision. (2) Base tables (`profiles`, `courses`, `enrollments`, `attendance_sessions`, `attendance_records`, `audit_logs`), the unique key on `attendance_records (session_id, student_id)`, and any trigger on `auth.users` that calls `handle_new_user()` have no DDL in `supabase/migrations/`; confirm them against the linked Supabase project. (3) Owner decision needed on whether effective-`admin` access to other teachers' sessions and courses for temporary administrators is intentional. (4) Other code observations listed in the SRS (6.16, 7.12, 8.4, 9.5) remain unaddressed: `absent` check-ins are accepted, `grace_period_minutes` is stored but unused, `/health/ready` does not probe the face model, and the CI workflow targets branch `demo3.1` rather than `main`. (5) The SRS file is not tracked by Git; copy it into the repository or share it separately if it must be preserved with the project.

## 2026-11-04 — QR Dialog Cleanup, Floating (Picture-in-Picture) QR Window, and Late-Threshold Auto-Close

- **Status:** Implemented and verified by automated checks; not exercised in a real browser against a live Supabase project, so the Picture-in-Picture window and the auto-close timer still need a manual acceptance run.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** (1) Confirm that every QR-timing setting is 12 seconds after the owner changed the `LiveAttendance.tsx` default from 15. (2) Remove the countdown number from the centre of the QR and the "Dynamic QR changes token every N seconds" label. (3) Let the teacher open the QR as a movable floating window. (4) Close the session, and the floating window, automatically when the course's late-threshold window ends (owner decisions: the threshold comes from each course's `late_threshold_minutes`, and auto-close applies to every opened session, not only to sessions using the floating window).
- **Timing audit result:** `QR_REFRESH_SECONDS` already defaults to 12 in `backend/core/config.py`, both `.env.example` files and the database column default; the 10–15 range check in config and the SQL check constraint are bounds, not defaults. The only 15 left in QR code was the frontend fallback owned by the owner's edit. `grace_period_minutes: 15` written on session start is unrelated and unchanged.
- **Files or components changed:**
  - Backend: `backend/core/authorization.py` (owned-course select now includes `late_threshold_minutes`); `backend/services/teacher_session_service.py` (new `normalize_late_threshold_minutes`, `elapsed_seconds_since`; active-session payload gains `late_threshold_minutes` and server-measured `elapsed_seconds`); `backend/main.py` (same two fields in the `/api/v1/sessions/start` session object); `backend/tests/test_teacher_session_service.py` (three new tests).
  - Frontend, new: `src/utils/sessionDeadline.ts`, `src/hooks/useQrTokenRotation.ts`, `src/hooks/useDocumentPip.ts`, `src/features/teacher/FloatingQrWindow.tsx`, `scripts/test-session-deadline.mts`.
  - Frontend, edited: `src/contexts/teacherAttendanceState.ts`, `src/contexts/TeacherAttendanceProvider.tsx`, `src/features/teacher/LiveAttendance.tsx`, `package.json` (script `test:session-deadline`).
- **Implementation rationale:** QR rotation moved out of `LiveAttendance` into `TeacherAttendanceProvider` because each rotation invalidates the previous token on the server; two components rotating independently would make one QR stale. The provider rotates only while the QR dialog or the floating window is showing, matching the previous behaviour. The floating window uses the Document Picture-in-Picture API (Chrome/Edge desktop); other browsers see a disabled button with an explanation. Elapsed time is computed on the server so a wrong clock on the teacher's computer cannot close a session early or late; the browser only counts the remaining time forward. Auto-close lives in the provider so it keeps working after the dialog is minimised or the teacher changes teacher pages. Opening the floating window minimises the QR dialog. A failed auto-close re-reads the server state and retries every 10 seconds.
- **Security and privacy impact:** No new endpoint, role rule, or stored data. The new payload fields are non-sensitive numbers returned to the session owner only; the QR token is still never returned by the active-session endpoint. The floating window shows the same QR payload the dialog already showed. No secrets, student records, or biometric data were written to this log.
- **Database or deployment impact:** No migration, table, policy, or Supabase setting changed. Backend and frontend both need a redeploy for the feature (the frontend tolerates an older backend: missing fields fall back to 15 minutes and zero elapsed time). Behaviour change to communicate to teachers: every session now closes itself at the course's late threshold (default 15 minutes), so no check-in can be recorded as `late` through an open session afterwards.
- **Verification performed:** Backend `python -m unittest discover -s tests`: 119 tests, 118 pass; the single error is the pre-existing `test_thai_user_and_deployment_guides_exist`, which reads `docs/USER_GUIDE_TH.md` that is deleted in the working tree (not caused by this change). Frontend on Node 22.23.2: all ten test scripts pass including the new `test:session-deadline`; `npm run lint` exit 0; `tsc -b` and `npm run build` succeed. Default Node 18 on this machine cannot run the `--experimental-strip-types` scripts.
- **Remaining risks or handoff work:** (1) Auto-close runs in the teacher's browser, so a session stays open if that browser is closed or the computer sleeps; a server-side expiry (for example inside `rotate-token`/`validate`) would remove that gap. (2) Background-tab timers can fire late (browsers throttle them); the exact close time may slip by up to about a minute in a hidden tab. (3) Not yet tested by hand: Picture-in-Picture on a real Chrome/Edge, dragging, closing it manually, and a session older than its threshold being closed on page load. (4) Unlogged working-tree changes by someone else were observed and left untouched: seven deleted files under `docs/`, `scripts/check_supabase_release.sh`, `package.json`/`package-lock.json` (Supabase CLI devDependency), and `supabase/.temp/*`. The earlier 15→12 default edit in `LiveAttendance.tsx` is the owner's and is included in that file's diff.

## 2026-11-04 — Local Test Run Procedure and Production Revert Ledger

- **Status:** Local frontend + backend test run verified working with the existing `start_all.sh`; no repository file was changed for it. One untracked local file (`backend/.env`) had one value corrected earlier the same day.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Run the system locally for testing (frontend on 127.0.0.1:5180, backend on 127.0.0.1:8080) without touching production, and record every setting that is test-only so it can be reverted before a production release.
- **Files or components changed:** `log.md` only. Local, Git-ignored files inspected: `backend/.env`, `frontend/.env.local`, `ocr-service/.env`. `backend/.env`: `QR_REFRESH_SECONDS` 15 → 12 (this value is correct for production too; it overrode the intended default).
- **Implementation rationale:** The frontend reads `VITE_API_ORIGIN`; when it is empty, requests go to relative `/api/...` and the Vite dev proxy forwards them to `127.0.0.1:${DEV_BACKEND_PORT:-8080}`. So the local stack needs no code change. `VITE_API_URL` in `frontend/.env.local` is read by no code and has no effect. Setting `VITE_API_ORIGIN=http://localhost:8080` would be wrong locally because it bypasses the proxy and hits CORS (`CORS_ORIGINS` lists port 5173, not 5180).
- **Revert ledger (test-only items):**
  1. Supabase Dashboard → Authentication → URL Configuration → Redirect URLs: entries added for `http://127.0.0.1:5180` (and `/**`) must be removed after testing. Site URL must stay the production domain. This is a dashboard setting, not a repository file.
  2. `backend/.env` (`APP_ENV=development`, localhost `CORS_ORIGINS`, empty `LIVENESS_SIGNING_KEY` and `TEMP_ADMIN_PIN_PEPPER`) is local-only. The release bundle excludes `.env` and `.env.*` (`scripts/build_release_bundle.sh`), and production reads `/etc/km-attendance/backend.env`, `/etc/km-attendance/ocr.env` and `/etc/km-attendance/frontend.env.production`, so nothing here needs reverting for a release.
  3. `frontend/.env.local` is Git-ignored and local-only; the Vercel build uses its own project environment variables (`VITE_API_ORIGIN` must be the public HTTPS API origin there).
  4. Processes started by `start_all.sh` (ports 3001, 8080, 5180) stop with Ctrl+C. An older Docker staging stack (`attendance-demo31-staging-*`, port 8000) was left running and untouched.
- **Security and privacy impact:** The local backend uses the same Supabase project as production (same `SUPABASE_URL` as the CLI-linked project), so any session opened, closed or check-in recorded during testing writes real data. Use test courses and accounts. No secret or personal data was written to this log.
- **Database or deployment impact:** None from this entry. No migration, policy, Auth setting, container, or Vercel/Nginx/tunnel configuration was changed by the assistant.
- **Verification performed:** Confirmed running processes (OCR 3001, backend 8080, Vite 5180); the backend started after the `QR_REFRESH_SECONDS` correction; `/health/live` answers through port 5180; `/api/v1/auth/me` without a token returns 401 on both 5180 and 8080; a clean browser profile at 127.0.0.1:5180 contacts only its own origin and has no service worker. Authenticated flows were not exercised from the assistant side.
- **Remaining risks or handoff work:** Remove the temporary Supabase Redirect URLs after testing. Consider a separate Supabase test project (blocked today because base tables have no DDL in `supabase/migrations/`). The old staging container still runs pre-change code and 15-second QR rotation until rebuilt.

## 2026-11-05 — QR/Section Isolation Audit, Regression Tests, One-Open-Session Index, and Duplicate-Course Guard

- **Status:** Code and tests complete and verified locally. The new migration file is written and tested on a throwaway local Postgres but has NOT been applied to the linked Supabase project; the backend change is safe to deploy before or after the migration.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Answer whether two sections of the same course (different or same teacher, both sessions open) can mix QR codes or attendance, then close the gaps found: (2) missing tests for QR/section isolation, (1) the "one open session" rule enforced only in application code, (3) no guard against creating the same course and section twice.
- **Audit finding (no behaviour change needed):** Each section is its own `courses` row with its own roster (`enrollments.course_id`). Each opened session is its own `attendance_sessions` row with its own `id` and random `qr_token`; the QR carries `{session_id, token}`. `/api/v1/sessions/{id}/validate` loads that exact session, checks open status, token equality and the 12-second window, then requires enrollment in that session's course before issuing a challenge bound to the session. `finalize_face_attendance` re-checks the challenge-to-session binding, open status and enrollment, and `on conflict (session_id, student_id)` blocks duplicates. Sessions are separated by `session_id` plus enrollment; the token provides freshness and anti-sharing, not the section boundary.
- **Files or components changed:**
  - New `backend/tests/test_qr_session_isolation.py` (11 tests: token freshness, wrong token, closed session, missing rotation time, own-section scan, other-section scan rejected as not enrolled, sec 1 token on sec 3 session rejected, student in both sections attributed only to the scanned section, unknown session, repeat check-in).
  - New `supabase/migrations/20261105090000_one_open_session_per_course.sql`: pre-check that aborts with a readable error if duplicate open sessions exist, then two partial unique indexes on `attendance_sessions` (`course_id` and `opened_by`, both `where status = 'open'`), created with `if not exists`.
  - New `backend/services/course_duplicate_service.py`: `ensure_course_not_duplicate` (same teacher, same code ignoring case and spaces, section, year and semester) and `is_unique_violation`.
  - Edited `backend/main.py`: start-session insert now turns a unique-index violation into HTTP 409 (Thai message) instead of 500; course create and update call the duplicate guard (update excludes the course being edited and uses the course owner's id, so an admin editing a teacher's course checks against that teacher); `create_course` now re-raises `HTTPException` instead of converting it to 500.
  - New `backend/tests/test_course_duplicate_guard.py` (14 tests: guard rules, wildcard characters not treated as wildcards, unique-violation detection, 409 on racing start, migration file contains both indexes).
- **Implementation rationale:** The database is the only place that can make "one open session" race-proof; the application check remains for the friendly message. The duplicate guard blocks only the same teacher because co-taught sections are legitimate and never share a QR. Case-insensitive comparison is done in Python, not with `ilike`, so `_` and `%` in a course code cannot act as wildcards. The migration refuses to run when duplicates exist rather than closing sessions automatically, so no attendance data is changed without a human decision.
- **Security and privacy impact:** Tightens integrity only; no new endpoint, role rule, stored field, or exposure of tokens. No secrets, student records, or biometric data were written to this log or to the tests (tests use placeholder identifiers).
- **Database or deployment impact:** One new migration, not yet applied. Before applying to production, check for existing duplicates (migration aborts and changes nothing if any exist). After it is applied, a teacher can have only one open session at a time and a course only one, enforced by Postgres. Existing rows are not modified. Backend needs a redeploy for the 409 mapping and the duplicate-course guard; without the migration the 409 mapping is simply never triggered. No duplicate-course unique index was added to the database because existing data has not been checked; the guard is application-level only.
- **Verification performed:** Backend `python -m unittest discover tests`: 141 tests, 140 pass; the single error is the pre-existing `test_thai_user_and_deployment_guides_exist` (reads `docs/USER_GUIDE_TH.md`, deleted in the working tree, unrelated to this change). The migration was run on a throwaway local container from the already-present Supabase Postgres image with a minimal `attendance_sessions` table: it aborted with the readable error while duplicates existed and created no index; after closing the extra row it succeeded and a second run was a no-op; a second open session for the same course was rejected, a second open session for the same teacher on another course was rejected, closed sessions and different teachers/courses were allowed. The container was removed afterwards. The live Supabase schema was not queried.
- **Remaining risks or handoff work:** (1) Apply the migration to the linked project after confirming no duplicate open sessions exist (for example by checking for rows with `status = 'open'` grouped by `course_id` and by `opened_by`); closing the extra sessions is a manual decision. (2) Decide whether to add a database unique index for course + section + year + semester per teacher once existing data is checked. (3) Two different teachers can still create the same course and section in the same term; this is allowed on purpose. (4) Auto-close is still client-side only (see the 2026-11-04 entry). (5) Unlogged working-tree changes by others (deleted `docs/*.md`, `scripts/check_supabase_release.sh`, root `package*.json`, `supabase/.temp/*`) remain untouched.

## 2026-11-05 — Fix Doubled Vertical Scrollbars in Teacher, Admin and Student Layouts

- **Status:** Implemented; root cause reproduced and the fix confirmed in a browser on a standalone harness; build, lint and type-check pass. Not yet re-checked by eye in the real application pages (the owner's screenshot came from a deployed site; the fix has not been deployed anywhere).
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Stop pages from showing two stacked vertical scrollbars (one for the page and one for the content area), seen for example on the teacher roster-import page, where the sidebar also appeared cut off after the page scrolled.
- **Root cause:** The teacher and admin layouts make `<main>` the single scroll container (`h-svh overflow-y-auto`), and the student layout does the same with `.student-content-scroll`. None of those containers was a positioned element. Visually hidden form controls (`sr-only`, which is `position: absolute`, for example the hidden file input and search labels in `ImportStudents.tsx`) therefore used the whole document as their containing block and were not clipped by the scroller; their static position inside long content extended the document's own scroll height, so the document got a second scrollbar on top of the content area's. Because the sidebar is `sticky` inside a one-screen-tall wrapper, scrolling the document also pushed the sidebar partly off screen.
- **Files or components changed:** `frontend/src/components/layout/TeacherLayout.tsx` and `AdminLayout.tsx` (`relative` added to the `<main>` classes); `frontend/src/index.css` (`position: relative` added to `.student-content-scroll`, with a comment). No existing class or rule was removed.
- **Implementation rationale:** Making the scroll container the containing block keeps absolutely positioned descendants inside it, where they are clipped and scroll with the content, so the document height stays equal to the viewport. Checked beforehand that nothing relied on the page being the containing block: dialog backdrops and both student camera screens are `fixed`, and the sidebar profile dialog is `fixed` with its own `relative` panel.
- **Security and privacy impact:** None; presentation only. No secrets or personal data were involved or written to this log.
- **Database or deployment impact:** None for the database. A frontend rebuild and deploy is needed for the fix to appear on the public site; nothing was deployed.
- **Verification performed:** In the built-in browser at 1280x800 on a standalone page that copies the layout structure, the document scroll height was 2200 px against an 800 px viewport before the change and 800 px after adding `position: relative` to the scroll container, with the container itself still scrollable. Frontend (Node 22.23.2): `npm run lint` clean, `tsc -b` exit 0, `npm run build` succeeds. The temporary harness lived outside the repository and its local server was stopped.
- **Remaining risks or handoff work:** (1) Confirm visually in the real teacher, admin and student pages after the next deploy; a stale service-worker cache may keep the old CSS until the PWA updates. (2) The fix addresses the layout containers; a hidden element placed inside another non-positioned `overflow` wrapper can still enlarge that wrapper's own scroll area, but not the page. (3) The earlier unlogged working-tree changes by others remain untouched.

## 2026-11-05 — Automatic Study-Year Calculation From the Student E-mail (Task 1 of 2)

- **Status:** Implemented and verified by automated tests; not exercised against the live Supabase project or in a browser. Awaiting the owner's review before the next task starts.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Check whether the existing automatic study-year feature works, and make the student profile show the student id cut from the e-mail (`s<13 digits>@email.kmutnb.ac.th`), calculate the study year from its first two digits, bound it to 1–8, and assign the result to the student's account automatically. Owner decisions recorded: a result outside 1–8 is shown as "cannot calculate" (not clamped), and the year advances with the academic year, not the calendar year.
- **Audit finding:** The old formula (`current Buddhist year − admission year + 1`, range 1–8) was correct and its tests passed, but it (1) read the id from `profiles.student_id` instead of the e-mail, so a missing or malformed stored id gave no year; (2) never saved the result, leaving `profiles.academic_year` empty; (3) rolled over on 1 January; and (4) the student profile endpoint showed the stored id only.
- **Files or components changed:**
  - `backend/services/student_year_service.py`: new `current_academic_year` (the academic year starts on 1 June: January–May belong to the previous year), `student_id_from_email`, `resolve_student_id` (e-mail first, then stored id), `sync_stored_study_year` (writes `profiles.academic_year` only when it differs; never raises); `derive_study_year`, `derive_admission_year` and `with_derived_study_year` now use the academic year and accept the e-mail. `current_buddhist_year` and every previous function were kept.
  - `backend/core/security.py`: `get_current_user` derives the year from the verified sign-in e-mail for students and stores it on the profile when it changed (best effort, in a worker thread).
  - `backend/routers/student.py`: `GET /api/v1/students/me/profile` returns the e-mail-derived student id and also syncs the stored year.
  - `backend/tests/test_student_year_service.py` (+14 tests: 1 June rollover, no change on 1 January, 1–8 bounds, e-mail parsing and look-alike domains, e-mail priority, write/skip/failure of the sync) and new `backend/tests/test_student_year_login.py` (3 tests: year from e-mail and stored on sign-in, no write when already correct, teachers untouched).
  - `frontend/src/features/student/StudentProfile.tsx`: one explanatory sentence now says the year is calculated from the id in the e-mail and the current academic year.
- **Implementation rationale:** The calculation is still recomputed on every read, so the displayed value can never be stale; the stored column is a convenience copy that is refreshed on sign-in, which is the "assign to the account automatically" part. The e-mail comes from Supabase's verified token, so it cannot be edited by the student, and the pattern is anchored to `email.kmutnb.ac.th` (matching the sign-up trigger). Teachers and admins are never calculated or written. Roster import still passes the semester year from the file as an explicit reference, which is unchanged.
- **Security and privacy impact:** The student id is derived from data the user already owns (their verified e-mail) and is returned only to that student. The new write touches only `academic_year`, only on the caller's own student profile, only when the value changed, and only with values 1–8 (the database check constraint). No secret, token, or personal data was written to this log or the tests (placeholder ids only).
- **Database or deployment impact:** No migration. Backend redeploy required. After deployment, each student's `profiles.academic_year` is written at their next sign-in (and again when the academic year rolls over on 1 June); students who never sign in keep an empty stored value, but every screen that shows the year recomputes it. Behaviour change: the displayed year now advances on 1 June instead of 1 January.
- **Verification performed:** Backend `python -m unittest discover tests`: 155 tests, 154 pass; the single error is the pre-existing `test_thai_user_and_deployment_guides_exist` (needs `docs/USER_GUIDE_TH.md`, deleted in the working tree). Frontend (Node 22): `npm run lint` clean and `tsc -b` exit 0. The live database and a browser were not used.
- **Remaining risks or handoff work:** (1) The student's `profiles.student_id` is still the identity used for attendance; if it is empty while the e-mail has an id, the profile now shows the e-mail id but other features still see an empty stored id. (2) The 1 June boundary follows the owner's description (semester 1 starts in June, semester 2 in November); adjust `ACADEMIC_YEAR_START_MONTH` if the university calendar differs. (3) Students with a non-student-style e-mail (invited accounts) fall back to the stored id.

## 2026-11-05 — Roster Import Walk-Through and "Wrong Course" Notice Dialog (Task 2 of 2)

- **Status:** Implemented and verified (backend unit tests, lint, type-check, build, and a browser run of the real import page against a simulated backend). Not exercised against the live Supabase project or with a real registrar spreadsheet. Awaiting the owner's review.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** (1) Explain how roster upload works: what is read from the file, how a person in the file is matched to an existing account, what happens when no account exists yet, and what happens to that data when the person first signs in. (2) When an uploaded roster belongs to a different course than the page it was uploaded on, show a modal telling the teacher "this roster does not match the course, please try again".
- **Findings (no behaviour change):** The file is parsed in `backend/services/roster_import_service.py` (size, type, XLSX zip-bomb, macro, formula and CSV encoding checks; header row found in the first 50 rows; course code and semester year read from the preamble; per row: 13-digit student id, name, optional e-mail, optional study year and group; the e-mail defaults to `s<id>@email.kmutnb.ac.th`). `resolve_roster_actions` matches rows to `profiles` and `profile_invites` by student id and e-mail only; the name in the file is never compared with an existing account and never overwrites it. An existing student account is only enrolled in the course. When no account exists a `profile_invites` row plus a `profile_invite_courses` link is created (a `profiles` row cannot exist without a Supabase Auth user). At first sign-in `handle_new_user()` finds the invite by e-mail, copies its student id, name, study year and group into the new profile (the invite wins over Google's name), enrols the linked courses and marks the invite claimed. Commit re-parses the file, checks the SHA-256 from the preview, and calls the atomic `import_course_roster` RPC, which repeats authorization and conflict checks and writes an audit-log row.
- **Files or components changed:**
  - `backend/services/roster_import_service.py`: new `roster_course_mismatch` and `_course_code_key` (course codes compared ignoring case, spaces and dashes). Nothing removed.
  - `backend/routers/teacher.py`: when the file names a different course, `_parse_and_resolve_roster` stops before any database matching and returns a zero summary; the preview response gains `course_mismatch` and `expected_course_code` and returns no rows in that case. The existing blocking-error text and the commit-time 409 are unchanged.
  - New `backend/tests/test_roster_course_mismatch.py` (8 tests).
  - New `frontend/src/components/overlays/NoticeDialog.tsx`: one-button warning dialog (focus on the button, Esc closes, page scroll lock and `#root` isolation reused from `useModalIsolation`).
  - `frontend/src/features/teacher/ImportStudents.tsx`: on `course_mismatch` the selected file is cleared and the dialog opens with the text "ใบรายชื่อนี้ไม่ตรงกับรายวิชา กรุณาลองใหม่" plus the course code in the file and the course code of the page.
- **Implementation rationale:** The backend already refused wrong-course files, but only as a red banner above a preview table. A dedicated flag lets the page react explicitly instead of guessing from message text. Stopping before database matching avoids showing "will enrol / will create invite" results for a sheet that must not be imported and avoids needless queries. Code comparison was loosened (dashes/spaces) so a course saved as `030513-300` is not wrongly rejected for a file saying `030513300`. A file that names no course is still accepted with the existing warning, because the registrar layout is not guaranteed to include it.
- **Security and privacy impact:** Tighter, not looser: a wrong-course file no longer triggers queries against `profiles`, `profile_invites` or enrollments and returns no student rows to the browser. No new endpoint, no new stored data. Tests use placeholder ids and names only; nothing sensitive was written to this log.
- **Database or deployment impact:** None for the database (no migration). Backend and frontend redeploy needed for the dialog to appear.
- **Verification performed:** Backend `python -m unittest discover tests`: 166 tests, 165 pass; the single error is the pre-existing `test_thai_user_and_deployment_guides_exist` (needs `docs/USER_GUIDE_TH.md`, deleted in the working tree). Frontend (Node 22): `npm run lint` clean, `tsc -b` exit 0, `npm run build` succeeds. In the built-in browser, the real `ImportStudents` page was rendered on a temporary Vite page with a simulated API: a wrong-course answer opened the dialog with the right texts, cleared the chosen file, hid the preview, closed with Esc and with the button and released the scroll lock, allowed a retry that reopened it, and a matching course showed the normal preview without any dialog. The temporary page and its server were removed afterwards.
- **Remaining risks or handoff work:** (1) Only the course code is compared; the section ("ตอน") is not, so a roster of another section of the same course is still accepted. The exact registrar wording for the section is not in the repository (the test fixture has no section line), so it was left out rather than guessed; add it once a real sheet is available. (2) An existing account is matched by student id and e-mail only, so a wrong id in the sheet enrols the wrong student; names are not cross-checked. (3) Invites are matched at first sign-in by e-mail; if the e-mail in the sheet is not the one the student signs in with, the invite stays unclaimed and the student is not enrolled. (4) `frontend/src/features/auth/Login.tsx` is modified in the working tree by someone else and was not touched here. (5) The one-open-session migration from the earlier entry is still not applied to Supabase.

## 2026-11-05 — Roster Import: Section ("ตอน") Check Added to the Wrong-Course Dialog

- **Status:** Implemented and verified by automated tests and a browser run against a simulated backend. The section reader was written without a real registrar sheet (none exists in the repository), so it is deliberately conservative; confirm it against a real file before relying on it.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request (follow-up to the entry "Roster Import Walk-Through and 'Wrong Course' Notice Dialog").
- **Objective:** Also reject a roster that belongs to another section of the same course, using the same dialog text ("ใบรายชื่อนี้ไม่ตรงกับรายวิชา กรุณาลองใหม่"), with the section numbers shown as detail.
- **Files or components changed:**
  - `backend/services/roster_import_service.py`: `ParsedRoster.detected_section` (optional field, default `None`); `_extract_section` reads a section number from the lines above the table header only (keywords `ตอนเรียน`, `ตอน`, `Section`, `Sec` followed directly by the number, leading zeros allowed); `roster_section_mismatch` and `roster_mismatch_reason` (returns `"course"`, `"section"` or `None`, course first). Existing functions untouched.
  - `backend/routers/teacher.py`: preview and commit use `roster_mismatch_reason`; preview adds `mismatch_reason`, `expected_section` and `detected.section`; the blocking-error text names the section when that is the cause; no database matching and no rows are returned for a mismatch.
  - `backend/tests/test_roster_course_mismatch.py`: 10 more tests (section on the course line, on its own line, leading zeros, absent section, table header and student rows never read as a section, words like "Security" ignored, matching and non-matching sections, unusable course section, reason precedence, endpoint reason).
  - `frontend/src/features/teacher/ImportStudents.tsx`: the dialog detail shows "ตอนในไฟล์ … · ตอนของรายวิชานี้ …" for a section mismatch and the course codes otherwise.
- **Implementation rationale:** A section is compared only when a number is printed right after a section keyword above the table; otherwise the file is accepted as before, so an unfamiliar sheet layout can never block a correct import. Only lines above the header are scanned, so the "กลุ่มเรียน" column and student rows cannot be mistaken for a section. The course code is checked first because a different course makes the section irrelevant.
- **Security and privacy impact:** Same as the previous entry: a mismatching file triggers no queries on accounts, invites or enrollments and returns no rows. No secret or personal data was added to the code, tests or this log (placeholder ids only).
- **Database or deployment impact:** None for the database. Backend and frontend redeploy required.
- **Verification performed:** Backend `python -m unittest discover tests`: 176 tests, 175 pass; the single error is the pre-existing `test_thai_user_and_deployment_guides_exist` (needs the deleted `docs/USER_GUIDE_TH.md`). Frontend (Node 22): `npm run lint` clean, `tsc -b` exit 0, `npm run build` succeeds. In the built-in browser the real import page, fed a simulated "wrong section" answer, opened the dialog with the section detail and cleared the chosen file; the temporary page and server were removed.
- **Remaining risks or handoff work:** (1) Not tried on a real registrar sheet; if the section is printed in another form (for example inside a table cell or only as "กลุ่ม 3"), it is simply not detected and the file is accepted, as before. (2) If a real sheet prints a different number that is not the course section after one of the keywords, a correct file could be rejected; the dialog shows both numbers so the teacher can tell. (3) Earlier open items remain: one-open-session migration not applied; roster rows are matched by student id and e-mail only; `Login.tsx` has uncommitted changes by someone else.

## 2026-11-05 — Roster Import: Verified Against Real Registrar Sheets and Added a Layout Regression Test

- **Status:** Verified with the owner's real sample sheets; one test file extended; no application code changed.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Re-run the roster import and the new section check on real registrar exports instead of the guessed layout, and lock the real layout into a regression test.
- **Files or components changed:** `backend/tests/test_roster_course_mismatch.py` only (5 tests; helper `registrar_sheet` builds a synthetic workbook with fake names and ids). No source file changed, because the existing parser already handled the real layout.
- **What the real sheets look like (structure only, no personal data recorded):** a title block; line 4 reads `วิชา <code> <name> <credits written like 3(2-3-5)> ตอน <section>` followed by the instructor in another cell; class time and exam time lines; two blank rows; a two-line header (`เลขประจำตัว` over `นักศึกษา`, `ชื่อ - สกุล`, `กลุ่มเรียน`, `สัปดาห์` with week numbers 1–16 on the second header line); student ids written with dashes (`NN-NNNNNN-NNNN-N`); a group value such as `<group code> รอบเช้า`; and a print footer.
- **Verification performed:** The real parser was run on the three attached sheets (two 30-student sheets and one 35-student sheet; semester 1/2569, section 1). For all three: header found on row 8; course code, course name and section read correctly; every id converted to 13 digits; zero rows with errors; derived study years looked right (for example every student admitted in 2566 gets year 4 in 2569); the only warning was the expected "e-mail built from the student id". The mismatch rule returned no error for the right course and section, `section` for another section and `course` for another course. Backend suite: 181 tests, 180 pass; the single error is the pre-existing `test_thai_user_and_deployment_guides_exist` (needs the deleted `docs/USER_GUIDE_TH.md`). No frontend change in this entry.
- **Security and privacy impact:** None to the system. While exploring, the helper command listed the whole sample folder and printed real names and ids to the assistant's local terminal output, and opened two extra sheets in that folder that were not attached; nothing from them was written to the repository, tests or this log. Tests use invented names and ids only.
- **Database or deployment impact:** None.
- **Remaining risks or handoff work:** (1) The sheets contain real personal data in `Project/Source/`; keep that folder out of Git and out of release bundles (it is outside the repository directory, but confirm before moving it inside). (2) The section is read from the course line only when it is written after the word `ตอน`, which matches all samples seen. (3) Student matching still uses student id and e-mail only (names are not compared). (4) Earlier open items remain: the one-open-session migration is not applied; `Login.tsx` has uncommitted changes by someone else.

## 2026-11-05 — Diagnosis: Wrong-Course Dialog Not Appearing Because the Local Backend Was Stale

- **Status:** Diagnosis only; no repository file changed. The owner reported that the roster import page still showed the old behaviour (red "cannot import" footer and a 35-row preview) with no dialog.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Finding:** The local backend (`uvicorn main:app --host 127.0.0.1 --port 8080`, started by `start_all.sh`) was launched at 13:33 and runs without `--reload`; the roster-import changes were saved at 14:11, so the process still ran the old code. The local Vite server (HMR) already served the new page, so the new frontend talked to the old backend: the preview answer had no `course_mismatch` flag and still returned the rows, hence no dialog. The old Docker staging container on port 8000 also still runs old code, and any deployed site needs a redeploy.
- **Verification performed:** Process start times compared with file modification times; the dev frontend on port 5181 confirmed to serve `NoticeDialog` and `course_mismatch`; the new backend logic run in-process on a real sample sheet returned `course_mismatch = true` with 0 rows for a wrong course (`mismatch_reason = course`) and for a wrong section (`section`), and `ready = true` with 35 rows for the matching course and section. Only flags and counts were printed; no personal data.
- **Handoff:** Restart the local stack (`start_all.sh`) after any backend edit. Adding `--reload` to the dev command in `start_all.sh` would avoid this, but that launcher has uncommitted changes by someone else, so it was left untouched pending the owner's decision. Status of the Impeccable `init` request: interrupted by the owner before the interview; `PRODUCT.md` not written.

## 2026-11-05 — Roster Import: Remove Problem Rows From One Import Run (Confirm Dialog)

- **Status:** Implemented and verified by automated tests and a browser run against a simulated backend. Not exercised with the live Supabase project. The local backend and any deployed backend must be restarted or redeployed to pick up the change (see the previous diagnosis entry).
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** On the import preview, let a teacher remove only the people who have a problem from this import, without editing the uploaded roster file, behind a confirmation dialog with "ตกลง" and "ยกเลิก". Also confirmed that when every row passes, the preview lists the people before anything is imported.
- **Files or components changed:**
  - `backend/services/roster_import_service.py`: `parse_roster_file` and `_rows_to_roster` accept `excluded_rows` (file row numbers). Excluded rows are skipped before duplicate and account checks, so removing one of two rows with the same id clears the other; `ParsedRoster.excluded_count`; a clear 400 message if nothing is left to import. Nothing removed from existing behaviour.
  - `backend/routers/teacher.py`: preview and commit take an optional form field `excluded_rows` (JSON array of integers, 1–5000, at most 1000 entries; anything else returns 400 "รายการแถวที่ตัดออกไม่ถูกต้อง"); `_parse_and_resolve_roster` passes it on; the preview response adds `excluded_count`.
  - New `backend/tests/test_roster_exclude_rows.py` (15 tests: flags before exclusion, removal and counting, duplicate cleared, unknown rows ignored, everything excluded, file bytes and SHA-256 unchanged, field validation, preview and commit endpoints, commit sends only the remaining rows to the database RPC, invalid rows still block commit when not excluded).
  - `frontend/src/features/teacher/ImportStudents.tsx`: a "ลบออกจากการนำเข้า" button appears only under rows that have errors; it opens the existing `ConfirmDialog` (title "ลบรายชื่อนี้ออกจากการนำเข้าหรือไม่", buttons "ตกลง" and "ยกเลิก") naming the person; on "ตกลง" the row number is added to a local list and the file is re-checked with it, staying on the same table page; a notice shows how many were removed with a "คืนรายการที่ลบออก" button; the list is sent again on commit and cleared when a new file is chosen or the import is reset; a failed re-check restores the previous list.
- **Implementation rationale:** The uploaded file is never changed; only the list of row numbers travels with the request, and the server re-reads the same file and applies the same list at commit, so the SHA-256 guard still proves the file is unchanged. Exclusion is applied during parsing rather than by filtering the preview so that duplicate and account-conflict results are recomputed. The server accepts exclusion of any existing row number (the page only offers it on problem rows) because excluding can only reduce what is imported. No database change was needed: the existing atomic RPC simply receives fewer rows.
- **Security and privacy impact:** The new field is strictly validated (type, range, count) and cannot widen what is imported; authorization, file validation, SHA-256 check and the course/section guard run unchanged. The confirm dialog shows the person's name and id only to the teacher who uploaded them. The audit-log row written by the database function records the number of rows imported, not which rows were removed. Tests use invented names and ids; nothing personal was written to this log.
- **Database or deployment impact:** None for the database. Backend and frontend redeploy required; the local `uvicorn` has no auto-reload, so restart `start_all.sh`.
- **Verification performed:** Backend `python -m unittest discover tests`: 195 tests, 194 pass; the single error is the pre-existing `test_thai_user_and_deployment_guides_exist` (needs the deleted `docs/USER_GUIDE_TH.md`). Frontend (Node 22): `npm run lint` clean, `tsc -b` exit 0, `npm run build` succeeds. In the built-in browser, the real import page fed by a simulated backend: the delete button appeared only on the problem row; "ยกเลิก" closed the dialog without a new request; "ตกลง" re-checked with `excluded_rows=[5]`, the problem row disappeared, the import button became enabled with the new count, and the commit request carried the same list; "คืนรายการที่ลบออก" brought the row back; choosing a new file reset the list. The temporary page and server were removed.
- **Remaining risks or handoff work:** (1) Removing a row does not remember anything after a page reload; the teacher repeats it. (2) The audit log does not list which rows were skipped; add it later if auditors need it (would need a database function change). (3) Earlier open items remain: one-open-session migration not applied; the Impeccable `init` request was interrupted and `PRODUCT.md` is not written; `Login.tsx` has uncommitted changes by someone else.

## 2026-11-05 — Production Release Preparation (v1.1.0, local only, nothing deployed)

- **Status:** Release commit and tag prepared locally; **not pushed and not deployed**. Release verification is green for code and red for dependency audits that were already failing before this release. Waiting on the owner's decision about the audits and on the owner running the production steps (the assistant has no access to the mini PC, Vercel or the production Supabase project from this machine).
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Take the work of 2026-11-04 and 2026-11-05 (QR countdown removal, Picture-in-Picture QR and auto-close, one-open-session index, duplicate-course guard, study year from e-mail, roster import wrong-course/section notice and removal of problem rows, scrollbar fix) to production in the order the deployment guide requires, replacing the old release.
- **Files or components changed:** Git only: branch `release/2026-11-05` created from `main` (`4826487`), one commit and the annotated tag `v1.1.0` on it. Included, by the owner's choice: all files from the entries above, `frontend/src/features/auth/Login.tsx` (college name line), `start_all.sh` (local dev port 5181), root `package.json` and `package-lock.json` (Supabase CLI devDependency) and `scripts/check_supabase_release.sh` (ignores the Pro-only leaked-password advisor). Deliberately **not** included and still uncommitted in the working tree: the deletion of seven files under `docs/` (they include the deployment guides) and the `supabase/.temp/*` CLI cache changes. `frontend/src/features/teacher/ImportStudents.tsx` also carries an editor reformat of the whole file made by someone else before this work (whitespace and line wrapping only; checked that no identifier from the previous version disappeared).
- **Verification performed:** In a separate clean checkout of the tagged commit (dependencies and the local, Git-ignored env file linked in), `scripts/verify_release.sh` was run: whitespace check, InsightFace model checksums, backend `unittest` 195 tests all passing (including the docs-existence test, which only fails in the owner's working tree because of the uncommitted `docs/` deletion), `pip check`, frontend lint, nine frontend test scripts and the production build all passed; additionally `npm run test:session-deadline` (not part of the script) and the OCR service `test:security` and `doctor` passed. The script then stopped at `npm audit`: the frontend reports 24 findings (8 high) and the OCR service 5 (1 critical, 2 high). Neither lockfile is changed by this release, so these are advisories published since the previous release. In frontend production dependencies the high ones are `axios` and its dependency `follow-redirects` (shipped to browsers), plus `vite` and `source-map-js` (build and dev tooling; their code is not in the built bundle). In the OCR service: `proxy-addr` (critical, IP spoofing through trust subnets), `body-parser` and `multer` (high, denial of service), `express` and `qs` (moderate). `scripts/check_supabase_release.sh` was not run (needs the linked production project).
- **Required order for the owner (from the deployment guide):** (1) decide on the audit findings; (2) on the production database, check for duplicate open sessions and list pending migrations before applying `20261105090000_one_open_session_per_course.sql` (it aborts safely, changing nothing, if duplicates exist); (3) push branch and tag, open a pull request so CI runs; (4) mini PC: fetch tags, check out `v1.1.0`, set `RELEASE_ID`, `docker compose config/build/up`, check `/health/ready` and the public `/health/live`; (5) merge to `main` so Vercel builds the frontend; (6) acceptance run and removal of the temporary Supabase Redirect URLs added for local testing.
- **Security and privacy impact:** No secret was read into this log or the commit; the local env file was only linked, never copied or printed. Open production risk to check separately: the live `handle_new_user()` in Supabase may still be the first SQL-Editor version (any `*.kmutnb.ac.th` address becomes a teacher, `@gmail.com` becomes a student); run the read-only checks given earlier and apply the repository version if so.
- **Database or deployment impact:** One new migration (not applied anywhere). Backend and frontend both need the new release; the frontend tolerates an old backend and the backend tolerates an old frontend, but the roster dialog, auto-close and year features need both. No new environment variable. `QR_REFRESH_SECONDS` in the production backend env must be 12 (allowed range 10–15).
- **Rollback:** Backend: check out the previous release or commit on the mini PC, set `RELEASE_ID`, `docker compose up -d`. Frontend: promote the previous Vercel deployment. Database: leave the indexes (additive); if needed drop `attendance_sessions_one_open_per_course_idx` and `attendance_sessions_one_open_per_opener_idx` with a new reviewed migration.
- **Remaining risks or handoff work:** Decision on the 24 + 5 audit findings (fixing them is a separate change to production dependencies that should be built and tested on its own); `ImportStudents.tsx` reformat noise in the diff; the working directory is now on branch `release/2026-11-05` (switching back to `main` would revert the uncommitted-to-main work in the files, so merge first).

## 2026-11-05 — Correction: Release Branch History After an Accidental Amend

- **Actor:** Claude Code (Claude Sonnet 5.5).
- **What happened:** After the release commit `b1d76d2` (tagged `v1.1.0`), the owner committed `bc759fa` "rm and backup doc, improve supabase" on the same branch `release/2026-11-05` (deletes the seven files under `docs/` and updates `supabase/.temp/*`). The assistant then ran `git commit --amend` assuming `HEAD` was its own commit, which rewrote the owner's commit into `3ca5a8b` by adding its previous log entry, and re-created the tag `v1.1.0` on that wrong commit. Nothing had been pushed.
- **Repair:** The branch was reset back to the owner's original `bc759fa` (unchanged hash, unchanged content), the tag `v1.1.0` was moved back to the verified release commit `b1d76d2`, and the log text (this entry and the one above it) was committed as a separate new commit on top of `bc759fa`. The amended commit `3ca5a8b` is no longer on any branch.
- **Effect on the preparation entry above:** Its statement that the `docs/` deletion and `supabase/.temp` changes were "not included and still uncommitted" is no longer true: they are now committed on this branch by the owner. The release verification in that entry was run on `b1d76d2` only; it was **not** repeated on the branch tip. With `docs/` removed, the backend test `test_thai_user_and_deployment_guides_exist` (reads `docs/USER_GUIDE_TH.md` and other guides) and therefore `scripts/verify_release.sh` will fail on the tip unless that test is changed or the docs are kept. The tag `v1.1.0` must be re-created on the final tip after that decision and a new verification run.
- **Lesson:** Check `git log -1` (author and time) before any `--amend`; never amend a commit the assistant did not create in the same step.

## 2026-11-05 — Dependency Security Update Before Production (frontend and OCR service)

- **Status:** Updated, tested and committed on branch `release/2026-11-05`; not pushed or deployed. The owner chose to update packages before releasing.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Clear the `npm audit` findings that stopped `scripts/verify_release.sh` (frontend 24, OCR service 5 including one critical) without breaking the application.
- **Files or components changed:** `frontend/package-lock.json`, `ocr-service/package-lock.json`; and three version pins that blocked `npm audit fix`: `frontend/package.json` override `fast-uri` 3.1.6 → 3.1.9, `ocr-service/package.json` `multer` 2.3.0 → 2.5.0 and override `qs` 6.16.0 → 6.17.1 (all inside the same major versions). No source file changed. Done in a separate checkout so the owner's running dev servers and `node_modules` were not touched.
- **Notable version moves:** frontend `axios` 1.19.0 → 1.21.0, `follow-redirects` 1.16.0 → 1.16.2, `vite` 8.1.0 → 8.3.6, `source-map-js` 1.2.1 → 1.2.2, `postcss`, `nanoid`, `picomatch`, `zod`-related fixes and the Rolldown bundler packages 1.1.3 → 1.2.16; OCR `express` 4.22.2 → 4.22.3, `body-parser` 1.20.6 → 1.20.9, `proxy-addr` 2.0.7 → 2.0.8, `multer` 2.3.0 → 2.5.0, `qs` 6.17.1. No `--force` was used.
- **Audit result after the update:** OCR service 0 findings. Frontend: 0 critical, 0 high and 0 in production dependencies (`npm audit --omit=dev` finds 0); 15 remain (13 moderate, 2 low) and all are build or lint tooling (`glob`, `minimatch`, `deepmerge` inside ESLint and `workbox-build`/`vite-plugin-pwa`), not shipped to browsers. npm's suggested "fixes" for them are downgrades of ESLint and the PWA plugin, so they were not applied. `scripts/verify_release.sh` still stops at its frontend `npm audit --audit-level=moderate` step for this reason; decision for the owner: accept those dev-only items, or change the gate to audit production dependencies only, or wait for upstream releases.
- **Verification performed (Node 22.23.2, isolated checkout):** frontend lint, the ten test scripts (including `test:session-deadline`) and the production build all pass; OCR `test:security` and `doctor` pass; an OCR server started on a spare port with a throwaway token answered `/health` 200, rejected a missing token with 401, and answered a non-image upload and a wrong form-field name with clean 415 JSON errors and stayed alive (multer 2.5.0 path). The built frontend, served with `vite preview`, rendered the login page with the Google button and the new college line. In that in-app browser service-worker registration fails for the old and the new build alike, so it is an environment limit, not caused by the update. Not tested: real student-card OCR (no sample card image available) and the sign-in flow. The backend (Python) was not part of this change.
- **Security and privacy impact:** Removes the known high and critical advisories in shipped code (`axios`, `follow-redirects`; OCR `proxy-addr`, `body-parser`, `multer`). No secret was read into this log; the local env file was only linked into the temporary build and printed nowhere.
- **Database or deployment impact:** None for the database. The release must be rebuilt: the frontend on Vercel (`npm ci` from the new lockfile) and the OCR image on the mini PC (Docker build). After pulling this commit locally run `npm ci` in `frontend` and `ocr-service` (stop the dev servers first) so `node_modules` matches the lockfiles.
- **Remaining risks or handoff work:** (1) Tag `v1.1.0` still points to the earlier verified commit `b1d76d2` and does not include this update or the owner's `docs/` removal; it must be re-created on the final tip after the owner decides about the removed docs (the test `test_thai_user_and_deployment_guides_exist` fails without them) and a fresh verification. (2) OCR on real cards and the full sign-in flow need a manual check after deployment. (3) Earlier open items remain: migration `20261105090000` not applied, Supabase `handle_new_user()` live version unchecked.

## 2026-11-05 — Push to `main` Requested; Push Blocked by Missing GitHub Credentials

- **Status:** Not pushed. The owner asked to publish the release to `main` (Vercel builds the frontend from `main`; the mini PC clones the repository). The push from this machine failed before reaching the server, so `origin/main` is unchanged (`4826487`).
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **What was checked before pushing:** `origin/main` fetched and confirmed to be an ancestor of the branch tip, so the push is a plain fast-forward (no force needed). Four commits would be published: the release commit, the owner's `docs/`-removal commit, the log commit and the dependency update. A scan of every added line (lockfiles and removed docs excluded) found no keys, tokens, private keys, `.env` files, private hostnames or real student identifiers; the 13-digit numbers in tests are invented or were already in the repository. The backend suite on the exact tip passes except `test_thai_user_and_deployment_guides_exist`, which fails because the `docs/` files were removed by the owner's commit. The repository is readable without credentials, so everything pushed there is public.
- **Result of the attempt:** `git push origin release/2026-11-05:main` stopped with "could not read Username for https://github.com" (no credential helper or GitHub CLI login in this environment). No credential was looked for or used.
- **Local state prepared for the owner:** local `main` was fast-forwarded to the branch tip so the owner can publish with one command from a terminal that has GitHub access: `git push origin main`. The local tag `v1.1.0` is stale (it points at the first release commit `b1d76d2`); it must not be pushed as is.
- **Consequences to expect after the push:** Vercel starts a Production build of the frontend immediately; the repository's CI workflow runs on pull requests and on `demo3.1`, not on a push to `main`, so no automatic checks will run. The new frontend works with the old backend (new features that need the backend simply do not appear) and the new backend works with the old frontend, but the migration `20261105090000` is still unapplied and the mini PC still runs the old release until updated.
- **Remaining risks or handoff work:** Publish, then update the mini PC (`git fetch`, check out the new `main` commit or a new tag, set `RELEASE_ID`, `docker compose build` and `up -d`, check `/health/ready`), apply the migration after checking for duplicate open sessions, remove the temporary Supabase Redirect URLs, and run the acceptance checks. The `docs/` removal means the deployment guide is no longer in the repository; the owner keeps a backup copy.

## 2026-11-05 — Release Fixes: Docs Test, Audit Gate and Release Script (verification now green)

- **Status:** Implemented, committed (`0476629`) and verified by the project's own full release script in a clean checkout. Still **not pushed** (see the previous entry: no GitHub credentials on this machine).
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request to fix everything before pushing.
- **Objective:** Make `scripts/verify_release.sh` pass on the exact commit that will go to `main`, without lowering any check.
- **Files or components changed:**
  - `backend/tests/test_launcher_security.py`: `test_thai_user_and_deployment_guides_exist` is now skipped (with a stated reason) when the guides under `docs/` are absent. `docs/` is listed in `.gitignore` and the owner removed the tracked guides in `bc759fa`, so a clean checkout can never contain them; the content checks still run for anyone who keeps the guides locally. Nothing was deleted from the test.
  - `README.md`, `deployment/README.md`, `deployment/docker/README_TH.md`: the pointers to `docs/*.md` now say the guides are local files kept by the maintainer, not in Git. (`deployment/README.md` also lists `docs/MAIN_PRODUCTION_DEPLOYMENT_VERCEL_DOCKER_NGINX_TH.md`, which was not among the removed files and may never have been committed; left as listed.)
  - `frontend/package.json` and `frontend/package-lock.json`: scoped overrides `minimatch@^10.0.0` → 11.0.4 (ESLint and typescript-eslint chain) and `workbox-build` → `glob` 14.0.3 (the PWA build tool), added to the existing `fast-uri` override.
  - `scripts/verify_release.sh`: also runs `npm run test:session-deadline` (the new test was not wired into the script).
- **Evidence the overrides are safe:** a production build before and after the overrides produced the same 14 output files, the same 70-entry service-worker precache list and the same URL list in `sw.js`; ESLint 10 still runs and still fails on an injected unused variable; all ten frontend test scripts pass. Findings: frontend 0 critical, 0 high, 0 moderate, 4 low (`deepmerge` and the plugins that depend on it; the newest release of `deepmerge` is still in the vulnerable range, so no fix exists); production-only audit 0; OCR service 0.
- **Verification performed:** In a clean checkout of `0476629`, with `npm ci` from the committed lockfiles and the local Git-ignored env files linked in, `scripts/verify_release.sh` finished with exit code 0: whitespace check, model checksums, backend 195 tests OK (1 skipped, the docs one), `pip check`, frontend lint, ten test scripts, build, frontend and OCR audits at the moderate level, OCR `test:security` and `doctor`. `scripts/check_supabase_release.sh` was not run (needs the linked production project).
- **Security and privacy impact:** The audit gate was fixed by updating or pinning packages, not by relaxing it. No secret was printed or copied; env files were only linked into the temporary checkout.
- **Database or deployment impact:** None for the database. Frontend (Vercel) builds from the new lockfile; nothing else changes at deploy time.
- **Remaining risks or handoff work:** Push is still pending (`git push origin main` from a terminal with GitHub access). After the push: update the mini PC, apply migration `20261105090000` after the duplicate check, remove the temporary Supabase Redirect URLs, run the acceptance checks, and verify the live `handle_new_user()`. CI (`.github/workflows/ci.yml`) only runs on pull requests and on `demo3.1`; adding `main` to its push trigger would run the same checks on every push to `main` (not changed here). The local tag `v1.1.0` was re-created on the final tip; it has not been pushed.

## 2026-11-05 — Thesis Report (Thai, 5 chapters) Written into the Word Template

- **Status:** Done. The result is a Word file outside the repository. No project source, test, migration, configuration or deployment file was changed for this task.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Write the degree thesis report for this project in Thai (1 Introduction, 2 Theory and tools, 3 Method, 4 Results, 5 Conclusion), following the supplied sample documents, inside the owner's template `โครงเล่มจริง ver3.docx`.
- **Files or components changed:** New file `/home/cortanadesu/Documents/Claude/โครงเล่มจริง ver4.docx`. The original `ver3.docx` and the sample PDFs were only read and are unchanged. The build scripts (document editing, diagram drawing, reference list) live in the session scratchpad, not in the repository.
- **Decisions made with the owner:** page size A4 with the layout of ver3 and the samples (two-column body, TH Sarabun PSK) because the 55-page guide describes a different layout; Chapter 4 reports only what can be verified because the repository holds no measurements (accuracy, speed, satisfaction); diagrams are drawn and inserted, screenshots are left as dashed frames for the owner to fill; abstracts (Thai and English) are rewritten; table of contents and appendix are not touched.
- **Content and rationale:** Every technical statement was checked against code, migrations, tests and the Thai SRS (thresholds, token lifetimes, liveness steps, QR rotation, roster rules, study-year rule, role model, deployment layout, count of 18 tables with RLS, 195 backend tests of which 194 pass and 1 is skipped, lint/tests/build, `verify_release.sh`, npm audit results). Seven figures were drawn (architecture, ER, enrolment, liveness, attendance, roster import, deployment), 17 screenshot frames (figures 8–24), 5 tables, 26 numbered references. All 26 reference URLs were opened and their titles checked; pages that refused automated access were replaced. Unverifiable wording was removed or softened.
- **Security and privacy impact:** No secrets, tokens, personal data or biometric data were put into the report or this log. The real roster sheets were used only as aggregate counts (course code, section, number of rows, number of error rows); no names or student ids appear. Deployment text names no private hostname, address or key.
- **Database or deployment impact:** None.
- **Verification performed:** The output opens as a valid package (zip test passes, all 41 XML parts well formed, no missing relationship ids, every section is A4 11906×16838). It was rendered through LibreOffice to 29 A4 pages and every page was reviewed (abstracts, body, figures, tables, references, biography). The original ver3 file is byte-identical (checked by hash).
- **Remaining risks or handoff work:** (1) Layout was checked in LibreOffice only, not in Microsoft Word; fonts may reflow slightly. (2) Figures 8–24 are empty frames for the owner's screenshots. (3) Chapter 4 has no measured accuracy or user-satisfaction data; the acknowledgment text in the template still mentions sample-group data and should be reviewed by the owner. (4) The deployment description follows the deployment guide and was not re-checked against the live servers; the live `handle_new_user()` in Supabase is also unchecked. (5) Citations were added into the authors' existing paragraphs; the owner should confirm that is acceptable. (6) Earlier open items remain (push to `main`, migration `20261105090000`, mini PC update).

## 2026-11-05 — Removed Automated "Co-Authored-By" Trailers from Local History (push pending)

- **Status:** Local history rewritten and verified; **not yet published**. `origin/main` still holds the old commits until the owner force-pushes.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Stop an automated assistant account from appearing as a contributor on the GitHub repository. GitHub derives contributors from commit authors and from `Co-Authored-By:` trailers in commit messages; six release commits carried such a trailer.
- **Files or components changed:** No file content changed. Only commit messages of the six release commits (and the later commits built on them) were rewritten, so every commit after the first of them received a new hash. Local branches `main` and `release/2026-11-05` and the local annotated tag `v1.1.0` (same message, now at the new tip) were moved to the rewritten history. A safety branch `backup/pre-trailer-removal-2026-11-05` keeps the old history locally.
- **Implementation rationale:** The trailer lives in the commit message, so the only way to remove it is to rewrite those commits (`git filter-branch --msg-filter`, deleting only the trailer line). Authors, committers, dates and trees were left untouched. The log text that names the assistant as actor is plain text and does not create a contributor, so earlier log entries were not edited.
- **Security and privacy impact:** None; no secrets or personal data involved. After the force-push, the old commit hashes can remain reachable on GitHub by direct URL for a while until garbage collection.
- **Database or deployment impact:** None for the database. Vercel will rebuild from the new `main` after the force-push; the mini PC must re-fetch and hard-reset to the new `main` (it was on the old hashes if already updated). Anyone with a clone must re-clone or reset.
- **Verification performed:** `git diff --stat backup/pre-trailer-removal-2026-11-05 main` is empty (file contents identical). A search of the messages of `main`, `release/2026-11-05` and `v1.1.0` finds 0 occurrences of the trailer or the assistant's e-mail domain. Commit authors on `main` are now only the project members.
- **Remaining risks or handoff work:** (1) Owner must run `git push --force-with-lease=main:3e661e1 origin main` and then `git push origin v1.1.0` (the tag was never pushed). (2) GitHub's contributor list can take minutes to hours to refresh. (3) Future assistant commits must not add the trailer. (4) Delete the local backup branch once the push is confirmed.

## 2026-11-05 — New Step-by-Step Thai Deployment Guide (Vercel + Mini PC)

- **Status:** Done. Documentation only; the new file is Git-ignored (under `docs/`), so it is a local maintainer file and is not part of any commit.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Replace an unclear older deployment note with a full rewrite that explains, in order, how to prepare Supabase and the Mini PC, clone `main`, create and fill the configuration files, start Docker, set up DNS/TLS/Nginx, configure Vercel, test, update and roll back.
- **Files or components changed:** New `docs/HYBRID_VERCEL_MINIPC_DEPLOYMENT_TH_V2.md`. The older guide (outside the repository) and every project file were left unchanged.
- **Implementation rationale:** Every command, variable name and file path was taken from the current `deployment/*.example` templates, `compose.production.yml`, `scripts/start_main_production.sh`, `scripts/verify_face_models.sh` and the Dockerfiles. Differences from the older guide that were corrected: the model checksum manifest lists `1k3d68.onnx`, `det_500m.onnx` and `w600k_mbf.onnx` (the old text named a different file); the repository now has 21 migrations, the newest being `20261105090000`; the one-command startup script requires branch `main`, a clean working tree and Docker access without `sudo`, so first install uses explicit `docker compose` steps and the script is for updates; env files need group-read access for the deploy user; the model directory must be world-readable for the container user; rollback uses `sudo env RELEASE_ID=...` because plain `sudo` drops variables.
- **Security and privacy impact:** The guide contains placeholders only. A pattern scan for JWT-like, `sk_`-like and 64-hex strings found none. It tells readers to keep service keys on the Mini PC only, never in Vercel or Git, and to generate three distinct secrets.
- **Database or deployment impact:** None by itself. It documents applying migration `20261105090000` before the new backend.
- **Verification performed:** Statements were checked against the repository files listed above, and the public readability of the GitHub repository was confirmed with `git ls-remote` without credentials. The procedures were **not** executed on a real Mini PC, Vercel project or Supabase project.
- **Remaining risks or handoff work:** (1) Run the guide once on the real Mini PC and correct any step that differs. (2) `docs/` is not in Git, so copy the file to the Mini PC or read it from the development machine. (3) The optional Vercel CSP step should be tested in a browser console before relying on it. (4) The model licence decision in `THIRD_PARTY_NOTICES.md` is still the owner's to document.

## 2026-11-05 — New Thai Deployment Guide (Vercel + Mini PC Docker + Cloudflare Tunnel)

- **Status:** Done. Documentation only; no project source, test, migration, configuration or deployment file in the repository was changed.
- **Actor:** Claude Code (Claude Sonnet 5.5), at the project owner's request.
- **Objective:** Replace the unclear hybrid deployment guide with a detailed step-by-step Thai guide that expands the sections on cloning the repository, preparing the configuration files and installing, and that uses Cloudflare Tunnel instead of certbot, checked against the real project.
- **Files or components changed:** New file `DEPLOYMENT_MINIPC_CLOUDFLARE_TUNNEL_TH.md` in the owner's local `Project/Source/markdown/` folder (outside this repository, next to the old guide). The old guide was not edited or removed. `docs/` stays Git-ignored, so the guide is not committed.
- **Content decisions:** Public HTTPS is handled by Cloudflare; the Mini PC opens no inbound port. Host Nginx is kept but listens only on `127.0.0.1:8080` over plain HTTP, reads the visitor address from `CF-Connecting-IP` (trusted only from loopback) and keeps the existing rate limits, 32 MiB body cap, `/health/ready` restriction and 404 default. Two tunnel methods are described (dashboard token, recommended; command line with `config.yml`). Env files are created from the repository templates with `install -m 0640 -o root -g <deploy user>` so both manual `sudo docker compose` and `scripts/start_main_production.sh` work. The release id is the short Git SHA of `main`.
- **Corrections to the old guide found while checking:** the face-model checksum list is `1k3d68.onnx`, `det_500m.onnx`, `w600k_mbf.onnx` (the old guide named `2d106det.onnx`); the repository has 21 migrations, not 19; `production_preflight.py` expects a loopback OCR URL, so it does not fit the Docker layout (`http://ocr:3001`); the new migration `20261105090000` aborts if duplicate open sessions exist, so the guide adds a read-only duplicate check before applying it.
- **Security and privacy impact:** No secrets, tokens, real hostnames or personal data were written into the guide or this log (placeholders only; the public repository URL is the only real address used). The guide states that Cloudflare terminates TLS and therefore sees face frames in transit, and tells the owner to get institutional approval; it also states the tunnel token/credentials are secrets.
- **Database or deployment impact:** None performed. The guide describes a production migration and a Mini PC install that the owner has to run.
- **Verification performed:** Every repository path named in the guide exists; `compose.production.yml` passes `docker compose config --quiet` with dummy values; the Nginx block keeps the template's limits and has balanced braces; Backend start-up checks and log messages quoted in the guide were read from `backend/core/config.py` and `backend/main.py`; Cloudflare commands and menu names were read from Cloudflare's official documentation on 5 Nov 2026 (including the 100 MB Free-plan upload limit and the `CF-Connecting-IP` definition).
- **Remaining risks or handoff work:** The steps were not run on a real Mini PC or against real Cloudflare/Vercel/Supabase accounts. `nginx -t` was not run (Nginx is not installed on the writing machine). Whether the tunnel forwards `CF-Connecting-IP` is not stated in Cloudflare's header page, so the guide makes a public `/health/ready` returning 403 and a real client IP in the Nginx log mandatory checks. The Vercel CSP template was not tested against every page. Dashboard menu names may change. The `v1.1.0` tag and the push to `main` are still pending from earlier entries.

## 2026-11-05 - Claude - Replace English abstract in thesis document ver4

- **Objective:** Replace the English Abstract in the thesis Word file with a translation of the Thai abstract text supplied by the user.
- **Files changed:** `/home/cortanadesu/Documents/Claude/โครงเล่มจริง ver4.docx` (document.xml, only the three English Abstract paragraphs). The Thai abstract, keywords, and all other parts are untouched. No repository source files changed.
- **Rationale:** The user supplied the final Thai wording; the English text was rewritten to follow it sentence by sentence. The earlier sentences about 195 automated tests and the note that accuracy and satisfaction were not measured were dropped because the supplied text does not contain them. The text now says the system met every development-plan item, as supplied.
- **Security/privacy impact:** None. No secrets, personal data, or student records involved.
- **Database/deployment impact:** None.
- **Verification:** Edited paragraph XML in place (formatting and styles kept); regenerated PDF with LibreOffice: 44 pages, same page layout as before, abstract still ends before the keywords block on the same page. A backup of the previous ver4 was kept in the session scratchpad.
- **Remaining risks/handoff:** The Thai abstract in the file may still differ from the supplied Thai text; it was not changed because only the English version was requested. The statement "meets every item in the development plan" is the user's claim and is not backed by a test count in the abstract.

## 2026-11-05 - Claude - Rewrite chapter 3 (วิธีการดำเนินงาน) of the thesis document ver4

- **Objective:** At the user's request, delete the existing chapter 3 of the thesis Word file and write it again in plain, human-sounding Thai with clear detail, based on the real project.
- **Files changed:** `/home/cortanadesu/Documents/Claude/โครงเล่มจริง ver4.docx` (same file edited in place; only the body between the heading "3.วิธีการดำเนินงาน" and the heading "4. ผลการดำเนินงาน"). No repository source files changed.
- **Implementation rationale:** New chapter has 14 sections (3.1 work steps, 3.2 users and rights with sub-sections for the three roles, 3.3 architecture, 3.4 database, 3.5 sign-in and rights, 3.6 face enrollment, 3.7 liveness, 3.8 QR + face check-in, 3.9 NFC and manual edit, 3.10 courses and roster import, 3.11 reports, 3.12 security and privacy, 3.13 deployment, 3.14 testing). The seven figures and three tables were kept in the same order (figures 1-7, tables 1-3) by reusing the existing drawing/table XML, so the numbering of chapters 4 and 5 and the reference list (including [24], [25], [21]) did not change. Wording was simplified to short sentences with the reason behind each design choice. Facts were re-checked against the code: QR refresh 12 s, challenge 420 s, face similarity 0.45, enrollment detection 0.60, passive PAD 0.65, prompt delay 0.5-1.4 s, roster limits 5 MB / 1,000 rows, 21 migrations, one open session per teacher, NFC registration limited to admin, NFC check-in for teacher/admin, support requests with attachments.
- **Security and privacy impact:** None. Text only; no secrets, student records, or personal data written. The text states that images are not stored and only the face vector is kept, which matches the code.
- **Database or deployment impact:** None.
- **Verification performed:** Compared the paragraph text before and after: everything before and after chapter 3 is identical. Rendered the document with LibreOffice: 45 pages (was 44), figures and tables appear in the right places in the two-column layout, no missing images. A backup of the previous file state is in the session scratchpad.
- **Remaining risks or handoff work:** Chapter 3 grew by about one page; the Word page breaks may differ slightly from LibreOffice. Figure drawings were not redrawn, so figure contents should be checked against the new text by the authors. Chapter 3 still says the Mini PC uses Cloudflare Tunnel with Nginx, which matches the new deployment guide but has not been run on a real machine. `log.md` is uncommitted.

## 2026-11-06 - Claude - Automatic teacher role for department mailboxes

- **Objective:** Let accounts signing in with `<name>@<department>.kmutnb.ac.th` receive the teacher role automatically, keep student mailboxes as students, and keep the admin role under the database owner's control. Requested by the project owner.
- **Files changed:** added `supabase/migrations/20261106120000_auto_teacher_for_department_domains.sql` and `backend/tests/test_teacher_domain_provisioning.py`; edited `README.md` (two sentences about invitations) and, outside the repository, `Source/markdown/DEPLOYMENT_MINIPC_CLOUDFLARE_TUNNEL_TH.md` (migration count 21 to 22, new section 3.6 with the role table and admin bootstrap). No Backend or Frontend source changed: `core/security.py` already accepts every `*.kmutnb.ac.th` address and reads the role from `profiles`, and `Login.tsx` already advertises `@<dept>.kmutnb.ac.th`.
- **Implementation rationale:** `handle_new_user()` is replaced with `create or replace` (same signature, `security definer`, empty search path, execute revoked). Decision order: non-KMUTNB rejected; an unclaimed invitation wins (so admin and roster invites keep working); `@email.kmutnb.ac.th` is a student (checked before the department rule because `email` is also a subdomain); `<name>@<subdomain>.kmutnb.ac.th` is a teacher unless the local part looks like a student id (`s?` plus 13 digits) or the subdomain, or a parent of it, is listed in the new `public.teacher_domain_exclusions` table; everything else, including the bare `kmutnb.ac.th` domain, still needs an invitation. The exclusion table is seeded with `email`, has RLS enabled with a deny-all policy and no grants to browser roles, so the database owner edits it with SQL. The admin role is never derived from an address. This partly reverses `20260827140100_require_teacher_invite`, which had made teacher sign-up invitation-only.
- **Security and privacy impact:** Anyone who holds a Google mailbox under a non-excluded KMUTNB subdomain becomes a teacher on first sign-in. A teacher can create courses and QR sessions and manage rosters of their own courses; admin powers are unchanged. The risk depends on KMUTNB issuing such mailboxes only to staff; any non-staff subdomain must be added to the exclusion table. Existing accounts are not changed. No secrets, tokens, real addresses, or student records were written to the log or the tests.
- **Database or deployment impact:** One new migration, NOT applied to production. It creates `public.teacher_domain_exclusions` and replaces `public.handle_new_user()`. The trigger on `auth.users` is not defined in the repository's migrations (the base schema is not in `supabase/migrations`), so the live trigger and function must be checked after applying. Rollback: re-run the function body from `20260828111609_temporary_admin_and_student_profile.sql`; the exclusion table can stay.
- **Verification performed:** Ran the migration against a throwaway Supabase Postgres 17 container (removed afterwards) with a minimal stand-in for `profiles`, `profile_invites`, `profile_invite_courses`, `enrollments` and an `after insert` trigger on `auth.users`; the full migration chain cannot be replayed because the baseline schema is not in the repository. Results: `x@cit`, `Name.S@eng`, and `a@x.cit` addresses became teacher; `s<13 digits>@email` became student with the id extracted; `s<13 digits>@cit` and `<13 digits>@eng` rejected; `@email` with a non-student local part rejected; `@a.email` and an excluded `alumni` subdomain rejected; bare `@kmutnb.ac.th` rejected; an invitation with role admin yielded admin and was marked claimed, including on a department address; `cit.kmutnb.ac.th.evil.com`, `evilkmutnb.ac.th`, `gmail.com` rejected; a rejected sign-up left no profile row; the `anon` role could not read the exclusion table. Backend suite: 202 tests, OK, 1 skipped (previously 195; 7 new). `psql` was used only against the throwaway container.
- **Remaining risks or handoff work:** Apply the migration to production by hand after review (`supabase db push --dry-run` first) and check the live `handle_new_user()` and its trigger. Set the first admin with the SQL in section 3.6 of the deployment guide. Confirm with the university which subdomains are not staff. The admin promotion `update` was documented but not executed in the test container. The thesis chapter 3.5 still says teachers need an invitation and needs a wording update by the owner. `log.md` and the new files are uncommitted.

## 2026-11-06 - Claude - Thesis text updated for automatic teacher role

- **Objective:** Bring the thesis document in line with the sign-in role rules implemented in `20261106120000_auto_teacher_for_department_domains.sql` (teacher role from department mailboxes, admin role set by the database owner).
- **Files or components changed:** Created a new Word file `โครงเล่มจริง ver43.docx` in the user's documents folder, copied from `โครงเล่มจริง ver42.docx` (which was open in an editor, so it was left untouched). Edited paragraphs: 3.2.2 teacher, 3.2.3 administrator, the database tables paragraph and the `profile_invites` row of Table 2, section 3.5 (rewritten as the five-step decision order, the reason admin is not automatic, the three guards, and the trust assumption), section 4.5 (Backend suite 195 to 202 tests, 201 passed 1 skipped; Table 4 row "permissions and authentication" 22 to 29, total 202; added a paragraph on the temporary-Postgres test of `handle_new_user()`), and sections 5.2 and 5.3 (one new limitation and one new recommendation). No repository source files changed.
- **Implementation rationale:** The previous text said teachers and administrators both needed an invitation, which no longer matches the database function. Test numbers were updated to the actual new run so that Table 4 stays consistent with the text. The new 4.5 paragraph states that the SQL test used a temporary container with stand-in tables and does not claim a production test.
- **Security and privacy impact:** None added. Example addresses in the text are generic; no real accounts, secrets, or student records were written.
- **Database or deployment impact:** None.
- **Verification performed:** Edited document.xml was parsed as valid XML; the file was converted with LibreOffice (page count rose from 45 to 48 because of the added text) and the pages with section 3.5 and Table 4 were viewed, showing the new paragraphs and the updated table without layout damage. Table and figure numbering was not changed.
- **Remaining risks or handoff work:** The owner should read the new text and adjust wording. Table 4 categories assume the 7 new tests belong to "permissions and authentication". If the owner has already tested the migration on the live Supabase project, a sentence about that could be added to 4.5. Word may paginate differently from LibreOffice.

## 2026-11-06 - Claude - Thesis ver4-5-5 updated and re-aligned (saved as ver4-5-6)

- **Objective:** Take the owner's `โครงเล่มจริง ver4-5-5.docx`, bring its content in line with the current system (automatic teacher role from department mailboxes, admin role set by the database owner, new test counts), fix Thai distributed alignment, spacing and line breaks for Microsoft Word, and check statements against the project.
- **Files or components changed:** Created `Documents/Claude/โครงเล่มจริง ver4-5-6.docx`; the source file in `Project/Source` was not modified. Only `word/document.xml` changed; styles, headers, footers and images are byte-identical to the source. No repository source files changed.
- **Implementation rationale:** Content: sections 3.1.2, 3.1.3, 3.3, Table 2 (`profile_invites`), 3.4 (decision order, reason admin is manual, guards, trust assumption), 4.4, 4.5 (202 tests, 201 passed, 1 skipped; Table 4 row 22 to 29; paragraph on the temporary-Postgres test), 5.2 and 5.3 (item 6 each). Corrections found by checking against the code: the QR interval was written as 10 to 15 seconds in 3.1.2 but the default is 12 s (range 10 to 15); "exam eligibility threshold" was replaced by the maximum absence percentage that the course settings actually store; administrator statements about managing report periods, closing courses and editing scores were removed because the admin API has no such functions (it lists, creates, edits and deletes users, lists and deletes courses, reads logs, and handles temporary-admin requests); section 2.9 said OCR runs on the student's machine, it runs on the Mini PC; the table count in 3.3 became 19 with `teacher_domain_exclusions`. Format: 195 body paragraphs now use `thaiDistribute` (English abstract uses `both`); 36 mid-sentence hard line breaks left from copy and paste were removed with correct spacing; stray spaces and non-breaking spaces were normalised; non-breaking spaces were added between "รูปที่/ตารางที่/หัวข้อ" and the number and between numbers and units; the first-line indent was restored on body paragraphs that had lost it; headings got keep-with-next; two table captions were centred like the others; the author line spacing was fixed.
- **Security and privacy impact:** None. Example addresses in the text are generic; no personal data, secrets or roster contents were added.
- **Database or deployment impact:** None.
- **Verification performed:** Compared every paragraph of the old and new text; checked the XML parses and that `pPr` child order is schema-valid in all paragraphs; converted with LibreOffice (46 pages) and viewed the pages with sections 3.1, 3.4, Table 4 and chapter 5; checked claims against `backend/core/config.py`, `backend/routers/admin.py`, `backend/services/light_ocr_service.py`, the migrations and the frontend course settings. Word itself was not available, so pagination and Thai line breaking in Word were not seen.
- **Remaining risks or handoff work:** Open the file in Word and update fields and the table of contents if any; page numbers may shift. Figures 8 to 24 are still empty frames. Table 5 numbers come from real roster sheets and were not re-checked. The thesis still does not state whether the new migration was applied on the live Supabase project.

## 2026-11-06 - Claude - Thesis screenshots inserted into figures 8 to 24 (saved as ver4-5-7)

- **Objective:** Put the 17 screenshots the owner attached into the empty figure frames of chapter 4 (figures 8 to 24) of the thesis, sized for readability and matched to each figure caption.
- **Files or components changed:** Created `Documents/Claude/โครงเล่มจริง ver4-5-7.docx` from `โครงเล่มจริง ver4-5-6.docx` (the earlier file was not modified). In `word/document.xml` the 17 dashed placeholder tables ("[วางภาพหน้าจอ]" plus a hint line) were replaced by a centred inline picture paragraph with keep-with-next so it stays on the page of its caption. Added 17 PNG files `word/media/fig8.png` to `fig24.png` and 17 relationships `rId108` to `rId124`. Nothing else changed.
- **Implementation rationale:** Images were matched by screen content to the caption text: 8 login, 9 student home with the QR scan button, 10 QR scan camera, 11 face check, 12 check-in result, 13 course attendance history, 14 profile, 15 teacher course list, 16 session QR dialog, 17 floating QR window, 18 live check-in list, 19 roster import preview, 20 roster/course mismatch dialog, 21 report export, 22 user management, 23 temporary admin approval, 24 audit log. One attached image (roster file picker) matches no caption and was left out. WebP files were converted to PNG and transparent images flattened onto white. Widths: desktop screens 15.5 to 16 cm, phone screens 13.5 cm high (about 6.2 cm wide), small crops 6.5 to 13 cm, always at original aspect ratio. Each picture has alt text equal to its caption.
- **Security and privacy impact:** Screenshots contain real names and 13-digit student ids of project team members (figures 12, 14, 22, 23, 24) and, in figure 19, a roster preview with student names and ids. The owner supplied them for the thesis; no such data was copied into this log or the repository. The owner should decide whether figure 19 and the user-management screen should be blurred before the thesis is distributed.
- **Database or deployment impact:** None.
- **Verification performed:** The docx zip passes an integrity test, `document.xml` and the relationships file parse as XML, no "[วางภาพหน้าจอ]" placeholder remains, and a LibreOffice conversion gives 49 pages (46 before) with every figure 8 to 24 on a page together with its caption. Page images were inspected visually. Word itself was not available, so pagination in Word was not seen.
- **Remaining risks or handoff work:** Open the file in Word and check page breaks and any large white gaps near the tall phone screenshots; update fields or the table of contents if any. Some text in small screenshots (figures 17, 18, 20) is small by nature of the source image. Figure 20 also shows a few student names and ids faintly behind the dialog. Table 5 numbers and production migration status are still unverified, as noted in the previous entry.

## 2026-11-06 - Claude - English summary of the thesis written as .md and .json

- **Objective:** Produce a detailed English explanation of how the project thesis is written and what it contains, as a Markdown file and a JSON file.
- **Files or components changed:** Created `Documents/Claude/Thesis_Summary_EN.md` and `Documents/Claude/Thesis_Summary_EN.json`. Source read: `Documents/Claude/โครงเล่มจริง ver4-6.docx` (the owner's Word re-save of the version with screenshots; the earlier ver4-5-6 and ver4-5-7 files are no longer in that folder). No repository code or the thesis itself was changed.
- **Implementation rationale:** The thesis text was extracted from `document.xml` and summarised chapter by chapter (structure, technology choices, design, numbers, results, limits). Every number in the summary was taken from the thesis text. The JSON mirrors the Markdown in structured form.
- **Security and privacy impact:** Author emails, student ids and biographies were deliberately left out of both files. Table 5 appears only as course codes and counts. No secrets or student records were written.
- **Database or deployment impact:** None.
- **Verification performed:** JSON parses; test counts in Table 4 add up to 202; key figures (0.45, 0.65, 0.60, 12 s, 420 s, 180 s, 19 tables, 16 emails, 202/201/1) were checked to appear in the Markdown; pattern search found no student ids in either file.
- **Remaining risks or handoff work:** The summary lists gaps found in the thesis itself: section 1.2 (objectives) and a scope section are missing although 5.1 cites them; cover spelling and degree-name inconsistencies; no statement about production status of the new migration; screenshots contain real names. The owner should decide on these. The log was written from the repository path because the session working directory changed to `Documents/Claude`.

## 2026-11-07 - Claude - Google sign-in (Supabase social login) and OAuth 2.0 guide written

- **Objective:** Explain what the Supabase "Authentication, Sign In / Providers, Google" feature is, how this project uses it, how to set it up from scratch, and what OAuth 2.0 is, using the three pages the owner named.
- **Files or components changed:** Created `Project/Source/markdown/GOOGLE_OAUTH_LOGIN_GUIDE_TH.md` (Thai). No repository code, migration or configuration was changed.
- **Implementation rationale:** The guide maps the real code (`Login.tsx`, `App.tsx`, `supabaseClient.ts`, `backend/core/security.py`, the role-assignment migration) onto the OAuth 2.0 roles and flow, then gives ordered setup steps (Supabase callback URL, Google Auth Platform branding/audience/scopes, Web OAuth client, provider fields, Site URL and Redirect URLs, env variables, migration and trigger, first admin, tests, go-live checklist) and a troubleshooting table. A verification table separates facts checked in code, facts taken from official pages, and facts that could not be checked.
- **Security and privacy impact:** No secrets, keys, project references or student data were written. The guide tells the reader to keep the Google client secret only in Supabase and the service key only in the back end. It records that the Google side does not restrict the domain; restriction is done by `handle_new_user()` and the back end.
- **Database or deployment impact:** None.
- **Verification performed:** Read the code files listed above; confirmed from `node_modules` that supabase-js 2.106.1 / auth-js default `flowType` is `implicit` with `detectSessionInUrl`, `autoRefreshToken` and `persistSession` on; read the Google and oauth.net pages and the Supabase Google, redirect-URL, sessions, implicit/PKCE and troubleshooting pages through web-fetch helpers; the Medium article returned HTTP 403 to the fetcher and was read through the in-app browser instead; confirmed the cross-referenced section 3.6 and `CORS_ORIGINS` example exist in the repo files.
- **Remaining risks or handoff work:** The real Google Cloud and Supabase dashboard settings (audience, publish status, redirect URLs, Site URL) were not visible and are not verified. The hosted callback URL format is not printed on the Supabase page that was read; the guide tells the reader to copy it from the dashboard. The user-facing error for a rejected non-KMUTNB email and a possible switch to PKCE were not tested.

## 2026-11-12 - Claude - Script to run Backend and OCR without Docker behind ngrok (tuningModel)

- **Objective:** On branch `tuningModel`, let the owner run the branch's Backend and Light OCR directly on the development machine (no Docker) and expose only the Backend through ngrok, so a separately hosted Frontend Preview can be tested from the Internet without touching the production Frontend portal. The owner chose to keep using the existing Supabase project with test accounts.
- **Files or components changed:** Created `scripts/start_backend_ngrok.sh` (start, status, stop) and `frontend/.env.staging.example` (placeholders only). Appended section 8 to `deployment/docker/README_TH.md`. The script keeps its private settings outside the repository in `~/.config/km-attendance/staging.env` (mode 600) and its logs and pid files in `~/.local/state/km-attendance-staging/`. No backend or frontend source file was changed by this task.
- **Implementation rationale:** ngrok starts first so the public host is known and can be placed in `TRUSTED_HOSTS`; then Light OCR, then the Backend with `APP_ENV=production` so `/docs`, `/redoc` and `/openapi.json` are disabled and CORS must be exact HTTPS origins. Staging-only liveness signing key and temporary-admin PIN pepper are generated once and stored outside the repo; the OCR token must already be 32 or more characters and identical in both env files. Values override `backend/.env` because the loader does not replace existing environment variables. Dotenv-style files are parsed, never sourced. PIDs are checked against the process command line before being signalled.
- **Security and privacy impact:** While running, the Backend is reachable from the Internet through ngrok, which terminates TLS, so access tokens and face images pass through that provider; the tunnel must be opened only for tests. The Backend still binds to loopback only and Light OCR is not tunnelled. Without Docker the processes run with the current user's privileges (no non-root user, capability drop or memory ceiling). The script reads `backend/.env`, so tests write to whichever Supabase project that file points to; only test accounts and test courses should be used. No secrets, tokens, tunnel host names or frontend host names were written to this log.
- **Database or deployment impact:** None to the database. Nothing was deployed. The existing Docker staging containers were left running and were not modified; the default ports 8000 and 3001 are used by the script, so the Docker stack must be stopped first or other ports given.
- **Verification performed:** `bash -n` passed (shellcheck is not installed). Ran the script on spare ports 8010 and 3011 with a real ngrok tunnel: first run created the settings file and exited as designed; second run reached ready state; checks returned: `/health/live` through ngrok 200, `/docs`, `/openapi.json`, `/redoc` 404, `/health/ready` ready for database, OCR and face, `/api/v1/auth/me` without a token 401, CORS preflight from an allowed origin 200 with a matching allow-origin header, from an unlisted origin 400 with no allow-origin header, request with an untrusted Host header 400, Backend and OCR listening on 127.0.0.1 only. `stop` closed ngrok, Backend and OCR and freed the ports. Not verified: a real Vercel Preview, Google sign-in through the Preview, a full QR plus face check-in over the tunnel, phone camera use, the default ports 8000 and 3001 (Docker was occupying 8000), nvm switching from a Node 18 shell, the cleanup trap on Ctrl+C in an interactive terminal.
- **Remaining risks or handoff work:** The owner must stop Docker staging (or use other ports), push `tuningModel`, set Preview environment variables and Deployment Protection in the hosting dashboard, add the Preview URL to the settings file and to Supabase Redirect URLs. ngrok free-plan monthly quotas may be reached quickly with face images; the per-check-in data size was not measured. The staging settings file prefilled origins from the ignored `deployment/docker/.env`; the owner should review them. `/health/ready` is reachable without authentication through the tunnel and reveals dependency status only. Strict-Transport-Security and cache-control headers were not seen on `/health/live`; production Nginx behaviour was not part of this path. An unrelated uncommitted edit to `frontend/vite.config.ts` (removal of three comments) was present in the working tree during this task and was left untouched.

## 2026-11-12 - Claude - AI inventory and real-experiment tuning guide for the Backend (tuningModel)

- **Objective:** Before any tuning, list the AI components of the project with their locations and call sites, list every tunable value with its source, and write a step-by-step test guide so the owner can find values from real experiments instead of guessing.
- **Files or components changed:** Created `docs/ai_tuning/AI_TUNING_TEST_GUIDE_TH.md` (Thai guide: AI registry, parameter registry, measurement principles, setup, test cases, tuning loop, change rules), `docs/ai_tuning/ai_trials_template.csv` (header-only record sheet), `docs/ai_tuning/ai_threshold_sweep.py` (standard-library script that computes FAR/FRR tables and BPCER/APCER with Wilson 95% intervals from recorded trials). No backend, frontend, migration or configuration file was changed. Note that `docs/` is git-ignored (`.gitignore` line 30), so these files exist only on this machine unless the owner decides otherwise.
- **Implementation rationale:** Read the real code paths to inventory six AI systems: SCRFD detector, MobileFaceNet/ArcFace recognizer and 3D 68-point landmark model (InsightFace buffalo_s, `backend/services/insightface_service.py`), MiniFASNet V2-SE passive PAD (`backend/services/passive_pad_service.py`), Light OCR (Node service `ocr-service/ocr-server.js`, called from `backend/services/light_ocr_service.py`), and MediaPipe Face Landmarker in the browser. Every tunable constant was recorded with file and line, direction of effect, and the metric that must decide it. Test cases are black-box trials through the real UI, using the similarity score that the success screen and the identity-failure message already expose, so they work without code changes; failure stages are mapped from the exact Thai messages in the code.
- **Security and privacy impact:** The guide requires written consent, pseudonymous participant codes, no student ids, emails, images or card numbers in records, deletion of test accounts afterwards, and attack tests only against consenting participants' own test accounts. No personal data or secrets were written. The ngrok quota and the shared-Supabase risk are stated in the guide.
- **Database or deployment impact:** None. The tests described run against the existing Supabase project with test accounts, as the owner chose; cleanup steps are in the guide.
- **Verification performed:** Baseline backend suite on this branch: `cd backend && .venv/bin/python -m unittest discover -s tests` ran 202 tests, OK with 1 skipped. The sweep script was run on synthetic data (deleted afterwards) to confirm it executes and prints tables; no synthetic number appears in the guide. Line references in the guide were re-checked against the files. No real experiment was run, so there are no measured results yet.
- **Remaining risks or handoff work:** (1) Findings: the student enrollment path uses a detection score minimum of 0.55 (`insightface_service.py:170`), while thesis Table 3 states 0.60 for enrollment; 0.60 applies only to the administrator image-upload path (`:207`). The embedding used for both enrollment and check-in comes from a single recovery frame. Passive PAD checks only the three passive frames. The same 0.78 constant is used for both "eye closed" and "eye reopened" in the blink check. Frontend and backend limits differ (for example yaw 0.12 versus 0.14 and 0.15). The legacy `verify_liveness_frames` is only used by tests. (2) Proposed but not started, awaiting owner confirmation: phase 0 make the chosen constants readable from validated environment variables with unchanged defaults and a test that pins the defaults; phase 1 an offline measurement tool that computes all metrics without stopping at the first failed rule; thesis wording fix for the 0.60 versus 0.55 statement after experiments.

## 2026-11-13 14:00 - Claude - Test-only mode: face check-in without the dynamic QR step and its timers (tuningModel)

- **Objective:** For AI baseline experiments, let students of listed TEST courses start the face scan directly from a list of open sessions, with no QR scan and without the QR/challenge/auto-close timers. The owner asked to "turn off all security temporarily"; only the QR step and timers were removed. The owner chose to keep recording real attendance rows (no dry run).
- **Files or components changed:** Created `backend/core/test_mode.py` (settings loader and gates), `backend/routers/test_mode.py` (`GET /api/v1/test/open-sessions`, `POST /api/v1/test/sessions/{id}/challenge`), `backend/tests/test_attendance_test_mode.py` (20 tests), `frontend/src/config/testMode.ts`, `frontend/src/services/testMode.ts`, `frontend/src/features/student/TestModePanel.tsx`, `frontend/src/components/TestModeBanner.tsx`, `frontend/scripts/test-test-mode.mts`. Modified `backend/core/config.py` (loads the settings), `backend/main.py` (imports the router only when the mode is on; `/api/v1/system/config` reports `test_mode`), `frontend/src/features/student/StudentHome.tsx`, `frontend/src/contexts/TeacherAttendanceProvider.tsx` (no auto-close in test builds), `frontend/src/main.tsx`, `frontend/package.json`, `frontend/.env.staging.example`, `scripts/start_backend_ngrok.sh` (`start --test-mode`), `scripts/production_preflight.py` and `scripts/build_release_bundle.sh` (refuse the switches), `scripts/verify_release.sh` (runs the new frontend test), `deployment/docker/README_TH.md` (section 8.4) and `docs/ai_tuning/AI_TUNING_TEST_GUIDE_TH.md` (note).
- **Implementation rationale:** The challenge endpoint issues the same one-time check-in right and signed liveness token as the QR validate endpoint, so liveness, PAD, the face comparison, the claim/finalize transaction and the one-record-per-session rule are untouched. Gates: the backend refuses to start unless the switch, an exact acknowledgement phrase and at least one course UUID are all set; only listed courses are accepted (a real course the student belongs to gets 403); the router is not even imported when the mode is off; frontend test UI exists only in builds with `VITE_TEST_MODE=1` and shows a red banner. Not removed on purpose: login and token checks, roles, course membership, open-session check, CORS and trusted hosts, liveness timing rules, late/absent status calculation, enrollment challenge timer.
- **Security and privacy impact:** In test mode, any enrolled student of a listed course can check in without being in the room, and the result is saved to the shared Supabase project; use only test courses and test accounts. Release scripts and the production preflight refuse the switches; a unit test checks that production deployment files never mention them. The backend log line for a QR-free challenge contains no user data. No secrets, course ids or host names were written to this log.
- **Database or deployment impact:** No migration. Challenge rows are inserted with a 4-hour expiry (the database only requires expires_at later than created_at). Nothing was deployed; the Docker staging containers were left running and untouched.
- **Verification performed:** Backend suite `unittest discover`: 222 tests, OK, 1 skipped (was 202). Frontend under Node 22.23.2: `test:test-mode`, `test:session-deadline`, `test:api-origin`, `test:liveness`, `test:overlays`, `test:camera-quality` and `lint` pass; `npm run build` passes and the normal bundle contains no test-mode text; a scratch build with `VITE_TEST_MODE=1` passes and contains the banner. Four real backend starts on spare ports: mode off gave 404 for the test route and none in OpenAPI; mode on listed both routes and returned 401 without a token; missing acknowledgement and missing course list both made the backend exit with a clear error. The ngrok script with `start --test-mode` ran end to end on ports 8010 and 3011 (tunnel health 200, docs 404, test route 401 through the tunnel, /openapi.json 404), then stopped cleanly.
- **Remaining risks or handoff work:** Not verified: the student test panel and face scan in a real browser or phone (no Preview was built or tested), the teacher side in a test build, and an actual check-in through the test endpoint (it needs a signed-in test student). The owner must supply course UUIDs in the private staging settings file (a commented line `STAGING_TEST_COURSE_IDS=` is added only to newly created files), set `VITE_TEST_MODE=1` in the Preview environment and redeploy. Late/absent status is still computed from elapsed time, so long sessions record later check-ins as late or absent. Unrelated uncommitted edit to `frontend/vite.config.ts` (comment removal) was present and left untouched. Phase 0 (env-tunable thresholds) and the numbers-only metrics logger remain proposed and not started.

## 2026-11-13 14:32 - Claude - Test course list now read from the Supabase courses table

- **Objective:** The owner asked to drop the placeholder test-course setting and use the real values from the Supabase table. Added a read-only way to list the real courses and filled the private settings file with the chosen test course.
- **Files or components changed:** `scripts/start_backend_ngrok.sh` (new `courses` subcommand that reads courses, member counts and pending roster invites through the backend's own Supabase settings and prints no personal data); `deployment/docker/README_TH.md` (section 8.4 step 1). The private file `~/.config/km-attendance/staging.env` (outside the repository, mode 600) received one `STAGING_TEST_COURSE_IDS` line with one course UUID. No backend or frontend source changed.
- **Implementation rationale:** The allow-list gate was kept instead of removing it. The read-only listing showed that two courses (about 13 and 24 pending roster invites) have real students waiting to sign in for the first time, so they would be enrolled automatically and could use the QR-free flow; they must not be test courses. The chosen course has members but no pending invites. The list stores fixed UUIDs, so courses created later are never included by accident.
- **Security and privacy impact:** The listing uses the service-role settings of `backend/.env` read-only and prints only course code, name, section, term, counts and course ids; no names, emails, student ids or teacher ids. No ids or hosts are recorded in this log.
- **Database or deployment impact:** Read-only queries on `courses`, `enrollments`, `profile_invites`, `profile_invite_courses`. Nothing written, no migration, nothing deployed.
- **Verification performed:** `bash -n` passes; the `courses` subcommand ran against the live table and listed 8 courses with the pending-invite warning on the two courses that have real rosters waiting; the new settings line matches the UUID format check used by the start script.
- **Remaining risks or handoff work:** The owner should confirm that the chosen course is the intended test course (it contains the team's test accounts). Courses with pending invites can later become safe when their roster is claimed or removed, but treat them as real classes. A dedicated new test course would be the cleanest option.

## 2026-11-13 14:42 - Claude - All-courses option for the test mode, explicit flag only; courses command restored

- **Objective:** The owner asked to remove the need to list test course ids and to work directly with the real database. Two sessions answered the same message: one kept the allow-list and added a read-only `courses` listing (previous entry), this one added an optional "all courses" scope. Both are now reconciled: the allow-list stays the default and the all-courses scope needs an explicit command-line flag.
- **Files or components changed:** `backend/core/test_mode.py` (second typed acknowledgement, `ATTENDANCE_TEST_ALL_COURSES_ACK`; listing course ids and the acknowledgement together is rejected), `backend/core/config.py`, `backend/main.py` (warning text), `backend/routers/test_mode.py` (all-courses scope still requires membership and an open session), `backend/tests/test_attendance_test_mode.py` (now 27 tests), `scripts/production_preflight.py` (also refuses the new variable), `scripts/start_backend_ngrok.sh` (new `--all-courses` flag, `courses` command restored), `frontend/src/components/TestModeBanner.tsx` and `frontend/src/features/student/TestModePanel.tsx` (wording no longer says "test courses only"; says results are recorded for real), `deployment/docker/README_TH.md` section 8.4, `docs/ai_tuning/AI_TUNING_TEST_GUIDE_TH.md`, `frontend/.env.staging.example`.
- **Implementation rationale:** The previous entry found that two courses have real students waiting to sign in for the first time; they would become members automatically and could then check in remotely without a QR. An empty list must therefore never mean "everything", so the wider scope needs its own typed phrase in the backend and the `--all-courses` flag in the script, and the script refuses the flag while a course list is set. While editing, my write to `scripts/start_backend_ngrok.sh` removed the `courses` command that the other session had added (the two sessions edited the same file); it was rewritten here from that entry's description (read-only; code, name, section, year/semester, member count and pending-invite count per course, no personal data) and checked against the live table (8 courses listed, the two courses with pending invites flagged).
- **Security and privacy impact:** With `--all-courses`, anyone who can reach the tunnelled backend with a valid KMUTNB sign-in could check into any real class they belong to without a QR, and the record is stored for real. The default is unchanged (the owner's private settings file still lists one test course). Preflight and release scripts refuse all the new variables. No ids, hosts or personal data are written here.
- **Database or deployment impact:** None to schema. The `courses` command reads four tables. Nothing deployed; Docker staging untouched.
- **Verification performed:** Backend suite 229 tests, OK, 1 skipped. Frontend under Node 22: `test:test-mode`, lint and build pass; the normal bundle contains no test-mode text. Script checks: `--all-courses` without `--test-mode` is refused; `--all-courses` while a course list is set is refused; list mode ran end to end through ngrok on spare ports (tunnel health 200, docs 404, banner says one course) and stopped cleanly. Backend started on loopback only with the all-courses acknowledgement: route present, 401 without a token, warning logged; with both a list and the acknowledgement it refuses to start. The all-courses path of the script itself was NOT run through ngrok, to avoid exposing it. A loopback test process left by my own mistake was stopped.
- **Remaining risks or handoff work:** The owner should say which behaviour was meant (course ids fetched from the real table, or all real courses). Not verified in a browser or phone. Coordinate so only one session edits the script at a time.

## 2026-11-13 15:03 - Claude - Host the web app and the API on this machine behind one ngrok URL (--host-frontend)

- **Objective:** The owner changed the plan: host both Frontend and Backend on this local machine and use ngrok to let outside users in, instead of putting the Frontend on Vercel. Fix and verify the whole path.
- **Files or components changed:** Created `frontend/vite.hosting.config.mts` (serves a built frontend on 127.0.0.1, forwards only `/api` to the backend, restricts the Host header) and `backend/tests/test_local_hosting.py` (9 static guards). Modified `scripts/start_backend_ngrok.sh`: new `start --host-frontend` mode (works with or without `--test-mode`), `status` and `stop` know the web process, new port variable `STAGING_WEB_PORT` (default 4173). Modified `deployment/docker/README_TH.md` (new section 8.5) and `docs/ai_tuning/AI_TUNING_TEST_GUIDE_TH.md` (note). No application source of the backend or frontend was changed in this task.
- **Implementation rationale:** One ngrok URL (free plan gives one stable dev domain) serves the web at `/` and the API at `/api`, so the browser sees one origin: no CORS between web and API, no Vercel settings, and no `STAGING_FRONTEND_ORIGINS`. The frontend is built with an empty `VITE_API_ORIGIN` (relative `/api`), with `VITE_TEST_MODE=1` only for `--test-mode`, into `~/.local/state/km-attendance-staging/web-dist`, never `frontend/dist`, so a release build cannot inherit it. In this mode the backend allows only the ngrok origin and trusts only the ngrok host plus loopback. The web server uses `vite preview` with an explicit config instead of changing `frontend/vite.config.ts`.
- **Security and privacy impact:** The whole stack is reachable from the Internet while the script runs, but only `/api` reaches the backend (health, docs, OpenAPI are not forwarded; a foreign Host header gets 403; the web server listens on loopback only). The `--test-mode` limits from the earlier entries still apply (listed test course only). ngrok terminates TLS, so tokens and face images pass through that provider. `vite preview` is a test server without edge rate limiting. The free-plan quota (1 GB out, 20,000 requests per month) is now also consumed by static files; the built output is about 42 MB, mostly MediaPipe WASM and the face model, and the real per-device download was not measured.
- **Database or deployment impact:** None to the schema; nothing deployed. Same Supabase project as `backend/.env`. A one-time manual step remains for the owner: add the ngrok URL to Supabase Redirect URLs.
- **Verification performed:** Ran `start --host-frontend --test-mode` on spare ports (8010, 3011, 4180). Self-checks: web `/` 200, `/api/v1/auth/me` 401, backend `/docs` 404. Through the public URL: `/` returns the app (title correct), `/api/v1/test/open-sessions` and `/api/v1/system/config` 401 without a token, `/health/ready` and `/openapi.json` return the web page and not backend data, a foreign Host header to the web server gets 403, the web server listens on 127.0.0.1 only, the test bundle contains the red banner text, `frontend/dist` was not touched. In the in-app browser the ngrok free-plan warning page appeared once; after "Visit Site" the login page rendered over HTTPS with the red test banner, a secure context with camera API available, a service worker available, and no console errors. Google sign-in was not attempted. After the run: ngrok, backend, OCR and web all stopped and ports freed. Backend-only mode was re-run after the script changes and still passes its checks. Full backend suite: 238 tests, OK, 1 skipped. Frontend lint and the test-mode script pass.
- **Remaining risks or handoff work:** Not verified: Google sign-in and a real face check-in through the public URL (needs the Supabase Redirect URL and a signed-in test student), phone camera behaviour, many concurrent users, and the actual bytes downloaded per device. Every frontend code change needs a restart of the script to rebuild. The default backend port in the script is 8079 (changed by someone else before this task); the earlier sections of the README that mention 8000 describe the Docker staging setup. The Docker staging containers were found stopped at the end of this task; it was not me who stopped them.

## 2026-11-13 15:29 - Claude - Test builds: no QR for teachers, sessions reach students fast, add-test-course command

- **Objective:** The owner reported that, in the hosted test system, students no longer scan a QR (as intended) but teachers still saw a QR after opening a session and the opened session never appeared on the student side. The owner wants the dynamic QR gone for both roles in the test system, and a newly opened session to show up at once for students who joined the course.
- **Root cause (verified):** The session was opened in a course created that day (same course code as an older course, a different row). The QR-free list only covers the course UUIDs in the private settings file, and that file listed only the older course. The student endpoint therefore answered 200 with an empty list (81 such calls in the backend log). A read-only simulation against the live database, using the single member of the new course, returned no sessions with the old list and the open session with the updated list.
- **Files or components changed:** `frontend/src/features/teacher/LiveAttendance.tsx` (in test builds the QR image, full-screen and floating-window controls and token error are hidden and a notice is shown), `frontend/src/contexts/TeacherAttendanceProvider.tsx` (no QR token rotation calls in test builds), `frontend/src/features/student/TestModePanel.tsx` (refresh every 2 seconds and when the tab or phone becomes active again), `frontend/src/features/student/StudentHome.tsx` (two messages no longer mention QR in test builds), `scripts/start_backend_ngrok.sh` (new `add-test-course <uuid>`; `courses` now sorts newest first and shows which courses are on the test list), `backend/tests/test_attendance_test_mode.py` (4 more guards, 31 tests in the file), `deployment/docker/README_TH.md` section 8.4. The private settings file outside the repository received the new course id (done by the new command; nothing else in it changed).
- **Implementation rationale:** All changes are behind `VITE_TEST_MODE`, so normal builds keep the QR flow and the QR code stays in the source and the production bundle; deleting the feature from the source was not done because it would remove a core control from releases and break many tests. `add-test-course` takes one explicit UUID (no "latest" shortcut), refuses a course that has unclaimed roster invites, is idempotent and rewrites the private file atomically with mode 600.
- **Security and privacy impact:** Nothing was widened beyond adding one course with one member and no pending invites to the list. A course with real students waiting to sign in is still refused. The tradeoff is unchanged: in test mode listed courses can be checked into without a QR and the result is stored for real. No ids or personal data are written here.
- **Database or deployment impact:** Read-only queries for the diagnosis. No writes to the database, no migration. Nothing was restarted: the owner's running stack still uses the old settings and the old web build until it is stopped and started again.
- **Verification performed:** Backend suite 242 tests, OK, 1 skipped. Frontend under Node 22: lint, `test:test-mode`, `test:session-deadline`, `test:liveness`, `test:overlays` pass; normal build passes; a scratch test build passes and contains the teacher notice, while the normal bundle does not contain it and still contains the QR code library. `add-test-course` ran against the live data: added the new course, was idempotent on a second run, refused a course with pending invites, and rejected a course code that is not a UUID. Backend log review of the owner's run: 3 calls to the enrollment challenge returned 422 (the card image could not be read by OCR), and one rotate-token and one checkins call returned 500 from a dropped connection to Supabase (httpx RemoteProtocolError); not investigated further.
- **Remaining risks or handoff work:** Not verified: the teacher dialog and the student list in a real browser with sign-in (no credentials), a real check-in on the new course, and how fast the list appears on a phone. The owner must stop and restart the script (it rebuilds the web app and re-reads the course list). New courses created later must be added with `add-test-course`. The wider rule "any joined course" was not implemented: a real class session opened by a real teacher would then appear to every member using the test URL, who could check in without a QR.

## 2026-11-13 16:45 - Claude - Test-only extras: external e-mail sign-in, no card/OCR, auto-join Test course, face_checkin_attempts, unlimited check-ins

- **Objective:** The owner asked for these behaviours in the test system only (production unchanged): (1) any Google account can sign in; (2) no student card/OCR and no student id needed; (3) a "Test" course; (4) everyone is enrolled in the Test course(s) automatically after face registration; (5) a new table that records every check-in result with status, similarity score and the reason a scan failed; (6) check-in of the Test course stays open and the same student can check in repeatedly; (7) no QR to enter the classroom; (8) a "check in again" action. The owner then chose a separate, cloned Supabase project for testing.
- **Files or components changed:**
  - Created `supabase/test-only/20261113120000_test_external_email_and_face_attempts.sql` (kept OUT of `supabase/migrations/` so `db push` to production cannot include it): `test_mode_flags` (default off), `test_student_id_seq`, replacement `handle_new_user()` that accepts a non-university e-mail only when the flag is on, table `face_checkin_attempts` (RLS on, no policies, no grants to anon/authenticated).
  - Created `backend/services/test_mode_service.py` (failure classification, test-course lookup, best-effort attempt recording, auto-join).
  - Modified `backend/core/test_mode.py`, `backend/core/config.py`, `backend/core/security.py` (external e-mail setting with its own typed acknowledgement and a gate function), `backend/main.py` (card optional only in test mode, auto-join after enrollment, test courses record to `face_checkin_attempts` and skip the final attendance write, config flags), `backend/routers/test_mode.py` (no one-per-session rule).
  - Modified `frontend/src/features/student/StudentRegister.tsx`, `frontend/src/services/api.ts`, `StudentHome.tsx`, `TestModePanel.tsx`, `frontend/src/features/auth/Login.tsx` (card step and ID text removed in test builds, "check in again" button, notes). All behind `VITE_TEST_MODE`; the normal bundle was checked to contain none of the new text and still has the card upload.
  - Modified `scripts/start_backend_ngrok.sh` (`--allow-external-email`, `--test-database`; the first refuses to run without the second and without `--test-mode`; the test database values come only from the private settings file and are passed through the environment of that run, never written to `backend/.env` or `frontend/.env.local`; refuses a URL equal to the one in `backend/.env`), `scripts/production_preflight.py` (also rejects the new acknowledgement variable), `deployment/docker/README_TH.md` (section 8.6, outdated note corrected).
  - Tests: updated `backend/tests/test_attendance_test_mode.py`; created `backend/tests/test_external_email_and_attempts.py`; extended `backend/tests/test_local_hosting.py`.
- **Implementation rationale:** The attendance table is unique per session and student, so unlimited check-ins in the Test course are done by not writing it for test courses and writing every outcome to the new table instead; the challenge is not consumed so repeated attempts work. External e-mail needs two independent switches (Backend acknowledgement and a database flag) because the role trigger in the database rejects non-university addresses on its own. Placeholder student ids are 13 digits, unique, and cannot be mistaken for real ones.
- **Security and privacy impact:** Everything stays off by default. Production files must not mention the new variables (unit test) and the preflight rejects them. The attempts table stores ids, scores, status, stage and a trimmed reason only: no images, face vectors, e-mails or names; it has RLS with no policies and no grants, so only the server key reads it. Letting any Google account in widens who can create accounts; it is therefore allowed only with the separate test database. Residual risk: anyone with a Google account can register and consume the test system's resources while it is exposed through ngrok.
- **Database or deployment impact:** No change to production or to `supabase/migrations`. The test-only SQL was applied only to a throwaway local Postgres (now removed), where the flag-off rejection, flag-on acceptance, the invite/student/teacher paths and the table checks were verified. It has NOT been applied to any Supabase project. Creating the separate Supabase project failed: the free plan allows two active projects per owner and the limit is reached; no other project was touched. Nothing deployed.
- **Verification performed:** Backend suite 274 tests, OK, 1 skipped. Frontend under Node 22: type check and lint clean, `test:test-mode`, `test:liveness`, `test:api-origin`, `test:overlays`, `test:security`, `test:session-deadline`, `test:card-image` pass; normal and test bundles both build; test-only strings found only in the test bundle and the card upload only in the normal bundle. `bash -n` on the launcher passes. Not verified: real Google sign-in with an external account, a real registration and check-in in a browser, the launcher's new flags end to end (needs the test project values).
- **Remaining risks or handoff work:** The owner must free or upgrade a Supabase slot (or choose another way), then: create the test project, clone the schema (schema only), run the test-only SQL there, turn on the flag there only, set the Google provider and Redirect URLs (consent screen External and published for outside accounts), put the three STAGING_TEST_SUPABASE_* values in the private settings file, create the Test course and run `add-test-course`. Students who registered before this change are not auto-enrolled until they register again or are added by hand (a `join-test-courses` helper was not written). The `face_checkin_attempts` rows are the intended input for the later threshold tuning.

## 2026-11-13 17:40 - Claude - Separate Supabase test project created and cloned (schema only) from production

- **Objective:** The owner freed a Supabase slot and asked to proceed with the plan: create a new Supabase project for testing with the same tables as the existing one, then use it for the test-only features (external e-mail sign-in, results table).
- **Files or components changed:** `scripts/start_backend_ngrok.sh` (with `--test-database` the course list now comes from `STAGING_TEST_DB_COURSE_IDS`, a variable separate from the real database's list), `backend/tests/test_local_hosting.py` (one more check), `deployment/docker/README_TH.md` (section 8.6 step 6: teacher invite and course variable). The owner's private settings file outside the repository received the test project's URL, its public (anon) key, an empty placeholder for the service key and the test course list; the file stays mode 600 and nothing from it is printed here.
- **Implementation rationale:** Production was only read (catalog queries and counts, schema only; no row data was copied). The repository migrations do not create the six base tables or the `auth.users` trigger (they were made in the dashboard earlier), so a baseline for those was written from production's catalog in their pre-migration shape, then the 22 migrations were replayed in order. Migrations 5 and 6 (only redefinitions of `handle_new_user`) were skipped because migration 22 replaces it anyway, and the superseded six-argument `finalize_face_attendance` was never created. The test-only SQL from `supabase/test-only/` was applied afterwards, on the test project only.
- **Security and privacy impact:** The test project allows any well-formed e-mail to sign in once the flag `allow_external_email` is on; that flag was switched on in the test project only. Production does not have the flag table, the attempts table, or any function mentioning them (checked). The test project has no users or data. The service key was not read; the owner must paste it into the private settings file. The project URL and keys are deliberately not written to this log.
- **Database or deployment impact:** New project in the same organisation and region, free plan ($0). Production: no writes. Test project: baseline + migrations + test-only SQL applied through the Supabase tool, one "Test" course (year 2569, semester 2, no teacher yet) inserted. Nothing deployed.
- **Verification performed:** Fingerprints of production and test were compared and are identical for columns, constraints (101), indexes (72), policies (19), RLS flags (19 tables), triggers, table grants, function grants and bodies (22 functions, compared with blank lines removed; production's stored copies lack blank lines), the storage bucket and the realtime publication, except the two intended test-only tables (not compared in production). Two mistakes found and fixed during the comparison: `attendance_records.method` was made NOT NULL by mistake (production allows null). Trigger behaviour on the test project, run inside a block that rolled back: flag off rejects an external and a bare university address and accepts a student and a department teacher; flag on accepts external addresses as students with placeholder ids 0000000000001 and 0000000000002 and rejects a malformed address; the attempts table rejects a failed row without a reason. Afterwards the sequence was reset and the flag turned on. Not verified: a real Google sign-in against the test project, and the launcher end to end (needs the service key).
- **Remaining risks or handoff work:** Owner steps: paste the service key into the private settings file; in the test project's dashboard enable the Google provider with the Google client id and secret and add the hosting URL to Redirect URLs (and make the Google consent screen External and published for outside accounts); create a teacher invite for the owner's own Google e-mail and assign the Test course (SQL in section 8.6); then run the launcher with `--test-database --allow-external-email`. Production data such as the real courses and students was intentionally not cloned.

## 2026-11-13 18:05 - Claude - Fix the test-database guard that rejected the new project; verified the full start

- **Objective:** The owner ran the launcher with `--test-database` and was refused because the test project's URL equalled the one in `backend/.env`. The owner wants to run against the new Supabase project and not the old one.
- **Files or components changed:** `scripts/start_backend_ngrok.sh` (the "test database must not be the real project" check now compares with `STAGING_PROTECTED_SUPABASE_URL` from the private settings file instead of `backend/.env`; `--allow-external-email` is refused unless that variable is set; without it a warning is printed), `backend/tests/test_local_hosting.py`, `deployment/docker/README_TH.md`. The real project's URL was added to the private settings file (outside the repository).
- **Implementation rationale:** The old check assumed `backend/.env` always holds the real project. The owner has since pointed `backend/.env` at the new project (observed by comparing project references only; the file was not edited by this agent), so the check refused a correct setup. The guard now names the real project explicitly, which is correct whatever `backend/.env` points to.
- **Security and privacy impact:** The protection is kept and now cannot be defeated by editing `backend/.env`; external e-mail sign-in still needs the test database flag, the Backend acknowledgement and the protected URL. Note for the owner: because `backend/.env` now points at the test project, any run that does not pass `--test-database` (including a production-style start from that file) would use the test project, and the real project's values are no longer in that file.
- **Database or deployment impact:** None. No SQL run. Nothing deployed.
- **Verification performed:** Backend tests for the script and the test mode: 48, OK. Ran the exact command on spare ports: frontend built, OCR and Backend started, `/health/ready` reported database, ocr and face "ok" (so the new project's service key works and the cloned schema is reachable), through ngrok `/` was 200, `/api/v1/auth/me` 401, `/docs` 404, no errors in the Backend log. Then stopped everything with the script's `stop`; all four processes confirmed stopped. Not verified: the test flags as reported by `/api/v1/system/config` (the check returned no test keys, probably because the endpoint needs a sign-in; covered by unit tests only), Google sign-in, registration and check-in in a browser.
- **Remaining risks or handoff work:** Owner still has to finish the Google provider and Redirect URLs in the new project, create the teacher invite and link the Test course (README_TH section 8.6). `frontend/.env.local` still points at the real project; the launcher overrides it for this run only, but a plain `npm run dev` would use the real project.

## 2026-11-13 18:40 - Claude - Diagnosis: external Gmail sign-in blocked by Google (org_internal), not by the database trigger

- **Objective:** The owner reported that a Gmail account could not sign in to the test system and suspected a stale PostgreSQL trigger function.
- **Files or components changed:** none (diagnosis only).
- **Implementation rationale:** The screenshot shows Google's own page "access blocked ... only for users in the organization", error 403 org_internal. That page appears before Supabase receives anything, so no database function can be involved. Checked the test project anyway (read-only): the flag `allow_external_email` is on, `handle_new_user` is the test version (mentions the flag table), the `on_auth_user_created` trigger is enabled, and `auth.users` is empty, which means no sign-in ever reached Supabase user creation. PostgreSQL does not cache function bodies across sessions in a way that would explain this.
- **Security and privacy impact:** none from this entry. Note for the owner: the Google OAuth client in use belongs to a Google Cloud project whose consent screen is set to Internal; switching that project to External would also remove Google's organisation-only barrier for the real system (the real database trigger and the Backend would still reject non-university addresses). A separate Google Cloud project for testing avoids this.
- **Database or deployment impact:** none.
- **Verification performed:** read-only SQL on the test project (flag, function text, trigger state, user counts) and its auth log (only a bad_jwt warning for a stale token sent to the new project from the hosting domain, no sign-in event). Not verified: the fix itself, which is a Google Cloud setting only the owner can change.
- **Remaining risks or handoff work:** owner to create an External consent screen (preferably in a separate Google Cloud project), create a Web OAuth client with the test project's Supabase callback URL, and paste its client id and secret into the test project's Google provider. If an old browser session misbehaves, clear site data for the hosting domain.

## 2026-11-13 19:30 - Claude - Permanent test course 030513702 wired in; stale-connection retry; integration check on the test database

- **Objective:** After external sign-in worked, the owner reported that the remaining items still did not work and asked for the permanent test course: code 030513702, name "Select Topic React", semester 1, section 1, kept (not recreated) if it already exists and used for all testing.
- **Root cause (verified):** The test database already held that course (created by the teacher), but the Backend's test-course list pointed at a placeholder course "TEST" created earlier by this agent. Students therefore never saw the sessions the teacher opened in the real course (both earlier sessions were in it), and no check-in attempt was ever made (`face_checkin_attempts` had 0 rows). Auto-join and registration without a card had worked (one registered student, enrolled in the placeholder).
- **Files or components changed:** created `supabase/test-only/20261113130000_permanent_test_course.sql` (creates the course only if missing, enrols registered students, delete guard trigger); `backend/routers/test_mode.py` (the polled `/open-sessions` reads are retried once on a transport error, because the log showed two 500s from "Server disconnected" on a pooled HTTP/2 connection); tests in `backend/tests/test_external_email_and_attempts.py`; `deployment/docker/README_TH.md`. In the private settings file, `STAGING_TEST_DB_COURSE_IDS` now holds the real course's id.
- **Implementation rationale:** The course already matched the requested data, so it was kept untouched (same id, teacher, join code, sessions). The placeholder course had no sessions and was removed after the permanent course was confirmed; its one student was already a member of the permanent course. The delete guard makes "keep it forever" hold against accidental deletion; it can be disabled on purpose. The retry is limited to reads of the test-mode router; other Backend code paths were not changed.
- **Security and privacy impact:** None added. The guard and seed live in `supabase/test-only/` and must never be applied to production. No keys or ids written to this log.
- **Database or deployment impact:** Test project only: migration applied (seed, guard trigger), placeholder course deleted. Production untouched. The running stack must be restarted for the new course list to take effect (the launcher reads the settings file at start).
- **Verification performed:** Backend suite 280 tests, OK, 1 skipped. Integration check against the real test database using the Backend's own functions: test course recognised, auto-join idempotent (one enrolment after two joins), student sees an opened session with code and name, three check-in rights in a row, success and failed attempts written with score, status, stage and reason, no `attendance_records` row written; all rows and the session were removed afterwards (0 open sessions, 0 attempts left). Delete guard verified (delete refused, course still present). Not verified: the real face scan, liveness and the browser UI for registration and the "check in again" button.
- **Remaining risks or handoff work:** Restart the stack after the settings change; the teacher must open a new session (the two earlier ones are closed). Students who have not registered a face are not enrolled until they do. The same "Server disconnected" reset can still hit other endpoints (for example the profile lookup in `get_current_user` answers 503 and the client retries); a shared fix (HTTP/1.1 or a retrying transport for the Supabase client) was deliberately not made because it changes the production code path.

## 2026-11-13 21:10 - Claude - Audit against the eight requirements; standing test session, backfill, test status, earlier failure logging

- **Objective:** The owner asked whether the system really does everything the original request listed, especially keeping the test course's check-in open, and to fix what does not.
- **Audit result (requirement -> state before this change):** (1) external e-mail sign-in: works, confirmed by the owner. (2) no card/OCR and no student id: works (placeholder id), confirmed by data. (3) test course: exists and is the only listed course. (4) auto-join after face registration: works, but only at registration time, so a student who registered before the course was listed was never enrolled: gap. (5) results table: written for success and for failures, but a failure raised while checking the liveness evidence was not logged because the course was not yet known: gap. (6) check-in left open and unlimited: NOT met. Nothing opened a session by itself; the teacher had to open one, it was closed by hand earlier, and the status was computed from the session's start time, so after the absent threshold (45 minutes) every successful check-in would have been recorded as "absent": gap. (7) no QR: works on both sides. (8) check in again: works (button and unlimited rights).
- **Files or components changed:** `backend/services/test_mode_service.py` (`ensure_test_course_sessions`, a throttled variant, `backfill_test_course_members`), `backend/routers/test_mode.py` (the student poll recreates a closed session), `backend/main.py` (a startup keeper loop only inside the test-mode block, every 30 seconds; the course is resolved right after the challenge is loaded so liveness-evidence failures are logged; test courses record status "present"), tests in `backend/tests/test_external_email_and_attempts.py`, `deployment/docker/README_TH.md`.
- **Implementation rationale:** The session is opened in the course teacher's name so the teacher's dashboard shows it and can close it (it comes back within the interval). Only the listed course UUIDs are touched and never in all-courses mode, so real classes are never given sessions. "Present" is used for test courses because a session that never closes has no meaningful late/absent clock; normal courses keep the clock. The startup hook uses `app.on_event` because this FastAPI version has no `add_event_handler` (found by running the real app).
- **Security and privacy impact:** Test mode only; the keeper code is not reached when the mode is off (unit test checks it is inside the test block). It writes only session rows for listed courses and enrolments for already registered students. No secrets or personal data logged.
- **Database or deployment impact:** No schema change. Test project data: one standing open session exists for the permanent test course after the checks. Production untouched. The running stack must be restarted to load the new code.
- **Verification performed:** Backend suite run in full (result in the report). Real app started with TestClient against the test database: from a state with no open session, a session appeared on startup in the teacher's name, registered students were enrolled, closing it made the student poll recreate exactly one session, no duplicates. Not verified: the real face scan and the browser UI end to end after these changes.
- **Remaining risks or handoff work:** The one-open-session-per-teacher rule means the standing session cannot be created while the teacher has another course's session open. The teacher's live page reads `attendance_records` only, so test check-ins do not appear there; results are in `face_checkin_attempts`. A failure of the check-in right itself (invalid or expired challenge) cannot be attributed to a session and is not logged. The shared Supabase client can still hit "Server disconnected" on other endpoints (see the earlier entry).

## 2026-11-13 22:30 - Claude - Android "camera frame rate not sufficient" error: cause analysis, smaller analysis frames, test-build fps readout

- **Objective:** Two Android phones (Nothing Phone 2a, vivo V21) could not register a face and got "อัตราภาพจากกล้องไม่เพียงพอสำหรับตรวจบุคคลจริง". The owner asked what causes it, how phone front cameras work (general, iPhone, Android) and how to make it work on both platforms.
- **Cause (from the code, not yet measured on the phones):** the message comes from the Backend (`liveness_service.py`) when the client-reported `effectiveFps` is outside 8-35. The browser computes it in `LivenessScanner.tsx` as processed frames per second over the whole attempt, not the camera's frame rate: one frame at a time goes camera -> `createImageBitmap(video)` at the camera's full resolution -> Face Landmarker (WASM, CPU, two faces, blendshapes) -> back. A phone that needs more than about 125 ms per cycle reports under 8 and is refused. The upper limit 35 cannot be reached because submissions are limited to one every 50 ms (20 per second at most). Likely contributors, in order: slow single-thread WASM inference (the page is not cross-origin isolated, so no threads), full-size frames, `numFaces: 2` (the detector keeps running while only one face is visible), low light lowering the camera's own frame rate, battery saver or heat throttling (the vivo showed 25% battery).
- **Files or components changed:** `frontend/src/features/student/LivenessScanner.tsx` (analysis frames are scaled to a longest side of 640 px with `createImageBitmap` resize options, falling back to the full frame; in test builds only, a small on-screen readout of camera fps, processing fps, milliseconds per frame and the source and analysis sizes), `backend/tests/test_external_email_and_attempts.py` (guards: analysis size not larger than the 640 px sent to the server, required-fps label equals the Backend floor, readout only in test builds).
- **Implementation rationale:** the images sent to the server were already limited to 640 px (`frameToJpeg`), so analysing a 640 px frame changes no evidence and the server checks, while removing most of the per-frame copy and preprocessing work. The readout turns the guesswork into numbers the owner can screenshot from the phone. Thresholds, the liveness rules and the Backend were not changed.
- **Security and privacy impact:** none; the Backend still verifies every submitted frame. The readout shows no personal data and is not in the normal bundle (checked). The change to smaller analysis frames IS in the normal bundle, so a release needs a new build to benefit.
- **Database or deployment impact:** none. The test stack must be restarted (it rebuilds the web app); the production-like domain in the screenshots needs a redeploy.
- **Verification performed:** type check and lint clean; frontend tests liveness, camera-quality, test-mode, overlays and face-runtime pass; normal and test bundles build; readout text found only in the test bundle; backend suite run in full. Not verified: the effect on the two phones (no access to them).
- **Remaining risks or handoff work:** if the readout still shows under 8 fps after this change, the next steps in order are: ask Face Landmarker for one face (the Backend already rejects frames with more than one face), enable cross-origin isolation headers so WASM can use threads, lower the Backend floor (the value is self-reported by the client, so it only guards honest clients). Do not lower security checks before the numbers are known.

## 2026-11-13 23:20 - Claude - Android 11+ support gate; GPU face model with CPU fallback; blink scores only when needed

- **Objective:** After the Huawei Y9 2019 (Android 9) readings showed 4 fps with a face in view (75 ms per frame without a face, 236 ms with one), the owner limited the supported Android range to version 11 and newer and accepted the plan: run the face model on the GPU with a CPU fallback, and switch the eye-blink scores on only when needed.
- **Files or components changed:** created `frontend/src/utils/deviceSupport.ts`, `frontend/src/hooks/useDeviceSupport.ts`, `frontend/src/components/UnsupportedDeviceNotice.tsx`, `frontend/scripts/test-device-support.mts` (and the `test:device-support` script, also added to `scripts/verify_release.sh`); modified `frontend/src/workers/faceLandmarker.worker.ts` (GPU delegate, 20 second start timeout, CPU rebuild when the GPU fails at start or on a real frame, blend shapes start off and switch by message, messages handled one at a time), `frontend/src/services/faceLandmarkerRuntime.ts` (Android prefers the GPU, everything else the CPU; engine and switch-time getters; `setBlendshapes`), `frontend/src/features/student/LivenessScanner.tsx` (device gate wrapper, blend shapes on only for the blink action just after the three passive samples, readout of engine and switch time in test builds), `frontend/src/features/student/StudentRegister.tsx` (shows the unsupported notice instead of the card or start step), `frontend/scripts/test-face-runtime.mjs`, `deployment/docker/README_TH.md`.
- **Implementation rationale:** The Android version cannot be read from the User-Agent of Chrome-based browsers (frozen at "Android 10; K"), so the gate reads the real version from User-Agent Client Hints and allows the device when it cannot be determined, instead of blocking new phones by mistake. iOS keeps the existing main-thread CPU path (it works there). The earlier image-size reduction was not the main lever (readouts proved it): the per-frame model cost is, so this change targets the model itself.
- **Security and privacy impact:** none on the checks. The gate is a support message, not a control, and the Backend never uses it. The URL switches `?delegate=` and `?blendshapes=` only work in test builds. No data is sent anywhere new.
- **Database or deployment impact:** none. The web app must be rebuilt and redeployed (the test stack rebuilds on start).
- **Verification performed:** type check and lint clean; frontend tests device-support (new), face-runtime, liveness, camera-quality, test-mode, overlays pass; normal and test bundles build (engine readout text only in the test bundle, notice text in both); backend suite 297 tests OK, 1 skipped. Not verified: the GPU path on any real phone (including inside a module worker), the time the blend-shape switch takes, and the actual frame rate on Android 11+ phones. A GPU that silently produces wrong results rather than failing would not be caught by the fallback; the engine readout and `?delegate=cpu` exist to compare.
- **Remaining risks or handoff work:** collect readings from an Android 11+ phone (for example the Nothing Phone 2a) with the default, `?delegate=cpu` and `?blendshapes=always`. If the GPU is slower or unstable on some chips, make the engine choice adaptive. The Backend's frame-rate floor of 8 is unchanged on purpose (blink detection needs two consecutive closed-eye frames). Browsers without Client Hints and with an old real User-Agent (older WebViews) are blocked correctly; a phone whose version cannot be read is allowed.

## 2026-11-14 00:10 - Claude - Forehead occlusion measured on the real models; narrow/wide eye blink rules, simulated profiles and clear-your-face instructions

- **Objective:** The owner asked to tune the face scan for up to 50% of the forehead being covered (and to tell users to clear their face when it cannot be read), and to support people with narrow or wide eyes: write detailed blink-measurement tests for many eye shapes and run them against the real system.
- **Measured on the real models (public sample photos only, a synthetic dark fringe, 3 shapes per level, 7 faces):** with 50% of the forehead zone covered, detection 21/21, strict observation 21/21, lowest identity similarity 0.86 against the 0.45 threshold, passive PAD failures 0/21. At 100% (to the brow line) lowest similarity 0.66; over the brows/eyes (125%) 0.50. The clear photo itself already failed the PAD threshold in 1 of 7 cases, so PAD jitter is independent of the fringe. Similarity is measured against the same photo without hair, so it is an upper bound. Real MediaPipe Face Landmarker in the browser pane: 18/18 fringe frames detected as one face, eye apertures stable; a fringe over the eyes (125%) raised the eye-blink score to 0.54, so hair over the eyes reads as a closed eye. No threshold change was needed for the forehead.
- **Measured and NOT usable for tuning:** squeezing the eye region of real photos (a proxy, not a real eyelid) moved the Backend 68-point aperture only from 0.35 to 0.29 even when the eyes looked shut (ratio about 0.82-0.96), while MediaPipe followed it strongly (ratio 0.36 at nearly shut) but its blink score only reached 0.34. The proxy cannot show how real closed eyelids read, so the Backend limit for narrow eyes is a hypothesis to confirm on real phones. The Backend aperture is the most likely place a real blink could still be rejected.
- **Files or components changed:** `frontend/src/utils/liveness.ts` (adaptive closed ratio 0.75 -> 0.88 by open aperture, relaxed/firm blend-score paths, recovery ratio 0.70, shared `HybridActionMonitor`, `faceProblemInstruction`, advice constants), `frontend/src/features/student/LivenessScanner.tsx` (uses the monitor, timed clear-face hints, blink prompt "close both eyes firmly and hold about 1 second", retry hint after 4 s, test-build eye readout), `backend/services/liveness_frame_service.py` (`blink_closed_ratio_limit` 0.78 -> 0.88, `blink_aperture_problem`, recovery 0.70, hints; measured ratios appended to the message only when test mode is on), `backend/services/insightface_service.py` and `backend/main.py` (messages mention clearing hair), tests `frontend/scripts/test-blink-profiles.mts` (new, in `verify_release.sh` and `package.json`), `backend/tests/test_blink_aperture_profiles.py` (new), `scripts/evaluate_forehead_occlusion.py` (new, repeatable real-model measurement), `deployment/docker/README_TH.md` section 8.7.
- **Implementation rationale:** a landmark mesh cannot close below an absolute floor, so narrow eyes show a smaller relative drop; the closed limit therefore scales with each person's open aperture and a stronger blink score confirms the looser limit. Held closure and one decisive frame make low frame rates workable. The Backend failure text carries the measured numbers in test mode so real phones supply the data the synthetic proxy could not.
- **Simulation result (logic only, 300 trials per cell, signal model documented in the test file):** before: natural blink at 17 fps passed 25-67%, very narrow eyes failed light blinks; after: natural blink 94-100% at 17 fps and 100% for instructed blinks (natural, slow, held) at 12-30 fps for every shape; photo, wink, squint and nod are rejected (at most 1%). Shallow blinks at 12 fps on very narrow eyes remain below 95% and are informational.
- **Security and privacy impact:** the closed-eye limit is looser for narrow eyes and the recovery limit lower (0.78 -> 0.70). A photo stays near ratio 1.0 and PAD, identity, frame-difference and pose checks are unchanged. Known weak spot (unit-tested as a documented limit): for very narrow eyes whose closed aperture sits at 0.70-0.88 of the open one a closed frame cannot be told from a relaxed open one by aperture alone. No images, numbers about people or secrets stored; evaluation uses public sample photos.
- **Database or deployment impact:** none (no schema change). The web app must be rebuilt and the Backend restarted. Production untouched.
- **Verification performed:** backend suite 310 tests OK (1 skipped); all 13 frontend test scripts OK; type check, lint and production build clean. Real-model runs: InsightFace/PAD forehead experiment and MediaPipe in the browser pane through the app's own worker. Not verified: a full sign-in plus camera flow (Google sign-in cannot be automated here) and any real closed eyelid.
- **Remaining risks or handoff work:** test on real people (narrow, wide, uneven eyes) with the test build overlay and the numbers in the failure text, then adjust `BLINK_CLOSED_RATIO_NARROW`, `BLINK_NARROW_EAR` and `HYBRID_BLINK_LIMITS`. If the Backend aperture rejects real blinks, consider a blend-score based check on the Backend side. Face similarity is still one frame against one stored vector; enrolling several vectors would help changed hairstyles but needs a schema change (not done).

## 2026-11-14 00:45 - Claude - Test course joined automatically at sign-in (no class code, no approval)

- **Objective:** The owner asked that every user who finishes signing in joins the existing test course automatically, without the class-code flow and without waiting for an approval.
- **Files or components changed:** `backend/services/test_mode_service.py` (new `auto_join_test_courses_on_login`: students only, idempotent, remembered per user for 10 minutes, never raises; `backfill_test_course_members` now covers every student account, not only face-registered ones), `backend/main.py` (`/api/v1/auth/me` calls it when test mode is on), `backend/tests/test_external_email_and_attempts.py` (6 new tests, 1 updated), `deployment/docker/README_TH.md` section 8.8.
- **Implementation rationale:** `/api/v1/auth/me` is the request the app makes right after sign-in, so it covers new and returning sessions without a new endpoint. Enrolment is written directly into `enrollments`; no join request is created or approved, so the code/approval flow is simply bypassed for the listed test courses. Teachers and admins are skipped because they are not students of the course (assumption: "every user" meant every student account; say if teachers should be enrolled too). The existing face-registration auto-join and the startup backfill stay as a safety net.
- **Security and privacy impact:** Test mode only; the call sits behind `if ATTENDANCE_TEST_MODE` and the service function also returns 0 outside test mode and in all-courses mode, so production behaviour is unchanged. Only the listed course UUIDs are written. No personal data logged.
- **Database or deployment impact:** No schema change. Test Supabase project only: during verification one existing student account in the test project was enrolled in the test course (intended behaviour); two other student accounts get enrolled by the startup backfill. Backend must be restarted. Production untouched.
- **Verification performed:** Backend suite 316 tests OK (1 skipped). Against the real test database with the service's own function: students 5, enrolled before 2; first call joined one missing student, second call returned 0 (cached), a teacher-role call returned 0, one enrolment row, 0 pending join requests for the test course.
- **Remaining risks or handoff work:** Restart the stack. Pending join requests created earlier for the test course (none found now) are not auto-approved. The join-by-code screen is still visible in the UI; hide it if wanted. The enrolment cache is per process, so a restart re-checks each user once.

## 2026-11-14 01:30 - Claude - Error report and remediation plan for five phone screenshots written to TuningModelLog.md

- **Objective:** The owner supplied five phone screenshots of liveness failures and asked where each message comes from (file and line), what the compared values are and why they were chosen, and then asked that the report be written to a new file, `TuningModelLog.md`, with a remediation plan (best way to tune the model or settings) added after every finished task from now on.
- **Files or components changed:** created `TuningModelLog.md` (report for the five errors with file:line, thresholds, provenance of each value, likely cause with confidence level, six cross-cutting problems, and a four-phase remediation plan: make failures observable, close the web/Backend gaps, tune from consented measurements, change architecture only if needed). No source code changed.
- **Implementation rationale:** Analysis only. The plan separates what was read from code, what was measured earlier, and what is still a hypothesis, and keeps the safety rule of not lowering PAD or identity thresholds without attack-set data.
- **Security and privacy impact:** none. The report omits private URLs, student data, images and keys.
- **Database or deployment impact:** none.
- **Verification performed:** every file:line reference was re-checked against the current source (two constants were corrected from an earlier reply: fps constants at `liveness_service.py:29-30`, check at 302). Not verified: which sub-condition actually failed in each screenshot, because the messages carry no measured values.
- **Remaining risks or handoff work:** the plan is awaiting approval. First step (phase 0) is to split the shared messages and attach measured values in test mode, so the next failed attempts can be classified from the `face_checkin_attempts` table. Proposed thresholds in the plan are starting hypotheses, not measurements.

## 2026-11-14 02:20 - Claude - Phase 0 of the tuning plan: every liveness rejection names its condition and, in test mode, the measured numbers

- **Objective:** Start phase 0 of `TuningModelLog.md`: split the shared failure messages and attach measured values in test mode, so the next failed attempts can be classified from `face_checkin_attempts`.
- **Files or components changed:** created `backend/services/failure_diagnostics.py` (test-mode-only `[รหัส code · value (limit)]` suffix and code reader); `backend/services/insightface_service.py` (`StrictFaceFailure`, per-thread reason for `extract_strict_face_observation`: none / multiple / low score / unreadable landmarks / error); `backend/services/liveness_frame_service.py` (specific messages and codes for face detection, frame 1 size/position, frames 2-3 and the final frame pose, move-closer, identity continuity, static frames; blink message moved to the shared helper); `backend/services/passive_pad_service.py` (per-frame live probability, face-size numbers); `backend/services/liveness_service.py` (fps and duration with measured value and range); `backend/main.py` (identity tag); `backend/services/test_mode_service.py` (classifier reads the code tag first, then ordered phrase markers; new stage codes); tests `backend/tests/test_failure_diagnostics.py` (27 new), adjusted `test_external_email_and_attempts.py` and `test_blink_aperture_profiles.py`; docs `deployment/docker/README_TH.md` section 8.9 and `TuningModelLog.md` entry 2 (report and next plan).
- **Implementation rationale:** One message per failing condition makes the failure table usable for tuning; numbers appear only in test mode so production users keep a single plain Thai sentence. The detector keeps the reason of its last failure per thread, so no second inference is needed. No threshold changed.
- **Security and privacy impact:** none on the checks. The suffix is numbers only (scores, ratios, counts), no images, vectors, names, e-mails or student ids, and stays under the 500-character column limit (tested). It appears only when test mode is on.
- **Database or deployment impact:** no schema change (`failure_stage` is free text up to 40 characters; the new codes fit). Backend restart needed. Production untouched.
- **Verification performed:** backend suite 343 tests OK (1 skipped). Real detector check: a black frame gives `detect_none`, a six-person photo gives `detect_multi` with count 6, a single face passes. Not verified: a live phone attempt; the real failure condition behind the five earlier screenshots is still unknown until new attempts are recorded.
- **Remaining risks or handoff work:** restart the test Backend and collect attempts as described in `TuningModelLog.md` 2.B; then phase 1 (web scanner pose-stability gate, size margin for move-closer, early fps check, low-light and in-app-browser hints) awaits approval. Proposed phase 1 limits are hypotheses.

## 2026-11-14 04:10 - Claude - Phase 1.1 and 1.3: pose gate for the three still frames; scanner stops itself when the camera is too slow

- **Objective:** Do plan items 1.1 and 1.3 from `TuningModelLog.md`: stop the scanner letting a scan finish that the Backend will refuse for head movement between the first three frames, and stop it from sending a scan whose frame rate is under the Backend floor.
- **Files or components changed:** `frontend/src/utils/liveness.ts` (head `roll` in `LivenessObservation` and `observationFromLandmarker(…, aspectRatio)`; `PASSIVE_POSE_LIMITS`, `passivePoseProblem`, `PassivePoseGate`, messages; `measuredFps`, `fpsProblem`, `slowCameraMessage`), `frontend/src/features/student/LivenessScanner.tsx` (gate on the three still frames with restart after 2.5 s of drift, early and final frame-rate stop, late results ignored once stopped), `frontend/src/workers/faceLandmarker.worker.ts` and `frontend/src/services/faceLandmarkerRuntime.ts` (pass frame width/height for roll), `frontend/scripts/test-passive-gate.mts` (new, registered in `package.json` and `scripts/verify_release.sh`), `deployment/docker/README_TH.md` section 8.10, `TuningModelLog.md` entry 3.
- **Implementation rationale:** Before choosing limits, the web (MediaPipe) and Backend (InsightFace) pose values were compared on 56 transformed public photos: yaw, roll and size read 1:1, pitch is about 1.3x larger in the Backend, and the models disagree by about 0.06 on small yaw. My earlier assumption of a 2.3x yaw ratio was wrong and was not used. Limits keep about one disagreement of margin under the Backend's: yaw 0.08, pitch 0.09, roll 0.12, size 15%. The early stop only fires below 6 fps after 24 frames and 3 s; the final check uses the Backend's 8 fps.
- **Security and privacy impact:** none on the checks; the Backend rules and thresholds are unchanged and still decide. The scanner only refuses more attempts earlier. Nothing is sent to the Backend when the scan is stopped for speed, so the signed one-use challenge is not consumed. No images or personal data in the tests or logs (public sample photos only).
- **Database or deployment impact:** none. The web app must be rebuilt (the test stack rebuilds on start).
- **Verification performed:** type check, lint and production build clean; all 14 frontend test scripts pass (new `test:passive-gate`). Real-model comparison on 47 pairs: pose combinations the gate accepts but the Backend would reject = 0 (without the gate the Backend would have rejected 18 of 47); extra rejections caused by the margin = 7 of 47. Not verified: real head movement and live phones (the comparison uses transformed still photos).
- **Remaining risks or handoff work:** collect phone attempts and compare the `framing_*`, `recovery_*`, `move_closer_*` and `fps` counts before and after; if people are asked to restart often, widen yaw from 0.08 to 0.10 first. The action and final-frame tolerances (`hybridActionDetected`, `hybridRecoveryDetected`) are still equal to the Backend's with no margin (plan item 1.1b, recommended next). Items 1.2 and 1.4 and phase 2 await approval.

## 2026-11-14 05:20 - Claude - Phase 1.1b: head pose at the action and final frames measured against the first still frame, with a roll check

- **Objective:** Close the remaining web/Backend pose gap from `TuningModelLog.md` plan item 1.1b.
- **Files or components changed:** `frontend/src/utils/liveness.ts` (`HYBRID_POSE_LIMITS`, shared `hybridPoseStable`; `blinkClosure`, `hybridActionDetected`, `hybridRecoveryDetected` use it; baseline gets optional `roll`), `frontend/src/features/student/LivenessScanner.tsx` (yaw, pitch, size and roll of the baseline now come from the first still frame, like the Backend's reference; eye openness still from the median), `frontend/scripts/test-passive-gate.mts` (pose-margin tests), `frontend/scripts/test-blink-profiles.mts` (head-sway scenarios), `deployment/docker/README_TH.md` section 8.11, `TuningModelLog.md` entry 4.
- **Implementation rationale:** Measured on the real models (47 photo pairs): the old final-frame rule let 11 pairs through that the Backend refuses, all because it never checked head tilt (the Backend does, at 0.18). The limits were chosen by scanning candidate sets on that data: yaw 0.11, pitch 0.12, roll 0.14 (final frame), size 17% (final frame), centre 0.22 give no pass-then-refuse pair and 6 of 47 over-strict refusals. A stricter set I proposed earlier (yaw 0.09 and similar) refused 10 of 47 without protecting more, so it was not used.
- **Security and privacy impact:** none on the Backend checks, which are unchanged and still decide. The web scanner now refuses sooner. No images or personal data used (public sample photos).
- **Database or deployment impact:** none; the web app must be rebuilt.
- **Verification performed:** type check, lint and production build clean; all 14 frontend test scripts pass; the blink simulation still passes for every eye shape with head sway 0.03 added; real-model check as above. Not verified: real hand-held phones.
- **Remaining risks or handoff work:** the yaw margin is only 0.03 (the two models disagree by about 0.06 on small yaw); if `recovery_yaw` or `move_closer_yaw` still appear in `face_checkin_attempts`, lower yaw to 0.09. Next in the plan: run real phones now, then 1.2, 1.4 and phase 2.

## 2026-11-15 01:35 - Claude (lead, with three subagents) - Real-phone data pulled; blink, move-closer, timing, light hints, per-attempt diagnostics and PAD evaluator

- **Objective:** The owner asked me to pull the real test data myself, split the work across subagents, report every step, and continue the four-phase tuning plan in `TuningModelLog.md` to the end.
- **Files or components changed:**
  - Data (read-only): pulled `face_checkin_attempts` from the TEST Supabase project with a scratch script (user ids replaced by pseudonyms before analysis; nothing written to the repo).
  - Frontend (subagent B): `frontend/src/utils/liveness.ts` (move-closer 1.12-1.60 and hints; blink closure levels `lid_down`/`deep`, deepest-frame selection in `HybridActionMonitor`, single-frame shortcut removed, new prompts), new `frontend/src/utils/livenessTiming.ts` (mirrors every Backend timing rule with margin), new `frontend/src/utils/lightLevel.ts`, new `frontend/src/utils/inAppBrowser.ts`, new `frontend/src/components/InAppBrowserNotice.tsx`, `frontend/src/features/student/LivenessScanner.tsx` (gap/recovery guards, pre-upload timing check, kept action bitmap lifecycle, low-light and in-app notices, 20 s timeout now really stops), `frontend/scripts/test-blink-profiles.mts`, new `frontend/scripts/test-scan-guards.mts`, `frontend/package.json`, `scripts/verify_release.sh`.
  - Backend (subagent C): `backend/services/liveness_service.py` (a code per failure, timing split into `_timing_order_problem`), `liveness_frame_service.py` (numbers capture, `blink_pose`/`frames_*` tags, 2d106det blink ratios in test mode; blink message now says "ให้สนิทสักครู่" instead of "ค้างไว้ราว 1 วินาที" — edited by me), `passive_pad_service.py` (per-frame PAD capture), new `attempt_diagnostics.py` (ContextVar collector, numbers-only sanitiser, 2000-byte cap), `insightface_service.py` (lazy, checksum-pinned 2d106det, test mode only), `test_mode_service.py` (diagnostics write with missing-column fallback; classifier markers), `main.py` (collector per attendance request), new `backend/models/insightface-buffalo-s-test-only.sha256`, `scripts/verify_face_models.sh` (optional model), new tests `backend/tests/test_attempt_diagnostics.py` (47), `test_blink_aperture_profiles.py` (prompt assertion).
  - New `supabase/test-only/20261115090000_face_attempt_diagnostics.sql`; new `scripts/evaluate_pad_roc.py`.
  - `.gitignore`: added `.env.*` (keeps `!.env.example`).
  - Docs: `deployment/docker/README_TH.md` section 8.12, `TuningModelLog.md` entry 5.
- **Implementation rationale:** Real data (39 attempts, 4 testers; latest session 19 attempts, 8 failures) showed blink as the main failure (Backend closed ratio 0.82-0.97 vs 0.78), two untagged timing failures the web never guarded, and a move-closer refusal at 1.07 with zero web margin. The investigation subagent showed the uploaded frame is the analysed frame; the causes are the insensitive Backend 68-point eye measure and the web uploading the first qualifying frame with a looser limit. Fixes keep the web stricter than the Backend and change no Backend decision. The 2d106det measure is recorded beside the 68-point one so the owner can decide a Backend rule change from data. Phase 2 threshold changes and all of phase 3 were not done: there is no consented attack set, and the current data does not meet phase 3's triggers (details in `TuningModelLog.md` 5.D).
- **Security and privacy impact:** No security threshold changed (PAD 0.65, identity 0.45/0.35/0.30, blink 0.78/0.88/0.70, pose, fps, timing). The web refuses more, never less. Diagnostics hold numbers and short identifiers only (sanitiser drops text, arrays like embeddings, e-mails); written only in test mode; table RLS deny unchanged. Production never loads 2d106det. Found `backend/.env.old` (pre-existing, untracked, contains a production server key, never committed) and added `.env.*` to `.gitignore`; the file itself was not touched.
- **Database or deployment impact:** Applied the test-only migration `face_attempt_diagnostics` to the TEST project only, after checking that its project ref matches the test URL and differs from the protected production ref; verified column, constraint and RLS afterwards. Production database untouched. Backend restart and web rebuild needed (the test launcher rebuilds). Test-mode scans are about 0.1 s slower.
- **Verification performed:** backend `python -m unittest discover -s tests` → Ran 390 tests, OK (skipped=1). Frontend on Node 22: `npm run lint` exit 0, `npm run build` exit 0, all 15 `test:*` scripts exit 0. `scripts/verify_face_models.sh` OK including the optional model. `evaluate_pad_roc.py` ran on the pulled data and correctly refused to recommend (old rows have no per-frame scores). Blink simulation: instructed blinks 100% for 8 eye shapes at 30/20/17/12 fps; photo/wink/squint/nod 0%; natural/light blinks now mostly refused at low fps (deliberate). Not verified: any of this on a real phone.
- **Remaining risks or handoff work:** Collect a second real-phone round and read `diagnostics`; if blink still fails with 106-point ratios low, propose B2 (106-point Backend rule) for owner approval. F2 (aspect-ratio-corrected web EAR) waits for camera-size readings. Luma 60 and all new margins are unmeasured. Phase 2 PAD needs >=200 genuine and >=100 consented attack attempts. Owner should move `backend/.env.old` out of the repository folder. Nothing committed.

## 2026-11-15 11:08 - Claude (lead, with frontend, backend and independent-review subagents) - Round-two data analysis, Android "update your browser" error fix, PAD capture quality, test-course-only 106-point blink rule, review fixes

- **Objective:** The owner collected a second round of tests on a laptop, iPhone and Android, asked for analysis of what to improve, asked why Android always shows "please update the browser / browser cannot send images", and asked for subagents with split roles plus a review for defects, then fixes.
- **Files or components changed:**
  - Frontend: `frontend/src/features/student/LivenessScanner.tsx` (per-frame error tolerance and accurate messages, fail() halts, camera warm-up, sharpness gate, passive JPEG 0.92, stricter recovery after move-closer, single delivery of success with copied evidence, client diagnostics), `frontend/src/services/faceLandmarkerRuntime.ts` (load-error classification, rebuild after error, Thai messages on rebuild failure), `frontend/src/workers/faceLandmarker.worker.ts` (worker-level error when the CPU fallback fails), `frontend/src/utils/liveness.ts` (passive pitch 0.05, restart 1200 ms, recovery 0.12 after move-closer, face centre), `frontend/src/utils/livenessTiming.ts` (time-limit message), new `frontend/src/utils/{faceScanErrors,captureQuality,clientDiagnostics}.ts`, `frontend/src/services/api.ts`, `frontend/src/features/student/StudentHome.tsx`, `frontend/src/features/student/StudentRegister.tsx` (test-mode load error and retry), tests `frontend/scripts/test-scan-robustness.mts` (new), `test-passive-gate.mts`, `test-scan-guards.mts`, `frontend/package.json`, `scripts/verify_release.sh`.
  - Backend: `backend/services/liveness_frame_service.py` (test-course-only 2d106det blink rule, `blink_rule` diagnostics), `attempt_diagnostics.py` (test-course flag, `client` sanitiser, byte-based cap), `insightface_service.py` (2d106det only for listed test courses), `test_mode_service.py` (re-probe missing column every 600 s, retry on diagnostics CHECK violation), `main.py` (`client_diagnostics` form field, parsed only in test mode; test-course flag before verification), `scripts/verify_face_models.sh` (comment), new `scripts/analyze_attempts.py`, new `backend/tests/test_blink_106_and_client.py`, updated `backend/tests/test_attempt_diagnostics.py`.
  - Docs: `TuningModelLog.md` entry 6.
- **Implementation rationale:** Round-two data (21 attempts with diagnostics: 9 passed, 12 failed; PAD 7, blink 2) showed PAD failures driven by per-frame quality (scores swinging 0.07-0.91 inside one scan, worst with head-pitch movement and on ~9 fps phones), so the web now picks better frames instead of the threshold being lowered. Both blink failures read clearly closed on the 106-point measure, so a 106-point rule was added for listed test courses only, with a 68-point ceiling of 0.90 that keeps static photos out. The Android message came from a catch-all that treated any single-frame error as fatal and from a fail() that did not stop the loop, so a later "runtime not ready" message overwrote the real error. An independent reviewer found nine defects (one medium: the 106-point rule applied to real courses on a test-mode backend); all nine were fixed.
- **Security and privacy impact:** No production threshold changed (reviewer compared against HEAD). The 106-point rule and the 2d106det model run only when test mode is on and the attempt is for a listed test course; enrollment and real courses keep the 68-point rule. `client_diagnostics` is parsed only in test mode, holds whitelisted enums and clamped numbers (no user-agent text, ids or e-mails), and is never used in a decision. Noted, unchanged by owner request: test-mode enrollment needs no student card, so test mode must never point at a database with real students.
- **Database or deployment impact:** Read-only pull from the TEST project; no schema change this round. Backend restart and web rebuild needed (the test launcher rebuilds the web). Test-course scans run 2d106det (about 19 ms per frame on CPU).
- **Verification performed:** backend `python -m unittest discover -s tests` → Ran 420 tests, OK (skipped=1). Frontend (Node 22): `npm run lint` exit 0, `npm run build` exit 0, test-mode `vite build` exit 0, all 16 `test:*` scripts exit 0. `scripts/verify_face_models.sh` OK. Independent review read the full diff and ran all suites. Not verified: any of this on a real phone, the first error that actually fires on the owner's Android device, fps cost of the sharpness readback.
- **Remaining risks or handoff work:** Collect a third round and run `scripts/analyze_attempts.py` per device; the test-mode error box now names the real Android error if it still occurs. All new constants are unmeasured. The 106-point rule rests on 2 failures and 5 successes; production use needs owner approval and more data. PAD aggregation changes still need >=100 consented attack attempts. `backend/.env.old` should be moved out of the repository folder. Nothing committed.

## 2026-11-15 11:36 - Claude (lead, with frontend, backend and independent-review subagents) - Plan closed without new data: F2 eye measure, production 106-point blink rule with kill switch, final review fixes

- **Objective:** The owner said no more data collection and asked to finish the four-phase plan. Asked in chat, the owner chose to enable the 106-point blink rule in production and to keep the PAD rule unchanged.
- **Files or components changed:**
  - Frontend: `frontend/src/utils/liveness.ts` (eye aspect ratio in true geometric units using the frame aspect; roll uses the sanitised aspect — the last line edited by me), `frontend/scripts/test-scan-robustness.mts` (F2 tests).
  - Backend: `backend/core/config.py` (`LIVENESS_BLINK_106_ENABLED`, default on, strict parser), `backend/services/liveness_frame_service.py` (106 rule for all courses and enrollment, fail-closed on non-finite values in both blink rules, blink pose and legacy path), `backend/services/insightface_service.py` (2d106det in production for blink frames only, pinned SHA-256, retry every 300 s, finite-value checks on observations), `backend/services/attempt_diagnostics.py` (test-course helpers removed), `backend/main.py` (startup load, `/health/ready` field `blink_106`), `backend/models/insightface-buffalo-s.sha256` (adds 2d106det), deleted untracked `backend/models/insightface-buffalo-s-test-only.sha256` created by the previous round and superseded, `scripts/verify_face_models.sh` (all manifest files required; trailing blank line removed by me), `scripts/production_preflight.py` (pins 2d106det, validates the switch, blank = on), tests `backend/tests/test_blink_106_and_client.py`, `backend/tests/test_attempt_diagnostics.py`.
  - Docs: `deployment/backend.env.example`, `deployment/README.md`, `deployment/docker/README_TH.md` (models list, section 8.13), `docs/ai_tuning/AI_TUNING_TEST_GUIDE_TH.md` (2d106det now used), `TuningModelLog.md` entry 7.
- **Implementation rationale:** F2 removes a measurement-unit mismatch (web EAR was scaled by width/height: 0.56x on portrait phones, up to 1.78x on laptops), so the shared constants 0.26/0.13 now mean the same thing on both sides. The production rule follows the owner's decision; the kill switch and 68-point fallback keep a safe exit. The final review found a NaN fail-open in the photo ceiling (hard to reach); all blink comparisons are now written to pass only inside the limit with finite values.
- **Security and privacy impact:** Production blink acceptance widens only where the 68-point ratio is between the adaptive limit and 0.90 and the 106-point ratio is <= 0.50 on both eyes; static photos (68-point ~1.0), winks and eyes kept shut stay refused (tested), PAD 0.65 on every frame and identity rules unchanged. No consented attack data exists for this rule. Production failure messages stay plain Thai without numbers. No new data stored.
- **Database or deployment impact:** No database change. Deployment now requires `2d106det.onnx` from buffalo_s next to the other three models, readable by the backend user; preflight and the systemd pre-start fail without it (intended). About 7 ms extra per blink frame (~36 ms per blink scan). Docker build not run.
- **Verification performed:** `scripts/verify_release.sh` exit 0 ("Release verification completed successfully"): `git diff --check` clean, face models OK (4 files), backend Ran 442 tests OK (skipped=1), `pip check` clean, frontend lint, all test scripts, build and production audit with 0 vulnerabilities (npm also lists 4 pre-existing low-severity dev-dependency advisories in `vite-plugin-pwa`/`workbox-build`). Independent review of the production rule and F2 found no critical or high issue; its findings were fixed. Not verified: real phones, Docker image.
- **Remaining risks or handoff work:** Provision `2d106det.onnx` before the next deploy and check `/health/ready` shows `blink_106: "ready"`. The 106 rule rests on 2 failures and 5 successes; watch blink and PAD pass rates after deploy and use `LIVENESS_BLINK_106_ENABLED=false` if needed. PAD rule change, pose percentiles, fps floor and phase 3 remain blocked on consented attack data or were rejected for security. `backend/.env.old` (production key, untracked, now git-ignored) should be moved out of the repository. Nothing committed.

## 2026-11-15 16:08 - Claude (lead, with backend, frontend and independent-review subagents) - Median PAD rule, Realme 16 Pro+ fixes, blink ceiling from data, server-side move_closer fallback with retry challenge, PWA update flow

- **Objective:** The owner asked to read failure_stage from the database, make PAD easier to pass with a more suitable rule, and fix the problems of one tester on a Realme 16 Pro+ (five screenshots: 6 fps stop, two blink failures, two PAD failures) using subagents with clear roles and a detailed report.
- **Owner decisions (asked in chat):** PAD median >= 0.60 and min >= 0.30 in production with a kill switch; 106-point blink photo ceiling derived from data; switch to move_closer after two blink failures; make PAD, move-closer and return easier.
- **Files or components changed:** Backend: `backend/core/config.py` (LIVENESS_PAD_RULE, LIVENESS_PAD_MEDIAN_THRESHOLD, LIVENESS_PAD_MIN_FRAME_FLOOR, strict LIVENESS_PAD_THRESHOLD), `backend/services/passive_pad_service.py` (pad_decision, actionable message, diagnostics), `backend/services/liveness_frame_service.py` (ceiling 0.94, 106 base guard 0.10, unrounded decisions, BlinkActionFailure, on_blink_passed, fail-closed framing/move-closer checks), new `backend/services/action_fallback.py`, `backend/services/liveness_service.py` (forced move_closer at challenge issue), `backend/main.py` (retry_challenge 422 body, stale blink token refusal, fallback bookkeeping for attendance and enrollment), `backend/services/attempt_diagnostics.py` (web_build, web_commit), `backend/services/test_mode_service.py` (action_fallback marker), `scripts/production_preflight.py`, `scripts/evaluate_pad_roc.py`, `scripts/analyze_attempts.py`, `deployment/backend.env.example`, `deployment/README.md`, new tests `backend/tests/test_pad_median_rule.py`, `test_action_fallback_and_ceiling.py`, `test_action_fallback_endpoints.py` and updates to existing tests. Frontend: `frontend/vite.config.ts` (injectRegister false, skipWaiting, clientsClaim, cleanupOutdatedCaches, build id), new `frontend/src/pwa/{registerServiceWorker,updateGate}.ts`, `frontend/src/config/buildInfo.ts`, `frontend/src/utils/{delegateTuner,engineSwitchGuard,padFailure}.ts`, `frontend/src/components/PadRetryChecklist.tsx`, `frontend/src/services/retryChallenge.ts` (TTL bound widened to 4 h by me for test-mode claims), `frontend/src/services/{api,faceLandmarkerRuntime}.ts`, `frontend/src/workers/faceLandmarker.worker.ts`, `frontend/src/utils/{liveness,captureQuality,clientDiagnostics}.ts`, `frontend/src/features/student/{LivenessScanner,StudentHome,StudentRegister}.tsx`, `frontend/src/main.tsx`, tests `frontend/scripts/test-scan-robustness.mts`, new `frontend/scripts/test-retry-challenge.mts`, `frontend/package.json`, `scripts/verify_release.sh`. Docs: `deployment/docker/README_TH.md` section 8.14, `TuningModelLog.md` entry 8.
- **Implementation rationale:** Read-only database queries on the TEST project (pseudonymised) showed PAD as the top failure, mostly one slow device apparently on a stale cached build, and frame 1 often near zero. The scanner took passive frame 1 too early (0.13-0.45 s after the face appeared, before exposure settled and before the blur gate had history). The Realme blink failures were a 0.909 68-point ratio against a 0.90 ceiling and a 68-point measure that did not move on narrow eyes; the ceiling 0.94 is the midpoint between the genuine maximum (0.909, n=17) and the static-photo minimum (~0.96). The Realme GPU ran at ~160 ms per frame, so the web now measures GPU vs CPU and keeps the faster. Independent review round 3 found the fallback could not reach production students because retries reused the same blink QR challenge; the backend now returns a move_closer retry challenge for the same claim and expiry.
- **Security and privacy impact:** Two production liveness rules were loosened at the owner's request without consented attack data: PAD aggregation (median 0.60 / floor 0.30) and the 106-point photo ceiling (0.94); both keep kill switches (LIVENESS_PAD_RULE=all_frames, LIVENESS_BLINK_106_ENABLED=false) and preflight refuses further loosening below 0.50/0.20. All new checks fail closed on non-finite values. The fallback action is decided server-side from the authenticated user id; the client cannot choose it; the retry challenge reuses the same QR claim and never extends its expiry. Fallback state is in memory (user id and counters only). No new personal data stored; localStorage holds only the engine choice.
- **Database or deployment impact:** No schema change; read-only queries on the TEST project only. Backend restart and web rebuild needed. Production single-worker deployments keep consistent fallback state; a restart forgets it.
- **Verification performed:** `scripts/verify_release.sh` exit 0 ("Release verification completed successfully"): git diff check, 4 face models OK, backend Ran 486 tests OK (skipped=1), pip check, frontend lint, all 17 test scripts, build, production audit 0 vulnerabilities. Independent review round 3 ran all suites and its findings were fixed. Not verified: real phones (including the Realme), Docker build, a deploy during a scan.
- **Remaining risks or handoff work:** Retest the Realme on a fresh tab and confirm the new build id and `delegate` in `diagnostics.client`. Watch PAD frame-1 scores, `recovery_scale` after move_closer (0.15 is accepted owner risk), and blink_rule counts. Enrollment does not yet return retry challenges. PAD and blink-ceiling changes need consented attack data to confirm. `backend/.env.old` (production key, untracked, git-ignored) should still be moved out of the repository. Nothing committed.

## 2026-11-15 18:30 - Claude - Pilot check-in log table (test project) and Phase B release guards

- **Objective:** Before merging to main, the owner asked for Phase B and a new table that records every face check-in attempt with user uuid, e-mail, student id, similarity score and failure reason, to collect sample data from 30-50 people. Owner decisions in chat: TEST project only; every attempt including failures; e-mail and student id copied into the table; keep a single Backend worker instead of moving the fallback state to the database.
- **Files or components changed:**
  - New `supabase/test-only/20261115180000_pilot_checkin_log.sql`: table `public.pilot_checkin_log` (snapshot e-mail/student_code, course_code, attempt_no, outcome, scores, generated `face_match`, liveness action, failure stage/reason), AFTER INSERT trigger `face_checkin_attempts_copy_to_pilot_log` with security-definer function `copy_face_attempt_to_pilot_log()` (per-student advisory lock for attempt_no, own exception handler so a copy problem never blocks the attempt row or the check-in), switch `test_mode_flags.pilot_checkin_log` (on), view `public.pilot_checkin_summary` (security_invoker, one row per participant). RLS deny policy, all privileges revoked from anon/authenticated.
  - `backend/.dockerignore`, `ocr-service/.dockerignore`: exclude `.env.*` (keep `.env.example`); backend also excludes `.pytest_cache`, `*.bak`.
  - New `backend/tests/test_deploy_guards.py` (6 tests): `--workers 1` in Dockerfile and systemd unit, compose files do not override the command or set WEB_CONCURRENCY, both dockerignore files exclude env backups.
  - `deployment/docker/README_TH.md` section 8.15 (how to read, switch off and delete the pilot data).
- **Implementation rationale:** A trigger on the existing attempt table captures every attempt the Backend already records, without touching check-in code, so the pilot cannot break attendance. Copying e-mail/student id follows the owner's choice (easy CSV export); deletion follows the profile (cascade). Phase B review found that `backend/.dockerignore` excluded `.env` but not `.env.old`, so `COPY . /app` would have baked the local production key file into the image; fixed and guarded by a test. The fallback state lives in one process, so the single-worker launchers are now pinned by tests. Preflight already refuses every test-mode switch (covered by the existing test in `test_attendance_test_mode.py`) and pins the 2d106det checksum.
- **Security and privacy impact:** The new table holds personal data (e-mail, student id) next to face scores, in the TEST project only; no images, embeddings, names or diagnostics. Browser roles have no access (verified: anon/authenticated have no select on table or view and no execute on the function). The owner should collect only from consenting participants and truncate the table after the pilot. Docker images no longer can include env backups.
- **Database or deployment impact:** Migration applied to the TEST project `kmutnb-attendance-test` only (project URL checked against the test ref before applying). Production database untouched; this file must never be applied there. No Backend restart needed for the table. Docker images now exclude `.env.*`.
- **Verification performed:** In a rolled-back transaction on the test project: a failed then a successful attempt produced attempt_no 1 and 2 with e-mail, student id and course code copied, face_match true for 0.71 vs 0.45, summary row attempts=2/ok=1/fail=1/first_try=false/until=2/common=pad; with the switch off no row was copied. Afterwards: 0 rows in the log, switch on, RLS on, no browser privileges. Supabase security advisor: no new findings (two pre-existing). `docker build` of backend and OCR images exit 0; backend image contains only `.env.example`, runs as non-root `attendance`, imports fastapi/onnxruntime 1.26.0/insightface/cv2. `scripts/verify_release.sh` exit 0: 4 face models OK, backend Ran 492 tests OK (skipped=1), frontend lint/tests/build, production audit 0 vulnerabilities (4 pre-existing low dev advisories).
- **Remaining risks or handoff work:** Not verified: a live check-in writing a real pilot row (needs the test stack running), container start with real env and mounted models. The pilot log only covers attempts the Backend records (test courses in test mode). Consented attack testing (Phase B item 5) still needs participants. `backend/.env.old` should still be moved out of the repository and its key rotated if it was ever shared. Nothing committed.

## 2026-11-15 18:43 - Claude - Consolidated tuning report ReportTuning.md

- **Objective:** The owner asked for one detailed report of the whole face-model tuning work from the start: topics and details of each change, the errors found, and the results after each fix, written as `ReportTuning.md`.
- **Files or components changed:** new `ReportTuning.md` (Thai): executive summary with measured before/after numbers, how the liveness checks work, timeline of every round (2026-11-13 to 2026-11-15), per-round problem/fix/result sections 4.1-4.10, before/after threshold tables for the Backend and the web, a list of 27 system defects and 4 of my own analysis mistakes, combined results and test-count history, security trade-offs with kill switches, remaining risks and a proposed next plan. No code changed.
- **Implementation rationale:** Compiled only from `TuningModelLog.md` entries 1-8, earlier `log.md` entries from 2026-11-13 22:30 onward and `README_TH.md` 8.7-8.15, so every number has a source; places where only simulations or calibration photos back a number say so. The success criteria in the next-plan table are labelled as my proposals. The owner's satisfactory result after the Realme round is reported as their statement, not as measured data.
- **Security and privacy impact:** none. The report has no names, e-mail addresses, student ids, URLs, keys or images (checked with a search for @, URLs and 13-digit numbers: no hits).
- **Database or deployment impact:** none.
- **Verification performed:** cross-checked key numbers against the source entries and corrected three statements before saving (the original web recovery limit, a recovery_scale failure in round two, and the proposed status of the success criteria). The file is git-ignored by the existing `*.md` rule like the other reports.
- **Remaining risks or handoff work:** the report must be updated after the 30-50 person pilot and the consented attack test. Nothing committed.

## 2026-11-15 20:30 - Claude - Diagnosis: face runtime "crashed" error in the Messenger in-app browser
- **Objective:** Explain a tester screenshot showing "runtime status error" (face detector stopped mid-scan) on Android inside Messenger's in-app browser.
- **Files changed:** `TuningModelLog.md` (appended entry 9: report and proposed plan). No code changed.
- **Rationale / findings:** The message is the `crashed` class from `classifyRuntimeLoadError`. The debug panel showed GPU at 221 ms/frame (4 fps), above the tuner's 110 ms limit, so a mid-scan GPU→CPU rebuild is requested after 15 frames; a failed rebuild, a GPU fault or a killed worker all end in `rejectLoad` and this same message. The raw error goes only to `console.error`, so the exact branch is unconfirmed (hypothesis: WebView memory/GPU limits).
- **Security & privacy:** None. No user data, URLs or images recorded.
- **Database / deployment:** None.
- **Verification:** Code reading only; not reproduced on a device.
- **Remaining risks / handoff:** Proposed (not done): show a truncated raw error in the test panel; on a GPU/switch crash retry on CPU and remember it; avoid mid-scan delegate switches in in-app browsers; stronger "open in Chrome" prompt.

## 2026-11-15 21:00 - Claude - Action timing inventory and laptop PAD 0.00 diagnosis
- **Objective:** (1) List every timing limit that governs the blink / move_closer challenge, so the owner can choose longer values before any change. (2) Diagnose a Lenovo Yoga 6 13ABR8 tester failing face enrollment with PAD live scores 0.00 on all three frames.
- **Files changed:** `TuningModelLog.md` (appended entry 10). No code or database changes.
- **Rationale / findings:** There is no dedicated clock for performing the action; the user-felt limits are action→recovery (Backend 3,000 ms, web 2,700 ms) and the 20 s whole-attempt budget (both sides). The PAD crop box is computed server-side, so a coordinate mismatch is unlikely; scores below 0.005 on every frame point to camera-side processing (Lenovo/Windows camera effects), a wrong camera (IR/virtual) or harsh laptop lighting. Hypotheses only.
- **Security & privacy:** Read-only SELECT on the TEST project's `face_checkin_attempts` (scores and client fields only; no identities recorded here). No thresholds were lowered.
- **Database / deployment:** None.
- **Verification:** Code reading plus one read-only TEST query; laptop issue not reproduced.
- **Remaining risks / handoff:** Owner to pick new timing values (both Backend and web constants must move together). Proposed: log failed enrollments to a test table, show the active camera label in the test panel, and collect tester feedback after disabling camera effects.

## 2026-11-15 21:20 - Claude - Longer liveness action window (5 s) and attempt budget (30 s)
- **Objective:** Owner chose 5 s for action→recovery and 30 s for the whole scan after testers reported running out of time.
- **Files changed:** `backend/services/liveness_service.py` (MAX_ACTION_SPAN_MS 3000→5000, MAX_ATTEMPT_DURATION_MS 20000→30000; the owner's own inline comment kept), `backend/main.py` (RETRY_CHALLENGE_MIN_SECONDS 15→35 and its comment), `frontend/src/utils/livenessTiming.ts` (maxActionToRecoveryMs 2700→4700, maxAttemptMs 19500→29500, comments), `frontend/src/features/student/LivenessScanner.tsx` (ATTEMPT_TIMEOUT_MS 30000), `frontend/src/features/student/StudentHome.tsx` (text "30 วินาที"), `frontend/src/utils/liveness.ts` (comment), tests: `backend/tests/test_attempt_diagnostics.py`, `test_failure_diagnostics.py`, `test_liveness_security.py`, `frontend/scripts/test-scan-guards.mts`, `test-scan-robustness.mts`; `TuningModelLog.md` entry 10.D.
- **Rationale:** Both sides must move together; the web keeps the same safety margins below the Backend (300 ms and 500 ms) so a too-slow scan is retried locally before any upload. The retry challenge minimum was raised so a replacement challenge is never issued with less time than one full scan.
- **Security & privacy:** Slightly longer window for frame substitution between action and recovery (+2 s); PAD, continuity and randomized prompt delay unchanged. No data handling change.
- **Database / deployment:** None. Backend and frontend must be deployed together (an old web build against the new Backend is harmless; a new web build against an old Backend would send 20-30 s scans that the old Backend refuses).
- **Verification:** Backend `.venv/bin/python -m unittest discover -s tests`: Ran 492 tests, OK (skipped=1). Frontend on Node 22.23.2: all 17 `test:*` scripts exit 0, `npm run lint` exit 0, `npm run build` exit 0, `tsc -b` exit 0. Not verified on a real phone.
- **Remaining risks / handoff:** Unrelated uncommitted change present in `backend/main.py` (FACE_THRESHOLD 0.45→0.50, made by the owner, left untouched). Measure `timing_action_span`/`duration` failure rates in `pilot_checkin_log` after the change.

## 2026-11-15 21:45 - Claude - Liveness scanner layout: instruction card on top, face guide lower
- **Objective:** Owner asked to move the liveness instruction box to the top of the scanner and shift the white face oval down a little.
- **Files changed:** `frontend/src/features/student/LivenessScanner.tsx` only: the instruction card (progress bar, instruction text, move-closer size guide) now sits right under the header; the oval moved from top 46% to 54% and was made slightly smaller (h min(55dvh,34rem)→min(48dvh,31rem), w min(72vw,24rem)→min(68vw,23rem)) so it never sits under the card; the in-app/low-light hints and the small explanatory line stay at the bottom; the test-mode stats panel moved to the lower left so it no longer covers the card.
- **Rationale:** Instructions near the top are closer to the camera, so people read them without looking away from the lens. No scan logic, thresholds or face-position checks changed (the quality gate measures the face against the camera frame, not the drawn oval; 54% is about as close to the frame centre as the old 46%).
- **Security & privacy:** None. **Database / deployment:** None (frontend only).
- **Verification:** Node 22.23.2: all 17 `test:*` scripts exit 0, `npm run lint` exit 0, `npm run build` exit 0. Layout checked with a static mock of the same classes at 375×667 and 390×844 using the longest instruction plus the size guide: card and oval do not overlap. Not checked on a real phone with the live camera.
- **Remaining risks / handoff:** Very short screens (<640 px tall) or a two-line notice from the browser could bring the card close to the oval top; check on the testers' phones.

## [2026-11-15 22:10] Claude: Update ReportTuning.md with the evening tester-feedback rounds
- **Objective:** Owner asked for a detailed, plain-language update of the tuning report.
- **Files changed:**
  - `ReportTuning.md` (modified) and `docs/ReportTuning.md` (kept as an identical copy).
    - Header now cites TuningModelLog entries 1–10.
    - Executive summary gained a bullet on the tester-feedback round and a note about the uncommitted `FACE_THRESHOLD = 0.50`.
    - Timeline gained four rows.
    - New sections 4.11–4.14:
      - 4.11: Messenger in-app browser crash.
      - 4.12: Lenovo Yoga 6 PAD 0.00.
      - 4.13: 5 s / 30 s timing change.
      - 4.14: scanner layout change, plus the 0.45 vs 0.50 note.
    - Updated the threshold tables in sections 5.1 and 5.2.
    - Added bug rows 28–32 to section 6.1.
    - Added the price of the longer timing to 7.3 and a timing row to section 8.
    - Added risks 8–11 to section 9.1 and plan items 9–12 to section 9.2.
- **Rationale:** The report stopped at round 4.10 (18:30). Everything added comes from TuningModelLog entries 9–10 and the log.md entries of 20:30–21:45. No new measurements.
- **Security/privacy:** The report contains no names, emails, student codes, images, keys or private URLs. Device model names only.
- **DB/deploy:** none.
- **Verification:**
  - Every replacement anchor was asserted to match exactly once.
  - Confirmed sections 4.11–4.14 are present (665 lines).
  - The `docs/` copy was synced with `cp`.
  - No code changed, so no tests were run.
- **Remaining risks/handoff:**
  - The `FACE_THRESHOLD` 0.50 decision is still the owner's to make.
  - The entry 9 and 10 code proposals are not implemented.
  - Nothing is committed.

## [2026-11-16] Claude: Adopt face-match threshold 0.50 (owner decision)
- **Objective:** The owner chose `FACE_THRESHOLD = 0.50` instead of 0.45. The value was already in the working tree but uncommitted. The task was to make the docs agree with it and check its impact.
- **Files changed:**
  - `backend/main.py`: no new edit; the 0.50 value is kept as the owner made it.
  - `deployment/docker/README_TH.md`: the `identity` row now says 0.50. Added a note under the forehead-occlusion table that the 125% case (minimum 0.50) sits exactly on the new line.
  - `ReportTuning.md` and `docs/ReportTuning.md`:
    - New section 4.15 covering the decision, the trade-off and a back-test.
    - Updated the summary, timeline, tables 5.1 and 8, risk 11 and plan item 9.
  - `TuningModelLog.md`: entry 11.
- **Rationale:**
  - The constant is the single source for the decision, the test-mode message and the stored `threshold_used`.
  - Test fixtures that pass `threshold_used=0.45` are only stored-value examples, so they were left alone.
  - `test_mode_service.THRESHOLD_KEY` is unused.
- **Security/privacy:**
  - Stricter identity matching means fewer impostor and look-alike accepts, and more false rejects for genuine users.
  - The back-test was a read-only aggregate on the TEST project. No identifiers were read or recorded.
- **DB/deploy:**
  - No schema change.
  - Rollback: set the constant back to 0.45 and restart the Backend. There is no env switch.
- **Verification:**
  - Backend unittest: `Ran 492 tests`, `OK (skipped=1)`.
  - Back-test on 77 scored attempts from 14 testers: 0 below 0.50; 6 in the 0.50–0.60 range; min 0.553; p05 0.581; median 0.727.
- **Remaining risks/handoff:**
  - The margin is only about 0.05 above the lowest genuine score, and the sample is small.
  - Monitor `identity` failures in `pilot_checkin_log`.
  - Nothing is committed.

## [2026-11-16] Claude: CompareFaceExplain.pdf (face embedding storage and matching explainer)
- **Objective:** Owner asked for the face-embedding explanation as a PDF.
- **Files changed:** `CompareFaceExplain.pdf` (created, project root, 3 pages, Thai). No code changed.
- **Content:**
  - How enrollment stores one 512-d embedding per account in `profiles.face_embedding` (`vector(512)`), written by `finalize_face_enrollment` with no overwrite.
  - How check-in compares only against the logged-in account's own embedding (1:1, threshold 0.50).
  - The three ways another user's name could appear.
  - How 1:N systems store and decide: a templates table, an HNSW index, a stricter threshold, a top-1/top-2 margin, a duplicate check at enrollment, and audit logging.
  - A recommendation: a duplicate-face check at enrollment.
- **Rationale:** The PDF was rendered with WeasyPrint from HTML in a scratch venv; nothing was added to the project dependencies. LibreOffice was tried first and rejected because its Thai layout was poor.
- **Security/privacy:** The PDF contains no PII, images, embeddings or keys.
- **DB/deploy:** none.
- **Verification:**
  - 3 pages.
  - Checked the rendered pages visually: Thai text and digits are correct, and tables are not split badly.
- **Remaining risks/handoff:**
  - The duplicate-face check is only a proposal.
  - Nothing is committed.

## [2026-11-16] Claude: Read-only usage summary of the TEST database
- **Objective:** Owner asked which accounts have used check-in and how many there are. Answer in chat only; no document.
- **Files changed:** none (this log entry only).
- **Method:**
  - Read-only SELECTs on TEST project `kmutnb-attendance-test`.
  - Tables read: `profiles`, `auth.users` (`last_sign_in_at` only), `face_checkin_attempts`, `attendance_records`, `pilot_checkin_log`.
  - `face_embedding` was not selected.
  - Production was not touched.
- **Aggregate results (no PII):**
  - 25 accounts: 24 students and 1 teacher. 15 students use the university domain and 9 use external domains.
  - 18 students are face-registered.
  - 20 students tried a face check-in; 17 of them succeeded at least once.
  - 154 attempts in total (87 success, 67 failed), between 2026-11-13 and 2026-11-16. One account alone made 87 of them.
  - Top failure stages: pad 26, blink 16, not_enrolled 7, move_closer 6.
  - `attendance_records` has 0 rows. `pilot_checkin_log` has 48 rows.
- **Security/privacy:** Names and emails were shown to the owner in chat only and are not recorded here.
- **DB/deploy:** none.
- **Verification:** Per-account sums match the totals (154 = 87 + 67, and the failure stages sum to 67).
- **Remaining risks/handoff:** none.

## [2026-11-16 17:55] Claude: reportResultFaceCheckin.pdf (face check-in usage report, TEST data)
- **Objective:** Owner asked which tables the usage numbers came from, with an explanation, as a PDF.
- **Files changed:** `reportResultFaceCheckin.pdf` (created, project root). No code changed.
- **Content:**
  - Summary KPIs.
  - The five source tables with the columns used: `profiles`, `auth.users` (`last_sign_in_at` only), `face_checkin_attempts` (main source), `attendance_records` (0 rows), `pilot_checkin_log` (48 rows, count only).
  - Join keys, the SQL, definitions and consistency checks.
  - Per-tester table, logged-in-but-never-scanned list, failure stages and attempts per day.
- **Security/privacy:**
  - **The PDF contains tester names (PII). It is marked internal on every page and must not be committed or shared.**
  - Emails appear only as a type (university or external). No student codes, embeddings, images or tokens.
  - `*.pdf` is not git-ignored, so the owner must keep it out of commits.
- **DB/deploy:** none. Read-only TEST queries; production was not touched.
- **Verification:** 4 pages, rendered with WeasyPrint. Checked the pages visually: Thai text, tables and page breaks are fine, and the totals match (154 = 87 + 67).
- **Remaining risks/handoff:** Consider adding these reports to `.gitignore`. Nothing is committed.

## [2026-11-16 18:40] Claude: Fix "runtime status error" after the GPU→CPU switch (vivo V23e, Chrome)
- **Objective:** A tester screenshot from a vivo V23e in Chrome showed "ระบบตรวจจับใบหน้าหยุดทำงานกลางคัน / runtime status error", with GPU at 155 ms per frame and 5.8 fps. Explain the cause and fix it.
- **Root cause:** Same mechanism as TuningModelLog entry 9, but in a normal browser.
  - The tuner asked for the CPU. The worker closed its GPU graph and rebuilt a CPU graph in the same WASM heap; that rebuild failed and the whole runtime became `error`.
  - No CPU choice was saved, so "try again" started on the GPU again and crashed again.
  - The raw error text went only to the console.
- **Files changed:**
  - `frontend/src/services/faceLandmarkerRuntime.ts`:
    - `requestDelegateSwitch` now calls a new `restartWorker(target)`. It terminates the worker and starts a fresh one on the target engine (`initializeWorker` takes an optional `forcedDelegate`). The runtime stays `loading` until the new worker is ready, the tuner is kept, and the scanner gets 'switching' then 'switched'.
    - A worker that dies while on the GPU or mid-switch is replaced once by a fresh CPU worker (`shouldRecoverOnCpu` / `recoverOnCpu`, guarded by `crashRecoveryUsed`). The CPU choice is saved, and the raw text is kept in `getLastRuntimeRecovery()`.
    - `rejectLoad` puts the raw text, cut to 160 characters, in the new optional `snapshot.detail`.
    - Old workers' late failures are ignored by a generation check.
  - `frontend/src/features/student/LivenessScanner.tsx`:
    - The test-mode error detail now shows `runtime status error: <raw>`.
    - The test panel shows a "กู้ระบบ→CPU" line after a recovery.
    - `restartAfterEngineSwitch` resets `processing`, because the in-flight frame of the old worker never answers.
  - `frontend/scripts/test-runtime-recovery.mjs` (new): a behaviour test that loads the real runtime through Vite SSR with a fake Worker. Wired into `package.json` as `test:runtime-recovery` and into `scripts/verify_release.sh`.
  - `frontend/scripts/test-scan-robustness.mts`: wiring assertions for the new paths.
  - `TuningModelLog.md`: entry 12.
- **Rationale:**
  - A new worker starts with an empty WASM heap and no WebGL context, which is the path already proven on CPU-start phones.
  - Recovery is limited to one attempt per runtime to avoid restart loops.
  - Backend thresholds are unchanged.
- **Security/privacy:**
  - No security gate changed; the Backend still decides everything.
  - The raw error text is shown only in test builds and is not sent or stored. It is MediaPipe or browser text, which may contain asset URLs but no personal data.
- **DB/deploy:** none. Frontend only.
- **Verification (Node 22):**
  - `test:runtime-recovery` passes. Run against the old runtime it fails at "the GPU worker is terminated instead of rebuilding inside it", so it detects the bug.
  - All 18 frontend `test:*` scripts pass.
  - `npm run lint`, `tsc -b` and `npm run build` pass.
- **Remaining risks/handoff:**
  - Not tried on a real vivo V23e. If its CPU is also below 8 fps, the scan now stops with the slow-device message instead of crashing.
  - The in-worker 'switch' message handler is kept but unused.
  - Nothing is committed.

## [2026-11-16 21:45] Claude (lead, with 3 subagents): Scan UX from real-user feedback
- **Objective:** Five owner requests from tester feedback:
  1. Instructions in the scan frame change too fast; each should stay until the user has done it.
  2. Show a preparation modal with a "เข้าใจแล้ว" button before the camera opens, every time.
  3. Make the blink step clearly mean "close eyes for about 1 second, then open".
  4. Make the instruction more visible.
  5. Delay the final still capture until the eyes are fully open, and slow other steps a little.
- **Work split (no file overlap):**
  - Agent 1: `utils/liveness.ts` and `test-blink-profiles.mts`.
  - Agent 2: `LivenessScanner.tsx`, new `utils/instructionPacer.ts`, new `test-instruction-pacer.mts` and `test-scan-robustness.mts`.
  - Agent 3: new `FaceScanPrepGate.tsx`, `StudentHome.tsx`, `StudentRegister.tsx` and new `test-scan-prep-gate.mts`.
  - Lead: `package.json`, `verify_release.sh`, `test-passive-gate.mts`, the logs and the final checks.
- **Files changed:**
  - `frontend/src/utils/liveness.ts`:
    - `maxHoldMs` 600→1000.
    - New `HYBRID_RECOVERY_LIMITS`: fullOpenRatio 0.85, recoveryHoldMs 500, recoveryHoldFrames 3, minRecoveryAfterActionMs 700, recoveryFallbackAfterMs 2000, settleFloorRatio 0.55.
    - The `HybridActionMonitor` recovery phase now waits for a settled run, using a median over the hold window, with a 0.70 fallback after 2 s.
    - New getter `shortClosureDropped`.
    - New texts: `BLINK_PROMPT`, `BLINK_RETRY_PROMPT`, `BLINK_TOO_SHORT_MESSAGE`, `BLINK_OPEN_MESSAGE`.
    - `hybridRecoveryDetected` is unchanged.
  - `frontend/src/utils/instructionPacer.ts` (new): pure dwell scheduler. A hint is held at least 1500 ms, the latest hint wins, and a step message shows at once.
  - `frontend/src/features/student/LivenessScanner.tsx`:
    - All frame-loop instructions go through the pacer, with a 250 ms flush.
    - The get-ready text shows for max(promptDelayMs, 1500); `promptAt` is the time the prompt is really shown.
    - `SAMPLE_INTERVAL_MS` 450→550.
    - Uses the blink too-short and open texts.
    - The instruction card is solid and larger, with an icon and a "ขั้นที่ N/3" pill.
  - `frontend/src/features/student/FaceScanPrepGate.tsx` (new): an accessible modal that does not mount the scanner, and so starts no camera, worker or 30 s timer, until "เข้าใจแล้ว" is pressed. It is shown on every mount.
  - `StudentHome.tsx`, `StudentRegister.tsx`: wrap `LivenessScanner` in the gate. The Register helper text no longer says "กะพริบ".
  - Tests: new `test-instruction-pacer.mts` and `test-scan-prep-gate.mts`, both registered in `package.json` and `scripts/verify_release.sh`. `test-blink-profiles.mts` and `test-scan-robustness.mts` were updated.
  - `test-passive-gate.mts`: the slow-camera assertion now also accepts the current wording "เปลี่ยนอุปกรณ์". An earlier unlogged edit to `slowCameraMessage` had made it fail; that wording was kept.
  - `TuningModelLog.md`: entry 13.
- **Rationale:**
  - Hints were set on every frame, so they flickered. Step changes are already event-driven and stay immediate.
  - The final frame is also the face-match image, so eyes fully open helps both liveness and matching.
  - Showing the prompt later than the signed delay is allowed by the Backend (`prompt_at >= last_sample + delay`).
  - 550 rather than 600 ms keeps the pose restart (550 + 1200 = 1750) before the 1800 ms gap guard.
- **Security/privacy:**
  - No gate is loosened. The final frame still has to pass `hybridRecoveryDetected`, and spoof styles (photo, wink, squint, nod) are still 0% in the simulation.
  - Backend unchanged. No data is stored by the modal.
- **DB/deploy:** none. Frontend only.
- **Verification (Node 22):**
  - All 20 `test:*` scripts pass.
  - `npm run lint`, `npx tsc -b` and `npm run build` pass.
  - Simulated longest action→recovery span: 2.6–3.6 s at 8–30 fps, against a 4.7 s limit.
  - The prep-gate test fails when the gate renders its children early.
- **Remaining risks/handoff:**
  - Not tried on a real phone or browser. All new values are UX values, unmeasured.
  - About 500 ms less slack before the 4.7 s recovery limit at 8 fps.
  - Modal distance ("arm's length") vs `PAD_RETRY_CHECKLIST` (30–40 cm) needs an owner decision.
  - Backend messages still say "กะพริบ/กระพริบ".
  - A 3-line instruction card may sit close to the face guide at 360×640.
  - Stale "450" comments remain in `livenessTiming.ts` and `captureQuality.ts`.
  - Nothing is committed.

## [2026-11-16 22:05] Claude: Prep modal: 30–40 cm distance and top-right X cancel button
- **Objective:** The owner chose "30–40 ซม." for the phone distance and asked for an X cancel button in the top-right corner of the prep modal, so a person who is not ready can leave the scan step.
- **Files changed:**
  - `frontend/src/features/student/FaceScanPrepGate.tsx`:
    - The tip text is now "ห่างจากใบหน้าประมาณ 30–40 ซม.", which matches `PAD_RETRY_CHECKLIST`.
    - New X button (lucide `X`, 44 px, `absolute right-2 top-2`, `aria-label` "ยกเลิกการสแกนใบหน้า"). It is rendered when `onCancel` is given and calls `onCancel` only.
    - Tab and Shift+Tab now cycle between the X and the "เข้าใจแล้ว" button. Initial focus stays on "เข้าใจแล้ว".
    - The title has right padding so it is not covered.
  - `frontend/scripts/test-scan-prep-gate.mts`: now expects 2 buttons (the X with its label and position, and "เข้าใจแล้ว"), checks that the X is wired only to `onCancel`, and checks the distance text.
  - `TuningModelLog.md`: section 13.E.
- **Rationale:** Both parents already pass `onCancel`: StudentHome closes the scanner, and StudentRegister calls `cancelLiveness`, the same handler as the scanner's own close. Cancelling never mounts the scanner, so no camera starts and no challenge is used.
- **Security/privacy:** none. No data is stored.
- **DB/deploy:** none. Frontend only.
- **Verification (Node 22):**
  - `test:scan-prep-gate` passes. It fails when the X button is removed (checked, then the file was restored).
  - `npm run lint`, `npx tsc -b` and `npm run build` pass.
- **Remaining risks/handoff:**
  - Not tried in a real browser or phone.
  - Nothing is committed.

## [2026-11-16 22:30] Claude: Reminder for students without a registered face, with profile-row highlight
- **Objective:** On first login, or whenever the account has no registered face, show a clear, human-sounding reminder. It needs a button that goes to the profile page, where the face-scan row blinks so it is easy to find, and an X button that closes the reminder.
- **Files changed:**
  - `frontend/src/features/student/FaceRegistrationReminder.tsx` (new):
    - Loads `/api/v1/students/me/profile` and shows only when `face_registered === false`. Nothing is shown while loading or on a failed load.
    - Hidden on `/student/profile` and `/student/register`. While unregistered it asks again on each page change, so it disappears right after enrolment.
    - Text: title "คุณยังไม่ได้ลงทะเบียนใบหน้า" and a gender-neutral explanation that tells the person to open the profile and press "ลงทะเบียนใบหน้า" in the face-scan row.
    - Button "ไปที่หน้าโปรไฟล์" navigates with router state `{ highlightFaceRow: true }`.
    - Top-right 44 px X button (`aria-label` "ปิดการแจ้งเตือน"). It hides the reminder for the browser session only (sessionStorage, wrapped in try/catch), so the next login reminds again.
    - `role="alert"`.
  - `frontend/src/components/layout/StudentLayout.tsx`: renders the reminder above `<Outlet />`, so it appears on every student page.
  - `frontend/src/features/student/StudentProfile.tsx`: when it arrives with that state, the face-scan row (`ProfileRow` gained `rowRef` and `highlight`) is scrolled into view and blinks for 6 s. The router state is then cleared so Back/refresh does not repeat it. The highlight starts only once and only while the face is unregistered.
  - `frontend/src/index.css`: `.attention-blink` (orange ring and background pulse, 6 × 1 s). With `prefers-reduced-motion` it becomes a still ring.
  - `frontend/scripts/test-face-reminder.mts` (new): registered as `test:face-reminder` in `package.json` and `scripts/verify_release.sh`.
- **Rationale:** The layout is the one place every student page passes through. sessionStorage gives "close for now" without permanently hiding a required step.
- **Security/privacy:** reads the student's own existing profile endpoint, with no new data. sessionStorage holds only the flag "1".
- **DB/deploy:** none. Frontend only; one extra profile GET per student page change while unregistered.
- **Verification (Node 22):**
  - All 21 `test:*` scripts pass.
  - `npm run lint`, `npx tsc -b` and `npm run build` pass.
- **Remaining risks/handoff:**
  - Not viewed in a browser or phone; the reminder and blink are checked only by source tests.
  - Nothing is committed.

## [2026-11-16 23:00] Claude: Five layout proposals for the student "รายวิชา" tab (mockup only)
- **Objective:** The owner asked for 5 redesign options for the student courses tab, with grouped, orderly sections instead of scattered cards.
- **Files changed:** `docs/design/courses-tab-variants.html` (new). It is a static mockup of 5 phone screens on the same sample data, using the app's palette, shell and type. The courses are fictional sample data with no real people.
  - **A:** two tabs plus a floating join button.
  - **B:** grouped list (studying / pending / closed) with a one-line join bar.
  - **C:** status counters as filters.
  - **D:** courses grouped by semester, with the pending request pinned at the top.
  - **E:** join panel, then "ต้องติดตาม", then current courses.
- **Rationale:** The current tab repeats the page title in a dark header card, gives the join form a large block, and splits courses and requests into separate stacks of cards.
- **Security/privacy:** none. No real data. The page loads the Noto Sans Thai font from Google Fonts for the mockup only.
- **DB/deploy:** none. `StudentCourses.tsx` is unchanged.
- **Verification:**
  - Rendered in the browser pane at 1280 px with 360 px phone frames.
  - Fixed the design-hook contrast and tiny-text findings: placeholder, nav and count colours, 12 px minimum text, the E button colour, the B button wrap and the C chip scrollbar.
- **Remaining risks/handoff:**
  - The owner must pick a direction before `StudentCourses.tsx` is implemented.
  - D needs past-semester courses from the API, which it does not return today.
  - Nothing is committed.

## [2026-11-16 23:30] Claude: Student "รายวิชา" tab rebuilt as layout A (tabs + join sheet)
- **Objective:** The owner chose layout A from `docs/design/courses-tab-variants.html`: two tabs, "วิชาของฉัน" and "คำขอ", plus a "เข้าร่วมวิชา" button that opens the class-code form.
- **Files changed:**
  - `frontend/src/features/student/StudentCourses.tsx`:
    - Removed the dark header card that repeated the page title.
    - Added a segmented tablist (WAI-ARIA tabs: roving tabindex, arrow and Home/End keys, labelled panels). The course count shows on the courses tab, and an amber pending count on the requests tab (announced as "รออนุมัติ N รายการ").
    - On the first load, if there are no courses but there is a pending request, the requests tab opens first.
    - Courses are rows in one list, each linking to `/student/history/{id}`.
    - Requests are one list with status icon and text, the teacher's note, and a cancel button for pending requests.
    - The "เข้าร่วมวิชา" button is sticky inside the page scroller, so it never covers the bottom nav.
    - It opens a `JoinSheet` bottom sheet: a portal dialog with `useModalIsolation`, a focus trap, and Escape/X/backdrop to close (but not while sending). Focus returns to the button, and the sheet respects the bottom safe area.
    - After sending, the sheet closes and the requests tab opens.
    - The failed-load state now has a "ลองโหลดใหม่" button.
    - The join and cancel API calls, the validation text and `ConfirmDialog` are unchanged.
  - `frontend/scripts/test-student-courses.mts` (new): registered as `test:student-courses` in `package.json` and `scripts/verify_release.sh`.
- **Security/privacy:** none. Same endpoints, no new data.
- **DB/deploy:** none. Frontend only.
- **Verification (Node 22):**
  - All 22 `test:*` scripts pass.
  - `npm run lint`, `npx tsc -b` and `npm run build` pass.
  - Viewed in the browser pane through a temporary Vite harness (MemoryRouter, mocked axios, fictional data; deleted afterwards), at 375×812 and 320×640:
    - the tabs, rows, badges and sticky button render correctly;
    - the sheet opens with focus on the input, the code formats as `ABCD-23`, and the app root is inert;
    - Escape closes the sheet and focus returns to "เข้าร่วมวิชา";
    - with no courses and a pending request, the requests tab opens first.
- **Remaining risks/handoff:**
  - Not tried against the real API or on a phone.
  - `/student/history/{id}` assumes `course.id` equals the history page's `course_id`, as AttendanceHistory reads it.
  - Nothing is committed.

## [2026-11-16 23:55] Claude: Five proposals for the course detail page in the student history tab (mockup only)
- **Objective:** The owner asked for 5 design options for `/student/history/:courseId` that show the details more clearly.
- **Files changed:** `docs/design/course-history-detail-variants.html` (new). A static mockup of 5 phone screens on the same fictional sample data (15 planned sessions, 20% absence limit; 11 checked: 8 present, 2 late, 1 absent).
  - **A:** "ขาดได้อีก N ครั้ง" summary with a limit bar, then sessions by month.
  - **B:** a 15-cell strip for the whole term, with a tapped-cell detail.
  - **C:** per-session timeline with large dates.
  - **D:** counter strip, absence verdict line and a filterable table.
  - **E:** plain-language verdict banner, a proportion bar and month sections that collapse.
- **Rationale:** The current page does not say how many absences are left, does not show the Normal/Fa evaluation, and lists each check-in without session number or weekday. Every number in the proposals comes from fields the student endpoint already returns (`total_sessions`, `max_absence_percent`, counts, `evaluation`, history rows), so no Backend change is needed.
- **Security/privacy:** none. No real data. Google Fonts is loaded for the mockup only.
- **DB/deploy:** none. `AttendanceHistory.tsx` is unchanged.
- **Verification:** All 5 rendered in the browser pane at 1280 px with 360 px phone frames. The design hook reported no issues.
- **Remaining risks/handoff:**
  - The owner must pick a direction.
  - The frontend `CourseSummary` type does not yet declare `max_absence_percent`, although the API sends it.
  - "Sessions remaining" assumes `total_sessions` is the planned count.
  - Nothing is committed.

## [2026-11-17 00:20] Claude: Interactive prototype of the course detail page (timeline C + detail card B)
- **Objective:** The owner chose to combine layout C (timeline) with B's detail card. Tapping a date number should open the full detail of that session. A working prototype was requested before the real build.
- **Files changed:** `docs/design/course-history-detail-prototype.html` (new). A self-contained interactive prototype on fictional data.
  - **Summary:** counts, sessions left, and "ขาดได้อีก N ครั้ง" from `total_sessions` and `max_absence_percent`.
  - **Timeline:** each date is a button. The detail card shows session N of 15, the full Thai date, the check-in time, the method, a status note, a petition link for late/absent sessions, and previous/next buttons.
  - **Two presentation modes,** switched from a side panel:
    - bottom sheet: scrim, X, Escape, focus trap, focus return;
    - inline expand: under the tapped date, with `aria-expanded`.
  - On a phone the page fills the screen and uses the sheet. Reduced motion turns the transitions off.
- **Verification (browser pane):**
  - Opening session 5 showed the sheet. "ครั้งถัดไป" moved to session 6, and Escape closed the sheet and returned focus to that date button.
  - Inline mode opened session 8 under its date.
  - At 375×812 there is no horizontal overflow.
  - Fixed during the check: focus was lost after closing because the list re-renders; the selected date stretched to the full row height in inline mode; the sheet header ran under the X; the active nav colour was raised for contrast.
- **Security/privacy/DB/deploy:** none. No real data; `AttendanceHistory.tsx` is unchanged.
- **Remaining risks/handoff:**
  - The owner picks sheet or inline before implementation.
  - The real build needs `max_absence_percent` added to the frontend `CourseSummary` type.
  - Nothing is committed.

## [2026-11-17 00:50] Claude: Course detail page in the history tab rebuilt (timeline + bottom-sheet detail)
- **Objective:** Owner's choice after the prototype: layout C's timeline with layout B's full-detail card in a bottom sheet. The detail text beside the date must also open it, and the viewed date must be highlighted.
- **Files changed:**
  - `frontend/src/features/student/CourseHistoryDetail.tsx` (new). It owns the `CourseSummary`/`HistoryItem` types; `CourseSummary` gains `max_absence_percent`, which the API already sends.
    - **Summary card:** counts, sessions left, and "ขาดได้อีก N ครั้ง ก่อนถึงเกณฑ์ X%". This uses the Backend rule (Fa when absent > total × percent / 100) and is hidden when no limit or total is set. A red line appears when the evaluation is Fa.
    - **Timeline:** newest first, with session numbers in date order. Each row is ONE button covering the date, dot and details text, labelled with session number, date and status.
    - **Highlight:** the viewed row gets an orange ring and background and a dark date block, with `aria-current`.
    - **`SessionSheet`:** a portal dialog with `useModalIsolation`, a focus trap, and Escape/scrim/X to close. Focus returns to the row, the bottom safe area is respected, and the slide-up animation is motion-safe only.
    - **Sheet content:** session N of total, the full Thai date, check-in time, method, a status note, a "ยื่นคำร้องถึงอาจารย์" link to `/student/requests` for non-present sessions, and previous/next buttons. Stepping moves the highlight and scrolls that row into view.
  - `frontend/src/features/student/AttendanceHistory.tsx`: the `courseId` branch now renders `CourseHistoryDetail`; helpers that moved there were removed. The course list view is unchanged.
  - `frontend/src/index.css`: `sheet-up` and `sheet-fade` keyframes.
  - `frontend/scripts/test-course-history-detail.mts` (new): registered as `test:course-history-detail` in `package.json` and `scripts/verify_release.sh`.
- **Security/privacy:** none. Same endpoint and data; the petition link goes to an existing page.
- **DB/deploy:** none. Frontend only.
- **Verification (Node 22):**
  - All 23 `test:*` scripts pass.
  - `npm run lint`, `npx tsc -b` and `npm run build` pass.
  - Browser pane at 375×812 through a temporary harness (fictional data; deleted afterwards):
    - tapping the details text of a row opens the sheet and highlights that row in the middle of the screen;
    - "ครั้งถัดไป" moves from session 7 to 8 and the highlight follows;
    - Escape closes the sheet, focus returns to session 8's row, and the app root is no longer inert;
    - there is no horizontal overflow.
- **Remaining risks/handoff:**
  - Not tried against the real API or on a phone.
  - "Sessions left" relies on the teacher's planned `total_sessions`.
  - Nothing is committed.

## [2026-11-17 00:59] Claude: Release branch `release/tuning-merge` — all test-only code stripped before merging into main
- **Objective:** The owner chose to merge the tuningModel work into `main` without the test scaffolding, and to restore every security control that test mode relaxed.
- **Branch:** `release/tuning-merge`, created from `tuningModel` (06bfeb2). `main` has no commits since the branch point. Nothing is committed yet.
- **Removed (security relaxations and test scaffolding):**
  - Backend:
    - `core/test_mode.py`, `routers/test_mode.py`, `services/test_mode_service.py` and `services/attempt_diagnostics.py` are deleted.
    - Removed from `config.py`: the `ATTENDANCE_TEST_*` settings.
    - Removed from `security.py`: external e-mail sign-in. `is_allowed_login_email` is again KMUTNB-only.
    - Removed from `main.py`:
      - the test router and course keeper;
      - auto-join of the Test course at login and after enrollment;
      - the optional card image: `student_card_image` is required again, exactly as on `main`;
      - unlimited test check-ins and the attempt-table writes;
      - the `client_diagnostics` form field;
      - the `test_mode` and `test_external_email` keys in `/system/config`.
    - The diagnostics collector calls were removed from `liveness_service`, `liveness_frame_service` and `passive_pad_service`. They were observational only; no decision logic changed.
    - `failure_diagnostics.diagnostic()` is now gated by a code constant, `SHOW_MEASUREMENTS = False`, instead of an env switch, so no deployment can show measured values.
  - Frontend:
    - Deleted: `config/testMode.ts`, `TestModeBanner`, `TestModePanel`, `services/testMode.ts`, `utils/clientDiagnostics.ts`, `config/buildInfo.ts`, `vite.hosting.config.mts`, and the `__APP_BUILD__` define in `vite.config.ts`.
    - Back to the `main` behaviour: the OCR/card step in `StudentRegister`, the QR flow in `StudentHome`, `LiveAttendance` and `TeacherAttendanceProvider` (auto-close again), and the KMUTNB-only hint in `Login`. These three teacher/auth files are now identical to `main`.
    - Removed: the test overlay and raw error detail from `LivenessScanner`, the `?delegate=` and `?blendshapes=` URL overrides, and the test-only 60 s PWA update interval.
    - `MAX_RETRY_TTL_SECONDS` lowered from 4 h to 10 min, matching `QR_CHALLENGE_SECONDS` ≤ 600.
  - Repository:
    - Deleted: `supabase/test-only/*` (4 SQL files), `scripts/start_backend_ngrok.sh`, `scripts/analyze_attempts.py`, `scripts/evaluate_pad_roc.py`, `frontend/scripts/test-test-mode.mts`.
    - Deleted tests: `backend/tests/test_attendance_test_mode.py`, `test_external_email_and_attempts.py`, `test_local_hosting.py`.
    - `test:test-mode` was removed from `package.json` and `verify_release.sh`.
- **Kept on purpose:**
  - All AI/liveness tuning: face threshold 0.50, PAD median rule with its kill switch, 106-point blink rule with its kill switch, move_closer fallback with retry challenge, 5 s / 30 s timing.
  - The scanner, runtime-recovery and UX work, and the PWA update gate.
  - The teacher-domain migration and the release guards: `production_preflight.py` and `build_release_bundle.sh` still refuse `ATTENDANCE_TEST_*` and `VITE_TEST_MODE`.
  - The `ngrok-skip-browser-warning` CORS header. It already existed on `main` (documented ngrok staging flow, README_TH section 5); it was briefly removed during this work and then restored.
- **Docs:**
  - `deployment/docker/README_TH.md` section 8 (the test-script runbook) is replaced by a production summary: thresholds and switches, pre-deploy steps, and web behaviour.
  - `frontend/.env.staging.example` no longer mentions the test script or `VITE_TEST_MODE`.
- **Tests adapted:**
  - Removed: collector, attempt-writer, client-diagnostics, analysis-script and test-mode-path tests.
  - Test-mode patches now patch `failure_diagnostics.SHOW_MEASUREMENTS`.
  - Plain-text messages are asserted to carry no measurement code.
- **Security/privacy:**
  - Restored: KMUTNB-only login, mandatory card/OCR at enrollment, dynamic QR with timers, one check-in per session, and no test-table writes.
  - No device diagnostics are sent.
- **DB/deploy:** none applied. The test-only SQL was never in `supabase/migrations`.
  - Before production, confirm read-only that the teacher-domain migration `20261106120000` is applied.
  - Deploy with env files that contain no test variables, and build without `VITE_TEST_MODE`.
- **Verification (Node 22):**
  - `scripts/verify_release.sh` exits 0: git diff check, face model hashes, backend 344 tests OK (1 skipped), pip check, lint, every frontend test script, type check, build and the audit.
  - In the built bundle: no "โหมดทดสอบ", `client_diagnostics` or `face_checkin_attempts` strings, and the card upload field and QR code are present.
- **Remaining risks/handoff:**
  - Not exercised in a real browser against the real API.
  - Backend test count fell from 492 to 344 because test-mode-only tests were removed.
  - Some test helpers are still named `test_mode` (they now toggle `SHOW_MEASUREMENTS`).
  - The owner must review, commit, open a PR into `main` and push.

## [2026-11-17 01:05] Claude (subagent, logged by lead): Consolidated report ReportSummary.md / ReportSummary.pdf
- **Objective:** The owner asked for the earlier reports to be brought up to date, or merged into one current report.
- **Files created:**
  - `ReportSummary.md` (git-ignored by the `*.md` rule).
  - `ReportSummary.pdf`: 13 pages A4, rendered with WeasyPrint and the "Noto Sans", "Noto Sans Thai" font stack. **NOT git-ignored: keep it out of commits.**
  - The old reports are unchanged. `docs/CompareFaceExplain.pdf` and `docs/reportResultFaceCheckin.pdf` are under the ignored `docs/` folder.
- **Contents:**
  - purpose and scope; how face matching works (1:1 embedding);
  - aggregate usage and test results only;
  - 19 real-phone problems, each with cause, fix and status;
  - current thresholds with file locations; UX improvements;
  - 17 unverified items and risks; a 12-item next-step plan; the status of the merge into main.
  - Each fact is tagged "ยืนยันในโค้ด" (read from the release branch working tree) or "จากรายงาน" (the older report it came from).
- **Security/privacy:** totals only. A search of the PDF text found no names, e-mails, student ids, URLs or keys. Usage numbers come from the earlier report; no database query was made.
- **DB/deploy:** none.
- **Verification:**
  - Subagent: checked the page images for Thai text, digits and table breaks.
  - Lead: checked the page count, the git-ignore status and the PII pattern search.
- **Remaining risks:**
  - Code values are a snapshot of `release/tuning-merge` before commit.
  - Two minor layout breaks: the end of page 5, and section 6 starting at the bottom of page 9.
  - `ReportSummary.pdf` must not be committed.

## [2026-11-17 01:30] Claude: Mini PC + Cloudflare Tunnel deployment guide brought up to date
- **Objective:** Update the owner's deployment guide (`Source/markdown/DEPLOYMENT_MINIPC_CLOUDFLARE_TUNNEL2_TH.md`, outside this repository, last written 2026-11-05) to match `main` after the tuning merge (`7d5e1af`).
- **Changes in the guide:**
  - Update note at the top, plus a new "changes since 5 Nov" table in 0.3.
  - Migrations: 22 files; explains `20261106120000_auto_teacher_for_department_domains.sql`.
  - New read-only SQL check that the production project has no test-mode tables (`face_checkin_attempts`, `test_mode_flags`, `pilot_checkin_log`).
  - `backend.env`:
    - new PAD and 106-point settings table (`LIVENESS_PAD_RULE`, `LIVENESS_PAD_MEDIAN_THRESHOLD`, `LIVENESS_PAD_MIN_FRAME_FLOOR`, `LIVENESS_PAD_THRESHOLD`, `LIVENESS_BLINK_106_ENABLED`) with the preflight bounds;
    - face threshold 0.50 and the 5 s / 30 s timing are code values;
    - never add `ATTENDANCE_TEST_*`.
  - Models: 4 files including `2d106det.onnx`, with updated `scp`, folder tree and checksum count, and the runtime fallback behaviour.
  - `--workers 1` requirement; the `blink_106` field in `/health/ready`; new log messages in the troubleshooting table.
  - Vercel: never set `VITE_TEST_MODE`; PWA auto-update behaviour.
  - Acceptance checklist additions:
    - domain-based login and rejection of outside e-mail;
    - registration reminder and prep modal (X / "เข้าใจแล้ว");
    - the 1-second eye-close prompt and the move_closer fallback;
    - one check-in per session;
    - in-app browser and Android 11+ notices;
    - the new courses and history screens.
  - New upgrade steps from builds before 17 Nov.
  - Section 15: what was re-checked against `main`, plus new unverified items (106-point cost on the Mini PC, PAD false-accept rate unknown).
- **Rationale:** Every new statement was checked against the files on `main`: migrations, the sha256 manifest, `verify_face_models.sh`, `backend.env.example`, `production_preflight.py`, the Dockerfile, the `/health/ready` code and the insightface warning text. The 7 ms and 42-scan figures come from earlier logs.
- **Security/privacy:** placeholders only; no secrets, URLs or personal data added.
- **DB/deploy:** none (documentation only). A pre-edit copy is kept in this session's scratchpad.
- **Verification:** reviewed the text diff (96 changed lines). The steps were not run on a real Mini PC.
- **Remaining risks:** Dashboard menus of Cloudflare, Vercel and Supabase may have changed since 5 Nov; those parts were not re-checked online.

## [2026-11-17 01:50] Claude: Five app icon concepts (mockup only)
- **Objective:** The owner asked for 5 new logo/app icon designs.
- **Finding:** The current PWA icons are a plain "KM" on orange. `frontend/public/favicon.svg` is still the purple Vite template logo, not this product's mark.
- **Files changed:** `docs/design/app-icon-variants.html` (new; `docs/` is git-ignored). Five SVG concepts on a 512 grid, each previewed as an iPhone 60 tile, an Android maskable circle, PWA 48, 32 px and a 16 px browser tab:
  - **A:** viewfinder corners and a check;
  - **B:** a face whose smile is the check;
  - **C:** a check in live rings with a green dot (the product's live check-in signature);
  - **D:** QR finder squares with an orange check tile;
  - **E:** the Thai letter "ช" whose tail rises into a check.
  - Palette from DESIGN.md: orange #f97316, slate #0f172a, green #10b981. No university emblem or other brand marks are used.
- **Verification:** rendered in the browser pane. The E letterform was redrawn once after the first render read poorly.
- **Security/privacy/DB/deploy:** none. App files are unchanged.
- **Handoff:** after the owner picks one, export `favicon.svg`, `pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png` and a maskable 512 icon (add `purpose: 'maskable'` to the manifest). E needs its letterform refined before release.

## [2026-11-17 03:03] Claude: App icon concepts, rounds 2 and 3 (clock + roster, then clock + notebook)
- **Objective:** The owner asked to redraw the icon concepts:
  - round 2: roster sheet + clock;
  - round 3: clock + notebook.
- **Files changed:** `docs/design/app-icon-variants.html` (git-ignored) now shows round 3:
  - **A:** spiral notebook with ticked rows and a slate clock badge, on orange;
  - **B:** closed notebook cover with an orange elastic band and a clock on the cover, on cream;
  - **C:** open notebook spread with an orange clock on the gutter, on slate;
  - **D:** spiral notebook page whose content is a clock face, on orange;
  - **E:** outline icon combining notebook and clock, orange on slate.
  - Earlier rounds are kept only as scratchpad copies of this session; they are not in the repository.
- **Verification:** all five rendered in the browser pane at the hero size, iPhone 60, Android circle 60, 48, 32 and the 16 px tab. No overflow outside the Android circle.
- **Security/privacy/DB/deploy:** none. App icon files are unchanged.
- **Handoff:** after the owner picks one, export the favicon, PWA 192/512, the apple-touch icon and a maskable 512 icon, and add `purpose: 'maskable'` in `vite.config.ts`.

## [2026-11-17 03:08] Claude: New app icon (concept A: spiral notebook + clock) shipped into the PWA
- **Objective:** The owner chose round-3 concept A. Make it the real app icon.
- **Files changed (frontend, branch `main`, uncommitted):**
  - `brand/app-icon.svg`, `brand/app-icon-rounded.svg`, `brand/app-icon-maskable.svg` (new): SVG masters. The art is identical in all three. They are full-bleed square, 112/512 rounded square, and full-bleed with the art scaled 0.72 into the 80% maskable safe circle.
  - `public/favicon.svg`: replaced the leftover purple Vite template logo with the rounded icon.
  - `public/pwa-192x192.png` and `public/pwa-512x512.png`: rounded square with transparent corners ("any" purpose).
  - `public/pwa-maskable-512x512.png` (new): full-bleed maskable icon.
  - `public/apple-touch-icon.png`: 180 px full-bleed (iOS rounds it itself).
  - `vite.config.ts`: manifest gains the maskable icon with `purpose: 'maskable'`, and `apple-touch-icon.png` is added to `includeAssets`.
- **How the PNGs were made:** SVG master → WeasyPrint PDF → `pdftoppm` at 1536 px → PIL rounded-corner alpha and LANCZOS downscale. No new project dependency. To regenerate, re-render the `brand/` SVGs the same way.
- **Security/privacy:** none. Colours come from DESIGN.md; no university emblem.
- **DB/deploy:** a new web build is needed. Installed PWAs may only pick up the new icon after reinstalling or after the browser refreshes the manifest; that timing depends on the platform.
- **Verification:**
  - `scripts/verify_release.sh` exits 0, and `tsc`, lint and build pass.
  - `dist/manifest.webmanifest` lists the three icons including the maskable one.
  - The 512 rounded and maskable PNGs were viewed: the art is inside the safe circle.
- **Remaining:**
  - Not checked on a real home screen (iOS / Android).
  - `public/icons.svg` (Vite template social-icon sprite) is unused; it was left in place.

## [2026-11-17 03:17] Claude: Test-results report for the tuningModel work (docs/ReportTestResults_tuningModel.md)
- **Objective:** The owner asked for a detailed Markdown report of the test results from branch `tuningModel`, using real values from the separate TEST database, covering everything from the start of the work.
- **Files created:** `docs/ReportTestResults_tuningModel.md` (git-ignored `docs/`). It contains:
  - a summary;
  - a 12–17 Nov timeline with commits;
  - the test environment;
  - TEST DB results: accounts, 178 scans with 105 passes, per-day results, failure stages, results by build period with and without the main test account, results by action, the similarity-score distribution, device/engine/fps/timing, the blink rule used, PAD median-rule outcomes and the pilot log;
  - automated test counts;
  - simulation results, the problem/fix table, before/after thresholds, data limitations, conclusions with a next-step plan, and the SQL used.
- **Data access:** read-only SQL on the TEST project only (aggregates; no names, e-mails, student ids or account ids in the report). Production was not touched.
- **Corrections made while checking:**
  - The first draft said only 3 scans happened after the 16 Nov 21:45 UX change. The DB shows 15, all from the main test account, so the text was fixed.
  - The "before" thresholds were re-checked against `610560e` and labelled with where each value comes from.
- **Security/privacy:** aggregates only; a pattern scan found no e-mails or UUIDs in the report.
- **DB/deploy:** none.
- **Remaining:** the field data predates most of the 16 Nov evening UX changes, and the report says so.

## [2026-11-17 10:58] Claude: Line-by-line explanation of the face check-in endpoint (docs/codeexplain.md)
- **Objective:** The owner sent a screenshot of `verify_hybrid_face_attendance` (`POST /api/v1/attendance/verify`, `backend/main.py`) and asked for a detailed line-by-line explanation, including where each piece lives.
- **Files created:** `docs/codeexplain.md` (git-ignored `docs/`). It contains:
  - where the code lives, and which version the screenshot shows;
  - an overview with a flow diagram;
  - a table for every screenshot line 1–227, with test-mode-only and security lines marked;
  - each called helper with its file and line on current `main`;
  - security notes;
  - differences from `main`.
- **Finding:** the screenshot is an uncommitted `tuningModel` state from about 13–14 Nov. It has test-mode `attempt` logging but no diagnostics collector or blink fallback, so it matches no single commit:
  - `59c9306` (line 722) predates it;
  - `efe0bda`/`d2d52f8`/`06bfeb2` (line 932) add more;
  - current `main` `7d5e1af` has the endpoint at lines 817–1026 without test mode.
- **Verification:** helper locations read with `git grep` on `7d5e1af`, and the test-mode helpers on `06bfeb2`. Behaviour statements were checked against the helper bodies (load_valid_challenge, claim/release/finalize RPC wrappers, read_validated_image, calculate_similarity, calculate_attendance_status, require_roles) and the current fallback wiring.
- **Security/privacy/DB/deploy:** none (documentation only).

## [2026-11-17 11:09] Claude: Screenshot vs current endpoint comparison added to docs/codeexplain.md
- **Objective:** The owner asked whether the code in the screenshot differs from the real file.
- **Findings:** `backend/main.py` lines 817–1026 on `main` (`7d5e1af`) keep the same main flow.
  - Removed: all test-mode lines (screenshot lines 13–14, 19–21, 31–32, 46–47, 131, 153–156, 159–172, 195, 199–205).
  - Added: the blink→move_closer fallback (main lines 39–48, 95, 166, 180–187) and an always-empty measurement suffix on the 401 (line 141).
  - `FACE_THRESHOLD` changed from 0.45 to 0.50.
- **Correction:** the earlier explanation of screenshot lines 121–123 described pgvector "[...]" text. The code converts PostgreSQL array braces `{...}` to `[...]`; the explanation was fixed.
- **Files changed:** `docs/codeexplain.md` section 5 rewritten (git-ignored).
- **Security/privacy/DB/deploy:** none.

## [2026-11-17 11:19] Claude: reportResultFaceCheckin.pdf updated with current TEST data and the Google Form feedback
- **Objective:** Update the internal usage report using live data from the TEST database, plus the testers' Google Form responses (CSV supplied by the owner).
- **Files changed:** `docs/reportResultFaceCheckin.pdf`, regenerated with 6 pages (was 4); `docs/` is git-ignored. The previous 16 Nov version is kept as a copy in this session's scratchpad.
- **New content:**
  - current totals: 29 profiles, 21 face-registered, 23 testers, 178 scans with 105 passes (59.0%), and 44.7% excluding the development account;
  - a per-tester table with the lowest and highest similarity scores;
  - accounts that logged in but never scanned;
  - 73 failures by stage, and scans per day from 13 to 17 Nov;
  - from the form (21 answers): devices, a summary of comments, and a per-respondent table matched to accounts (16 by e-mail, 3 by name, 2 unmatched);
  - a table mapping each piece of feedback to the fix made (or still pending).
- **Data access:** read-only SELECTs on the TEST project only. Image links in the form were not opened.
- **Security/privacy:** the report keeps tester names as the previous version did, marked "ห้าม commit / ห้ามเผยแพร่". It shows e-mail type only; no e-mails, student ids, images or embeddings. A text search of the PDF found no e-mail address or student id.
- **Finding:** one respondent's account (registered face) has no scans in the DB, so that tester's attempts stopped in the browser before upload. Front-end failures are not logged anywhere.
- **Verification:** totals cross-checked (178 = 105 + 73; the stages sum to 73; the student e-mail split is 17 + 11 = 28). All 6 pages were viewed after fixing an orphan last page and a wrong 16/12 e-mail split.
- **Remaining:** the 16 Nov evening UX fixes have no feedback yet from the testers who reported the problems.
