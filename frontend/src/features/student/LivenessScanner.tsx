import { useEffect, useMemo, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Camera, Eye, Loader2, ScanFace, Settings, ShieldCheck } from 'lucide-react';
import {
  LIVENESS_TRACKER_LIMITS,
  LivenessTracker,
  type LivenessAction,
  type LivenessEvidence,
  type LivenessFrameMarker,
} from '../../utils/liveness';
import {
  openFaceLandmarkerClient,
  type FaceLandmarkerClient,
  type FaceLandmarkerClientEvent,
} from '../../services/faceLandmarkerRuntime';

export interface LivenessCapture {
  faceImageSrc: string;
  baselineImageSrc: string;
  nearImageSrc: string;
  returnImageSrc: string;
  blinkClosedImageSrcs: string[];
  blinkOpenImageSrcs: string[];
  evidence: LivenessEvidence;
}

type EvidenceFrames = {
  baseline: string | null;
  near: string | null;
  returned: string | null;
  blinkClosed: string[];
  blinkOpen: string[];
  final: string | null;
};

function emptyEvidenceFrames(): EvidenceFrames {
  return {
    baseline: null,
    near: null,
    returned: null,
    blinkClosed: [],
    blinkOpen: [],
    final: null,
  };
}

function frameToJpeg(frame: ImageBitmap): string {
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(frame.width, frame.height));
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('อุปกรณ์นี้ไม่สามารถเก็บภาพหลักฐานได้');
  context.drawImage(frame, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function storeCapture(frames: EvidenceFrames, marker: LivenessFrameMarker, image: string): void {
  if (marker.kind === 'baseline_open') frames.baseline = image;
  else if (marker.kind === 'near') frames.near = image;
  else if (marker.kind === 'returned') frames.returned = image;
  else if (marker.kind === 'final_open') frames.final = image;
  else if (marker.kind === 'blink_closed') frames.blinkClosed[(marker.blinkIndex ?? 1) - 1] = image;
  else if (marker.kind === 'blink_open') frames.blinkOpen[(marker.blinkIndex ?? 1) - 1] = image;
}

export default function LivenessScanner({
  actions,
  requiredBlinks,
  promptDelayMs,
  onCaptureSuccess,
}: {
  actions: LivenessAction[];
  requiredBlinks: number;
  promptDelayMs: number;
  onCaptureSuccess: (capture: LivenessCapture) => void;
}) {
  const webcamRef = useRef<Webcam>(null);
  const callbackRef = useRef(onCaptureSuccess);
  const evidenceFramesRef = useRef<EvidenceFrames>(emptyEvidenceFrames());
  const finishedRef = useRef(false);
  const [instruction, setInstruction] = useState('กำลังโหลดโมเดลตรวจจับใบหน้า...');
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [error, setError] = useState('');
  const [attemptKey, setAttemptKey] = useState(0);
  const challengeKey = `${actions.join(',')}:${requiredBlinks}:${promptDelayMs}`;

  useEffect(() => { callbackRef.current = onCaptureSuccess; }, [onCaptureSuccess]);

  const videoConstraints = useMemo<MediaTrackConstraints>(() => (
    selectedCameraId
      ? { deviceId: { exact: selectedCameraId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }
  ), [selectedCameraId]);

  const handleStreamReady = async () => {
    setError('');
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((device) => device.kind === 'videoinput'));
    } catch {
      setCameras([]);
    }
  };

  useEffect(() => {
    let animationFrame = 0;
    let timeout = 0;
    let cancelled = false;
    let workerReady = false;
    let processing = false;
    let lastProcessedAt = 0;
    let client: FaceLandmarkerClient | null = null;
    const configuredActions = actions.join(',').split(',') as LivenessAction[];
    const tracker = new LivenessTracker(configuredActions, requiredBlinks, promptDelayMs);
    evidenceFramesRef.current = emptyEvidenceFrames();
    finishedRef.current = false;

    const fail = (message: string) => {
      if (cancelled || finishedRef.current) return;
      finishedRef.current = true;
      setIsLoading(false);
      setError(message);
    };

    const processFrame = async (timestamp: number) => {
      if (cancelled) return;
      const video = webcamRef.current?.video;
      if (
        workerReady
        && video
        && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && !processing
        && timestamp - lastProcessedAt >= 50
        && !finishedRef.current
      ) {
        processing = true;
        lastProcessedAt = timestamp;
        try {
          const frame = await createImageBitmap(video);
          if (cancelled) {
            frame.close();
          } else {
            client?.postFrame(frame, performance.now());
          }
        } catch {
          processing = false;
          fail('อุปกรณ์นี้ไม่สามารถส่งภาพกล้องไปตรวจสอบได้ กรุณาอัปเดตเบราว์เซอร์');
        }
      }
      animationFrame = requestAnimationFrame(processFrame);
    };

    const handleWorkerMessage = (message: FaceLandmarkerClientEvent) => {
      if (cancelled) {
        if (message.type === 'result') message.frame.close();
        return;
      }
      if (message.type === 'error') {
        processing = false;
        fail(message.message || 'ประมวลผลภาพจากกล้องไม่สำเร็จ กรุณาเริ่มใหม่');
        return;
      }

      processing = false;
      const { observation, frame } = message;
      try {
        const step = tracker.add(observation);
        setInstruction(step.instruction);
        setProgress(step.progress);
        if (step.captures.length > 0) {
          const image = frameToJpeg(frame);
          for (const marker of step.captures) {
            storeCapture(evidenceFramesRef.current, marker, image);
          }
        }
        if (step.failed) {
          fail(step.instruction);
          return;
        }
        if (step.completed && step.evidence) {
          const evidenceFrames = evidenceFramesRef.current;
          if (
            !evidenceFrames.final
            || !evidenceFrames.baseline
            || !evidenceFrames.near
            || !evidenceFrames.returned
            || evidenceFrames.blinkClosed.length !== requiredBlinks
            || evidenceFrames.blinkOpen.length !== requiredBlinks
            || evidenceFrames.blinkClosed.some((item) => !item)
            || evidenceFrames.blinkOpen.some((item) => !item)
          ) {
            fail('เก็บชุดภาพหลักฐานไม่ครบ กรุณาเริ่มใหม่');
            return;
          }
          finishedRef.current = true;
          window.clearTimeout(timeout);
          callbackRef.current({
            faceImageSrc: evidenceFrames.final,
            baselineImageSrc: evidenceFrames.baseline,
            nearImageSrc: evidenceFrames.near,
            returnImageSrc: evidenceFrames.returned,
            blinkClosedImageSrcs: [...evidenceFrames.blinkClosed],
            blinkOpenImageSrcs: [...evidenceFrames.blinkOpen],
            evidence: step.evidence,
          });
        }
      } catch (captureError) {
        fail(captureError instanceof Error ? captureError.message : 'เก็บภาพหลักฐานไม่สำเร็จ กรุณาเริ่มใหม่');
      } finally {
        frame.close();
      }
    };

    void openFaceLandmarkerClient(handleWorkerMessage)
      .then((nextClient) => {
        if (cancelled) {
          nextClient.close();
          return;
        }
        client = nextClient;
        workerReady = true;
        setIsLoading(false);
        setInstruction('วางใบหน้าให้อยู่ในกรอบ มองตรงและอยู่นิ่ง');
        timeout = window.setTimeout(() => {
          fail('ใช้เวลาตรวจสอบรอบนี้นานเกินไป กรุณากดลองตรวจอีกครั้ง');
        }, LIVENESS_TRACKER_LIMITS.maxAttemptDurationMs);
      })
      .catch(() => fail('เตรียมระบบตรวจจับใบหน้าไม่สำเร็จ กรุณากดลองตรวจอีกครั้ง'));
    animationFrame = requestAnimationFrame(processFrame);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(animationFrame);
      client?.close();
    };
  }, [actions, attemptKey, challengeKey, promptDelayMs, requiredBlinks, selectedCameraId]);

  return (
    <div className="relative flex min-h-[clamp(20rem,64dvh,27rem)] w-full flex-col items-center justify-center overflow-hidden rounded-2xl bg-gray-950">
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-950/90 px-5 text-center text-white">
          <Loader2 className="mb-4 animate-spin motion-reduce:animate-none" size={44} />
          <p className="font-semibold">กำลังเตรียมระบบตรวจสอบใบหน้า...</p>
          <p className="mt-1 text-xs text-gray-300">โมเดลทำงานบนอุปกรณ์และไม่บันทึกวิดีโอถาวร</p>
        </div>
      )}

      {error && (
        <div role="alert" className="absolute left-4 right-4 top-16 z-30 rounded-xl bg-red-700 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setError('');
              setProgress(0);
              setIsLoading(true);
              setInstruction('กำลังเริ่มตรวจสอบรอบใหม่...');
              setAttemptKey((current) => current + 1);
            }}
            className="mt-3 min-h-11 rounded-lg bg-white px-4 font-bold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            ลองตรวจอีกครั้ง
          </button>
        </div>
      )}

      {cameras.length > 1 && (
        <label className="absolute left-3 top-3 z-10 flex min-h-11 items-center gap-2 rounded-lg border border-white/20 bg-black/75 px-3 text-white">
          <Settings className="h-4 w-4" />
          <span className="sr-only">เลือกกล้อง</span>
          <select
            className="max-w-48 cursor-pointer bg-transparent py-2 text-sm focus:outline-none"
            value={selectedCameraId}
            onChange={(event) => {
              setIsLoading(true);
              setProgress(0);
              setInstruction('กำลังสลับกล้องและปรับเทียบใหม่...');
              setError('');
              setSelectedCameraId(event.target.value);
            }}
          >
            <option value="" className="bg-gray-950">กล้องหน้า (อัตโนมัติ)</option>
            {cameras.map((camera, index) => (
              <option key={camera.deviceId} value={camera.deviceId} className="bg-gray-950">
                {camera.label || `กล้องตัวที่ ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}

      <Webcam
        key={selectedCameraId || 'front-camera'}
        ref={webcamRef}
        audio={false}
        mirrored={false}
        videoConstraints={videoConstraints}
        onUserMedia={() => { void handleStreamReady(); }}
        onUserMediaError={() => {
          setIsLoading(false);
          setError('เปิดกล้องไม่ได้ กรุณาอนุญาตสิทธิ์กล้องและตรวจสอบว่าไม่มีโปรแกรมอื่นใช้งานอยู่');
        }}
        className="max-h-[min(35rem,64dvh)] w-full object-contain"
      />

      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[55%] w-[62%] -translate-x-1/2 -translate-y-[56%] rounded-[48%] border-4 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.18)]" />

      <div className="absolute bottom-5 left-4 right-4 z-10 rounded-2xl bg-white/95 p-4 text-gray-900 shadow-xl backdrop-blur">
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="ความคืบหน้าการตรวจสอบ">
          <div className="h-full rounded-full bg-green-600 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(6, progress * 100)}%` }} />
        </div>
        <div className="flex items-center justify-center gap-3 text-center">
          {progress >= 1 ? <ShieldCheck className="shrink-0 text-green-700" />
            : progress >= 0.55 ? <Eye className="shrink-0 text-green-700" />
              : progress >= 0.2 ? <ScanFace className="shrink-0 text-green-700" />
                : <Camera className="shrink-0 text-green-700" />}
          <span role="status" aria-live="polite" className="font-bold">{instruction}</span>
        </div>
        <p className="mt-2 text-center text-xs text-gray-500">แต่ละรอบใช้เวลาได้ไม่เกิน 45 วินาที · ต้องเห็นใบหน้าเพียง 1 คน · ห้ามใช้ภาพนิ่งหรือวิดีโอแทนบุคคลจริง</p>
      </div>
    </div>
  );
}
