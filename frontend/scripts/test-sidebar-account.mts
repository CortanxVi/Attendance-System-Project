import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const teacherSource = readFileSync(new URL('../src/components/layout/TeacherLayout.tsx', import.meta.url), 'utf8');
const adminSource = readFileSync(new URL('../src/components/layout/AdminLayout.tsx', import.meta.url), 'utf8');
const accountCardSource = readFileSync(new URL('../src/components/layout/SidebarAccountCard.tsx', import.meta.url), 'utf8');

assert.match(appSource, /<TeacherLayout profile=\{profile\}/);
assert.match(appSource, /<AdminLayout profile=\{profile\}/);
assert.ok(teacherSource.indexOf('<SidebarAccountCard') < teacherSource.indexOf('<nav'));
assert.ok(adminSource.indexOf('<SidebarAccountCard') < adminSource.indexOf('{\/\* Menu Navigate buttons \*\/}'));
assert.match(accountCardSource, /profile\.avatar_url/);
assert.match(accountCardSource, /referrerPolicy="no-referrer"/);
assert.match(adminSource, /role=\{temporary \? 'temporary_admin' : 'admin'\}/);
assert.match(accountCardSource, /ผู้ดูแลระบบชั่วคราว/);
assert.match(accountCardSource, /aria-label=\{`บัญชี/);

console.log('Teacher/admin sidebar account cards receive the verified profile, render above navigation, and label every role.');
