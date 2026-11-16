import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabaseClient';
import { Users, XCircle, AlertTriangle, CreditCard, ToggleLeft, ToggleRight, Maximize2, Minimize2, PictureInPicture2 } from 'lucide-react';
import { useNotification } from '../../components/notifications/notificationContext';
import { apiErrorMessage } from '../../services/apiError';
import { usePresentationMode } from '../../components/presentation/usePresentationMode';
import { useTeacherAttendance } from '../../contexts/teacherAttendanceState';
import { buildQrPayload } from '../../hooks/useQrTokenRotation';

interface LiveAttendanceProps {
  courseCode?: string;
  courseName?: string;
  activeSessionId: string;
  onClose?: () => void;
}

export default function LiveAttendance({ courseCode = '', courseName = '', activeSessionId, onClose }: LiveAttendanceProps) {
  const { notify } = useNotification();
  const {
    containerRef: presentationRef,
    isActive: presentationActive,
    toggle: togglePresentation,
    exit: exitPresentation,
  } = usePresentationMode<HTMLDivElement>();
  // The QR token is rotated once by TeacherAttendanceProvider and shared with the floating window.
  const {
    qrToken: token,
    qrError: tokenError,
    autoCloseMinutes,
    pipSupported,
    pipOpen,
    openQrPip,
    closeQrPip,
  } = useTeacherAttendance();

  const [attendanceCount, setAttendanceCount] = useState<number>(0);

  // --- NFC States ---
  const [isNfcEnabled, setIsNfcEnabled] = useState(false);
  const [scanUid, setScanUid] = useState('');
  const [nfcStatus, setNfcStatus] = useState({ text: '', type: '' });
  const rfidInputRef = useRef<HTMLInputElement>(null);

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

  const qrData = buildQrPayload(activeSessionId, token);

  const closeWindow = async () => {
    await exitPresentation();
    onClose?.();
  };

  const togglePip = async () => {
    if (pipOpen) {
      closeQrPip();
      return;
    }
    const opened = await openQrPip();
    // Minimize this dialog so the page behind it is usable while the QR floats on top.
    if (opened) await closeWindow();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-slate-900/95 p-2 sm:p-4" style={{ zIndex: 'var(--z-backdrop)' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="live-attendance-title" className="flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-y-auto rounded-2xl bg-white shadow-2xl animate-fade-in md:flex-row sm:max-h-[calc(100dvh-2rem)]" style={{ zIndex: 'var(--z-dialog)' }}>
        
        {/* ฝั่งซ้าย: แสดง QR Code */}
        <div ref={presentationRef} className={`flex flex-1 flex-col items-center justify-center overflow-y-auto border-b border-gray-100 p-4 sm:p-8 md:border-r md:border-b-0 ${presentationActive ? 'fixed inset-0 bg-slate-950 text-white' : 'relative bg-gray-50'}`} style={presentationActive ? { zIndex: 'var(--z-presentation)' } : undefined}>
          <button type="button" onClick={() => void togglePresentation()} aria-label={presentationActive ? 'ออกจากโหมดเต็มหน้าจอ QR Code' : 'ขยาย QR Code เต็มหน้าจอ'} aria-pressed={presentationActive} className={`absolute right-3 top-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-orange-300 sm:right-5 sm:top-5 ${presentationActive ? 'bg-white/10 text-white hover:bg-white/20' : 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100'}`}>
            {presentationActive ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
            <span className="hidden sm:inline">{presentationActive ? 'ออกจากเต็มจอ' : 'เต็มหน้าจอ'}</span>
          </button>
          <h2 id="live-attendance-title" className={`mb-1 max-w-3xl break-words px-12 text-center font-bold ${presentationActive ? 'text-2xl text-white sm:text-4xl' : 'text-xl text-gray-800 sm:text-2xl'}`}>เช็คชื่อวิชา {courseName}</h2>
          <p className={`mb-5 text-sm font-medium sm:mb-8 ${presentationActive ? 'text-slate-300 sm:text-xl' : 'text-gray-500'}`}>รหัสวิชา: {courseCode}</p>
          
          <div className={`relative mb-6 aspect-square w-full rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4 ${presentationActive ? 'max-w-[min(64vmin,38rem)]' : 'max-w-[250px]'}`}>
             <QRCodeSVG value={qrData} size={250} level={"H"} className="h-auto w-full max-w-full" />
          </div>

          {!presentationActive && (
            <div className="flex max-w-sm flex-col items-center gap-2 text-center">
              <button
                type="button"
                onClick={() => void togglePip()}
                disabled={!pipSupported}
                aria-pressed={pipOpen}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PictureInPicture2 size={18} aria-hidden="true" />
                {pipOpen ? 'ปิดหน้าต่าง QR ลอย' : 'เปิด QR เป็นหน้าต่างลอย (PiP)'}
              </button>
              <p className="text-xs text-slate-500">
                {pipSupported
                  ? 'หน้าต่างลอยย้ายตำแหน่งได้ และอยู่เหนือโปรแกรมอื่น'
                  : 'เบราว์เซอร์นี้ไม่รองรับหน้าต่างลอย (ใช้ Chrome หรือ Edge บนคอมพิวเตอร์)'}
                {autoCloseMinutes !== null && ` ระบบจะปิดการเช็คชื่อและหน้าต่างลอยอัตโนมัติเมื่อครบ ${autoCloseMinutes} นาทีนับจากเปิดคาบ`}
              </p>
            </div>
          )}

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
            onClick={() => void closeWindow()}
            className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            <XCircle size={18} />
            ย่อหน้าต่าง (ระบบยังเปิดอยู่)
          </button>
        </div>

      </div>
    </div>
  );
}
