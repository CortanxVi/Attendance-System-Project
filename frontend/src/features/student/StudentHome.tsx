import { useEffect, useRef, useState } from 'react';
import QRScanner, { type VerifiedSessionInfo } from './QRScanner'; 
import LivenessScanner, { type LivenessCapture } from './LivenessScanner';
import { faceService } from '../../services/api';
import {
  base64ToFile,
  prepareStudentCardImage,
  STUDENT_CARD_IMAGE_RULES,
} from '../../utils/imageUtils';
// นำเข้า Icon เพิ่มเติมจาก lucide-react
import { UploadCloud, CheckCircle, XCircle, Loader2, UserCheck, RotateCw, ShieldCheck } from 'lucide-react';
import { useNotification } from '../../components/notifications/notificationContext';
import type { LivenessAction, LivenessEvidence } from '../../utils/liveness';
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
  const [livenessActions, setLivenessActions] = useState<LivenessAction[]>([]);
  const [livenessRequiredBlinks, setLivenessRequiredBlinks] = useState(0);
  const [livenessPromptDelayMs, setLivenessPromptDelayMs] = useState(0);
  const [isLivenessActive, setIsLivenessActive] = useState(false);
  const [idCardImage, setIdCardImage] = useState<File | null>(null);
  const [idCardPreview, setIdCardPreview] = useState<string | null>(null);
  const [cardError, setCardError] = useState('');
  const [isPreparingCard, setIsPreparingCard] = useState(false);
  const [preparedCardSize, setPreparedCardSize] = useState<{ width: number; height: number; bytes: number } | null>(null);
  const cardSelectionId = useRef(0);

  // สถานะเก็บรูปภาพ
  const [capturedFaceData, setCapturedFaceData] = useState<string | null>(null);
  const [capturedBaselineData, setCapturedBaselineData] = useState<string | null>(null);
  const [capturedNearData, setCapturedNearData] = useState<string | null>(null);
  const [capturedReturnData, setCapturedReturnData] = useState<string | null>(null);
  const [capturedBlinkClosedData, setCapturedBlinkClosedData] = useState<string[]>([]);
  const [capturedBlinkOpenData, setCapturedBlinkOpenData] = useState<string[]>([]);
  const [livenessEvidence, setLivenessEvidence] = useState<LivenessEvidence | null>(null);
  
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
    return () => {
      if (idCardPreview) URL.revokeObjectURL(idCardPreview);
    };
  }, [idCardPreview]);

  useEffect(() => () => {
    cardSelectionId.current += 1;
  }, []);

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
    setLivenessActions(info.livenessActions);
    setLivenessRequiredBlinks(info.livenessRequiredBlinks);
    setLivenessPromptDelayMs(info.livenessPromptDelayMs);
  };

  const handleFaceCapture = (capture: LivenessCapture) => {
    setCapturedFaceData(capture.faceImageSrc);
    setCapturedBaselineData(capture.baselineImageSrc);
    setCapturedNearData(capture.nearImageSrc);
    setCapturedReturnData(capture.returnImageSrc);
    setCapturedBlinkClosedData(capture.blinkClosedImageSrcs);
    setCapturedBlinkOpenData(capture.blinkOpenImageSrcs);
    setLivenessEvidence(capture.evidence);
    setIsLivenessActive(false);
  };

  // ฟังก์ชันกดยืนยันเช็คชื่อ — ยิง API ไปที่ FastAPI Backend จริง
  const handleSubmitAttendance = async () => {
    if (
      !capturedFaceData
      || !capturedBaselineData
      || !capturedNearData
      || !capturedReturnData
      || capturedBlinkClosedData.length !== livenessRequiredBlinks
      || capturedBlinkOpenData.length !== livenessRequiredBlinks
      || !idCardImage
      || !challengeId
      || !livenessToken
      || !livenessEvidence
    ) return;
    setIsSubmitting(true);

    try {
      // ภาพจาก Liveness ถูกย่อและเข้ารหัสครั้งเดียวตอนจับเฟรม เพื่อรักษารายละเอียดดวงตา
      const faceFile = base64ToFile(capturedFaceData, 'liveness_face.jpg');
      const baselineFile = base64ToFile(capturedBaselineData, 'liveness_baseline.jpg');
      const nearFile = base64ToFile(capturedNearData, 'liveness_near.jpg');
      const returnFile = base64ToFile(capturedReturnData, 'liveness_return.jpg');
      const blinkClosedFiles = capturedBlinkClosedData.map((image, index) => (
        base64ToFile(image, `liveness_blink_closed_${index + 1}.jpg`)
      ));
      const blinkOpenFiles = capturedBlinkOpenData.map((image, index) => (
        base64ToFile(image, `liveness_blink_open_${index + 1}.jpg`)
      ));

      // 2. ส่งข้อมูลไปยัง FastAPI Backend (POST /api/v1/attendance/verify)
      const result = await faceService.verifyAttendance(
        faceFile,
        baselineFile,
        nearFile,
        returnFile,
        blinkClosedFiles,
        blinkOpenFiles,
        idCardImage,
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
      notify(`${result.student_name || result.student_id || 'นักศึกษา'} เช็คชื่อสำเร็จด้วยวิธีสแกนใบหน้าและบัตร`, 'success');
      
    } catch (error: unknown) {
      console.error(error);
      setResultMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
      setFinalResult('failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCardSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setCardError('');
    if (!file) return;

    const selectionId = ++cardSelectionId.current;
    setIsPreparingCard(true);
    try {
      const prepared = await prepareStudentCardImage(file);
      if (selectionId !== cardSelectionId.current) return;

      setIdCardImage(prepared.file);
      setIdCardPreview(URL.createObjectURL(prepared.file));
      setPreparedCardSize({
        width: prepared.width,
        height: prepared.height,
        bytes: prepared.file.size,
      });
    } catch (error) {
      if (selectionId !== cardSelectionId.current) return;
      setCardError(error instanceof Error ? error.message : 'ไม่สามารถเตรียมรูปบัตรได้');
    } finally {
      if (selectionId === cardSelectionId.current) setIsPreparingCard(false);
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
               setCapturedBaselineData(null);
               setCapturedNearData(null);
               setCapturedReturnData(null);
               setCapturedBlinkClosedData([]);
               setCapturedBlinkOpenData([]);
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
           <LivenessScanner
             actions={livenessActions}
             requiredBlinks={livenessRequiredBlinks}
             promptDelayMs={livenessPromptDelayMs}
             onCaptureSuccess={handleFaceCapture}
           />
        </div>
      ) : verifiedCourse ? (
        /* ผ่าน Dynamic QR แล้ว: ต้องมีทั้งภาพบัตรสำหรับ Light OCR และภาพใบหน้าสด */
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <h2 className="text-xl font-bold text-green-700 mb-2">เข้าสู่ห้องเรียน {verifiedCourse} แล้ว</h2>
          <p className="text-gray-600 mb-4">ถ่ายภาพบัตรนักศึกษาให้ชัด แล้วจึงสแกนใบหน้า</p>
          <label className={`mb-4 flex min-h-36 flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-green-300 bg-white p-4 focus-within:ring-2 focus-within:ring-green-600 ${isPreparingCard ? 'cursor-wait' : 'cursor-pointer'}`}>
            {isPreparingCard ? (
              <>
                <Loader2 className="mb-2 animate-spin text-green-600" size={28} />
                <span role="status" className="font-semibold text-green-800">กำลังปรับรูปให้พร้อมอ่านข้อมูล...</span>
                <span className="mt-1 text-xs text-gray-500">คงสัดส่วนและความคมชัดของตัวอักษร</span>
              </>
            ) : idCardPreview ? (
              <img src={idCardPreview} alt="ตัวอย่างภาพบัตรนักศึกษา" className="max-h-40 rounded-lg object-contain" />
            ) : (
              <>
                <UploadCloud className="mb-2 text-green-600" size={28} />
                <span className="font-semibold text-green-800">ถ่ายหรือเลือกภาพบัตรนักศึกษา</span>
              </>
            )}
            <span id="student-card-help" className="mt-1 text-xs text-gray-500">JPEG/PNG · ระบบย่ออัตโนมัติไม่เกิน {STUDENT_CARD_IMAGE_RULES.maxWidth}×{STUDENT_CARD_IMAGE_RULES.maxHeight} px</span>
            <input
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              onChange={handleCardSelected}
              disabled={isPreparingCard}
              aria-describedby="student-card-help student-card-error"
              aria-invalid={Boolean(cardError)}
              className="sr-only"
            />
          </label>
          {preparedCardSize && !isPreparingCard && (
            <p role="status" className="mb-3 text-xs text-green-700">
              รูปพร้อมใช้งาน {preparedCardSize.width}×{preparedCardSize.height} px · {(preparedCardSize.bytes / (1024 * 1024)).toFixed(2)} MB
            </p>
          )}
          <p id="student-card-error" role={cardError ? 'alert' : undefined} className={cardError ? 'mb-3 text-sm font-medium text-red-600' : 'sr-only'}>{cardError}</p>
          {challengeExpiresAt && (
            <p className="mb-3 text-xs text-gray-500">
              สิทธิ์จาก QR ใช้ลอง Liveness ซ้ำได้ {Math.round(challengeTtlSeconds / 60)} นาที ถึงเวลา{' '}
              {new Date(challengeExpiresAt).toLocaleTimeString('th-TH')} · แต่ละรอบไม่เกิน 45 วินาที
            </p>
          )}
          <button 
             onClick={() => setIsLivenessActive(true)}
             disabled={
               !idCardImage
               || isPreparingCard
               || !livenessToken
               || livenessActions[0] !== 'move_closer'
               || livenessActions[1] !== 'blink'
               || ![1, 2].includes(livenessRequiredBlinks)
               || livenessPromptDelayMs < 400
             }
             className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg w-full transition-colors"
          >
            เริ่มสแกนใบหน้า (Liveness)
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
