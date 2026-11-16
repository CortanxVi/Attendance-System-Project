/**
 * Face-registration reminder (owner request 2026-11-16): students without a registered face see a
 * clear reminder with a "go to profile" button and an X close button; the profile page then makes
 * the face-scan row blink. Source-wiring checks in the style of the other scripts.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const reminder = read('src/features/student/FaceRegistrationReminder.tsx');
const layout = read('src/components/layout/StudentLayout.tsx');
const profile = read('src/features/student/StudentProfile.tsx');
const css = read('src/index.css');

// Shown only when the profile says the face is NOT registered (unknown/failed load shows nothing).
assert.match(reminder, /useState<boolean \| null>\(null\)/);
assert.match(reminder, /if \(faceRegistered !== false \|\| dismissed \|\| hiddenHere\) return null;/);
assert.match(reminder, /response\.data\?\.profile\?\.face_registered/);
assert.match(reminder, /HIDDEN_ON = \['\/student\/profile', '\/student\/register'\]/);
// Text and buttons.
assert.match(reminder, /คุณยังไม่ได้ลงทะเบียนใบหน้า/);
assert.match(reminder, /“ลงทะเบียนใบหน้า” ในแถบการสแกนใบหน้า/);
assert.match(reminder, /FACE_REMINDER_ACTION_LABEL = 'ไปที่หน้าโปรไฟล์'/);
assert.match(reminder, /navigate\('\/student\/profile', \{ state: HIGHLIGHT_FACE_ROW_STATE \}\)/);
assert.match(reminder, /aria-label=\{FACE_REMINDER_CLOSE_LABEL\}[\s\S]{0,200}absolute right-1\.5 top-1\.5/, 'X button in the top-right corner');
assert.match(reminder, /onClick=\{close\}/);
assert.match(reminder, /sessionStorage\.setItem\(DISMISS_KEY, '1'\)/, 'X hides it for this browser session only');
assert.match(reminder, /try \{ return window\.sessionStorage/, 'storage access never throws');
assert.match(reminder, /role="alert"/);
assert.doesNotMatch(reminder, /ครับ|ค่ะ/, 'gender-neutral wording');

// Layout renders it above every student page.
assert.match(layout, /<FaceRegistrationReminder \/>\s*<Outlet \/>/);

// Profile row highlight.
assert.match(profile, /highlightFaceRow/);
assert.match(profile, /rowRef=\{faceRowRef\}\s*highlight=\{highlightFace && !profile\.face_registered\}/);
assert.match(profile, /attention-blink/);
assert.match(profile, /scrollIntoView/);
assert.match(profile, /navigate\(location\.pathname, \{ replace: true, state: null \}\)/, 'Back/refresh does not blink again');
assert.match(profile, /highlightStarted\.current = true/, 'the highlight starts once');
assert.match(css, /@keyframes attention-blink/);
assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.attention-blink\s*\{\s*animation: none;/, 'reduced motion: a still ring');

console.log('face registration reminder tests passed');
