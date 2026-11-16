/**
 * Behaviour test of the face runtime's engine switch and crash recovery (2026-11-16 field case:
 * vivo V23e in Chrome, GPU ~155 ms per frame, "runtime status error" right after the tuner asked for
 * the CPU). The real module is loaded through Vite's SSR loader with a fake Worker, so the test drives
 * the same code the browser runs:
 *  A. a slow GPU makes the tuner switch: the old worker is terminated and a NEW worker starts on the
 *     CPU (no in-worker rebuild any more), and the scanner gets 'switching' then 'switched';
 *  B. a worker that dies while on the GPU is replaced once by a fresh CPU worker, the CPU choice is
 *     remembered, and the raw error text is kept for the test panel;
 *  C. a second death (already on the CPU) fails the runtime with the Thai message plus raw detail;
 *  D. "try again" then starts directly on the remembered CPU.
 */
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const workers = [];
class FakeWorker {
  constructor() {
    this.posted = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    workers.push(this);
  }
  postMessage(message) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  reply(data) { this.onmessage?.({ data }); }
}

const store = new Map();
const storage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
};
globalThis.Worker = FakeWorker;
globalThis.window = {
  location: { origin: 'http://test.local', search: '' },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (id) => clearTimeout(id),
  localStorage: storage,
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (Linux; Android 13; V2116) Chrome/131', platform: 'Linux armv8l', maxTouchPoints: 5 },
  configurable: true,
});
const consoleError = console.error;
const loggedErrors = [];
console.error = (...args) => { loggedErrors.push(args.map(String).join(' ')); };

const server = await createServer({
  configFile: false,
  root: new URL('..', import.meta.url).pathname,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastWorker = () => workers[workers.length - 1];
const initOf = (worker) => worker.posted.find((message) => message.type === 'init');

try {
  const runtime = await server.ssrLoadModule('/src/services/faceLandmarkerRuntime.ts');

  // ---- A. tuner switch replaces the worker ----
  const preload = runtime.preloadFaceLandmarker();
  const first = lastWorker();
  assert.equal(initOf(first).delegate, 'GPU', 'an Android phone without a stored choice starts on the GPU');
  first.reply({ type: 'ready', delegate: 'GPU' });
  await preload;
  assert.equal(runtime.getFaceLandmarkerRuntimeSnapshot().status, 'ready');

  const events = [];
  const client = await runtime.openFaceLandmarkerClient((event) => events.push(event));
  const frame = { width: 360, height: 640, close() {} };
  client.postFrame(frame, 1);
  const clientId = first.posted.find((message) => message.type === 'frame').clientId;
  // 3 warm-up frames + 15 measured frames at 155 ms (all arriving at once: ~0 fps) -> switch to CPU.
  for (let index = 0; index < 18; index += 1) {
    first.reply({ type: 'result', clientId, observation: {}, frame, inferenceMs: 155, delegate: 'GPU' });
  }
  assert.equal(first.terminated, true, 'the GPU worker is terminated instead of rebuilding inside it');
  assert.ok(!first.posted.some((message) => message.type === 'switch'), 'no in-worker switch message any more');
  assert.equal(workers.length, 2, 'a new worker was created');
  assert.equal(initOf(lastWorker()).delegate, 'CPU', 'the new worker starts on the CPU');
  assert.equal(runtime.getFaceLandmarkerRuntimeSnapshot().status, 'loading');
  assert.deepEqual(events.filter((event) => event.type === 'engine').map((event) => event.phase), ['switching']);
  assert.throws(() => client.postFrame({ ...frame }, 2), /./, 'no frame is posted while the new worker starts');

  lastWorker().reply({ type: 'ready', delegate: 'CPU' });
  await tick();
  assert.equal(runtime.getFaceLandmarkerRuntimeSnapshot().status, 'ready');
  assert.equal(runtime.getFaceLandmarkerDelegate(), 'CPU');
  assert.deepEqual(events.filter((event) => event.type === 'engine').map((event) => event.phase), ['switching', 'switched']);
  // The same client keeps working on the new worker.
  client.postFrame(frame, 3);
  assert.equal(lastWorker().posted.filter((message) => message.type === 'frame').length, 1);
  assert.equal(runtime.getLastRuntimeRecovery(), null, 'a planned switch is not a crash');
  client.close();

  // ---- B. a crash on the GPU is recovered once on a fresh CPU worker ----
  store.clear();
  const retry = runtime.retryFaceLandmarkerPreload();
  const gpuWorker = lastWorker();
  assert.equal(initOf(gpuWorker).delegate, 'GPU');
  gpuWorker.reply({ type: 'ready', delegate: 'GPU' });
  await retry;
  const crashEvents = [];
  const crashClient = await runtime.openFaceLandmarkerClient((event) => crashEvents.push(event));
  const raw = 'Face Landmarker worker stopped unexpectedly (CPU fallback failed): Aborted(OOM)';
  gpuWorker.reply({ type: 'error', message: raw });
  assert.equal(gpuWorker.terminated, true);
  const recovered = lastWorker();
  assert.notEqual(recovered, gpuWorker);
  assert.equal(initOf(recovered).delegate, 'CPU');
  const loading = runtime.getFaceLandmarkerRuntimeSnapshot();
  assert.equal(loading.status, 'loading', 'the scan waits instead of failing');
  assert.match(loading.detail, /Aborted\(OOM\)/);
  assert.match(runtime.getLastRuntimeRecovery(), /Aborted\(OOM\)/);
  assert.equal(JSON.parse(store.get('face-delegate-choice.v1')).delegate, 'CPU', 'the CPU is remembered');
  assert.ok(!crashEvents.some((event) => event.type === 'error'), 'the scanner is not told to fail');
  recovered.reply({ type: 'ready', delegate: 'CPU' });
  await tick();
  assert.equal(runtime.getFaceLandmarkerRuntimeSnapshot().status, 'ready');
  assert.deepEqual(crashEvents.filter((event) => event.type === 'engine').map((event) => event.phase), ['switching', 'switched']);

  // ---- C. a second crash (already on the CPU) fails with the Thai message and raw detail ----
  const longRaw = `RuntimeError: memory access out of bounds ${'x'.repeat(400)}`;
  recovered.onerror?.({ message: longRaw, preventDefault() {} });
  const failed = runtime.getFaceLandmarkerRuntimeSnapshot();
  assert.equal(failed.status, 'error');
  assert.match(failed.error, /[ก-๙]/, 'the person sees a Thai message');
  assert.match(failed.detail, /^RuntimeError: memory access out of bounds/);
  assert.ok(failed.detail.length <= 160, 'raw detail is cut short');
  assert.equal(workers.length, 4, 'no endless restart loop (A: 2 workers, B: 2 workers, C: none)');
  assert.ok(crashEvents.some((event) => event.type === 'error'));
  crashClient.close();

  // ---- D. "try again" starts on the remembered CPU ----
  const again = runtime.retryFaceLandmarkerPreload();
  assert.equal(initOf(lastWorker()).delegate, 'CPU', 'the failing GPU path is not tried again');
  lastWorker().reply({ type: 'ready', delegate: 'CPU' });
  await again;
  assert.equal(runtime.getFaceLandmarkerRuntimeSnapshot().status, 'ready');
  // A crash on the CPU start is not "recovered" by another CPU restart.
  const cpuStart = lastWorker();
  const cpuClient = await runtime.openFaceLandmarkerClient(() => undefined);
  cpuStart.reply({ type: 'error', message: 'Face Landmarker worker stopped unexpectedly: no face landmarker graph' });
  assert.equal(runtime.getFaceLandmarkerRuntimeSnapshot().status, 'error');
  assert.equal(lastWorker(), cpuStart);
  cpuClient.close();
} finally {
  console.error = consoleError;
  await server.close();
}

console.log('Face runtime recovery: engine switch uses a fresh worker, a GPU crash restarts once on the CPU, raw detail kept, no loop.');
