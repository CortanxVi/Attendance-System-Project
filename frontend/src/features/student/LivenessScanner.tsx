import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Webcam from 'react-webcam';
import { ArrowLeft, Camera, Eye, EyeClosed, Loader2, ScanFace, ShieldCheck, ZoomIn, ZoomOut } from 'lucide-react';
import CameraQualityControls from '../../components/camera/CameraQualityControls';
import { useModalIsolation } from '../../components/overlays/useModalIsolation';
import { useCameraQuality } from '../../hooks/useCameraQuality';
import {
  getFaceLandmarkerRuntimeSnapshot,
  openFaceLandmarkerClient,
  type FaceLandmarkerClient,
  type FaceLandmarkerClientEvent,
} from '../../services/faceLandmarkerRuntime';
import { useDeviceSupport } from '../../hooks/useDeviceSupport';
import UnsupportedDeviceNotice from '../../components/UnsupportedDeviceNotice';
import InAppBrowserNotice from '../../components/InAppBrowserNotice';
import { detectInAppBrowser } from '../../utils/inAppBrowser';
import {
  CameraFrameUnavailableError,
  FRAME_ERROR_MESSAGES,
  FrameErrorTolerance,
  classifyFrameError,
  type FrameErrorKind,
} from '../../utils/faceScanErrors';
import {
  EVIDENCE_JPEG_QUALITY,
  PASSIVE_JPEG_QUALITY,
  SHARPNESS_SAMPLE_SIDE,
  SharpnessGate,
  faceCropRect,
  firstSampleReady,
  grayFromRgba,
  laplacianSharpness,
  meanGray,
  passiveWarmupDone,
} from '../../utils/captureQuality';
import { holdAppUpdates } from '../../pwa/registerServiceWorker';
import { ENGINE_SWITCH_TIMEOUT_MS, EngineSwitchGuard } from '../../utils/engineSwitchGuard';
import { INSTRUCTION_MIN_DWELL_MS, InstructionPacer } from '../../utils/instructionPacer';
import {
  LOW_LIGHT_MESSAGE,
  LUMA_SAMPLE_EVERY_MS,
  LUMA_SAMPLE_HEIGHT,
  LUMA_SAMPLE_WIDTH,
  LowLightMonitor,
  meanLuma,
} from '../../utils/lightLevel';
import {
  ACTION_TOO_SLOW_MESSAGE,
  ATTEMPT_TIME_LIMIT_MESSAGE,
  evidenceTimingMessage,
  PASSIVE_GAP_RESTART_MESSAGE,
  actionRecoveryExpired,
  hybridEvidenceTimingProblem,
  passiveSampleGapExpired,
} from '../../utils/livenessTiming';
import type {
  HybridLivenessAction,
  HybridLivenessEvidence,
  LivenessObservation,
  SizeGuide,
} from '../../utils/liveness';
import {
  BLINK_OPEN_MESSAGE,
  BLINK_PROMPT,
  BLINK_RETRY_AFTER_MS,
  BLINK_RETRY_PROMPT,
  BLINK_TOO_SHORT_MESSAGE,
  HybridActionMonitor,
  MIN_READABLE_EAR,
  MOVE_CLOSER_HOLD_MESSAGE,
  MOVE_CLOSER_MESSAGES,
  MOVE_CLOSER_RECOVERY_LATE_MESSAGE,
  MOVE_CLOSER_PROMPT,
  PASSIVE_POSE_MESSAGES,
  PASSIVE_RESTART_MESSAGE,
  PassivePoseGate,
  RECOVERY_MESSAGES,
  faceProblemInstruction,
  fpsProblem,
  moveCloserGuide,
  moveCloserHint,
  recoveryHint,
} from '../../utils/liveness';

const SAMPLE_COUNT = 3 as const;
// Minimum gap between still frames (a little slower than before, so the person has time to settle).
// The upper bound (Backend 2000 ms) is enforced by passiveSampleGapExpired in utils/livenessTiming.ts,
// which restarts the set at 1800 ms. SAMPLE_INTERVAL_MS + PASSIVE_POSE_LIMITS.restartAfterMs (1200)
// must stay below 1800, so the pose-specific restart message can still come before the gap restart
// (checked in scripts/test-scan-robustness.mts).
const SAMPLE_INTERVAL_MS = 550;
// The "get ready" text before the challenge prompt stays at least this long (the signed promptDelayMs
// is only 500-1400 ms, too short to read). The Backend only needs prompt >= last still + promptDelayMs.
const PREPARE_NOTICE_MIN_MS = 1_500;
// A paced instruction that waits for its turn is shown by this timer even when no frame arrives.
const INSTRUCTION_FLUSH_MS = 250;
// Consecutive good frames before the first still frame (together with the camera warm-up).
const REQUIRED_STABLE_FRAMES = 4;
// After a restart ("frames not continuous", "too slow, do it again") the routine instructions
// wait this long, so the notice can be read.
const NOTICE_MS = 1_500;
const ATTEMPT_TIMEOUT_MS = 30_000;
// The server only ever receives images with a longest side of 640 px (see frameToJpeg), so the
// face landmarker does not need the camera's full 1280x720 frame either. Handing it the smaller
// bitmap cuts the per-frame copy/upload/preprocessing cost on phones with slow CPUs or GPUs.
const ANALYSIS_MAX_SIDE = 640;
// Step indicator in the instruction card, derived from the progress bar (3 still frames = 0.6, action
// captured = 0.8).
const STEP_LABELS = { 1: 'มองตรงนิ่ง ๆ', 2: 'ทำตามคำสั่ง', 3: 'กลับท่าเดิม' } as const;


/** Grab one analysis frame, scaled down when the camera frame is larger than ANALYSIS_MAX_SIDE. */
async function grabAnalysisFrame(video: HTMLVideoElement): Promise<{ bitmap: ImageBitmap; size: string }> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const scale = width > 0 && height > 0 ? Math.min(1, ANALYSIS_MAX_SIDE / Math.max(width, height)) : 1;
  if (scale < 1) {
    const resizeWidth = Math.max(1, Math.round(width * scale));
    const resizeHeight = Math.max(1, Math.round(height * scale));
    try {
      const bitmap = await createImageBitmap(video, { resizeWidth, resizeHeight, resizeQuality: 'medium' });
      return { bitmap, size: `${resizeWidth}×${resizeHeight}` };
    } catch {
      // An older browser without the resize options: fall back to the full frame.
    }
  }
  return { bitmap: await createImageBitmap(video), size: `${width}×${height}` };
}

export interface LivenessCapture {
  mode: 'hybrid';
  faceImageSrc: string;
  passiveImageSrcs: [string, string, string];
  actionImageSrc: string;
  recoveryImageSrc: string;
  evidence: HybridLivenessEvidence;
}

interface LivenessScannerProps {
  onCaptureSuccess: (capture: LivenessCapture) => void;
  onClose: () => void;
  title?: string;
  challenge: {
    action: HybridLivenessAction;
    promptDelayMs: number;
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return 0;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function frameToJpeg(frame: ImageBitmap, quality: number = EVIDENCE_JPEG_QUALITY): string {
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(frame.width, frame.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('อุปกรณ์นี้ไม่สามารถเก็บภาพหลักฐานได้');
  context.drawImage(frame, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function isRearCamera(facingMode: string | undefined, selectedCamera: MediaDeviceInfo | undefined): boolean {
  if (facingMode === 'environment') return true;
  const label = selectedCamera?.label.toLowerCase() ?? '';
  return /back|rear|environment|ultra|telephoto|กล้องหลัง/.test(label);
}

/**
 * The scan needs a phone that can run the face model fast enough. Android 10 and older are
 * outside the supported range, so they get a clear message instead of a camera that fails at the
 * very last step.
 */
export default function LivenessScanner(props: LivenessScannerProps) {
  const support = useDeviceSupport();
  if (support.status === 'checking') return null;
  if (support.status === 'unsupported') {
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="อุปกรณ์ไม่รองรับ"
        className="fixed inset-0 flex items-center justify-center bg-slate-950/90 px-4"
        style={{ zIndex: 'var(--z-dialog)' }}
      >
        <UnsupportedDeviceNotice androidMajor={support.androidMajor} onClose={props.onClose} />
      </div>,
      document.body,
    );
  }
  return <LivenessScannerInner {...props} />;
}

function LivenessScannerInner({
  onCaptureSuccess,
  onClose,
  title = 'สแกนใบหน้า',
  challenge,
}: LivenessScannerProps) {
  const webcamRef = useRef<Webcam>(null);
  const callbackRef = useRef(onCaptureSuccess);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [instruction, setInstruction] = useState('กำลังเตรียมระบบตรวจใบหน้า...');
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [error, setError] = useState('');
  const [attemptKey, setAttemptKey] = useState(0);
  const [lowLight, setLowLight] = useState(false);
  // move_closer only: live bar of the current face size against the zone the step needs.
  const [sizeGuide, setSizeGuide] = useState<SizeGuide | null>(null);
  const inAppBrowser = useMemo(
    () => (typeof navigator === 'undefined' ? null : detectInAppBrowser(navigator.userAgent)),
    [],
  );
  const [inAppDismissed, setInAppDismissed] = useState(false);
  const cameraQuality = useCameraQuality();

  useModalIsolation(true);
  // A new web build never reloads the page while the scanner is open (it waits until it closes).
  useEffect(() => holdAppUpdates(), []);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => { callbackRef.current = onCaptureSuccess; }, [onCaptureSuccess]);
  const videoConstraints = useMemo<MediaTrackConstraints>(() => selectedCameraId
    ? {
      deviceId: { exact: selectedCameraId },
      width: { ideal: 1280, min: 640 },
      height: { ideal: 720, min: 480 },
      frameRate: { ideal: 30, max: 30 },
    }
    : {
      facingMode: { ideal: 'user' },
      width: { ideal: 1280, min: 640 },
      height: { ideal: 720, min: 480 },
      frameRate: { ideal: 30, max: 30 },
    }, [selectedCameraId]);

  const handleStreamReady = async () => {
    setError('');
    const stream = webcamRef.current?.video?.srcObject;
    if (stream instanceof MediaStream) {
      const facingMode = stream.getVideoTracks()[0]?.getSettings().facingMode;
      const selectedCamera = cameras.find((camera) => camera.deviceId === selectedCameraId);
      setMirrorPreview(!isRearCamera(facingMode, selectedCamera));
      await cameraQuality.inspectStream(stream);
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((device) => device.kind === 'videoinput'));
    } catch { setCameras([]); }
  };

  useEffect(() => {
    let animationFrame = 0;
    let timeout = 0;
    let cancelled = false;
    let workerReady = false;
    let processing = false;
    let lastProcessedAt = 0;
    let client: FaceLandmarkerClient | null = null;
    let startedAt = 0;
    let stableFrames = 0;
    let lastSampleAt = 0;
    let phase: 'passive' | 'wait_prompt' | 'action' | 'recovery' = 'passive';
    // Moment the challenge prompt was really shown (set then); before it the "get ready" text runs
    // until prepareUntil.
    let promptAt = 0;
    let prepareUntil = 0;
    const poseGate = new PassivePoseGate();
    // Set once the scan was stopped by the app itself (too slow), so late results are ignored.
    let halted = false;
    // The capture is handed to the parent at most once per attempt.
    let delivered = false;
    let monitor: HybridActionMonitor | null = null;
    // Engine switch (Android GPU measured slower than CPU): pauses the timeout, drops stale results.
    const engineGuard = new EngineSwitchGuard();
    // stopSlow also halts frame handling, so a late action can no longer send an over-long scan.
    const armTimeout = () => {
      timeout = window.setTimeout(() => stopSlow(ATTEMPT_TIME_LIMIT_MESSAGE), ATTEMPT_TIMEOUT_MS);
    };
    let badSince = 0;
    let actionRetryShown = false;
    let actionImage = '';
    let actionAt = 0;
    // The candidate action frame (for a blink: the deepest closed frame so far). It is kept open past
    // the frame handler and only turned into a JPEG when the monitor commits it.
    let keptActionFrame: ImageBitmap | null = null;
    const releaseKeptFrame = (inUse?: ImageBitmap) => {
      const kept = keptActionFrame;
      keptActionFrame = null;
      // The frame being handled right now is closed by the handler's finally block instead.
      if (kept && kept !== inUse) kept.close();
    };
    // A restart notice stays readable this long before the routine instructions replace it.
    let noticeUntil = 0;
    // Every frame-loop instruction goes through the pacer, so the text never flips every frame:
    // a hint stays at least INSTRUCTION_MIN_DWELL_MS; a step (new phase or notice) shows at once.
    // Errors bypass it (fail() sets the error overlay directly).
    const pacer = new InstructionPacer({ minDwellMs: INSTRUCTION_MIN_DWELL_MS });
    const display = (text: string) => { if (!cancelled) setInstruction(text); };
    const showStep = (text: string) => display(pacer.request(text, performance.now(), 'step'));
    const showHint = (text: string) => display(pacer.request(text, performance.now(), 'hint'));
    const flushInstruction = () => { if (!cancelled && !halted) display(pacer.tick(performance.now())); };
    const instructionTimer = window.setInterval(flushInstruction, INSTRUCTION_FLUSH_MS);
    // Advisory low-light hint: a tiny canvas is read at most every LUMA_SAMPLE_EVERY_MS.
    const lightMonitor = new LowLightMonitor();
    let lowLightShown = false;
    let lastLumaAt = -Infinity;
    let lumaContext: CanvasRenderingContext2D | null | undefined;
    const samples: string[] = [];
    const passiveObservations: LivenessObservation[] = [];
    const markers: HybridLivenessEvidence['frames'] = [];
    const observedTimestamps: number[] = [];
    // Frame copy / runtime problems: one bad frame is skipped, only a sustained problem stops the scan.
    const frameErrors = new FrameErrorTolerance();
    // Camera warm-up: no still frame before the camera has run CAMERA_WARMUP_MS (exposure/focus).
    let firstCameraFrameAt: number | null = null;
    // Start of the current run of good face frames (frame #1 needs FACE_PRESENCE_MS of it).
    let presenceSince: number | null = null;
    // Motion-blur gate for the still frames, measured on a small grayscale face crop.
    const sharpnessGate = new SharpnessGate();
    let sharpContext: CanvasRenderingContext2D | null | undefined;
    const passiveSharpness: number[] = [];
    const passiveLuma: number[] = [];
    // Every stop is final for this attempt: the frame loop and the attempt timeout end here, so a
    // later frame can never overwrite the first, real error message with a different one.
    const fail = (message: string) => {
      if (cancelled || halted) return;
      halted = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(animationFrame);
      setIsLoading(false);
      setError(message);
    };
    // The scan cannot succeed (camera too slow): show why and ignore further frames. Nothing was
    // sent to the Backend, so the signed challenge is still unused and "try again" can reuse it.
    const stopSlow = (message: string, inUse?: ImageBitmap) => {
      releaseKeptFrame(inUse);
      fail(message);
    };
    // One frame could not be copied or analysed: skip it; stop only when the problem lasts.
    const frameProblem = (kind: FrameErrorKind) => {
      const decision = frameErrors.record(kind, performance.now());
      if (decision.fatal) fail(FRAME_ERROR_MESSAGES[decision.kind]);
    };
    // Sharpness and brightness of the face area (small grayscale crop); null when unreadable.
    const measureFace = (frame: ImageBitmap, observation: LivenessObservation) => {
      const rect = faceCropRect(observation, frame.width, frame.height);
      if (!rect || sharpContext === null) return null;
      try {
        if (sharpContext === undefined) {
          const canvas = document.createElement('canvas');
          canvas.width = SHARPNESS_SAMPLE_SIDE;
          canvas.height = SHARPNESS_SAMPLE_SIDE;
          sharpContext = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        }
        if (!sharpContext) return null;
        sharpContext.drawImage(frame, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, SHARPNESS_SAMPLE_SIDE, SHARPNESS_SAMPLE_SIDE);
        const gray = grayFromRgba(sharpContext.getImageData(0, 0, SHARPNESS_SAMPLE_SIDE, SHARPNESS_SAMPLE_SIDE).data);
        return { sharpness: laplacianSharpness(gray, SHARPNESS_SAMPLE_SIDE, SHARPNESS_SAMPLE_SIDE), luma: meanGray(gray) };
      } catch {
        // Only a frame-choice aid: without pixel access the gate simply does not act.
        sharpContext = null;
        return null;
      }
    };
    const updateLowLight = (frame: ImageBitmap, timestampMs: number) => {
      if (timestampMs - lastLumaAt < LUMA_SAMPLE_EVERY_MS) return;
      lastLumaAt = timestampMs;
      try {
        if (lumaContext === undefined) {
          const canvas = document.createElement('canvas');
          canvas.width = LUMA_SAMPLE_WIDTH;
          canvas.height = LUMA_SAMPLE_HEIGHT;
          lumaContext = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        }
        if (!lumaContext) return;
        lumaContext.drawImage(frame, 0, 0, LUMA_SAMPLE_WIDTH, LUMA_SAMPLE_HEIGHT);
        const luma = meanLuma(lumaContext.getImageData(0, 0, LUMA_SAMPLE_WIDTH, LUMA_SAMPLE_HEIGHT).data);
        const show = lightMonitor.update(luma, timestampMs);
        if (show !== lowLightShown) { lowLightShown = show; setLowLight(show); }
      } catch {
        // Only a hint: a browser that cannot read the pixels simply never shows it.
        lumaContext = null;
      }
    };
    // Drop the still frames taken so far; the next good frame starts a new set.
    const restartPassive = (message: string, timestampMs: number) => {
      samples.splice(0);
      passiveObservations.splice(0);
      passiveSharpness.splice(0);
      passiveLuma.splice(0);
      markers.splice(0);
      poseGate.reset();
      lastSampleAt = 0;
      stableFrames = 0;
      presenceSince = null;
      setProgress(0);
      showStep(message);
      noticeUntil = timestampMs + NOTICE_MS;
    };
    const qualityOk = (observation: LivenessObservation) => observation.faceCount === 1
      && observation.faceWidthRatio >= 0.20
      && observation.faceWidthRatio <= 0.76
      && observation.centerOffset <= 0.22
      && observation.leftEar > MIN_READABLE_EAR
      && observation.rightEar > MIN_READABLE_EAR;
    const processFrame = async (timestamp: number) => {
      if (cancelled || halted) return;
      const video = webcamRef.current?.video;
      if (workerReady && client && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !processing && timestamp - lastProcessedAt >= 50) {
        lastProcessedAt = timestamp;
        const runtime = getFaceLandmarkerRuntimeSnapshot();
        if (runtime.status === 'error') {
          // The model itself stopped (for example the worker crashed): its own message names the cause.
          fail(runtime.error || FRAME_ERROR_MESSAGES.runtime);
          return;
        }
        // While the runtime is (re)initialising nothing is posted; the attempt timeout still applies.
        if (runtime.status === 'ready') {
          processing = true;
          let bitmap: ImageBitmap | null = null;
          try {
            // A camera that is renegotiating its size (focus constraint, lens switch) briefly
            // reports 0x0; copying it would throw, so the frame is skipped instead.
            if (!video.videoWidth || !video.videoHeight) throw new CameraFrameUnavailableError();
            const grabbed = await grabAnalysisFrame(video);
            bitmap = grabbed.bitmap;
            if (cancelled || halted) {
              bitmap.close();
              processing = false;
              return;
            }
            firstCameraFrameAt ??= performance.now();
            const posted = bitmap;
            bitmap = null;
            client.postFrame(posted, performance.now());
          } catch (frameError) {
            // Never leak the copied frame (closing an already closed bitmap is a no-op).
            bitmap?.close();
            processing = false;
            frameProblem(classifyFrameError(frameError, typeof createImageBitmap === 'function'));
          }
        }
      }
      if (cancelled || halted) return;
      animationFrame = requestAnimationFrame(processFrame);
    };
    // Nothing was sent yet, so after an engine switch the attempt simply starts over with clean
    // timing (the frames around a rebuild are slow and would fail the frame-rate checks).
    const restartAfterEngineSwitch = () => {
      // A switch replaces the worker, so a frame that was in flight in the old one never answers.
      processing = false;
      releaseKeptFrame();
      restartPassive('ปรับการประมวลผลเสร็จแล้ว วางใบหน้าให้อยู่กลางกรอบ', performance.now());
      observedTimestamps.splice(0);
      startedAt = 0;
      phase = 'passive';
      promptAt = 0;
      prepareUntil = 0;
      monitor = null;
      badSince = 0;
      actionRetryShown = false;
      actionImage = '';
      actionAt = 0;
      frameErrors.success();
      setSizeGuide(null);
      client?.setBlendshapes(false);
      window.clearTimeout(timeout);
      armTimeout();
    };
    const handleMessage = (message: FaceLandmarkerClientEvent) => {
      if (cancelled || halted) { if (message.type === 'result') message.frame.close(); return; }
      if (message.type === 'engine') {
        const action = engineGuard.onEvent(message.phase, performance.now());
        if (action === 'pause') {
          // The rebuild (a GPU start can take up to 20 s) must not use up the attempt time.
          window.clearTimeout(timeout);
          timeout = window.setTimeout(() => stopSlow(FRAME_ERROR_MESSAGES.runtime), ENGINE_SWITCH_TIMEOUT_MS);
          showStep('กำลังปรับการประมวลผลให้เร็วขึ้นสำหรับเครื่องนี้ กรุณารอสักครู่...');
        } else if (action === 'restart') {
          restartAfterEngineSwitch();
        }
        return;
      }
      if (message.type === 'error') {
        // One failed inference (or the GPU->CPU switch) is skipped like a bad camera frame.
        processing = false;
        frameProblem('runtime');
        return;
      }
      processing = false;
      frameErrors.success();
      const { observation, frame } = message;
      // Frames posted before or during an engine rebuild carry stale timing: never use them.
      if (!engineGuard.accepts(observation.timestampMs)) { frame.close(); return; }
      // A paced text whose turn has come is shown on every processed frame.
      flushInstruction();
      try {
        if (!startedAt) startedAt = observation.timestampMs;
        observedTimestamps.push(observation.timestampMs);
        const slow = fpsProblem(observedTimestamps, 'early');
        if (slow) { stopSlow(slow, frame); return; }
        updateLowLight(frame, observation.timestampMs);

        if (phase === 'passive') {
          // The Backend refuses still frames more than 2 s apart, so a set that can no longer be
          // finished in time starts again (this frame may become the new first one).
          if (passiveSampleGapExpired(lastSampleAt, observation.timestampMs, samples.length, SAMPLE_COUNT)) {
            restartPassive(PASSIVE_GAP_RESTART_MESSAGE, observation.timestampMs);
          }
          if (!qualityOk(observation)) {
            stableFrames = 0;
            presenceSince = null;
            if (!badSince) badSince = observation.timestampMs;
            showHint(faceProblemInstruction(observation, observation.timestampMs - badSince));
            return;
          }
          badSince = 0;
          stableFrames += 1;
          presenceSince ??= observation.timestampMs;
          setIsLoading(false);
          if (observation.timestampMs >= noticeUntil) showHint('มองตรงนิ่ง ๆ ระบบกำลังตรวจใบหน้า');
          const measured = measureFace(frame, observation);
          // Every readable passive frame feeds the blur median, after it was judged itself.
          const observeSharpness = () => { if (measured) sharpnessGate.observe(measured.sharpness); };
          if (
            passiveWarmupDone(firstCameraFrameAt, observation.timestampMs, stableFrames, REQUIRED_STABLE_FRAMES)
            && (samples.length === 0
              ? firstSampleReady(presenceSince, observation.timestampMs, sharpnessGate.median !== null || !measured)
              : observation.timestampMs - lastSampleAt >= SAMPLE_INTERVAL_MS)
          ) {
            // The Backend compares the three frames with each other, so a frame whose pose already
            // drifted from the first one is not taken (and the person is told why).
            const verdict = poseGate.evaluate(observation);
            if (!verdict.accept) {
              if (verdict.restart) {
                restartPassive(PASSIVE_RESTART_MESSAGE, observation.timestampMs);
              } else if (verdict.problem) {
                showHint(PASSIVE_POSE_MESSAGES[verdict.problem]);
              }
              observeSharpness();
              return;
            }
            // A motion-blurred candidate is skipped; the next sharp frame is taken instead.
            if (!sharpnessGate.evaluate(measured?.sharpness ?? null)) {
              observeSharpness();
              return;
            }
            observeSharpness();
            poseGate.commit(observation);
            samples.push(frameToJpeg(frame, PASSIVE_JPEG_QUALITY));
            if (measured) {
              passiveSharpness.push(measured.sharpness);
              passiveLuma.push(measured.luma);
            }
            passiveObservations.push(observation);
            lastSampleAt = observation.timestampMs;
            markers.push({ kind: 'passive_sample', sampleIndex: samples.length, timestampMs: observation.timestampMs });
            setProgress(samples.length / 5);
            if (samples.length === SAMPLE_COUNT) {
              // The Backend needs prompt >= last still + promptDelayMs; the text also stays readable
              // for PREPARE_NOTICE_MIN_MS. promptAt itself is set when the prompt is really shown.
              prepareUntil = observation.timestampMs + Math.max(challenge.promptDelayMs, PREPARE_NOTICE_MIN_MS);
              phase = 'wait_prompt';
              // Only the blink challenge reads the eye-blink scores, so switch them on now,
              // while the person is still waiting for the prompt.
              if (challenge.action === 'blink') client?.setBlendshapes(true);
              showStep('เตรียมทำคำสั่งง่าย ๆ อีกหนึ่งขั้นตอน');
            }
            return;
          }
          observeSharpness();
          return;
        }

        // Eye openness comes from the median of the three still frames (steadier). Head pose and size
        // come from the FIRST still frame because that is what the Backend compares the action and the
        // final frame with.
        const reference = passiveObservations[0];
        const baseline = {
          leftEar: median(passiveObservations.map((item) => item.leftEar)),
          rightEar: median(passiveObservations.map((item) => item.rightEar)),
          faceWidthRatio: reference.faceWidthRatio,
          yaw: reference.yaw,
          pitch: reference.pitch,
          roll: reference.roll ?? 0,
        };

        if (phase === 'wait_prompt') {
          if (observation.timestampMs < prepareUntil) return;
          // prepareUntil >= lastSampleAt + promptDelayMs, so this frame satisfies the Backend order.
          promptAt = observation.timestampMs;
          phase = 'action';
          monitor = new HybridActionMonitor(challenge.action, baseline);
          showStep(challenge.action === 'blink' ? BLINK_PROMPT : MOVE_CLOSER_PROMPT);
          return;
        }

        // The Backend refuses a recovery frame more than 3 s after the action frame. Nothing has been
        // sent yet, so the challenge is still unused: drop the action frame and ask for the action again.
        if (phase === 'recovery' && actionRecoveryExpired(actionAt, observation.timestampMs)) {
          phase = 'action';
          monitor = new HybridActionMonitor(challenge.action, baseline);
          releaseKeptFrame(frame);
          actionImage = '';
          actionAt = 0;
          const actionMarker = markers.findIndex((item) => item.kind === 'challenge_action');
          if (actionMarker >= 0) markers.splice(actionMarker, 1);
          noticeUntil = observation.timestampMs + NOTICE_MS;
          setProgress(SAMPLE_COUNT / 5);
          showStep(challenge.action === 'blink' ? `${ACTION_TOO_SLOW_MESSAGE} ${BLINK_PROMPT}` : MOVE_CLOSER_RECOVERY_LATE_MESSAGE);
          if (challenge.action === 'move_closer') setSizeGuide(moveCloserGuide('action', observation, baseline));
          return;
        }

        if (!monitor) monitor = new HybridActionMonitor(challenge.action, baseline);
        const event = monitor.feed(observation);

        if (phase === 'action') {
          // Keep the candidate frame (the deepest closure so far); release the one it replaces, or
          // the held one when the monitor dropped a too-short closure.
          if (monitor.keepCurrentFrame) {
            releaseKeptFrame(frame);
            keptActionFrame = frame;
          } else if (!monitor.hasCandidate) {
            releaseKeptFrame(frame);
          }
          if (event === 'action_captured') {
            // The uploaded action frame and its timestamp are the kept (deepest) frame, which may be
            // an earlier frame than the one that triggered the commit.
            const actionFrame = keptActionFrame ?? frame;
            actionImage = frameToJpeg(actionFrame);
            actionAt = monitor.actionTimestampMs ?? observation.timestampMs;
            releaseKeptFrame(frame);
            markers.push({ kind: 'challenge_action', action: challenge.action, timestampMs: actionAt });
            phase = 'recovery';
            setProgress(0.8);
            showStep(challenge.action === 'blink' ? BLINK_OPEN_MESSAGE : 'ถอยกลับที่เดิม');
            if (challenge.action === 'move_closer') setSizeGuide(moveCloserGuide('recovery', observation, baseline));
          } else if (challenge.action === 'blink' && monitor.shortClosureDropped) {
            // The eyes reopened before the closure counted: say so (paced, so it stays readable).
            showHint(BLINK_TOO_SHORT_MESSAGE);
          } else if (
            challenge.action === 'blink'
            && !actionRetryShown
            && observation.timestampMs - promptAt >= BLINK_RETRY_AFTER_MS
          ) {
            actionRetryShown = true;
            showHint(BLINK_RETRY_PROMPT);
          } else if (challenge.action === 'move_closer') {
            setSizeGuide(moveCloserGuide('action', observation, baseline));
            if (observation.timestampMs >= noticeUntil) {
              // Keep telling the person which way to go: the scanner needs 1.12-1.60x the first frame.
              const hint = moveCloserHint(observation, baseline);
              if (hint === 'no_face') showHint(faceProblemInstruction(observation, 0));
              else if (hint === 'ok') showHint(MOVE_CLOSER_HOLD_MESSAGE);
              else showHint(MOVE_CLOSER_MESSAGES[hint]);
            }
          }
          return;
        }

        if (event !== 'recovered') {
          // After "move closer" the final frame must be back at the first frame's size (stricter
          // than the Backend, whose size model reads larger right after the face came close).
          if (challenge.action === 'move_closer') {
            setSizeGuide(moveCloserGuide('recovery', observation, baseline));
            if (observation.timestampMs >= noticeUntil) {
              const hint = recoveryHint(observation, baseline, challenge.action);
              if (hint === 'no_face') showHint(faceProblemInstruction(observation, 0));
              else if (hint !== 'ok') showHint(RECOVERY_MESSAGES[hint]);
              else showHint('พอดีแล้ว มองตรงค้างไว้');
            }
          }
          return;
        }

        if (event === 'recovered') {
          const tooSlow = fpsProblem(observedTimestamps, 'final');
          if (tooSlow) { stopSlow(tooSlow, frame); return; }
          const recoveryImage = frameToJpeg(frame);
          markers.push({ kind: 'challenge_recovery', action: challenge.action, timestampMs: observation.timestampMs });
          const elapsed = Math.max(1, observation.timestampMs - startedAt);
          const effectiveFps = observedTimestamps.length > 1 ? ((observedTimestamps.length - 1) * 1000) / elapsed : 0;
          const evidence: HybridLivenessEvidence = {
            version: 4,
            mode: 'hybrid',
            sampleCount: SAMPLE_COUNT,
            action: challenge.action,
            promptDelayMs: challenge.promptDelayMs,
            // A copy: the parent keeps this evidence, and the scanner's own array must never change it.
            frames: [...markers],
            startedAtMs: startedAt,
            promptAtMs: promptAt,
            completedAtMs: observation.timestampMs,
            effectiveFps,
          };
          // Last pre-check: never send evidence whose timing the Backend refuses (the challenge
          // stays unused, so "try again" can reuse it).
          const timingProblem = hybridEvidenceTimingProblem(evidence);
          if (timingProblem) { stopSlow(evidenceTimingMessage(timingProblem, evidence), frame); return; }
          // Success is final: stop the frame loop and the timeout so a later frame can never fire a
          // second 'recovered' (a second callback / a sixth evidence frame).
          halted = true;
          window.clearTimeout(timeout);
          cancelAnimationFrame(animationFrame);
          setProgress(1);
          if (delivered) return;
          delivered = true;
          callbackRef.current({
            mode: 'hybrid',
            faceImageSrc: recoveryImage,
            passiveImageSrcs: samples as [string, string, string],
            actionImageSrc: actionImage,
            recoveryImageSrc: recoveryImage,
            evidence,
          });
        }
      } catch (captureError) {
        releaseKeptFrame(frame);
        fail(captureError instanceof Error ? captureError.message : 'เก็บภาพหลักฐานไม่สำเร็จ');
      }
      // The kept action-frame candidate stays open; every other frame is closed here.
      finally { if (frame !== keptActionFrame) frame.close(); }
    };

    void openFaceLandmarkerClient(handleMessage).then((nextClient) => {
      if (cancelled) { nextClient.close(); return; }
      client = nextClient;
      workerReady = true;
      // Every attempt starts with the eye-blink scores off (cheaper frames).
      client.setBlendshapes(false);
      showStep('วางใบหน้าให้อยู่กลางกรอบ');
      animationFrame = requestAnimationFrame(processFrame);
      armTimeout();
    }).catch((loadError) => fail(loadError instanceof Error ? loadError.message : 'โหลดระบบตรวจจับใบหน้าไม่สำเร็จ'));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.clearInterval(instructionTimer);
      cancelAnimationFrame(animationFrame);
      client?.close();
      releaseKeptFrame();
      setLowLight(false);
      setSizeGuide(null);
    };
  }, [attemptKey, challenge, selectedCameraId]);

  // Step indicator and icon, derived from the progress the frame loop already reports.
  const stepNumber: keyof typeof STEP_LABELS = progress >= 0.8 ? 3 : progress >= SAMPLE_COUNT / 5 ? 2 : 1;
  const blinkStep = challenge.action === 'blink';
  const StepIcon = progress >= 1
    ? ShieldCheck
    : stepNumber === 2
      ? (blinkStep ? EyeClosed : ZoomIn)
      : stepNumber === 3
        ? (blinkStep ? Eye : ZoomOut)
        : progress > 0 ? ScanFace : Camera;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="liveness-scanner-title"
      className="fixed inset-0 isolate overflow-hidden bg-slate-950 text-white"
      style={{ zIndex: 'var(--z-dialog)' }}
    >
      <Webcam
        key={selectedCameraId || 'front-camera'}
        ref={webcamRef}
        audio={false}
        mirrored={mirrorPreview}
        videoConstraints={videoConstraints}
        onUserMedia={() => void handleStreamReady()}
        onUserMediaError={() => {
          setIsLoading(false);
          setError('เปิดกล้องไม่ได้ กรุณาอนุญาตสิทธิ์กล้องและตรวจสอบว่าไม่มีโปรแกรมอื่นใช้งานอยู่');
        }}
        className="absolute inset-0 size-full object-cover"
      />

      <header className="absolute inset-x-0 top-0 z-40 flex items-center gap-3 bg-gradient-to-b from-black/85 to-transparent px-3 pb-12 pt-[max(0.75rem,env(safe-area-inset-top))] min-[375px]:px-4">
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-label="ยกเลิกการสแกนใบหน้าและกลับหน้าก่อนหน้า"
        >
          <ArrowLeft aria-hidden="true" size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 id="liveness-scanner-title" className="truncate text-base font-bold min-[375px]:text-lg">{title}</h2>
          <p className="truncate text-xs text-white/75">วางใบหน้าให้อยู่กลางกรอบ</p>
        </div>
        <CameraQualityControls
          cameras={cameras}
          selectedCameraId={selectedCameraId}
          defaultCameraLabel="กล้องหน้า (อัตโนมัติ)"
          resolution={cameraQuality.resolution}
          continuousFocus={cameraQuality.continuousFocus}
          sharpnessRange={cameraQuality.sharpnessRange}
          sharpness={cameraQuality.sharpness}
          zoomRange={cameraQuality.zoomRange}
          zoom={cameraQuality.zoom}
          onCameraChange={(deviceId) => {
            cameraQuality.clear();
            setIsLoading(true);
            setProgress(0);
            setError('');
            setSelectedCameraId(deviceId);
          }}
          onSharpnessChange={(value) => { void cameraQuality.applySharpness(value); }}
          onZoomChange={(value) => { void cameraQuality.applyZoom(value); }}
          compact
          className="ml-auto shrink-0"
        />
      </header>

      {/* Face guide sits a little below the middle so the instruction card above it never covers it. */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[54%] z-10 h-[min(48dvh,31rem)] w-[min(68vw,23rem)] -translate-x-1/2 -translate-y-1/2 rounded-[48%] border-[3px] border-white/85 shadow-[0_0_0_999px_rgba(2,6,23,0.24)]" />

      {isLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/88 px-5 pt-20 text-center text-white">
          <Loader2 className="mb-4 animate-spin motion-reduce:animate-none" size={44} aria-hidden="true" />
          <p className="font-semibold">กำลังเตรียมระบบตรวจสอบใบหน้า...</p>
          <p className="mt-1 text-xs text-slate-300">โมเดลทำงานบนอุปกรณ์และไม่บันทึกวิดีโอถาวร</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/72 px-4 pt-16 backdrop-blur-sm">
          <section role="alert" className="w-full max-w-sm rounded-3xl border border-red-300/20 bg-red-950/95 p-5 text-center text-sm text-white shadow-2xl">
            <p className="font-semibold leading-6">{error}</p>
            <button type="button" onClick={() => { setError(''); setProgress(0); setIsLoading(true); setInstruction('กำลังเริ่มตรวจสอบรอบใหม่...'); setAttemptKey((value) => value + 1); }} className="mt-4 min-h-11 cursor-pointer rounded-xl bg-white px-5 font-bold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">ลองตรวจอีกครั้ง</button>
          </section>
        </div>
      )}

      {/* Instruction card at the top, right under the header, where the eyes already look at the camera.
          Solid white with dark text so it reads over any camera scene (bright or dark); compact enough
          at 360 px that it ends above the face guide. */}
      <div className="pointer-events-none absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] z-20 px-3 min-[375px]:px-4">
        <section className="mx-auto w-full max-w-sm rounded-2xl border-2 border-slate-900/15 bg-white p-2.5 text-slate-950 shadow-[0_6px_28px_rgba(0,0,0,0.55)] min-[390px]:p-3.5">
          <div className="mb-2 flex items-center gap-2">
            <span data-testid="scan-step" className="shrink-0 rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-bold leading-4 text-white">
              ขั้นที่ {stepNumber}/3 · {STEP_LABELS[stepNumber]}
            </span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="ความคืบหน้าการตรวจสอบ">
              <div className="h-full rounded-full bg-emerald-600 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(6, progress * 100)}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 min-[390px]:size-10">
              <StepIcon size={22} strokeWidth={2.4} />
            </span>
            <span role="status" aria-live="polite" className="min-w-0 flex-1 text-[1.0625rem] font-extrabold leading-[1.4] min-[375px]:text-lg">{instruction}</span>
          </div>
          {sizeGuide && !error && (
            <div className="mt-2" aria-hidden="true" data-testid="size-guide">
              <div className="relative h-3 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="absolute inset-y-0 bg-emerald-300"
                  style={{ left: `${sizeGuide.zoneStart * 100}%`, width: `${(sizeGuide.zoneEnd - sizeGuide.zoneStart) * 100}%` }}
                />
                <div
                  className={`absolute inset-y-[-2px] w-1.5 -translate-x-1/2 rounded-full ${sizeGuide.state === 'hold' ? 'bg-emerald-700' : 'bg-orange-600'}`}
                  style={{ left: `${sizeGuide.marker * 100}%` }}
                />
              </div>
              <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                <span>ไกล</span>
                <span className={sizeGuide.state === 'hold' ? 'font-bold text-emerald-700' : 'font-bold text-orange-700'}>{sizeGuide.label}</span>
                <span>ใกล้</span>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10 min-[375px]:px-4">
        {/* Advisory hints only: they never stop or fail the scan. */}
        <div className="mx-auto mb-2 flex w-full max-w-sm flex-col gap-2">
          {inAppBrowser && !inAppDismissed && <InAppBrowserNotice onDismiss={() => setInAppDismissed(true)} />}
          {lowLight && (
            <p role="status" aria-live="polite" className="rounded-xl border border-amber-300/60 bg-amber-50/95 px-3 py-2 text-center text-sm font-semibold text-amber-950 shadow-xl">
              {LOW_LIGHT_MESSAGE}
            </p>
          )}
        </div>
        <p className="mx-auto max-w-sm text-center text-[11px] leading-4 text-white/80">ระบบตรวจภาพต่อเนื่องและอาจให้ทำคำสั่งง่าย ๆ 1 ครั้งเพื่อป้องกันการเปิดวิดีโอแทนบุคคลจริง</p>
      </div>
    </div>,
    document.body,
  );
}
