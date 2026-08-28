# UX Contract

## Product context

- Audience: นักศึกษา อาจารย์ และผู้ดูแล KMUTNB
- Primary jobs: เช็คชื่ออย่างยืนยันตัวตน, เปิด/ปิดคาบ, รับ NFC, ติดตาม realtime, จัดการบัญชีและรายงาน
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
| Form | screen form + backend schema | API/Pydantic | create/edit/upload | build + browser |
| Scrollbar | browser baseline | `frontend/src/index.css` | native | browser |
| Toast | `NotificationProvider` | shared component | success/info/error | live region + browser |
| Upload | screen-owned accessible file input + shared card-image preparation | `imageUtils.prepareStudentCardImage`, registration/import screens | card image/CSV | client + server validation |
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
| Scan Dynamic QR | camera result | verifying | card capture | inline check | rescan latest QR | scanner/action | `QRScanner.tsx` |
| Face + OCR check-in | submit face/card | disabled + spinner | result card | result + realtime toast | retain stage; retry/rescan on expiry | result heading | `StudentHome.tsx` |
| NFC check-in | card reader Enter | checking | remain ready | inline + realtime toast | clear UID and retry | reader input | `NFCManager.tsx` |
| Open/close session | teacher action | disabled | dashboard/live view | toast/inline | retry | trigger | `TeacherDashboard.tsx` |
| Upload/background job | file select | progress/disabled | remain | inline | preserve selected file | upload control | import/registration |
| Request temporary admin | teacher reason submit | disabled | settings status | toast + pending state | edit/retry | request form | `TeacherSettings.tsx` |
| Enroll/activate PIN | approved teacher submit | masked + disabled | admin dashboard | toast + expiry banner | inline attempts/lock | PIN field | `TeacherSettings.tsx` |
| Decide/revoke temporary admin | permanent admin confirmation | disabled | remain/refetch | toast | retain reason | action/dialog | `TemporaryAdminRequests.tsx` |
| Manage course roster | teacher CRUD/CSV | disabled | remain/refetch | toast/inline | retain form/file | trigger/form | `ImportStudents.tsx` |

## Navigation and responsive behavior

- Route document title policy: route/product title set at app startup; future route-specific titles extend it
- Route error / 403 page behavior: backend 403 is not treated as login; protected route renders only for verified role
- Sidebar/drawer/bottom-sheet transformation: existing sidebar collapses on mobile
- Responsive table strategy: horizontal scroll; no table height constraints on sibling forms
- Truncation/full-value access: names wrap; identifiers remain readable
- Focus restoration and sticky-obstruction policy: dialogs restore to trigger when shared dialog migration is complete

## Overlays and feedback

- Toast placement/duration/deduplication: top-right; success/info 5s; error persistent; duplicate window 2s; max 4
- Alert/banner scope and persistence: inline for form/camera state
- Layer/z-index contract: toast 900, dialog 600, backdrop 500, popover 300, dropdown 200

## Async and resilience

- Mutation default: pessimistic for attendance and account/security operations
- Idempotency and duplicate-submit policy: disabled submit + database unique `(session_id, student_id)`
- Offline/read-stale/write behavior: attendance writes fail closed; no cached API attendance data
- Retry/backoff/timeout behavior: OCR timeout 25s; QR expiry asks for latest scan
- Session expiry/re-authentication: Axios interceptor clears expired local session and redirects through App
- Stale-request cancellation/invalidation: live initial fetch aborts on unmount; Realtime subscription removed; 15s polling fallback
- Dialog/form preservation: uploads remain selected on recoverable failure except consumed/expired QR

## Validation

- Schema/validation layer: Pydantic + PostgreSQL constraints/RLS; client validation is advisory
- Trigger timing: file validation on selection and again on server; QR/token/challenge at each server boundary
- Server error mapping: Thai `detail` shown inline/toast without leaking secrets
- Sensitive-value handling: no service key, embedding, raw OCR or QR token in notifications/logs
- Temporary-admin handling: PIN uses Argon2id plus server pepper; grants are memory-only, session-bound, hashed at rest, short-lived and revocable; permanent-admin operations fail closed on the server
- Duplicate-submit prevention: button busy state + unique database constraint
- Image resource limits: client auto-orients and fits JPEG/PNG inside 1920×1920 px without cropping/upscaling, encodes once at JPEG quality 94%, then the server independently enforces encoded-byte, width, height, decoded-format and total-pixel limits

## Permission and clipboard

- Permission UI strategy: irrelevant role routes hidden; server authorization is authoritative; direct forbidden action receives 403
- Disabled-state explanation: visible constraints near disabled check-in controls
- Account provisioning: student-domain accounts require a 13-digit student ID; teacher/admin accounts require an unclaimed admin invitation before first login
- Attendance scope: check-in only; liveness/card images are transient request data and are not retained as permanent attendance photos

## Verification

- Required static commands: frontend build, backend unittest, OCR doctor/smoke test, premium strict audit
- Browser/device/locale/theme matrix: Chromium desktop + narrow mobile, Thai, light, reduced motion
- Accessibility checks: keyboard controls, live region toast, camera/upload labels, visible focus
- Failure-path evidence: expired QR, missing/invalid image, OCR unavailable, duplicate attendance, unauthorized course/session
