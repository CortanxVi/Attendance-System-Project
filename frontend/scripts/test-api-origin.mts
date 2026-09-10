import assert from 'node:assert/strict';
import { normalizeApiOrigin } from '../src/config/apiOrigin.ts';

assert.equal(normalizeApiOrigin(undefined, true), '');
assert.equal(normalizeApiOrigin('', true), '');
assert.equal(
  normalizeApiOrigin(' https://api.attendance.example.ac.th/ ', true),
  'https://api.attendance.example.ac.th',
);
assert.equal(normalizeApiOrigin('http://127.0.0.1:8000', false), 'http://127.0.0.1:8000');

assert.throws(() => normalizeApiOrigin('http://api.example.ac.th', true), /HTTPS/);
assert.throws(() => normalizeApiOrigin('http://192.168.1.10:8000', false), /localhost/);
assert.throws(() => normalizeApiOrigin('https://api.example.ac.th/api', true), /origin/);
assert.throws(() => normalizeApiOrigin('https://api.example.ac.th?token=x', true), /origin/);
assert.throws(() => normalizeApiOrigin('https://user:pass@api.example.ac.th', true), /origin/);
assert.throws(() => normalizeApiOrigin('javascript:alert(1)', true), /origin|HTTP/);

console.log('API origin policy: same-origin fallback and HTTPS split deployment pass.');
