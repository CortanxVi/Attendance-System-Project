import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import {
  observationFromLandmarker,
  type FaceBlendshapeCategory,
  type FaceLandmarkerPoint,
  type LivenessObservation,
} from '../utils/liveness';

export type FaceLandmarkerRuntimeStatus = 'idle' | 'loading' | 'ready' | 'error';

export type FaceLandmarkerRuntimeSnapshot = {
  status: FaceLandmarkerRuntimeStatus;
  error: string;
};

export type FaceLandmarkerResult = {
  type: 'result';
  observation: LivenessObservation;
  frame: ImageBitmap;
};

export type FaceLandmarkerFailure = {
  type: 'error';
  message: string;
};

export type FaceLandmarkerClientEvent = FaceLandmarkerResult | FaceLandmarkerFailure;

export type FaceLandmarkerClient = {
  postFrame: (frame: ImageBitmap, timestampMs: number) => void;
  close: () => void;
};

type WorkerReadyMessage = { type: 'ready' };
type WorkerResultMessage = FaceLandmarkerResult & { clientId: number };
type WorkerErrorMessage = FaceLandmarkerFailure & { clientId?: number };
type WorkerResponse = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage;

type StatusListener = (snapshot: FaceLandmarkerRuntimeSnapshot) => void;
type ClientListener = (event: FaceLandmarkerClientEvent) => void;

const listeners = new Set<StatusListener>();
const clients = new Map<number, ClientListener>();
// The first mobile visit downloads roughly 15 MiB of model/WASM assets and then
// compiles WASM. Thirty seconds was too short on throttled cellular connections.
const INITIALIZATION_TIMEOUT_MS = 120_000;
const FACE_RUNTIME_ASSET_VERSION = 'tasks-vision-1.0.1-64184e22';

let worker: Worker | null = null;
let mainThreadLandmarker: FaceLandmarker | null = null;
let runtimeMode: 'worker' | 'main-thread' | null = null;
let initialization: Promise<void> | null = null;
let initializationTimeout: number | null = null;
let initializationGeneration = 0;
let nextClientId = 1;
let snapshot: FaceLandmarkerRuntimeSnapshot = { status: 'idle', error: '' };

function publish(next: FaceLandmarkerRuntimeSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener(snapshot);
}

function userFacingLoadError(error?: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('timed out')) {
    return 'ใช้เวลาเตรียมระบบตรวจจับใบหน้านานเกินไป กรุณาเชื่อมต่อ Wi-Fi หรือเครือข่ายที่เสถียรแล้วลองใหม่';
  }
  if (
    message.includes('worker')
    || message.includes('wasm')
    || message.includes('document is not defined')
    || message.includes("can't find variable: document")
  ) {
    return 'เบราว์เซอร์นี้ไม่รองรับระบบตรวจจับใบหน้าที่ใช้อยู่ กรุณาอัปเดต iOS, Safari หรือ Chrome แล้วลองใหม่';
  }
  return 'เตรียมระบบตรวจจับใบหน้าไม่สำเร็จ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่';
}

/**
 * MediaPipe Tasks has had WebKit-specific failures when initialized inside a
 * worker. Every iOS browser uses WebKit, so use the supported DOM/main-thread
 * graph there while keeping inference off the main thread elsewhere.
 */
function needsAppleMobileMainThreadFallback(): boolean {
  const userAgent = navigator.userAgent;
  const appleMobile = /iPad|iPhone|iPod/.test(userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return appleMobile && /AppleWebKit/i.test(userAgent);
}

function disposeRuntime(): void {
  if (initializationTimeout !== null) {
    window.clearTimeout(initializationTimeout);
    initializationTimeout = null;
  }
  worker?.terminate();
  worker = null;
  mainThreadLandmarker?.close();
  mainThreadLandmarker = null;
  runtimeMode = null;
  clients.clear();
}

function rejectLoad(error: unknown, generation: number): void {
  if (generation !== initializationGeneration) return;
  const failure = error instanceof Error ? error : new Error(String(error));
  console.error('Face Landmarker initialization failed:', failure);
  const message = userFacingLoadError(failure);
  const clientFailure = { type: 'error', message } as const;
  for (const listener of clients.values()) listener(clientFailure);
  // Invalidate async model/WASM work that may finish after a timeout.
  initializationGeneration += 1;
  initialization = null;
  disposeRuntime();
  publish({ status: 'error', error: message });
}

function initializeWorker(publicBase: string, generation: number): Promise<void> {
  let nextWorker: Worker;
  try {
    nextWorker = new Worker(
      new URL('../workers/faceLandmarker.worker.ts', import.meta.url),
      { type: 'module' },
    );
  } catch (error) {
    return Promise.reject(error);
  }
  worker = nextWorker;

  return new Promise<void>((resolve, reject) => {
    let initializing = true;
    const failWorker = (error: Error) => {
      if (initializing) {
        initializing = false;
        nextWorker.terminate();
        if (worker === nextWorker) worker = null;
        reject(error);
      } else {
        rejectLoad(error, generation);
      }
    };

    nextWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'ready') {
        if (!initializing) return;
        initializing = false;
        runtimeMode = 'worker';
        resolve();
        return;
      }

      if (message.type === 'result') {
        const listener = clients.get(message.clientId);
        if (listener) {
          listener({ type: 'result', observation: message.observation, frame: message.frame });
        } else {
          message.frame.close();
        }
        return;
      }

      if (message.clientId !== undefined) {
        clients.get(message.clientId)?.({ type: 'error', message: message.message });
        return;
      }

      failWorker(new Error(message.message));
    };

    nextWorker.onerror = (event) => {
      event.preventDefault();
      failWorker(new Error(event.message || 'Face Landmarker worker stopped unexpectedly'));
    };

    nextWorker.postMessage({
      type: 'init',
      wasmRoot: `${publicBase}mediapipe/wasm`,
      modelUrl: `${publicBase}models/face_landmarker.task?v=${FACE_RUNTIME_ASSET_VERSION}`,
    });
  });
}

async function initializeMainThread(publicBase: string, generation: number): Promise<void> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(`${publicBase}mediapipe/wasm`);
  const modelResponse = await fetch(
    `${publicBase}models/face_landmarker.task?v=${FACE_RUNTIME_ASSET_VERSION}`,
    { cache: 'force-cache' },
  );
  if (!modelResponse.ok) {
    throw new Error(`Face Landmarker model request failed (${modelResponse.status})`);
  }
  const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());
  const nextLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer },
    runningMode: 'VIDEO',
    numFaces: 2,
    minFaceDetectionConfidence: 0.65,
    minFacePresenceConfidence: 0.65,
    minTrackingConfidence: 0.65,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
  // Compile the first inference path before the student opens the camera. A
  // canvas is supported by the DOM MediaPipe runtime used for this fallback.
  const warmupCanvas = document.createElement('canvas');
  warmupCanvas.width = 64;
  warmupCanvas.height = 64;
  try {
    nextLandmarker.detectForVideo(warmupCanvas, performance.now());
  } catch {
    // A blank canvas may contain no face; the warm-up is an optimization only.
  }
  if (generation !== initializationGeneration) {
    nextLandmarker.close();
    throw new Error('Face Landmarker initialization was superseded');
  }
  mainThreadLandmarker = nextLandmarker;
  runtimeMode = 'main-thread';
}

function beginInitialization(): Promise<void> {
  publish({ status: 'loading', error: '' });
  const generation = ++initializationGeneration;
  const publicBase = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
  const load = needsAppleMobileMainThreadFallback()
    ? initializeMainThread(publicBase, generation)
    : initializeWorker(publicBase, generation);
  const timeout = new Promise<never>((_, reject) => {
    initializationTimeout = window.setTimeout(() => {
      reject(new Error('Face Landmarker initialization timed out'));
    }, INITIALIZATION_TIMEOUT_MS);
  });
  const pending = Promise.race([load, timeout])
    .then(() => {
      if (generation !== initializationGeneration) return;
      if (initializationTimeout !== null) {
        window.clearTimeout(initializationTimeout);
        initializationTimeout = null;
      }
      publish({ status: 'ready', error: '' });
    })
    .catch((error) => {
      rejectLoad(error, generation);
      throw error;
    });
  initialization = pending;
  return pending;
}

export function getFaceLandmarkerRuntimeSnapshot(): FaceLandmarkerRuntimeSnapshot {
  return snapshot;
}

export function subscribeFaceLandmarkerRuntime(listener: StatusListener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export function preloadFaceLandmarker(): Promise<void> {
  if (
    snapshot.status === 'ready'
    && runtimeMode !== null
    && (worker !== null || mainThreadLandmarker !== null)
  ) return Promise.resolve();
  if (initialization) return initialization;
  if (snapshot.status === 'error') return Promise.reject(new Error(snapshot.error));
  return beginInitialization();
}

export function retryFaceLandmarkerPreload(): Promise<void> {
  initializationGeneration += 1;
  disposeRuntime();
  initialization = null;
  publish({ status: 'idle', error: '' });
  return beginInitialization();
}

export async function openFaceLandmarkerClient(
  listener: ClientListener,
): Promise<FaceLandmarkerClient> {
  await preloadFaceLandmarker();
  if (snapshot.status !== 'ready' || (!worker && !mainThreadLandmarker)) {
    throw new Error(userFacingLoadError());
  }

  const clientId = nextClientId++;
  clients.set(clientId, listener);
  let closed = false;

  return {
    postFrame(frame, timestampMs) {
      if (closed || snapshot.status !== 'ready') {
        frame.close();
        throw new Error('ระบบตรวจจับใบหน้าไม่พร้อมใช้งาน');
      }
      if (runtimeMode === 'worker' && worker) {
        worker.postMessage(
          { type: 'frame', clientId, frame, timestampMs },
          [frame],
        );
        return;
      }
      const landmarker = mainThreadLandmarker;
      if (!landmarker) {
        frame.close();
        throw new Error('ระบบตรวจจับใบหน้าไม่พร้อมใช้งาน');
      }
      // Yield once so React can paint camera/status updates before the
      // synchronous MediaPipe CPU inference used by the iOS fallback.
      window.setTimeout(() => {
        if (closed || snapshot.status !== 'ready') {
          frame.close();
          return;
        }
        try {
          const result = landmarker.detectForVideo(frame, timestampMs);
          const faces = result.faceLandmarks as FaceLandmarkerPoint[][];
          const blendshapes = result.faceBlendshapes.map((item) => (
            item.categories.map((category) => ({
              categoryName: category.categoryName,
              score: category.score,
            }))
          )) as FaceBlendshapeCategory[][];
          listener({
            type: 'result',
            observation: observationFromLandmarker(faces, blendshapes, timestampMs),
            frame,
          });
        } catch (error) {
          frame.close();
          listener({
            type: 'error',
            message: error instanceof Error ? error.message : 'ประมวลผลภาพจากกล้องไม่สำเร็จ',
          });
        }
      }, 0);
    },
    close() {
      closed = true;
      clients.delete(clientId);
    },
  };
}
