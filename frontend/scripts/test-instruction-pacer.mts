/**
 * InstructionPacer (utils/instructionPacer.ts): the scan-frame text must not change every frame.
 * Covers dwell, latest-wins, step-immediate, identical text, flush after dwell, a clock that goes
 * backwards, and the scanner wiring (every frame-loop text goes through the pacer).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INSTRUCTION_MIN_DWELL_MS, InstructionPacer } from '../src/utils/instructionPacer.ts';
import { HYBRID_TIMING_LIMITS, hybridEvidenceTimingProblem } from '../src/utils/livenessTiming.ts';
import type { HybridLivenessEvidence } from '../src/utils/liveness.ts';

assert.equal(INSTRUCTION_MIN_DWELL_MS, 1_500);

// ---- First hint shows at once; the next one waits for the dwell ----
{
  const pacer = new InstructionPacer({ minDwellMs: 1_500, initialText: 'loading' });
  assert.equal(pacer.current, 'loading');
  assert.equal(pacer.request('A', 0), 'A', 'the initial text is not held');
  assert.equal(pacer.request('B', 100), 'A', 'B waits: A was shown 100 ms ago');
  assert.equal(pacer.pending, 'B');
  assert.equal(pacer.tick(1_499), 'A', 'still inside the dwell');
  assert.equal(pacer.tick(1_500), 'B', 'shown exactly when the dwell ends');
  assert.equal(pacer.pending, null);
  // B itself is now held from 1500.
  assert.equal(pacer.request('C', 2_000), 'B');
  assert.equal(pacer.tick(2_999), 'B');
  assert.equal(pacer.tick(3_000), 'C');
}

// ---- Latest pending request wins ----
{
  const pacer = new InstructionPacer({ minDwellMs: 1_500 });
  pacer.request('A', 0);
  pacer.request('B', 200);
  pacer.request('C', 400);
  pacer.request('D', 600);
  assert.equal(pacer.pending, 'D');
  assert.equal(pacer.tick(1_600), 'D', 'B and C are never shown');
  // A request for the shown text cancels a pending hint (the latest request is what is on screen).
  pacer.request('E', 1_700);
  assert.equal(pacer.pending, 'E');
  pacer.request('D', 1_800);
  assert.equal(pacer.pending, null);
  assert.equal(pacer.tick(5_000), 'D');
}

// ---- Alternating per-frame hints: at most one change per dwell ----
{
  const pacer = new InstructionPacer({ minDwellMs: 1_500 });
  const shown: string[] = [];
  for (let t = 0; t <= 6_000; t += 50) {
    const text = pacer.request((t / 50) % 2 ? 'face' : 'still', t);
    if (shown[shown.length - 1] !== text) shown.push(text);
  }
  assert.ok(shown.length <= 5, `30 fps flicker becomes at most one change per 1.5 s (got ${shown.length})`);
}

// ---- A step is immediate and then held against hints ----
{
  const pacer = new InstructionPacer({ minDwellMs: 1_500 });
  pacer.request('hint', 0);
  assert.equal(pacer.request('STEP', 100, 'step'), 'STEP', 'a step does not wait for the dwell');
  assert.equal(pacer.pending, null, 'a step drops a pending hint');
  assert.equal(pacer.request('hint 2', 200), 'STEP', 'the step is held against hints');
  assert.equal(pacer.tick(1_599), 'STEP');
  assert.equal(pacer.tick(1_600), 'hint 2');
  // A step replaces a fresh step at once too.
  pacer.request('STEP 2', 1_700, 'step');
  assert.equal(pacer.request('STEP 3', 1_710, 'step'), 'STEP 3');
  // A pending hint before a step is dropped by the step.
  pacer.request('late hint', 1_800);
  assert.equal(pacer.request('STEP 4', 1_900, 'step'), 'STEP 4');
  assert.equal(pacer.tick(10_000), 'STEP 4', 'the dropped hint never comes back');
}

// ---- Identical text does not reset the timer ----
{
  const pacer = new InstructionPacer({ minDwellMs: 1_500 });
  pacer.request('A', 0);
  for (let t = 50; t < 1_400; t += 50) assert.equal(pacer.request('A', t), 'A');
  pacer.request('A', 1_400, 'step');
  assert.equal(pacer.request('B', 1_500), 'B', 'A was shown at 0, not at its last repeat');
}

// ---- Flush after the dwell without a new request (frames stopped) ----
{
  const pacer = new InstructionPacer({ minDwellMs: 1_500 });
  pacer.request('A', 0);
  pacer.request('B', 10);
  assert.equal(pacer.tick(1_000), 'A');
  assert.equal(pacer.tick(1_750), 'B', 'a timer tick alone shows the pending text');
  assert.equal(pacer.tick(9_000), 'B', 'nothing else is pending');
}

// ---- A clock that goes backwards (frame timestamp vs timer) never shortens the hold ----
{
  const pacer = new InstructionPacer({ minDwellMs: 1_500 });
  pacer.request('A', 1_000);
  pacer.tick(2_400);
  pacer.request('B', 2_300);
  assert.equal(pacer.current, 'A');
  assert.equal(pacer.tick(2_499), 'A');
  assert.equal(pacer.tick(2_500), 'B');
  // After a time far ahead, an older timestamp still counts as the latest seen.
  pacer.request('C', 100, 'step');
  assert.equal(pacer.request('D', 3_900), 'C', 'C was shown at 2500 (clock never ran back)');
  assert.equal(pacer.tick(4_000), 'D');
}

// ---- Scanner wiring ----
const scanner = readFileSync(new URL('../src/features/student/LivenessScanner.tsx', import.meta.url), 'utf8');
const effectStart = scanner.indexOf('useEffect(() => {\n    let animationFrame = 0;');
const effectEnd = scanner.indexOf('}, [attemptKey, challenge, selectedCameraId]);');
assert.ok(effectStart > 0 && effectEnd > effectStart, 'frame-loop effect found');
const frameLoop = scanner.slice(effectStart, effectEnd);
assert.match(frameLoop, /new InstructionPacer\(\{ minDwellMs: INSTRUCTION_MIN_DWELL_MS/);
const direct = frameLoop.match(/setInstruction\(/g) ?? [];
assert.equal(direct.length, 1, 'inside the frame loop only the pacer helper calls setInstruction');
assert.match(frameLoop, /setInstruction\(text\)/);
assert.match(frameLoop, /pacer\.tick\(performance\.now\(\)\)/, 'pending text is flushed');
assert.match(frameLoop, /window\.setInterval\(flushInstruction, INSTRUCTION_FLUSH_MS\)/, 'flushed when frames stop');
assert.match(frameLoop, /window\.clearInterval\(instructionTimer\)/);
// Errors never go through the pacer.
assert.match(frameLoop, /const fail = \(message: string\) => \{\s*if \(cancelled \|\| halted\) return;\s*halted = true;[\s\S]{0,200}setError\(message\);/);
// Blink wording.
assert.match(frameLoop, /monitor\.shortClosureDropped/);
assert.match(frameLoop, /showHint\(BLINK_TOO_SHORT_MESSAGE\)/);
assert.match(frameLoop, /BLINK_OPEN_MESSAGE/);
assert.doesNotMatch(scanner, /'ลืมตาและมองตรง'/);
// The "get ready" text: prompt only after max(promptDelayMs, PREPARE_NOTICE_MIN_MS), and promptAt is
// the frame on which the prompt is shown.
const constant = (name: string) => Number(new RegExp(`const ${name} = ([\\d_]+);`).exec(scanner)?.[1].replace(/_/g, ''));
const PREPARE_NOTICE_MIN_MS = constant('PREPARE_NOTICE_MIN_MS');
assert.equal(PREPARE_NOTICE_MIN_MS, 1_500);
assert.match(frameLoop, /prepareUntil = observation\.timestampMs \+ Math\.max\(challenge\.promptDelayMs, PREPARE_NOTICE_MIN_MS\)/);
assert.match(frameLoop, /if \(observation\.timestampMs < prepareUntil\) return;\s*\/\/[^\n]*\n\s*promptAt = observation\.timestampMs;/);
assert.doesNotMatch(frameLoop, /promptAt = observation\.timestampMs \+ challenge\.promptDelayMs/);

// Timing model: frames every 1000/fps ms, last still frame at `lastSample`; the prompt frame is the first
// frame at or after prepareUntil. The evidence must pass the Backend mirror for every signed delay.
for (const fps of [8.5, 12, 30]) {
  for (const promptDelayMs of [500, 900, 1_400]) {
    const step = 1000 / fps;
    const startedAtMs = 0;
    const samples = [1_200, 1_200 + 600, 1_200 + 1_200].map((t) => Math.ceil(t / step) * step);
    const lastSample = samples[2];
    const prepareUntil = lastSample + Math.max(promptDelayMs, PREPARE_NOTICE_MIN_MS);
    const promptAtMs = Math.ceil(prepareUntil / step) * step;
    assert.ok(promptAtMs >= lastSample + promptDelayMs);
    assert.ok(promptAtMs - lastSample >= PREPARE_NOTICE_MIN_MS, 'the get-ready text is readable');
    const actionAt = promptAtMs + 1_500;
    const recoveryAt = actionAt + 1_000;
    const evidence: HybridLivenessEvidence = {
      version: 4, mode: 'hybrid', sampleCount: 3, action: 'blink', promptDelayMs,
      frames: [
        ...samples.map((timestampMs, index) => ({ kind: 'passive_sample' as const, sampleIndex: index + 1, timestampMs })),
        { kind: 'challenge_action', action: 'blink', timestampMs: actionAt },
        { kind: 'challenge_recovery', action: 'blink', timestampMs: recoveryAt },
      ],
      startedAtMs, promptAtMs, completedAtMs: recoveryAt, effectiveFps: Math.min(fps, 30),
    };
    assert.equal(hybridEvidenceTimingProblem(evidence), null, `fps ${fps} delay ${promptDelayMs}`);
    // The extra wait over the signed delay is at most PREPARE_NOTICE_MIN_MS - 500 ms plus one frame.
    assert.ok(promptAtMs - (lastSample + promptDelayMs) <= PREPARE_NOTICE_MIN_MS - 500 + step);
    assert.ok(recoveryAt - startedAtMs < HYBRID_TIMING_LIMITS.maxAttemptMs);
  }
}

// The status line stays polite and live.
assert.match(scanner, /role="status" aria-live="polite"/);

console.log('Instruction pacer: dwell, latest-wins, step-immediate, identical text, flush after dwell, monotonic clock and scanner wiring pass.');
