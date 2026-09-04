import { useEffect, useMemo, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { ArrowLeft, ArrowRight, Camera, Loader2, Settings, ShieldCheck } from 'lucide-react';
import {
  loadMediapipe,
  locateFaceMeshAsset,
  type FaceMeshInstance,
  type FaceMeshResults,
} from '../../services/mediapipe';
import {
  LivenessTracker,
  type LivenessAction,
  type LivenessEvidence,
  type LivenessObservation,
} from '../../utils/liveness';

interface LandmarkPoint {
  x: number;
  y: number;
}

export interface LivenessCapture {
  faceImageSrc: string;
  blinkImageSrc: string;
  turnImageSrc: string;
  evidence: LivenessEvidence;
}

function distance(p1: LandmarkPoint, p2: LandmarkPoint): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function eyeAspectRatio(landmarks: LandmarkPoint[], indices: number[]): number {
  const [p1, p2, p3, p4, p5, p6] = indices.map((index) => landmarks[index]);
  return (distance(p2, p6) + distance(p3, p5)) / Math.max(2 * distance(p1, p4), 0.0001);
}

function observationFromResults(results: FaceMeshResults, timestampMs: number): LivenessObservation {
  const faces = results.multiFaceLandmarks ?? [];
  const landmarks = faces[0];
  if (!landmarks) {
    return { timestampMs, faceCount: 0, leftEar: 0, rightEar: 0, yaw: 0, pitch: 0, faceWidthRatio: 0, centerOffset: 1 };
  }

  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const nose = landmarks[1];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const mouth = landmarks[13];
  const faceWidth = Math.max(Math.abs(rightCheek.x - leftCheek.x), 0.0001);
  const faceCenterX = (leftCheek.x + rightCheek.x) / 2;
  const eyeMidY = (leftEye.y + rightEye.y) / 2;

  return {
    timestampMs,
    faceCount: faces.length,
    leftEar: eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380]),
    rightEar: eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144]),
    yaw: (nose.x - faceCenterX) / faceWidth,
    pitch: (nose.y - eyeMidY) / Math.max(mouth.y - eyeMidY, 0.0001),
    faceWidthRatio: faceWidth,
    centerOffset: Math.abs(faceCenterX - 0.5),
  };
}

export default function LivenessScanner({
  actions,
  onCaptureSuccess,
}: {
  actions: LivenessAction[];
  onCaptureSuccess: (capture: LivenessCapture) => void;
}) {
  const webcamRef = useRef<Webcam>(null);
  const callbackRef = useRef(onCaptureSuccess);
  const turnImageRef = useRef<string | null>(null);
  const blinkImageRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const [instruction, setInstruction] = useState('กำลังโหลดโมเดลตรวจจับใบหน้า...');
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [error, setError] = useState('');
  const actionsKey = actions.join(',');
  const currentAction = progress >= 1
    ? undefined
    : actions[Math.min(Math.floor(progress * actions.length), actions.length - 1)];

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
    let faceMesh: FaceMeshInstance | null = null;
    let animationFrame = 0;
    let cancelled = false;
    let processing = false;
    let lastProcessedAt = 0;
    const configuredActions = actionsKey.split(',') as LivenessAction[];
    const tracker = new LivenessTracker(configuredActions);
    turnImageRef.current = null;
    blinkImageRef.current = null;
    finishedRef.current = false;

    const timeout = window.setTimeout(() => {
      if (!finishedRef.current) setError('ใช้เวลาตรวจสอบนานเกินไป กรุณายกเลิกแล้วเริ่มใหม่');
    }, 18_000);

    const processFrame = async (timestamp: number) => {
      if (cancelled) return;
      const video = webcamRef.current?.video;
      if (
        faceMesh
        && video
        && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && !processing
        && timestamp - lastProcessedAt >= 66
        && !finishedRef.current
      ) {
        processing = true;
        lastProcessedAt = timestamp;
        try {
          await faceMesh.send({ image: video });
        } catch {
          if (!cancelled) setError('ประมวลผลภาพจากกล้องไม่สำเร็จ กรุณาเริ่มใหม่');
        } finally {
          processing = false;
        }
      }
      animationFrame = requestAnimationFrame(processFrame);
    };

    const initialize = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('เบราว์เซอร์นี้ไม่รองรับการใช้งานกล้อง');
        const { FaceMesh } = await loadMediapipe();
        if (cancelled) return;
        faceMesh = new FaceMesh({ locateFile: locateFaceMeshAsset });
        faceMesh.setOptions({
          maxNumFaces: 2,
          refineLandmarks: true,
          minDetectionConfidence: 0.65,
          minTrackingConfidence: 0.65,
        });
        faceMesh.onResults((results) => {
          if (cancelled || finishedRef.current) return;
          setIsLoading(false);
          const step = tracker.add(observationFromResults(results, performance.now()));
          setInstruction(step.instruction);
          setProgress(step.progress);
          if (step.captureTurn) {
            turnImageRef.current = webcamRef.current?.getScreenshot() ?? null;
          }
          if (step.captureBlink) {
            blinkImageRef.current = webcamRef.current?.getScreenshot() ?? null;
          }
          if (step.completed && step.evidence) {
            const faceImageSrc = webcamRef.current?.getScreenshot();
            if (!faceImageSrc || !blinkImageRef.current || !turnImageRef.current) {
              setError('ไม่สามารถเก็บภาพหลักฐานได้ กรุณาเริ่มใหม่');
              return;
            }
            finishedRef.current = true;
            window.clearTimeout(timeout);
            callbackRef.current({
              faceImageSrc,
              blinkImageSrc: blinkImageRef.current,
              turnImageSrc: turnImageRef.current,
              evidence: step.evidence,
            });
          }
        });
        animationFrame = requestAnimationFrame(processFrame);
      } catch (initializationError) {
        if (cancelled) return;
        setIsLoading(false);
        setError(initializationError instanceof Error ? initializationError.message : 'ไม่สามารถเริ่มระบบตรวจจับใบหน้าได้');
      }
    };

    void initialize();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(animationFrame);
      faceMesh?.close();
    };
  }, [actionsKey, selectedCameraId]);

  return (
    <div className="relative flex min-h-[clamp(20rem,64dvh,27rem)] w-full flex-col items-center justify-center overflow-hidden rounded-2xl bg-gray-950">
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-950/90 text-white">
          <Loader2 className="mb-4 animate-spin" size={44} />
          <p className="font-semibold">กำลังเตรียมระบบตรวจสอบใบหน้า...</p>
        </div>
      )}

      {error && (
        <div role="alert" className="absolute left-4 right-4 top-16 z-30 rounded-xl bg-red-700 px-4 py-3 text-center text-sm font-semibold text-white">
          {error}
        </div>
      )}

      {cameras.length > 1 && (
        <label className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-white/20 bg-black/70 px-2 py-1 text-white">
          <Settings className="h-4 w-4" />
          <span className="sr-only">เลือกกล้อง</span>
          <select
            className="max-w-48 cursor-pointer bg-transparent py-1 text-sm focus:outline-none"
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
        screenshotFormat="image/jpeg"
        screenshotQuality={0.86}
        forceScreenshotSourceSize
        videoConstraints={videoConstraints}
        onUserMedia={() => { void handleStreamReady(); }}
        onUserMediaError={() => {
          setIsLoading(false);
          setError('เปิดกล้องไม่ได้ กรุณาอนุญาตสิทธิ์กล้องและตรวจสอบว่าไม่มีโปรแกรมอื่นใช้งานอยู่');
        }}
        className="max-h-[min(35rem,64dvh)] w-full object-cover"
      />

      <div className="absolute bottom-5 left-4 right-4 z-10 rounded-2xl bg-white/95 p-4 text-gray-900 shadow-xl backdrop-blur">
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-200" aria-label={`ความคืบหน้า ${Math.round(progress * 100)}%`}>
          <div className="h-full rounded-full bg-green-600 transition-[width]" style={{ width: `${Math.max(6, progress * 100)}%` }} />
        </div>
        <div className="flex items-center justify-center gap-3 text-center">
          {currentAction === 'turn_left' ? <ArrowLeft className="shrink-0 text-green-700" />
            : currentAction === 'turn_right' ? <ArrowRight className="shrink-0 text-green-700" />
              : progress >= 1 ? <ShieldCheck className="shrink-0 text-green-700" />
                : <Camera className="shrink-0 text-green-700" />}
          <span role="status" aria-live="polite" className="font-bold">{instruction}</span>
        </div>
      </div>
    </div>
  );
}
