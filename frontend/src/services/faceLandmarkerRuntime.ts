import type { LivenessObservation } from '../utils/liveness';

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
const INITIALIZATION_TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let initialization: Promise<void> | null = null;
let resolveInitialization: (() => void) | null = null;
let rejectInitialization: ((error: Error) => void) | null = null;
let initializationTimeout: number | null = null;
let nextClientId = 1;
let snapshot: FaceLandmarkerRuntimeSnapshot = { status: 'idle', error: '' };

function publish(next: FaceLandmarkerRuntimeSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener(snapshot);
}

function userFacingLoadError(): string {
  return 'เตรียมระบบตรวจจับใบหน้าไม่สำเร็จ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่';
}

function disposeWorker(): void {
  if (initializationTimeout !== null) {
    window.clearTimeout(initializationTimeout);
    initializationTimeout = null;
  }
  worker?.terminate();
  worker = null;
  clients.clear();
}

function rejectLoad(error: unknown): void {
  const failure = error instanceof Error ? error : new Error(String(error));
  console.error('Face Landmarker initialization failed:', failure);
  const clientFailure = { type: 'error', message: userFacingLoadError() } as const;
  for (const listener of clients.values()) listener(clientFailure);
  const reject = rejectInitialization;
  resolveInitialization = null;
  rejectInitialization = null;
  initialization = null;
  disposeWorker();
  publish({ status: 'error', error: userFacingLoadError() });
  reject?.(failure);
}

function beginInitialization(): Promise<void> {
  publish({ status: 'loading', error: '' });
  const pending = new Promise<void>((resolve, reject) => {
    resolveInitialization = resolve;
    rejectInitialization = reject;
  });
  initialization = pending;

  let nextWorker: Worker;
  try {
    nextWorker = new Worker(
      new URL('../workers/faceLandmarker.worker.ts', import.meta.url),
      { type: 'module' },
    );
  } catch (error) {
    rejectLoad(error);
    return pending;
  }
  worker = nextWorker;

  nextWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'ready') {
      if (initializationTimeout !== null) {
        window.clearTimeout(initializationTimeout);
        initializationTimeout = null;
      }
      const resolve = resolveInitialization;
      resolveInitialization = null;
      rejectInitialization = null;
      publish({ status: 'ready', error: '' });
      resolve?.();
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

    rejectLoad(new Error(message.message));
  };

  nextWorker.onerror = (event) => {
    event.preventDefault();
    rejectLoad(new Error(event.message || 'Face Landmarker worker stopped unexpectedly'));
  };

  const publicBase = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
  nextWorker.postMessage({
    type: 'init',
    wasmRoot: `${publicBase}mediapipe/wasm`,
    modelUrl: `${publicBase}models/face_landmarker.task`,
  });
  initializationTimeout = window.setTimeout(() => {
    rejectLoad(new Error('Face Landmarker initialization timed out'));
  }, INITIALIZATION_TIMEOUT_MS);
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
  if (snapshot.status === 'ready' && worker) return Promise.resolve();
  if (initialization) return initialization;
  if (snapshot.status === 'error') return Promise.reject(new Error(snapshot.error));
  return beginInitialization();
}

export function retryFaceLandmarkerPreload(): Promise<void> {
  disposeWorker();
  initialization = null;
  resolveInitialization = null;
  rejectInitialization = null;
  publish({ status: 'idle', error: '' });
  return beginInitialization();
}

export async function openFaceLandmarkerClient(
  listener: ClientListener,
): Promise<FaceLandmarkerClient> {
  await preloadFaceLandmarker();
  if (!worker || snapshot.status !== 'ready') {
    throw new Error(userFacingLoadError());
  }

  const clientId = nextClientId++;
  clients.set(clientId, listener);
  let closed = false;

  return {
    postFrame(frame, timestampMs) {
      if (closed || !worker || snapshot.status !== 'ready') {
        frame.close();
        throw new Error('ระบบตรวจจับใบหน้าไม่พร้อมใช้งาน');
      }
      worker.postMessage(
        { type: 'frame', clientId, frame, timestampMs },
        [frame],
      );
    },
    close() {
      closed = true;
      clients.delete(clientId);
    },
  };
}
