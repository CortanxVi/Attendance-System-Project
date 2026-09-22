import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Webcam from 'react-webcam';
import { ArrowLeft, Camera, Loader2, ScanFace, ShieldCheck } from 'lucide-react';
import CameraQualityControls from '../../components/camera/CameraQualityControls';
import { useModalIsolation } from '../../components/overlays/useModalIsolation';
import { useCameraQuality } from '../../hooks/useCameraQuality';
import { openFaceLandmarkerClient, type FaceLandmarkerClient, type FaceLandmarkerClientEvent } from '../../services/faceLandmarkerRuntime';
import type {
  HybridLivenessAction,
  HybridLivenessEvidence,
  LivenessObservation,
} from '../../utils/liveness';
import { hybridActionDetected, hybridRecoveryDetected } from '../../utils/liveness';

const SAMPLE_COUNT = 3 as const;
const SAMPLE_INTERVAL_MS = 450;
const ATTEMPT_TIMEOUT_MS = 20_000;

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

function frameToJpeg(frame: ImageBitmap): string {
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(frame.width, frame.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('อุปกรณ์นี้ไม่สามารถเก็บภาพหลักฐานได้');
  context.drawImage(frame, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

function isRearCamera(facingMode: string | undefined, selectedCamera: MediaDeviceInfo | undefined): boolean {
  if (facingMode === 'environment') return true;
  const label = selectedCamera?.label.toLowerCase() ?? '';
  return /back|rear|environment|ultra|telephoto|กล้องหลัง/.test(label);
}

export default function LivenessScanner({
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
  const cameraQuality = useCameraQuality();

  useModalIsolation(true);

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
    let promptAt = 0;
    let actionStableFrames = 0;
    let recoveryStableFrames = 0;
    let actionImage = '';
    const samples: string[] = [];
    const passiveObservations: LivenessObservation[] = [];
    const markers: HybridLivenessEvidence['frames'] = [];
    const observedTimestamps: number[] = [];

    const fail = (message: string) => {
      if (cancelled) return;
      setIsLoading(false);
      setError(message);
    };
    const qualityOk = (observation: LivenessObservation) => observation.faceCount === 1
      && observation.faceWidthRatio >= 0.20
      && observation.faceWidthRatio <= 0.76
      && observation.centerOffset <= 0.22
      && observation.leftEar > 0.07
      && observation.rightEar > 0.07;
    const processFrame = async (timestamp: number) => {
      if (cancelled) return;
      const video = webcamRef.current?.video;
      if (workerReady && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !processing && timestamp - lastProcessedAt >= 50) {
        processing = true;
        lastProcessedAt = timestamp;
        try { client?.postFrame(await createImageBitmap(video), performance.now()); }
        catch { processing = false; fail('อุปกรณ์นี้ไม่สามารถส่งภาพกล้องไปตรวจสอบได้ กรุณาอัปเดตเบราว์เซอร์'); }
      }
      animationFrame = requestAnimationFrame(processFrame);
    };
    const handleMessage = (message: FaceLandmarkerClientEvent) => {
      if (cancelled) { if (message.type === 'result') message.frame.close(); return; }
      if (message.type === 'error') { processing = false; fail(message.message || 'ประมวลผลภาพจากกล้องไม่สำเร็จ'); return; }
      processing = false;
      const { observation, frame } = message;
      try {
        if (!startedAt) startedAt = observation.timestampMs;
        observedTimestamps.push(observation.timestampMs);

        if (phase === 'passive') {
          if (!qualityOk(observation)) {
            stableFrames = 0;
            setInstruction(observation.faceCount > 1 ? 'ให้มีใบหน้าในกรอบเพียง 1 คน' : observation.faceCount === 0 ? 'วางใบหน้าให้อยู่ในกรอบ' : 'มองตรงและขยับใบหน้าให้อยู่กลางกรอบ');
            return;
          }
          stableFrames += 1;
          setIsLoading(false);
          setInstruction('มองตรงนิ่ง ๆ ระบบกำลังตรวจใบหน้า');
          if (stableFrames >= 4 && (samples.length === 0 || observation.timestampMs - lastSampleAt >= SAMPLE_INTERVAL_MS)) {
            samples.push(frameToJpeg(frame));
            passiveObservations.push(observation);
            lastSampleAt = observation.timestampMs;
            markers.push({ kind: 'passive_sample', sampleIndex: samples.length, timestampMs: observation.timestampMs });
            setProgress(samples.length / 5);
            if (samples.length === SAMPLE_COUNT) {
              promptAt = observation.timestampMs + challenge.promptDelayMs;
              phase = 'wait_prompt';
              setInstruction('เตรียมทำคำสั่งง่าย ๆ อีกหนึ่งขั้นตอน');
            }
          }
          return;
        }

        const baseline = {
          leftEar: median(passiveObservations.map((item) => item.leftEar)),
          rightEar: median(passiveObservations.map((item) => item.rightEar)),
          faceWidthRatio: median(passiveObservations.map((item) => item.faceWidthRatio)),
          yaw: median(passiveObservations.map((item) => item.yaw)),
          pitch: median(passiveObservations.map((item) => item.pitch)),
        };

        if (phase === 'wait_prompt') {
          if (observation.timestampMs < promptAt) return;
          phase = 'action';
          setInstruction(challenge.action === 'blink' ? 'กะพริบตาทั้งสองข้าง 1 ครั้ง' : 'ขยับใบหน้าเข้าใกล้กล้องเล็กน้อย');
          return;
        }

        if (phase === 'action') {
          actionStableFrames = hybridActionDetected(
            challenge.action,
            observation,
            baseline,
          ) ? actionStableFrames + 1 : 0;
          if (actionStableFrames >= 2) {
            actionImage = frameToJpeg(frame);
            markers.push({ kind: 'challenge_action', action: challenge.action, timestampMs: observation.timestampMs });
            phase = 'recovery';
            setProgress(0.8);
            setInstruction(challenge.action === 'blink' ? 'ลืมตาและมองตรง' : 'กลับมาอยู่ในกรอบเดิม');
          }
          return;
        }

        recoveryStableFrames = hybridRecoveryDetected(
          observation,
          baseline,
        ) ? recoveryStableFrames + 1 : 0;
        if (recoveryStableFrames >= 2) {
          const recoveryImage = frameToJpeg(frame);
          markers.push({ kind: 'challenge_recovery', action: challenge.action, timestampMs: observation.timestampMs });
          const elapsed = Math.max(1, observation.timestampMs - startedAt);
          const effectiveFps = observedTimestamps.length > 1 ? ((observedTimestamps.length - 1) * 1000) / elapsed : 0;
          window.clearTimeout(timeout);
          setProgress(1);
          callbackRef.current({
            mode: 'hybrid',
            faceImageSrc: recoveryImage,
            passiveImageSrcs: samples as [string, string, string],
            actionImageSrc: actionImage,
            recoveryImageSrc: recoveryImage,
            evidence: {
              version: 4,
              mode: 'hybrid',
              sampleCount: SAMPLE_COUNT,
              action: challenge.action,
              promptDelayMs: challenge.promptDelayMs,
              frames: markers,
              startedAtMs: startedAt,
              promptAtMs: promptAt,
              completedAtMs: observation.timestampMs,
              effectiveFps,
            },
          });
        }
      } catch (captureError) { fail(captureError instanceof Error ? captureError.message : 'เก็บภาพหลักฐานไม่สำเร็จ'); }
      finally { frame.close(); }
    };

    void openFaceLandmarkerClient(handleMessage).then((nextClient) => {
      if (cancelled) { nextClient.close(); return; }
      client = nextClient;
      workerReady = true;
      setInstruction('วางใบหน้าให้อยู่กลางกรอบ');
      animationFrame = requestAnimationFrame(processFrame);
      timeout = window.setTimeout(() => fail('ตรวจใบหน้าไม่สำเร็จภายในเวลาที่กำหนด กรุณาจัดแสงและลองใหม่'), ATTEMPT_TIMEOUT_MS);
    }).catch((loadError) => fail(loadError instanceof Error ? loadError.message : 'โหลดระบบตรวจจับใบหน้าไม่สำเร็จ'));
    return () => { cancelled = true; window.clearTimeout(timeout); cancelAnimationFrame(animationFrame); client?.close(); };
  }, [attemptKey, challenge, selectedCameraId]);

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

      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[46%] z-10 h-[min(55dvh,34rem)] w-[min(72vw,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-[48%] border-[3px] border-white/85 shadow-[0_0_0_999px_rgba(2,6,23,0.24)]" />

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

      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-16 min-[375px]:px-4">
        <section className="mx-auto w-full max-w-sm rounded-2xl border border-white/20 bg-white/94 p-3 text-slate-900 shadow-2xl backdrop-blur min-[390px]:p-4">
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="ความคืบหน้าการตรวจสอบ">
            <div className="h-full rounded-full bg-emerald-600 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(6, progress * 100)}%` }} />
          </div>
          <div className="flex items-center justify-center gap-2 text-center">
            {progress >= 1 ? <ShieldCheck className="shrink-0 text-emerald-700" aria-hidden="true" /> : progress > 0 ? <ScanFace className="shrink-0 text-emerald-700" aria-hidden="true" /> : <Camera className="shrink-0 text-emerald-700" aria-hidden="true" />}
            <span role="status" aria-live="polite" className="font-bold">{instruction}</span>
          </div>
          <p className="mt-1.5 text-center text-[11px] leading-4 text-slate-500">ระบบตรวจภาพต่อเนื่องและอาจให้ทำคำสั่งง่าย ๆ 1 ครั้งเพื่อป้องกันการเปิดวิดีโอแทนบุคคลจริง</p>
        </section>
      </div>
    </div>,
    document.body,
  );
}
