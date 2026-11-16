/**
 * Decides WHEN a new web build may reload the page. A reload in the middle of a face scan or while
 * an attendance check-in is being sent would throw away a single-use challenge, so every such
 * screen takes a hold; a reload requested meanwhile waits until the last hold is released.
 */
export class ReloadGate {
  private holds = 0;
  private pending = false;
  private readonly reload: () => void;

  constructor(reload: () => void) {
    this.reload = reload;
  }

  /** Take a hold; call the returned function (once) to release it. */
  hold(): () => void {
    this.holds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds = Math.max(0, this.holds - 1);
      if (this.holds === 0 && this.pending) this.fire();
    };
  }

  /** A new build is active: reload now, or as soon as nothing holds the page. */
  requestReload(): void {
    if (this.holds > 0) {
      this.pending = true;
      return;
    }
    this.fire();
  }

  /**
   * Reload now if a new build is waiting, even while held. Used when the page can no longer work
   * (the face runtime failed to load, most likely because the old build's files are gone after the
   * update), so the hold protects nothing any more. Returns whether it reloaded.
   */
  reloadNowIfPending(): boolean {
    if (!this.pending) return false;
    this.holds = 0;
    this.fire();
    return true;
  }

  get isHeld(): boolean {
    return this.holds > 0;
  }

  get isPending(): boolean {
    return this.pending;
  }

  private fire(): void {
    this.pending = false;
    this.reload();
  }
}

/** How often an open page asks the server for a new build (also checked whenever it becomes visible). */
export const UPDATE_CHECK_EVERY_MS = 5 * 60_000;

/** The app-wide gate (the reload callback only runs in a browser, when it fires). */
export const appUpdateGate = new ReloadGate(() => window.location.reload());

/**
 * A lazily loaded file of the running build could not be fetched (vite:preloadError): after an
 * update the old hashed files are gone, so reloading loads the new build. Never twice within
 * CHUNK_RELOAD_GUARD_MS, so a file that is really missing cannot cause a reload loop.
 */
export const CHUNK_RELOAD_GUARD_MS = 30_000;
export const CHUNK_RELOAD_KEY = 'chunk-reload-at.v1';

export function shouldReloadAfterChunkError(lastReloadAtMs: number | null, nowMs: number): boolean {
  return lastReloadAtMs === null || !Number.isFinite(lastReloadAtMs) || nowMs - lastReloadAtMs >= CHUNK_RELOAD_GUARD_MS || lastReloadAtMs > nowMs;
}

/** Attendance page: a scan, a pending capture, an upload, or an unused single-use challenge is on screen. */
export function attendanceHoldsPage(state: {
  livenessActive: boolean;
  submitting: boolean;
  hasCapture: boolean;
  hasChallengeToken: boolean;
}): boolean {
  return state.livenessActive || state.submitting || state.hasCapture || state.hasChallengeToken;
}

/** Enrollment page: an unused enrollment challenge, a scan, or the evidence upload is on screen. */
export function enrollmentHoldsPage(state: { hasChallenge: boolean; phase: string }): boolean {
  return state.hasChallenge || state.phase === 'challenge' || state.phase === 'liveness' || state.phase === 'saving';
}
