import axios from 'axios';
import type { VerifiedSessionInfo } from '../features/student/QRScanner';

export interface TestOpenSession {
  sessionId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  openedAt: string | null;
  alreadyCheckedIn: boolean;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

/** Validate the open-session list sent by the test-only Backend endpoint. */
export function parseTestOpenSessions(data: unknown): TestOpenSession[] {
  if (!isRecord(data) || !Array.isArray(data.sessions)) {
    throw new Error('Backend ส่งรายการคาบทดสอบไม่ถูกต้อง');
  }
  return data.sessions.map((item) => {
    if (
      !isRecord(item)
      || typeof item.session_id !== 'string'
      || typeof item.course_id !== 'string'
    ) {
      throw new Error('Backend ส่งรายการคาบทดสอบไม่ถูกต้อง');
    }
    return {
      sessionId: item.session_id,
      courseId: item.course_id,
      courseCode: typeof item.course_code === 'string' ? item.course_code : '',
      courseName: typeof item.course_name === 'string' ? item.course_name : '',
      openedAt: typeof item.opened_at === 'string' ? item.opened_at : null,
      alreadyCheckedIn: item.already_checked_in === true,
    };
  });
}

/**
 * Validate a QR-free challenge. It has the same shape as the QR flow, except
 * that its lifetime is long, so the 60-600 second check is intentionally absent.
 */
export function parseTestChallenge(data: unknown, sessionId: string): VerifiedSessionInfo {
  if (!isRecord(data)) throw new Error('Backend ส่งข้อมูลสิทธิ์สแกนใบหน้าไม่ครบ');
  const {
    course_code,
    course_name,
    challenge_id,
    challenge_expires_at,
    challenge_ttl_seconds,
    liveness_protocol_version,
    liveness_token,
    liveness_mode,
    liveness_sample_count,
    liveness_action,
    liveness_prompt_delay_ms,
  } = data;
  if (
    typeof challenge_id !== 'string'
    || typeof challenge_expires_at !== 'string'
    || typeof challenge_ttl_seconds !== 'number'
    || !Number.isInteger(challenge_ttl_seconds)
    || challenge_ttl_seconds <= 0
    || liveness_protocol_version !== 4
    || typeof liveness_token !== 'string'
    || liveness_mode !== 'hybrid'
    || liveness_sample_count !== 3
    || (liveness_action !== 'blink' && liveness_action !== 'move_closer')
    || typeof liveness_prompt_delay_ms !== 'number'
    || !Number.isInteger(liveness_prompt_delay_ms)
    || liveness_prompt_delay_ms < 500
    || liveness_prompt_delay_ms > 1_400
  ) {
    throw new Error('Backend ส่งข้อมูลสิทธิ์สแกนใบหน้าไม่ครบ กรุณาแจ้งผู้ดูแลระบบ');
  }
  return {
    sessionId,
    courseCode: typeof course_code === 'string' ? course_code : '',
    courseName: typeof course_name === 'string' ? course_name : '',
    challengeId: challenge_id,
    challengeExpiresAt: challenge_expires_at,
    challengeTtlSeconds: challenge_ttl_seconds,
    livenessToken: liveness_token,
    livenessMode: 'hybrid',
    livenessSampleCount: 3,
    livenessAction: liveness_action,
    livenessPromptDelayMs: liveness_prompt_delay_ms,
  };
}

export async function fetchTestOpenSessions(signal?: AbortSignal): Promise<TestOpenSession[]> {
  const response = await axios.get('/api/v1/test/open-sessions', { signal });
  return parseTestOpenSessions(response.data);
}

export async function requestTestChallenge(sessionId: string): Promise<VerifiedSessionInfo> {
  const response = await axios.post(`/api/v1/test/sessions/${encodeURIComponent(sessionId)}/challenge`);
  return parseTestChallenge(response.data, sessionId);
}
