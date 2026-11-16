import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import {
  observationFromLandmarker,
  type FaceBlendshapeCategory,
  type FaceLandmarkerPoint,
  type LivenessObservation,
} from '../utils/liveness';
import { TEST_MODE } from '../config/testMode';
import {
  RUNTIME_LOAD_MESSAGES,
  RUNTIME_NOT_READY_MESSAGE,
  classifyRuntimeLoadError,
} from '../utils/faceScanErrors';
import {
  DelegateTuner,
  readDelegateChoice,
  saveDelegateChoice,
} from '../utils/delegateTuner';
import { appUpdateGate } from '../pwa/updateGate';

export type FaceLandmarkerDelegate = 'GPU' | 'CPU';

export type FaceLandmarkerRuntimeStatus = 'idle' | 'loading' | 'ready' | 'error';

export type FaceLandmarkerRuntimeSnapshot = {
  status: FaceLandmarkerRuntimeStatus;
  error: string;
  /**
   * The raw browser/MediaPipe text behind `error`, cut to RAW_ERROR_MAX_CHARS. Only test builds show
   * it (in the scanner's test panel); the person always sees the Thai `error` message.
   */
  detail?: string;
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

/**
 * The worker is rebuilding the model on another engine because it measured that one as faster
 * ('switching'), or the rebuild finished ('switched'). Frames analysed around a switch are slow, so
 * the scanner restarts its timing on 'switched'.
 */
export type FaceLandmarkerEngineEvent = {
  type: 'engine';
  phase: 'switching' | 'switched';
  delegate: FaceLandmarkerDelegate;
};

export type FaceLandmarkerClientEvent = FaceLandmarkerResult | FaceLandmarkerFailure | FaceLandmarkerEngineEvent;

export type FaceLandmarkerClient = {
  postFrame: (frame: ImageBitmap, timestampMs: number) => void;
  /**
   * Turn the eye-blink scores on or off. They cost time on every frame, so the scan only
   * enables them for the blink challenge. A no-op on the main-thread (iOS) path, where they
   * stay on.
   */
  setBlendshapes: (enabled: boolean) => void;
  close: () => void;
};

type WorkerReadyMessage = { type: 'ready'; delegate?: FaceLandmarkerDelegate };
type WorkerDelegateMessage = { type: 'delegate'; delegate: FaceLandmarkerDelegate };
type WorkerOptionsAppliedMessage = { type: 'options-applied'; ms: number };
type WorkerResultMessage = FaceLandmarkerResult & {
  clientId: number;
  /** Model time of this frame and the engine it ran on (newer workers only). */
  inferenceMs?: number;
  delegate?: FaceLandmarkerDelegate;
};
type WorkerErrorMessage = FaceLandmarkerFailure & { clientId?: number };
type WorkerResponse =
  | WorkerReadyMessage
  | WorkerDelegateMessage
  | WorkerOptionsAppliedMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

type StatusListener = (snapshot: FaceLandmarkerRuntimeSnapshot) => void;
type ClientListener = (event: FaceLandmarkerClientEvent) => void;

const listeners = new Set<StatusListener>();
const clients = new Map<number, ClientListener>();
// The first mobile visit downloads roughly 15 MiB of model/WASM assets and then
// compiles WASM. Thirty seconds was too short on throttled cellular connections.
const INITIALIZATION_TIMEOUT_MS = 120_000;
const FACE_RUNTIME_ASSET_VERSION = 'tasks-vision-1.0.1-64184e22';
const RAW_ERROR_MAX_CHARS = 160;

let worker: Worker | null = null;
let mainThreadLandmarker: FaceLandmarker | null = null;
let runtimeMode: 'worker' | 'main-thread' | null = null;
let initialization: Promise<void> | null = null;
let initializationTimeout: number | null = null;
let initializationGeneration = 0;
let nextClientId = 1;
let snapshot: FaceLandmarkerRuntimeSnapshot = { status: 'idle', error: '' };
let activeDelegate: FaceLandmarkerDelegate | null = null;
let lastOptionsSwitchMs: number | null = null;
// Engine tuning (Android only): whether this start may be tuned, the tuner, and a pending switch.
let tunable = false;
let tuner: DelegateTuner | null = null;
let switchPending = false;
let deferredSwitch: FaceLandmarkerDelegate | null = null;
let switchDone: Promise<void> = Promise.resolve();
let resolveSwitchDone: () => void = () => undefined;
// A worker that died while it ran on the GPU (or while it switched engines) is replaced once by a
// fresh worker on the CPU before the failure is reported (see restartWorker).
let crashRecoveryUsed = false;
// Raw text of the last crash that was recovered on the CPU (test builds show it in the scanner).
let lastRecoveryDetail: string | null = null;

/** Which engine the loaded model really runs on (null until it is ready). */
export function getFaceLandmarkerDelegate(): FaceLandmarkerDelegate | null {
  return activeDelegate;
}

/** Where the model runs: a worker, the main thread (iOS), or null before it is ready. */
export function getFaceLandmarkerRuntimeMode(): 'worker' | 'main-thread' | null {
  return runtimeMode;
}

/** Raw text of the last worker crash that was recovered by restarting on the CPU, if any. */
export function getLastRuntimeRecovery(): string | null {
  return lastRecoveryDetail;
}

/** How long the last blend-shape on/off switch took, in milliseconds (test builds read this). */
export function getLastBlendshapeSwitchMs(): number | null {
  return lastOptionsSwitchMs;
}

/**
 * Android phones run the model on the GPU when they can: on slow CPUs the CPU path misses the
 * frame-rate the Backend requires. Everything else keeps the CPU path that is known to work
 * (iOS must stay on it). The worker falls back to the CPU by itself if the GPU path fails.
 * Test builds may force an engine with ?delegate=cpu or ?delegate=gpu to compare them.
 */
function preferredDelegate(): FaceLandmarkerDelegate {
  tunable = false;
  if (TEST_MODE) {
    const forced = new URLSearchParams(window.location.search).get('delegate')?.toLowerCase();
    if (forced === 'cpu') return 'CPU';
    if (forced === 'gpu') return 'GPU';
  }
  const platformDefault = /Android/i.test(navigator.userAgent) ? 'GPU' : 'CPU';
  if (platformDefault !== 'GPU') return platformDefault;
  // Android: the engine this phone measured as faster (see utils/delegateTuner.ts), else measure.
  const remembered = readDelegateChoice(safeLocalStorage(), Date.now());
  if (remembered) return remembered;
  tunable = true;
  return platformDefault;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function broadcast(event: FaceLandmarkerEngineEvent): void {
  for (const listener of clients.values()) listener(event);
}

function requestDelegateSwitch(target: FaceLandmarkerDelegate): void {
  if (!worker || runtimeMode !== 'worker') return;
  restartWorker(target);
}

function rawErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.length > RAW_ERROR_MAX_CHARS ? `${text.slice(0, RAW_ERROR_MAX_CHARS - 1)}…` : text;
}

/**
 * Change engine by replacing the whole worker instead of rebuilding the graph inside it.
 *
 * Field case (2026-11-16, vivo V23e in Chrome; earlier the Messenger in-app browser): the GPU ran at
 * ~155-221 ms per frame, the tuner asked for the CPU, and the in-worker rebuild (close the GPU graph,
 * create a CPU graph in the same WASM heap) failed, so the worker died with "runtime status error".
 * A new worker starts with an empty WASM heap and no WebGL context, which is the same path that
 * already works when a phone starts on the CPU. Results of a frame that was in flight in the old
 * worker are lost; the scanner restarts its attempt on the 'switched' event anyway.
 */
function restartWorker(target: FaceLandmarkerDelegate, cause?: unknown): void {
  const generation = ++initializationGeneration;
  if (initializationTimeout !== null) {
    window.clearTimeout(initializationTimeout);
    initializationTimeout = null;
  }
  worker?.terminate();
  worker = null;
  activeDelegate = null;
  switchPending = true;
  switchDone = new Promise<void>((resolve) => { resolveSwitchDone = resolve; });
  broadcast({ type: 'engine', phase: 'switching', delegate: target });
  publish({ status: 'loading', error: '', detail: cause === undefined ? undefined : rawErrorText(cause) });
  const publicBase = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
  const timeout = new Promise<never>((_, reject) => {
    initializationTimeout = window.setTimeout(() => {
      reject(new Error('Face Landmarker initialization timed out'));
    }, INITIALIZATION_TIMEOUT_MS);
  });
  const pending = Promise.race([initializeWorker(publicBase, generation, target), timeout]).then(
    () => {
      if (generation !== initializationGeneration) return;
      if (initializationTimeout !== null) {
        window.clearTimeout(initializationTimeout);
        initializationTimeout = null;
      }
      switchPending = false;
      publish({ status: 'ready', error: '' });
      resolveSwitchDone();
      broadcast({ type: 'engine', phase: 'switched', delegate: activeDelegate ?? target });
    },
    (error) => {
      rejectLoad(error, generation);
    },
  );
  initialization = pending;
  void pending.finally(() => {
    if (initialization === pending) initialization = null;
  });
}

/**
 * True when a worker that just died should be replaced by a fresh CPU worker instead of failing the
 * scan: only once per runtime, only for a failure on the GPU or during an engine switch.
 */
function shouldRecoverOnCpu(): boolean {
  return !crashRecoveryUsed && runtimeMode === 'worker' && (activeDelegate === 'GPU' || switchPending);
}

function recoverOnCpu(cause: Error): void {
  crashRecoveryUsed = true;
  lastRecoveryDetail = rawErrorText(cause);
  console.error('Face Landmarker worker stopped; restarting on the CPU:', cause);
  tuner?.finish();
  deferredSwitch = null;
  // Remember the CPU so the next visit (or "try again") does not start on the failing GPU path.
  saveDelegateChoice(safeLocalStorage(), { delegate: 'CPU', gpuMs: Number.NaN, cpuMs: null }, Date.now());
  restartWorker('CPU', cause);
}

/** A switch back that waited for the scanner to close (at most one switch per attempt). */
function applyDeferredSwitch(): void {
  if (!deferredSwitch || clients.size > 0 || switchPending) return;
  const target = deferredSwitch;
  deferredSwitch = null;
  if (target !== activeDelegate) requestDelegateSwitch(target);
}

/** Feed one measured model time to the engine tuner (Android GPU start without a stored choice). */
function tuneDelegate(inferenceMs: number | undefined, delegate: FaceLandmarkerDelegate | undefined): void {
  if (!tuner || tuner.done || switchPending || inferenceMs === undefined) return;
  const decision = tuner.record(delegate ?? activeDelegate ?? 'CPU', inferenceMs, performance.now());
  if (decision.kind === 'switch') {
    requestDelegateSwitch(decision.to);
    return;
  }
  if (decision.kind === 'final') {
    saveDelegateChoice(safeLocalStorage(), decision, Date.now());
    // Never a second restart in the same attempt: switch back once the scanner has closed.
    if (decision.delegate !== activeDelegate) {
      deferredSwitch = decision.delegate;
      applyDeferredSwitch();
    }
  }
}

function publish(next: FaceLandmarkerRuntimeSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener(snapshot);
}

function userFacingLoadError(error?: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const kind = classifyRuntimeLoadError(message);
  if (kind === 'unknown' && message) console.error(message);
  return RUNTIME_LOAD_MESSAGES[kind];
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
  activeDelegate = null;
  tuner = null;
  switchPending = false;
  deferredSwitch = null;
  crashRecoveryUsed = false;
  resolveSwitchDone();
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
  publish({ status: 'error', error: message, detail: rawErrorText(failure) });
  // A new build is waiting: the failure is most likely the old build's files being gone after the
  // update (the worker URL now returns the new index.html). Reload instead of a misleading error.
  appUpdateGate.reloadNowIfPending();
}

/**
 * Start a worker. `forcedDelegate` is set when an engine switch or a crash replaces the worker: the
 * engine is then fixed and the running tuner (if any) keeps measuring across the new worker.
 */
function initializeWorker(
  publicBase: string,
  generation: number,
  forcedDelegate?: FaceLandmarkerDelegate,
): Promise<void> {
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
      } else if (generation !== initializationGeneration) {
        // An old worker that was already replaced: nothing to report.
      } else if (shouldRecoverOnCpu()) {
        recoverOnCpu(error);
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
        activeDelegate = message.delegate ?? 'CPU';
        if (forcedDelegate === undefined) {
          // Measure only a GPU start (a GPU that already fell back to the CPU needs no comparison).
          tuner = tunable && activeDelegate === 'GPU' ? new DelegateTuner('GPU') : null;
          switchPending = false;
        }
        resolve();
        return;
      }

      if (message.type === 'delegate') {
        activeDelegate = message.delegate;
        if (!switchPending && tuner && !tuner.done) {
          // The worker fell back to the CPU by itself (a GPU fault mid-scan): stop measuring and
          // remember the CPU, so the next visit does not start on the broken GPU path again.
          tuner.finish();
          if (message.delegate === 'CPU') {
            saveDelegateChoice(safeLocalStorage(), { delegate: 'CPU', gpuMs: Number.NaN, cpuMs: null }, Date.now());
          }
        }
        switchPending = false;
        resolveSwitchDone();
        broadcast({ type: 'engine', phase: 'switched', delegate: message.delegate });
        return;
      }

      if (message.type === 'options-applied') {
        lastOptionsSwitchMs = message.ms;
        return;
      }

      if (message.type === 'result') {
        tuneDelegate(message.inferenceMs, message.delegate);
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
      delegate: forcedDelegate ?? preferredDelegate(),
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
  activeDelegate = 'CPU';
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
  // Opening the scanner is an explicit user action ("scan" / "try again"): a runtime that failed
  // earlier (for example a worker that crashed mid-scan) is rebuilt instead of failing forever.
  try {
    if (snapshot.status === 'error' && !initialization) await retryFaceLandmarkerPreload();
    else await preloadFaceLandmarker();
  } catch (loadError) {
    // The raw MediaPipe/browser text ("... timed out", "Failed to fetch") is never shown to the
    // person: the published Thai message (or the same classification) is used instead.
    throw new Error(snapshot.error || userFacingLoadError(loadError), { cause: loadError });
  }
  // A deferred engine switch runs before the next scan starts, never during one.
  await switchDone;
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
        throw new Error(RUNTIME_NOT_READY_MESSAGE);
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
        throw new Error(RUNTIME_NOT_READY_MESSAGE);
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
            observation: observationFromLandmarker(
              faces,
              blendshapes,
              timestampMs,
              frame.width / Math.max(frame.height, 1),
            ),
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
    setBlendshapes(enabled) {
      if (closed || runtimeMode !== 'worker' || !worker) return;
      worker.postMessage({ type: 'options', outputFaceBlendshapes: enabled });
    },
    close() {
      closed = true;
      clients.delete(clientId);
      applyDeferredSwitch();
    },
  };
}
