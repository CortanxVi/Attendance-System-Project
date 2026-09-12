import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Camera, CheckCircle, ImageUp, Loader2, RotateCw, ShieldCheck } from 'lucide-react';
import LivenessScanner, { type LivenessCapture } from './LivenessScanner';
import { base64ToFile, prepareStudentCardImage } from '../../utils/imageUtils';
import { faceService, type EnrollmentLivenessChallenge } from '../../services/api';
import {
  getFaceLandmarkerRuntimeSnapshot,
  preloadFaceLandmarker,
  retryFaceLandmarkerPreload,
  subscribeFaceLandmarkerRuntime,
} from '../../services/faceLandmarkerRuntime';
import { useNotification } from '../../components/notifications/notificationContext';

type RegistrationPhase = 'card' | 'challenge' | 'liveness' | 'saving' | 'retry';

export default function StudentRegister() {
  const { notify } = useNotification();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<RegistrationPhase>('card');
  const [studentId, setStudentId] = useState('');
  const [challenge, setChallenge] = useState<EnrollmentLivenessChallenge | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [faceRuntime, setFaceRuntime] = useState(getFaceLandmarkerRuntimeSnapshot);
  const [verifiedCard, setVerifiedCard] = useState<File | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeFaceLandmarkerRuntime(setFaceRuntime);
    void preloadFaceLandmarker().catch(() => undefined);
    return unsubscribe;
  }, []);

  const requestLivenessChallenge = async (card: File | null = verifiedCard) => {
    if (!card) {
      setErrorMsg('ไม่พบภาพบัตรที่ผ่านการตรวจ กรุณาอัปโหลดบัตรใหม่');
      setPhase('card');
      return;
    }
    setPhase('challenge');
    setErrorMsg('');
    try {
      const nextChallenge = await faceService.createEnrollmentLivenessChallenge(card);
      if (nextChallenge.liveness_protocol_version !== 3 || nextChallenge.liveness_mode !== 'passive' || nextChallenge.liveness_sample_count !== 3) {
        throw new Error('Backend ยังไม่รองรับ Passive Liveness รุ่นปัจจุบัน กรุณาอัปเดต Backend');
      }
      setStudentId(nextChallenge.student_id);
      setChallenge(nextChallenge);
      setPhase('liveness');
    } catch (error) {
      setChallenge(null);
      setErrorMsg(error instanceof Error ? error.message : 'เตรียม Liveness ไม่สำเร็จ');
      setPhase('retry');
    }
  };

  const handleIdCardUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setErrorMsg('');
    setOcrLoading(true);
    try {
      const preparedCard = await prepareStudentCardImage(file);
      setVerifiedCard(preparedCard.file);
      await requestLivenessChallenge(preparedCard.file);
    } catch (error: unknown) {
      setVerifiedCard(null);
      setErrorMsg(error instanceof Error ? error.message : 'อ่านบัตรนักศึกษาไม่สำเร็จ');
      setPhase('card');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleLivenessCapture = async (capture: LivenessCapture) => {
    if (!challenge || !studentId) return;
    setPhase('saving');
    setErrorMsg('');
    try {
      const result = await faceService.registerFaceWithLiveness(
        studentId,
        challenge.challenge_id,
        challenge.liveness_token,
        {
          passiveImages: capture.passiveImageSrcs.map((image, index) => base64ToFile(image, `enrollment_passive_${index + 1}.jpg`)) as [File, File, File],
          evidence: capture.evidence,
        },
      );
      notify(result.message || 'ลงทะเบียนใบหน้าสำเร็จ', 'success');
      navigate('/student/profile', { replace: true });
    } catch (error) {
      setChallenge(null);
      setErrorMsg(error instanceof Error ? error.message : 'ลงทะเบียนใบหน้าไม่สำเร็จ');
      setPhase('retry');
    }
  };

  const runtimeReady = faceRuntime.status === 'ready';

  return (
    <main className="mx-3 my-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm min-[390px]:mx-4 min-[390px]:p-5">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-gray-800">ลงทะเบียนใบหน้า</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500">ยืนยันบัตรนักศึกษา แล้วสแกนใบหน้าแบบ Passive ก่อนบันทึก</p>
      </header>

      {errorMsg && (
        <div id="registration-error" role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {phase === 'card' && (
        <section className="space-y-5">
          <div
            role={faceRuntime.status === 'error' ? 'alert' : 'status'}
            className={`flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
              runtimeReady
                ? 'border-green-200 bg-green-50 text-green-800'
                : faceRuntime.status === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}
          >
            {runtimeReady ? <ShieldCheck className="shrink-0" aria-hidden="true" /> : <Loader2 className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{runtimeReady ? 'โมเดลตรวจจับใบหน้าพร้อมใช้งาน' : faceRuntime.status === 'error' ? 'โหลดโมเดลตรวจจับใบหน้าไม่สำเร็จ' : 'กำลังเตรียมโมเดลตรวจจับใบหน้า...'}</p>
              <p className="mt-0.5 text-xs opacity-80">ระบบเตรียมโมเดลไว้ก่อนเริ่มกล้องและไม่ส่งวิดีโอทั้งชุดไปยังเซิร์ฟเวอร์</p>
            </div>
            {faceRuntime.status === 'error' && (
              <button type="button" onClick={() => void retryFaceLandmarkerPreload().catch(() => undefined)} className="min-h-11 rounded-lg border border-red-300 bg-white px-3 font-semibold hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
                ลองใหม่
              </button>
            )}
          </div>

          <div className="text-center">
            <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Camera size={32} aria-hidden="true" /></div>
            <h2 className="mt-4 text-lg font-bold text-gray-800">1. ถ่ายหรือเลือกภาพบัตรนักศึกษา</h2>
            <p id="registration-card-help" className="mt-1 text-sm text-gray-500">รองรับ JPEG/PNG ระบบจะตรวจว่ารหัสบนบัตรตรงกับบัญชี</p>
          </div>

          {ocrLoading ? <div role="status" className="flex min-h-28 items-center justify-center gap-3 rounded-xl border border-orange-200 bg-orange-50 text-sm font-semibold text-orange-800"><Loader2 className="animate-spin" />กำลังตรวจบัตรด้วย Light OCR...</div> : <div className="grid grid-cols-2 gap-3">
            <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-center text-sm font-bold text-orange-800 hover:bg-orange-100 focus-within:ring-2 focus-within:ring-orange-500"><Camera aria-hidden="true" /><span>ถ่ายรูปบัตร</span><input type="file" accept="image/jpeg,image/png" capture="environment" onChange={handleIdCardUpload} aria-describedby="registration-card-help registration-error" className="sr-only" /></label>
            <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white p-3 text-center text-sm font-bold text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-orange-500"><ImageUp aria-hidden="true" /><span>เลือกรูปจากเครื่อง</span><input type="file" accept="image/jpeg,image/png" onChange={handleIdCardUpload} aria-describedby="registration-card-help registration-error" className="sr-only" /></label>
          </div>}
        </section>
      )}

      {phase === 'liveness' && challenge && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <span className="flex items-center gap-2 font-semibold"><CheckCircle size={18} aria-hidden="true" />ยืนยันรหัส {studentId} แล้ว</span>
            <span className="text-xs">สิทธิ์ถึง {new Date(challenge.challenge_expires_at).toLocaleTimeString('th-TH')}</span>
          </div>
          <h2 className="text-center text-lg font-bold text-gray-800">2. สแกนใบหน้าแบบ Passive</h2>
          <LivenessScanner onCaptureSuccess={(capture) => void handleLivenessCapture(capture)} />
        </section>
      )}

      {(phase === 'challenge' || phase === 'saving') && (
        <section role="status" className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-6 text-center text-blue-900">
          <Loader2 className="mb-4 animate-spin motion-reduce:animate-none" size={42} aria-hidden="true" />
          <p className="font-bold">{phase === 'saving' ? 'กำลังตรวจหลักฐานและบันทึกใบหน้า...' : 'กำลังสร้างสิทธิ์สแกนใบหน้าแบบใช้ครั้งเดียว...'}</p>
          <p className="mt-2 text-sm text-blue-700">อย่าปิดหน้านี้จนกว่าระบบจะแสดงผล</p>
        </section>
      )}

      {phase === 'retry' && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center">
          <p className="font-semibold text-amber-900">รหัสนักศึกษา {studentId || 'ยังไม่พร้อม'} ผ่านการตรวจบัตรแล้ว</p>
          <p className="mt-2 text-sm text-amber-800">สร้างสิทธิ์ใหม่แล้วสแกนใบหน้าอีกครั้ง โดยไม่ต้องอัปโหลดบัตรซ้ำ</p>
          <button type="button" onClick={() => void requestLivenessChallenge()} disabled={!verifiedCard || !runtimeReady} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 font-bold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2">
            <RotateCw size={18} aria-hidden="true" />เริ่มสแกนใบหน้าใหม่
          </button>
        </section>
      )}
    </main>
  );
}
