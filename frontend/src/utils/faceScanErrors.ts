/**
 * Error handling of the face scan that has nothing to do with the face itself: the face model
 * runtime (MediaPipe in a worker, or on the main thread on iOS) and the camera frame copy
 * (createImageBitmap on the <video>).
 *
 * Why this exists (Android report 2026-11-15): the scanner turned ANY throw while copying or posting
 * one frame into the fatal "please update the browser" message, and it kept its frame loop running
 * after any other error, so the next frame's throw (runtime already in 'error') overwrote the real
 * first message with that same text. One-frame problems (the camera renegotiating its size, the
 * runtime briefly not ready) are now skipped, and the scan only stops after a SUSTAINED problem,
 * with a message that names the real cause.
 *
 * The limits below are UNMEASURED engineering margins (no Android trace of the failure exists yet).
 * They only decide when to give up; they never accept a frame the Backend would refuse.
 */

/** Stop after a streak of failed frames lasting this long ... */
export const FRAME_ERROR_FAIL_MS = 3_000;
/** ... or this many failed frames in a row (the scanner tries at most every 50 ms, so >= 2 s). */
export const FRAME_ERROR_FAIL_COUNT = 40;

/**
 * runtime: the face model was not ready for this frame (re-initialising, worker busy, one failed
 *          inference).
 * frame:   the camera frame could not be copied (0x0 video, InvalidStateError while the camera
 *          renegotiates its resolution or switches lens).
 * unsupported: the browser has no usable createImageBitmap at all.
 */
export type FrameErrorKind = 'runtime' | 'frame' | 'unsupported';

export const FRAME_ERROR_MESSAGES: Record<FrameErrorKind, string> = {
  runtime: 'ระบบตรวจจับใบหน้าไม่ตอบสนอง กรุณากดลองตรวจอีกครั้ง ถ้ายังไม่ได้ให้ปิดแอปหรือแท็บอื่นแล้วโหลดหน้านี้ใหม่',
  frame: 'อ่านภาพจากกล้องไม่ได้ต่อเนื่อง กรุณาตรวจว่าไม่มีแอปอื่นใช้กล้องอยู่ แล้วกดลองตรวจอีกครั้ง',
  unsupported: 'เบราว์เซอร์นี้ไม่สามารถส่งภาพกล้องไปตรวจสอบได้ กรุณาอัปเดตเบราว์เซอร์ หรือเปิดลิงก์ใน Chrome หรือ Safari',
};

/** Message thrown by the runtime when a frame is posted while the model is not ready. */
export const RUNTIME_NOT_READY_MESSAGE = 'ระบบตรวจจับใบหน้าไม่พร้อมใช้งาน';

/** Thrown by the scanner itself when the video has no frame size yet. */
export class CameraFrameUnavailableError extends Error {
  constructor() {
    super('camera frame has no size yet');
    this.name = 'CameraFrameUnavailableError';
  }
}

/** Name and message of an error, for the test-build overlay only (never sent anywhere). */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 160);
  return String(error).slice(0, 160);
}

/** Which kind of problem a throw while grabbing or posting one frame is. */
export function classifyFrameError(error: unknown, createImageBitmapAvailable: boolean): FrameErrorKind {
  if (!createImageBitmapAvailable) return 'unsupported';
  if (error instanceof CameraFrameUnavailableError) return 'frame';
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(RUNTIME_NOT_READY_MESSAGE) || message.includes('ยังไม่พร้อมใช้งาน')) return 'runtime';
  // createImageBitmap rejects with InvalidStateError (no data / 0x0 / detached), and some engines
  // use TypeError or a generic Error for the same transient state. A missing function is the only
  // proof that the browser really cannot do it, and that is checked above.
  if (/is not (a function|defined)/i.test(message) && /createImageBitmap/i.test(message)) return 'unsupported';
  if (name === 'NotSupportedError' && /createImageBitmap/i.test(message)) return 'unsupported';
  return 'frame';
}

export type FrameErrorDecision = { fatal: false } | { fatal: true; kind: FrameErrorKind };

/**
 * Counts failed frames in a row. A successful frame (`success`) ends the streak. `record` says
 * whether the problem is now sustained enough to stop the scan; an 'unsupported' error is fatal at
 * once because waiting cannot fix it.
 */
export class FrameErrorTolerance {
  private streakStartMs: number | null = null;
  private streak = 0;
  private lastKind: FrameErrorKind | null = null;
  /** Every failed frame of this attempt (for the test-mode diagnostics). */
  total = 0;

  record(kind: FrameErrorKind, nowMs: number): FrameErrorDecision {
    this.total += 1;
    this.streak += 1;
    this.lastKind = kind;
    this.streakStartMs ??= nowMs;
    if (kind === 'unsupported') return { fatal: true, kind };
    if (this.streak >= FRAME_ERROR_FAIL_COUNT || nowMs - this.streakStartMs >= FRAME_ERROR_FAIL_MS) {
      return { fatal: true, kind };
    }
    return { fatal: false };
  }

  success(): void {
    this.streak = 0;
    this.streakStartMs = null;
    this.lastKind = null;
  }

  get currentStreak(): number {
    return this.streak;
  }

  get currentKind(): FrameErrorKind | null {
    return this.lastKind;
  }
}

export type RuntimeLoadErrorKind = 'timeout' | 'network' | 'memory' | 'crashed' | 'unsupported' | 'unknown';

/**
 * Sorts a face-runtime load/run error. The old rule mapped every message containing "worker" or
 * "wasm" to "browser unsupported", which also caught a worker that crashed mid-scan ("Face
 * Landmarker worker stopped unexpectedly"), a failed WASM download ("wasm ... Failed to fetch") and
 * WASM out-of-memory on low-RAM Android phones. Those are retryable and now say so.
 */
export function classifyRuntimeLoadError(rawMessage: string): RuntimeLoadErrorKind {
  const message = rawMessage.toLowerCase();
  if (message.includes('timed out')) return 'timeout';
  if (/failed to fetch|networkerror|network error|load failed|request failed|err_internet|err_network/.test(message)) {
    return 'network';
  }
  if (/out of memory|cannot allocate|allocation failed|could not allocate|cannot enlarge memory/.test(message)) {
    return 'memory';
  }
  if (
    /webassembly is not defined|can't find variable: webassembly|worker is not defined|failed to construct 'worker'/.test(message)
    || /module scripts? (are |is )?not supported|offscreencanvas is not defined/.test(message)
    || /wasm code generation disallowed|document is not defined|can't find variable: document/.test(message)
  ) {
    return 'unsupported';
  }
  if (/stopped unexpectedly|aborted\(|runtimeerror|unreachable|context lost|webgl|gpu/.test(message)) {
    return 'crashed';
  }
  return 'unknown';
}

export const RUNTIME_LOAD_MESSAGES: Record<RuntimeLoadErrorKind, string> = {
  timeout: 'ใช้เวลาเตรียมระบบตรวจจับใบหน้านานเกินไป กรุณาเชื่อมต่อ Wi-Fi หรือเครือข่ายที่เสถียรแล้วลองใหม่',
  network: 'ดาวน์โหลดระบบตรวจจับใบหน้าไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  memory: 'หน่วยความจำของเครื่องไม่พอสำหรับระบบตรวจจับใบหน้า กรุณาปิดแอปหรือแท็บอื่นแล้วลองใหม่',
  crashed: 'ระบบตรวจจับใบหน้าหยุดทำงานกลางคัน กรุณาลองใหม่ ถ้ายังเกิดซ้ำให้ปิดแท็บอื่นแล้วโหลดหน้านี้ใหม่',
  unsupported: 'เบราว์เซอร์นี้ไม่รองรับระบบตรวจจับใบหน้าที่ใช้อยู่ กรุณาอัปเดต iOS, Safari หรือ Chrome แล้วลองใหม่',
  unknown: 'เตรียมระบบตรวจจับใบหน้าไม่สำเร็จ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่',
};
