import assert from 'node:assert/strict';
import { LivenessTracker, type LivenessAction, type LivenessObservation } from '../src/utils/liveness.ts';

function observation(timestampMs: number, overrides: Partial<LivenessObservation> = {}): LivenessObservation {
  return {
    timestampMs,
    faceCount: 1,
    leftEar: 0.30,
    rightEar: 0.30,
    yaw: 0,
    pitch: 0,
    faceWidthRatio: 0.42,
    centerOffset: 0.02,
    ...overrides,
  };
}

function calibrate(tracker: LivenessTracker): void {
  for (let frame = 0; frame < 12; frame += 1) tracker.add(observation(frame * 66));
}

function runValid(actions: LivenessAction[]): void {
  const tracker = new LivenessTracker(actions);
  calibrate(tracker);
  let timestamp = 900;
  for (const action of actions) {
    if (action === 'blink') {
      tracker.add(observation(timestamp, { leftEar: 0.15, rightEar: 0.15 }));
      tracker.add(observation(timestamp + 66, { leftEar: 0.15, rightEar: 0.15 }));
      tracker.add(observation(timestamp + 132));
      timestamp += 220;
    } else {
      const yaw = action === 'turn_left' ? -0.15 : 0.15;
      tracker.add(observation(timestamp, { yaw }));
      tracker.add(observation(timestamp + 100, { yaw }));
      const capture = tracker.add(observation(timestamp + 200, { yaw }));
      assert.equal(capture.captureTurn, true);
      tracker.add(observation(timestamp + 266));
      tracker.add(observation(timestamp + 332));
      tracker.add(observation(timestamp + 398));
      timestamp += 480;
    }
  }
  tracker.add(observation(timestamp));
  tracker.add(observation(timestamp + 66));
  const complete = tracker.add(observation(timestamp + 132));
  assert.equal(complete.completed, true);
  assert.deepEqual(complete.evidence?.actions, actions);
}

runValid(['blink', 'turn_left']);
runValid(['turn_right', 'blink']);

const nod = new LivenessTracker(['turn_left', 'blink']);
calibrate(nod);
for (let frame = 0; frame < 8; frame += 1) {
  const step = nod.add(observation(900 + frame * 66, { pitch: 0.22 }));
  assert.equal(step.captureTurn, false);
  assert.equal(step.completed, false);
}

const wink = new LivenessTracker(['blink', 'turn_right']);
calibrate(wink);
for (let frame = 0; frame < 4; frame += 1) {
  const step = wink.add(observation(900 + frame * 66, { leftEar: 0.14, rightEar: 0.30 }));
  assert.equal(step.progress, 0);
}

const faceLoss = new LivenessTracker(['blink', 'turn_left']);
calibrate(faceLoss);
faceLoss.add(observation(900, { leftEar: 0.15, rightEar: 0.15 }));
faceLoss.add(observation(966, { leftEar: 0.15, rightEar: 0.15 }));
assert.equal(faceLoss.add(observation(1032)).progress, 0.5);
assert.equal(faceLoss.add(observation(1098, { faceCount: 0 })).progress, 0);
assert.equal(faceLoss.add(observation(1164)).progress, 0);

console.log('Liveness tracker: valid sequences pass; nod, wink, and face-swap interruption are rejected.');
