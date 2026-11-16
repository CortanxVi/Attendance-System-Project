/**
 * Plan items 1.2 and 1.4 of TuningModelLog.md, plus the evidence timing guards from the real phone data:
 *  - move-closer must land in 1.12-1.60 here (Backend 1.08-1.70) and the UI keeps saying which way to go;
 *  - still frames more than 1.8 s apart and an action->recovery span over 2.7 s are never uploaded
 *    (Backend 2.0 s / 3.0 s), and every other Backend timing rule is mirrored before upload;
 *  - low-light and in-app-browser hints (advisory only).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HYBRID_MOVE_CLOSER_LIMITS,
  MOVE_CLOSER_MESSAGES,
  PASSIVE_POSE_LIMITS,
  hybridActionDetected,
  moveCloserHint,
  moveCloserScaleOk,
  type HybridLivenessEvidence,
  type LivenessObservation,
} from '../src/utils/liveness.ts';
import {
  HYBRID_TIMING_LIMITS,
  actionRecoveryExpired,
  hybridEvidenceTimingProblem,
  passiveSampleGapExpired,
} from '../src/utils/livenessTiming.ts';
import {
  LOW_LIGHT_CLEAR_LUMA,
  LOW_LIGHT_HOLD_MS,
  LOW_LIGHT_LUMA,
  LOW_LIGHT_MESSAGE,
  LowLightMonitor,
  meanLuma,
} from '../src/utils/lightLevel.ts';
import { IN_APP_BROWSER_MESSAGE, detectInAppBrowser } from '../src/utils/inAppBrowser.ts';

function observation(over: Partial<LivenessObservation> = {}): LivenessObservation {
  return {
    timestampMs: 0, faceCount: 1, leftEar: 0.3, rightEar: 0.3, leftBlinkScore: 0, rightBlinkScore: 0,
    yaw: 0, pitch: 0, roll: 0, faceWidthRatio: 0.4, centerOffset: 0.02, ...over,
  };
}
// A power-of-two baseline width keeps ratio * width / width exact, so the boundaries are tested exactly.
const baseline = { leftEar: 0.30, rightEar: 0.30, faceWidthRatio: 0.50, yaw: 0, pitch: 0, roll: 0 };
const atScale = (ratio: number, over: Partial<LivenessObservation> = {}) =>
  observation({ faceWidthRatio: 0.50 * ratio, ...over });

// ---- 1.2 Move-closer range: stricter than the Backend's 1.08-1.70 ----
assert.ok(HYBRID_MOVE_CLOSER_LIMITS.minScale > 1.08 && HYBRID_MOVE_CLOSER_LIMITS.maxScale < 1.70);
assert.equal(moveCloserScaleOk(1.07), false, 'the refused real-data value');
assert.equal(moveCloserScaleOk(1.08), false, 'the Backend edge is no longer accepted here');
assert.equal(moveCloserScaleOk(1.11), false);
assert.equal(moveCloserScaleOk(1.12), true);
assert.equal(moveCloserScaleOk(1.60), true);
assert.equal(moveCloserScaleOk(1.61), false);
assert.equal(moveCloserScaleOk(1.70), false);
// The same boundaries through the detector the monitor uses.
assert.equal(hybridActionDetected('move_closer', atScale(1.11), baseline), false);
assert.equal(hybridActionDetected('move_closer', atScale(1.12), baseline), true);
assert.equal(hybridActionDetected('move_closer', atScale(1.60), baseline), true);
assert.equal(hybridActionDetected('move_closer', atScale(1.61), baseline), false);
// A turned head is still refused at a good size.
assert.equal(hybridActionDetected('move_closer', atScale(1.3, { yaw: 0.13 }), baseline), false);
// The hint tells which way to go.
assert.equal(moveCloserHint(atScale(1.0), baseline), 'closer');
assert.equal(moveCloserHint(atScale(1.11), baseline), 'closer');
assert.equal(moveCloserHint(atScale(1.12), baseline), 'ok');
assert.equal(moveCloserHint(atScale(1.60), baseline), 'ok');
assert.equal(moveCloserHint(atScale(1.61), baseline), 'back');
assert.equal(moveCloserHint(atScale(1.3, { yaw: 0.2 }), baseline), 'pose');
assert.equal(moveCloserHint(observation({ faceCount: 0 }), baseline), 'no_face');
assert.match(MOVE_CLOSER_MESSAGES.closer, /เข้าใกล้/);
assert.match(MOVE_CLOSER_MESSAGES.back, /ถอย/);

// ---- Timing guards: stricter than the Backend (250-2000 ms gaps, recovery - action <= 5000 ms) ----
assert.ok(HYBRID_TIMING_LIMITS.maxSampleGapMs < 2_000 && HYBRID_TIMING_LIMITS.minSampleGapMs >= 250);
assert.ok(HYBRID_TIMING_LIMITS.maxActionToRecoveryMs < 5_000);
assert.ok(HYBRID_TIMING_LIMITS.minAttemptMs >= 900 && HYBRID_TIMING_LIMITS.maxAttemptMs < 30_000);
assert.ok(HYBRID_TIMING_LIMITS.minFps >= 8 && HYBRID_TIMING_LIMITS.maxFps < 35);
// Passive gap: only a started, unfinished set can expire, and only past 1.8 s.
assert.equal(passiveSampleGapExpired(1_000, 2_800, 1, 3), false, 'exactly 1800 ms is still fine');
assert.equal(passiveSampleGapExpired(1_000, 2_801, 1, 3), true);
assert.equal(passiveSampleGapExpired(1_000, 2_801, 2, 3), true);
assert.equal(passiveSampleGapExpired(0, 9_999, 0, 3), false, 'nothing kept yet');
assert.equal(passiveSampleGapExpired(1_000, 9_999, 3, 3), false, 'set already complete');
// The pose gate's own restart (1.2 s of mismatch, starting >= 450 ms after the last kept frame) fires
// before the 1.8 s gap guard, and neither can produce a > 2 s gap.
assert.ok(450 + PASSIVE_POSE_LIMITS.restartAfterMs < HYBRID_TIMING_LIMITS.maxSampleGapMs);
assert.ok(HYBRID_TIMING_LIMITS.maxSampleGapMs < 2_000);
// Action -> recovery.
assert.equal(actionRecoveryExpired(5_000, 9_700), false);
assert.equal(actionRecoveryExpired(5_000, 9_701), true);

function evidence(over: Partial<HybridLivenessEvidence> = {}, times = [1_000, 1_500, 2_000], action = 3_400, recovery = 4_400): HybridLivenessEvidence {
  return {
    version: 4,
    mode: 'hybrid',
    sampleCount: 3,
    action: 'blink',
    promptDelayMs: 800,
    frames: [
      ...times.map((timestampMs, index) => ({ kind: 'passive_sample' as const, sampleIndex: index + 1, timestampMs })),
      { kind: 'challenge_action', action: 'blink', timestampMs: action },
      { kind: 'challenge_recovery', action: 'blink', timestampMs: recovery },
    ],
    startedAtMs: 500,
    promptAtMs: 2_800,
    completedAtMs: recovery,
    effectiveFps: 15,
    ...over,
  };
}
assert.equal(hybridEvidenceTimingProblem(evidence()), null, 'a normal scan passes');
assert.equal(hybridEvidenceTimingProblem(evidence({}, [1_000, 2_900, 3_400])), 'sample_gap', '1900 ms gap: Backend allows, web refuses');
assert.equal(hybridEvidenceTimingProblem(evidence({ promptAtMs: 4_300 }, [1_000, 2_800, 3_500], 4_400, 5_000)), null, '1800 ms gap is fine');
assert.equal(hybridEvidenceTimingProblem(evidence({}, [1_000, 1_200, 2_000])), 'sample_gap', 'too close');
assert.equal(hybridEvidenceTimingProblem(evidence({}, undefined, 3_400, 8_200)), 'recovery_late', '4800 ms');
assert.equal(hybridEvidenceTimingProblem(evidence({}, undefined, 3_400, 8_100)), null, '4700 ms');
assert.equal(hybridEvidenceTimingProblem(evidence({ startedAtMs: 1_200 })), 'sample_order');
assert.equal(hybridEvidenceTimingProblem(evidence({ promptAtMs: 2_700 })), 'prompt_order');
assert.equal(hybridEvidenceTimingProblem(evidence({}, undefined, 2_700, 3_500)), 'action_order');
assert.equal(hybridEvidenceTimingProblem(evidence({}, undefined, 3_400, 3_400)), 'recovery_order');
assert.equal(hybridEvidenceTimingProblem(evidence({ completedAtMs: 4_300 })), 'recovery_order');
assert.equal(hybridEvidenceTimingProblem(evidence({ startedAtMs: 0, completedAtMs: 30_000 }, [1_000, 1_500, 2_000], 3_400, 4_400)), 'duration');
assert.equal(hybridEvidenceTimingProblem(evidence({ effectiveFps: 7.9 })), 'fps');
assert.equal(hybridEvidenceTimingProblem(evidence({ effectiveFps: 34.5 })), 'fps');
assert.equal(hybridEvidenceTimingProblem(evidence({ effectiveFps: Number.NaN })), 'frames');
assert.equal(hybridEvidenceTimingProblem({ ...evidence(), frames: evidence().frames.slice(1) }), 'frames');

// ---- 1.4a Low light (advisory) ----
const flat = (value: number, pixels = 32 * 24) => {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255; }
  return data;
};
assert.ok(Math.abs(meanLuma(flat(100)) - 100) < 1e-9);
assert.equal(meanLuma(new Uint8ClampedArray(0)), 0);
assert.ok(Math.abs(meanLuma(new Uint8ClampedArray([255, 0, 0, 255])) - 0.299 * 255) < 1e-9, 'BT.601 red weight');
assert.ok(Math.abs(meanLuma(new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 255, 255])) - (0.587 + 0.114) * 255 / 2) < 1e-9);
const light = new LowLightMonitor();
assert.equal(light.update(LOW_LIGHT_LUMA - 1, 0), false, 'dark for 0 ms');
assert.equal(light.update(LOW_LIGHT_LUMA - 1, LOW_LIGHT_HOLD_MS - 1), false);
assert.equal(light.update(LOW_LIGHT_LUMA - 1, LOW_LIGHT_HOLD_MS), true, 'dark for 1.5 s');
assert.equal(light.update(LOW_LIGHT_LUMA + 1, LOW_LIGHT_HOLD_MS + 500), true, 'hysteresis: stays until clearly brighter');
assert.equal(light.update(LOW_LIGHT_CLEAR_LUMA, LOW_LIGHT_HOLD_MS + 1_000), false);
const flicker = new LowLightMonitor();
flicker.update(10, 0);
flicker.update(200, 700);
assert.equal(flicker.update(10, 1_600), false, 'one bright frame resets the timer');
assert.match(LOW_LIGHT_MESSAGE, /แสงน้อย/);

// ---- 1.4b In-app browsers (advisory) ----
const uas: Array<[string, ReturnType<typeof detectInAppBrowser>]> = [
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.0]', 'facebook'],
  ['Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/445.0.0.0;]', 'facebook'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.20.0', 'line'],
  ['Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/119.0 Mobile Safari/537.36 Line/13.19.1/IAB', 'line'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 305.0.0.0 (iPhone14,5; iOS 17_0)', 'instagram'],
  ['Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/118.0 Mobile Safari/537.36 MicroMessenger/8.0.40', 'wechat'],
  ['Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/118.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview/d8a21c6', 'tiktok'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 TikTok 32.0.0', 'tiktok'],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36', null],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', null],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0', null],
  ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/125.0 Outline/1.0', null],
];
for (const [ua, expected] of uas) assert.equal(detectInAppBrowser(ua), expected, ua);
assert.equal(detectInAppBrowser(''), null);
assert.equal(detectInAppBrowser(undefined), null);
assert.match(IN_APP_BROWSER_MESSAGE, /Chrome หรือ Safari/);

// ---- The scanner really uses them ----
const scanner = readFileSync(new URL('../src/features/student/LivenessScanner.tsx', import.meta.url), 'utf8');
assert.match(scanner, /passiveSampleGapExpired\(lastSampleAt, observation\.timestampMs, samples\.length, SAMPLE_COUNT\)/);
assert.match(scanner, /actionRecoveryExpired\(actionAt, observation\.timestampMs\)/);
assert.match(scanner, /moveCloserHint\(observation, baseline\)/);
assert.match(scanner, /detectInAppBrowser\(navigator\.userAgent\)/);
assert.match(scanner, /lightMonitor\.update\(luma, timestampMs\)/);
// The gap guard runs before the frame can be stored; the timing check before the upload callback.
assert.ok(scanner.indexOf('passiveSampleGapExpired(') < scanner.indexOf('samples.push(frameToJpeg(frame, PASSIVE_JPEG_QUALITY))'));
assert.ok(scanner.indexOf('hybridEvidenceTimingProblem(evidence)') < scanner.indexOf('callbackRef.current({'));
// The attempt timeout halts frame handling, so a late action cannot send an over-long scan.
assert.match(scanner, /timeout = window\.setTimeout\(\(\) => stopSlow\(/);
// Hints are advisory: the light level never stops the scan.
assert.doesNotMatch(scanner, /stopSlow\(LOW_LIGHT_MESSAGE|fail\(LOW_LIGHT_MESSAGE/);

console.log('Move-closer 1.12-1.60 range and hints, Backend timing mirrors, low-light and in-app browser hints pass.');
