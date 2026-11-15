/**
 * Which camera frames become the three passive (PAD) samples.
 *
 * Real phone data (2026-11-15): PAD failed 7 of 12 failed attempts, with the per-frame live score
 * swinging 0.07 -> 0.91 inside ONE scan, the first sample usually the lowest, and most failures on
 * ~9 fps phones held close (motion blur). The Backend PAD threshold is unchanged; the scanner only
 * chooses better frames:
 *  (a) warm-up: no passive sample before CAMERA_WARMUP_MS after the camera's first frame (auto
 *      exposure / focus settle), on top of the existing stable-frame counter;
 *  (b) sharpness: a candidate markedly blurrier than the recent median of this scan is skipped;
 *  (c) the three passive frames are encoded with a higher JPEG quality.
 *
 * ALL VALUES ARE UNMEASURED starting points (no per-frame sharpness was recorded on real phones yet;
 * the test build now reports it in client_diagnostics). Tune only with that data.
 */

/** No passive sample earlier than this after the camera produced its first frame. */
export const CAMERA_WARMUP_MS = 1_000;

export function passiveWarmupDone(
  firstCameraFrameMs: number | null,
  nowMs: number,
  stableFrames: number,
  requiredStableFrames: number,
): boolean {
  return firstCameraFrameMs !== null
    && nowMs - firstCameraFrameMs >= CAMERA_WARMUP_MS
    && stableFrames >= requiredStableFrames;
}

/**
 * Still frame #1 (2026-11-15 data): across devices the FIRST passive frame often scored near zero
 * in the Backend PAD while frames 2-3 were high ([0.0067, 0.87, 0.86], [0.0002, 0.997, 0.79], ...;
 * frame 1 lowest in 11/20 rows), even with the camera warm-up. In the scanner, frame 1 was taken
 * on the 4th consistent face frame, i.e. about 0.13-0.45 s after the face ARRIVED (still moving
 * in, auto exposure/focus re-adapting to the face), and it was the only frame the blur gate could
 * not judge (fewer than SHARPNESS_MIN_HISTORY frames seen). Frames 2/3 come >= 450 ms later and
 * are judged. So frame 1 now also needs FACE_PRESENCE_MS of continuous face presence and a blur
 * history. The Backend crops each frame with its own box (no frame-1 difference there).
 */
export const FACE_PRESENCE_MS = 500;

export function firstSampleReady(
  presenceSinceMs: number | null,
  nowMs: number,
  sharpnessHistoryReady: boolean,
): boolean {
  return presenceSinceMs !== null && nowMs - presenceSinceMs >= FACE_PRESENCE_MS && sharpnessHistoryReady;
}

/** Side of the grayscale face crop the sharpness is measured on (9216 pixels: well under 1 ms). */
export const SHARPNESS_SAMPLE_SIDE = 96;
/** A candidate below this share of the recent median is treated as motion-blurred. */
export const SHARPNESS_MIN_RATIO = 0.70;
/** Frames of this scan the median is taken over, and how many are needed before the gate acts. */
export const SHARPNESS_HISTORY = 15;
export const SHARPNESS_MIN_HISTORY = 5;
/**
 * After this many blur skips in a row the next candidate is taken anyway, so a person who cannot
 * hold still is not locked out (the Backend PAD still decides).
 */
export const SHARPNESS_MAX_SKIPS = 5;

/** JPEG quality of the three passive frames (PAD input) and of the action / final frames. */
export const PASSIVE_JPEG_QUALITY = 0.92;
export const EVIDENCE_JPEG_QUALITY = 0.84;

export interface CropRect { sx: number; sy: number; sw: number; sh: number }

/**
 * Square crop around the face, in pixels of a frame of `frameWidth` x `frameHeight`. The side is the
 * cheek-to-cheek width (about the skin area the PAD model looks at). Null without a face centre.
 */
export function faceCropRect(
  face: { faceWidthRatio: number; faceCenterX?: number; faceCenterY?: number },
  frameWidth: number,
  frameHeight: number,
): CropRect | null {
  if (
    face.faceCenterX === undefined || face.faceCenterY === undefined
    || !(face.faceWidthRatio > 0) || frameWidth <= 0 || frameHeight <= 0
  ) return null;
  const side = Math.min(frameWidth, frameHeight, Math.max(8, face.faceWidthRatio * frameWidth));
  const cx = face.faceCenterX * frameWidth;
  const cy = face.faceCenterY * frameHeight;
  const sx = Math.min(Math.max(0, cx - side / 2), frameWidth - side);
  const sy = Math.min(Math.max(0, cy - side / 2), frameHeight - side);
  return { sx, sy, sw: side, sh: side };
}

/** BT.601 grayscale (0-255) of RGBA pixel data. */
export function grayFromRgba(rgba: ArrayLike<number>): Float32Array {
  const pixels = Math.floor(rgba.length / 4);
  const gray = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    gray[index] = 0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2];
  }
  return gray;
}

export function meanGray(gray: ArrayLike<number>): number {
  if (gray.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < gray.length; index += 1) total += gray[index];
  return total / gray.length;
}

/**
 * Mean absolute 4-neighbour Laplacian over the interior pixels: high for crisp edges, low for a
 * blurred or flat image. Relative use only (this scan's own median), so lighting differences between
 * phones do not matter much.
 */
export function laplacianSharpness(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3 || gray.length < width * height) return 0;
  let total = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      total += Math.abs(4 * gray[index] - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width]);
    }
  }
  return total / ((width - 2) * (height - 2));
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return 0;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Keeps the recent sharpness of this scan and judges passive candidates against its median.
 * Call `evaluate` for a candidate BEFORE `observe` adds that frame to the history.
 */
export class SharpnessGate {
  private readonly history: number[] = [];
  private skips = 0;

  observe(value: number): void {
    if (!Number.isFinite(value)) return;
    this.history.push(value);
    if (this.history.length > SHARPNESS_HISTORY) this.history.shift();
  }

  get median(): number | null {
    return this.history.length >= SHARPNESS_MIN_HISTORY ? medianOf(this.history) : null;
  }

  /** True when the candidate is sharp enough (or the gate has too little data, or skipped too often). */
  evaluate(value: number | null): boolean {
    const median = this.median;
    if (value === null || median === null || median <= 0) return true;
    if (value >= SHARPNESS_MIN_RATIO * median) {
      this.skips = 0;
      return true;
    }
    if (this.skips >= SHARPNESS_MAX_SKIPS) {
      this.skips = 0;
      return true;
    }
    this.skips += 1;
    return false;
  }
}
