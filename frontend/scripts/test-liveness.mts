import assert from 'node:assert/strict';
import { LivenessTracker, type LivenessObservation } from '../src/utils/liveness.ts';

function observation(timestampMs: number, overrides: Partial<LivenessObservation> = {}): LivenessObservation {
  return {
    timestampMs,
    faceCount: 1,
    leftEar: 0.30,
    rightEar: 0.31,
    leftBlinkScore: 0.05,
    rightBlinkScore: 0.05,
    yaw: 0,
    pitch: 0,
    faceWidthRatio: 0.40,
    centerOffset: 0.02,
    ...overrides,
  };
}

function calibrate(tracker: LivenessTracker): number {
  let timestamp = 0;
  for (let frame = 0; frame < 10; frame += 1) {
    tracker.add(observation(timestamp));
    timestamp += 50;
  }
  return timestamp;
}

function moveNearAndReturn(tracker: LivenessTracker, timestamp: number): number {
  tracker.add(observation(timestamp, { faceWidthRatio: 0.46 }));
  const near = tracker.add(observation(timestamp + 50, { faceWidthRatio: 0.47 }));
  assert.deepEqual(near.captures.map((capture) => capture.kind), ['near']);
  tracker.add(observation(timestamp + 100));
  const returned = tracker.add(observation(timestamp + 150));
  assert.deepEqual(returned.captures.map((capture) => capture.kind), ['returned']);
  return timestamp + 150;
}

function runValid(requiredBlinks: 1 | 2): void {
  const promptDelay = 500;
  const tracker = new LivenessTracker(['move_closer', 'blink'], requiredBlinks, promptDelay);
  let timestamp = calibrate(tracker);
  const returnedAt = moveNearAndReturn(tracker, timestamp);
  timestamp = returnedAt + promptDelay;
  tracker.add(observation(timestamp));

  for (let blinkIndex = 1; blinkIndex <= requiredBlinks; blinkIndex += 1) {
    timestamp += 50;
    tracker.add(observation(timestamp, {
      leftEar: 0.15,
      rightEar: 0.15,
      leftBlinkScore: 0.8,
      rightBlinkScore: 0.82,
    }));
    timestamp += 50;
    const closed = tracker.add(observation(timestamp, {
      leftEar: 0.14,
      rightEar: 0.14,
      leftBlinkScore: 0.85,
      rightBlinkScore: 0.86,
    }));
    assert.deepEqual(closed.captures.map((capture) => capture.kind), ['blink_closed']);
    timestamp += 50;
    const reopened = tracker.add(observation(timestamp));
    assert.deepEqual(reopened.captures.map((capture) => capture.kind), ['blink_open']);
  }

  tracker.add(observation(timestamp + 50));
  const complete = tracker.add(observation(timestamp + 100));
  assert.equal(complete.completed, true);
  assert.equal(complete.evidence?.version, 2);
  assert.equal(complete.evidence?.blinks.length, requiredBlinks);
  assert.deepEqual(complete.evidence?.frames.map((frame) => frame.kind), [
    'baseline_open',
    'near',
    'returned',
    ...Array.from({ length: requiredBlinks }, () => ['blink_closed', 'blink_open']).flat(),
    'final_open',
  ]);
}

runValid(1);
runValid(2);

// Phone-as-webcam bridges commonly fluctuate around 9–11 FPS and introduce
// small geometry noise. This remains a full move/return + bilateral blink,
// not a bypass of the challenge.
const variableFpsCamera = new LivenessTracker(['move_closer', 'blink'], 1, 650);
let timestamp = 0;
for (let frame = 0; frame < 10; frame += 1) {
  variableFpsCamera.add(observation(timestamp, {
    yaw: frame % 2 === 0 ? 0.025 : -0.02,
    pitch: frame % 3 === 0 ? 0.03 : -0.015,
    centerOffset: 0.08,
  }));
  timestamp += frame % 2 === 0 ? 95 : 115;
}
variableFpsCamera.add(observation(timestamp, { faceWidthRatio: 0.435, yaw: 0.08, pitch: 0.09 }));
timestamp += 115;
variableFpsCamera.add(observation(timestamp, { faceWidthRatio: 0.44, yaw: 0.09, pitch: 0.10 }));
timestamp += 95;
variableFpsCamera.add(observation(timestamp, { faceWidthRatio: 0.41, yaw: 0.04, pitch: 0.04 }));
timestamp += 115;
const noisyReturned = variableFpsCamera.add(observation(timestamp, {
  faceWidthRatio: 0.405,
  yaw: 0.03,
  pitch: 0.04,
}));
assert.deepEqual(noisyReturned.captures.map((capture) => capture.kind), ['returned']);
const returnedTimestamp = timestamp;
for (let waitFrame = 1; waitFrame <= 6; waitFrame += 1) {
  variableFpsCamera.add(observation(returnedTimestamp + waitFrame * 100));
}
timestamp = returnedTimestamp + 650;
variableFpsCamera.add(observation(timestamp));
timestamp += 95;
variableFpsCamera.add(observation(timestamp, {
  leftEar: 0.18,
  rightEar: 0.18,
  leftBlinkScore: 0.70,
  rightBlinkScore: 0.72,
}));
timestamp += 115;
variableFpsCamera.add(observation(timestamp, {
  leftEar: 0.17,
  rightEar: 0.17,
  leftBlinkScore: 0.76,
  rightBlinkScore: 0.75,
}));
timestamp += 95;
variableFpsCamera.add(observation(timestamp));
timestamp += 115;
variableFpsCamera.add(observation(timestamp, { yaw: 0.04, pitch: 0.04 }));
timestamp += 95;
const noisyComplete = variableFpsCamera.add(observation(timestamp, { yaw: 0.03, pitch: 0.03 }));
assert.equal(noisyComplete.completed, true);
assert.ok((noisyComplete.evidence?.effectiveFps ?? 0) >= 8);

const staticPhoto = new LivenessTracker(['move_closer', 'blink'], 1, 500);
timestamp = calibrate(staticPhoto);
for (let frame = 0; frame < 20; frame += 1) {
  const step = staticPhoto.add(observation(timestamp + frame * 50));
  assert.equal(step.completed, false);
  assert.equal(step.captures.length, 0);
}

const nod = new LivenessTracker(['move_closer', 'blink'], 1, 500);
timestamp = calibrate(nod);
for (let frame = 0; frame < 8; frame += 1) {
  const step = nod.add(observation(timestamp + frame * 50, { faceWidthRatio: 0.48, pitch: 0.22 }));
  assert.equal(step.completed, false);
  assert.equal(step.captures.length, 0);
}

const wink = new LivenessTracker(['move_closer', 'blink'], 1, 400);
timestamp = calibrate(wink);
const returnedAt = moveNearAndReturn(wink, timestamp);
timestamp = returnedAt + 400;
wink.add(observation(timestamp));
for (let frame = 1; frame <= 5; frame += 1) {
  const step = wink.add(observation(timestamp + frame * 50, {
    leftEar: 0.14,
    rightEar: 0.31,
    leftBlinkScore: 0.85,
    rightBlinkScore: 0.05,
  }));
  assert.equal(step.completed, false);
  assert.equal(step.captures.length, 0);
}

const faceLoss = new LivenessTracker(['move_closer', 'blink'], 1, 500);
timestamp = calibrate(faceLoss);
faceLoss.add(observation(timestamp, { faceWidthRatio: 0.47 }));
faceLoss.add(observation(timestamp + 50, { faceWidthRatio: 0.48 }));
faceLoss.add(observation(timestamp + 100, { faceWidthRatio: 0.49 }));
for (let frame = 1; frame <= 9; frame += 1) {
  faceLoss.add(observation(timestamp + 100 + frame * 50, { faceCount: 0, leftEar: 0, rightEar: 0 }));
}
const resetStep = faceLoss.add(observation(timestamp + 600));
assert.equal(resetStep.progress, 0.10);

console.log('Liveness v2 tracker: normal and variable-FPS cameras pass; static, nod, wink, and face loss do not.');
