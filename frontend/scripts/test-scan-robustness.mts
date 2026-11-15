/**
 * Android scan robustness and capture quality (2026-11-15):
 *  - frame/runtime errors are classified, one bad frame is skipped, only a sustained problem stops;
 *  - runtime load errors are no longer all "browser unsupported";
 *  - camera warm-up and motion-blur gate for the passive (PAD) frames, passive pitch 0.05;
 *  - final-frame size after move_closer (0.15, Backend 0.20), its hint and the live size guide;
 *  - test-mode client_diagnostics: enums and clamped numbers only, <= 1024 bytes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CameraFrameUnavailableError,
  FRAME_ERROR_FAIL_COUNT,
  FRAME_ERROR_FAIL_MS,
  FRAME_ERROR_MESSAGES,
  FrameErrorTolerance,
  RUNTIME_LOAD_MESSAGES,
  RUNTIME_NOT_READY_MESSAGE,
  classifyFrameError,
  classifyRuntimeLoadError,
  describeError,
} from '../src/utils/faceScanErrors.ts';
import {
  CAMERA_WARMUP_MS,
  EVIDENCE_JPEG_QUALITY,
  PASSIVE_JPEG_QUALITY,
  SHARPNESS_MAX_SKIPS,
  SHARPNESS_MIN_HISTORY,
  SharpnessGate,
  faceCropRect,
  grayFromRgba,
  laplacianSharpness,
  meanGray,
  passiveWarmupDone,
  firstSampleReady,
  FACE_PRESENCE_MS,
} from '../src/utils/captureQuality.ts';
import {
  CHOICE_STORAGE_KEY,
  CHOICE_TTL_MS,
  CPU_SAMPLE_FRAMES,
  DelegateTuner,
  GPU_SAMPLE_FRAMES,
  GPU_MIN_CYCLE_FPS,
  GPU_SLOW_MEDIAN_MS,
  SKIP_FRAMES,
  cycleFps,
  readDelegateChoice,
  saveDelegateChoice,
} from '../src/utils/delegateTuner.ts';
import {
  DIAGNOSTICS_LIMITS,
  buildClientDiagnostics,
  detectBrowser,
  detectPlatform,
  diagnosticsDelegate,
  serializeClientDiagnostics,
  fallbackClientDiagnostics,
} from '../src/utils/clientDiagnostics.ts';
import {
  CHUNK_RELOAD_GUARD_MS,
  ReloadGate,
  attendanceHoldsPage,
  enrollmentHoldsPage,
  shouldReloadAfterChunkError,
} from '../src/pwa/updateGate.ts';
import { ENGINE_SWITCH_TIMEOUT_MS, EngineSwitchGuard } from '../src/utils/engineSwitchGuard.ts';
import { BUILD_INFO, buildDiagnostics, buildLabel, parseBuildInfo } from '../src/config/buildInfo.ts';
import { PAD_RETRY_CHECKLIST, isPadFailureMessage } from '../src/utils/padFailure.ts';
import {
  HYBRID_BLINK_LIMITS,
  HYBRID_POSE_LIMITS,
  HybridActionMonitor,
  MIN_READABLE_EAR,
  blinkClosedRatioLimit,
  PASSIVE_POSE_LIMITS,
  PassivePoseGate,
  RECOVERY_MESSAGES,
  hybridRecoveryDetected,
  observationFromLandmarker,
  recoveryHint,
  recoveryScaleLimit,
  moveCloserGuide,
  MOVE_CLOSER_HOLD_MESSAGE,
  MOVE_CLOSER_RECOVERY_LATE_MESSAGE,
  type LivenessObservation,
} from '../src/utils/liveness.ts';
import {
  ATTEMPT_TIME_LIMIT_MESSAGE,
  EVIDENCE_TIMING_MESSAGE,
  HYBRID_TIMING_LIMITS,
  evidenceTimingMessage,
} from '../src/utils/livenessTiming.ts';

function observation(over: Partial<LivenessObservation> = {}): LivenessObservation {
  return {
    timestampMs: 0, faceCount: 1, leftEar: 0.3, rightEar: 0.3, leftBlinkScore: 0, rightBlinkScore: 0,
    yaw: 0, pitch: 0, roll: 0, faceWidthRatio: 0.5, centerOffset: 0.02, ...over,
  };
}

// ---- 1. Frame error classification and tolerance ----
const invalidState = Object.assign(new Error('The source image width is 0.'), { name: 'InvalidStateError' });
assert.equal(classifyFrameError(invalidState, true), 'frame');
assert.equal(classifyFrameError(new CameraFrameUnavailableError(), true), 'frame');
assert.equal(classifyFrameError(new Error(RUNTIME_NOT_READY_MESSAGE), true), 'runtime');
assert.equal(classifyFrameError(new TypeError('createImageBitmap is not a function'), true), 'unsupported');
assert.equal(classifyFrameError(invalidState, false), 'unsupported', 'no createImageBitmap at all');
assert.equal(classifyFrameError('weird', true), 'frame');
assert.match(describeError(invalidState), /^InvalidStateError: /);
assert.ok(describeError(new Error('x'.repeat(500))).length <= 160);

const oneBlip = new FrameErrorTolerance();
assert.equal(oneBlip.record('frame', 0).fatal, false, 'one bad frame is skipped');
oneBlip.success();
assert.equal(oneBlip.currentStreak, 0);
assert.equal(oneBlip.total, 1, 'the total is kept for diagnostics');

const burst = new FrameErrorTolerance();
for (let i = 0; i < FRAME_ERROR_FAIL_COUNT - 1; i += 1) {
  assert.equal(burst.record('frame', i * 50).fatal, false, `error ${i + 1} within ${(i * 50)} ms`);
}
const burstEnd = burst.record('frame', (FRAME_ERROR_FAIL_COUNT - 1) * 50);
assert.deepEqual(burstEnd, { fatal: true, kind: 'frame' }, '40 in a row stops');

const slowErrors = new FrameErrorTolerance();
assert.equal(slowErrors.record('runtime', 1_000).fatal, false);
assert.equal(slowErrors.record('runtime', 1_000 + FRAME_ERROR_FAIL_MS - 1).fatal, false);
assert.deepEqual(slowErrors.record('runtime', 1_000 + FRAME_ERROR_FAIL_MS), { fatal: true, kind: 'runtime' }, '3 s streak stops');

const interrupted = new FrameErrorTolerance();
interrupted.record('frame', 0);
interrupted.success();
assert.equal(interrupted.record('frame', 5_000).fatal, false, 'a good frame resets the streak timer');
assert.deepEqual(new FrameErrorTolerance().record('unsupported', 0), { fatal: true, kind: 'unsupported' });
// The three messages name different causes; only "unsupported" asks to update the browser.
assert.match(FRAME_ERROR_MESSAGES.unsupported, /อัปเดตเบราว์เซอร์/);
assert.doesNotMatch(FRAME_ERROR_MESSAGES.frame + FRAME_ERROR_MESSAGES.runtime, /อัปเดต/);

// ---- 1b. Runtime load errors ----
const runtimeCases: Array<[string, ReturnType<typeof classifyRuntimeLoadError>]> = [
  ['Face Landmarker worker stopped unexpectedly', 'crashed'],
  ['wasm streaming compile failed: TypeError: Failed to fetch', 'network'],
  ['Face Landmarker model request failed (503)', 'network'],
  ['WebAssembly.instantiate(): Out of memory: Cannot allocate Wasm memory for new instance', 'memory'],
  ['Aborted(OOM)', 'crashed'],
  ['Unable to create WebGL context (GPU process lost)', 'crashed'],
  ['WebAssembly is not defined', 'unsupported'],
  ["Failed to construct 'Worker': Module scripts are not supported on DedicatedWorker yet.", 'unsupported'],
  ['document is not defined', 'unsupported'],
  ["Can't find variable: document", 'unsupported'],
  ['Face Landmarker initialization timed out', 'timeout'],
  ['something else', 'unknown'],
  ['', 'unknown'],
];
for (const [message, kind] of runtimeCases) assert.equal(classifyRuntimeLoadError(message), kind, message);
assert.match(RUNTIME_LOAD_MESSAGES.unsupported, /อัปเดต/);
for (const kind of ['crashed', 'network', 'memory', 'timeout', 'unknown'] as const) {
  assert.doesNotMatch(RUNTIME_LOAD_MESSAGES[kind], /ไม่รองรับ/, `${kind} must not claim the browser is unsupported`);
}

// ---- 2a. Camera warm-up ----
assert.equal(passiveWarmupDone(null, 5_000, 10, 4), false, 'no camera frame yet');
assert.equal(passiveWarmupDone(1_000, 1_000 + CAMERA_WARMUP_MS - 1, 10, 4), false);
assert.equal(passiveWarmupDone(1_000, 1_000 + CAMERA_WARMUP_MS, 3, 4), false, 'stable frames still required');
assert.equal(passiveWarmupDone(1_000, 1_000 + CAMERA_WARMUP_MS, 4, 4), true);
assert.ok(CAMERA_WARMUP_MS >= 1_000);

// ---- 2b. Sharpness ----
const side = 32;
const rgba = (pixel: (x: number, y: number) => number) => {
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
    const value = pixel(x, y);
    const i = (y * side + x) * 4;
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
  return data;
};
const crisp = grayFromRgba(rgba((x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 220 : 30)));
const blurred = new Float32Array(side * side);
for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
  let total = 0;
  let count = 0;
  for (let dx = -3; dx <= 3; dx += 1) {
    const xx = Math.min(side - 1, Math.max(0, x + dx));
    total += crisp[y * side + xx];
    count += 1;
  }
  blurred[y * side + x] = total / count; // horizontal motion blur
}
const crispScore = laplacianSharpness(crisp, side, side);
const blurScore = laplacianSharpness(blurred, side, side);
assert.ok(crispScore > 0 && blurScore < crispScore * 0.7, `motion blur reads lower (${blurScore.toFixed(1)} vs ${crispScore.toFixed(1)})`);
assert.equal(laplacianSharpness(grayFromRgba(rgba(() => 128)), side, side), 0, 'flat image');
assert.equal(laplacianSharpness(crisp, 2, 2), 0, 'too small');
assert.ok(Math.abs(meanGray(grayFromRgba(rgba(() => 100))) - 100) < 1e-4);

const sharp = new SharpnessGate();
for (let i = 0; i < SHARPNESS_MIN_HISTORY - 1; i += 1) {
  assert.equal(sharp.evaluate(1), true, 'too little history: never blocks');
  sharp.observe(100);
}
sharp.observe(100);
assert.equal(sharp.median, 100);
assert.equal(sharp.evaluate(null), true, 'unreadable frame: no opinion');
assert.equal(sharp.evaluate(75), true);
assert.equal(sharp.evaluate(65), false, 'markedly blurrier than the median');
for (let i = 1; i < SHARPNESS_MAX_SKIPS; i += 1) assert.equal(sharp.evaluate(10), false);
assert.equal(sharp.evaluate(10), true, 'after the skip cap the next candidate is taken (no lock-out)');
assert.equal(sharp.evaluate(10), false, 'the cap counter restarts');

assert.deepEqual(faceCropRect({ faceWidthRatio: 0.25, faceCenterX: 0.5, faceCenterY: 0.5 }, 640, 360), { sx: 240, sy: 100, sw: 160, sh: 160 });
const edge = faceCropRect({ faceWidthRatio: 0.5, faceCenterX: 0.95, faceCenterY: 0.02 }, 640, 360);
assert.ok(edge && edge.sx + edge.sw <= 640 && edge.sy >= 0 && edge.sw === 320, 'clamped inside the frame');
assert.equal(faceCropRect({ faceWidthRatio: 0.3 }, 640, 360), null, 'no centre: no crop');
// The landmarker output now carries the face centre.
const mesh = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
mesh[234] = { x: 0.4, y: 0.5, z: 0 }; mesh[454] = { x: 0.6, y: 0.5, z: 0 };
mesh[33] = { x: 0.45, y: 0.45, z: 0 }; mesh[263] = { x: 0.55, y: 0.45, z: 0 }; mesh[13] = { x: 0.5, y: 0.6, z: 0 };
const centred = observationFromLandmarker([mesh], [], 1);
assert.ok(Math.abs((centred.faceCenterX ?? 0) - 0.5) < 1e-9 && Math.abs((centred.faceCenterY ?? 0) - 0.525) < 1e-9);

// ---- 2c. JPEG quality ----
assert.equal(PASSIVE_JPEG_QUALITY, 0.92);
assert.equal(EVIDENCE_JPEG_QUALITY, 0.84);

// ---- 2d. Passive pitch 0.05 and whether sampling at ~9 fps stays possible ----
assert.equal(PASSIVE_POSE_LIMITS.pitch, 0.05);
const pitchGate = new PassivePoseGate();
pitchGate.commit(observation({ pitch: 0.10 }));
assert.equal(pitchGate.evaluate(observation({ timestampMs: 450, pitch: 0.15 })).accept, true, '0.05 is still accepted');
assert.equal(pitchGate.evaluate(observation({ timestampMs: 900, pitch: 0.151 })).problem, 'pitch');
assert.equal(pitchGate.evaluate(observation({ timestampMs: 1_350, pitch: 0.05 })).accept, true, 'compared with the FIRST frame');
assert.ok(450 + PASSIVE_POSE_LIMITS.restartAfterMs < HYBRID_TIMING_LIMITS.maxSampleGapMs, 'pose restart is reachable');

/**
 * Simulated passive collection (gap guard + pose gate) at `fps`. Pitch per frame is independent
 * jitter (+-`jitter`) plus, when `walk` > 0, a slow random-walk drift (a nodding/sinking hand).
 * Returns the share that collected 3 still frames within 6 s and their median time.
 */
function sampling(limit: number, jitter: number, walk: number, fps: number, seed: number) {
  let a = seed;
  const random = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296 - 0.5; };
  const trials = 400;
  const times: number[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const gate = new PassivePoseGate();
    let samples = 0;
    let last = 0;
    let drift = 0;
    let reference: number | null = null;
    let mismatchSince: number | null = null;
    for (let t = 0; t <= 6_000 && samples < 3; t += 1000 / fps) {
      drift += random() * 2 * walk;
      const pitch = drift + random() * 2 * jitter;
      if (samples > 0 && t - last > HYBRID_TIMING_LIMITS.maxSampleGapMs) {
        gate.reset(); samples = 0; last = 0; reference = null; mismatchSince = null;
      }
      if (samples > 0 && t - last < 450) continue;
      let accept: boolean;
      if (limit === PASSIVE_POSE_LIMITS.pitch) {
        const frame = observation({ timestampMs: t, pitch });
        const verdict = gate.evaluate(frame);
        if (verdict.restart) { samples = 0; last = 0; continue; }
        accept = verdict.accept;
        if (accept) gate.commit(frame);
      } else {
        // Same rule with another pitch limit, for comparison only.
        accept = reference === null || Math.abs(pitch - reference) <= limit;
        if (!accept) {
          mismatchSince ??= t;
          if (t - mismatchSince >= PASSIVE_POSE_LIMITS.restartAfterMs) { reference = null; samples = 0; last = 0; mismatchSince = null; continue; }
        } else { reference ??= pitch; mismatchSince = null; }
      }
      if (!accept) continue;
      samples += 1;
      last = t;
      if (samples === 3) times.push(t);
    }
  }
  times.sort((x, y) => x - y);
  return { rate: times.length / trials, medianMs: times.length ? times[Math.floor(times.length / 2)] : Infinity };
}
const scenarios: Array<[string, number, number]> = [
  ['jitter +-0.02', 0.02, 0], ['jitter +-0.04', 0.04, 0], ['jitter +-0.08', 0.08, 0],
  ['drift 0.01/frame', 0.01, 0.01], ['drift 0.02/frame', 0.01, 0.02],
];
for (const [name, jitter, walk] of scenarios) {
  const now = sampling(0.05, jitter, walk, 9, 11);
  const before = sampling(0.09, jitter, walk, 9, 11);
  console.log(`9 fps ${name}: pitch 0.05 -> ${(now.rate * 100).toFixed(0)}% in ${now.medianMs.toFixed(0)} ms (0.09 was ${(before.rate * 100).toFixed(0)}% in ${before.medianMs.toFixed(0)} ms)`);
}
const ordinary = sampling(0.05, 0.02, 0, 9, 11);
assert.ok(ordinary.rate >= 0.99 && ordinary.medianMs <= 1_500, 'ordinary jitter must still finish quickly at 9 fps');
assert.ok(sampling(0.05, 0.01, 0.01, 9, 11).rate >= 0.95, 'a slowly drifting hand must still finish');

/**
 * Fuller model of the scanner's passive phase at `fps`, in the scanner's own order: gap guard ->
 * face quality (a bad frame resets the stable counter) -> warm-up + 4 stable frames + 450 ms interval
 * -> real PassivePoseGate (its restart also resets the stable counter, like restartPassive) -> real
 * SharpnessGate (every readable frame feeds the median) -> commit. Pitch = slow drift + per-frame
 * jitter; a share of frames is motion-blurred (sharpness halved). All rates are model assumptions.
 */
function passivePhase(opts: { fps: number; jitter: number; walk: number; blurShare: number; badShare: number; seed: number }) {
  let a = opts.seed;
  const random = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296 - 0.5; };
  const trials = 400;
  const times: number[] = [];
  let restarts = 0;
  let blurSkips = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const pose = new PassivePoseGate();
    const sharpGate = new SharpnessGate();
    let samples = 0;
    let last = 0;
    let stable = 0;
    let presence: number | null = null;
    let drift = 0;
    for (let t = 0; t <= 10_000 && samples < 3; t += 1000 / opts.fps) {
      drift += random() * 2 * opts.walk;
      if (samples > 0 && samples < 3 && t - last > HYBRID_TIMING_LIMITS.maxSampleGapMs) {
        pose.reset(); samples = 0; last = 0; stable = 0; presence = null; restarts += 1;
      }
      if (random() + 0.5 < opts.badShare) { stable = 0; presence = null; continue; }
      stable += 1;
      presence ??= t;
      const blurred = random() + 0.5 < opts.blurShare;
      const sharpness = (blurred ? 50 : 100) * (1 + random() * 0.2);
      const candidate = passiveWarmupDone(0, t, stable, 4)
        && (samples === 0 ? firstSampleReady(presence, t, sharpGate.median !== null) : t - last >= 450);
      if (candidate) {
        const frame = observation({ timestampMs: t, pitch: drift + random() * 2 * opts.jitter, yaw: random() * 0.04 });
        const verdict = pose.evaluate(frame);
        if (!verdict.accept) {
          if (verdict.restart) { samples = 0; last = 0; stable = 0; presence = null; restarts += 1; }
          sharpGate.observe(sharpness);
          continue;
        }
        if (!sharpGate.evaluate(sharpness)) { blurSkips += 1; sharpGate.observe(sharpness); continue; }
        sharpGate.observe(sharpness);
        pose.commit(frame);
        samples += 1;
        last = t;
        if (samples === 3) times.push(t);
      } else {
        sharpGate.observe(sharpness);
      }
    }
  }
  times.sort((x, y) => x - y);
  return {
    rate: times.length / trials,
    medianMs: times.length ? times[Math.floor(times.length / 2)] : Infinity,
    p90Ms: times.length ? times[Math.floor(times.length * 0.9)] : Infinity,
    restartsPerScan: restarts / trials,
    blurSkipsPerScan: blurSkips / trials,
  };
}
const realistic: Array<[string, { jitter: number; walk: number; blurShare: number; badShare: number }]> = [
  ['calm', { jitter: 0.02, walk: 0.003, blurShare: 0.05, badShare: 0.02 }],
  ['hand-held', { jitter: 0.03, walk: 0.008, blurShare: 0.20, badShare: 0.05 }],
  ['shaky', { jitter: 0.05, walk: 0.015, blurShare: 0.35, badShare: 0.10 }],
];
const realisticResults: Record<string, ReturnType<typeof passivePhase>> = {};
for (const [name, profile] of realistic) {
  const result = passivePhase({ fps: 9, seed: 23, ...profile });
  realisticResults[name] = result;
  console.log(`9 fps passive phase, ${name}: ${(result.rate * 100).toFixed(0)}% within 10 s, median ${result.medianMs.toFixed(0)} ms, p90 ${result.p90Ms.toFixed(0)} ms, restarts ${result.restartsPerScan.toFixed(2)}/scan, blur skips ${result.blurSkipsPerScan.toFixed(2)}/scan`);
}
assert.ok(realisticResults.calm.rate >= 0.99 && realisticResults.calm.medianMs <= 2_500, 'a calm person finishes quickly at 9 fps');
assert.ok(realisticResults['hand-held'].rate >= 0.95, 'an ordinary hand-held phone still finishes at 9 fps');

// ---- 3. Recovery after move_closer ----
assert.equal(recoveryScaleLimit('move_closer'), 0.15);
assert.equal(recoveryScaleLimit('blink'), HYBRID_POSE_LIMITS.recoveryScale);
assert.ok(recoveryScaleLimit('move_closer') <= HYBRID_POSE_LIMITS.recoveryScale && HYBRID_POSE_LIMITS.recoveryScale < 0.20);
const base = { leftEar: 0.3, rightEar: 0.3, faceWidthRatio: 0.5, yaw: 0, pitch: 0, roll: 0 };
const sized = (ratio: number) => observation({ faceWidthRatio: 0.5 * ratio });
assert.equal(hybridRecoveryDetected(sized(1.16), base, 'move_closer'), false, 'above +0.15 is refused (Backend +0.20)');
assert.equal(hybridRecoveryDetected(sized(1.165), base, 'blink'), true, 'blink unchanged (0.17)');
assert.equal(hybridRecoveryDetected(sized(1.145), base, 'move_closer'), true, '+0.13 (accepted by the Backend in real data) passes now');
assert.equal(hybridRecoveryDetected(sized(0.84), base, 'move_closer'), false);
assert.equal(recoveryHint(sized(1.2), base, 'move_closer'), 'back');
assert.equal(recoveryHint(sized(0.8), base, 'move_closer'), 'closer');
assert.equal(recoveryHint(sized(1.05), base, 'move_closer'), 'ok');
assert.equal(recoveryHint(observation({ faceCount: 0 }), base, 'move_closer'), 'no_face');
assert.equal(RECOVERY_MESSAGES.back, 'ถอยกลับไปตำแหน่งเดิม');

/** Simulated move-closer at `fps`: approach to 1.3x, then back to 1.0x over `returnMs`. */
function moveCloser(fps: number, returnMs: number, settleAt: number, seed: number) {
  let a = seed;
  const random = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296 - 0.5; };
  const monitor = new HybridActionMonitor('move_closer', base);
  let actionAt: number | null = null;
  for (let t = 0; t < 8_000; t += 1000 / fps) {
    let ratio: number;
    if (actionAt === null) ratio = Math.min(1.3, 1 + t / 1_500);
    else ratio = Math.max(settleAt, 1.3 - (1.3 - settleAt) * ((t - actionAt) / returnMs));
    const event = monitor.feed(observation({ timestampMs: t, faceWidthRatio: 0.5 * ratio * (1 + random() * 0.04) }));
    if (event === 'action_captured') actionAt = monitor.actionTimestampMs ?? t;
    if (event === 'recovered') return actionAt === null ? null : t - actionAt;
  }
  return null;
}
for (const fps of [9, 12, 30]) {
  for (const returnMs of [600, 1_000, 1_500]) {
    const took = moveCloser(fps, returnMs, 1.0, fps * 7 + returnMs);
    assert.ok(took !== null && took <= HYBRID_TIMING_LIMITS.maxActionToRecoveryMs,
      `move closer still completes at ${fps} fps, ${returnMs} ms return (took ${took} ms)`);
  }
}
assert.equal(moveCloser(9, 800, 1.18, 3), null, 'a person who stays 18% closer is never accepted');

// ---- 4. Client diagnostics ----
const androidChrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const uaCases: Array<[string, string, string]> = [
  [androidChrome, 'android', 'chrome'],
  ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36', 'android', 'samsung'],
  ['Mozilla/5.0 (Linux; Android 13; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36', 'android', 'inapp'],
  ['Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/119.0 Mobile Safari/537.36 Line/13.19.1/IAB', 'android', 'inapp'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'ios', 'safari'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1', 'ios', 'chrome'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0', 'desktop', 'edge'],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0', 'desktop', 'firefox'],
  ['curl/8', 'other', 'other'],
];
for (const [ua, platform, browser] of uaCases) {
  assert.equal(detectPlatform(ua), platform, ua);
  assert.equal(detectBrowser(ua), browser, ua);
}
assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 5, 'MacIntel'), 'ios', 'iPadOS desktop mode');
assert.equal(diagnosticsDelegate('worker', 'GPU'), 'gpu');
assert.equal(diagnosticsDelegate('worker', 'CPU'), 'cpu');
assert.equal(diagnosticsDelegate('main-thread', 'CPU'), 'main');
assert.equal(diagnosticsDelegate(null, null), 'unknown');

const diagnostics = buildClientDiagnostics({
  userAgent: androidChrome, runtimeMode: 'worker', delegate: 'GPU',
  cameraWidth: 1280, cameraHeight: 720, analysisFps: 9.4567, luma: 118.26, sharpness: 12.345,
  frameErrors: 3, warmupMs: 1520.6,
});
assert.deepEqual(diagnostics, {
  platform: 'android', browser: 'chrome', delegate: 'gpu', camera_w: 1280, camera_h: 720,
  analysis_fps: 9.46, luma: 118.3, sharpness: 12.35, frame_errors: 3, warmup_ms: 1521,
  web_build: 0, web_commit: 0,
});
const enums = new Set(['android', 'ios', 'desktop', 'other', 'chrome', 'safari', 'samsung', 'firefox', 'edge', 'inapp', 'gpu', 'cpu', 'main', 'unknown']);
for (const value of Object.values(diagnostics)) {
  assert.ok(typeof value === 'number' || value === null || (typeof value === 'string' && enums.has(value)), `enum or number only: ${value}`);
}
assert.doesNotMatch(JSON.stringify(diagnostics), /Mozilla|Android 10|Chrome\//, 'no User-Agent text');
const extreme = buildClientDiagnostics({
  userAgent: '', runtimeMode: null, delegate: null, cameraWidth: 99_999, cameraHeight: -5,
  analysisFps: 1e9, luma: Number.NaN, sharpness: 1e12, frameErrors: 1e12, warmupMs: 1e12,
});
assert.equal(extreme.camera_w, DIAGNOSTICS_LIMITS.cameraSide);
assert.equal(extreme.camera_h, 0);
assert.equal(extreme.analysis_fps, 120);
assert.equal(extreme.luma, null);
assert.equal(extreme.sharpness, 100_000);
assert.equal(extreme.frame_errors, 100_000);
assert.equal(extreme.warmup_ms, 600_000);
const serialized = serializeClientDiagnostics(extreme);
assert.ok(serialized && new TextEncoder().encode(serialized).length <= 1024);

// ---- 5. Wiring ----
const scanner = readFileSync(new URL('../src/features/student/LivenessScanner.tsx', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/services/faceLandmarkerRuntime.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
const home = readFileSync(new URL('../src/features/student/StudentHome.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(scanner, /catch \{ processing = false; fail\(/, 'no catch-all fatal frame error any more');
assert.match(scanner, /classifyFrameError\(frameError, typeof createImageBitmap === 'function'\)/);
assert.match(scanner, /if \(!video\.videoWidth \|\| !video\.videoHeight\) throw new CameraFrameUnavailableError\(\)/);
assert.match(scanner, /bitmap\?\.close\(\)/, 'a failed frame copy is released');
assert.match(scanner, /frameProblem\('runtime'/, 'a failed inference is transient');
assert.match(scanner, /frameErrors\.success\(\)/);
assert.match(scanner, /const fail = \(message: string, detail = ''\) => \{\s*if \(cancelled \|\| halted\) return;\s*halted = true;/, 'the first error wins and stops the loop');
assert.match(scanner, /passiveWarmupDone\(firstCameraFrameAt, observation\.timestampMs, stableFrames, REQUIRED_STABLE_FRAMES\)/);
assert.match(scanner, /sharpnessGate\.evaluate\(measured\?\.sharpness \?\? null\)/);
assert.ok(scanner.indexOf('sharpnessGate.evaluate(') < scanner.indexOf('samples.push(frameToJpeg(frame, PASSIVE_JPEG_QUALITY))'));
assert.match(scanner, /recoveryHint\(observation, baseline, challenge\.action\)/);
assert.match(scanner, /const clientDiagnostics = TEST_MODE/);
assert.match(scanner, /TEST_MODE && errorDetail/);
assert.match(runtime, /classifyRuntimeLoadError\(message\)/);
assert.doesNotMatch(runtime, /message\.includes\('worker'\)/, 'the old over-broad rule is gone');
assert.match(runtime, /snapshot\.status === 'error' && !initialization\) await retryFaceLandmarkerPreload\(\)/);
assert.match(api, /if \(TEST_MODE && clientDiagnostics\)/);
assert.match(api, /formData\.append\('client_diagnostics', diagnosticsJson\)/);
assert.doesNotMatch(api, /liveness_evidence', JSON\.stringify\(\{[^)]*client/, 'not inside the evidence');
assert.match(home, /setClientDiagnostics\(TEST_MODE\s*\? capture\.clientDiagnostics/);

// ---- 6. Review fixes ----
// 9: a scan that simply ran too long gets the time-limit message, other timing faults the generic one.
const timedEvidence = (startedAtMs: number, completedAtMs: number) => ({
  version: 4 as const, mode: 'hybrid' as const, sampleCount: 3 as const, action: 'blink' as const, promptDelayMs: 800,
  frames: [], startedAtMs, promptAtMs: 0, completedAtMs, effectiveFps: 10,
});
assert.equal(evidenceTimingMessage('duration', timedEvidence(0, 19_800)), ATTEMPT_TIME_LIMIT_MESSAGE);
assert.equal(evidenceTimingMessage('duration', timedEvidence(0, 500)), EVIDENCE_TIMING_MESSAGE, 'too short is not "out of time"');
assert.equal(evidenceTimingMessage('sample_gap', timedEvidence(0, 19_800)), EVIDENCE_TIMING_MESSAGE);
assert.match(ATTEMPT_TIME_LIMIT_MESSAGE, /ภายในเวลาที่กำหนด/);
assert.match(scanner, /stopSlow\(evidenceTimingMessage\(timingProblem, evidence\), frame\)/);
assert.match(scanner, /stopSlow\(ATTEMPT_TIME_LIMIT_MESSAGE\), ATTEMPT_TIMEOUT_MS\)/);
// 2: success is final and delivered once; the evidence frames are a copy.
assert.match(scanner, /frames: \[\.\.\.markers\]/);
const successAt = scanner.indexOf('callbackRef.current({');
const haltAt = scanner.lastIndexOf('halted = true;', successAt);
assert.ok(haltAt > scanner.indexOf("const timingProblem = hybridEvidenceTimingProblem(evidence)"), 'halt after the last pre-check');
assert.ok(scanner.lastIndexOf('cancelAnimationFrame(animationFrame);', successAt) > haltAt - 200);
assert.ok(scanner.lastIndexOf('if (delivered) return;', successAt) > haltAt, 'the success callback fires at most once');
// 3: the scanner never sees raw English load errors.
assert.match(runtime, /throw new Error\(snapshot\.error \|\| userFacingLoadError\(loadError\), \{ cause: loadError \}\)/);
// 4: a failed GPU->CPU rebuild (or a missing graph) fails the whole worker, so "try again" rebuilds it.
const worker = readFileSync(new URL('../src/workers/faceLandmarker.worker.ts', import.meta.url), 'utf8');
assert.match(worker, /\(CPU fallback failed\)/);
assert.match(worker, /self\.postMessage\(\{ type: 'error', message: `\$\{WORKER_STOPPED_PREFIX\}: no face landmarker graph` \}\)/);
assert.doesNotMatch(worker, /clientId: message\.clientId,\s*message: 'ระบบตรวจจับใบหน้ายังไม่พร้อมใช้งาน'/);
assert.equal(classifyRuntimeLoadError('Face Landmarker worker stopped unexpectedly (CPU fallback failed): Out of memory'), 'memory');
assert.equal(classifyRuntimeLoadError('Face Landmarker worker stopped unexpectedly: no face landmarker graph'), 'crashed');
assert.match(runtime, /if \(message\.clientId !== undefined\)[\s\S]*failWorker\(new Error\(message\.message\)\)/, 'worker-level errors reach failWorker');
// 7: the test-mode enrollment start screen shows the load error and a retry.
const register = readFileSync(new URL('../src/features/student/StudentRegister.tsx', import.meta.url), 'utf8');
const startSection = register.slice(register.indexOf("phase === 'start' && TEST_MODE"), register.indexOf("phase === 'card' && !TEST_MODE"));
assert.match(startSection, /\{faceRuntime\.error\}/);
assert.match(startSection, /retryFaceLandmarkerPreload\(\)/);
assert.match(startSection, /ลองใหม่/);

// ---- 7. F2: eye aspect ratio in true geometric units on every frame shape ----
/**
 * One face drawn in PIXELS (eye 30 px wide; lids `lid` px above/below the eye line), centred in a
 * W x H frame, then normalised the way MediaPipe does it (x / W, y / H).
 */
function faceAt(width: number, height: number, lid: number) {
  const px = (x: number, y: number) => ({ x: (width / 2 + x) / width, y: (height / 2 + y) / height, z: 0 });
  const points = Array.from({ length: 478 }, () => px(0, 0));
  const eye = (cx: number, [outer, top1, top2, inner, bottom1, bottom2]: number[]) => {
    points[outer] = px(cx - 15, -20);
    points[inner] = px(cx + 15, -20);
    points[top1] = px(cx - 5, -20 - lid);
    points[top2] = px(cx + 5, -20 - lid);
    points[bottom1] = px(cx + 5, -20 + lid);
    points[bottom2] = px(cx - 5, -20 + lid);
  };
  // Index order as in eyeAspectRatio: p1 corner, p2/p3 top, p4 corner, p5/p6 bottom.
  eye(40, [362, 385, 387, 263, 373, 380]);
  eye(-40, [33, 160, 158, 133, 153, 144]);
  points[234] = px(-75, 0);
  points[454] = px(75, 0);
  points[1] = px(0, 5);
  points[13] = px(0, 40);
  return { points, aspect: width / height };
}
const trueEar = (lid: number) => (2 * lid + 2 * lid) / (2 * 30);
const shapes: Array<[number, number]> = [[360, 640], [640, 360], [480, 640], [1280, 720], [720, 1280], [640, 480]];
for (const lid of [4.5, 2]) {
  for (const [width, height] of shapes) {
    const { points, aspect } = faceAt(width, height, lid);
    const measured = observationFromLandmarker([points], [], 1, aspect);
    for (const value of [measured.leftEar, measured.rightEar]) {
      assert.ok(Math.abs(value / trueEar(lid) - 1) <= 0.01, `${width}x${height} lid ${lid}: EAR ${value.toFixed(4)} vs true ${trueEar(lid).toFixed(4)}`);
    }
    assert.ok(Math.abs(measured.roll ?? 1) < 1e-9, 'a level face stays level');
  }
}
// The old raw formula on a 9:16 portrait phone read 0.5625x: a normal 0.30 eye looked like 0.169 and
// got the loose narrow-eye limit; now it gets the strict wide-eye limit, like the Backend.
const portrait = faceAt(360, 640, 4.5);
const portraitObs = observationFromLandmarker([portrait.points], [], 1, portrait.aspect);
const rawPortraitEar = portraitObs.leftEar * (360 / 640);
assert.ok(rawPortraitEar < HYBRID_BLINK_LIMITS.wideEar && blinkClosedRatioLimit(rawPortraitEar) > HYBRID_BLINK_LIMITS.closedRatio + 0.05, 'old reading: loose');
assert.ok(portraitObs.leftEar >= HYBRID_BLINK_LIMITS.wideEar);
assert.equal(blinkClosedRatioLimit(portraitObs.leftEar), HYBRID_BLINK_LIMITS.closedRatio, 'now: strict wide-eye limit');
// Laptop 16:9 goes DOWN: the same eye used to read 1.78x.
const laptop = faceAt(1280, 720, 4.5);
assert.ok(Math.abs(observationFromLandmarker([laptop.points], [], 1, laptop.aspect).leftEar - 0.30) < 0.003);
// A closed lid stays far above nothing / below the readable floor consistently in true units.
const closedLid = observationFromLandmarker([faceAt(360, 640, 0.5).points], [], 1, 360 / 640);
assert.ok(closedLid.leftEar < MIN_READABLE_EAR, 'a fully shut lid (true EAR 0.033) is below the readable floor on any frame');
// Without a usable aspect ratio the old square-frame behaviour is kept rather than NaN.
assert.ok(Number.isFinite(observationFromLandmarker([laptop.points], [], 1, Number.NaN).leftEar));
// Both inference paths pass the real analysis-frame shape (the bitmap MediaPipe saw).
for (const file of ['../src/workers/faceLandmarker.worker.ts', '../src/services/faceLandmarkerRuntime.ts']) {
  assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /frame\.width \/ Math\.max\(\s*(message\.)?frame\.height, 1\)/);
}

// ---- 8. Stale builds, update reloads, client_diagnostics always present, PAD retry checklist ----
// Reloads wait for every hold (scanner open, capture pending, upload running).
let reloads = 0;
const gate = new ReloadGate(() => { reloads += 1; });
gate.requestReload();
assert.equal(reloads, 1, 'nothing open: reload at once');
const scannerHold = gate.hold();
const uploadHold = gate.hold();
gate.requestReload();
gate.requestReload();
assert.equal(reloads, 1, 'never during a scan');
assert.equal(gate.isPending, true);
scannerHold();
scannerHold();
assert.equal(reloads, 1, 'a double release does not free the other hold');
uploadHold();
assert.equal(reloads, 2, 'reloads once the last hold is gone');
assert.equal(gate.isPending, false);
const idleRelease = gate.hold();
idleRelease();
assert.equal(reloads, 2, 'releasing without a pending update does not reload');

// Build identity: parsed defensively, visible as a label and as numbers.
const info = parseBuildInfo({ commit: '59c9306', dirty: true, builtAt: '2026-11-15T10:30:00.000Z' });
assert.deepEqual(info, { commit: '59c9306', dirty: true, builtAtMs: Date.parse('2026-11-15T10:30:00.000Z') });
assert.equal(buildLabel(info), '59c9306+dirty · 2026-11-15 10:30 UTC');
assert.deepEqual(buildDiagnostics(info), { web_build: Date.parse('2026-11-15T10:30:00.000Z') / 1000, web_commit: 0x59c9306 });
assert.deepEqual(parseBuildInfo({ commit: 'evil<script>', builtAt: 'x' }), { commit: 'unknown', dirty: false, builtAtMs: 0 });
assert.deepEqual(buildDiagnostics(parseBuildInfo(null)), { web_build: 0, web_commit: 0 });
assert.equal(BUILD_INFO.commit, 'unknown', 'outside a Vite build the define is absent and nothing throws');
const withBuild = buildClientDiagnostics({
  userAgent: androidChrome, runtimeMode: 'worker', delegate: 'CPU', cameraWidth: 640, cameraHeight: 480,
  analysisFps: 9, luma: null, sharpness: null, frameErrors: 0, warmupMs: 0, ...{ webBuild: 1_763_202_600, webCommit: 0x59c9306 },
});
assert.equal(withBuild.web_build, 1_763_202_600);
assert.equal(withBuild.web_commit, 0x59c9306);
// The fallback (a capture without diagnostics) is enums plus zeros, always serialisable.
for (const ua of [androidChrome, 'Mozilla/5.0 (Linux; Android 13; K; wv) AppleWebKit/537.36 Version/4.0 Chrome/120.0 Mobile Safari/537.36', '', 'x'.repeat(5_000)]) {
  const fallback = fallbackClientDiagnostics(ua, 0, '', buildDiagnostics(info));
  const json = serializeClientDiagnostics(fallback);
  assert.ok(json && new TextEncoder().encode(json).length <= 1024, 'always under the size limit');
  assert.equal(fallback.web_commit, 0x59c9306);
}
assert.equal(fallbackClientDiagnostics('Mozilla/5.0 (Linux; Android 13; K; wv) AppleWebKit/537.36 Version/4.0 Chrome/120.0 Mobile Safari/537.36').browser, 'inapp');
const worstCase = buildClientDiagnostics({
  userAgent: '', runtimeMode: null, delegate: null, cameraWidth: 8192, cameraHeight: 8192, analysisFps: 119.99,
  luma: 254.9, sharpness: 99_999.99, frameErrors: 99_999, warmupMs: 599_999, webBuild: 4_102_444_800, webCommit: 0xfffffff,
});
assert.ok((serializeClientDiagnostics(worstCase) ?? '').length < 400, 'largest possible payload is far under 1024 bytes');

// PAD refusal -> checklist (not for the face-too-small / crop errors).
const padMessage = 'ตรวจพบความเสี่ยงจากภาพถ่ายหรือหน้าจอ กรุณาลองใหม่: หันหน้าเข้าหาแสงสว่าง';
assert.equal(isPadFailureMessage(padMessage), true);
assert.equal(isPadFailureMessage(`${padMessage} [รหัส pad · คะแนนคนจริงต่อเฟรม 0.12/0.07/0.91]`), true);
assert.equal(isPadFailureMessage('ข้อความใหม่ [รหัส pad]'), true, 'a reworded Backend message still matches by code');
assert.equal(isPadFailureMessage('ใบหน้ามีขนาดเล็กเกินไปสำหรับตรวจภาพปลอม [รหัส pad_size · กรอบหน้า 50×50]'), false);
assert.equal(isPadFailureMessage('ไม่สามารถตัดบริเวณใบหน้าสำหรับตรวจภาพปลอมได้ [รหัส pad_crop]'), false);
assert.equal(isPadFailureMessage('ใบหน้าไม่ตรงกับที่ลงทะเบียน'), false);
assert.equal(isPadFailureMessage(null), false);
const checklist = PAD_RETRY_CHECKLIST.join(' ');
for (const word of ['แสง', 'ระดับสายตา', '30–40 ซม.', 'นิ่ง', 'เลนส์', 'Chrome หรือ Safari']) assert.ok(checklist.includes(word), word);

// Wiring.
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const swSource = readFileSync(new URL('../src/pwa/registerServiceWorker.ts', import.meta.url), 'utf8');
const banner = readFileSync(new URL('../src/components/TestModeBanner.tsx', import.meta.url), 'utf8');
assert.match(viteConfig, /registerType: 'autoUpdate'/);
assert.match(viteConfig, /injectRegister: false/);
assert.match(viteConfig, /skipWaiting: true/);
assert.match(viteConfig, /clientsClaim: true/);
assert.match(viteConfig, /__APP_BUILD__: JSON\.stringify\(appBuild\)/);
assert.match(mainSource, /registerAppServiceWorker\(\)/);
assert.match(swSource, /onNeedReload\(\) \{\s*appUpdateGate\.requestReload\(\);/, 'no unconditional reload');
assert.match(swSource, /visibilitychange/);
assert.match(swSource, /registration\.update\(\)/);
assert.match(scanner, /useEffect\(\(\) => holdAppUpdates\(\), \[\]\)/);
assert.match(scanner, /webBuild: buildNumbers\.web_build/);
assert.match(scanner, /fallbackClientDiagnostics\(/);
assert.match(scanner, /buildLabel\(BUILD_INFO\)/);
assert.match(banner, /buildLabel\(BUILD_INFO\)/);
assert.match(home, /capture\.clientDiagnostics \?\? fallbackClientDiagnostics\(/);
assert.match(home, /const holdsPage = attendanceHoldsPage\(\{/);
assert.match(home, /isPadFailureMessage\(resultMessage\) && <PadRetryChecklist \/>/);
assert.match(register, /isPadFailureMessage\(errorMsg\)/);
assert.match(register, /holdsPage \? holdAppUpdates\(\)/);

// ---- 9. Realme report: engine choice, fps display, easier move closer, still frame #1 ----
// A. Engine tuner. `cycleMs` is the time between delivered results (model + copy + transfer).
let tunerClock = 0;
const feedTuner = (tuner: DelegateTuner, delegate: 'GPU' | 'CPU', ms: number, count: number, cycleMs = ms + 15) => {
  let last: ReturnType<DelegateTuner['record']> = { kind: 'none' };
  for (let i = 0; i < count; i += 1) {
    tunerClock += cycleMs;
    const decision = tuner.record(delegate, ms, tunerClock);
    if (decision.kind !== 'none') last = decision;
  }
  return last;
};
const near = (value: number | null, expected: number) => value !== null && Math.abs(value - expected) < 1e-6;
const fastGpu = new DelegateTuner('GPU');
assert.deepEqual(feedTuner(fastGpu, 'GPU', 400, SKIP_FRAMES), { kind: 'none' }, 'shader-compile frames are skipped');
const fastFinal = feedTuner(fastGpu, 'GPU', 60, GPU_SAMPLE_FRAMES);
assert.ok(fastFinal.kind === 'final' && fastFinal.delegate === 'GPU' && fastFinal.gpuMs === 60 && near(fastFinal.gpuFps, 1000 / 75));
assert.equal(fastGpu.done, true);
// 6c: model time is fine (80 ms) but only ~6.7 results/s arrive (overhead) -> the CPU is tried.
const overhead = new DelegateTuner('GPU');
assert.deepEqual(feedTuner(overhead, 'GPU', 80, SKIP_FRAMES + GPU_SAMPLE_FRAMES, 150), { kind: 'switch', to: 'CPU' });
assert.ok(cycleFps([0, 100, 200]) === 10 && cycleFps([5]) === 0);
// The Realme case: GPU ~160 ms -> try the CPU; the CPU wins on DELIVERED rate.
const slowGpu = new DelegateTuner('GPU');
feedTuner(slowGpu, 'GPU', 160, SKIP_FRAMES + GPU_SAMPLE_FRAMES - 1);
tunerClock += 175;
assert.deepEqual(slowGpu.record('GPU', 160, tunerClock), { kind: 'switch', to: 'CPU' });
assert.deepEqual(slowGpu.record('GPU', 10, tunerClock + 1), { kind: 'none' }, 'late GPU results are ignored after the switch');
const cpuWins = feedTuner(slowGpu, 'CPU', 85, SKIP_FRAMES + CPU_SAMPLE_FRAMES);
assert.ok(cpuWins.kind === 'final' && cpuWins.delegate === 'CPU' && cpuWins.cpuMs === 85 && near(cpuWins.cpuFps, 10));
// 6b: a slower CPU makes the GPU the final choice; the runtime applies it after the scan closes.
const cpuWorse = new DelegateTuner('GPU');
feedTuner(cpuWorse, 'GPU', 130, SKIP_FRAMES + GPU_SAMPLE_FRAMES);
const backToGpu = feedTuner(cpuWorse, 'CPU', 220, SKIP_FRAMES + CPU_SAMPLE_FRAMES);
assert.ok(backToGpu.kind === 'final' && backToGpu.delegate === 'GPU');
const borderline = new DelegateTuner('GPU');
assert.equal(feedTuner(borderline, 'GPU', GPU_SLOW_MEDIAN_MS, SKIP_FRAMES + GPU_SAMPLE_FRAMES, 1000 / GPU_MIN_CYCLE_FPS).kind, 'final', '110 ms at 9 fps stays on the GPU');
assert.equal(new DelegateTuner('CPU').done, true, 'a CPU start is never tuned');
assert.deepEqual(new DelegateTuner('GPU').record('GPU', Number.NaN, 1), { kind: 'none' });
// 6a: the worker's own GPU->CPU fallback ends tuning.
const fellBack = new DelegateTuner('GPU');
fellBack.finish();
assert.equal(fellBack.done, true);
assert.deepEqual(fellBack.record('GPU', 300, 1), { kind: 'none' });
// Remembered per device, expiring, never throwing.
const memory = new Map<string, string>();
const store = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
saveDelegateChoice(store, { delegate: 'CPU', gpuMs: 160.4, cpuMs: 85.2, gpuFps: 5.71, cpuFps: 10.04 }, 1_000);
assert.deepEqual(JSON.parse(memory.get(CHOICE_STORAGE_KEY) ?? '{}'), { delegate: 'CPU', savedAt: 1_000, gpuMs: 160, cpuMs: 85, gpuFps: 5.7, cpuFps: 10 });
saveDelegateChoice(store, { delegate: 'CPU', gpuMs: Number.NaN, cpuMs: null }, 1_000);
assert.deepEqual(JSON.parse(memory.get(CHOICE_STORAGE_KEY) ?? '{}'), { delegate: 'CPU', savedAt: 1_000, gpuMs: null, cpuMs: null, gpuFps: null, cpuFps: null }, 'fallback save');
assert.equal(readDelegateChoice(store, 2_000), 'CPU');
assert.equal(readDelegateChoice(store, 1_000 + CHOICE_TTL_MS + 1), null, 'expired: measure again');
assert.equal(readDelegateChoice(store, 500), null, 'a clock that went backwards is not trusted');
memory.set(CHOICE_STORAGE_KEY, '{"delegate":"TPU","savedAt":1000}');
assert.equal(readDelegateChoice(store, 2_000), null);
memory.set(CHOICE_STORAGE_KEY, 'not json');
assert.equal(readDelegateChoice(store, 2_000), null);
const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
assert.equal(readDelegateChoice(throwing, 2_000), null);
saveDelegateChoice(throwing, { delegate: 'GPU', gpuMs: 50, cpuMs: null }, 1);
assert.equal(readDelegateChoice(null, 1), null);
// Expected effect at the Realme numbers: 160 ms -> 6.3 fps (Backend floor 8); a CPU at 85-100 ms
// would give 10-11.8 fps. The switch costs one rebuild (~1-3 s) and restarts the attempt once.
assert.ok(1000 / 160 < 8 && 1000 / 100 >= 8);
const workerSource = readFileSync(new URL('../src/workers/faceLandmarker.worker.ts', import.meta.url), 'utf8');
assert.match(workerSource, /message\.type === 'switch'/);
assert.match(workerSource, /inferenceMs, delegate \}/);
assert.match(runtime, /tuneDelegate\(message\.inferenceMs, message\.delegate\)/);
assert.match(runtime, /readDelegateChoice\(safeLocalStorage\(\), Date\.now\(\)\)/);
assert.match(runtime, /broadcast\(\{ type: 'engine', phase: 'switched'/);
assert.match(scanner, /message\.type === 'engine'/);
assert.match(scanner, /if \(!engineGuard\.accepts\(observation\.timestampMs\)\) \{ frame\.close\(\); return; \}/);
assert.match(scanner, /observedTimestamps\.splice\(0\);\s*startedAt = 0;/, 'the attempt timing restarts after a switch');
// A1. The fps overlay keeps its last numbers once the scan stopped (no "0.0 fps" next to 160 ms).
assert.match(scanner, /statsTimer = window\.setInterval\(\(\) => \{[\s\S]{0,260}if \(halted \|\| cancelled\) return;/);
assert.match(scanner, /overallFps: measuredFps\(observedTimestamps\)/);

// B. Move closer: final-frame size +-0.15 (Backend +-0.20), live guide, graceful late-return restart.
const guideBase = { leftEar: 0.3, rightEar: 0.3, faceWidthRatio: 0.4, yaw: 0, pitch: 0, roll: 0 };
const guideAt = (phase: 'action' | 'recovery', ratio: number) => moveCloserGuide(phase, observation({ faceWidthRatio: 0.4 * ratio }), guideBase);
assert.equal(guideAt('action', 1.0)?.state, 'closer');
assert.equal(guideAt('action', 1.0)?.label, 'เข้าใกล้อีกนิด');
assert.equal(guideAt('action', 1.3)?.state, 'hold');
assert.equal(guideAt('action', 1.3)?.label, MOVE_CLOSER_HOLD_MESSAGE);
assert.equal(guideAt('action', 1.65)?.state, 'back');
assert.equal(guideAt('recovery', 1.3)?.state, 'return');
assert.equal(guideAt('recovery', 1.3)?.label, 'ถอยกลับที่เดิม');
assert.equal(guideAt('recovery', 1.1)?.state, 'hold');
assert.equal(guideAt('recovery', 0.8)?.state, 'forward');
assert.equal(moveCloserGuide('action', observation({ faceCount: 0 }), guideBase), null);
const actionGuide = guideAt('action', 1.3);
assert.ok(actionGuide && actionGuide.zoneStart < actionGuide.marker && actionGuide.marker < actionGuide.zoneEnd, 'marker inside the drawn zone');
assert.ok(actionGuide && Math.abs(actionGuide.zoneMin - 1.12) < 1e-9 && Math.abs(actionGuide.zoneMax - 1.60) < 1e-9, 'action zone unchanged 1.12-1.60');
const returnGuide = guideAt('recovery', 1);
assert.ok(returnGuide && Math.abs(returnGuide.zoneMax - 1.15) < 1e-9 && returnGuide.zoneMax < 1.20, 'return zone within the Backend +-0.20');
assert.equal(guideAt('action', 5)?.marker, 1, 'clamped to the bar');
assert.match(MOVE_CLOSER_RECOVERY_LATE_MESSAGE, /เริ่มขั้นนี้ใหม่/);
assert.match(scanner, /: MOVE_CLOSER_RECOVERY_LATE_MESSAGE\)/);
assert.match(scanner, /setSizeGuide\(moveCloserGuide\('action', observation, baseline\)\)/);
assert.match(scanner, /setSizeGuide\(moveCloserGuide\('recovery', observation, baseline\)\)/);
assert.match(scanner, /data-testid="size-guide"/);
// Someone who comes back to +14% (refused before at 0.12, accepted by the Backend) now finishes.
assert.ok(moveCloser(9, 800, 1.14, 5) !== null, 'returning to +14% completes now');

// C. Still frame #1 waits for 500 ms of face presence and a blur history.
assert.equal(FACE_PRESENCE_MS, 500);
assert.equal(firstSampleReady(null, 5_000, true), false, 'no face yet');
assert.equal(firstSampleReady(1_000, 1_499, true), false);
assert.equal(firstSampleReady(1_000, 1_500, false), false, 'the blur gate must be able to judge frame #1');
assert.equal(firstSampleReady(1_000, 1_500, true), true);
assert.match(scanner, /firstSampleReady\(presenceSince, observation\.timestampMs, sharpnessGate\.median !== null \|\| !measured\)/);
assert.match(scanner, /stableFrames = 0;\s*presenceSince = null;/, 'a lost face restarts the presence timer');
assert.match(scanner, /presenceSince \?\?= observation\.timestampMs;/);

// ---- 10. Review round 3 ----
// 4: a load failure while an update waits reloads at once (even when held); chunk errors are loop-guarded.
let forced = 0;
const forcedGate = new ReloadGate(() => { forced += 1; });
const heldByScan = forcedGate.hold();
assert.equal(forcedGate.reloadNowIfPending(), false, 'no update waiting: no reload');
forcedGate.requestReload();
assert.equal(forced, 0, 'held');
assert.equal(forcedGate.reloadNowIfPending(), true);
assert.equal(forced, 1, 'the dead page reloads into the new build');
heldByScan();
assert.equal(forced, 1, 'the stale hold does not reload a second time');
assert.equal(shouldReloadAfterChunkError(null, 1_000), true);
assert.equal(shouldReloadAfterChunkError(1_000, 1_000 + CHUNK_RELOAD_GUARD_MS - 1), false, 'no reload loop');
assert.equal(shouldReloadAfterChunkError(1_000, 1_000 + CHUNK_RELOAD_GUARD_MS), true);
assert.equal(shouldReloadAfterChunkError(5_000, 1_000), true, 'a clock that went back does not block forever');
assert.match(runtime, /appUpdateGate\.reloadNowIfPending\(\);\n\}/, 'rejectLoad reloads when an update waits');
assert.match(swSource, /addEventListener\('vite:preloadError', handleChunkLoadError\)/);
assert.match(swSource, /if \(readChunkReloadAt\(\) !== now\) return;/, 'no storage, no reload (loop-safe)');

// 5: what holds the page, behaviourally.
const idle = { livenessActive: false, submitting: false, hasCapture: false, hasChallengeToken: false };
assert.equal(attendanceHoldsPage(idle), false);
assert.equal(attendanceHoldsPage({ ...idle, hasChallengeToken: true }), true, 'unused challenge on screen');
assert.equal(attendanceHoldsPage({ ...idle, livenessActive: true }), true);
assert.equal(attendanceHoldsPage({ ...idle, hasCapture: true }), true);
assert.equal(attendanceHoldsPage({ ...idle, submitting: true }), true);
for (const phase of ['card', 'start', 'retry']) assert.equal(enrollmentHoldsPage({ hasChallenge: false, phase }), false, phase);
for (const phase of ['challenge', 'liveness', 'saving']) assert.equal(enrollmentHoldsPage({ hasChallenge: false, phase }), true, phase);
assert.equal(enrollmentHoldsPage({ hasChallenge: true, phase: 'retry' }), true);
// The pages hold the gate through these helpers while they return true.
const holdsHome = new ReloadGate(() => { forced += 1; });
const homeStates = [idle, { ...idle, hasChallengeToken: true }, { ...idle, livenessActive: true, hasChallengeToken: true }, { ...idle, hasCapture: true, hasChallengeToken: true }, idle];
let release: (() => void) | null = null;
let reloadsBefore = forced;
holdsHome.requestReload();
reloadsBefore = forced;
holdsHome.hold()(); // nothing pending any more
for (const [index, state] of homeStates.entries()) {
  const shouldHold = attendanceHoldsPage(state);
  if (shouldHold && !release) release = holdsHome.hold();
  if (!shouldHold && release) { release(); release = null; }
  if (index === 1) holdsHome.requestReload();
  if (index < homeStates.length - 1) assert.equal(forced, reloadsBefore, `no reload at step ${index}`);
}
assert.equal(forced, reloadsBefore + 1, 'the update lands once the page is idle again');
assert.match(home, /hasChallengeToken: livenessToken !== null/);
assert.match(register, /enrollmentHoldsPage\(\{ hasChallenge: challenge !== null, phase \}\)/);

// 6b / 9: engine-switch handling of the scanner, behaviourally.
const guard = new EngineSwitchGuard();
assert.equal(guard.accepts(100), true);
assert.equal(guard.onEvent('switching', 1_000), 'pause', 'the attempt timeout is paused');
assert.equal(guard.onEvent('switching', 1_100), 'ignore');
assert.equal(guard.accepts(1_050), false, 'nothing is used while the model is rebuilt');
assert.equal(guard.onEvent('switched', 4_000), 'restart');
assert.equal(guard.accepts(3_999), false, 'a frame posted before the rebuild finished is dropped');
assert.equal(guard.accepts(4_000), true);
assert.equal(guard.restartCount, 1);
assert.equal(guard.onEvent('switched', 6_000), 'ignore', 'an unsolicited second "switched" does not restart again');
// The worker's own GPU->CPU fallback (no "switching" first) restarts once.
const fallbackGuard = new EngineSwitchGuard();
assert.equal(fallbackGuard.onEvent('switched', 2_000), 'restart');
assert.ok(ENGINE_SWITCH_TIMEOUT_MS > 20_000, 'longer than the worker GPU start timeout');
assert.match(scanner, /timeout = window\.setTimeout\(\(\) => stopSlow\(FRAME_ERROR_MESSAGES\.runtime\), ENGINE_SWITCH_TIMEOUT_MS\)/);
assert.match(runtime, /deferredSwitch = decision\.delegate;/);
assert.match(runtime, /clients\.delete\(clientId\);\s*applyDeferredSwitch\(\);/, 'the switch back runs after the scanner closed');
assert.match(runtime, /await switchDone;/);
assert.match(runtime, /tuner\.finish\(\);/);

// 3: the accepted owner risk is documented with its follow-up metric.
const livenessSource = readFileSync(new URL('../src/utils/liveness.ts', import.meta.url), 'utf8');
assert.match(livenessSource, /OWNER RISK[\s\S]{0,200}recovery_scale/);

console.log('Scan robustness: transient frame errors, runtime error classes, warm-up, blur gate, passive pitch, move-closer recovery and test-mode client diagnostics pass.');
