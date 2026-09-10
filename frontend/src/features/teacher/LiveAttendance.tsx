import { useCallback, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabaseClient';
import { Clock, Users, XCircle, AlertTriangle, CreditCard, ToggleLeft, ToggleRight } from 'lucide-react';
import { useNotification } from '../../components/notifications/notificationContext';
import { apiErrorMessage } from '../../services/apiError';

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
  const [refreshSeconds, setRefreshSeconds] = useState<number>(15);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [rotationAttempt, setRotationAttempt] = useState(0);
  
  const [attendanceCount, setAttendanceCount] = useState<number>(0);

  // --- NFC States ---
  const [isNfcEnabled, setIsNfcEnabled] = useState(false);
  const [scanUid, setScanUid] = useState('');
  const [nfcStatus, setNfcStatus] = useState({ text: '', type: '' });
  const rfidInputRef = useRef<HTMLInputElement>(null);

  // --- QR Token Logic ---
  const rotateToken = useCallback(async () => {
    try {
      const res = await axios.post(`/api/v1/sessions/${activeSessionId}/rotate-token`);
      setToken(res.data.qr_token);
      const nextRefresh = Number(res.data.qr_refresh_rate_seconds) || 15;
      setRefreshSeconds(nextRefresh);
      setCountdown(nextRefresh);
      setTokenError(null);
    } catch (err: unknown) {
      setTokenError(apiErrorMessage(err, 'ไม่สามารถหมุน QR Code ใหม่ได้ กรุณาลองใหม่'));
      setRotationAttempt((value) => value + 1);
    }
  }, [activeSessionId]);

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

    const initialTimer = window.setTimeout(() => { void fetchCount(); }, 0);
    
    // Polling as fallback since Supabase Realtime might not be enabled for attendance_records
    const interval = setInterval(fetchCount, 3000);

    return () => { window.clearTimeout(initialTimer); clearInterval(interval); };
  }, [activeSessionId]);

  // --- QR Timer ---
  useEffect(() => {
    const initialTimer = window.setTimeout(() => { void rotateToken(); }, 0);
    return () => window.clearTimeout(initialTimer);
  }, [rotateToken]);

  useEffect(() => {
    if (!token && !tokenError) return;
    const rotationTimer = window.setTimeout(() => { void rotateToken(); }, tokenError ? 5000 : refreshSeconds * 1000);
    const countdownTimer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => { window.clearTimeout(rotationTimer); window.clearInterval(countdownTimer); };
  }, [token, tokenError, refreshSeconds, rotateToken, rotationAttempt]);

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
    } catch (error: unknown) {
      setNfcStatus({ text: `❌ ${apiErrorMessage(error, 'ข้อผิดพลาด')}`, type: 'error' });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/95 p-2 sm:p-4">
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-y-auto rounded-2xl bg-white shadow-2xl animate-fade-in md:flex-row sm:max-h-[calc(100dvh-2rem)]">
        
        {/* ฝั่งซ้าย: แสดง QR Code */}
        <div className="flex flex-1 flex-col items-center justify-center border-b border-gray-100 bg-gray-50 p-4 sm:p-8 md:border-r md:border-b-0">
          <h2 className="mb-1 break-words text-center text-xl font-bold text-gray-800 sm:text-2xl">เช็คชื่อวิชา {courseName}</h2>
          <p className="mb-5 text-sm font-medium text-gray-500 sm:mb-8">รหัสวิชา: {courseCode}</p>
          
          <div className="relative mb-6 aspect-square w-full max-w-[250px] rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
             <QRCodeSVG value={qrData} size={250} level={"H"} className="h-auto w-full max-w-full" />
             <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl text-orange-500 shadow-md border border-gray-100">
                {countdown}
             </div>
          </div>
          
          <div className="flex items-center gap-2 text-sm font-medium text-orange-600 bg-orange-50 px-4 py-2 rounded-full border border-orange-200">
            <Clock size={16} />
            Dynamic QR เปลี่ยน token ทุก {refreshSeconds} วินาที
          </div>

          {tokenError && (
            <div className="flex items-center gap-2 text-sm font-medium text-red-600 bg-red-50 px-4 py-2 rounded-full border border-red-200 mt-3">
              <AlertTriangle size={16} />
              {tokenError}
            </div>
          )}
        </div>

        {/* ฝั่งขวา: แผงควบคุมยอดนักศึกษา & NFC */}
        <div className="flex w-full flex-col justify-between bg-white p-4 sm:p-6 md:min-w-72 md:basis-[36%]">
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
