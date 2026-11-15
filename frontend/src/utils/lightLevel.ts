/**
 * Low-light hint for the face scan (advisory only: it never blocks or fails a scan).
 *
 * The scanner draws the analysis frame into a tiny canvas (LUMA_SAMPLE_WIDTH x LUMA_SAMPLE_HEIGHT)
 * at most every LUMA_SAMPLE_EVERY_MS and averages the brightness. If it stays below LOW_LIGHT_LUMA
 * for LOW_LIGHT_HOLD_MS, a hint asks the person to face the light.
 *
 * LOW_LIGHT_LUMA (60 of 255) is an UNMEASURED, conservative starting value: no light level is
 * recorded with the real attempts yet. Tune it only with measured frames from real phones.
 */
export const LUMA_SAMPLE_WIDTH = 32;
export const LUMA_SAMPLE_HEIGHT = 24;
export const LUMA_SAMPLE_EVERY_MS = 500;
export const LOW_LIGHT_LUMA = 60;
/** Once shown, the hint goes away only when the frame is clearly brighter (no flicker). */
export const LOW_LIGHT_CLEAR_LUMA = 70;
export const LOW_LIGHT_HOLD_MS = 1_500;
export const LOW_LIGHT_MESSAGE = 'แสงน้อยเกินไป กรุณาหันหน้าเข้าหาแสงหรือเปิดไฟ';

/** Mean luma (BT.601 weights, 0-255) of RGBA pixel data such as ImageData.data. */
export function meanLuma(rgba: ArrayLike<number>): number {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return 0;
  let total = 0;
  for (let index = 0; index < pixels * 4; index += 4) {
    total += 0.299 * rgba[index] + 0.587 * rgba[index + 1] + 0.114 * rgba[index + 2];
  }
  return total / pixels;
}

/** Remembers how long the frame has been dark and says whether the hint should be visible. */
export class LowLightMonitor {
  private darkSince: number | null = null;
  private showing = false;

  update(luma: number, timestampMs: number): boolean {
    if (this.showing) {
      if (luma >= LOW_LIGHT_CLEAR_LUMA) {
        this.showing = false;
        this.darkSince = null;
      }
      return this.showing;
    }
    if (luma < LOW_LIGHT_LUMA) {
      this.darkSince ??= timestampMs;
      this.showing = timestampMs - this.darkSince >= LOW_LIGHT_HOLD_MS;
    } else {
      this.darkSince = null;
    }
    return this.showing;
  }

  reset(): void {
    this.darkSince = null;
    this.showing = false;
  }
}
