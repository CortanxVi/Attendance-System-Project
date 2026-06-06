import React, { useState, useEffect, useRef } from 'react';
import { X, CreditCard, CheckCircle2, AlertCircle } from 'lucide-react';
import axios from 'axios';

interface NFCManagerProps {
  defaultCourseCode: string;
  activeSessionId: string;
  onClose: () => void;
}

export default function NFCManager({ defaultCourseCode, activeSessionId, onClose }: NFCManagerProps) {
  const [scanUid, setScanUid] = useState('');
  const [statusMessage, setStatusMessage] = useState({ text: '🔴 รอกล่องสแกนบัตร...', type: 'info' });
  const [latestCheckIns, setLatestCheckIns] = useState<any[]>([]); // เก็บประวัติคนสแกนล่าสุดแสดงบนจอ
  const rfidInputRef = useRef<HTMLInputElement>(null);

  // บังคับให้ Cursor โฟกัสที่ช่อง Input ตลอดเวลาเพื่อรอรับค่าจากเครื่องสแกน
  useEffect(() => {
    focusInput();
    const interval = setInterval(focusInput, 1000);
    return () => clearInterval(interval);
  }, []);

  const focusInput = () => {
    if (rfidInputRef.current) {
      rfidInputRef.current.focus();
    }
  };

  // ฟังก์ชันจังหวะที่เครื่องสแกนยิงรหัส UID เข้ามา (กด Enter อัตโนมัติ)
  const handleCardScanned = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUid = scanUid.trim();
    if (!currentUid) return;

    if (currentUid.length !== 10) {
      setStatusMessage({ text: '❌ รหัสบัตรไม่ถูกต้อง (ต้องมี 10 หลัก)', type: 'error' });
      setScanUid('');
      return;
    }

    try {
      setStatusMessage({ text: '⌛ กำลังตรวจสอบข้อมูลบัตร...', type: 'loading' });
      
      // 🌟 ยิง API ไปที่หลังบ้านเพื่อทำการเช็คชื่อด้วย NFC UID
      const response = await axios.post('/api/v1/attendance/checkin-nfc', {
        session_id: activeSessionId,
        nfc_uid: currentUid
      });

      if (response.data.status === 'success') {
        setStatusMessage({ 
          text: `✅ เช็คชื่อสำเร็จ: รหัสนักศึกษา ${response.data.student_id} (${response.data.calculated_status})`, 
          type: 'success' 
        });
        
        // เพิ่มรายชื่อนักศึกษาที่เพิ่งสแกนเข้าไปในรายการแสดงผลหน้าจอ
        setLatestCheckIns(prev => [response.data.student_info, ...prev].slice(0, 5));
      }
    } catch (error: any) {
      setStatusMessage({ 
        text: `❌ ${error.response?.data?.detail || 'เกิดข้อผิดพลาดในการเช็คชื่อ'}`, 
        type: 'error' 
      });
    } finally {
      setScanUid(''); // เคลียร์ช่องอินพุตเพื่อรอรับบัตรใบถัดไปทันที
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col max-h-[85vh]">
        
        {/* ส่วนหัว */}
        <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-gray-50">
          <div>
            <h3 className="text-xl font-bold text-gray-900">🎛️ โหมดเครื่องสแกนบัตร NFC</h3>
            <p className="text-sm text-gray-500 mt-0.5">วิชา: <span className="font-semibold text-blue-600">{defaultCourseCode}</span></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-200 rounded-xl transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* ส่วนเนื้อหาหลัก */}
        <div className="p-8 flex flex-col items-center flex-1 overflow-y-auto space-y-6">
          
          {/* แอนิเมชันไอคอนรอสแกน */}
          <div className={`p-6 rounded-full bg-blue-50 text-blue-600 animate-pulse`}>
            <CreditCard size={64} />
          </div>

          <div className="text-center">
            <h4 className="text-lg font-bold text-gray-800">กรุณานำบัตรนักศึกษาแตะที่เครื่องสแกน</h4>
            <p className="text-sm text-gray-400 mt-1">ระบบกำลังเปิดรับข้อมูลอย่างต่อเนื่อง...</p>
          </div>

          {/* ซ่อนช่องรับค่า Input นี้ไว้เบื้องหลัง (แต่โฟกัสไว้) เพื่อรับค่าจากเครื่องสแกนคีย์บอร์ดจำลอง */}
          <form onSubmit={handleCardScanned} className="opacity-0 absolute">
            <input
              ref={rfidInputRef}
              type="text"
              value={scanUid}
              onChange={(e) => setScanUid(e.target.value)}
              placeholder="NFC Waiting..."
              autoComplete="off"
            />
          </form>

          {/* กล่องข้อความแจ้งสถานะการแตะบัตรล่าสุด */}
          <div className={`w-full p-4 rounded-2xl text-center font-semibold text-sm transition-all border ${
            statusMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            statusMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
            statusMessage.type === 'loading' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
            'bg-slate-50 border-slate-200 text-slate-600'
          }`}>
            {statusMessage.text}
          </div>

          {/* สรุปรายชื่อผู้เข้าเรียนล่าสุด 5 คน (Real-time Feedback บนจอ) */}
          {latestCheckIns.length > 0 && (
            <div className="w-full pt-4 border-t border-gray-100">
              <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">ผู้ที่เพิ่งสแกนล่าสุด</h5>
              <div className="space-y-2">
                {latestCheckIns.map((student, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <span className="font-medium text-gray-800">{student.student_id}</span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 uppercase">
                      {student.status || 'Present'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}