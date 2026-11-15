/**
 * Phase 1.1 and 1.3 of TuningModelLog.md.
 *  - the three still frames must keep the same pose (so the Backend does not refuse them later);
 *  - a scan that cannot reach the Backend's frame-rate floor stops by itself.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EARLY_FPS_FLOOR,
  HYBRID_POSE_LIMITS,
  hybridActionDetected,
  hybridRecoveryDetected,
  EARLY_FPS_MIN_FRAMES,
  EARLY_FPS_MIN_MS,
  MIN_ATTEMPT_FPS,
  PASSIVE_POSE_LIMITS,
  PASSIVE_POSE_MESSAGES,
  PassivePoseGate,
  fpsProblem,
  measuredFps,
  observationFromLandmarker,
  passivePoseProblem,
  slowCameraMessage,
  type LivenessObservation,
} from '../src/utils/liveness.ts';

function observation(over: Partial<LivenessObservation> = {}): LivenessObservation {
  return {
    timestampMs: 0, faceCount: 1, leftEar: 0.3, rightEar: 0.3, leftBlinkScore: 0, rightBlinkScore: 0,
    yaw: 0, pitch: 0, roll: 0, faceWidthRatio: 0.4, centerOffset: 0.02, ...over,
  };
}

// ---- Roll is measured in true image units, not in normalised ones ----
function landmarks(tiltDegrees: number): Array<{ x: number; y: number }> {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  // Outer eye corners on a 4:3 frame: 0.20 of the height apart, tilted by `tiltDegrees`.
  const aspect = 4 / 3;
  const half = (0.2 / 2);
  const angle = (tiltDegrees * Math.PI) / 180;
  points[33] = { x: 0.5 - (half * Math.cos(angle)) / aspect, y: 0.45 - half * Math.sin(angle) };
  points[263] = { x: 0.5 + (half * Math.cos(angle)) / aspect, y: 0.45 + half * Math.sin(angle) };
  points[234] = { x: 0.3, y: 0.5 };
  points[454] = { x: 0.7, y: 0.5 };
  points[1] = { x: 0.5, y: 0.55 };
  points[13] = { x: 0.5, y: 0.62 };
  return points;
}
const level = observationFromLandmarker([landmarks(0)], [], 1, 4 / 3);
assert.ok(Math.abs(level.roll ?? 1) < 1e-6, 'a level head has roll 0');
const tilted = observationFromLandmarker([landmarks(10)], [], 1, 4 / 3);
assert.ok(Math.abs((tilted.roll ?? 0) - Math.sin((10 * Math.PI) / 180)) < 1e-6, 'roll equals sin(tilt) on a 4:3 frame');
const ignoredAspect = observationFromLandmarker([landmarks(10)], [], 1);
assert.ok(Math.abs((ignoredAspect.roll ?? 0) - Math.sin((10 * Math.PI) / 180)) > 0.01, 'without the aspect ratio the slope would be wrong');

// ---- Pose limits ----
const ref = observation();
assert.equal(passivePoseProblem(ref, observation({ yaw: 0.05, pitch: -0.05, roll: 0.06, faceWidthRatio: 0.42 })), null);
const cases: Array<[string, Partial<LivenessObservation>]> = [
  ['yaw', { yaw: 0.10 }],
  ['pitch', { pitch: -0.12 }],
  ['roll', { roll: 0.15 }],
  ['scale', { faceWidthRatio: 0.48 }],
  ['center', { centerOffset: 0.25 }],
];
for (const [problem, change] of cases) {
  assert.equal(passivePoseProblem(ref, observation(change)), problem);
  assert.ok(PASSIVE_POSE_MESSAGES[problem as keyof typeof PASSIVE_POSE_MESSAGES].length > 10);
}
// Old fixtures without roll still work.
assert.equal(passivePoseProblem(ref, { ...observation(), roll: undefined }), null);
// The scanner limits must stay stricter than the Backend's (yaw .14 pitch .18 roll .18 size .22).
assert.ok(PASSIVE_POSE_LIMITS.yaw < 0.14 && PASSIVE_POSE_LIMITS.pitch < 0.18);
assert.ok(PASSIVE_POSE_LIMITS.roll < 0.18 && PASSIVE_POSE_LIMITS.scale < 0.22);

// ---- Gate behaviour over time ----
function steadyHand(seed: number, count: number, amplitude: number): LivenessObservation[] {
  let a = seed;
  const random = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296 - 0.5; };
  return Array.from({ length: count }, (_, i) => observation({
    timestampMs: 450 * i,
    yaw: random() * amplitude,
    pitch: random() * amplitude,
    roll: random() * amplitude,
    faceWidthRatio: 0.4 * (1 + random() * amplitude),
  }));
}

// A hand-held phone that moves a little (+-0.04) keeps being accepted.
const gate = new PassivePoseGate();
let accepted = 0;
for (const frame of steadyHand(7, 3, 0.08)) {
  const verdict = gate.evaluate(frame);
  if (verdict.accept) { gate.commit(frame); accepted += 1; }
}
assert.equal(accepted, 3);

// A drifting frame is skipped without a restart...
const drift = new PassivePoseGate();
drift.commit(observation({ timestampMs: 0 }));
const skipped = drift.evaluate(observation({ timestampMs: 450, yaw: 0.2 }));
assert.deepEqual([skipped.accept, skipped.problem, skipped.restart], [false, 'yaw', false]);
// ...and the next steady frame is taken again.
assert.equal(drift.evaluate(observation({ timestampMs: 900, yaw: 0.02 })).accept, true);

// Someone who settled into a new pose is not stuck: after 1.2 s of mismatch the collection restarts,
// before the 1.8 s gap guard would (so the person sees the pose-specific message).
const settle = new PassivePoseGate();
settle.commit(observation({ timestampMs: 0 }));
assert.equal(settle.evaluate(observation({ timestampMs: 450, yaw: 0.3 })).restart, false);
assert.equal(settle.evaluate(observation({ timestampMs: 1_600, yaw: 0.3 })).restart, false);
const restarted = settle.evaluate(observation({ timestampMs: 1_650, yaw: 0.3 }));
assert.deepEqual([restarted.accept, restarted.restart], [false, true]);
assert.ok(450 + PASSIVE_POSE_LIMITS.restartAfterMs < 1_800, 'the pose restart is reachable before the gap guard');
// After the restart the new pose is the next reference.
assert.equal(settle.evaluate(observation({ timestampMs: 2_100, yaw: 0.3 })).accept, true);
settle.commit(observation({ timestampMs: 2_100, yaw: 0.3 }));
assert.equal(settle.evaluate(observation({ timestampMs: 2_550, yaw: 0.31 })).accept, true);

// An interruption by one good frame resets the mismatch timer.
const blip = new PassivePoseGate();
blip.commit(observation({ timestampMs: 0 }));
blip.evaluate(observation({ timestampMs: 500, yaw: 0.3 }));
blip.evaluate(observation({ timestampMs: 1_000, yaw: 0.0 }));
assert.equal(blip.evaluate(observation({ timestampMs: 1_600, yaw: 0.3 })).restart, false, 'timer restarted at 1600');
assert.equal(blip.evaluate(observation({ timestampMs: 2_700, yaw: 0.3 })).restart, false);

// ---- Frame rate ----
const at = (fps: number, count: number) => Array.from({ length: count }, (_, i) => (i * 1000) / fps);
assert.ok(Math.abs(measuredFps(at(10, 31)) - 10) < 1e-9);
assert.equal(measuredFps([5]), 0);
assert.equal(measuredFps([5, 5]), 0);
// Same formula as the Backend's range check: below 8 fails at the end of the scan, 8 and above passes.
assert.equal(fpsProblem(at(7.5, 80), 'final') !== null, true);
assert.equal(fpsProblem(at(8, 80), 'final'), null);
assert.equal(fpsProblem(at(20, 80), 'final'), null);
// The early stop needs evidence and a lower floor, because the first frames are slow.
assert.equal(fpsProblem(at(3, EARLY_FPS_MIN_FRAMES - 1), 'early'), null, 'too few frames');
assert.equal(fpsProblem(at(20, 40).slice(0, 30), 'early'), null, 'fast enough');
assert.equal(fpsProblem(at(7, 40), 'early'), null, 'between the early floor and the Backend floor: keep going');
assert.ok(fpsProblem(at(3, 40), 'early'), 'hopelessly slow: stop at once');
assert.ok((40 - 1) * 1000 / 3 >= EARLY_FPS_MIN_MS);
assert.ok(EARLY_FPS_FLOOR < MIN_ATTEMPT_FPS);
const message = slowCameraMessage(5.37);
assert.match(message, /5\.4/);
assert.match(message, /ปิดแอปอื่น/);
assert.match(message, /เครื่องอื่น/);

// ---- 1.1b: pose while the action is done and after it (compared with the FIRST still frame) ----
// Backend limits: action yaw .15 / pitch .20 / centre .30; final frame yaw .14, pitch .18, roll .18, size .20, centre .30.
assert.ok(HYBRID_POSE_LIMITS.yaw < 0.14 && HYBRID_POSE_LIMITS.pitch < 0.18 && HYBRID_POSE_LIMITS.roll < 0.18);
assert.ok(HYBRID_POSE_LIMITS.recoveryScale < 0.20 && HYBRID_POSE_LIMITS.center < 0.30);
const baseline = { leftEar: 0.30, rightEar: 0.30, faceWidthRatio: 0.40, yaw: 0, pitch: 0, roll: 0 };
const closedEyes = { leftEar: 0.08, rightEar: 0.08, leftBlinkScore: 0.9, rightBlinkScore: 0.9 };
// Steady head: accepted.
assert.equal(hybridActionDetected('blink', observation({ ...closedEyes, yaw: 0.05, pitch: 0.06 }), baseline), true);
assert.equal(hybridActionDetected('move_closer', observation({ faceWidthRatio: 0.46, yaw: 0.05 }), baseline), true);
assert.equal(hybridRecoveryDetected(observation({ yaw: 0.05, pitch: -0.05, roll: 0.05 }), baseline), true);
// A drift of 0.13 in yaw was accepted before (limit .14) and sits one model disagreement away from the
// Backend's limit: it is now refused here first.
assert.equal(hybridActionDetected('blink', observation({ ...closedEyes, yaw: 0.13 }), baseline), false);
assert.equal(hybridActionDetected('move_closer', observation({ faceWidthRatio: 0.46, yaw: 0.13 }), baseline), false);
assert.equal(hybridActionDetected('blink', observation({ ...closedEyes, pitch: -0.14 }), baseline), false);
assert.equal(hybridRecoveryDetected(observation({ yaw: 0.13 }), baseline), false);
assert.equal(hybridRecoveryDetected(observation({ pitch: 0.14 }), baseline), false);
// The final frame must also be level and about the same size; the action frame ignores roll
// (the Backend does not check it there).
assert.equal(hybridRecoveryDetected(observation({ roll: 0.16 }), baseline), false);
assert.equal(hybridActionDetected('blink', observation({ ...closedEyes, roll: 0.16 }), baseline), true);
assert.equal(hybridRecoveryDetected(observation({ faceWidthRatio: 0.40 * 1.20 }), baseline), false);
assert.equal(hybridRecoveryDetected(observation({ faceWidthRatio: 0.40 * 1.12 }), baseline), true);
// Drift adds up: a first frame that is 0.08 off a median would leave only 0.01 room, so the
// scanner must compare with the first still frame itself, exactly like the Backend.
const scannerSource = readFileSync(new URL('../src/features/student/LivenessScanner.tsx', import.meta.url), 'utf8');
assert.match(scannerSource, /const reference = passiveObservations\[0\]/);
assert.match(scannerSource, /yaw: reference\.yaw/);
assert.match(scannerSource, /pitch: reference\.pitch/);
assert.match(scannerSource, /faceWidthRatio: reference\.faceWidthRatio/);
assert.doesNotMatch(scannerSource, /yaw: median\(passiveObservations/);

// ---- The scanner really uses them ----
const scanner = readFileSync(new URL('../src/features/student/LivenessScanner.tsx', import.meta.url), 'utf8');
assert.match(scanner, /new PassivePoseGate\(\)/);
assert.match(scanner, /poseGate\.evaluate\(observation\)/);
assert.match(scanner, /poseGate\.commit\(observation\)/);
assert.match(scanner, /fpsProblem\(observedTimestamps, 'early'\)/);
assert.match(scanner, /fpsProblem\(observedTimestamps, 'final'\)/);
assert.match(scanner, /halted/);
// The final rate check must happen before the evidence is handed to the Backend call.
assert.ok(scanner.indexOf("fpsProblem(observedTimestamps, 'final')") < scanner.indexOf('callbackRef.current({'));
// The frame is only stored after the gate accepted it.
assert.ok(scanner.indexOf('poseGate.commit(observation)') < scanner.indexOf('samples.push(frameToJpeg(frame, PASSIVE_JPEG_QUALITY))'));
// The worker and the main-thread path pass the frame shape so the roll slope is right.
for (const file of ['../src/workers/faceLandmarker.worker.ts', '../src/services/faceLandmarkerRuntime.ts']) {
  assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /frame\.width \/ Math\.max\(.*frame\.height, 1\)/s);
}

console.log('Passive pose gate, action/final-frame pose margins and early frame-rate stop: limits, restart, roll units and scanner wiring pass.');
