/**
 * Student "รายวิชา" tab, layout A (owner choice 2026-11-16): two tabs ("วิชาของฉัน" / "คำขอ") and a
 * sticky "เข้าร่วมวิชา" button that opens a bottom sheet with the class-code form.
 * Source-wiring checks in the style of the other scripts; behaviour of the API calls is unchanged.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/features/student/StudentCourses.tsx', import.meta.url), 'utf8');

// Tabs follow the WAI-ARIA pattern.
assert.match(source, /role="tablist"/);
assert.match(source, /role="tab"[\s\S]{0,120}aria-selected=\{selected\}[\s\S]{0,60}aria-controls=\{panelId\(value\)\}/);
assert.match(source, /tabIndex=\{selected \? 0 : -1\}/, 'roving tab index');
assert.match(source, /event\.key === 'ArrowRight' \|\| event\.key === 'ArrowLeft'/, 'arrow keys switch tabs');
assert.equal((source.match(/role="tabpanel"/g) ?? []).length, 2);
assert.match(source, /'วิชาของฉัน' : 'คำขอ'/);
assert.match(source, /aria-label=\{`รออนุมัติ \$\{pendingCount\} รายการ`\}/, 'pending count is announced');
assert.match(source, /loadedCourses\.length === 0 && loadedRequests\.some\(\(item\) => item\.status === 'pending'\) \? 'requests' : 'courses'/, 'first visit opens requests when that is all there is');

// Courses link to their own history page.
assert.match(source, /to=\{`\/student\/history\/\$\{course\.id\}`\}/);

// The old dark header card that repeated the page title is gone.
assert.doesNotMatch(source, /bg-slate-900 p-5 text-white/);

// Join sheet: a real dialog, focus kept inside, closed by Escape, X or backdrop, and not while sending.
assert.match(source, /<button ref=\{joinButtonRef\}[\s\S]{0,80}onClick=\{\(\) => setJoinOpen\(true\)\}[\s\S]{0,40}aria-haspopup="dialog"/);
assert.match(source, /sticky bottom-3/, 'the join button stays inside the scroller, above the bottom nav');
assert.match(source, /role="dialog"\s*aria-modal="true"\s*aria-labelledby=\{titleId\}/);
assert.match(source, /useModalIsolation\(true\)/);
assert.match(source, /event\.key === 'Escape' && !submittingRef\.current/);
assert.match(source, /aria-label="ปิด"/);
assert.match(source, /event\.target === event\.currentTarget && !submitting/);
assert.match(source, /joinButtonRef\.current\?\.focus\(\)/, 'focus returns to the join button');
assert.match(source, /env\(safe-area-inset-bottom\)/);

// The join and cancel behaviour of the old page is kept.
assert.match(source, /axios\.post\('\/api\/v1\/students\/me\/courses\/join', \{ code \}\)/);
assert.match(source, /'กรุณากรอกรหัสคลาสให้ครบ 8 ตัว'/);
assert.match(source, /axios\.delete\(`\/api\/v1\/students\/me\/courses\/join-requests\/\$\{cancelTarget\.id\}`\)/);
assert.match(source, /<ConfirmDialog open=\{Boolean\(cancelTarget\)\}/);
assert.match(source, /setTab\('requests'\)/, 'after sending, the new request is shown');
for (const label of ['รออนุมัติ', 'อนุมัติแล้ว', 'ปฏิเสธ', 'ยกเลิกแล้ว']) assert.ok(source.includes(`text: '${label}'`), `status text ${label}`);
assert.match(source, /ลองโหลดใหม่/, 'a failed load can be retried');

console.log('student courses tab tests passed');
