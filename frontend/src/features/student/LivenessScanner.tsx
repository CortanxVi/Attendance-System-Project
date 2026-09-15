import { useEffect, useMemo, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Camera, Loader2, ScanFace, Settings, ShieldCheck } from 'lucide-react';
import { openFaceLandmarkerClient, type FaceLandmarkerClient, type FaceLandmarkerClientEvent } from '../../services/faceLandmarkerRuntime';
import type {
  AttendanceLivenessAction,
  AttendanceLivenessEvidence,
  LivenessObservation,
  PassiveLivenessEvidence,
} from '../../utils/liveness';
import { attendanceActionDetected, attendanceRecoveryDetected } from '../../utils/liveness';

const SAMPLE_COUNT = 3 as const;
const SAMPLE_INTERVAL_MS = 450;
const ATTEMPT_TIMEOUT_MS = 20_000;

export interface PassiveLivenessCapture {
  mode: 'passive';
  faceImageSrc: string;
  passiveImageSrcs: [string, string, string];
  evidence: PassiveLivenessEvidence;
}

export interface AttendanceLivenessCapture {
  mode: 'hybrid';
  faceImageSrc: string;
  passiveImageSrcs: [string, string, string];
  actionImageSrc: string;
  recoveryImageSrc: string;
  evidence: AttendanceLivenessEvidence;
}

export type LivenessCapture = PassiveLivenessCapture | AttendanceLivenessCapture;

interface LivenessScannerProps {
  onCaptureSuccess: (capture: LivenessCapture) => void;
  attendanceChallenge?: {
    action: AttendanceLivenessAction;
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

export default function LivenessScanner({ onCaptureSuccess, attendanceChallenge }: LivenessScannerProps) {
  const webcamRef = useRef<Webcam>(null);
  const callbackRef = useRef(onCaptureSuccess);
  const [instruction, setInstruction] = useState('กำลังเตรียมระบบตรวจใบหน้า...');
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [error, setError] = useState('');
  const [attemptKey, setAttemptKey] = useState(0);

  useEffect(() => { callbackRef.current = onCaptureSuccess; }, [onCaptureSuccess]);
  const videoConstraints = useMemo<MediaTrackConstraints>(() => selectedCameraId
    ? { deviceId: { exact: selectedCameraId }, width: { ideal: 640 }, height: { ideal: 480 } }
    : { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }, [selectedCameraId]);

  const handleStreamReady = async () => {
    setError('');
    const stream = webcamRef.current?.video?.srcObject;
    if (stream instanceof MediaStream) {
      const facingMode = stream.getVideoTracks()[0]?.getSettings().facingMode;
      setMirrorPreview(facingMode !== 'environment');
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
    const markers: AttendanceLivenessEvidence['frames'] = [];
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
            setProgress(samples.length / (attendanceChallenge ? 5 : SAMPLE_COUNT));
            if (samples.length === SAMPLE_COUNT) {
              if (!attendanceChallenge) {
                const elapsed = Math.max(1, observation.timestampMs - startedAt);
                const effectiveFps = observedTimestamps.length > 1 ? ((observedTimestamps.length - 1) * 1000) / elapsed : 0;
                window.clearTimeout(timeout);
                callbackRef.current({
                  mode: 'passive',
                  faceImageSrc: samples[2],
                  passiveImageSrcs: samples as [string, string, string],
                  evidence: { version: 3, mode: 'passive', sampleCount: SAMPLE_COUNT, frames: markers.slice(0, 3) as PassiveLivenessEvidence['frames'], startedAtMs: startedAt, completedAtMs: observation.timestampMs, effectiveFps },
                });
              } else {
                promptAt = observation.timestampMs + attendanceChallenge.promptDelayMs;
                phase = 'wait_prompt';
                setInstruction('เตรียมทำคำสั่งง่าย ๆ อีกหนึ่งขั้นตอน');
              }
            }
          }
          return;
        }

        if (!attendanceChallenge) return;
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
          setInstruction(attendanceChallenge.action === 'blink' ? 'กะพริบตาทั้งสองข้าง 1 ครั้ง' : 'ขยับใบหน้าเข้าใกล้กล้องเล็กน้อย');
          return;
        }

        if (phase === 'action') {
          actionStableFrames = attendanceActionDetected(
            attendanceChallenge.action,
            observation,
            baseline,
          ) ? actionStableFrames + 1 : 0;
          if (actionStableFrames >= 2) {
            actionImage = frameToJpeg(frame);
            markers.push({ kind: 'challenge_action', action: attendanceChallenge.action, timestampMs: observation.timestampMs });
            phase = 'recovery';
            setProgress(0.8);
            setInstruction(attendanceChallenge.action === 'blink' ? 'ลืมตาและมองตรง' : 'กลับมาอยู่ในกรอบเดิม');
          }
          return;
        }

        recoveryStableFrames = attendanceRecoveryDetected(
          observation,
          baseline,
        ) ? recoveryStableFrames + 1 : 0;
        if (recoveryStableFrames >= 2) {
          const recoveryImage = frameToJpeg(frame);
          markers.push({ kind: 'challenge_recovery', action: attendanceChallenge.action, timestampMs: observation.timestampMs });
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
              action: attendanceChallenge.action,
              promptDelayMs: attendanceChallenge.promptDelayMs,
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
  }, [attemptKey, attendanceChallenge, selectedCameraId]);

  return <div className="relative flex min-h-[clamp(20rem,64dvh,27rem)] w-full flex-col items-center justify-center overflow-hidden rounded-2xl bg-gray-950">
    {isLoading && <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-950/90 px-5 text-center text-white"><Loader2 className="mb-4 animate-spin motion-reduce:animate-none" size={44} /><p className="font-semibold">กำลังเตรียมระบบตรวจสอบใบหน้า...</p><p className="mt-1 text-xs text-gray-300">โมเดลทำงานบนอุปกรณ์และไม่บันทึกวิดีโอถาวร</p></div>}
    {error && <div role="alert" className="absolute left-4 right-4 top-16 z-30 rounded-xl bg-red-700 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg"><p>{error}</p><button type="button" onClick={() => { setError(''); setProgress(0); setIsLoading(true); setInstruction('กำลังเริ่มตรวจสอบรอบใหม่...'); setAttemptKey((value) => value + 1); }} className="mt-3 min-h-11 rounded-lg bg-white px-4 font-bold text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-white">ลองตรวจอีกครั้ง</button></div>}
    {cameras.length > 1 && <label className="absolute left-3 top-3 z-10 flex min-h-11 items-center gap-2 rounded-lg border border-white/20 bg-black/75 px-3 text-white"><Settings className="size-4" /><span className="sr-only">เลือกกล้อง</span><select className="max-w-48 cursor-pointer bg-transparent py-2 text-sm focus:outline-none" value={selectedCameraId} onChange={(event) => { setIsLoading(true); setProgress(0); setError(''); setSelectedCameraId(event.target.value); }}><option value="" className="bg-gray-950">กล้องหน้า (อัตโนมัติ)</option>{cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId} className="bg-gray-950">{camera.label || `กล้องตัวที่ ${index + 1}`}</option>)}</select></label>}
    <Webcam key={selectedCameraId || 'front-camera'} ref={webcamRef} audio={false} mirrored={mirrorPreview} videoConstraints={videoConstraints} onUserMedia={() => void handleStreamReady()} onUserMediaError={() => { setIsLoading(false); setError('เปิดกล้องไม่ได้ กรุณาอนุญาตสิทธิ์กล้องและตรวจสอบว่าไม่มีโปรแกรมอื่นใช้งานอยู่'); }} className="max-h-[min(35rem,64dvh)] w-full object-contain" />
    <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[55%] w-[62%] -translate-x-1/2 -translate-y-[56%] rounded-[48%] border-4 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.18)]" />
    <div className="absolute bottom-5 left-4 right-4 z-10 rounded-2xl bg-white/95 p-4 text-gray-900 shadow-xl backdrop-blur"><div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="ความคืบหน้าการตรวจสอบ"><div className="h-full rounded-full bg-green-600 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(6, progress * 100)}%` }} /></div><div className="flex items-center justify-center gap-3 text-center">{progress >= 1 ? <ShieldCheck className="shrink-0 text-green-700" /> : progress > 0 ? <ScanFace className="shrink-0 text-green-700" /> : <Camera className="shrink-0 text-green-700" />}<span role="status" aria-live="polite" className="font-bold">{instruction}</span></div><p className="mt-2 text-center text-xs text-gray-500">ระบบตรวจภาพต่อเนื่องและอาจให้ทำคำสั่งง่าย ๆ 1 ครั้งเพื่อป้องกันการเปิดวิดีโอแทนบุคคลจริง</p></div>
  </div>;
}
