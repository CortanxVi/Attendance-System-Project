import assert from 'node:assert/strict';
import { parseTestChallenge, parseTestOpenSessions } from '../src/services/testMode.ts';

const validChallenge = {
  course_code: 'TEST1',
  course_name: 'Test course',
  challenge_id: 'challenge-1',
  challenge_expires_at: '2026-11-13T05:00:00+00:00',
  challenge_ttl_seconds: 14_400,
  liveness_protocol_version: 4,
  liveness_token: 'signed-token',
  liveness_mode: 'hybrid',
  liveness_sample_count: 3,
  liveness_action: 'blink',
  liveness_prompt_delay_ms: 900,
};

// A long lifetime is valid here (the QR flow caps it at 600 seconds).
const parsed = parseTestChallenge(validChallenge, 'session-1');
assert.equal(parsed.sessionId, 'session-1');
assert.equal(parsed.challengeTtlSeconds, 14_400);
assert.equal(parsed.livenessAction, 'blink');
assert.equal(parseTestChallenge({ ...validChallenge, liveness_action: 'move_closer' }, 's').livenessAction, 'move_closer');

// Anything that is not the signed hybrid protocol must be refused, never guessed.
for (const broken of [
  { ...validChallenge, liveness_protocol_version: 3 },
  { ...validChallenge, liveness_mode: 'legacy' },
  { ...validChallenge, liveness_sample_count: 2 },
  { ...validChallenge, liveness_action: 'turn_left' },
  { ...validChallenge, liveness_prompt_delay_ms: 100 },
  { ...validChallenge, liveness_token: undefined },
  { ...validChallenge, challenge_id: 7 },
  { ...validChallenge, challenge_ttl_seconds: 0 },
]) {
  assert.throws(() => parseTestChallenge(broken, 's'));
}
assert.throws(() => parseTestChallenge(null, 's'));

const sessions = parseTestOpenSessions({
  status: 'success',
  sessions: [
    { session_id: 'a', course_id: 'c', course_code: 'T1', course_name: 'N', opened_at: '2026-11-13T01:00:00Z', already_checked_in: true },
    { session_id: 'b', course_id: 'c' },
  ],
});
assert.equal(sessions.length, 2);
assert.equal(sessions[0].alreadyCheckedIn, true);
assert.equal(sessions[1].alreadyCheckedIn, false);
assert.equal(sessions[1].courseCode, '');
assert.throws(() => parseTestOpenSessions({ sessions: [{ course_id: 'c' }] }));
assert.throws(() => parseTestOpenSessions({}));

console.log('Test mode: challenge and session parsers pass.');
