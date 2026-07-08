import React, { useState } from 'react';
import axios from 'axios';
import { Scanner } from '@yudiel/react-qr-scanner';
import { CheckCircle, XCircle, Camera } from 'lucide-react';

// 🌟 ข้อมูลที่ต้องส่งกลับไปให้ StudentHome หลังสแกน QR ผ่าน (เปลี่ยนจากเดิมที่ส่งแค่ชื่อวิชาเป็น string เฉยๆ)
export interface VerifiedSessionInfo {
  sessionId: string;
  courseCode: string;
  courseName: string;
}

export default function QRScanner({ onVerifySuccess }: { onVerifySuccess: (info: VerifiedSessionInfo) => void }) {
  const [status, setStatus] = useState<'scanning' | 'verifying' | 'success' | 'error'>('scanning');
  const [errorMessage, setErrorMessage] = useState('');
  const [courseNamePreview, setCourseNamePreview] = useState('');

  const handleScan = async (result: any) => {
    if (!result || result.length === 0) return;
    
    // หยุดสแกนชั่วคราวและเปลี่ยนสถานะเป็นกำลังตรวจสอบ
    setStatus('verifying');
    
    try {
      // 1. ถอดรหัส JSON จาก QR Code
      // 🌟 [แก้ใหม่] QR ที่อาจารย์สร้าง (LiveAttendance.tsx) ฝัง { session_id, token } ไว้
      // ไม่ใช่ { course, token } แบบเดิมที่ไฟล์นี้เคยรออยู่ (เป็นบั๊กเดิมที่ทำให้ 2 ฝั่งคุยกันไม่รู้เรื่อง)
      const rawText = result[0].rawValue;
      const qrData = JSON.parse(rawText);
      
      if (!qrData.session_id || !qrData.token) {
        throw new Error("QR Code ไม่ถูกต้อง (ข้อมูลไม่ครบ)");
      }

      // 2. 🌟 [แก้ใหม่] ตรวจสอบกับ backend แทนการ query ตาราง active_sessions ที่ไม่มีอยู่จริงในระบบ
      // backend จะเช็คให้เองว่าเซสชันนี้ยังเปิดอยู่ไหม และ token ที่สแกนมาตรงกับตัวล่าสุดหรือไม่
      const res = await axios.get(`/api/v1/sessions/${qrData.session_id}/validate`, {
        params: { token: qrData.token },
      });

      const { course_code, course_name } = res.data;
      setCourseNamePreview(course_code || course_name || '');

      // ผ่านทุกด่าน!
      setStatus('success');
      setTimeout(() => {
        onVerifySuccess({
          sessionId: qrData.session_id,
          courseCode: course_code || '',
          courseName: course_name || '',
        });
      }, 1500); // ดีเลย์ให้เห็นเครื่องหมายถูก 1.5 วินาที แล้วค่อยเปลี่ยนหน้า

    } catch (err: any) {
      console.error(err);
      setStatus('error');
      // backend จะส่งข้อความ error ที่อ่านรู้เรื่องกลับมาใน err.response.data.detail อยู่แล้ว (เช่น "QR Code หมดอายุแล้ว")
      setErrorMessage(err.response?.data?.detail || err.message || "เกิดข้อผิดพลาดในการสแกน");
      // ให้โอกาสสแกนใหม่หลังจาก 3 วินาที
      setTimeout(() => setStatus('scanning'), 3000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 h-full min-h-[400px]">
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
          <p className="font-bold text-xl">ยืนยันตำแหน่งสำเร็จ!</p>
          {courseNamePreview && <p className="text-sm text-gray-500">{courseNamePreview}</p>}
          <p className="text-sm">กำลังเตรียมเปิดกล้องถ่ายรูป...</p>
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