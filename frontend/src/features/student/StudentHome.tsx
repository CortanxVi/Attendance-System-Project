import { useEffect, useState } from 'react';
import QRScanner, { type VerifiedSessionInfo } from './QRScanner'; 
import LivenessScanner, { type LivenessCapture } from './LivenessScanner';
import { faceService } from '../../services/api';
import { base64ToFile } from '../../utils/imageUtils';
// นำเข้า Icon เพิ่มเติมจาก lucide-react
import { CheckCircle, XCircle, Loader2, UserCheck, RotateCw, ShieldCheck, ScanFace } from 'lucide-react';
import { useNotification } from '../../components/notifications/notificationContext';
import type { PassiveLivenessEvidence } from '../../utils/liveness';
import {
  getFaceLandmarkerRuntimeSnapshot,
  preloadFaceLandmarker,
  retryFaceLandmarkerPreload,
  subscribeFaceLandmarkerRuntime,
} from '../../services/faceLandmarkerRuntime';

export default function StudentHome() {
  const { notify } = useNotification();
  const [faceRuntime, setFaceRuntime] = useState(getFaceLandmarkerRuntimeSnapshot);
  const [isScanning, setIsScanning] = useState(false);
  const [verifiedCourse, setVerifiedCourse] = useState<string | null>(null);
  // 🌟 [เพิ่มใหม่] เก็บ session_id ที่ผ่านการตรวจสอบ QR แล้วไว้ใช้ตอนส่งเช็คชื่อจริง (ต่อสายให้ครบใน Step ถัดไป)
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeExpiresAt, setChallengeExpiresAt] = useState<string | null>(null);
  const [challengeTtlSeconds, setChallengeTtlSeconds] = useState(0);
  const [livenessToken, setLivenessToken] = useState<string | null>(null);
  const [isLivenessActive, setIsLivenessActive] = useState(false);

  // สถานะเก็บรูปภาพ
  const [capturedFaceData, setCapturedFaceData] = useState<string | null>(null);
  const [capturedPassiveData, setCapturedPassiveData] = useState<[string, string, string] | null>(null);
  const [livenessEvidence, setLivenessEvidence] = useState<PassiveLivenessEvidence | null>(null);
  
  // สถานะการส่งข้อมูล
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [finalResult, setFinalResult] = useState<'success' | 'failed' | null>(null);
  const [resultMessage, setResultMessage] = useState<string>('');  // ข้อความจากหลังบ้าน
  const [resultStudentId, setResultStudentId] = useState<string>('');
  const [resultStudentName, setResultStudentName] = useState<string>(''); // รหัสนักศึกษาจากหลังบ้าน
  const [resultScore, setResultScore] = useState<number | null>(null); // คะแนนความเหมือน
  const [resultStatus, setResultStatus] = useState<string>(''); // 🌟 [เพิ่มใหม่] สถานะจริง present/late/absent
  const [resultCheckInTime, setResultCheckInTime] = useState<string>('');

  useEffect(() => {
    const unsubscribe = subscribeFaceLandmarkerRuntime(setFaceRuntime);
    void preloadFaceLandmarker().catch(() => {
      // The shared runtime publishes a recoverable error state for this page.
    });
    return unsubscribe;
  }, []);

  const handleVerifySuccess = (info: VerifiedSessionInfo) => {
    setIsScanning(false);
    setVerifiedCourse(info.courseName || info.courseCode);
    setChallengeId(info.challengeId);
    setChallengeExpiresAt(info.challengeExpiresAt);
    setChallengeTtlSeconds(info.challengeTtlSeconds);
    setLivenessToken(info.livenessToken);
  };

  const handleFaceCapture = (capture: LivenessCapture) => {
    setCapturedFaceData(capture.faceImageSrc);
    setCapturedPassiveData(capture.passiveImageSrcs);
    setLivenessEvidence(capture.evidence);
    setIsLivenessActive(false);
  };

  // ฟังก์ชันกดยืนยันเช็คชื่อ — ยิง API ไปที่ FastAPI Backend จริง
  const handleSubmitAttendance = async () => {
    if (
      !capturedFaceData
      || !capturedPassiveData
      || !challengeId
      || !livenessToken
      || !livenessEvidence
    ) return;
    setIsSubmitting(true);

    try {
      const passiveFiles = capturedPassiveData.map((image, index) => base64ToFile(image, `passive_liveness_${index + 1}.jpg`)) as [File, File, File];

      // 2. ส่งข้อมูลไปยัง FastAPI Backend (POST /api/v1/attendance/verify)
      const result = await faceService.verifyAttendance(
        passiveFiles,
        challengeId,
        livenessToken,
        livenessEvidence,
      );

      // 3. สำเร็จ — เก็บข้อมูลจากหลังบ้านเพื่อแสดงผล
      setResultMessage(result.message);
      setResultStudentId(result.student_id || '');
      setResultStudentName(result.student_name || '');
      setResultScore(result.score ?? null);
      setResultStatus(result.calculated_status || '');
      setResultCheckInTime(result.check_in_time || '');
      setFinalResult('success');
      notify(`${result.student_name || result.student_id || 'นักศึกษา'} เช็คชื่อสำเร็จด้วยการสแกนใบหน้า`, 'success');
      
    } catch (error: unknown) {
      console.error(error);
      setResultMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
      setFinalResult('failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full p-3 min-[375px]:p-4">
      <h1 className="mb-5 flex items-center gap-2 text-xl font-bold text-gray-800 min-[390px]:text-2xl">
        <UserCheck className="text-blue-600"/> เช็คชื่อนักศึกษา
      </h1>
      
      {finalResult === 'success' ? (
        /* หน้าจอสุดท้าย: สำเร็จ */
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center shadow-sm min-[390px]:p-8">
          <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />
          <h2 className="text-2xl font-bold text-green-700 mb-2">เช็คชื่อสำเร็จ!</h2>
          <p className="text-gray-600 mb-2">{resultMessage}</p>
          {capturedFaceData && <img src={capturedFaceData} alt="ภาพใบหน้าที่ใช้เช็คชื่อ" className="mx-auto mb-4 h-32 w-32 rounded-full border-4 border-green-400 object-cover" />}
          {resultStudentName && <p className="text-sm text-gray-500 font-bold">ชื่อ-สกุล: {resultStudentName}</p>}
          {resultStudentId && <p className="text-sm text-gray-500">รหัสนักศึกษา: {resultStudentId}</p>}
          {resultStatus && (
            <p className={`text-sm font-bold mt-1 ${resultStatus === 'present' ? 'text-green-600' : resultStatus === 'late' ? 'text-orange-600' : 'text-red-600'}`}>
              สถานะ: {resultStatus === 'present' ? 'มาเรียน' : resultStatus === 'late' ? 'มาสาย' : 'ขาดเรียน'}
            </p>
          )}
          {resultScore !== null && <p className="text-sm text-gray-500">คะแนนความเหมือน: {resultScore}</p>}
          {resultCheckInTime && <p className="mt-1 text-sm text-gray-500">เวลาเช็คชื่อ: {new Date(resultCheckInTime).toLocaleString('th-TH')}</p>}
        </div>
      ) : finalResult === 'failed' ? (
        /* หน้าจอสุดท้าย: ไม่สำเร็จ */
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center shadow-sm min-[390px]:p-8">
           <XCircle size={64} className="mx-auto text-red-500 mb-4" />
           <h2 className="text-2xl font-bold text-red-700 mb-2">เช็คชื่อไม่สำเร็จ</h2>
           <p className="text-gray-600 mb-4">{resultMessage}</p>
           <button onClick={() => { setFinalResult(null); setResultMessage(''); }} className="bg-red-600 text-white px-6 py-2 rounded-lg font-bold">ลองใหม่อีกครั้ง</button>
        </div>
      ) : capturedFaceData ? (
        /* ด่านที่ 3: ถ่ายหน้าเสร็จแล้ว กดยืนยัน */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
           <h2 className="text-xl font-bold text-gray-800 mb-4">ถ่ายภาพใบหน้าสำเร็จ!</h2>
           <img src={capturedFaceData} alt="Captured Face" className="w-32 h-32 rounded-full mx-auto object-cover border-4 border-green-500 mb-6" />
           
           <button 
             onClick={handleSubmitAttendance}
             disabled={isSubmitting}
             className={`w-full font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2
               ${isSubmitting ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
           >
             {isSubmitting ? <><Loader2 className="animate-spin" size={20} /> กำลังตรวจสอบข้อมูลด้วย AI...</> : 'ยืนยันการเข้าเรียน'}
           </button>
           <button 
             onClick={() => {
               setCapturedFaceData(null);
               setCapturedPassiveData(null);
               setLivenessEvidence(null);
             }}
             disabled={isSubmitting}
             className="w-full mt-3 text-sm text-gray-500 hover:text-gray-700 underline"
           >
             ถ่ายรูปใหม่
           </button>
        </div>
      ) : isLivenessActive ? (
        /* ด่านที่ 2: หน้าจอ Liveness Detection */
        <div className="relative">
           <button onClick={() => setIsLivenessActive(false)} className="absolute top-4 right-4 z-30 bg-white/80 p-2 rounded-full text-sm font-bold shadow-md">ยกเลิก</button>
           <LivenessScanner onCaptureSuccess={handleFaceCapture} />
        </div>
      ) : verifiedCourse ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <h2 className="text-xl font-bold text-green-700 mb-2">เข้าสู่ห้องเรียน {verifiedCourse} แล้ว</h2>
          <div className="mx-auto my-4 flex size-16 items-center justify-center rounded-full bg-white text-green-700 shadow-sm"><ScanFace size={32} /></div>
          <p className="mb-4 text-sm leading-6 text-gray-600">ขั้นตอนต่อไปสแกนใบหน้าเพียงอย่างเดียว ไม่ต้องถ่ายหรืออัปโหลดบัตรนักศึกษา</p>
          {challengeExpiresAt && (
            <p className="mb-3 text-xs text-gray-500">
              สิทธิ์จาก QR ใช้ลองสแกนซ้ำได้ {Math.round(challengeTtlSeconds / 60)} นาที ถึงเวลา{' '}
              {new Date(challengeExpiresAt).toLocaleTimeString('th-TH')} · แต่ละรอบไม่เกิน 20 วินาที
            </p>
          )}
          <button 
             onClick={() => setIsLivenessActive(true)}
             disabled={!livenessToken}
             className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg w-full transition-colors"
          >
            เริ่มสแกนใบหน้า
          </button>
        </div>
      ) : isScanning ? (
        /* หน้าจอเปิดกล้องสแกน QR */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-2 relative">
          <button onClick={() => setIsScanning(false)} className="absolute top-4 right-4 z-10 bg-white/80 hover:bg-white text-gray-800 p-2 rounded-full shadow-md text-sm font-bold">ยกเลิก</button>
          <QRScanner onVerifySuccess={handleVerifySuccess} />
        </div>
      ) : (
        /* หน้าจอเริ่มต้น */
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">เช็คชื่อเข้าเรียน (Live)</h2>
            <div
              role={faceRuntime.status === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              className={`mb-4 flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
                faceRuntime.status === 'ready'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : faceRuntime.status === 'error'
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-blue-200 bg-blue-50 text-blue-800'
              }`}
            >
              {faceRuntime.status === 'ready' ? (
                <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
              ) : faceRuntime.status === 'error' ? (
                <XCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              ) : (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {faceRuntime.status === 'ready'
                    ? 'ระบบตรวจจับใบหน้าพร้อมใช้งาน'
                    : faceRuntime.status === 'error'
                      ? 'เตรียมระบบตรวจจับใบหน้าไม่สำเร็จ'
                      : 'กำลังดาวน์โหลดและเตรียมโมเดลตรวจจับใบหน้า...'}
                </p>
                <p className="mt-0.5 text-xs opacity-80">
                  {faceRuntime.status === 'ready'
                    ? 'สามารถสแกน QR แล้วเริ่มตรวจใบหน้าได้ทันที'
                    : faceRuntime.status === 'error'
                      ? 'ตรวจสอบเครือข่าย แล้วกดลองใหม่ก่อนสแกน QR'
                      : 'ระบบจะเปิดปุ่มสแกน QR เมื่อโมเดลพร้อม'}
                </p>
              </div>
              {faceRuntime.status === 'error' && (
                <button
                  type="button"
                  onClick={() => { void retryFaceLandmarkerPreload().catch(() => undefined); }}
                  className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-red-300 bg-white px-3 font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                >
                  <RotateCw className="h-4 w-4" aria-hidden="true" />
                  ลองใหม่
                </button>
              )}
            </div>
            <button 
              onClick={() => setIsScanning(true)}
              disabled={faceRuntime.status !== 'ready'}
              className="w-full rounded-lg bg-blue-600 py-3 font-bold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
            >
              สแกน QR Code หน้าห้องเรียน
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
