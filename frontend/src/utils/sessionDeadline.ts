// Pure helpers for the "close the session when the late window ends" rule.
// Kept free of React so they can be unit-tested with plain Node.

export const DEFAULT_LATE_THRESHOLD_MINUTES = 15;

/** Whole minutes of the course's late threshold; falls back like the backend does. */
export function normalizeLateThresholdMinutes(value: unknown): number {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 1
    ? Math.floor(minutes)
    : DEFAULT_LATE_THRESHOLD_MINUTES;
}

/**
 * Browser timestamp (ms) at which the session must close.
 *
 * `elapsedSeconds` is measured by the server, so the teacher's own clock is only
 * used to count the remaining time forward from the moment the answer arrived.
 */
export function autoCloseDeadlineMs(
  elapsedSeconds: unknown,
  lateThresholdMinutes: unknown,
  receivedAtMs: number,
): number {
  const elapsed = Number(elapsedSeconds);
  const safeElapsed = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const totalSeconds = normalizeLateThresholdMinutes(lateThresholdMinutes) * 60;
  return receivedAtMs + (totalSeconds - safeElapsed) * 1000;
}

export function millisecondsUntil(deadlineMs: number, nowMs: number): number {
  return Math.max(0, deadlineMs - nowMs);
}
