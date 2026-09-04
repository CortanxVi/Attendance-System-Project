export type LivenessAction = 'blink' | 'turn_left' | 'turn_right';

export interface LivenessObservation {
  timestampMs: number;
  faceCount: number;
  leftEar: number;
  rightEar: number;
  yaw: number;
  pitch: number;
  faceWidthRatio: number;
  centerOffset: number;
}

export interface LivenessEvent {
  action: LivenessAction;
  durationMs: number;
  eyeRatio: number;
  yawDelta: number;
  pitchDelta: number;
}

export interface LivenessEvidence {
  version: 1;
  actions: LivenessAction[];
  events: LivenessEvent[];
  startedAtMs: number;
  completedAtMs: number;
}

export interface LivenessStep {
  instruction: string;
  progress: number;
  captureTurn: boolean;
  captureBlink: boolean;
  completed: boolean;
  evidence?: LivenessEvidence;
}

const CALIBRATION_FRAMES = 12;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function actionInstruction(action: LivenessAction): string {
  if (action === 'blink') return 'มองตรงแล้วกะพริบตาทั้งสองข้าง 1 ครั้ง';
  return action === 'turn_left'
    ? 'หันหน้าไปทางซ้ายตามลูกศร แล้วกลับมามองตรง'
    : 'หันหน้าไปทางขวาตามลูกศร แล้วกลับมามองตรง';
}

export class LivenessTracker {
  private readonly actions: LivenessAction[];
  private readonly calibration: LivenessObservation[] = [];
  private readonly events: LivenessEvent[] = [];
  private baselineEar = 0;
  private baselineYaw = 0;
  private baselinePitch = 0;
  private actionIndex = 0;
  private startedAtMs = 0;
  private blinkStartedAt: number | null = null;
  private blinkClosedFrames = 0;
  private turnStartedAt: number | null = null;
  private turnCapturedAt: number | null = null;
  private turnPeakYaw = 0;
  private returnFrames = 0;
  private completionFrames = 0;

  constructor(actions: LivenessAction[]) {
    const valid = actions.length === 2
      && actions.includes('blink')
      && actions.filter((action) => action.startsWith('turn_')).length === 1;
    if (!valid) throw new Error('ลำดับ liveness ไม่ถูกต้อง');
    this.actions = [...actions];
  }

  private resetTransient(): void {
    this.blinkStartedAt = null;
    this.blinkClosedFrames = 0;
    this.turnStartedAt = null;
    this.turnCapturedAt = null;
    this.turnPeakYaw = 0;
    this.returnFrames = 0;
  }

  private resetSequence(): void {
    this.calibration.splice(0);
    this.events.splice(0);
    this.baselineEar = 0;
    this.baselineYaw = 0;
    this.baselinePitch = 0;
    this.actionIndex = 0;
    this.startedAtMs = 0;
    this.completionFrames = 0;
    this.resetTransient();
  }

  add(observation: LivenessObservation): LivenessStep {
    const qualityOk = observation.faceCount === 1
      && observation.faceWidthRatio >= 0.22
      && observation.faceWidthRatio <= 0.78
      && observation.centerOffset <= 0.28;
    if (!qualityOk) {
      this.resetSequence();
      return {
        instruction: observation.faceCount > 1
          ? 'พบมากกว่า 1 ใบหน้า กรุณาอยู่ในเฟรมเพียงคนเดียว'
          : 'จัดใบหน้าให้อยู่กลางกรอบ เห็นใบหน้าชัดเจนเพียง 1 คน',
        progress: this.actionIndex / this.actions.length,
        captureTurn: false,
        captureBlink: false,
        completed: false,
      };
    }

    if (this.calibration.length < CALIBRATION_FRAMES) {
      this.calibration.push(observation);
      if (this.calibration.length === CALIBRATION_FRAMES) {
        this.baselineEar = median(this.calibration.map((item) => (item.leftEar + item.rightEar) / 2));
        this.baselineYaw = median(this.calibration.map((item) => item.yaw));
        this.baselinePitch = median(this.calibration.map((item) => item.pitch));
        this.startedAtMs = observation.timestampMs;
      }
      return {
        instruction: 'มองตรงและอยู่นิ่ง กำลังปรับเทียบใบหน้า',
        progress: 0,
        captureTurn: false,
        captureBlink: false,
        completed: false,
      };
    }

    const yawDelta = observation.yaw - this.baselineYaw;
    const pitchDelta = observation.pitch - this.baselinePitch;
    const leftEyeRatio = observation.leftEar / Math.max(this.baselineEar, 0.001);
    const rightEyeRatio = observation.rightEar / Math.max(this.baselineEar, 0.001);
    const currentAction = this.actions[this.actionIndex];

    if (!currentAction) {
      if (Math.abs(yawDelta) <= 0.055 && Math.abs(pitchDelta) <= 0.08) this.completionFrames += 1;
      else this.completionFrames = 0;
      if (this.completionFrames < 3) {
        return {
          instruction: 'กลับมามองตรงเพื่อถ่ายภาพยืนยัน',
          progress: 0.95,
          captureTurn: false,
          captureBlink: false,
          completed: false,
        };
      }
      const evidence: LivenessEvidence = {
        version: 1,
        actions: [...this.actions],
        events: [...this.events],
        startedAtMs: this.startedAtMs,
        completedAtMs: observation.timestampMs,
      };
      return { instruction: 'ตรวจสอบ liveness สำเร็จ', progress: 1, captureTurn: false, captureBlink: false, completed: true, evidence };
    }

    if (currentAction === 'blink') {
      const bothClosed = leftEyeRatio <= 0.68 && rightEyeRatio <= 0.68;
      const bothOpen = leftEyeRatio >= 0.82 && rightEyeRatio >= 0.82;
      const headStable = Math.abs(yawDelta) <= 0.08 && Math.abs(pitchDelta) <= 0.08;
      if (bothClosed && headStable) {
        this.blinkStartedAt ??= observation.timestampMs;
        this.blinkClosedFrames += 1;
        if (this.blinkClosedFrames === 2) {
          return {
            instruction: 'ตรวจพบการกะพริบตา กรุณาลืมตา',
            progress: (this.actionIndex + 0.4) / this.actions.length,
            captureTurn: false,
            captureBlink: true,
            completed: false,
          };
        }
      } else if (this.blinkStartedAt !== null && bothOpen) {
        const durationMs = observation.timestampMs - this.blinkStartedAt;
        if (this.blinkClosedFrames >= 2 && durationMs >= 60 && durationMs <= 700 && headStable) {
          this.events.push({
            action: currentAction,
            durationMs,
            eyeRatio: Math.min(leftEyeRatio, rightEyeRatio),
            yawDelta,
            pitchDelta,
          });
          this.actionIndex += 1;
          this.resetTransient();
        } else {
          this.resetTransient();
        }
      } else if (this.blinkStartedAt !== null && observation.timestampMs - this.blinkStartedAt > 700) {
        this.resetTransient();
      }
    } else {
      const direction = currentAction === 'turn_left' ? -1 : 1;
      const reachesTurn = direction * yawDelta >= 0.12 && Math.abs(pitchDelta) <= 0.10;
      if (this.turnCapturedAt === null) {
        if (reachesTurn) {
          this.turnStartedAt ??= observation.timestampMs;
          this.turnPeakYaw = Math.abs(yawDelta) > Math.abs(this.turnPeakYaw) ? yawDelta : this.turnPeakYaw;
          if (observation.timestampMs - this.turnStartedAt >= 180) {
            this.turnCapturedAt = observation.timestampMs;
            return {
              instruction: 'ดีมาก กลับมามองตรง',
              progress: (this.actionIndex + 0.7) / this.actions.length,
              captureTurn: true,
              captureBlink: false,
              completed: false,
            };
          }
        } else if (this.turnStartedAt !== null) {
          this.turnStartedAt = null;
          this.turnPeakYaw = 0;
        }
      } else {
        if (Math.abs(yawDelta) <= 0.055 && Math.abs(pitchDelta) <= 0.08) this.returnFrames += 1;
        else this.returnFrames = 0;
        if (this.returnFrames >= 3 && this.turnStartedAt !== null) {
          this.events.push({
            action: currentAction,
            durationMs: this.turnCapturedAt - this.turnStartedAt,
            eyeRatio: Math.min(leftEyeRatio, rightEyeRatio),
            yawDelta: this.turnPeakYaw,
            pitchDelta,
          });
          this.actionIndex += 1;
          this.resetTransient();
        }
      }
    }

    return {
      instruction: actionInstruction(this.actions[this.actionIndex] ?? currentAction),
      progress: this.actionIndex / this.actions.length,
      captureTurn: false,
      captureBlink: false,
      completed: false,
    };
  }
}
