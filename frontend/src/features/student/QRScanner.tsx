import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Scanner,
  type IDetectedBarcode,
  type IScannerError,
} from '@yudiel/react-qr-scanner';
import {
  ArrowLeft,
  CheckCircle,
  Loader2,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { apiErrorMessage } from '../../services/apiError';

export interface VerifiedSessionInfo {
  sessionId: string;
  courseCode: string;
  courseName: string;
  challengeId: string;
  challengeExpiresAt: string;
  challengeTtlSeconds: number;
  livenessToken: string;
  livenessMode: 'passive';
  livenessSampleCount: 3;
}

interface QRScannerProps {
  onVerifySuccess: (info: VerifiedSessionInfo) => void;
  onClose: () => void;
}

type ScannerStatus = 'scanning' | 'verifying' | 'success' | 'scan-error' | 'camera-error';

const CAMERA_ERROR_MESSAGE: Record<IScannerError['kind'], string> = {
  'permission-denied': 'ยังไม่ได้อนุญาตให้ใช้กล้อง กรุณาเปิดสิทธิ์กล้องของเว็บไซต์นี้แล้วลองใหม่',
  'no-camera': 'ไม่พบกล้องที่ใช้งานได้บนอุปกรณ์นี้',
  'in-use': 'กล้องกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปนั้นแล้วลองใหม่',
  'overconstrained': 'กล้องของอุปกรณ์ไม่รองรับการตั้งค่าที่ระบบต้องการ',
  'insecure-context': 'การสแกนกล้องต้องเปิดผ่าน HTTPS หรือ localhost เท่านั้น',
  unsupported: 'เบราว์เซอร์นี้ไม่รองรับการสแกน QR กรุณาใช้ Chrome หรือ Safari รุ่นล่าสุด',
  aborted: 'การเปิดกล้องถูกยกเลิก กรุณาลองใหม่',
  security: 'เบราว์เซอร์ปฏิเสธการเข้าถึงกล้อง กรุณาตรวจสอบสิทธิ์เว็บไซต์',
  'type-error': 'ไม่สามารถเริ่มกล้องด้วยการตั้งค่าปัจจุบันได้',
  unknown: 'เปิดกล้องไม่สำเร็จ กรุณาตรวจสอบสิทธิ์กล้องแล้วลองใหม่',
};

export default function QRScanner({ onVerifySuccess, onClose }: QRScannerProps) {
  const [status, setStatus] = useState<ScannerStatus>('scanning');
  const [errorMessage, setErrorMessage] = useState('');
  const [courseNamePreview, setCourseNamePreview] = useState('');
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const clearPendingWork = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        clearPendingWork();
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
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      clearPendingWork();
    };
  }, [clearPendingWork, onClose]);

  const resetScanner = () => {
    clearPendingWork();
    setErrorMessage('');
    setCourseNamePreview('');
    setStatus('scanning');
  };

  const retryCamera = () => {
    resetScanner();
    setCameraAttempt((attempt) => attempt + 1);
  };

  const handleCameraError = (error: IScannerError) => {
    setErrorMessage(CAMERA_ERROR_MESSAGE[error.kind] || CAMERA_ERROR_MESSAGE.unknown);
    setStatus('camera-error');
  };

  const handleScan = async (result: IDetectedBarcode[]) => {
    if (status !== 'scanning' || result.length === 0) return;
    setStatus('verifying');
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const decoded: unknown = JSON.parse(result[0].rawValue);
      if (typeof decoded !== 'object' || decoded === null) {
        throw new Error('QR Code ไม่ถูกต้อง กรุณาสแกน QR ที่อาจารย์แสดงอยู่');
      }
      const qrData = decoded as Record<string, unknown>;
      if (typeof qrData.session_id !== 'string' || typeof qrData.token !== 'string') {
        throw new Error('QR Code นี้ไม่ใช่ QR สำหรับเช็คชื่อ');
      }

      const sessionId = qrData.session_id;
      const res = await axios.post(
        `/api/v1/sessions/${sessionId}/validate`,
        { token: qrData.token },
        { signal: controller.signal },
      );

      const {
        course_code,
        course_name,
        challenge_id,
        challenge_expires_at,
        challenge_ttl_seconds,
        liveness_protocol_version,
        liveness_token,
        liveness_mode,
        liveness_sample_count,
      } = res.data;
      if (
        typeof challenge_id !== 'string'
        || typeof challenge_expires_at !== 'string'
        || !Number.isInteger(challenge_ttl_seconds)
        || challenge_ttl_seconds < 60
        || challenge_ttl_seconds > 600
        || liveness_protocol_version !== 3
        || typeof liveness_token !== 'string'
        || liveness_mode !== 'passive'
        || liveness_sample_count !== 3
      ) {
        throw new Error('Backend ส่งข้อมูลสิทธิ์สแกนใบหน้าไม่ครบ กรุณาแจ้งผู้ดูแลระบบ');
      }

      requestControllerRef.current = null;
      setCourseNamePreview(course_code || course_name || 'รายวิชานี้');
      setStatus('success');
      timerRef.current = window.setTimeout(() => {
        onVerifySuccess({
          sessionId,
          courseCode: course_code || '',
          courseName: course_name || '',
          challengeId: challenge_id,
          challengeExpiresAt: challenge_expires_at,
          challengeTtlSeconds: challenge_ttl_seconds,
          livenessToken: liveness_token,
          livenessMode: liveness_mode,
          livenessSampleCount: liveness_sample_count,
        });
      }, 900);
    } catch (error: unknown) {
      if (axios.isCancel(error)) return;
      requestControllerRef.current = null;
      setErrorMessage(apiErrorMessage(error, 'ตรวจสอบ QR ไม่สำเร็จ กรุณาลองใหม่'));
      setStatus('scan-error');
    }
  };

  const scannerPaused = status !== 'scanning';

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-title"
      aria-describedby="qr-scanner-instruction"
      className="fixed inset-0 isolate overflow-hidden bg-slate-950 text-white"
      style={{ zIndex: 'var(--z-dialog)' }}
    >
      <p id="qr-scanner-instruction" className="sr-only">
        วาง QR Code ที่อาจารย์แสดงให้อยู่ภายในกรอบ ระบบจะอ่านและตรวจสอบให้อัตโนมัติ
      </p>
      <div className="absolute inset-0 bg-slate-950">
        <Scanner
          key={cameraAttempt}
          onScan={handleScan}
          onError={handleCameraError}
          constraints={{ facingMode: { ideal: 'environment' } }}
          formats={['qr_code']}
          paused={scannerPaused}
          allowMultiple={false}
          components={{ finder: false, torch: true, zoom: false, onOff: false }}
          styles={{
            container: { position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#020617' },
            video: { width: '100%', height: '100%', objectFit: 'cover' },
          }}
        />
      </div>

      <header className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-3 pb-12 pt-[max(0.75rem,env(safe-area-inset-top))] min-[375px]:px-4">
        <button
          ref={closeButtonRef}
          type="button"
          onClick={() => { clearPendingWork(); onClose(); }}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          aria-label="ปิดกล้องและกลับหน้าหลัก"
        >
          <ArrowLeft aria-hidden="true" size={22} />
        </button>
        <div className="min-w-0">
          <h2 id="qr-scanner-title" className="truncate text-base font-bold min-[375px]:text-lg">สแกน QR หน้าห้องเรียน</h2>
          <p className="truncate text-xs text-white/75">ใช้กล้องหลังเล็งไปยัง QR ของอาจารย์</p>
        </div>
      </header>

      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center pb-[12dvh]">
        <div className="relative aspect-square w-[min(76vw,44dvh,21rem)] rounded-[1.75rem] border border-white/35 shadow-[0_0_0_999px_rgba(2,6,23,0.48)]">
          <span className="absolute -left-1 -top-1 size-14 rounded-tl-[1.75rem] border-l-4 border-t-4 border-orange-400" />
          <span className="absolute -right-1 -top-1 size-14 rounded-tr-[1.75rem] border-r-4 border-t-4 border-orange-400" />
          <span className="absolute -bottom-1 -left-1 size-14 rounded-bl-[1.75rem] border-b-4 border-l-4 border-orange-400" />
          <span className="absolute -bottom-1 -right-1 size-14 rounded-br-[1.75rem] border-b-4 border-r-4 border-orange-400" />
          {status === 'scanning' && <span className="qr-scan-line absolute left-5 right-5 h-0.5 rounded-full bg-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.95)]" />}
        </div>
      </div>

      {(status === 'verifying' || status === 'success' || status === 'scan-error' || status === 'camera-error') && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/72 px-4 backdrop-blur-sm">
          <section
            role={status === 'scan-error' || status === 'camera-error' ? 'alert' : 'status'}
            aria-live="polite"
            className="w-full max-w-sm rounded-3xl border border-white/15 bg-slate-900/95 p-6 text-center shadow-2xl"
          >
            {status === 'verifying' && (
              <>
                <Loader2 className="mx-auto animate-spin text-orange-400 motion-reduce:animate-none" size={52} aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">กำลังตรวจสอบ QR</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">ระบบกำลังตรวจว่าเซสชันยังเปิดและ QR เป็นรหัสล่าสุด</p>
              </>
            )}
            {status === 'success' && (
              <>
                <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500 text-white"><CheckCircle size={38} aria-hidden="true" /></span>
                <h3 className="mt-4 text-xl font-bold text-emerald-300">พบห้องเรียนแล้ว</h3>
                <p className="mt-2 font-semibold">{courseNamePreview}</p>
                <p className="mt-2 text-sm text-slate-300">กำลังไปขั้นตอนสแกนใบหน้า…</p>
              </>
            )}
            {(status === 'scan-error' || status === 'camera-error') && (
              <>
                <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-500/15 text-red-300"><XCircle size={38} aria-hidden="true" /></span>
                <h3 className="mt-4 text-xl font-bold">{status === 'camera-error' ? 'ไม่สามารถเปิดกล้องได้' : 'QR นี้ใช้งานไม่ได้'}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{errorMessage}</p>
                <div className="mt-5 flex flex-col gap-2 min-[360px]:flex-row">
                  <button type="button" onClick={status === 'camera-error' ? retryCamera : resetScanner} className="inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 font-bold text-white hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                    <RotateCcw size={18} aria-hidden="true" />ลองอีกครั้ง
                  </button>
                  <button type="button" onClick={() => { clearPendingWork(); onClose(); }} className="min-h-12 flex-1 cursor-pointer rounded-xl border border-white/20 px-4 font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                    กลับหน้าหลัก
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {status === 'scanning' && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/65 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-16 text-center">
          <div className="mx-auto max-w-sm rounded-2xl border border-white/15 bg-black/45 px-4 py-3 backdrop-blur">
            <p className="flex items-center justify-center gap-2 font-bold">
              <ScanLine className="shrink-0 text-orange-400" aria-hidden="true" size={20} />
              วาง QR ให้อยู่ในกรอบ
            </p>
            <p className="mt-1 text-xs leading-5 text-white/75">ถือโทรศัพท์ให้นิ่ง ระบบจะอ่านและตรวจสอบให้อัตโนมัติ</p>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-emerald-300"><ShieldCheck size={14} aria-hidden="true" />QR ต้องมาจากเซสชันที่อาจารย์กำลังเปิด</p>
          </div>
        </div>
      )}
    </div>
  );
}
