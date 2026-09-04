import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Scanner, type IDetectedBarcode } from '@yudiel/react-qr-scanner';
import { CheckCircle, XCircle, Camera } from 'lucide-react';
import { apiErrorMessage } from '../../services/apiError';
import type { LivenessAction } from '../../utils/liveness';

// 🌟 ข้อมูลที่ต้องส่งกลับไปให้ StudentHome หลังสแกน QR ผ่าน (เปลี่ยนจากเดิมที่ส่งแค่ชื่อวิชาเป็น string เฉยๆ)
export interface VerifiedSessionInfo {
  sessionId: string;
  courseCode: string;
  courseName: string;
  challengeId: string;
  challengeExpiresAt: string;
  livenessToken: string;
  livenessActions: LivenessAction[];
}

export default function QRScanner({ onVerifySuccess }: { onVerifySuccess: (info: VerifiedSessionInfo) => void }) {
  const [status, setStatus] = useState<'scanning' | 'verifying' | 'success' | 'error'>('scanning');
  const [errorMessage, setErrorMessage] = useState('');
  const [courseNamePreview, setCourseNamePreview] = useState('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const handleScan = async (result: IDetectedBarcode[]) => {
    if (status !== 'scanning' || result.length === 0) return;
    
    // หยุดสแกนชั่วคราวและเปลี่ยนสถานะเป็นกำลังตรวจสอบ
    setStatus('verifying');
    
    try {
      // 1. ถอดรหัส JSON จาก QR Code
      // 🌟 [แก้ใหม่] QR ที่อาจารย์สร้าง (LiveAttendance.tsx) ฝัง { session_id, token } ไว้
      // ไม่ใช่ { course, token } แบบเดิมที่ไฟล์นี้เคยรออยู่ (เป็นบั๊กเดิมที่ทำให้ 2 ฝั่งคุยกันไม่รู้เรื่อง)
      const rawText = result[0].rawValue;
      const decoded: unknown = JSON.parse(rawText);
      if (typeof decoded !== 'object' || decoded === null) {
        throw new Error("QR Code ไม่ถูกต้อง (ข้อมูลไม่ครบ)");
      }
      const qrData = decoded as Record<string, unknown>;
      if (typeof qrData.session_id !== 'string' || typeof qrData.token !== 'string') {
        throw new Error("QR Code ไม่ถูกต้อง (ข้อมูลไม่ครบ)");
      }
      const sessionId = qrData.session_id;
      const qrToken = qrData.token;

      // 2. 🌟 [แก้ใหม่] ตรวจสอบกับ backend แทนการ query ตาราง active_sessions ที่ไม่มีอยู่จริงในระบบ
      // backend จะเช็คให้เองว่าเซสชันนี้ยังเปิดอยู่ไหม และ token ที่สแกนมาตรงกับตัวล่าสุดหรือไม่
      const res = await axios.post(`/api/v1/sessions/${sessionId}/validate`, {
        token: qrToken,
      });

      const { course_code, course_name, challenge_id, challenge_expires_at, liveness_token, liveness_actions } = res.data;
      if (
        typeof challenge_id !== 'string'
        || typeof challenge_expires_at !== 'string'
        || typeof liveness_token !== 'string'
        || !Array.isArray(liveness_actions)
        || liveness_actions.length !== 2
        || liveness_actions.some((action) => !['blink', 'turn_left', 'turn_right'].includes(action))
      ) {
        throw new Error('ข้อมูล challenge สำหรับตรวจสอบใบหน้าไม่ครบ');
      }
      setCourseNamePreview(course_code || course_name || '');

      // ผ่านทุกด่าน!
      setStatus('success');
      timerRef.current = window.setTimeout(() => {
        onVerifySuccess({
          sessionId,
          courseCode: course_code || '',
          courseName: course_name || '',
          challengeId: challenge_id,
          challengeExpiresAt: challenge_expires_at,
          livenessToken: liveness_token,
          livenessActions: liveness_actions as LivenessAction[],
        });
      }, 1500); // ดีเลย์ให้เห็นเครื่องหมายถูก 1.5 วินาที แล้วค่อยเปลี่ยนหน้า

    } catch (err: unknown) {
      console.error(err);
      setStatus('error');
      // backend จะส่งข้อความ error ที่อ่านรู้เรื่องกลับมาใน err.response.data.detail อยู่แล้ว (เช่น "QR Code หมดอายุแล้ว")
      setErrorMessage(apiErrorMessage(err, "เกิดข้อผิดพลาดในการสแกน"));
      // ให้โอกาสสแกนใหม่หลังจาก 3 วินาที
      timerRef.current = window.setTimeout(() => setStatus('scanning'), 3000);
    }
  };

  return (
    <div className="flex h-full min-h-[clamp(18rem,55dvh,25rem)] flex-col items-center justify-center p-3 min-[375px]:p-4">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Camera /> สแกน QR Code เพื่อเตรียมการเช็คชื่อ
      </h2>

      {status === 'scanning' && (
        <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-lg border-4 border-blue-500">
           <Scanner 
             onScan={handleScan}
             formats={['qr_code']}
           />
        </div>
      )}

      {status === 'verifying' && (
        <div className="text-blue-600 animate-pulse font-semibold text-lg">
          กำลังตรวจสอบข้อมูล...
        </div>
      )}

      {status === 'success' && (
        <div className="flex flex-col items-center text-green-600">
          <CheckCircle size={64} className="mb-2" />
          <p className="font-bold text-xl">Dynamic QR ถูกต้อง</p>
          {courseNamePreview && <p className="text-sm text-gray-500">{courseNamePreview}</p>}
          <p className="text-sm">QR นี้ออกสิทธิ์เช็คชื่อแบบใช้ครั้งเดียวแล้ว</p>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center text-red-600 text-center">
          <XCircle size={64} className="mb-2" />
          <p className="font-bold text-xl mb-1">ไม่สำเร็จ</p>
          <p className="text-sm">{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
