/**
 * Blink detection across eye shapes, blink styles and camera speeds.
 *
 * This is a LOGIC simulation: it feeds synthetic eye-aperture and blink-score signals through
 * the same HybridActionMonitor the scanner uses. It does not run a face model, so it shows
 * whether the decision rules are fair to narrow and wide eyes, not how well MediaPipe sees them.
 * Real-phone numbers come from the test-build overlay (see deployment/docker/README_TH.md).
 *
 * Signal model (documented so the numbers can be challenged):
 *  - eye aperture ratio (EAR): open value per eye shape, falling toward an absolute floor when
 *    the lid closes (landmark meshes cannot go below roughly 0.04-0.09, so narrow eyes show a
 *    much smaller RELATIVE drop than wide eyes); Gaussian landmark jitter on top;
 *  - eyeBlink blend-shape score: a resting value (higher for narrow eyes) rising to a peak;
 *  - the baseline is the median of three open samples, like the scanner;
 *  - after the blink the eye reopens to a relaxed fraction of the baseline (people stare wide
 *    while the camera calibrates, then relax).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BLINK_PROMPT,
  BLINK_RETRY_PROMPT,
  CLEAR_FACE_ADVICE,
  FACE_ADVICE_AFTER_MS,
  HYBRID_BLINK_LIMITS,
  HybridActionMonitor,
  blinkClosedRatioLimit,
  blinkClosure,
  faceProblemInstruction,
  hybridActionDetected,
  type HybridLivenessBaseline,
  type LivenessObservation,
} from '../src/utils/liveness.ts';
import { HYBRID_TIMING_LIMITS } from '../src/utils/livenessTiming.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(random: () => number, sigma: number) {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random()) * sigma;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

interface EyeShape {
  name: string;
  leftOpen: number;
  rightOpen: number;
  floor: number;       // absolute EAR when the lid is shut
  restScore: number;   // eyeBlink score while open
  peakScore: number;   // eyeBlink score while shut
}
const SHAPES: EyeShape[] = [
  { name: 'very-wide', leftOpen: 0.42, rightOpen: 0.42, floor: 0.07, restScore: 0.01, peakScore: 0.90 },
  { name: 'wide', leftOpen: 0.34, rightOpen: 0.34, floor: 0.06, restScore: 0.02, peakScore: 0.85 },
  { name: 'normal', leftOpen: 0.27, rightOpen: 0.27, floor: 0.06, restScore: 0.05, peakScore: 0.85 },
  { name: 'narrow', leftOpen: 0.20, rightOpen: 0.20, floor: 0.06, restScore: 0.12, peakScore: 0.80 },
  { name: 'monolid', leftOpen: 0.15, rightOpen: 0.15, floor: 0.06, restScore: 0.22, peakScore: 0.75 },
  { name: 'very-narrow', leftOpen: 0.12, rightOpen: 0.12, floor: 0.06, restScore: 0.28, peakScore: 0.70 },
  { name: 'asymmetric', leftOpen: 0.30, rightOpen: 0.18, floor: 0.06, restScore: 0.10, peakScore: 0.80 },
  { name: 'narrow-high-floor', leftOpen: 0.17, rightOpen: 0.17, floor: 0.085, restScore: 0.20, peakScore: 0.75 },
];

interface BlinkStyle {
  name: string;
  closeMs: number;
  holdMs: number;
  openMs: number;
  depth?: number;          // 1 = fully shut
  leftOnly?: boolean;      // wink
  nod?: number;            // pitch change during the blink
  sway?: number;           // head jitter (sigma of yaw and pitch) while blinking; default 0.01
  mustPass: boolean;
  minFps?: number;         // slowest camera at which this style is required to work
}
// The prompt asks for a short, firm closure ("หลับตาให้สนิทสักครู่"): 'firm' is the instructed blink.
// Spontaneous and shallow blinks are informational only: the scanner now refuses them on purpose,
// because their frames are the ones the Backend's 68-point measure saw as nearly open.
const STYLES: BlinkStyle[] = [
  { name: 'natural-fast', closeMs: 45, holdMs: 25, openMs: 70, mustPass: false },
  { name: 'natural', closeMs: 60, holdMs: 60, openMs: 110, mustPass: false },
  { name: 'firm', closeMs: 80, holdMs: 300, openMs: 120, mustPass: true },
  { name: 'firm-slow-close', closeMs: 300, holdMs: 250, openMs: 150, mustPass: true },
  { name: 'slow', closeMs: 150, holdMs: 300, openMs: 200, mustPass: true },
  { name: 'held-1s', closeMs: 100, holdMs: 1000, openMs: 150, mustPass: true },
  { name: 'light', closeMs: 80, holdMs: 80, openMs: 120, depth: 0.7, mustPass: false },
  // Hand-held phone: the head jitters while the eyes close (sigma 0.03 in yaw and pitch).
  { name: 'firm+sway', closeMs: 80, holdMs: 300, openMs: 120, sway: 0.03, mustPass: true },
  { name: 'held-1s+sway', closeMs: 100, holdMs: 1000, openMs: 150, sway: 0.03, mustPass: true },
  // must be rejected
  { name: 'photo', closeMs: 80, holdMs: 200, openMs: 100, depth: 0, mustPass: false },
  { name: 'wink', closeMs: 80, holdMs: 300, openMs: 100, leftOnly: true, mustPass: false },
  { name: 'squint', closeMs: 150, holdMs: 600, openMs: 150, depth: 0.25, mustPass: false },
  { name: 'nod', closeMs: 80, holdMs: 300, openMs: 100, nod: 0.3, mustPass: false },
];
const REJECT = new Set(['photo', 'wink', 'squint', 'nod']);

function closure(style: BlinkStyle, ms: number): number {
  const depth = style.depth ?? 1;
  if (ms < 0) return 0;
  if (ms < style.closeMs) return depth * (ms / style.closeMs);
  if (ms < style.closeMs + style.holdMs) return depth;
  const reopen = ms - style.closeMs - style.holdMs;
  return reopen < style.openMs ? depth * (1 - reopen / style.openMs) : 0;
}

interface TrialResult {
  /** Action captured, face recovered, and recovery within the scanner's 2.7 s guard. */
  ok: boolean;
  /** True lid closure (0-1) at the frame that would be uploaded as the action frame. */
  uploadedClosure: number;
}

function runTrial(shape: EyeShape, style: BlinkStyle, fps: number, seed: number): TrialResult {
  const random = rng(seed);
  const jitterSigma = 0.008;
  const relaxed = 0.78 + random() * 0.22;
  const sample = (): LivenessObservation => ({
    timestampMs: 0,
    faceCount: 1,
    leftEar: shape.leftOpen + gauss(random, jitterSigma),
    rightEar: shape.rightOpen + gauss(random, jitterSigma),
    leftBlinkScore: 0,
    rightBlinkScore: 0,
    yaw: 0,
    pitch: 0,
    faceWidthRatio: 0.4,
    centerOffset: 0.02,
  });
  const baselineSamples = [sample(), sample(), sample()];
  const baseline: HybridLivenessBaseline = {
    leftEar: median(baselineSamples.map((s) => s.leftEar)),
    rightEar: median(baselineSamples.map((s) => s.rightEar)),
    faceWidthRatio: 0.4,
    yaw: 0,
    pitch: 0,
  };
  const monitor = new HybridActionMonitor('blink', baseline);

  const interval = 1000 / fps;
  const blinkStart = random() * 900 + 200;        // blink begins at a random moment
  const total = style.closeMs + style.holdMs + style.openMs;
  let t = 0;
  let captured = false;
  let candidateClosure = 0;
  let uploadedClosure = 0;
  for (let frame = 0; frame < 8000 / interval; frame += 1) {
    t += interval * (0.85 + random() * 0.3);       // uneven frame pacing
    const c = closure(style, t - blinkStart);
    const afterBlink = t - blinkStart > total;
    const rest = afterBlink ? relaxed : 1;
    const leftC = c;
    const rightC = style.leftOnly ? 0 : c;
    const nodNow = style.nod && c > 0 ? style.nod * c : 0;
    const open = (openEar: number) => openEar * (afterBlink ? relaxed : 1);
    const observation: LivenessObservation = {
      timestampMs: t,
      faceCount: 1,
      leftEar: open(shape.leftOpen) - leftC * (open(shape.leftOpen) - shape.floor) + gauss(random, jitterSigma),
      rightEar: open(shape.rightOpen) - rightC * (open(shape.rightOpen) - shape.floor) + gauss(random, jitterSigma),
      leftBlinkScore: clamp(shape.restScore + leftC * (shape.peakScore - shape.restScore) + gauss(random, 0.03), 0, 1),
      rightBlinkScore: clamp(shape.restScore + rightC * (shape.peakScore - shape.restScore) + gauss(random, 0.03), 0, 1),
      yaw: gauss(random, style.sway ?? 0.01),
      pitch: nodNow + gauss(random, style.sway ?? 0.01),
      faceWidthRatio: 0.4 + gauss(random, 0.002),
      centerOffset: 0.02,
    };
    void rest;
    const event = monitor.feed(observation);
    if (monitor.keepCurrentFrame) candidateClosure = c;
    if (event === 'action_captured') { captured = true; uploadedClosure = candidateClosure; }
    if (event === 'recovered') {
      const span = t - (monitor.actionTimestampMs ?? t);
      return { ok: captured && span <= HYBRID_TIMING_LIMITS.maxActionToRecoveryMs, uploadedClosure };
    }
  }
  return { ok: false, uploadedClosure };
}

// ---- Boundary contract: thresholds scale with eye openness and never drop below the strict value ----
assert.equal(blinkClosedRatioLimit(0.40), HYBRID_BLINK_LIMITS.closedRatio);
assert.equal(blinkClosedRatioLimit(HYBRID_BLINK_LIMITS.wideEar), HYBRID_BLINK_LIMITS.closedRatio);
assert.equal(blinkClosedRatioLimit(0.05), HYBRID_BLINK_LIMITS.narrowClosedRatio);
const midLimit = blinkClosedRatioLimit((HYBRID_BLINK_LIMITS.wideEar + HYBRID_BLINK_LIMITS.narrowEar) / 2);
assert.ok(midLimit > HYBRID_BLINK_LIMITS.closedRatio && midLimit < HYBRID_BLINK_LIMITS.narrowClosedRatio);
for (let ear = 0.05; ear <= 0.5; ear += 0.01) {
  assert.ok(blinkClosedRatioLimit(ear) >= HYBRID_BLINK_LIMITS.closedRatio, 'limit must never be stricter than the base');
  assert.ok(blinkClosedRatioLimit(ear) <= HYBRID_BLINK_LIMITS.narrowClosedRatio);
}

const base: HybridLivenessBaseline = { leftEar: 0.12, rightEar: 0.12, faceWidthRatio: 0.4, yaw: 0, pitch: 0 };
const frame = (over: Partial<LivenessObservation>): LivenessObservation => ({
  timestampMs: 1, faceCount: 1, leftEar: 0.12, rightEar: 0.12, leftBlinkScore: 0.05, rightBlinkScore: 0.05,
  yaw: 0, pitch: 0, faceWidthRatio: 0.4, centerOffset: 0.02, ...over,
});
// Deep closure on the uploaded frame: ratio <= 0.55 and both eyeBlink scores >= 0.50.
// Open aperture 0.25 (a power of two) keeps ratio * ear / ear exact at the boundaries.
const wideBase: HybridLivenessBaseline = { leftEar: 0.25, rightEar: 0.25, faceWidthRatio: 0.4, yaw: 0, pitch: 0 };
const wideFrame = (ratio: number, score: number, over: Partial<LivenessObservation> = {}) =>
  frame({ leftEar: 0.25 * ratio, rightEar: 0.25 * ratio, leftBlinkScore: score, rightBlinkScore: score, ...over });
assert.equal(blinkClosure(wideFrame(0.55, 0.50), wideBase), 'deep');
assert.equal(blinkClosure(wideFrame(0.56, 0.90), wideBase), 'lid_down', 'the old 0.75 limit is no longer deep enough');
assert.equal(blinkClosure(wideFrame(0.40, 0.49), wideBase), 'lid_down', 'scores must confirm');
assert.equal(blinkClosure(wideFrame(0.80, 0.90), wideBase), 'open');
assert.equal(hybridActionDetected('blink', wideFrame(0.70, 0.90), wideBase), false);
assert.equal(hybridActionDetected('blink', wideFrame(0.50, 0.70), wideBase), true);
// No blend-shape scores at all: aperture alone must be deeper.
assert.equal(blinkClosure(wideFrame(0.45, 0), wideBase), 'deep');
assert.equal(blinkClosure(wideFrame(0.50, 0), wideBase), 'lid_down');
// Very narrow eye (open 0.12): the mesh floor stops near ratio 0.58, so the fallback needs score >= 0.60.
assert.ok(base.leftEar < HYBRID_BLINK_LIMITS.narrowFallbackEar);
assert.equal(blinkClosure(frame({ leftEar: 0.07, rightEar: 0.07, leftBlinkScore: 0.6, rightBlinkScore: 0.6 }), base), 'deep');
assert.equal(blinkClosure(frame({ leftEar: 0.07, rightEar: 0.07, leftBlinkScore: 0.55, rightBlinkScore: 0.55 }), base), 'lid_down');
// The fallback is not available to wide eyes.
assert.equal(blinkClosure(wideFrame(0.70, 0.95), wideBase), 'lid_down');
// Same aperture drop but weak scores: not a blink (could be a squint).
assert.equal(blinkClosure(frame({ leftEar: 0.07, rightEar: 0.07, leftBlinkScore: 0.2, rightBlinkScore: 0.2 }), base), 'open');
// One eye only (wink) never counts, however strong the closed eye is.
assert.equal(blinkClosure(frame({ leftEar: 0.06, leftBlinkScore: 0.9 }), base), 'open');
// Head turned away while the eyes close.
assert.equal(blinkClosure(frame({ leftEar: 0.06, rightEar: 0.06, leftBlinkScore: 0.9, rightBlinkScore: 0.9, yaw: 0.3 }), base), 'open');
// An unchanged open eye with a high resting score is never closed (narrow eyes rest near 0.3).
assert.equal(blinkClosure(frame({ leftBlinkScore: 0.45, rightBlinkScore: 0.45 }), base), 'open');

// ---- Deepest-frame selection ----
const feedAll = (monitor: HybridActionMonitor, frames: LivenessObservation[]) => frames.map((item) => {
  const event = monitor.feed(item);
  return { event, keep: monitor.keepCurrentFrame };
});
// A slow-closing ramp at 20 fps: the frame with the smallest aperture is the action frame, not the first.
const ramp = [0.95, 0.70, 0.60, 0.50, 0.42, 0.35, 0.38, 0.47, 0.90, 1.0];
const rampMonitor = new HybridActionMonitor('blink', wideBase);
const rampEvents = feedAll(rampMonitor, ramp.map((ratio, i) => wideFrame(ratio, ratio < 0.8 ? 0.8 : 0.05, { timestampMs: 1_000 + i * 50 })));
assert.deepEqual(rampEvents.map((item) => item.event).slice(0, 8), Array(8).fill('waiting'), 'nothing is committed while the eyes are shut');
assert.equal(rampEvents[8].event, 'action_captured', 'committed when the eyes reopen');
assert.equal(rampMonitor.actionTimestampMs, 1_000 + 5 * 50, 'the deepest frame (ratio 0.35) is the action frame');
assert.deepEqual(rampEvents.map((item) => item.keep), [false, false, false, true, true, true, false, false, false, false]);
// Recovery after it, as before.
assert.equal(rampMonitor.feed(wideFrame(1.0, 0.05, { timestampMs: 1_550 })), 'recovered');
// A one-frame spike (however deep) is refused, and a real closure afterwards still works.
const spike = new HybridActionMonitor('blink', wideBase);
assert.deepEqual(feedAll(spike, [
  wideFrame(1.0, 0.05, { timestampMs: 0 }),
  wideFrame(0.20, 0.95, { timestampMs: 50 }),
  wideFrame(1.0, 0.05, { timestampMs: 100 }),
  wideFrame(1.0, 0.05, { timestampMs: 150 }),
]).map((item) => item.event), ['waiting', 'waiting', 'waiting', 'waiting']);
assert.equal(spike.hasCandidate, false, 'the spike frame is released');
assert.equal(spike.actionTimestampMs, null);
// Two deep frames 50 ms apart are still too short (3 frames or 200 ms are needed).
const twoFrames = new HybridActionMonitor('blink', wideBase);
assert.deepEqual(feedAll(twoFrames, [
  wideFrame(0.30, 0.9, { timestampMs: 0 }),
  wideFrame(0.30, 0.9, { timestampMs: 50 }),
  wideFrame(1.0, 0.05, { timestampMs: 100 }),
]).map((item) => item.event), ['waiting', 'waiting', 'waiting']);
// At 5 fps two deep frames 200 ms apart are enough.
const lowFps = new HybridActionMonitor('blink', wideBase);
assert.deepEqual(feedAll(lowFps, [
  wideFrame(0.30, 0.9, { timestampMs: 0 }),
  wideFrame(0.25, 0.9, { timestampMs: 200 }),
  wideFrame(1.0, 0.05, { timestampMs: 400 }),
]).map((item) => item.event), ['waiting', 'waiting', 'action_captured']);
assert.equal(lowFps.actionTimestampMs, 200);
// A closure where only one frame is deep (a light blink with one noisy frame) is refused.
const shallow = new HybridActionMonitor('blink', wideBase);
assert.deepEqual(feedAll(shallow, [
  wideFrame(0.70, 0.6, { timestampMs: 0 }),
  wideFrame(0.50, 0.6, { timestampMs: 50 }),
  wideFrame(0.65, 0.6, { timestampMs: 100 }),
  wideFrame(0.70, 0.6, { timestampMs: 150 }),
  wideFrame(1.0, 0.05, { timestampMs: 200 }),
]).map((item) => item.event).includes('action_captured'), false);
// Eyes kept shut: committed after maxHoldMs without waiting for them to open.
const held = new HybridActionMonitor('blink', wideBase);
const heldEvents = feedAll(held, Array.from({ length: 20 }, (_, i) => wideFrame(i === 4 ? 0.20 : 0.30, 0.9, { timestampMs: i * 50 })));
const heldAt = heldEvents.findIndex((item) => item.event === 'action_captured');
assert.equal(heldAt * 50, HYBRID_BLINK_LIMITS.maxHoldMs);
assert.equal(held.actionTimestampMs, 200, 'still the deepest frame');
// move_closer keeps its two-frame rule; the second frame is the action frame.
const closer = new HybridActionMonitor('move_closer', wideBase);
assert.equal(closer.feed(frame({ faceWidthRatio: 0.5, timestampMs: 10 })), 'waiting');
assert.equal(closer.feed(frame({ faceWidthRatio: 0.5, timestampMs: 60 })), 'action_captured');
assert.equal(closer.keepCurrentFrame, true);
assert.equal(closer.actionTimestampMs, 60);
// The scanner uploads the kept (deepest) frame with its own timestamp, and never leaks it.
const scannerSource = readFileSync(new URL('../src/features/student/LivenessScanner.tsx', import.meta.url), 'utf8');
assert.match(scannerSource, /if \(monitor\.keepCurrentFrame\)/);
assert.match(scannerSource, /actionImage = frameToJpeg\(actionFrame\)/);
assert.match(scannerSource, /actionAt = monitor\.actionTimestampMs/);
assert.match(scannerSource, /kind: 'challenge_action', action: challenge\.action, timestampMs: actionAt/);
assert.match(scannerSource, /finally \{ if \(frame !== keptActionFrame\) frame\.close\(\); \}/);
// Released on every stop path: cleanup, slow-camera stop / timeout, errors, and the action restart.
assert.ok((scannerSource.match(/releaseKeptFrame\(/g) ?? []).length >= 6);
assert.match(scannerSource, /client\?\.close\(\);\s*releaseKeptFrame\(\);/);
assert.match(BLINK_PROMPT, /สนิทสักครู่/);
assert.doesNotMatch(BLINK_PROMPT + BLINK_RETRY_PROMPT, /1 วินาที/);
assert.match(BLINK_RETRY_PROMPT, /เก็บผมที่ปิดตา/);

// ---- Instructions when the face or the eyes cannot be read ----
const noFace = frame({ faceCount: 0 });
assert.equal(faceProblemInstruction(noFace, 500), 'วางใบหน้าให้อยู่ในกรอบ');
const advice = faceProblemInstruction(noFace, FACE_ADVICE_AFTER_MS);
assert.ok(advice.includes(CLEAR_FACE_ADVICE) && advice.includes('ผมที่ปิด'), 'long failure must tell the person to clear hair');
assert.ok(CLEAR_FACE_ADVICE.includes('หน้าผาก') && CLEAR_FACE_ADVICE.includes('คิ้วหรือตา'));
assert.equal(faceProblemInstruction(frame({ faceCount: 2 }), 9000), 'ให้มีใบหน้าในกรอบเพียง 1 คน');
const eyesHidden = frame({ leftEar: 0.03 });
assert.ok(faceProblemInstruction(eyesHidden, 2000).includes('เก็บผมที่ปิดตา'));
assert.ok(faceProblemInstruction(frame({ centerOffset: 0.5 }), 3000).includes(CLEAR_FACE_ADVICE));

const TRIALS = 300;
// Negative styles may be accepted by at most 1% of attempts (a shallow nod stays inside the pose tolerance).
const FPS_LIST = [30, 20, 17, 12];
const table: Record<string, Record<string, number>> = {};
// Share of accepted attempts whose uploaded frame was on the slope (true closure under 0.9).
const slope: Record<string, Record<string, number>> = {};
for (const shape of SHAPES) {
  for (const style of STYLES) {
    for (const fps of FPS_LIST) {
      let ok = 0;
      let onSlope = 0;
      for (let i = 0; i < TRIALS; i += 1) {
        const result = runTrial(shape, style, fps, i * 7919 + fps * 31 + shape.name.length * 101);
        if (result.ok) {
          ok += 1;
          if (result.uploadedClosure < 0.9 * (style.depth ?? 1)) onSlope += 1;
        }
      }
      (table[`${shape.name} / ${style.name}`] ??= {})[`${fps}fps`] = ok / TRIALS;
      (slope[`${shape.name} / ${style.name}`] ??= {})[`${fps}fps`] = ok ? onSlope / ok : 0;
    }
  }
}

console.log('success rate (share of 300 simulated attempts that complete the blink challenge)');
console.log(['shape / style'.padEnd(34), ...FPS_LIST.map((f) => `${f}fps`.padStart(7))].join(' '));
for (const [key, row] of Object.entries(table)) {
  console.log([key.padEnd(34), ...FPS_LIST.map((f) => `${(row[`${f}fps`] * 100).toFixed(0)}%`.padStart(7))].join(' '));
}

const failures: string[] = [];
for (const shape of SHAPES) {
  for (const style of STYLES) {
    for (const fps of FPS_LIST) {
      const rate = table[`${shape.name} / ${style.name}`][`${fps}fps`];
      if (REJECT.has(style.name) && rate > 0.011) failures.push(`${shape.name}/${style.name}@${fps}: wrongly accepted ${(rate * 100).toFixed(1)}%`);
      // Instructed blinks must work from 12 fps up, a shallow blink from 17 fps; the very fast natural blink is informational only.
      if (style.mustPass && fps >= (style.minFps ?? 12) && rate < 0.95) failures.push(`${shape.name}/${style.name}@${fps}: only ${(rate * 100).toFixed(0)}% accepted`);
      // The uploaded frame must be (near) the deepest one, not a frame on the closing slope.
      const slopeShare = slope[`${shape.name} / ${style.name}`][`${fps}fps`];
      if (style.mustPass && slopeShare > 0.05) failures.push(`${shape.name}/${style.name}@${fps}: ${(slopeShare * 100).toFixed(0)}% of uploads on the slope`);
    }
  }
}
if (failures.length > 0) {
  console.log(`\n${failures.length} expectation(s) not met:`);
  for (const line of failures) console.log(` - ${line}`);
  if (!process.env.BLINK_PROFILES_REPORT_ONLY) process.exitCode = 1;
} else {
  console.log('\nall blink-profile expectations met');
}
void assert;
void hybridActionDetected;
