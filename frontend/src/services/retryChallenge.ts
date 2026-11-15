/**
 * Retry challenge from POST /api/v1/attendance/verify (Backend contract 2026-11-15).
 *
 * A 422 answer may be {"detail": "<Thai>", "retry_challenge": {...} | null}. retry_challenge has the
 * same fields as the /sessions/{id}/validate response: the SAME QR claim (challenge_id, original
 * expiry), a NEW liveness token and usually the "move_closer" action (after a blink failure).
 * The web accepts it only when every field has the right type and range, it belongs to the
 * session and claim that are on screen, and time is left; anything else is ignored and the
 * detail is shown as before.
 */
import type { HybridLivenessAction } from '../utils/liveness';

export interface RetryChallenge {
  sessionId: string;
  challengeId: string;
  challengeExpiresAt: string;
  /** Seconds REMAINING on the original claim. */
  challengeTtlSeconds: number;
  livenessToken: string;
  livenessAction: HybridLivenessAction;
  livenessPromptDelayMs: number;
}

const MAX_TOKEN_CHARS = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

/** The validated retry challenge for the session/claim on screen, or null. */
// The server owns the expiry; this is only a sanity bound. Production QR claims last at most 600 s
// (QR_CHALLENGE_SECONDS is validated to 60-600), but test-mode claims last 4 hours
// (TEST_CHALLENGE_SECONDS in backend/core/test_mode.py), so the bound must cover both.
export const MAX_RETRY_TTL_SECONDS = 4 * 60 * 60;

export function parseRetryChallenge(
  raw: unknown,
  expected: { sessionId: string | null; challengeId: string | null },
): RetryChallenge | null {
  if (!isRecord(raw) || !expected.sessionId || !expected.challengeId) return null;
  const {
    status,
    session_id: sessionId,
    course_code: courseCode,
    course_name: courseName,
    challenge_id: challengeId,
    challenge_expires_at: expiresAt,
    challenge_ttl_seconds: ttl,
    liveness_protocol_version: version,
    liveness_token: token,
    liveness_mode: mode,
    liveness_sample_count: sampleCount,
    liveness_action: action,
    liveness_prompt_delay_ms: promptDelay,
  } = raw;
  if (!optionalString(status) || !optionalString(courseCode) || !optionalString(courseName)) return null;
  if (sessionId !== expected.sessionId || challengeId !== expected.challengeId) return null;
  if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) return null;
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > MAX_RETRY_TTL_SECONDS) return null;
  if (version !== 4 || mode !== 'hybrid' || sampleCount !== 3) return null;
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_CHARS) return null;
  if (action !== 'move_closer' && action !== 'blink') return null;
  if (typeof promptDelay !== 'number' || !Number.isInteger(promptDelay) || promptDelay < 500 || promptDelay > 1_400) return null;
  return {
    sessionId,
    challengeId,
    challengeExpiresAt: expiresAt,
    challengeTtlSeconds: ttl,
    livenessToken: token,
    livenessAction: action,
    livenessPromptDelayMs: promptDelay,
  };
}

/** The 422 body's retry_challenge (unvalidated), or null for any other answer. */
export function retryChallengeFromBody(status: number | undefined, body: unknown): unknown {
  if (status !== 422 || !isRecord(body)) return null;
  return body.retry_challenge ?? null;
}

export interface AttendanceChallengeState {
  livenessToken: string;
  livenessAction: HybridLivenessAction;
  livenessPromptDelayMs: number;
  challengeTtlSeconds: number;
  /** Local expiry from the REMAINING ttl (immune to a wrong phone clock). */
  challengeExpiresAt: string;
  note: string;
}

export const RETRY_ACTION_LABELS: Record<HybridLivenessAction, string> = {
  move_closer: 'ขยับเข้าใกล้กล้อง',
  blink: 'หลับตาแล้วลืมตา',
};

/** The challenge the page uses after a retry challenge was accepted. */
export function applyRetryChallenge(retry: RetryChallenge, nowMs: number): AttendanceChallengeState {
  return {
    livenessToken: retry.livenessToken,
    livenessAction: retry.livenessAction,
    livenessPromptDelayMs: retry.livenessPromptDelayMs,
    challengeTtlSeconds: retry.challengeTtlSeconds,
    challengeExpiresAt: new Date(nowMs + retry.challengeTtlSeconds * 1000).toISOString(),
    note: `ครั้งถัดไปเป็นคำสั่ง '${RETRY_ACTION_LABELS[retry.livenessAction]}'`,
  };
}

/** True while the claim behind an accepted retry challenge still has time left (local clock). */
export function retryStillValid(challengeExpiresAt: string | null, nowMs: number): boolean {
  if (!challengeExpiresAt) return false;
  const expiresAtMs = Date.parse(challengeExpiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

/** Error thrown by faceService.verifyAttendance: `message` is the detail, as before. */
export class AttendanceVerifyError extends Error {
  readonly retryChallenge: unknown;

  constructor(message: string, retryChallenge: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AttendanceVerifyError';
    this.retryChallenge = retryChallenge;
  }
}
