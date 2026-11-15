export type LivenessAction = 'move_closer' | 'blink';

export type HybridLivenessAction = 'blink' | 'move_closer';

export interface HybridLivenessEvidence {
  version: 4;
  mode: 'hybrid';
  sampleCount: 3;
  action: HybridLivenessAction;
  promptDelayMs: number;
  frames: Array<
    | { kind: 'passive_sample'; sampleIndex: number; timestampMs: number }
    | { kind: 'challenge_action'; action: HybridLivenessAction; timestampMs: number }
    | { kind: 'challenge_recovery'; action: HybridLivenessAction; timestampMs: number }
  >;
  startedAtMs: number;
  promptAtMs: number;
  completedAtMs: number;
  effectiveFps: number;
}

export interface HybridLivenessBaseline {
  leftEar: number;
  rightEar: number;
  faceWidthRatio: number;
  yaw: number;
  pitch: number;
  roll?: number;
}

/**
 * Blink thresholds of the hybrid challenge (device-side pre-check; the Backend recomputes the
 * security-relevant geometry from the uploaded action frame with its own 68-point model).
 *
 * Why the web is now much stricter (investigation 2026-11-15, real phone data): frames the scanner
 * judged "closed" measured 0.82-0.97 of the open aperture in the Backend (limit 0.78 for wide eyes
 * up to 0.88 for narrow ones). Two causes: (a) the first qualifying frame was uploaded, often a frame
 * on the closing slope; (b) MediaPipe's aperture drops far more than the Backend's 68-point measure
 * for the same lid position, so the old web limit (0.75) was not deep enough. The scanner therefore
 * (1) keeps the DEEPEST frame of the closure and uploads that one, and (2) requires that frame to be
 * deeply closed in MediaPipe terms. ALL VALUES BELOW ARE FROM THAT INVESTIGATION AND UNMEASURED ON
 * LIVE PHONES: confirm them with the test-build overlay and the failure table before tuning.
 *
 * Two levels of closure:
 *  - "lid down" (`blinkClosedRatioLimit`, `lidDownBlendshape`): loose. It only decides whether a
 *    closure episode is still going on, so landmark jitter on one frame does not split a blink.
 *  - "deep" (`deepRatio` + `deepBlendshape`): the frame that is uploaded must meet this.
 *
 * Narrow eyes: the landmark mesh cannot close below an absolute floor (about 0.06-0.09), so an eye
 * whose open aperture is under `narrowFallbackEar` may never reach `deepRatio`. For such an eye the
 * deep test becomes ratio <= `blinkClosedRatioLimit` (up to 0.88) AND eyeBlink score >=
 * `narrowFallbackBlendshape`. Trade-off: this leans on the blend-shape score, and the Backend's
 * 68-point measure on narrow eyes is also least sensitive, so narrow eyes remain the most likely to be
 * refused by the Backend after passing here. The alternative (no fallback) would lock out people
 * whose eyes the mesh cannot close, which is worse; watch the narrow-eye rows of the failure table.
 *
 * Without blend-shape scores (both exactly 0: the model has not switched them on yet, or the device
 * cannot), only the aperture is left, so it must be deeper (`noBlendshapeDeepRatio`) and the
 * narrow-eye fallback is not available.
 */
/*
 * Units (2026-11-15, F2): every absolute EAR value here (wideEar, narrowEar, narrowFallbackEar) and
 * MIN_READABLE_EAR is now in TRUE geometric units, because observationFromLandmarker corrects the
 * frame aspect. wideEar / narrowEar equal the Backend's BLINK_WIDE_EAR / BLINK_NARROW_EAR. The ratio
 * limits (closedRatio, deepRatio, noBlendshapeDeepRatio, recoveryRatio, ...) are scale-invariant.
 */
export const HYBRID_BLINK_LIMITS = Object.freeze({
  // "lid down" (episode continuation) and the narrow-eye fallback limit
  closedRatio: 0.75,
  narrowClosedRatio: 0.88,
  wideEar: 0.26,
  narrowEar: 0.13,
  lidDownBlendshape: 0.32,
  // "deep": what the uploaded frame must show
  deepRatio: 0.55,
  deepBlendshape: 0.50,
  /**
   * The mesh floor reaches about 0.09, so an eye open less than 0.18 can at best show ratio ~0.5 and
   * landmark jitter (~0.008) keeps it from reaching 0.55 reliably (simulation: 0.17-open eyes with a
   * 0.085 floor passed only 87% at 12 fps without the fallback).
   */
  narrowFallbackEar: 0.18,
  narrowFallbackBlendshape: 0.60,
  noBlendshapeDeepRatio: 0.45,
  // the closure episode
  /** A closure counts once it lasted this many frames OR this long (one-frame spikes are refused). */
  minClosedFrames: 3,
  minClosedMs: 200,
  /** At least this many of those frames must be deep, so one noisy deep frame is not enough. */
  minDeepFrames: 2,
  /** The action is committed when the eyes reopen or after this long shut, whichever comes first. */
  maxHoldMs: 600,
  recoveryRatio: 0.70,
  /** move_closer: consecutive frames in range. */
  actionFrames: 2,
});

/** Largest eye-aperture ratio that still counts as "lid down" for an eye with this open aperture. */
export function blinkClosedRatioLimit(baselineEar: number): number {
  const { closedRatio, narrowClosedRatio, wideEar, narrowEar } = HYBRID_BLINK_LIMITS;
  if (baselineEar >= wideEar) return closedRatio;
  if (baselineEar <= narrowEar) return narrowClosedRatio;
  const share = (wideEar - baselineEar) / (wideEar - narrowEar);
  return closedRatio + share * (narrowClosedRatio - closedRatio);
}

/**
 * Head pose while the random action is performed and after it. The Backend compares the action frame
 * and the final frame with the FIRST still frame (yaw 0.15 / pitch 0.20 for the action; yaw 0.14,
 * pitch 0.18, roll 0.18, size +-20% for the final frame; centre 0.30), so the scanner measures
 * against that same first frame, not a median of the three.
 *
 * Chosen on the real models (TuningModelLog.md entry 4, 47 transformed photo pairs): the scanner used
 * to accept 11 final frames the Backend refused, all because it never checked head tilt (roll). With
 * these limits none leaks, and 6 of 47 pairs are refused that the Backend would have accepted.
 * Yaw, roll and size read 1:1 in both models, pitch about 1.3x larger in the Backend; the yaw
 * margin is thin (0.03), so watch `recovery_yaw` and `move_closer_yaw` in the failure table.
 */
export const HYBRID_POSE_LIMITS = Object.freeze({
  yaw: 0.11,
  pitch: 0.12,
  roll: 0.14,
  center: 0.22,
  recoveryScale: 0.17,
  /**
   * Size limit of the final frame after "move closer" (Backend still +-0.20). Real phone data
   * (2026-11-15): the Backend measured +0.28 on a final frame this scanner accepted with 0.17,
   * because MediaPipe's cheek width and InsightFace's box disagree most right after the face came
   * close. The web therefore asks for a tighter return after move_closer. UNMEASURED on a paired
   * calibration set: 0.12 is a margin choice, not a measured equivalence. Never loosen it past 0.17.
   *
   * 0.12 -> 0.15 (owner report + 32 move_closer attempts, 2026-11-15): the Backend accepted
   * final-frame size changes up to +0.13 and its only size refusal was +0.28; 0.12 made people
   * hunt for the exact old distance. 0.15 still keeps 0.05 under the Backend's +-0.20 (the web/Backend
   * size disagreement seen so far was about +0.08 to +0.11 right after moving close).
   * Review round 3 accepted this as an OWNER RISK (thinner margin to the Backend). Follow-up metric:
   * the count of Backend `recovery_scale` refusals on move_closer in the test failure table; if
   * they reappear, go back towards 0.12.
   */
  recoveryScaleAfterMoveCloser: 0.15,
});

/** The size tolerance of the final frame for this action (never wider than the general one). */
export function recoveryScaleLimit(action?: HybridLivenessAction): number {
  return action === 'move_closer'
    ? Math.min(HYBRID_POSE_LIMITS.recoveryScaleAfterMoveCloser, HYBRID_POSE_LIMITS.recoveryScale)
    : HYBRID_POSE_LIMITS.recoveryScale;
}

function hybridPoseStable(
  observation: LivenessObservation,
  baseline: HybridLivenessBaseline,
  { checkRoll }: { checkRoll: boolean },
): boolean {
  return observation.faceCount === 1
    && observation.centerOffset <= HYBRID_POSE_LIMITS.center
    && Math.abs(observation.yaw - baseline.yaw) <= HYBRID_POSE_LIMITS.yaw
    && Math.abs(observation.pitch - baseline.pitch) <= HYBRID_POSE_LIMITS.pitch
    && (!checkRoll || Math.abs((observation.roll ?? 0) - (baseline.roll ?? 0)) <= HYBRID_POSE_LIMITS.roll);
}

/** 'lid_down': the closure is still going on; 'deep': this frame is deep enough to upload. */
export type BlinkClosure = 'open' | 'lid_down' | 'deep';

/** Eye aperture of this frame as a share of the open baseline, per eye. */
export function blinkRatios(
  observation: LivenessObservation,
  baseline: HybridLivenessBaseline,
): { left: number; right: number } {
  return {
    left: observation.leftEar / Math.max(baseline.leftEar, 0.001),
    right: observation.rightEar / Math.max(baseline.rightEar, 0.001),
  };
}

function eyeDeep(ratio: number, score: number, baselineEar: number, hasScores: boolean): boolean {
  const limits = HYBRID_BLINK_LIMITS;
  if (!hasScores) return ratio <= limits.noBlendshapeDeepRatio;
  if (ratio <= limits.deepRatio && score >= limits.deepBlendshape) return true;
  return baselineEar < limits.narrowFallbackEar
    && ratio <= blinkClosedRatioLimit(baselineEar)
    && score >= limits.narrowFallbackBlendshape;
}

export function blinkClosure(
  observation: LivenessObservation,
  baseline: HybridLivenessBaseline,
): BlinkClosure {
  if (!hybridPoseStable(observation, baseline, { checkRoll: false })) return 'open';
  const { left, right } = blinkRatios(observation, baseline);
  const hasScores = observation.leftBlinkScore > 0 || observation.rightBlinkScore > 0;
  const lowScore = Math.min(observation.leftBlinkScore, observation.rightBlinkScore);
  const lidDown = left <= blinkClosedRatioLimit(baseline.leftEar)
    && right <= blinkClosedRatioLimit(baseline.rightEar)
    && (!hasScores || lowScore >= HYBRID_BLINK_LIMITS.lidDownBlendshape);
  if (!lidDown) return 'open';
  const deep = eyeDeep(left, observation.leftBlinkScore, baseline.leftEar, hasScores)
    && eyeDeep(right, observation.rightBlinkScore, baseline.rightEar, hasScores);
  return deep ? 'deep' : 'lid_down';
}

/**
 * Face-size ratio (action frame / first still frame) the scanner accepts for "move closer".
 *
 * The Backend accepts 1.08-1.70 (MOVE_CLOSER_SCALE_MIN/MAX in liveness_frame_service.py) and measures
 * the size with a different model (InsightFace box vs MediaPipe cheek-to-cheek width). The scanner
 * used the very same 1.08-1.70, so a frame at 1.08 here could read 1.07 there; real phone data showed
 * exactly that refusal (Backend 1.07). The web pre-check must never send what the Backend refuses, so
 * it keeps about 0.04 of margin at the bottom and 0.10 at the top (moving far too close also
 * distorts the face and pushes it out of the frame). Not measured on a model-to-model calibration
 * set yet: widen only with paired measurements, never by loosening the Backend.
 */
export const HYBRID_MOVE_CLOSER_LIMITS = Object.freeze({
  minScale: 1.12,
  maxScale: 1.60,
});

export function moveCloserScaleOk(scaleRatio: number): boolean {
  return scaleRatio >= HYBRID_MOVE_CLOSER_LIMITS.minScale && scaleRatio <= HYBRID_MOVE_CLOSER_LIMITS.maxScale;
}

export function hybridActionDetected(
  action: HybridLivenessAction,
  observation: LivenessObservation,
  baseline: HybridLivenessBaseline,
): boolean {
  if (action === 'blink') return blinkClosure(observation, baseline) === 'deep';
  if (!hybridPoseStable(observation, baseline, { checkRoll: false })) return false;
  const scaleRatio = observation.faceWidthRatio / Math.max(baseline.faceWidthRatio, 0.001);
  return moveCloserScaleOk(scaleRatio);
}

export type MoveCloserHint = 'no_face' | 'pose' | 'closer' | 'back' | 'ok';

export const MOVE_CLOSER_PROMPT = 'ขยับใบหน้าเข้าใกล้กล้องเล็กน้อย';
/** Shown while the face is in the target zone: two frames in a row are needed. */
export const MOVE_CLOSER_HOLD_MESSAGE = 'พอดีแล้ว ค้างไว้';
/** Shown when the final frame was not reached in time after moving close (the step restarts). */
export const MOVE_CLOSER_RECOVERY_LATE_MESSAGE = 'ถอยกลับช้าเกินไป เริ่มขั้นนี้ใหม่: ขยับเข้าใกล้ ค้างไว้ แล้วถอยกลับที่เดิมทันที';

/** Live size guide of the move-closer step, for the bar under the instruction. */
export interface SizeGuide {
  /** Current size / first still frame. */
  ratio: number;
  /** Target zone in the same units. */
  zoneMin: number;
  zoneMax: number;
  /** 'closer' | 'hold' | 'back' while acting; 'return' | 'hold' while coming back. */
  state: 'closer' | 'hold' | 'back' | 'return' | 'forward';
  label: string;
  /** Marker and zone positions on the bar (0-1), drawn over GUIDE_RANGE. */
  marker: number;
  zoneStart: number;
  zoneEnd: number;
}

/** The bar spans these size ratios (beyond them the marker stays at the end). */
export const GUIDE_RANGE = Object.freeze({ min: 0.75, max: 1.75 });

function onBar(ratio: number): number {
  return Math.min(1, Math.max(0, (ratio - GUIDE_RANGE.min) / (GUIDE_RANGE.max - GUIDE_RANGE.min)));
}

/**
 * Where the face is relative to the zone the scanner needs: 1.12-1.60x for the action, back within
 * +-recoveryScaleLimit for the final frame. Same limits as moveCloserScaleOk / hybridRecoveryDetected.
 */
export function moveCloserGuide(
  phase: 'action' | 'recovery',
  observation: LivenessObservation,
  baseline: HybridLivenessBaseline,
): SizeGuide | null {
  if (observation.faceCount !== 1 || !(observation.faceWidthRatio > 0)) return null;
  const ratio = observation.faceWidthRatio / Math.max(baseline.faceWidthRatio, 0.001);
  const zoneMin = phase === 'action' ? HYBRID_MOVE_CLOSER_LIMITS.minScale : 1 - recoveryScaleLimit('move_closer');
  const zoneMax = phase === 'action' ? HYBRID_MOVE_CLOSER_LIMITS.maxScale : 1 + recoveryScaleLimit('move_closer');
  let state: SizeGuide['state'];
  let label: string;
  if (phase === 'action') {
    if (ratio < zoneMin) { state = 'closer'; label = 'เข้าใกล้อีกนิด'; }
    else if (ratio > zoneMax) { state = 'back'; label = 'ใกล้เกินไป ถอยออกเล็กน้อย'; }
    else { state = 'hold'; label = MOVE_CLOSER_HOLD_MESSAGE; }
  } else if (ratio > zoneMax) { state = 'return'; label = 'ถอยกลับที่เดิม'; }
  else if (ratio < zoneMin) { state = 'forward'; label = 'ไกลเกินไป ขยับเข้ามาอีกนิด'; }
  else { state = 'hold'; label = 'พอดีแล้ว มองตรงค้างไว้'; }
  return { ratio, zoneMin, zoneMax, state, label, marker: onBar(ratio), zoneStart: onBar(zoneMin), zoneEnd: onBar(zoneMax) };
}
export const MOVE_CLOSER_MESSAGES: Record<Exclude<MoveCloserHint, 'no_face' | 'ok'>, string> = {
  pose: 'มองตรงและให้ใบหน้าอยู่กลางกรอบขณะขยับเข้าใกล้',
  closer: 'ขยับใบหน้าเข้าใกล้กล้องอีกเล็กน้อย',
  back: 'ใกล้เกินไป ถอยห่างจากกล้องเล็กน้อย',
};

/** What the person should do next while the "move closer" step is waiting for a valid frame. */
export function moveCloserHint(
  observation: LivenessObservation,
  baseline: HybridLivenessBaseline,
): MoveCloserHint {
  if (observation.faceCount !== 1) return 'no_face';
  if (!hybridPoseStable(observation, baseline, { checkRoll: false })) return 'pose';
  const scaleRatio = observation.faceWidthRatio / Math.max(baseline.faceWidthRatio, 0.001);
  if (scaleRatio < HYBRID_MOVE_CLOSER_LIMITS.minScale) return 'closer';
  if (scaleRatio > HYBRID_MOVE_CLOSER_LIMITS.maxScale) return 'back';
  return 'ok';
}

export function hybridRecoveryDetected(
  observation: LivenessObservation,
  baseline: HybridLivenessBaseline,
  action?: HybridLivenessAction,
): boolean {
  return hybridPoseStable(observation, baseline, { checkRoll: true })
    && observation.faceWidthRatio >= 0.20
    && observation.faceWidthRatio <= 0.76
    && Math.abs(observation.faceWidthRatio / Math.max(baseline.faceWidthRatio, 0.001) - 1) <= recoveryScaleLimit(action)
    && observation.leftEar / Math.max(baseline.leftEar, 0.001) >= HYBRID_BLINK_LIMITS.recoveryRatio
    && observation.rightEar / Math.max(baseline.rightEar, 0.001) >= HYBRID_BLINK_LIMITS.recoveryRatio;
}

export type RecoveryHint = 'no_face' | 'pose' | 'back' | 'closer' | 'ok';

export const RECOVERY_MESSAGES: Record<Exclude<RecoveryHint, 'no_face' | 'ok'>, string> = {
  pose: 'มองตรงและให้ใบหน้าอยู่กลางกรอบเหมือนตอนเริ่ม',
  back: 'ถอยกลับไปตำแหน่งเดิม',
  closer: 'ขยับเข้ามาใกล้กล้องอีกนิดให้เท่าตอนเริ่ม',
};

/** What the person should do to make the final frame match the first still frame. */
export function recoveryHint(
  observation: LivenessObservation,
  baseline: HybridLivenessBaseline,
  action?: HybridLivenessAction,
): RecoveryHint {
  if (observation.faceCount !== 1) return 'no_face';
  if (!hybridPoseStable(observation, baseline, { checkRoll: true })) return 'pose';
  const delta = observation.faceWidthRatio / Math.max(baseline.faceWidthRatio, 0.001) - 1;
  if (delta > recoveryScaleLimit(action)) return 'back';
  if (delta < -recoveryScaleLimit(action)) return 'closer';
  return 'ok';
}

/** Shown whenever the face or the eyes cannot be read, so the person knows what to clear. */
export const CLEAR_FACE_ADVICE = 'เปิดหน้าผากและเก็บผมที่ปิดคิ้วหรือตา ถอดแว่นหรือหน้ากาก และอยู่ในที่สว่างพอ';
// A short, firm closure: the scanner needs a few deeply closed frames (see HYBRID_BLINK_LIMITS), and
// holding the eyes shut for long only pushes the action-to-recovery span towards the Backend's 3 s limit.
export const BLINK_PROMPT = 'หลับตาทั้งสองข้างให้สนิทสักครู่ แล้วลืมตามองตรง';
export const BLINK_RETRY_PROMPT = 'ยังไม่พบการหลับตา กรุณาหลับตาให้สนิทสักครู่ แล้วลืมตา และเก็บผมที่ปิดตาออก';
/** After this long without a readable face the generic hint turns into the full advice. */
export const FACE_ADVICE_AFTER_MS = 2_500;
export const BLINK_RETRY_AFTER_MS = 4_000;
export const MIN_READABLE_EAR = 0.07;

/** What to tell the person while the frame fails the quality check for `badForMs`. */
export function faceProblemInstruction(observation: LivenessObservation, badForMs: number): string {
  if (observation.faceCount > 1) return 'ให้มีใบหน้าในกรอบเพียง 1 คน';
  if (observation.faceCount === 0) {
    return badForMs >= FACE_ADVICE_AFTER_MS
      ? `ยังอ่านใบหน้าไม่ได้ กรุณา${CLEAR_FACE_ADVICE}`
      : 'วางใบหน้าให้อยู่ในกรอบ';
  }
  const eyesUnreadable = observation.leftEar <= MIN_READABLE_EAR || observation.rightEar <= MIN_READABLE_EAR;
  if (eyesUnreadable) {
    return badForMs >= FACE_ADVICE_AFTER_MS / 2
      ? 'มองไม่เห็นดวงตาชัดเจน กรุณาเก็บผมที่ปิดตาและลืมตามองตรงให้เห็นตาทั้งสองข้าง'
      : 'ลืมตามองตรงให้เห็นตาทั้งสองข้าง';
  }
  return badForMs >= FACE_ADVICE_AFTER_MS
    ? `ตรวจใบหน้าไม่ชัดเจน กรุณาอยู่กลางกรอบ มองตรง และ${CLEAR_FACE_ADVICE}`
    : 'มองตรงและขยับใบหน้าให้อยู่กลางกรอบ';
}

/**
 * Pose stability of the three still frames. The Backend rejects the set when the head moves between
 * them (yaw 0.14, pitch 0.18, roll 0.18, size +-22%), so the scanner refuses to take a frame that
 * already drifts, and says why, instead of letting the person finish and fail.
 *
 * Calibration (real MediaPipe and InsightFace on the same 56 transformed photos, TuningModelLog.md):
 * yaw, roll and face-size changes read 1:1 in both models, pitch reads about 1.3x larger in the
 * Backend, and the two models disagree by about 0.06 on small yaw changes. The limits below keep
 * about one such disagreement of margin under the Backend's.
 *
 * Pitch 0.09 -> 0.05 (real phone data 2026-11-15, round two): the strongest predictor of a low
 * Backend PAD live score was the head-pitch change of still frames 2/3 against frame 1 (Spearman
 * rho -0.67); PAD-failed sets had Backend pitch deltas of about 0.08-0.17, successes mostly < 0.05.
 * The gate already compares every candidate with the FIRST kept frame, so deltas above 0.12 in the
 * Backend leaked through model disagreement, not through a missing comparison. 0.05 MediaPipe is
 * about 0.065 in Backend units. UNMEASURED trade-off: a phone whose pitch jitter is large may need
 * more candidates (see the 9 fps sampling simulation in scripts/test-scan-robustness.mts).
 */
export const PASSIVE_POSE_LIMITS = Object.freeze({
  yaw: 0.08,
  pitch: 0.05,
  roll: 0.12,
  scale: 0.15,
  center: 0.22,
  /**
   * Continuous mismatch after which the set restarts with the pose-specific message. Must fire
   * before the 1800 ms gap guard (HYBRID_TIMING_LIMITS.maxSampleGapMs): the mismatch can only start
   * one sample interval (450 ms) after the last kept frame, so 450 + 1200 = 1650 ms < 1800 ms. At
   * 2500 ms it could never fire (the gap guard always restarted first, with a less specific message).
   */
  restartAfterMs: 1_200,
});

export type PassivePoseProblem = 'yaw' | 'pitch' | 'roll' | 'scale' | 'center';

export const PASSIVE_POSE_MESSAGES: Record<PassivePoseProblem, string> = {
  yaw: 'หันหน้าตรงที่กล้อง อย่าหันซ้ายหรือขวา',
  pitch: 'ถือโทรศัพท์ให้ระดับสายตา อย่าก้มหรือเงยหน้า',
  roll: 'ถือโทรศัพท์และศีรษะให้ตรง อย่าเอียง',
  scale: 'ถือโทรศัพท์ให้นิ่ง อย่าขยับเข้าใกล้หรือถอยห่างจากกล้อง',
  center: 'ให้ใบหน้าอยู่กลางกรอบ',
};
export const PASSIVE_RESTART_MESSAGE = 'ท่าทางเปลี่ยนไปมาก เริ่มเก็บภาพใหม่ ถือโทรศัพท์ให้นิ่งและมองตรง';

/** The first condition that keeps `candidate` from matching the pose of `reference`, or null. */
export function passivePoseProblem(
  reference: LivenessObservation,
  candidate: LivenessObservation,
): PassivePoseProblem | null {
  const limits = PASSIVE_POSE_LIMITS;
  if (Math.abs(candidate.yaw - reference.yaw) > limits.yaw) return 'yaw';
  if (Math.abs(candidate.pitch - reference.pitch) > limits.pitch) return 'pitch';
  if (Math.abs((candidate.roll ?? 0) - (reference.roll ?? 0)) > limits.roll) return 'roll';
  if (Math.abs(candidate.faceWidthRatio / Math.max(reference.faceWidthRatio, 0.001) - 1) > limits.scale) return 'scale';
  if (candidate.centerOffset > limits.center) return 'center';
  return null;
}

export interface PassivePoseVerdict {
  accept: boolean;
  problem: PassivePoseProblem | null;
  /** True when the person kept drifting: the caller must discard the frames taken so far. */
  restart: boolean;
}

/**
 * Decides, for each candidate still frame, whether it matches the first accepted one. A person who
 * settles into a new steady pose after a movement is not stuck: after `restartAfterMs` of
 * continuous mismatch the reference is dropped and collection starts again.
 */
export class PassivePoseGate {
  private reference: LivenessObservation | null = null;
  private mismatchSince: number | null = null;

  evaluate(candidate: LivenessObservation): PassivePoseVerdict {
    if (!this.reference) return { accept: true, problem: null, restart: false };
    const problem = passivePoseProblem(this.reference, candidate);
    if (!problem) {
      this.mismatchSince = null;
      return { accept: true, problem: null, restart: false };
    }
    this.mismatchSince ??= candidate.timestampMs;
    if (candidate.timestampMs - this.mismatchSince >= PASSIVE_POSE_LIMITS.restartAfterMs) {
      this.reset();
      return { accept: false, problem, restart: true };
    }
    return { accept: false, problem, restart: false };
  }

  /** Call when the frame was kept; the first kept frame becomes the reference. */
  commit(candidate: LivenessObservation): void {
    this.reference ??= candidate;
    this.mismatchSince = null;
  }

  reset(): void {
    this.reference = null;
    this.mismatchSince = null;
  }
}

/**
 * Frame rate the Backend accepts (MIN_EFFECTIVE_FPS in liveness_service.py). The scanner measures it
 * the same way (frames the model finished, first to last) and stops on its own instead of sending
 * a scan the Backend is certain to refuse.
 */
export const MIN_ATTEMPT_FPS = 8;
/** Early stop: only after enough evidence, and below a lower floor, because the first frames are slow. */
export const EARLY_FPS_FLOOR = 6;
export const EARLY_FPS_MIN_FRAMES = 24;
export const EARLY_FPS_MIN_MS = 3_000;

export function measuredFps(timestamps: readonly number[]): number {
  if (timestamps.length < 2) return 0;
  const span = timestamps[timestamps.length - 1] - timestamps[0];
  return span > 0 ? ((timestamps.length - 1) * 1000) / span : 0;
}

export function slowCameraMessage(fps: number): string {
  return `เครื่องประมวลผลภาพได้เพียง ${fps.toFixed(1)} เฟรมต่อวินาที (ต้องไม่ต่ำกว่า ${MIN_ATTEMPT_FPS}) `
    + 'กรุณาปิดแอปอื่นที่เปิดอยู่ ชาร์จหรือพักเครื่อง อยู่ในที่สว่าง แล้วลองใหม่ หากยังไม่ได้ให้ใช้โทรศัพท์เครื่องอื่น';
}

/** A message when the scan can no longer reach the Backend's frame-rate floor, otherwise null. */
export function fpsProblem(timestamps: readonly number[], stage: 'early' | 'final'): string | null {
  const fps = measuredFps(timestamps);
  if (stage === 'final') return fps < MIN_ATTEMPT_FPS ? slowCameraMessage(fps) : null;
  if (timestamps.length < EARLY_FPS_MIN_FRAMES) return null;
  const span = timestamps[timestamps.length - 1] - timestamps[0];
  return span >= EARLY_FPS_MIN_MS && fps < EARLY_FPS_FLOOR ? slowCameraMessage(fps) : null;
}

export type HybridMonitorEvent = 'waiting' | 'action_captured' | 'recovered';

/**
 * Frame-by-frame state machine for the one random action of the hybrid challenge. The scanner and
 * the tests share it, so the simulated blink profiles exercise exactly the code that runs on the phone.
 *
 * move_closer: two consecutive frames in range; the second one is the action frame.
 *
 * blink: a closure episode runs while both lids are down. Among its frames the monitor keeps the
 * DEEPEST deep frame (lowest max(left, right) aperture ratio); that frame, not the first one, is the
 * action frame that is uploaded. The action is committed when the eyes reopen or after `maxHoldMs`,
 * whichever comes first, and only when the episode lasted `minClosedFrames` frames or `minClosedMs`
 * and had `minDeepFrames` deep frames; a shorter episode (a one-frame spike) is dropped.
 *
 * After every `feed`, `keepCurrentFrame` says whether the frame just fed became the action frame
 * candidate (the caller keeps its image and releases the previous one) and `hasCandidate` whether a
 * candidate is still held. After 'action_captured', `actionTimestampMs` is the action frame's time.
 *
 * Then two consecutive frames must show the face back in its normal state.
 */
export class HybridActionMonitor {
  private phase: 'action' | 'recovery' = 'action';
  private actionFrames = 0;
  private recoveryFrames = 0;
  private episodeStartMs: number | null = null;
  private lastEpisodeMs = 0;
  private episodeFrames = 0;
  private deepFrames = 0;
  private deepest: LivenessObservation | null = null;
  private deepestDepth = Infinity;
  private committed: LivenessObservation | null = null;
  private keepCurrent = false;

  private readonly action: HybridLivenessAction;
  private readonly baseline: HybridLivenessBaseline;

  constructor(action: HybridLivenessAction, baseline: HybridLivenessBaseline) {
    this.action = action;
    this.baseline = baseline;
  }

  /** True when the frame passed to the last `feed` is the current action-frame candidate. */
  get keepCurrentFrame(): boolean {
    return this.keepCurrent;
  }

  /** True while a candidate action frame is held (during a closure or once committed). */
  get hasCandidate(): boolean {
    return this.deepest !== null || this.committed !== null;
  }

  /** Timestamp of the committed action frame, or null before 'action_captured'. */
  get actionTimestampMs(): number | null {
    return this.committed?.timestampMs ?? null;
  }

  private resetEpisode(): void {
    this.episodeStartMs = null;
    this.episodeFrames = 0;
    this.deepFrames = 0;
    this.deepest = null;
    this.deepestDepth = Infinity;
  }

  private episodeLongEnough(nowMs: number): boolean {
    const limits = HYBRID_BLINK_LIMITS;
    return this.deepFrames >= limits.minDeepFrames
      && (this.episodeFrames >= limits.minClosedFrames
        || nowMs - (this.episodeStartMs ?? nowMs) >= limits.minClosedMs);
  }

  private commit(): HybridMonitorEvent {
    this.committed = this.deepest;
    this.resetEpisode();
    this.phase = 'recovery';
    return 'action_captured';
  }

  private feedBlink(observation: LivenessObservation): HybridMonitorEvent {
    const closure = blinkClosure(observation, this.baseline);
    if (closure === 'open') {
      // The eyes reopened (or the head moved): commit the deepest frame if the closure was real.
      if (this.episodeStartMs !== null && this.episodeLongEnough(this.lastEpisodeMs)) return this.commit();
      this.resetEpisode();
      return 'waiting';
    }
    this.episodeStartMs ??= observation.timestampMs;
    this.episodeFrames += 1;
    this.lastEpisodeMs = observation.timestampMs;
    if (closure === 'deep') {
      this.deepFrames += 1;
      const { left, right } = blinkRatios(observation, this.baseline);
      const depth = Math.max(left, right);
      if (depth < this.deepestDepth) {
        this.deepest = observation;
        this.deepestDepth = depth;
        this.keepCurrent = true;
      }
    }
    if (
      observation.timestampMs - this.episodeStartMs >= HYBRID_BLINK_LIMITS.maxHoldMs
      && this.episodeLongEnough(observation.timestampMs)
    ) {
      return this.commit();
    }
    return 'waiting';
  }

  feed(observation: LivenessObservation): HybridMonitorEvent {
    this.keepCurrent = false;
    if (this.phase === 'action') {
      if (this.action === 'blink') return this.feedBlink(observation);
      this.actionFrames = hybridActionDetected(this.action, observation, this.baseline)
        ? this.actionFrames + 1
        : 0;
      if (this.actionFrames >= HYBRID_BLINK_LIMITS.actionFrames) {
        this.committed = observation;
        this.keepCurrent = true;
        this.phase = 'recovery';
        return 'action_captured';
      }
      return 'waiting';
    }
    this.recoveryFrames = hybridRecoveryDetected(observation, this.baseline, this.action)
      ? this.recoveryFrames + 1
      : 0;
    return this.recoveryFrames >= 2 ? 'recovered' : 'waiting';
  }
}

export type LivenessFrameKind =
  | 'baseline_open'
  | 'near'
  | 'returned'
  | 'blink_closed'
  | 'blink_open'
  | 'final_open';

export interface LivenessObservation {
  timestampMs: number;
  faceCount: number;
  leftEar: number;
  rightEar: number;
  leftBlinkScore: number;
  rightBlinkScore: number;
  yaw: number;
  pitch: number;
  /** Head tilt: eye-line slope (0 = level). Optional so older fixtures without it still type-check. */
  roll?: number;
  faceWidthRatio: number;
  centerOffset: number;
  /** Face centre in normalised frame coordinates (0-1); optional so older fixtures still type-check. */
  faceCenterX?: number;
  faceCenterY?: number;
}

export interface LivenessFrameMarker {
  kind: LivenessFrameKind;
  timestampMs: number;
  blinkIndex?: number;
}

export interface MoveCloserEvent {
  action: 'move_closer';
  startedAtMs: number;
  peakAtMs: number;
  completedAtMs: number;
  baselineScale: number;
  peakScale: number;
  returnedScale: number;
}

export interface BlinkEvent {
  action: 'blink';
  blinkIndex: number;
  closedAtMs: number;
  reopenedAtMs: number;
  durationMs: number;
  minLeftEyeRatio: number;
  minRightEyeRatio: number;
}

export interface LivenessEvidence {
  version: 2;
  actions: LivenessAction[];
  requiredBlinks: number;
  promptDelayMs: number;
  movement: MoveCloserEvent;
  blinks: BlinkEvent[];
  frames: LivenessFrameMarker[];
  startedAtMs: number;
  promptAtMs: number;
  completedAtMs: number;
  effectiveFps: number;
}

export interface LivenessStep {
  instruction: string;
  progress: number;
  captures: LivenessFrameMarker[];
  completed: boolean;
  failed?: boolean;
  evidence?: LivenessEvidence;
}

export interface FaceLandmarkerPoint {
  x: number;
  y: number;
}

export interface FaceBlendshapeCategory {
  categoryName: string;
  score: number;
}

/**
 * Device-side usability tuning. The backend independently recomputes all
 * security-sensitive geometry from the submitted evidence frames.
 *
 * These values deliberately tolerate variable-FPS phone bridges such as
 * Iriun and ordinary notebook webcams, while still requiring one face,
 * forward/back movement, bilateral closure, reopening, and a stable final
 * frame. Do not remove the corresponding backend checks when tuning these.
 */
export const LIVENESS_TRACKER_LIMITS = Object.freeze({
  calibrationFrames: 10,
  maxBadQualityFrames: 8,
  minEffectiveFps: 8,
  maxAttemptDurationMs: 45_000,
  maxBlinkWindowMs: 8_000,
  minMovementScaleRatio: 1.08,
  maxMovementScaleRatio: 1.80,
  returnScaleTolerance: 0.15,
  finalScaleTolerance: 0.18,
  centerOffset: 0.30,
  yawTolerance: 0.12,
  pitchTolerance: 0.15,
  closedEyeRatio: 0.74,
  reopenEyeRatio: 0.80,
  closedBlendshape: 0.32,
  openBlendshape: 0.40,
  minBlinkDurationMs: 60,
  maxBlinkDurationMs: 900,
  stableFrames: 2,
});

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Distance in frame-HEIGHT units. MediaPipe normalises x by the frame width and y by the height, so
 * a raw hypot would stretch x by height/width; scaling x by `aspectRatio` (width / height) undoes that.
 */
function distance(p1: FaceLandmarkerPoint, p2: FaceLandmarkerPoint, aspectRatio: number): number {
  return Math.hypot((p1.x - p2.x) * aspectRatio, p1.y - p2.y);
}

/**
 * Eye aspect ratio in TRUE geometric units (the same scale as the Backend's 68-point proxy).
 * Before 2026-11-15 it was measured on raw normalised coordinates, which made it EAR_true x
 * (width / height): about 0.56x on a 9:16 portrait phone and 1.33-1.78x on a landscape laptop, so
 * the absolute limits (wideEar / narrowEar / narrowFallbackEar / MIN_READABLE_EAR) meant different
 * eyes on different devices. Ratios (closed / open) were and are unaffected.
 */
function eyeAspectRatio(landmarks: FaceLandmarkerPoint[], indices: number[], aspectRatio: number): number {
  const points = indices.map((index) => landmarks[index]);
  if (points.some((point) => !point)) return 0;
  const [p1, p2, p3, p4, p5, p6] = points;
  return (distance(p2, p6, aspectRatio) + distance(p3, p5, aspectRatio))
    / Math.max(2 * distance(p1, p4, aspectRatio), 0.0001);
}

/** Convert MediaPipe Face Landmarker output into the small, testable tracker contract. */
export function observationFromLandmarker(
  faces: FaceLandmarkerPoint[][],
  blendshapes: FaceBlendshapeCategory[][],
  timestampMs: number,
  aspectRatio = 1,
): LivenessObservation {
  const landmarks = faces[0];
  if (!landmarks) {
    return {
      timestampMs,
      faceCount: 0,
      leftEar: 0,
      rightEar: 0,
      leftBlinkScore: 0,
      rightBlinkScore: 0,
      yaw: 0,
      pitch: 0,
      faceWidthRatio: 0,
      centerOffset: 1,
    };
  }

  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const nose = landmarks[1];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const mouth = landmarks[13];
  if (!leftCheek || !rightCheek || !nose || !leftEye || !rightEye || !mouth) {
    return {
      timestampMs,
      faceCount: faces.length,
      leftEar: 0,
      rightEar: 0,
      leftBlinkScore: 0,
      rightBlinkScore: 0,
      yaw: 0,
      pitch: 0,
      faceWidthRatio: 0,
      centerOffset: 1,
    };
  }

  const scores = new Map(
    (blendshapes[0] ?? []).map((category) => [category.categoryName, category.score]),
  );
  const faceWidth = Math.max(Math.abs(rightCheek.x - leftCheek.x), 0.0001);
  const faceCenterX = (leftCheek.x + rightCheek.x) / 2;
  const eyeMidY = (leftEye.y + rightEye.y) / 2;
  // Landmarks are normalised by the frame width and height separately, so the eye line is measured
  // in height units (x is scaled by width/height) to get a true slope on a 4:3 or 16:9 frame.
  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const eyeDx = (rightEye.x - leftEye.x) * safeAspect;
  const eyeDy = rightEye.y - leftEye.y;
  const roll = eyeDy / Math.max(Math.hypot(eyeDx, eyeDy), 0.0001);

  return {
    timestampMs,
    faceCount: faces.length,
    leftEar: eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380], safeAspect),
    rightEar: eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144], safeAspect),
    leftBlinkScore: scores.get('eyeBlinkLeft') ?? 0,
    rightBlinkScore: scores.get('eyeBlinkRight') ?? 0,
    yaw: (nose.x - faceCenterX) / faceWidth,
    pitch: (nose.y - eyeMidY) / Math.max(mouth.y - eyeMidY, 0.0001),
    roll,
    faceWidthRatio: faceWidth,
    centerOffset: Math.abs(faceCenterX - 0.5),
    faceCenterX,
    faceCenterY: (eyeMidY + mouth.y) / 2,
  };
}

type Phase = 'calibrating' | 'move_near' | 'return' | 'wait_prompt' | 'blink' | 'final' | 'complete';

export class LivenessTracker {
  private readonly actions: LivenessAction[];
  private readonly requiredBlinks: number;
  private readonly promptDelayMs: number;
  private readonly calibration: LivenessObservation[] = [];
  private readonly blinks: BlinkEvent[] = [];
  private readonly frames: LivenessFrameMarker[] = [];
  private readonly observedTimestamps: number[] = [];
  private phase: Phase = 'calibrating';
  private baselineLeftEar = 0;
  private baselineRightEar = 0;
  private baselineYaw = 0;
  private baselinePitch = 0;
  private baselineScale = 0;
  private startedAtMs = 0;
  private nearStartedAtMs: number | null = null;
  private nearStableFrames = 0;
  private peakScale = 0;
  private peakAtMs = 0;
  private returnStableFrames = 0;
  private returnedAtMs = 0;
  private returnedScale = 0;
  private promptAtMs = 0;
  private blinkStartedAtMs: number | null = null;
  private blinkClosedFrames = 0;
  private blinkMinLeftRatio = 1;
  private blinkMinRightRatio = 1;
  private finalStableFrames = 0;
  private badQualityFrames = 0;

  constructor(actions: LivenessAction[], requiredBlinks: number, promptDelayMs: number) {
    if (
      actions.length !== 2
      || actions[0] !== 'move_closer'
      || actions[1] !== 'blink'
      || !Number.isInteger(requiredBlinks)
      || requiredBlinks < 1
      || requiredBlinks > 2
      || !Number.isInteger(promptDelayMs)
      || promptDelayMs < 300
      || promptDelayMs > 1_500
    ) {
      throw new Error('ข้อมูล challenge สำหรับ liveness ไม่ถูกต้อง');
    }
    this.actions = [...actions];
    this.requiredBlinks = requiredBlinks;
    this.promptDelayMs = promptDelayMs;
  }

  private qualityOk(observation: LivenessObservation): boolean {
    return observation.faceCount === 1
      && observation.faceWidthRatio >= 0.18
      && observation.faceWidthRatio <= 0.84
      && observation.centerOffset <= LIVENESS_TRACKER_LIMITS.centerOffset
      && observation.leftEar > 0.08
      && observation.rightEar > 0.08;
  }

  private resetAll(): void {
    this.calibration.splice(0);
    this.blinks.splice(0);
    this.frames.splice(0);
    this.observedTimestamps.splice(0);
    this.phase = 'calibrating';
    this.baselineLeftEar = 0;
    this.baselineRightEar = 0;
    this.baselineYaw = 0;
    this.baselinePitch = 0;
    this.baselineScale = 0;
    this.startedAtMs = 0;
    this.nearStartedAtMs = null;
    this.nearStableFrames = 0;
    this.peakScale = 0;
    this.peakAtMs = 0;
    this.returnStableFrames = 0;
    this.returnedAtMs = 0;
    this.returnedScale = 0;
    this.promptAtMs = 0;
    this.resetBlink();
    this.finalStableFrames = 0;
    this.badQualityFrames = 0;
  }

  private resetBlink(): void {
    this.blinkStartedAtMs = null;
    this.blinkClosedFrames = 0;
    this.blinkMinLeftRatio = 1;
    this.blinkMinRightRatio = 1;
  }

  private marker(kind: LivenessFrameKind, observation: LivenessObservation, blinkIndex?: number): LivenessFrameMarker {
    const marker: LivenessFrameMarker = { kind, timestampMs: observation.timestampMs };
    if (blinkIndex !== undefined) marker.blinkIndex = blinkIndex;
    this.frames.push(marker);
    return marker;
  }

  private step(instruction: string, progress: number, captures: LivenessFrameMarker[] = []): LivenessStep {
    return { instruction, progress, captures, completed: false };
  }

  add(observation: LivenessObservation): LivenessStep {
    if (this.phase === 'complete') return this.step('ตรวจสอบ liveness สำเร็จ', 1);

    this.observedTimestamps.push(observation.timestampMs);
    if (this.observedTimestamps.length > 120) this.observedTimestamps.shift();

    if (!this.qualityOk(observation)) {
      this.badQualityFrames += 1;
      if (
        this.phase !== 'calibrating'
        && this.badQualityFrames > LIVENESS_TRACKER_LIMITS.maxBadQualityFrames
      ) {
        this.resetAll();
      }
      return this.step(
        observation.faceCount > 1
          ? 'พบมากกว่า 1 ใบหน้า กรุณาอยู่ในเฟรมเพียงคนเดียว'
          : 'จัดใบหน้าให้อยู่กลางกรอบ เห็นใบหน้าชัดเจนเพียง 1 คน',
        0,
      );
    }
    this.badQualityFrames = 0;

    if (this.phase === 'calibrating') {
      const eyesOpen = observation.leftBlinkScore <= LIVENESS_TRACKER_LIMITS.openBlendshape
        && observation.rightBlinkScore <= LIVENESS_TRACKER_LIMITS.openBlendshape;
      if (!eyesOpen) return this.step('ลืมตาและมองตรงเพื่อปรับเทียบดวงตา', 0.04);
      this.calibration.push(observation);
      if (this.calibration.length < LIVENESS_TRACKER_LIMITS.calibrationFrames) {
        return this.step('วางใบหน้าให้อยู่ในกรอบ มองตรงและอยู่นิ่ง', 0.10);
      }

      this.baselineLeftEar = median(this.calibration.map((item) => item.leftEar));
      this.baselineRightEar = median(this.calibration.map((item) => item.rightEar));
      this.baselineYaw = median(this.calibration.map((item) => item.yaw));
      this.baselinePitch = median(this.calibration.map((item) => item.pitch));
      this.baselineScale = median(this.calibration.map((item) => item.faceWidthRatio));
      this.startedAtMs = observation.timestampMs;
      this.phase = 'move_near';
      return this.step(
        'ค่อย ๆ ขยับใบหน้าเข้าใกล้กล้อง',
        0.20,
        [this.marker('baseline_open', observation)],
      );
    }

    const yawDelta = observation.yaw - this.baselineYaw;
    const pitchDelta = observation.pitch - this.baselinePitch;
    const leftEyeRatio = observation.leftEar / Math.max(this.baselineLeftEar, 0.001);
    const rightEyeRatio = observation.rightEar / Math.max(this.baselineRightEar, 0.001);
    const headStable = Math.abs(yawDelta) <= LIVENESS_TRACKER_LIMITS.yawTolerance
      && Math.abs(pitchDelta) <= LIVENESS_TRACKER_LIMITS.pitchTolerance;
    const eyesOpen = leftEyeRatio >= LIVENESS_TRACKER_LIMITS.reopenEyeRatio
      && rightEyeRatio >= LIVENESS_TRACKER_LIMITS.reopenEyeRatio
      && observation.leftBlinkScore <= LIVENESS_TRACKER_LIMITS.openBlendshape
      && observation.rightBlinkScore <= LIVENESS_TRACKER_LIMITS.openBlendshape;

    if (this.phase === 'move_near') {
      const scaleRatio = observation.faceWidthRatio / Math.max(this.baselineScale, 0.001);
      if (
        scaleRatio >= LIVENESS_TRACKER_LIMITS.minMovementScaleRatio
        && scaleRatio <= LIVENESS_TRACKER_LIMITS.maxMovementScaleRatio
        && headStable
      ) {
        this.nearStartedAtMs ??= observation.timestampMs;
        this.nearStableFrames += 1;
        if (observation.faceWidthRatio > this.peakScale) {
          this.peakScale = observation.faceWidthRatio;
          this.peakAtMs = observation.timestampMs;
        }
        if (this.nearStableFrames >= LIVENESS_TRACKER_LIMITS.stableFrames) {
          this.phase = 'return';
          return this.step('ดีมาก ถอยกลับมาวางใบหน้าในกรอบเดิม', 0.40, [this.marker('near', observation)]);
        }
      } else {
        this.nearStartedAtMs = null;
        this.nearStableFrames = 0;
      }
      return this.step('ค่อย ๆ ขยับใบหน้าเข้าใกล้กล้อง', 0.28);
    }

    if (this.phase === 'return') {
      const returned = Math.abs(observation.faceWidthRatio / this.baselineScale - 1)
          <= LIVENESS_TRACKER_LIMITS.returnScaleTolerance
        && headStable
        && eyesOpen;
      this.returnStableFrames = returned ? this.returnStableFrames + 1 : 0;
      if (
        this.returnStableFrames >= LIVENESS_TRACKER_LIMITS.stableFrames
        && this.nearStartedAtMs !== null
      ) {
        this.returnedAtMs = observation.timestampMs;
        this.returnedScale = observation.faceWidthRatio;
        this.promptAtMs = observation.timestampMs + this.promptDelayMs;
        this.phase = 'wait_prompt';
        return this.step('อยู่นิ่งและรอคำสั่งกระพริบตา', 0.55, [this.marker('returned', observation)]);
      }
      return this.step('ถอยกลับจนใบหน้าพอดีกับกรอบเดิม', 0.48);
    }

    if (this.phase === 'wait_prompt') {
      if (observation.timestampMs < this.promptAtMs) {
        return this.step('อยู่นิ่งและรอคำสั่งกระพริบตา', 0.56);
      }
      this.phase = 'blink';
    }

    if (this.phase === 'blink') {
      if (observation.timestampMs - this.promptAtMs > LIVENESS_TRACKER_LIMITS.maxBlinkWindowMs) {
        return {
          ...this.step('ไม่พบการกระพริบตาภายในเวลาที่กำหนด กรุณาเริ่มใหม่', 0.58),
          failed: true,
        };
      }

      const bothClosed = leftEyeRatio <= LIVENESS_TRACKER_LIMITS.closedEyeRatio
        && rightEyeRatio <= LIVENESS_TRACKER_LIMITS.closedEyeRatio
        && observation.leftBlinkScore >= LIVENESS_TRACKER_LIMITS.closedBlendshape
        && observation.rightBlinkScore >= LIVENESS_TRACKER_LIMITS.closedBlendshape
        && headStable;
      const blinkIndex = this.blinks.length + 1;
      if (bothClosed) {
        this.blinkStartedAtMs ??= observation.timestampMs;
        this.blinkClosedFrames += 1;
        this.blinkMinLeftRatio = Math.min(this.blinkMinLeftRatio, leftEyeRatio);
        this.blinkMinRightRatio = Math.min(this.blinkMinRightRatio, rightEyeRatio);
        if (this.blinkClosedFrames === LIVENESS_TRACKER_LIMITS.stableFrames) {
          return this.step(
            'ตรวจพบว่าหลับตาแล้ว กรุณาลืมตา',
            0.64 + (this.blinks.length / this.requiredBlinks) * 0.20,
            [this.marker('blink_closed', observation, blinkIndex)],
          );
        }
      } else if (this.blinkStartedAtMs !== null && eyesOpen && headStable) {
        const durationMs = observation.timestampMs - this.blinkStartedAtMs;
        if (
          this.blinkClosedFrames >= LIVENESS_TRACKER_LIMITS.stableFrames
          && durationMs >= LIVENESS_TRACKER_LIMITS.minBlinkDurationMs
          && durationMs <= LIVENESS_TRACKER_LIMITS.maxBlinkDurationMs
        ) {
          this.blinks.push({
            action: 'blink',
            blinkIndex,
            closedAtMs: this.blinkStartedAtMs,
            reopenedAtMs: observation.timestampMs,
            durationMs,
            minLeftEyeRatio: this.blinkMinLeftRatio,
            minRightEyeRatio: this.blinkMinRightRatio,
          });
          const capture = this.marker('blink_open', observation, blinkIndex);
          this.resetBlink();
          if (this.blinks.length >= this.requiredBlinks) {
            this.phase = 'final';
            return this.step('มองตรงและอยู่นิ่งเพื่อถ่ายภาพยืนยัน', 0.90, [capture]);
          }
          return this.step(`กระพริบตาทั้งสองข้างอีก ${this.requiredBlinks - this.blinks.length} ครั้ง`, 0.76, [capture]);
        }
        this.resetBlink();
      } else if (
        this.blinkStartedAtMs !== null
        && observation.timestampMs - this.blinkStartedAtMs
          > LIVENESS_TRACKER_LIMITS.maxBlinkDurationMs
      ) {
        this.resetBlink();
      }

      const remaining = this.requiredBlinks - this.blinks.length;
      return this.step(`กระพริบตาทั้งสองข้าง ${remaining} ครั้ง โดยไม่ผงกศีรษะ`, 0.62);
    }

    if (this.phase === 'final') {
      const finalOk = headStable
        && eyesOpen
        && Math.abs(observation.faceWidthRatio / this.baselineScale - 1)
          <= LIVENESS_TRACKER_LIMITS.finalScaleTolerance;
      this.finalStableFrames = finalOk ? this.finalStableFrames + 1 : 0;
      if (this.finalStableFrames < LIVENESS_TRACKER_LIMITS.stableFrames) {
        return this.step('มองตรง ลืมตา และวางใบหน้าให้พอดีกับกรอบ', 0.94);
      }

      const elapsed = observation.timestampMs - this.startedAtMs;
      const firstTimestamp = this.observedTimestamps[0] ?? observation.timestampMs;
      const measuredDuration = observation.timestampMs - firstTimestamp;
      const effectiveFps = measuredDuration > 0
        ? ((this.observedTimestamps.length - 1) * 1000) / measuredDuration
        : 0;
      if (
        effectiveFps < LIVENESS_TRACKER_LIMITS.minEffectiveFps
        || elapsed > LIVENESS_TRACKER_LIMITS.maxAttemptDurationMs
      ) {
        return {
          ...this.step('อัตราภาพจากกล้องต่ำหรือใช้เวลานานเกินไป กรุณาเริ่มใหม่ในที่สว่าง', 0.94),
          failed: true,
        };
      }

      const finalMarker = this.marker('final_open', observation);
      const movement: MoveCloserEvent = {
        action: 'move_closer',
        startedAtMs: this.nearStartedAtMs ?? this.startedAtMs,
        peakAtMs: this.peakAtMs,
        completedAtMs: this.returnedAtMs,
        baselineScale: this.baselineScale,
        peakScale: this.peakScale,
        returnedScale: this.returnedScale,
      };
      const evidence: LivenessEvidence = {
        version: 2,
        actions: [...this.actions],
        requiredBlinks: this.requiredBlinks,
        promptDelayMs: this.promptDelayMs,
        movement,
        blinks: [...this.blinks],
        frames: [...this.frames],
        startedAtMs: this.startedAtMs,
        promptAtMs: this.promptAtMs,
        completedAtMs: observation.timestampMs,
        effectiveFps: Number(effectiveFps.toFixed(2)),
      };
      this.phase = 'complete';
      return {
        instruction: 'ตรวจสอบ liveness สำเร็จ',
        progress: 1,
        captures: [finalMarker],
        completed: true,
        evidence,
      };
    }

    return this.step('กำลังตรวจสอบ liveness', 0.95);
  }
}
