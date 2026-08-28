import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRScanner, { type VerifiedSessionInfo } from './QRScanner'; 
import LivenessScanner from './LivenessScanner';
import { faceService } from '../../services/api';
import {
  base64ToFile,
  compressImage,
  prepareStudentCardImage,
  STUDENT_CARD_IMAGE_RULES,
} from '../../utils/imageUtils';
// นำเข้า Icon เพิ่มเติมจาก lucide-react
import { UploadCloud, CheckCircle, XCircle, Loader2, UserCheck } from 'lucide-react';
import { useNotification } from '../../components/notifications/NotificationProvider';

export default function StudentHome() {
  const { notify } = useNotification();
  const navigate = useNavigate();
  const [isScanning, setIsScanning] = useState(false);
  const [verifiedCourse, setVerifiedCourse] = useState<string | null>(null);
  // 🌟 [เพิ่มใหม่] เก็บ session_id ที่ผ่านการตรวจสอบ QR แล้วไว้ใช้ตอนส่งเช็คชื่อจริง (ต่อสายให้ครบใน Step ถัดไป)
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeExpiresAt, setChallengeExpiresAt] = useState<string | null>(null);
  const [isLivenessActive, setIsLivenessActive] = useState(false);
  const [idCardImage, setIdCardImage] = useState<File | null>(null);
  const [idCardPreview, setIdCardPreview] = useState<string | null>(null);
  const [cardError, setCardError] = useState('');
  const [isPreparingCard, setIsPreparingCard] = useState(false);
  const [preparedCardSize, setPreparedCardSize] = useState<{ width: number; height: number; bytes: number } | null>(null);
  const cardSelectionId = useRef(0);

  // สถานะเก็บรูปภาพ
  const [capturedFaceData, setCapturedFaceData] = useState<string | null>(null);
  
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

  const handleVerifySuccess = (info: VerifiedSessionInfo) => {
    setIsScanning(false);
    setVerifiedCourse(info.courseName || info.courseCode);
    setChallengeId(info.challengeId);
    setChallengeExpiresAt(info.challengeExpiresAt);
  };

  const handleFaceCapture = (imageSrc: string) => {
    setCapturedFaceData(imageSrc);
    setIsLivenessActive(false);
  };

  // ฟังก์ชันกดยืนยันเช็คชื่อ — ยิง API ไปที่ FastAPI Backend จริง
  const handleSubmitAttendance = async () => {
    if (!capturedFaceData || !idCardImage || !challengeId) return;
    setIsSubmitting(true);

    try {
      // 1. แปลง Base64 ของภาพใบหน้าจาก Liveness เป็น File object และบีบอัด
      const faceFile = base64ToFile(capturedFaceData, 'liveness_face.jpg');
      const compressedFace = await compressImage(faceFile, 600, 0.7);

      // 2. ส่งข้อมูลไปยัง FastAPI Backend (POST /api/v1/attendance/verify)
      const result = await faceService.verifyAttendance(compressedFace, idCardImage, challengeId);

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
    <div className="p-6 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <UserCheck className="text-blue-600"/> เช็คชื่อนักศึกษา
      </h1>
      
      {finalResult === 'success' ? (
        /* หน้าจอสุดท้าย: สำเร็จ */
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center shadow-sm">
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
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center shadow-sm">
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
             onClick={() => setCapturedFaceData(null)}
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
            <p className="mb-3 text-xs text-gray-500">สิทธิ์จาก QR ใช้ได้ถึง {new Date(challengeExpiresAt).toLocaleTimeString('th-TH')}</p>
          )}
          <button 
             onClick={() => setIsLivenessActive(true)}
             disabled={!idCardImage || isPreparingCard}
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
            <button 
              onClick={() => setIsScanning(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors"
            >
              สแกน QR Code หน้าห้องเรียน
            </button>
          </div>
          
          <div className="bg-orange-50 rounded-xl shadow-sm border border-orange-200 p-6">
            <h2 className="text-lg font-semibold text-orange-800 mb-4">ลงทะเบียนนักศึกษาใหม่</h2>
            <p className="text-sm text-orange-700 mb-4">ลงทะเบียนถ่ายรูปใบหน้าเพื่อใช้ในการเช็คชื่อ (ทำเพียงครั้งแรกครั้งเดียว)</p>
            <button 
              onClick={() => navigate('/student/register')}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-lg transition-colors"
            >
              ลงทะเบียนใบหน้า
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
