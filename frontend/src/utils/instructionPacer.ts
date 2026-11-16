/**
 * Paces the instruction text in the scan frame so it never flips every camera frame.
 *
 * The scanner asks for a text on every processed frame. Without pacing, a face that is just at the
 * edge of a limit makes the text jump between two hints many times a second, and nobody can read it.
 *
 * Rules:
 *  - A shown text stays at least `minDwellMs` before a 'hint' may replace it.
 *  - While a text is held, only the LATEST requested hint is kept (pending) and shown once the hold ends.
 *  - A 'step' (a new phase: the challenge prompt, "open your eyes", a restart notice) is shown at once,
 *    and is then itself held `minDwellMs` against hints.
 *  - Asking for the text that is already shown does not restart its hold, and cancels a pending hint
 *    (the latest request wins, and the latest request is what is already on screen).
 *  - Time never runs backwards: a smaller `nowMs` than seen before is treated as the last one, so frame
 *    timestamps and timer callbacks can be mixed safely.
 *
 * Pure logic, no React or DOM: tested in scripts/test-instruction-pacer.mts. Error UI never goes
 * through it (errors must show at once).
 */
export type InstructionKind = 'hint' | 'step';

/** How long a shown instruction stays at least before a hint replaces it. */
export const INSTRUCTION_MIN_DWELL_MS = 1_500;

export interface InstructionPacerOptions {
  minDwellMs?: number;
  /** Text already on screen when the pacer starts (it is not held). */
  initialText?: string;
}

export class InstructionPacer {
  private readonly minDwellMs: number;
  private shown: string;
  private shownAt = Number.NEGATIVE_INFINITY;
  private waiting: string | null = null;
  private lastNow = Number.NEGATIVE_INFINITY;

  constructor(options: InstructionPacerOptions = {}) {
    this.minDwellMs = Math.max(0, options.minDwellMs ?? INSTRUCTION_MIN_DWELL_MS);
    this.shown = options.initialText ?? '';
  }

  /** The text that is shown now. */
  get current(): string {
    return this.shown;
  }

  /** The hint waiting for the current hold to end, or null. */
  get pending(): string | null {
    return this.waiting;
  }

  /** Ask for `text`; returns the text that should be displayed now. */
  request(text: string, nowMs: number, kind: InstructionKind = 'hint'): string {
    const now = this.clock(nowMs);
    if (text === this.shown) {
      this.waiting = null;
      return this.shown;
    }
    if (kind === 'step' || !this.held(now)) {
      this.show(text, now);
      return this.shown;
    }
    this.waiting = text;
    return this.shown;
  }

  /** Show the pending hint once the hold has ended; returns the text that should be displayed now. */
  tick(nowMs: number): string {
    const now = this.clock(nowMs);
    if (this.waiting !== null && !this.held(now)) this.show(this.waiting, now);
    return this.shown;
  }

  private held(now: number): boolean {
    return now - this.shownAt < this.minDwellMs;
  }

  private show(text: string, now: number) {
    this.shown = text;
    this.shownAt = now;
    this.waiting = null;
  }

  private clock(nowMs: number): number {
    if (Number.isFinite(nowMs) && nowMs > this.lastNow) this.lastNow = nowMs;
    return this.lastNow;
  }
}
