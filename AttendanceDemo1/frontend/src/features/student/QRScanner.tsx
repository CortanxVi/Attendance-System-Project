import React, { useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { supabase } from '../../lib/supabaseClient';
import { CheckCircle, XCircle, Camera } from 'lucide-react';

export default function QRScanner({ onVerifySuccess }: { onVerifySuccess: (course: string) => void }) {
  const [status, setStatus] = useState<'scanning' | 'verifying' | 'success' | 'error'>('scanning');
  const [errorMessage, setErrorMessage] = useState('');

  const handleScan = async (result: any) => {
    if (!result || result.length === 0) return;
    
    // หยุดสแกนชั่วคราวและเปลี่ยนสถานะเป็นกำลังตรวจสอบ
    setStatus('verifying');
    
    try {
      // 1. ถอดรหัส JSON จาก QR Code
      const rawText = result[0].rawValue;
      const qrData = JSON.parse(rawText);
      
      if (!qrData.course || !qrData.token) {
        throw new Error("QR Code ไม่ถูกต้อง (ข้อมูลไม่ครบ)");
      }

      // 2. ตรวจสอบกับฐานข้อมูล Supabase
      const { data, error } = await supabase
        .from('active_sessions')
        .select('*')
        .eq('current_token', qrData.token)
        .eq('course_code', qrData.course)
        .single();

      if (error || !data) {
         throw new Error("QR Code หมดอายุหรือไม่ถูกต้อง กรุณาสแกนใหม่จากหน้าจออาจารย์");
      }

      // 3. ตรวจสอบเวลาหมดอายุ (เปรียบเทียบเวลากับเครื่อง)
      const isExpired = new Date() > new Date(data.expires_at);
      if (isExpired) {
         throw new Error("QR Code หมดอายุแล้ว (เกิน 15 วินาที) กรุณาสแกนใหม่");
      }

      // ผ่านทุกด่าน!
      setStatus('success');
      setTimeout(() => {
        onVerifySuccess(qrData.course);
      }, 1500); // ดีเลย์ให้เห็นเครื่องหมายถูก 1.5 วินาที แล้วค่อยเปลี่ยนหน้า

    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMessage(err.message || "เกิดข้อผิดพลาดในการสแกน");
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