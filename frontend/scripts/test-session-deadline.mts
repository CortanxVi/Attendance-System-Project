import assert from 'node:assert/strict';
import {
  DEFAULT_LATE_THRESHOLD_MINUTES,
  autoCloseDeadlineMs,
  millisecondsUntil,
  normalizeLateThresholdMinutes,
} from '../src/utils/sessionDeadline.ts';

assert.equal(DEFAULT_LATE_THRESHOLD_MINUTES, 15);

// Course threshold is used when valid; anything unusable falls back to 15 like the backend.
assert.equal(normalizeLateThresholdMinutes(20), 20);
assert.equal(normalizeLateThresholdMinutes('30'), 30);
assert.equal(normalizeLateThresholdMinutes(7.9), 7);
for (const bad of [undefined, null, 0, -3, 'abc', NaN, Infinity]) {
  assert.equal(normalizeLateThresholdMinutes(bad), 15, `fallback for ${String(bad)}`);
}

// A brand-new session closes exactly one threshold after the answer was received.
const receivedAt = 1_000_000;
assert.equal(autoCloseDeadlineMs(0, 15, receivedAt), receivedAt + 15 * 60 * 1000);

// Server-reported elapsed time shortens the remaining window.
assert.equal(autoCloseDeadlineMs(600, 15, receivedAt), receivedAt + 5 * 60 * 1000);

// Already past the threshold: the deadline is in the past, so the caller closes at once.
assert.ok(autoCloseDeadlineMs(16 * 60, 15, receivedAt) < receivedAt);

// Missing or bogus elapsed time is treated as zero rather than closing early.
assert.equal(autoCloseDeadlineMs(undefined, 15, receivedAt), receivedAt + 15 * 60 * 1000);
assert.equal(autoCloseDeadlineMs(-50, 15, receivedAt), receivedAt + 15 * 60 * 1000);

// The course threshold, not a fixed 15, drives the deadline.
assert.equal(autoCloseDeadlineMs(0, 20, receivedAt), receivedAt + 20 * 60 * 1000);

assert.equal(millisecondsUntil(5_000, 2_000), 3_000);
assert.equal(millisecondsUntil(2_000, 5_000), 0);

console.log('session deadline tests passed');
