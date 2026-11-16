/// <reference lib="webworker" />

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  observationFromLandmarker,
  type FaceBlendshapeCategory,
  type FaceLandmarkerPoint,
} from '../utils/liveness';

type Delegate = 'GPU' | 'CPU';

// A GPU graph that never finishes starting must not hold the whole page for the long
// initialization timeout: give it a short time, then use the CPU.
const GPU_INIT_TIMEOUT_MS = 20_000;
// Worker-level errors start with this text so the page classifies them as "stopped midway".
const WORKER_STOPPED_PREFIX = 'Face Landmarker worker stopped unexpectedly';

type InitMessage = {
  type: 'init';
  wasmRoot: string;
  modelUrl: string;
  delegate: Delegate;
};

type FrameMessage = {
  type: 'frame';
  clientId: number;
  frame: ImageBitmap;
  timestampMs: number;
};

type OptionsMessage = {
  type: 'options';
  outputFaceBlendshapes: boolean;
};

/** Rebuild the graph on another engine (the page measured that it is faster on this phone). */
type SwitchMessage = {
  type: 'switch';
  delegate: Delegate;
};

type WorkerMessage = InitMessage | FrameMessage | OptionsMessage | SwitchMessage;

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let landmarker: FaceLandmarker | null = null;
let fileset: Fileset | null = null;
let modelAssetBuffer: Uint8Array | null = null;
let delegate: Delegate = 'CPU';
// Blend shapes (eye-blink scores) cost extra time on every frame, and only the "blink"
// challenge needs them, so the page switches them on just before that step.
let blendshapesOn = false;

function createLandmarker(wanted: Delegate): Promise<FaceLandmarker> {
  if (!fileset || !modelAssetBuffer) throw new Error('Face Landmarker assets are not loaded');
  return FaceLandmarker.createFromOptions(fileset, {
    // Supplying the already downloaded bytes avoids a second SDK-owned
    // request and follows MediaPipe's worker-safe model loading pattern.
    baseOptions: { modelAssetBuffer, delegate: wanted },
    runningMode: 'VIDEO',
    numFaces: 2,
    minFaceDetectionConfidence: 0.65,
    minFacePresenceConfidence: 0.65,
    minTrackingConfidence: 0.65,
    outputFaceBlendshapes: blendshapesOn,
    outputFacialTransformationMatrixes: false,
  });
}

function warmUp(target: FaceLandmarker): void {
  // Warm up the graph before the user receives a short-lived QR challenge.
  // Older browsers without OffscreenCanvas simply skip this optimization.
  if (typeof OffscreenCanvas === 'undefined') return;
  const warmup = new OffscreenCanvas(64, 64);
  target.detectForVideo(warmup, performance.now());
}

function createGpuLandmarkerWithTimeout(): Promise<FaceLandmarker> {
  return new Promise<FaceLandmarker>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('GPU Face Landmarker initialization timed out'));
    }, GPU_INIT_TIMEOUT_MS);
    createLandmarker('GPU').then(
      (created) => {
        clearTimeout(timer);
        // The attempt was already abandoned: release it instead of leaking the GPU graph.
        if (timedOut) created.close();
        else resolve(created);
      },
      (error) => {
        clearTimeout(timer);
        if (!timedOut) reject(error);
      },
    );
  });
}

/** Build the landmarker with the wanted delegate, falling back to the CPU if the GPU path fails. */
async function buildLandmarker(wanted: Delegate): Promise<void> {
  if (wanted === 'GPU') {
    try {
      const gpu = await createGpuLandmarkerWithTimeout();
      try {
        warmUp(gpu);
      } catch (warmUpError) {
        // A blank canvas may hold no face and that is fine, but a GPU/WebGL fault must not
        // be carried into the real scan: rebuild on the CPU in that case.
        const text = warmUpError instanceof Error ? warmUpError.message.toLowerCase() : '';
        if (/gl|gpu|texture|shader|context|webgl/.test(text)) {
          gpu.close();
          throw warmUpError;
        }
      }
      landmarker = gpu;
      delegate = 'GPU';
      return;
    } catch {
      // Fall through to the CPU graph.
    }
  }
  const cpu = await createLandmarker('CPU');
  try {
    warmUp(cpu);
  } catch {
    // Initialization succeeded; unsupported warm-up input is non-fatal.
  }
  landmarker = cpu;
  delegate = 'CPU';
}

function detect(frame: ImageBitmap, timestampMs: number) {
  if (!landmarker) throw new Error('ระบบตรวจจับใบหน้ายังไม่พร้อมใช้งาน');
  return landmarker.detectForVideo(frame, timestampMs);
}

async function handleMessage(message: WorkerMessage): Promise<void> {
  if (message.type === 'init') {
    try {
      // This worker is an ES module, so the Emscripten module loader must also
      // be selected. The classic loader cannot install ModuleFactory here.
      fileset = await FilesetResolver.forVisionTasks(message.wasmRoot, true);
      const modelResponse = await fetch(message.modelUrl, { cache: 'force-cache' });
      if (!modelResponse.ok) {
        throw new Error(`Face Landmarker model request failed (${modelResponse.status})`);
      }
      modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());
      await buildLandmarker(message.delegate);
      self.postMessage({ type: 'ready', delegate });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'โหลดโมเดลตรวจจับใบหน้าไม่สำเร็จ',
      });
    }
    return;
  }

  if (message.type === 'options') {
    if (!landmarker || message.outputFaceBlendshapes === blendshapesOn) return;
    const startedAt = performance.now();
    try {
      await landmarker.setOptions({ outputFaceBlendshapes: message.outputFaceBlendshapes });
      blendshapesOn = message.outputFaceBlendshapes;
      self.postMessage({ type: 'options-applied', ms: performance.now() - startedAt });
    } catch {
      // Keep the previous setting; the scan then fails with its normal timeout message.
    }
    return;
  }

  if (message.type === 'switch') {
    if (message.delegate === delegate && landmarker) {
      self.postMessage({ type: 'delegate', delegate });
      return;
    }
    landmarker?.close();
    landmarker = null;
    try {
      // A GPU request still falls back to the CPU inside buildLandmarker if the GPU cannot start.
      await buildLandmarker(message.delegate);
    } catch (switchError) {
      const text = switchError instanceof Error ? switchError.message : String(switchError);
      self.postMessage({ type: 'error', message: `${WORKER_STOPPED_PREFIX} (delegate switch failed): ${text}` });
      return;
    }
    self.postMessage({ type: 'delegate', delegate });
    return;
  }

  if (!landmarker) {
    // No graph after initialization means an earlier rebuild failed: report it for the whole worker
    // (no clientId), so the page marks the runtime as failed and "try again" builds a new worker
    // instead of reusing this broken one forever.
    message.frame.close();
    self.postMessage({ type: 'error', message: `${WORKER_STOPPED_PREFIX}: no face landmarker graph` });
    return;
  }

  try {
    let result;
    let detectStartedAt = performance.now();
    try {
      result = detect(message.frame, message.timestampMs);
    } catch (firstError) {
      if (delegate !== 'GPU') throw firstError;
      // The GPU path failed on a real frame: switch to the CPU for the rest of the session.
      landmarker.close();
      landmarker = null;
      try {
        await buildLandmarker('CPU');
      } catch (rebuildError) {
        // For example out of memory on a low-RAM phone: the worker cannot analyse any more frames.
        message.frame.close();
        const text = rebuildError instanceof Error ? rebuildError.message : String(rebuildError);
        self.postMessage({ type: 'error', message: `${WORKER_STOPPED_PREFIX} (CPU fallback failed): ${text}` });
        return;
      }
      self.postMessage({ type: 'delegate', delegate });
      detectStartedAt = performance.now();
      result = detect(message.frame, message.timestampMs);
    }
    // Model time only (no copy/transfer): the page compares engines with it.
    const inferenceMs = performance.now() - detectStartedAt;
    const faces = result.faceLandmarks as FaceLandmarkerPoint[][];
    const blendshapes = result.faceBlendshapes.map((item) => (
      item.categories.map((category) => ({
        categoryName: category.categoryName,
        score: category.score,
      }))
    )) as FaceBlendshapeCategory[][];
    const observation = observationFromLandmarker(
      faces,
      blendshapes,
      message.timestampMs,
      message.frame.width / Math.max(message.frame.height, 1),
    );
    self.postMessage(
      { type: 'result', clientId: message.clientId, observation, frame: message.frame, inferenceMs, delegate },
      { transfer: [message.frame] },
    );
  } catch (error) {
    message.frame.close();
    self.postMessage({
      type: 'error',
      clientId: message.clientId,
      message: error instanceof Error ? error.message : 'ประมวลผลภาพจากกล้องไม่สำเร็จ',
    });
  }
}

// Handle messages strictly one after another so an option change can never overlap a frame.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  queue = queue.then(() => handleMessage(event.data)).catch(() => undefined);
};
