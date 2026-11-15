/**
 * Picks the faster face-model engine on Android (GPU or CPU) from real scan frames.
 *
 * Real data (2026-11-15, a mid-range Android on the GPU delegate): camera 16 fps but only ~6 fps
 * processed (about 160 ms per frame), so the scan stopped below the Backend's 8 fps floor. On some
 * Mali/Adreno mid-range GPUs the WebGL path is slower than the CPU (XNNPACK) path. The Backend
 * floor is unchanged; the web only measures which engine is faster on THIS phone:
 *  1. on the GPU, skip the first SKIP_FRAMES results (shader compile) and take the median model
 *     time of the next GPU_SAMPLE_FRAMES;
 *  2. if that median is above GPU_SLOW_MEDIAN_MS (slower than ~9 fps), switch to the CPU and take
 *     a CPU median of CPU_SAMPLE_FRAMES (after SKIP_FRAMES);
 *  3. keep the faster one by DELIVERED frame rate (the GPU also needs >= GPU_MIN_CYCLE_FPS); at
 *     most one switch happens during an attempt, a switch back waits until the scanner closes;
 *     the choice is remembered on the device for CHOICE_TTL_MS.
 * All values are UNMEASURED engineering choices (no per-device timing table exists yet).
 */
export type Delegate = 'GPU' | 'CPU';

export const SKIP_FRAMES = 3;
export const GPU_SAMPLE_FRAMES = 15;
export const CPU_SAMPLE_FRAMES = 10;
export const GPU_SLOW_MEDIAN_MS = 110;
export const CHOICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CHOICE_STORAGE_KEY = 'face-delegate-choice.v1';

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return Number.NaN;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Keep the GPU only when it also delivers at least this many analysed frames per second. */
export const GPU_MIN_CYCLE_FPS = 9;

export type TunerDecision =
  | { kind: 'none' }
  | { kind: 'switch'; to: Delegate }
  /**
   * `delegate` is the faster engine. When it differs from the engine now running, the runtime does
   * NOT switch again during the attempt (at most one switch per attempt); it switches when the
   * scanner closes and the choice is saved for the next visit.
   */
  | { kind: 'final'; delegate: Delegate; gpuMs: number; cpuMs: number | null; gpuFps: number; cpuFps: number | null };

/** Analysed frames per second from result arrival times (includes copy/transfer overhead). */
export function cycleFps(arrivalsMs: readonly number[]): number {
  if (arrivalsMs.length < 2) return 0;
  const span = arrivalsMs[arrivalsMs.length - 1] - arrivalsMs[0];
  return span > 0 ? ((arrivalsMs.length - 1) * 1000) / span : 0;
}

export class DelegateTuner {
  private state: 'gpu' | 'cpu' | 'done';
  private skipped = 0;
  private readonly samples: number[] = [];
  private readonly arrivals: number[] = [];
  private gpuMedian = Number.NaN;
  private gpuFps = 0;

  /** Only a GPU start is tuned; a CPU start (or a remembered choice) is final at once. */
  constructor(startDelegate: Delegate) {
    this.state = startDelegate === 'GPU' ? 'gpu' : 'done';
  }

  get done(): boolean {
    return this.state === 'done';
  }

  /** Stop tuning (for example the worker fell back to the CPU by itself after a GPU fault). */
  finish(): void {
    this.state = 'done';
  }

  /**
   * Feed one result: model time `inferenceMs` on `delegate`, arriving at `arrivalMs` (page clock).
   * Results from the other engine are ignored.
   */
  record(delegate: Delegate, inferenceMs: number, arrivalMs: number): TunerDecision {
    if (this.state === 'done' || !Number.isFinite(inferenceMs) || inferenceMs < 0 || !Number.isFinite(arrivalMs)) {
      return { kind: 'none' };
    }
    const wanted: Delegate = this.state === 'gpu' ? 'GPU' : 'CPU';
    if (delegate !== wanted) return { kind: 'none' };
    if (this.skipped < SKIP_FRAMES) {
      this.skipped += 1;
      return { kind: 'none' };
    }
    this.samples.push(inferenceMs);
    this.arrivals.push(arrivalMs);
    if (this.state === 'gpu') {
      if (this.samples.length < GPU_SAMPLE_FRAMES) return { kind: 'none' };
      this.gpuMedian = median(this.samples);
      this.gpuFps = cycleFps(this.arrivals);
      if (this.gpuMedian <= GPU_SLOW_MEDIAN_MS && this.gpuFps >= GPU_MIN_CYCLE_FPS) {
        this.state = 'done';
        return { kind: 'final', delegate: 'GPU', gpuMs: this.gpuMedian, cpuMs: null, gpuFps: this.gpuFps, cpuFps: null };
      }
      this.state = 'cpu';
      this.samples.splice(0);
      this.arrivals.splice(0);
      this.skipped = 0;
      return { kind: 'switch', to: 'CPU' };
    }
    if (this.samples.length < CPU_SAMPLE_FRAMES) return { kind: 'none' };
    const cpuMedian = median(this.samples);
    const cpuFps = cycleFps(this.arrivals);
    this.state = 'done';
    // Decided on the delivered frame rate (what the Backend measures), not on model time alone.
    const delegateChoice: Delegate = cpuFps > this.gpuFps ? 'CPU' : 'GPU';
    return { kind: 'final', delegate: delegateChoice, gpuMs: this.gpuMedian, cpuMs: cpuMedian, gpuFps: this.gpuFps, cpuFps };
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** The remembered engine, or null when there is none, it expired, or storage is unavailable. */
export function readDelegateChoice(storage: StorageLike | null | undefined, nowMs: number): Delegate | null {
  try {
    const raw = storage?.getItem(CHOICE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { delegate?: unknown; savedAt?: unknown };
    if (parsed.delegate !== 'GPU' && parsed.delegate !== 'CPU') return null;
    if (typeof parsed.savedAt !== 'number' || nowMs - parsed.savedAt > CHOICE_TTL_MS || parsed.savedAt > nowMs) return null;
    return parsed.delegate;
  } catch {
    return null;
  }
}

export function saveDelegateChoice(
  storage: StorageLike | null | undefined,
  decision: { delegate: Delegate; gpuMs: number; cpuMs: number | null; gpuFps?: number; cpuFps?: number | null },
  nowMs: number,
): void {
  try {
    storage?.setItem(CHOICE_STORAGE_KEY, JSON.stringify({
      delegate: decision.delegate,
      savedAt: nowMs,
      gpuMs: Number.isFinite(decision.gpuMs) ? Math.round(decision.gpuMs) : null,
      cpuMs: decision.cpuMs === null || !Number.isFinite(decision.cpuMs) ? null : Math.round(decision.cpuMs),
      gpuFps: roundedFps(decision.gpuFps),
      cpuFps: roundedFps(decision.cpuFps),
    }));
  } catch {
    // Private mode or blocked storage: the phone is simply measured again next time.
  }
}

function roundedFps(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}
