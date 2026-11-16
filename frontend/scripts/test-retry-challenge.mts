/**
 * Retry challenge after a failed check-in (Backend contract 2026-11-15): a 422 from
 * /attendance/verify may carry retry_challenge (same claim, new token, usually move_closer).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AttendanceVerifyError,
  RETRY_ACTION_LABELS,
  applyRetryChallenge,
  parseRetryChallenge,
  retryChallengeFromBody,
  retryStillValid,
} from '../src/services/retryChallenge.ts';

const expected = { sessionId: 'session-a', challengeId: 'claim-1' };
const valid = {
  status: 'valid',
  session_id: 'session-a',
  course_code: 'CS101',
  course_name: 'Intro',
  challenge_id: 'claim-1',
  challenge_expires_at: '2026-11-15T10:07:00+00:00',
  challenge_ttl_seconds: 245,
  liveness_protocol_version: 4,
  liveness_token: 'payload.signature',
  liveness_mode: 'hybrid',
  liveness_sample_count: 3,
  liveness_action: 'move_closer',
  liveness_prompt_delay_ms: 900,
};

// ---- Body extraction: only a 422 object body, retry_challenge or null ----
assert.deepEqual(retryChallengeFromBody(422, { detail: 'x', retry_challenge: valid }), valid);
assert.equal(retryChallengeFromBody(422, { detail: 'x', retry_challenge: null }), null);
assert.equal(retryChallengeFromBody(422, { detail: 'x' }), null, 'missing -> null');
assert.equal(retryChallengeFromBody(400, { detail: 'x', retry_challenge: valid }), null, 'other statuses never carry one');
assert.equal(retryChallengeFromBody(undefined, { retry_challenge: valid }), null, 'network error');
assert.equal(retryChallengeFromBody(422, 'text'), null);
assert.equal(retryChallengeFromBody(422, null), null);

// ---- Strict parsing ----
assert.deepEqual(parseRetryChallenge(valid, expected), {
  sessionId: 'session-a',
  challengeId: 'claim-1',
  challengeExpiresAt: '2026-11-15T10:07:00+00:00',
  challengeTtlSeconds: 245,
  livenessToken: 'payload.signature',
  livenessAction: 'move_closer',
  livenessPromptDelayMs: 900,
});
assert.equal(parseRetryChallenge({ ...valid, liveness_action: 'blink' }, expected)?.livenessAction, 'blink');
// A QR claim lasts at most 600 s (QR_CHALLENGE_SECONDS), so a retry with the full 600 s is accepted.
assert.equal(parseRetryChallenge({ ...valid, challenge_ttl_seconds: 600 }, expected)?.challengeTtlSeconds, 600, 'longest QR claim accepted');
assert.ok(parseRetryChallenge({ ...valid, status: undefined, course_code: null, course_name: undefined }, expected), 'optional texts');
assert.equal(parseRetryChallenge(null, expected), null);
assert.equal(parseRetryChallenge(undefined, expected), null);
assert.equal(parseRetryChallenge([valid], expected), null);
assert.equal(parseRetryChallenge(valid, { sessionId: null, challengeId: 'claim-1' }), null, 'no session on screen');
const invalid: Array<[string, Record<string, unknown>]> = [
  ['other session', { session_id: 'session-b' }],
  ['other claim', { challenge_id: 'claim-2' }],
  ['session not a string', { session_id: 1 }],
  ['bad expiry', { challenge_expires_at: 'soon' }],
  ['expiry not a string', { challenge_expires_at: 123 }],
  ['expired ttl', { challenge_ttl_seconds: 0 }],
  ['negative ttl', { challenge_ttl_seconds: -5 }],
  ['fractional ttl', { challenge_ttl_seconds: 12.5 }],
  ['ttl too long', { challenge_ttl_seconds: 10 * 60 + 1 }],
  ['ttl as text', { challenge_ttl_seconds: '245' }],
  ['old protocol', { liveness_protocol_version: 3 }],
  ['empty token', { liveness_token: '' }],
  ['token not a string', { liveness_token: 42 }],
  ['huge token', { liveness_token: 'x'.repeat(4097) }],
  ['other mode', { liveness_mode: 'passive' }],
  ['other sample count', { liveness_sample_count: 2 }],
  ['unknown action', { liveness_action: 'turn_head' }],
  ['delay too short', { liveness_prompt_delay_ms: 499 }],
  ['delay too long', { liveness_prompt_delay_ms: 1_401 }],
  ['delay fractional', { liveness_prompt_delay_ms: 900.5 }],
  ['status not text', { status: 1 }],
  ['course not text', { course_name: { x: 1 } }],
];
for (const [name, change] of invalid) assert.equal(parseRetryChallenge({ ...valid, ...change }, expected), null, name);

// ---- State replacement: new token/action/delay, countdown from the REMAINING ttl ----
const now = Date.parse('2026-11-15T10:02:00.000Z');
const next = applyRetryChallenge(parseRetryChallenge(valid, expected)!, now);
assert.equal(next.livenessToken, 'payload.signature');
assert.equal(next.livenessAction, 'move_closer');
assert.equal(next.livenessPromptDelayMs, 900);
assert.equal(next.challengeTtlSeconds, 245);
assert.equal(next.challengeExpiresAt, new Date(now + 245_000).toISOString(), 'local expiry = now + remaining ttl');
assert.equal(next.note, "ครั้งถัดไปเป็นคำสั่ง 'ขยับเข้าใกล้กล้อง'");
assert.match(applyRetryChallenge({ ...parseRetryChallenge(valid, expected)!, livenessAction: 'blink' }, now).note, new RegExp(RETRY_ACTION_LABELS.blink));
assert.equal(retryStillValid(next.challengeExpiresAt, now + 244_999), true);
assert.equal(retryStillValid(next.challengeExpiresAt, now + 245_000), false, 'expired: back to a new QR');
assert.equal(retryStillValid(null, now), false);
assert.equal(retryStillValid('garbage', now), false);

// ---- The error keeps detail as its message ----
const error = new AttendanceVerifyError('ตรวจไม่พบการหลับตา', valid, { cause: new Error('axios') });
assert.equal(error.message, 'ตรวจไม่พบการหลับตา');
assert.equal(error.name, 'AttendanceVerifyError');
assert.ok(error instanceof Error);
assert.deepEqual(error.retryChallenge, valid);

// ---- Wiring ----
const api = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
const home = readFileSync(new URL('../src/features/student/StudentHome.tsx', import.meta.url), 'utf8');
const register = readFileSync(new URL('../src/features/student/StudentRegister.tsx', import.meta.url), 'utf8');
assert.match(api, /retryChallengeFromBody\(error\.response\?\.status, error\.response\?\.data\)/);
assert.match(api, /throw new AttendanceVerifyError\(\s*apiErrorMessage\(error,/, 'detail stays the message');
assert.equal((api.match(/AttendanceVerifyError/g) ?? []).length, 2, 'only the attendance call uses it (import + throw)');
assert.match(home, /parseRetryChallenge\(error\.retryChallenge, \{ sessionId, challengeId \}\)/);
assert.match(home, /setLivenessToken\(next\.livenessToken\)/);
assert.match(home, /setChallengeTtlSeconds\(next\.challengeTtlSeconds\)/);
assert.match(home, /setSessionId\(info\.sessionId\)/);
assert.match(home, /retryNote && retryStillValid\(challengeExpiresAt, Date\.now\(\)\)/);
assert.match(home, /clearCapture\(\);\s*setIsLivenessActive\(true\);/, 'retry runs the scan with the new token, without the used capture');
assert.doesNotMatch(register, /retryChallenge|retry_challenge/, 'enrollment unchanged');

console.log('Retry challenge: 422 body parsing, strict validation, same-session/claim check, remaining-TTL countdown and scan restart pass.');
