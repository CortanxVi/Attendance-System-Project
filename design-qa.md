# Design QA — Student Profile and Support Requests

- Source visual truth: `/tmp/codex-clipboard-7de168d5-58bc-4b71-99f5-77c4068a0c5c.png`
- Source pixels: 1400 × 1050 px (two-screen composition)
- Implementation URLs: `http://127.0.0.1:5173/student/profile`, `http://127.0.0.1:5173/student/requests`, `http://127.0.0.1:5173/student/register`
- Implementation screenshot: unavailable
- Intended viewport: narrow mobile, 448 CSS px maximum content width, device scale factor 1
- State: signed-in student profile with inline academic-year edit and conditional registration rows; separate signed-in student request page; signed-in teacher settings inbox

## Evidence

The source image was opened and inspected. It establishes a centered mobile profile header, circular account photo, name/email hierarchy, one strong primary action, rounded white surfaces, and vertically ordered profile information.

The implementation could not be captured because the Codex browser runtime reported that no controllable browser was available, including after the local frontend, backend, and OCR services were running. Per the browser-choice contract, no unrelated Playwright or browser-control surface was substituted without user approval.

Because there is no browser-rendered implementation screenshot, the required combined source/implementation comparison, focused-region comparison, keyboard checks, responsive matrix, console inspection, received-file preview, and signed-in interaction pass could not be completed.

## Static implementation review

- Typography: existing system/Noto Sans Thai stack and established weights are retained.
- Spacing/layout: student screen remains single-column and uses the existing 1rem card radius and mobile shell; request navigation is a full-width semantic link with an explicit back link on the destination page.
- Colors/tokens: established orange primary, slate institutional, emerald success, red error, white surface, and slate border tokens are retained.
- Image quality: Google avatar is rendered at a reserved circular size with object-cover and deterministic initials fallback.
- Copy/content: Thai labels identify the 1–8 academic-year range, conditional face/NFC registration guidance, request recipient, file limits, pending/resolved status, errors, retry behavior, and secure preview action.

## Findings

- [P1] Browser-rendered fidelity and interaction verification unavailable.
  - Location: student profile, student request page, face-registration route, and teacher settings.
  - Evidence: no implementation screenshot or interactive browser session could be captured.
  - Impact: visual overflow, signed-in data rendering, PDF renderer behavior, keyboard focus, and responsive details are not yet proven in a real browser.
  - Fix: open the running local app in a controllable browser, sign in with one student and one teacher account, capture both routes, compare with the source, and correct any P0/P1/P2 differences.

## Comparison history

- Pass 1: blocked before comparison because the implementation artifact could not be captured. No visual fixes were claimed from source inspection alone.

## Implementation checklist

1. Capture `/student/profile` at a narrow viewport with Google avatar success/fallback, academic-year edit, face registered/unregistered, and NFC registered/unregistered states.
2. Verify the face-registration button appears only when required, then confirm successful registration returns to the profile and removes it.
3. Open `/student/requests` from its profile row, exercise the explicit back link, and test request creation with text, image, and PDF previews before sending.
4. Capture `/teacher/settings`, open the received request, preview both file types, reply, and resolve.
5. Test loading, empty, validation error, API failure/retry, keyboard navigation, reduced motion, and narrow/desktop layouts.
6. Place the source and implementation captures in one comparison input and rerun Design QA.

final result: blocked
