/**
 * Timing rules of the hybrid liveness evidence, mirrored from the Backend
 * (verify_liveness_evidence in backend/services/liveness_service.py) with a safety margin.
 *
 * The scanner is only a pre-check; the Backend is the security gate. It must never send a scan the
 * Backend will refuse, because every upload uses up the student's attempt. So every limit below is
 * at least as strict as the Backend's, never looser:
 *
 *   Backend                                   Scanner
 *   gap between still frames 250-2000 ms      450 (SAMPLE_INTERVAL_MS) - 1800 ms
 *   recovery - action <= 3000 ms              <= 2700 ms
 *   completed - started 900-20000 ms          1000-19500 ms
 *   effective fps 8-35                        8-34
 *   first still >= started, prompt >= last still + delay, action >= prompt,
 *   action < recovery <= completed            identical (no margin needed: exact ordering)
 *
 * The margins (200 ms / 300 ms / 500 ms) cover timer jitter between the frame that is checked and the
 * frame that is finally stored; they are not measured values.
 */
import { CLEAR_FACE_ADVICE, type HybridLivenessEvidence } from './liveness.ts';

export const HYBRID_TIMING_LIMITS = Object.freeze({
  /** Backend MIN_SAMPLE_INTERVAL_MS is 250; the scanner already waits SAMPLE_INTERVAL_MS (450). */
  minSampleGapMs: 300,
  /** Backend MAX_SAMPLE_INTERVAL_MS is 2000. */
  maxSampleGapMs: 1_800,
  /** Backend: recovery_at - action_at > 3000 is refused. */
  maxActionToRecoveryMs: 2_700,
  /** Backend MIN_ATTEMPT_DURATION_MS / MAX_ATTEMPT_DURATION_MS are 900 / 20000. */
  minAttemptMs: 1_000,
  maxAttemptMs: 19_500,
  /** Backend MIN_EFFECTIVE_FPS / MAX_EFFECTIVE_FPS are 8 / 35. */
  minFps: 8,
  maxFps: 34,
});

export const PASSIVE_GAP_RESTART_MESSAGE = 'เก็บภาพไม่ต่อเนื่อง เริ่มเก็บภาพใหม่ ถือโทรศัพท์ให้นิ่งและมองตรง';
export const ACTION_TOO_SLOW_MESSAGE = 'ทำคำสั่งช้าเกินไป กรุณาทำใหม่อีกครั้งให้ต่อเนื่อง';
export const EVIDENCE_TIMING_MESSAGE = 'จังหวะการสแกนไม่ต่อเนื่อง ระบบยังไม่ได้ส่งข้อมูล กรุณาลองตรวจอีกครั้ง';
/** Shown when the scan ran out of time (attempt timeout, or evidence longer than maxAttemptMs). */
export const ATTEMPT_TIME_LIMIT_MESSAGE = `ตรวจใบหน้าไม่สำเร็จภายในเวลาที่กำหนด กรุณา${CLEAR_FACE_ADVICE} แล้วลองใหม่`;

/**
 * True when the next still frame would come too late after the last kept one, so the frames taken
 * so far must be discarded and collection must start again. `keptCount` is the number of still
 * frames kept so far; only a set that is started and not yet complete can expire.
 */
export function passiveSampleGapExpired(
  lastKeptAtMs: number,
  nowMs: number,
  keptCount: number,
  sampleCount: number,
): boolean {
  if (keptCount <= 0 || keptCount >= sampleCount) return false;
  return nowMs - lastKeptAtMs > HYBRID_TIMING_LIMITS.maxSampleGapMs;
}

/** True when a recovery frame at `nowMs` would be too late after the action frame. */
export function actionRecoveryExpired(actionAtMs: number, nowMs: number): boolean {
  return nowMs - actionAtMs > HYBRID_TIMING_LIMITS.maxActionToRecoveryMs;
}

export type EvidenceTimingProblem =
  | 'frames'
  | 'duration'
  | 'fps'
  | 'sample_gap'
  | 'sample_order'
  | 'prompt_order'
  | 'action_order'
  | 'recovery_order'
  | 'recovery_late';

/**
 * Last check before upload: the first timing rule of the Backend (with the margins above) that the
 * evidence breaks, or null when it is safe to send.
 */
export function hybridEvidenceTimingProblem(evidence: HybridLivenessEvidence): EvidenceTimingProblem | null {
  const limits = HYBRID_TIMING_LIMITS;
  const { frames } = evidence;
  if (frames.length !== evidence.sampleCount + 2) return 'frames';
  const samples = frames.slice(0, evidence.sampleCount);
  const [actionFrame, recoveryFrame] = frames.slice(-2);
  if (samples.some((frame, index) => frame.kind !== 'passive_sample' || frame.sampleIndex !== index + 1)) return 'frames';
  if (actionFrame.kind !== 'challenge_action' || recoveryFrame.kind !== 'challenge_recovery') return 'frames';
  if (actionFrame.action !== evidence.action || recoveryFrame.action !== evidence.action) return 'frames';
  const values = [
    evidence.startedAtMs, evidence.promptAtMs, evidence.completedAtMs, evidence.effectiveFps,
    ...frames.map((frame) => frame.timestampMs),
  ];
  if (values.some((value) => !Number.isFinite(value))) return 'frames';

  const duration = evidence.completedAtMs - evidence.startedAtMs;
  if (duration < limits.minAttemptMs || duration > limits.maxAttemptMs) return 'duration';
  if (evidence.effectiveFps < limits.minFps || evidence.effectiveFps > limits.maxFps) return 'fps';
  for (let index = 1; index < samples.length; index += 1) {
    const gap = samples[index].timestampMs - samples[index - 1].timestampMs;
    if (gap < limits.minSampleGapMs || gap > limits.maxSampleGapMs) return 'sample_gap';
  }
  const lastSampleAt = samples[samples.length - 1].timestampMs;
  if (samples[0].timestampMs < evidence.startedAtMs) return 'sample_order';
  if (evidence.promptAtMs < lastSampleAt + evidence.promptDelayMs) return 'prompt_order';
  if (actionFrame.timestampMs < evidence.promptAtMs) return 'action_order';
  if (recoveryFrame.timestampMs <= actionFrame.timestampMs || recoveryFrame.timestampMs > evidence.completedAtMs) {
    return 'recovery_order';
  }
  if (recoveryFrame.timestampMs - actionFrame.timestampMs > limits.maxActionToRecoveryMs) return 'recovery_late';
  return null;
}

/** The message for a pre-upload timing refusal: a scan that simply took too long gets the time-limit text. */
export function evidenceTimingMessage(problem: EvidenceTimingProblem, evidence: HybridLivenessEvidence): string {
  if (problem === 'duration' && evidence.completedAtMs - evidence.startedAtMs > HYBRID_TIMING_LIMITS.maxAttemptMs) {
    return ATTEMPT_TIME_LIMIT_MESSAGE;
  }
  return EVIDENCE_TIMING_MESSAGE;
}
