# UX Contract

## Product context

- Audience: นักศึกษา อาจารย์ และผู้ดูแล KMUTNB
- Primary jobs: เช็คชื่ออย่างยืนยันตัวตน, เปิด/ปิดคาบ, รับ NFC, ติดตาม realtime, ส่งคำร้องระหว่างนักศึกษา/อาจารย์, จัดการบัญชีและรายงาน
- Target market(s): KMUTNB ประเทศไทย
- Active locales: `th-TH`
- Timezone/calendar policy: backend เก็บ UTC; UI แสดง Asia/Bangkok/`th-TH`
- Accessibility target: WCAG 2.2 AA

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Permission model | `backend/core/security.py`, `backend/core/authorization.py`, Supabase migration `20260827140100` | API/schema policy | 2026-08-27 |
| Dynamic QR lifecycle | `backend/main.py`, Supabase migration `20260824163017` | API/schema | 2026-08-24 |
| Attendance data lifecycle | `attendance_records` constraints/migration | Database | 2026-08-24 |
| OCR policy | `ocr-service/ocr-server.js`, `backend/services/light_ocr_service.py` | Service contract | 2026-08-24 |
| Temporary admin | `backend/routers/temporary_admin.py`, migration `20260828111609` | API/schema policy | 2026-08-28 |
| Student support requests | `backend/routers/support.py`, migrations `20260830072753`, `20260830072951` และ `20260830075957` | API/schema/storage policy | 2026-08-30 |
| Student self-profile | `backend/routers/student.py`, `profiles.academic_year` check constraint | API/schema policy | 2026-08-30 |
| Course join codes and approval | `backend/routers/course_membership.py`, migration `20260831165330` | API/schema policy | 2026-08-31 |
| Course roster import and paging | `backend/services/roster_import_service.py`, migration `20260901155020` | API/schema policy | 2026-09-01 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`
- Token ownership model: `DESIGN.md` mirrors the established Tailwind utility system
- Runtime design-system/token source: `frontend/src/index.css` and shared React components
- Supported themes: light
- Design-context owner/review policy: product maintainer reviews durable UI decisions

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | native select | current forms | native | keyboard/browser |
| Date | native date/time input | browser/operating system | native; `datetime-local` for optional class-code expiry | keyboard/browser on supported platforms |
| Form | screen form + backend schema | API/Pydantic | create/edit/upload | build + browser |
| Scrollbar | global application stylesheet | `frontend/src/index.css` | thin baseline; geometry exception only | computed style + browser |
| Toast | `NotificationProvider` | shared component | success/info/error | live region + browser |
| Upload | screen-owned accessible file input + shared preview/validation | `imageUtils.prepareStudentCardImage`, `SupportCenter`, `roster_import_service`, backend validators | card image/XLSX/CSV/support attachment | client + server validation |
| CRUD | backend-authorized screen flows | API routes | stay/refresh | API + browser |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | labeled | tonal change | visible ring | pressed | blocked + muted | stable label/spinner | toast/inline |
| Icon button | aria label | tonal change | visible ring | pressed | blocked | n/a | toast |
| Input | labeled | border | visible ring | n/a | muted | locked on submit | inline |
| Table/list | readable rows | row tint | control focus | selected state | n/a | reserved loading | banner/empty |

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Prepare face runtime and scan Dynamic QR | attendance page entry preloads/warms local model; QR action unlocks only when ready | stable inline model status, then QR verifying | card capture | ready status then inline QR check | retry model preparation before opening QR; rescan latest QR after QR failure | retry/QR action | `faceLandmarkerRuntime.ts`, `QRScanner.tsx` |
| Face + OCR check-in | signed protocol-v2 move-near/return + delayed bilateral blink challenge, then submit transient evidence/card | progress then disabled + spinner | result card | result + realtime toast | retry the 45-second camera attempt within the one-use 7-minute QR authorization; retain card/evidence on transient OCR/database failure; rescan only on expiry | result heading/live status | `LivenessScanner.tsx`, `StudentHome.tsx`, `liveness_frame_service.py` |
| NFC check-in | card reader Enter | checking | remain ready | inline + realtime toast | clear UID and retry | reader input | `NFCManager.tsx` |
| Open/close session | teacher action | disabled | dashboard/live view | toast/inline | retry | trigger | `TeacherDashboard.tsx` |
| Upload/background job | file select | progress/disabled | remain | inline | preserve selected file | upload control | import/registration |
| Request temporary admin | teacher reason submit | disabled | settings status | toast + pending state | edit/retry | request form | `TeacherSettings.tsx` |
| Enroll/activate PIN | approved teacher submit | masked + disabled | admin dashboard | toast + expiry banner | inline attempts/lock | PIN field | `TeacherSettings.tsx` |
| Decide/revoke temporary admin | permanent admin confirmation | disabled | remain/refetch | toast | retain reason | action/dialog | `TemporaryAdminRequests.tsx` |
| Preview roster import | teacher selects XLSX/CSV | stable busy button | remain with paged preview | inline summary | retain file and show row errors | preview heading | `ImportStudents.tsx`, `roster_import_service.py` |
| Commit roster import | teacher confirms reviewed file | confirmation busy | remain/refetch roster | toast + import result | retain file; require new preview on conflict | roster heading | `ImportStudents.tsx`, `import_course_roster` RPC |
| Create student request | request page form | disabled + spinner | selected thread | toast | preserve text/files and retry | thread heading | `StudentRequests.tsx`, `SupportCenter.tsx`, `routers/support.py` |
| Edit own academic year | profile inline edit | disabled + spinner | remain on profile | toast + updated row | keep editor open and retry | edited row | `StudentProfile.tsx`, `routers/student.py` |
| Open student requests | profile navigation row | route navigation | request list/thread | none | route error remains recoverable | page heading | `StudentProfile.tsx`, `StudentRequests.tsx` |
| Reply to request | thread composer | disabled + spinner | remain/refetch | toast | preserve text/files and retry | composer | `SupportCenter.tsx`, `routers/support.py` |
| Preview support file | explicit preview button | inline spinner | inline image/PDF | inline state | retry same button | preview control | `SupportCenter.tsx`, `routers/support.py` |
| Resolve/reopen request | teacher status action/student reply | disabled | remain/refetch | toast/status badge | retain thread and retry | status action | `SupportCenter.tsx`, `routers/support.py` |
| Open course management | course-card action | route loading | selected management tab | none | retry/back to course list | page heading | `CourseManagement.tsx` |
| Request course join | student submits class code | disabled + spinner | remain/refetch requests | toast + pending card | retain code and show inline error | join-code input | `StudentCourses.tsx`, `course_membership.py` |
| Review course join | teacher approves/rejects after confirmation | disabled | remain/refetch list | toast + enrollment/status | keep request pending and retry | review action | `CourseManagement.tsx`, `review_course_join_request` RPC |
| Rotate class code | teacher confirms rotation | disabled | remain with new code | toast | keep current code and retry | rotate action | `CourseManagement.tsx`, `course_membership.py` |

## Navigation and responsive behavior

- Route document title policy: route/product title set at app startup; future route-specific titles extend it
- Student profile subflow: `/student/requests` and `/student/register` are entered from the profile; request page exposes an explicit link back to `/student/profile`
- Student course membership: `/student/courses` is available from bottom navigation and the profile course row
- Teacher course management: `/teacher/courses/:courseId/manage/:tab` owns course edit, attendance thresholds, roster/import, join code, attendance history and deletion; Back returns to `/teacher`
- Teacher settings: `/teacher/settings` is the owning menu; `/teacher/settings/student-requests`, `/teacher/settings/admin-access`, and `/teacher/settings/system-info` are independently addressable pages with an explicit Back link
- Route error / 403 page behavior: backend 403 is not treated as login; protected route renders only for verified role
- Teacher/Admin shell: page width is fluid; sidebar is an overlay drawer below 1024px and a persistent sticky sidebar from 1024px upward. Main content owns no forced fixed width and every route must keep `min-width: 0`
- Student shell: mobile-only width `100%` capped at 440px; height follows `100dvh` with `100svh` fallback and iPhone safe areas. Bottom navigation is outside the single main-content scroller, remains visible, and must not cover focused content
- Sidebar/drawer/bottom-sheet transformation: drawer overlay closes from its close control, backdrop, or destination selection; persistent sidebar navigation remains independently scrollable when viewport height is short
- Responsive table strategy: horizontal scroll; no table height constraints on sibling forms
- Truncation/full-value access: names wrap; identifiers remain readable
- Focus restoration and sticky-obstruction policy: dialogs restore to trigger when shared dialog migration is complete

## Overlays and feedback

- Toast placement/duration/deduplication: top-right; success/info 5s; error persistent; duplicate window 2s; max 4
- Alert/banner scope and persistence: inline for form/camera state
- Layer/z-index contract: toast 900, dialog 600, backdrop 500, popover 300, dropdown 200

## Async and resilience

- Mutation default: pessimistic for attendance and account/security operations
- Idempotency and duplicate-submit policy: disabled submit + database unique `(session_id, student_id)`; support requests/messages also use unique UUID client tokens
- Offline/read-stale/write behavior: attendance writes fail closed; no cached API attendance data
- Retry/backoff/timeout behavior: OCR worker deadline 40s/backend timeout 42s; 30-request queue; optional standalone card OCR is limited per authenticated account; QR expiry asks for latest scan
- Session expiry/re-authentication: Axios interceptor clears expired local session and redirects through App
- Stale-request cancellation/invalidation: live initial fetch aborts on unmount; Realtime subscription removed; 15s polling fallback
- Dialog/form preservation: uploads remain selected on recoverable failure except consumed/expired QR; support composer retains text/files until server confirmation

## Validation

- Schema/validation layer: Pydantic + PostgreSQL constraints/RLS; client validation is advisory
- Student academic year: the student API accepts only strict integers 1–8 and updates only the authenticated student's `profiles` row; no client-supplied profile id or other profile field is accepted
- Trigger timing: file validation on selection and again on server; QR/token/challenge at each server boundary
- Server error mapping: Thai `detail` shown inline/toast without leaking secrets
- Sensitive-value handling: no service key, embedding, raw OCR or QR token in notifications/logs
- Temporary-admin handling: PIN uses Argon2id plus server pepper; grants are memory-only, session-bound, hashed at rest, short-lived and revocable; permanent-admin operations fail closed on the server
- Duplicate-submit prevention: button busy state + unique database constraint; face attendance insert and QR challenge consumption are one atomic PostgreSQL RPC
- Liveness validation: signed protocol v2 fixes the action order to move-near/return then a delayed bilateral blink challenge; the server selects 1 blink normally or a 2-blink step-up and signs both the count and delay. Browser Face Landmarker runs in a Web Worker, calibrates each eye separately, accepts variable camera throughput from 8 effective FPS, permits moderate center/pose jitter, and captures exact analyzed frames. A camera attempt lasts at most 45 seconds and can be restarted within the account-bound, one-use 7-minute authorization. Backend treats browser metrics as untrusted and recomputes one-face presence, approach/return scale, left/right eyelid closure and reopening, same-person similarity, frozen-frame continuity and a local three-frame MiniFAS passive PAD gate before face recognition. A nod, wink, static duplicate, stream below 8 FPS, face loss/swap, print or screen risk fails closed. This is hybrid challenge-response/PAD hardening and is not an ISO/IEC 30107 certification claim.
- Course membership: class codes never replace authentication; a non-enrolled student creates one pending request per course and only the course owner or permanent admin can approve it atomically with enrollment. Temporary admin elevation cannot manage another teacher's course.
- Image resource limits: client auto-orients and fits JPEG/PNG inside 1920×1920 px without cropping/upscaling, encodes once at JPEG quality 94%, then the server independently enforces encoded-byte, width, height, decoded-format and total-pixel limits
- Support attachment limits: JPEG/PNG/WebP/PDF only, no more than 3 files per message and 10 MiB per file; backend caps total multipart bytes before parsing, verifies real image format and decoded dimensions, and rejects PDF active-content markers

## Permission and clipboard

- Permission UI strategy: irrelevant role routes hidden; server authorization is authoritative; direct forbidden action receives 403
- Student registration status actions: face-registration action is shown only while `face_registered` is false; NFC registration remains teacher-assisted and shows guidance only while `nfc_registered` is false
- Student face self-enrollment: OCR must first bind the card number to the authenticated profile, then a short-lived signed and account-bound challenge drives protocol-v2 liveness. The backend recomputes movement, bilateral blink, person continuity, frame continuity, and passive PAD before atomically storing the final verified embedding and consuming the challenge. A student cannot overwrite an existing embedding; only a permanent administrator may use the supervised override flow.
- Disabled-state explanation: visible constraints near disabled check-in controls
- Account provisioning: student-domain accounts require a 13-digit student ID; teacher/admin accounts require an unclaimed admin invitation before first login
- Attendance scope: check-in only; liveness/card images are transient request data and are not retained as permanent attendance photos
- Support scope: student selects an enrolled course and backend derives its teacher; only that student and teacher can read/reply. Metadata tables and private Storage deny direct browser access; previews stream through an authorized backend endpoint. When a parent course/account is deleted the backend removes all discovered objects in batches and logs any failed Storage cleanup for operations to retry; no independent auto-expiry is enabled without an approved retention policy.

## Verification

- Required static commands: frontend build, backend unittest, OCR doctor/smoke test, premium strict audit
- Browser/device/locale/theme matrix: Chromium desktop + narrow mobile, Thai, light, reduced motion
- Accessibility checks: keyboard controls, live region toast, camera/upload labels, visible focus
- Failure-path evidence: expired QR, missing/invalid image, OCR unavailable, duplicate attendance, unauthorized course/session
