import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabaseClient';
import { Clock, Users, XCircle } from 'lucide-react';

export default function LiveAttendance({ courseCode = "CS301", onClose }: { courseCode?: string, onClose?: () => void }) {
  const [token, setToken] = useState<string>(''); 
  const [countdown, setCountdown] = useState<number>(60);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ฟังก์ชันสุ่มรหัส Token ใหม่
  const generateNewToken = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  };

  // ฟังก์ชันอัปเดต Token ลงฐานข้อมูล
  const updateSession = async (currentToken: string, id: string | null) => {
    const expiresAt = new Date(Date.now() + 60000).toISOString(); // หมดอายุใน 15 วินาที 15000, 60000 = 1 นาที
    
    if (id) {
      // อัปเดต Session เดิม
      await supabase
        .from('active_sessions')
        .update({ current_token: currentToken, expires_at: expiresAt })
        .eq('id', id);
    } else {
      // สร้าง Session ใหม่ตอนเปิดหน้าจอครั้งแรก
      const { data } = await supabase
        .from('active_sessions')
        .insert([{ course_code: courseCode, current_token: currentToken, expires_at: expiresAt }])
        .select()
        .single();
      if (data) setSessionId(data.id);
    }
  };

  useEffect(() => {
    let timer: number;
    
    // ทำงานครั้งแรกทันทีที่เปิดหน้า
    const initialToken = generateNewToken();
    setToken(initialToken);
    updateSession(initialToken, sessionId);

    // ตั้งรอบการทำงาน (Loop) ทุกๆ 1 วินาที
    timer = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // เมื่อครบ 15 วินาที -> สร้าง Token ใหม่
          const newToken = generateNewToken();
          setToken(newToken);
          // อัปเดตลง Database (ใช้ sessionId เดิมที่มีอยู่)
          setSessionId((currentId) => {
            updateSession(newToken, currentId);
            return currentId;
          });
          return 60; // รีเซ็ตเวลากลับไปที่ 15
        }
        return prev - 1; // นับถอยหลัง
      });
    }, 1000);

    // ทำความสะอาดเมื่ออาจารย์ปิดหน้านี้
    return () => {
      clearInterval(timer);
      if (sessionId) {
        // ลบ Session ทิ้งเมื่อเลิกเช็คชื่อ
        supabase.from('active_sessions').delete().eq('id', sessionId).then();
      }
    };
  }, []);

  // ข้อมูลที่จะฝังลงไปใน QR Code
  const qrData = JSON.stringify({
    course: courseCode,
    token: token
  });

  return (
    <div className="fixed inset-0 bg-slate-900/95 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row">
        
        {/* ฝั่งซ้าย: แสดง QR Code */}
        <div className="flex-1 p-8 flex flex-col items-center justify-center bg-gray-50 border-r border-gray-100">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">เช็คชื่อวิชา {courseCode}</h2>
          <p className="text-gray-500 mb-8">ให้นักศึกษาสแกนเพื่อยืนยันตำแหน่ง</p>
          
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 relative">
             <QRCodeSVG value={qrData} size={250} level={"H"} />
             {/* ตัวเลขเวลานับถอยหลังทับตรงกลาง */}
             <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl text-orange-500 shadow-md">
                {countdown}
             </div>
          </div>
          
          <div className="flex items-center gap-2 text-sm font-medium text-orange-600 bg-orange-100 px-4 py-2 rounded-full">
            <Clock size={16} />
            QR Code เปลี่ยนใหม่ทุก 15 วินาที
          </div>
        </div>

        {/* ฝั่งขวา: แผงควบคุม */}
        <div className="w-full md:w-64 p-6 bg-white flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Users size={18} /> สถานะปัจจุบัน
            </h3>
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
              <p className="text-sm text-gray-500">เข้าเรียนแล้ว</p>
              <p className="text-3xl font-bold text-green-600 mt-1">0 <span className="text-base font-normal text-gray-400">คน</span></p>
            </div>
          </div>
          
          <button 
            onClick={onClose}
            className="w-full mt-8 bg-red-50 hover:bg-red-100 text-red-600 font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            <XCircle size={18} />
            ปิดระบบเช็คชื่อ
          </button>
        </div>

      </div>
    </div>
  );
}