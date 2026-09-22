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
| Student support requests | `backend/routers/support.py`, `backend/services/student_support_service.py`, migrations `20260830072753`, `20260830072951` และ `20260830075957` | API/schema/storage policy | 2026-09-16 |
| Student self-profile | `backend/routers/student.py`, `profiles.academic_year` check constraint | API/schema policy | 2026-08-30 |
| Course join codes and approval | `backend/routers/course_membership.py`, migration `20260831165330` | API/schema policy | 2026-08-31 |
| Course roster import and paging | `backend/services/roster_import_service.py`, migration `20260901160534` | API/schema policy | 2026-09-01 |
| Teacher attendance session recovery | `backend/main.py`, `backend/services/teacher_session_service.py`, `attendance_sessions` | API/domain lifecycle | 2026-09-13 |
| Attendance report periods and scoring | `backend/services/attendance_export_service.py`, `routers/teacher.py`, migration `20260921111209`, `reportExport.ts` | API/schema/report contract | 2026-09-21 |

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
| Upload | screen-owned accessible file input + shared preview/validation | `imageUtils.prepareStudentCardImage`, `SupportCenter`, `roster_import_service`, backend validators | card image/XLSX/CSV/support attachment; request PDF/common raster images, normalized to JPEG/PNG | client + server validation |
| CRUD | backend-authorized screen flows | API routes | stay/refresh | API + browser |
| Attendance period lifecycle | teacher attendance-history dialog + atomic backend RPC | active/archived session snapshot columns | archive selected, restore current period, rollover semester | API + report tests |
| Presentation mode | `usePresentationMode` | Fullscreen API + app viewport fallback | Dynamic QR/class code | keyboard/touch/browser |
| Student QR camera | `QRScanner` fullscreen dialog + shared camera-quality hook/control | Dynamic QR API contract + MediaTrack capabilities + layer tokens | rear-camera/lens/quality scan/error/retry | keyboard/touch/camera/browser |
| Student face camera | `LivenessScanner` fullscreen dialog + shared camera-quality hook/control | signed protocol-v4 challenge + MediaPipe runtime + layer tokens | enrollment/check-in/cancel/retry | keyboard/touch/camera/browser |
| Confirmation dialog | `ConfirmDialog` / `TextPromptDialog` document portals | layer tokens + modal isolation | confirm/cancel/reason/busy/error | keyboard/touch/browser |

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
| Prepare face runtime and scan Dynamic QR | attendance page entry preloads/warms the versioned local model; explicit action opens a silent document-portal full-viewport rear-camera scanner above all Student shell chrome only when ready; camera requests Full HD ideal quality and exposes real lens plus supported zoom/sharpness controls through a compact disclosure | stable inline model status that explains the approximately 15 MB first download, then fullscreen QR verifying with inert background | verified-course face-scan step after scanner portal unmounts and Student shell returns | silent fullscreen success status, then course confirmation | allow up to 120 seconds for slow mobile download/compile; use the DOM/main-thread MediaPipe fallback on iOS WebKit and the shared worker elsewhere; unsupported focus/zoom/sharpness falls back to the native camera stream without blocking scanning; camera permission and invalid/expired QR errors remain recoverable | scanner close returns focus to QR action; success advances to face action | `faceLandmarkerRuntime.ts`, `QRScanner.tsx`, `CameraQualityControls.tsx`, `useCameraQuality.ts`, `StudentHome.tsx` |
| Hybrid face enrollment | verified student card requests a signed protocol-v4 enrollment-purpose challenge; shared scanner opens in an isolated document-portal full viewport and captures three passive frames, one random blink/move-closer action, and recovery | full-screen continuous camera progress, compact camera-settings disclosure, one plain-language action, then server verification spinner | student profile | toast + registered status | close returns to a retry state without another card upload; expired/consumed challenge starts a new attempt | scanner close returns to enrollment action; success moves to profile heading | `StudentRegister.tsx`, `LivenessScanner.tsx`, `liveness_service.py`, `liveness_frame_service.py` |
| Hybrid face check-in | signed protocol-v4 challenge bound to account/session opens the isolated full-viewport shared scanner and selects one blink or short move closer after three passive frames; no card after QR | full-screen continuous camera progress, compact camera-settings disclosure, one plain-language action, then disabled submit + spinner | result card | result + realtime toast | retry the 20-second camera attempt within the one-use 7-minute QR authorization; rescan QR only on expiry | scanner close returns to verified course; success moves to result heading/live status | `LivenessScanner.tsx`, `StudentHome.tsx`, `liveness_service.py`, `liveness_frame_service.py` |
| Derived student year | any authenticated student/profile/roster read derives the value from the two-digit Buddhist admission-year prefix of the validated 13-digit student number | read-only year plus admission-year explanation on student profile | current screen | consistent calculated year across student, teacher, and admin responses | malformed or unsupported-age identifiers return no calculated year without trusting stale stored values | profile year text | `student_year_service.py`, `security.py`, `student.py`, `teacher.py`, `admin.py` |
| NFC check-in | card reader Enter | checking | remain ready | inline + realtime toast | clear UID and retry | reader input | `NFCManager.tsx` |
| Open/close session | teacher action; provider first recovers caller-owned open session from Backend | disabled | dashboard/live view; open state survives child-route changes | toast/inline + persistent Teacher-shell indicator | retain server state and retry; Backend rejects opening a second caller-owned session | trigger | `TeacherAttendanceProvider.tsx`, `teacher_session_service.py`, `TeacherDashboard.tsx` |
| Expand QR/class code | explicit fullscreen button | stable panel | presentation mode | pressed state + visible exit control | Fullscreen API denial falls back to app-owned viewport mode | fullscreen control | `usePresentationMode.ts`, `LiveAttendance.tsx`, `CourseManagement.tsx` |
| Upload/background job | file select | progress/disabled | remain | inline | preserve selected file | upload control | import/registration |
| Request temporary admin | teacher reason submit | disabled | settings status | toast + pending state | edit/retry | request form | `TeacherSettings.tsx` |
| Enroll/activate PIN | approved teacher submit | masked + disabled | admin dashboard | toast + expiry banner | inline attempts/lock | PIN field | `TeacherSettings.tsx` |
| Decide/revoke temporary admin | permanent admin confirmation | disabled | remain/refetch | toast | retain reason | action/dialog | `TemporaryAdminRequests.tsx` |
| Preview roster import | teacher selects XLSX/CSV | stable busy button | remain with paged preview | inline summary | retain file and show row errors | preview heading | `ImportStudents.tsx`, `roster_import_service.py` |
| Commit roster import | teacher confirms reviewed file | confirmation busy | remain/refetch roster | toast + import result | retain file; require new preview on conflict | roster heading | `ImportStudents.tsx`, `import_course_roster` RPC |
| Create student request | request page form | disabled + spinner | selected thread | toast | preserve text/files and retry | thread heading | `StudentRequests.tsx`, `SupportCenter.tsx`, `routers/support.py` |
| View derived academic year | profile load | stable profile skeleton/text | remain on profile | read-only education row | explain when the student ID cannot produce a year and direct corrections to a request | profile heading | `StudentProfile.tsx`, `routers/student.py` |
| Open student requests | profile navigation row | route navigation | request list/thread | none | route error remains recoverable | page heading | `StudentProfile.tsx`, `StudentRequests.tsx` |
| Reply to request | thread composer | disabled + spinner | remain/refetch | toast | preserve text/files and retry | composer | `SupportCenter.tsx`, `routers/support.py` |
| Switch away from request thread | route/tab navigation | n/a | selected thread and unsent in-memory reply restore on return within the authenticated role session | none | draft clears after successful send or logout/role-provider unmount | composer | `SupportWorkspaceProvider.tsx`, `SupportCenter.tsx` |
| Preview support file | explicit preview button | inline spinner | inline image/PDF | inline state | retry same button | preview control | `SupportCenter.tsx`, `routers/support.py` |
| Download support file | explicit download button on an authorized request | button spinner | browser file download | none | inline error and retry; preview state retained | download control | `SupportCenter.tsx`, `routers/support.py` |
| Change teacher request text size | labeled decrease/increase buttons | none | selected size applied to request subject, details, messages and composer | live size label | boundary button disabled at 14/22 px | size control | `SupportCenter.tsx` |
| Resolve/reopen request | teacher status action/student reply | disabled | remain/refetch | toast/status badge | retain thread and retry | status action | `SupportCenter.tsx`, `routers/support.py` |
| Open course management | course-card action | route loading | selected management tab | none | retry/back to course list | page heading | `CourseManagement.tsx` |
| Request course join | student submits class code | disabled + spinner | remain/refetch requests | toast + pending card | retain code and show inline error | join-code input | `StudentCourses.tsx`, `course_membership.py` |
| Review course join | teacher approves/rejects after confirmation | disabled | remain/refetch list | toast + enrollment/status | keep request pending and retry | review action | `CourseManagement.tsx`, `review_course_join_request` RPC |
| Rotate class code | teacher confirms rotation | disabled | remain with new code | toast | keep current code and retry | rotate action | `CourseManagement.tsx`, `course_membership.py` |
| Archive selected attendance sessions | teacher selects closed sessions and confirms | disabled confirmation | remain/refetch active report | toast with recoverability statement | preserve selection and retry; open sessions rejected | selected-session list | `AttendancePeriodManager.tsx`, `archive_attendance_sessions` RPC |
| Start a new attendance-report semester | teacher enters semester/year and confirms | disabled confirmation | same course with blank active report | toast with new period | old sessions remain archived; active/open session blocks rollover | period manager heading | `AttendancePeriodManager.tsx`, `rollover_attendance_period` RPC |
| Restore an archived session | teacher confirms a current-period archive | disabled confirmation | remain/refetch report | toast | older-period restore rejected to prevent mixed reports | restore action | `AttendancePeriodManager.tsx`, `restore_attendance_sessions` RPC |

## Navigation and responsive behavior

- Route document title policy: route/product title set at app startup; future route-specific titles extend it
- Student profile subflow: `/student/requests` and `/student/register` are entered from the profile; request page exposes an explicit link back to `/student/profile`
- Student course membership: `/student/courses` is available from bottom navigation and the profile course row
- Teacher course management: `/teacher/courses/:courseId/manage/:tab` owns course edit, attendance thresholds, roster/import, join code, attendance history and deletion; Back returns to `/teacher`
- Teacher settings: `/teacher/settings` is the owning menu; `/teacher/settings/student-requests`, `/teacher/settings/admin-access`, and `/teacher/settings/system-info` are independently addressable pages with an explicit Back link
- Route error / 403 page behavior: backend 403 is not treated as login; protected route renders only for verified role
- Teacher/Admin shell: page width is fluid; sidebar is an overlay drawer below 1024px and a persistent sticky sidebar from 1024px upward. A shared account card is the first navigation-region item and shows the Backend-verified Google avatar URL, profile name/email, and explicit teacher/permanent-admin/temporary-admin label; activating the card opens an isolated full-detail profile modal with an explicit top-right close control. Collapsed desktop rail keeps the avatar visible and reveals details on expansion. Desktop collapse preference persists locally, click always toggles it, and hover temporarily expands a collapsed rail. Main content owns no forced fixed width and every route must keep `min-width: 0`
- Teacher active-session indicator remains in the shell across child routes and returns directly to the Dynamic QR panel; dismissing QR/NFC does not close the attendance session
- Student shell: mobile-only width `100%` capped at 480px; shared `student-page` padding scales from 0.75rem to 1.25rem for phone viewports from 320px upward. Height follows `100dvh` with `100svh` fallback and iPhone/Android safe areas. Bottom navigation is outside the single main-content scroller, remains visible, and must not cover focused content
- Refresh gesture policy: application layouts do not intercept touch movement, render a Pull to Refresh indicator, or call full-page reload. Screens that need current remote data expose their own retry/reload behavior; browser/PWA navigation remains native
- Sidebar/drawer/bottom-sheet transformation: drawer overlay closes from its close control, backdrop, or destination selection; persistent sidebar navigation remains independently scrollable when viewport height is short
- Responsive table strategy: horizontal scroll; no table height constraints on sibling forms
- Truncation/full-value access: names wrap; identifiers remain readable
- Focus restoration and sticky-obstruction policy: dialogs restore to trigger when shared dialog migration is complete

## Overlays and feedback

- Toast placement/duration/deduplication: top-right; success/info 5s; error persistent; duplicate window 2s; max 4
- Alert/banner scope and persistence: inline for form/camera state
- Layer/z-index contract: toast 900, confirmation 800, presentation 700, dialog/fullscreen scanner 600, backdrop 500, application chrome 400, popover 300, dropdown 200. Shared confirmation dialogs portal to `document.body` so they remain above the owning dialog/presentation layer

## Async and resilience

- Mutation default: pessimistic for attendance and account/security operations
- Attendance-report reset policy: never hard-delete records from the teacher flow; atomically archive session membership from the active report and keep period snapshots for audit/recovery
- Idempotency and duplicate-submit policy: disabled submit + database unique `(session_id, student_id)`; support requests/messages also use unique UUID client tokens
- Offline/read-stale/write behavior: attendance writes fail closed; no cached API attendance data
- Retry/backoff/timeout behavior: OCR worker deadline 40s/backend timeout 42s; 30-request queue; optional standalone card OCR is limited per authenticated account; QR expiry asks for latest scan
- Session expiry/re-authentication: Axios interceptor clears expired local session and redirects through App
- Stale-request cancellation/invalidation: live initial fetch aborts on unmount; Realtime subscription removed; 15s polling fallback
- Dialog/form preservation: uploads remain selected on recoverable failure except consumed/expired QR; support composer retains text/files until server confirmation
- Teacher session recovery: the provider revalidates against Backend on mount and when the document becomes visible; no QR token is persisted in browser storage or returned by the recovery endpoint

## Validation

- Schema/validation layer: Pydantic + PostgreSQL constraints/RLS; client validation is advisory
- Student academic year: the student profile API derives a year from the authenticated account's 13-digit student ID in Asia/Bangkok time; the student PATCH route fails closed with 403 and the UI provides no edit control
- Trigger timing: file validation on selection and again on server; QR/token/challenge at each server boundary
- Support attachment handling: client may select PDF or common raster image types, but the Backend detects/decodes the actual image and stores a static JPEG or PNG without source metadata. SVG and unrecognized/corrupt image data fail closed. The private Storage bucket and attachment table stay Backend-only; preview and download both re-check request-participant authorization.
- Server error mapping: Thai `detail` shown inline/toast without leaking secrets
- Sensitive-value handling: no service key, embedding, raw OCR or QR token in notifications/logs
- Temporary-admin handling: PIN uses Argon2id plus server pepper; grants are memory-only, session-bound, hashed at rest, short-lived and revocable; permanent-admin operations fail closed on the server
- Duplicate-submit prevention: button busy state + unique database constraint; face attendance insert and QR challenge consumption are one atomic PostgreSQL RPC
- Attendance score: closed active sessions only; present = 1 point, late = 0.5 point, absent/missing in a closed session = 0 points. Pass threshold is `100 - max_absence_percent` from the course, and Excel/CSV/PDF use the same model.
- Liveness validation: face enrollment and attendance share signed protocol v4 hybrid mode and the same scanner/frame verifier: three passive samples followed by one randomly selected low-friction action (`blink` or `move_closer`) after a signed 500–1,400 ms prompt delay, then a recovery frame. Every token binds challenge, authenticated account, purpose, expiry, nonce, action, and delay; attendance additionally binds its session, so enrollment and attendance tokens cannot be exchanged. Browser Face Landmarker runs in the shared Web Worker on compatible browsers and uses a bounded one-frame-at-a-time DOM/main-thread fallback on iOS WebKit; either path captures the exact analyzed frames, but its decision is advisory. Backend recomputes one-face presence, same-person similarity, passive MiniFAS PAD, action geometry, recovery, timing order, and frozen-frame resistance before registration or recognition. Supabase claim/finalize RPCs retain one-use and concurrent-request protection. Static duplicates, wrong actions, face loss/swap, expired/borrowed/cross-purpose tokens, print/screen risk, and repeated finalization fail closed. This raises the cost of ordinary replay but does not claim resistance to adaptive deepfake/virtual-camera injection or ISO/IEC 30107 certification.
- Course membership: class codes never replace authentication; a non-enrolled student creates one pending request per course and only the course owner or permanent admin can approve it atomically with enrollment. Temporary admin elevation cannot manage another teacher's course.
- Image resource limits: client auto-orients and fits JPEG/PNG inside 1920×1920 px without cropping/upscaling, encodes once at JPEG quality 94%, then the server independently enforces encoded-byte, width, height, decoded-format and total-pixel limits
- Support attachment limits: JPEG/PNG/WebP/PDF only, no more than 3 files per message and 10 MiB per file; backend caps total multipart bytes before parsing, verifies real image format and decoded dimensions, and rejects PDF active-content markers

## Permission and clipboard

- Permission UI strategy: irrelevant role routes hidden; server authorization is authoritative; direct forbidden action receives 403
- Student registration status actions: face-registration action is shown only while `face_registered` is false; NFC registration remains teacher-assisted and shows guidance only while `nfc_registered` is false
- Student face self-enrollment: OCR must first bind the card number to the authenticated profile, with separate camera and file-picker choices, then a short-lived signed, account-bound, enrollment-purpose challenge drives protocol-v4 hybrid liveness through the shared scanner. The backend recomputes person continuity, passive PAD, signed random-action geometry, recovery, timing, and replay resistance before atomically storing the recovery-frame embedding and consuming the challenge. A student cannot overwrite an existing embedding; only a permanent administrator may use the supervised override flow.
- Disabled-state explanation: visible constraints near disabled check-in controls
- Account provisioning: student-domain accounts require a 13-digit student ID; teacher/admin accounts require an unclaimed admin invitation before first login
- Attendance scope: check-in only; passive liveness frames are transient request data and are not retained as permanent attendance photos. Student-card images are used only for initial self-enrollment OCR, never after Dynamic QR check-in.
- Support scope: student selects an enrolled course and backend derives its teacher; only that student and teacher can read/reply. Metadata tables and private Storage deny direct browser access; previews stream through an authorized backend endpoint. When a parent course/account is deleted the backend removes all discovered objects in batches and logs any failed Storage cleanup for operations to retry; no independent auto-expiry is enabled without an approved retention policy.

## Verification

- Required static commands: frontend build, backend unittest, OCR doctor/smoke test, premium strict audit
- Browser/device/locale/theme matrix: Chromium desktop + narrow mobile, Thai, light, reduced motion
- Accessibility checks: keyboard controls, live region toast, camera/upload labels, visible focus
- Failure-path evidence: expired QR, missing/invalid image, OCR unavailable, duplicate attendance, unauthorized course/session
