import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabaseClient';
import { Clock, Users, XCircle, AlertTriangle, CreditCard, ToggleLeft, ToggleRight } from 'lucide-react';
import { useNotification } from '../../components/notifications/NotificationProvider';

interface LiveAttendanceProps {
  courseCode?: string;
  courseName?: string;
  activeSessionId: string;
  onClose?: () => void;
}

export default function LiveAttendance({ courseCode = '', courseName = '', activeSessionId, onClose }: LiveAttendanceProps) {
  const { notify } = useNotification();
  const [token, setToken] = useState<string>(''); 
  const [countdown, setCountdown] = useState<number>(15);
  const [tokenError, setTokenError] = useState<string | null>(null);
  
  const [attendanceCount, setAttendanceCount] = useState<number>(0);

  // --- NFC States ---
  const [isNfcEnabled, setIsNfcEnabled] = useState(false);
  const [scanUid, setScanUid] = useState('');
  const [nfcStatus, setNfcStatus] = useState({ text: '', type: '' });
  const rfidInputRef = useRef<HTMLInputElement>(null);

  // --- QR Token Logic ---
  const rotateToken = async () => {
    try {
      const res = await axios.post(`/api/v1/sessions/${activeSessionId}/rotate-token`);
      setToken(res.data.qr_token);
      setCountdown(res.data.qr_refresh_rate_seconds || 15);
      setTokenError(null);
    } catch (err: any) {
      setTokenError(err.response?.data?.detail || 'ไม่สามารถหมุน QR Code ใหม่ได้ กรุณาลองใหม่');
    }
  };

  // --- Realtime DB Logic ---
  useEffect(() => {
    const fetchCount = async () => {
      const { count, error } = await supabase
        .from('attendance_records')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', activeSessionId);
      
      if (!error && count !== null) {
        setAttendanceCount(count);
      }
    };

    fetchCount();
    
    // Polling as fallback since Supabase Realtime might not be enabled for attendance_records
    const interval = setInterval(fetchCount, 3000);

    return () => clearInterval(interval);
  }, [activeSessionId]);

  // --- QR Timer ---
  useEffect(() => {
    let timer: number;
    rotateToken();

    timer = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          rotateToken(); 
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [activeSessionId]);

  // --- NFC Logic ---
  useEffect(() => {
    if (!isNfcEnabled) return;
    const focusInput = () => {
      if (rfidInputRef.current) rfidInputRef.current.focus();
    };
    focusInput();
    const interval = setInterval(focusInput, 1000);
    return () => clearInterval(interval);
  }, [isNfcEnabled]);

  const handleCardScanned = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUid = scanUid.trim();
    if (!currentUid) return;

    if (currentUid.length !== 10) {
      setNfcStatus({ text: '❌ รหัสบัตรไม่ถูกต้อง (ต้อง 10 หลัก)', type: 'error' });
      setScanUid('');
      return;
    }

    try {
      setNfcStatus({ text: '⌛ กำลังตรวจสอบ...', type: 'loading' });
      const response = await axios.post('/api/v1/nfc/checkin', {
        nfc_uid: currentUid,
        session_id: activeSessionId
      });

      if (response.data.status === 'success') {
        const info = response.data.student_info;
        setNfcStatus({ text: `✅ สำเร็จ: ${info.student_id}`, type: 'success' });
        notify(`${info.full_name || info.student_id} เช็คชื่อสำเร็จด้วยวิธีแตะบัตร NFC`, 'success');
      }
    } catch (error: any) {
      setNfcStatus({ text: `❌ ${error.response?.data?.detail || 'ข้อผิดพลาด'}`, type: 'error' });
    } finally {
      setScanUid('');
      setTimeout(() => setNfcStatus({ text: '', type: '' }), 3000);
    }
  };

  const qrData = JSON.stringify({
    session_id: activeSessionId, 
    token: token
  });

  return (
    <div className="fixed inset-0 bg-slate-900/95 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col md:flex-row animate-fade-in my-8">
        
        {/* ฝั่งซ้าย: แสดง QR Code */}
        <div className="flex-1 p-8 flex flex-col items-center justify-center bg-gray-50 border-r border-gray-100">
          <h2 className="text-2xl font-bold text-gray-800 mb-1 text-center">เช็คชื่อวิชา {courseName}</h2>
          <p className="text-gray-500 mb-8 text-sm font-medium">รหัสวิชา: {courseCode}</p>
          
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 relative">
             <QRCodeSVG value={qrData} size={250} level={"H"} />
             <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl text-orange-500 shadow-md border border-gray-100">
                {countdown}
             </div>
          </div>
          
          <div className="flex items-center gap-2 text-sm font-medium text-orange-600 bg-orange-50 px-4 py-2 rounded-full border border-orange-200">
            <Clock size={16} />
            Dynamic QR เปลี่ยน token ทุก 15 วินาที
          </div>

          {tokenError && (
            <div className="flex items-center gap-2 text-sm font-medium text-red-600 bg-red-50 px-4 py-2 rounded-full border border-red-200 mt-3">
              <AlertTriangle size={16} />
              {tokenError}
            </div>
          )}
        </div>

        {/* ฝั่งขวา: แผงควบคุมยอดนักศึกษา & NFC */}
        <div className="w-full md:w-80 p-6 bg-white flex flex-col justify-between">
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Users size={18} /> สถานะปัจจุบัน
              </h3>
              <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-100 text-center">
                <p className="text-sm text-emerald-700 font-medium">เข้าเรียนแล้ว</p>
                <p className="text-5xl font-black text-emerald-600 mt-2">
                  {attendanceCount} <span className="text-lg font-normal text-emerald-600/70">คน</span>
                </p>
              </div>
            </div>

            {/* ระบบ NFC */}
            <div className="pt-6 border-t border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                  <CreditCard size={18} className={isNfcEnabled ? 'text-blue-500' : 'text-gray-400'} /> 
                  ระบบแตะบัตร NFC
                </h3>
                <button 
                  onClick={() => setIsNfcEnabled(!isNfcEnabled)}
                  className={`flex items-center transition-colors ${isNfcEnabled ? 'text-blue-500' : 'text-gray-400'}`}
                >
                  {isNfcEnabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>
              
              {isNfcEnabled && (
                <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100 text-center animate-fade-in">
                  <div className="flex justify-center mb-2 animate-bounce">
                    <CreditCard size={24} className="text-blue-500" />
                  </div>
                  <p className="text-sm text-blue-700 font-medium">เครื่องอ่านบัตรพร้อมใช้งาน</p>
                  <p className="text-xs text-blue-500/70 mt-1">กรุณานำบัตรแตะที่เครื่อง</p>
                  
                  {nfcStatus.text && (
                    <div className={`mt-3 text-xs font-bold p-2 rounded-md ${
                      nfcStatus.type === 'success' ? 'bg-green-100 text-green-700' :
                      nfcStatus.type === 'error' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {nfcStatus.text}
                    </div>
                  )}

                  <form onSubmit={handleCardScanned} noValidate className="opacity-0 absolute w-0 h-0 overflow-hidden">
                    <input
                      ref={rfidInputRef}
                      type="text"
                      value={scanUid}
                      onChange={(e) => setScanUid(e.target.value)}
                      autoComplete="off"
                    />
                  </form>
                </div>
              )}
            </div>
          </div>
          
          <button 
            onClick={onClose}
            className="w-full mt-8 bg-red-50 hover:bg-red-100 text-red-600 font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <XCircle size={18} />
            ปิดหน้าต่างรับเช็คชื่อ
          </button>
        </div>

      </div>
    </div>
  );
}
