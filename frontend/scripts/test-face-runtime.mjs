import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../src/workers/faceLandmarker.worker.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/services/faceLandmarkerRuntime.ts', import.meta.url), 'utf8');
const studentHome = await readFile(new URL('../src/features/student/StudentHome.tsx', import.meta.url), 'utf8');

assert.match(
  worker,
  /FilesetResolver\.forVisionTasks\(message\.wasmRoot, true\)/,
  'The ES-module worker must select the ES-module WASM loader.',
);
assert.match(
  worker,
  /modelAssetBuffer/,
  'The worker must fetch the local model into a buffer before MediaPipe initialization.',
);
assert.equal(
  (runtime.match(/new Worker\(/g) ?? []).length,
  1,
  'The shared runtime must own exactly one worker constructor.',
);
assert.match(runtime, /const INITIALIZATION_TIMEOUT_MS = 120_000/);
assert.match(runtime, /needsAppleMobileMainThreadFallback/);
assert.match(runtime, /initializeMainThread/);
assert.match(runtime, /modelAssetBuffer/);
assert.match(runtime, /document\.createElement\('canvas'\)/);
assert.match(runtime, /worker !== null \|\| mainThreadLandmarker !== null/);
assert.match(runtime, /preloadFaceLandmarker/);
assert.match(runtime, /openFaceLandmarkerClient/);
assert.match(studentHome, /void preloadFaceLandmarker\(\)/);
assert.match(
  studentHome,
  /disabled=\{faceRuntime\.status !== 'ready'\}/,
  'QR scanning must stay disabled until the face runtime is ready.',
);

console.log('Face runtime contract: module WASM, singleton preload, and QR readiness gate pass.');
