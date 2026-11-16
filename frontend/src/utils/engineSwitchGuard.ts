/**
 * The scanner's side of an engine switch (see utils/delegateTuner.ts). While the worker rebuilds
 * the model, results are slow or stale, and a GPU start may take up to the worker's 20 s GPU
 * timeout, so:
 *  - 'switching' pauses the attempt timeout (a separate ENGINE_SWITCH_TIMEOUT_MS guard runs instead);
 *  - 'switched' restarts the attempt with clean timing and a fresh attempt timeout, at most once
 *    per attempt (the runtime never switches twice in one attempt);
 *  - results posted before the switch finished are never used.
 */
export const ENGINE_SWITCH_TIMEOUT_MS = 30_000;

export type EngineSwitchAction = 'pause' | 'restart' | 'ignore';

export class EngineSwitchGuard {
  private switching = false;
  private resetAt = 0;
  private restarts = 0;

  /** What the scanner must do for an engine event at `nowMs`. */
  onEvent(phase: 'switching' | 'switched', nowMs: number): EngineSwitchAction {
    if (phase === 'switching') {
      if (this.switching) return 'ignore';
      this.switching = true;
      return 'pause';
    }
    if (!this.switching && this.restarts > 0) return 'ignore';
    this.switching = false;
    this.resetAt = nowMs;
    this.restarts += 1;
    return 'restart';
  }

  /** Whether a result posted at `timestampMs` may be used. */
  accepts(timestampMs: number): boolean {
    return !this.switching && timestampMs >= this.resetAt;
  }

  get isSwitching(): boolean {
    return this.switching;
  }

  get restartCount(): number {
    return this.restarts;
  }
}
