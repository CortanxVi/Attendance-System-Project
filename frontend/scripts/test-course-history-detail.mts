/**
 * Course detail in the student history tab (owner choice 2026-11-17): a timeline where the WHOLE row
 * (date and details) opens a bottom sheet with the full detail of that session, and the row being
 * viewed is highlighted. Source checks plus the absence-allowance rule.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const detail = read('src/features/student/CourseHistoryDetail.tsx');
const page = read('src/features/student/AttendanceHistory.tsx');
const css = read('src/index.css');

assert.match(page, /return <CourseHistoryDetail course=\{selectedCourse\} history=\{selectedHistory\} \/>;/);

// One button per row covers the date and the details text.
assert.match(detail, /<button\s+ref=\{\(node\)[\s\S]{0,200}onClick=\{\(\) => show\(session\.number\)\}[\s\S]{0,80}aria-haspopup="dialog"/);
assert.match(detail, /grid w-full grid-cols-\[3\.5rem_1\.5rem_1fr\]/, 'the button spans date, rail and details');
// Highlight of the viewed row (row ring + dark date), announced with aria-current.
assert.match(detail, /aria-current=\{selected \? 'true' : undefined\}/);
assert.match(detail, /selected \? 'bg-orange-50 ring-2 ring-orange-600'/);
assert.match(detail, /selected \? 'bg-slate-900 text-white'/);
// Stepping keeps the highlighted row in view; closing returns focus to it.
assert.match(detail, /rowRefs\.current\.get\(number\)\?\.scrollIntoView/);
assert.match(detail, /rowRefs\.current\.get\(number\)\?\.focus\(\)/);

// Sheet: dialog semantics, isolation, Escape, scrim, X, focus trap, safe area, reduced motion.
assert.match(detail, /role="dialog"\s*aria-modal="true"\s*aria-labelledby=\{titleId\}/);
assert.match(detail, /useModalIsolation\(true\)/);
assert.match(detail, /event\.key === 'Escape'/);
assert.match(detail, /event\.target === event\.currentTarget\) onClose\(\)/);
assert.match(detail, /aria-label="ปิดรายละเอียด"/);
assert.match(detail, /env\(safe-area-inset-bottom\)/);
assert.match(detail, /motion-safe:animate-\[sheet-up/);
assert.match(css, /@keyframes sheet-up/);
// Full detail content.
for (const label of ["'วันที่'", "'เวลาเช็คชื่อ'", "'วิธี'", 'ครั้งก่อน', 'ครั้งถัดไป', 'ยื่นคำร้องถึงอาจารย์']) assert.ok(detail.includes(label), label);
assert.match(detail, /to="\/student\/requests"/);
assert.match(detail, /disabled=\{!hasPrevious\}/);
assert.match(detail, /disabled=\{!hasNext\}/);

// Session numbers follow the date order (oldest = 1); the list shows the newest first.
assert.match(detail, /\.sort\(\(a, b\) => new Date\(a\.check_in_time\)\.getTime\(\) - new Date\(b\.check_in_time\)\.getTime\(\)\)/);

// Absence allowance uses the Backend rule (Fa when absent > total × percent / 100).
const allowance = (total: number, percent: number, absent: number) => Math.max(0, Math.floor(total * (percent / 100) - absent));
assert.equal(allowance(15, 20, 1), 2);
assert.equal(allowance(15, 20, 3), 0, 'at the limit: none left, still Normal (3 > 3 is false)');
assert.equal(allowance(16, 20, 1), 2, '3.2 allowed -> 2 more whole absences');
assert.match(detail, /const left = Math\.max\(0, Math\.floor\(allowed - course\.absent\)\)|left: Math\.max\(0, Math\.floor\(allowed - course\.absent\)\)/);
assert.match(detail, /course\.evaluation === 'Fa'/);
assert.match(detail, /if \(!course\.total_sessions \|\| !percent\) return null;/, 'no allowance line without a configured limit');

console.log('course history detail tests passed');
