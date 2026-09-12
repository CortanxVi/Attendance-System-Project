export type LivenessAction = 'move_closer' | 'blink';

export interface PassiveLivenessEvidence {
  version: 3;
  mode: 'passive';
  sampleCount: 3;
  frames: Array<{ kind: 'passive_sample'; sampleIndex: number; timestampMs: number }>;
  startedAtMs: number;
  completedAtMs: number;
  effectiveFps: number;
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
  faceWidthRatio: number;
  centerOffset: number;
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

function distance(p1: FaceLandmarkerPoint, p2: FaceLandmarkerPoint): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function eyeAspectRatio(landmarks: FaceLandmarkerPoint[], indices: number[]): number {
  const points = indices.map((index) => landmarks[index]);
  if (points.some((point) => !point)) return 0;
  const [p1, p2, p3, p4, p5, p6] = points;
  return (distance(p2, p6) + distance(p3, p5))
    / Math.max(2 * distance(p1, p4), 0.0001);
}

/** Convert MediaPipe Face Landmarker output into the small, testable tracker contract. */
export function observationFromLandmarker(
  faces: FaceLandmarkerPoint[][],
  blendshapes: FaceBlendshapeCategory[][],
  timestampMs: number,
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

  return {
    timestampMs,
    faceCount: faces.length,
    leftEar: eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380]),
    rightEar: eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144]),
    leftBlinkScore: scores.get('eyeBlinkLeft') ?? 0,
    rightBlinkScore: scores.get('eyeBlinkRight') ?? 0,
    yaw: (nose.x - faceCenterX) / faceWidth,
    pitch: (nose.y - eyeMidY) / Math.max(mouth.y - eyeMidY, 0.0001),
    faceWidthRatio: faceWidth,
    centerOffset: Math.abs(faceCenterX - 0.5),
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
