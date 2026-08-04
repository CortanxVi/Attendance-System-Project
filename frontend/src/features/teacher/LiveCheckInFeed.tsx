import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Users, CheckCircle2, Clock3, XCircle, ScanFace, CreditCard, Edit } from 'lucide-react';

// 🌟 ข้อมูล 1 แถวที่จะแสดงในรายการ (แบนราบแล้ว อ่านง่ายกว่าข้อมูลดิบที่ Join มาจาก Supabase)
interface CheckInItem {
  id: string;
  check_in_time: string;
  status: 'pending' | 'present' | 'late' | 'absent';
  method: 'face_ocr' | 'nfc' | 'manual' | null;
  student_id: string;
  full_name: string;
}

interface LiveCheckInFeedProps {
  sessionId: string;
  courseCode?: string;
}

// 🌟 ตั้งค่าสี/ข้อความ/ไอคอนของแต่ละสถานะไว้ที่เดียว เรียกใช้ซ้ำได้ง่าย แก้ทีเดียวเปลี่ยนทั้งหมด
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  present: { label: 'มาเรียน', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  late: { label: 'มาสาย', color: 'bg-orange-100 text-orange-700', icon: Clock3 },
  absent: { label: 'ขาดเรียน', color: 'bg-red-100 text-red-700', icon: XCircle },
  pending: { label: 'รอตรวจสอบ', color: 'bg-gray-100 text-gray-600', icon: Clock3 },
};

// 🌟 ตั้งค่าข้อความ/ไอคอนของแต่ละวิธีเช็คชื่อ
const METHOD_CONFIG: Record<string, { label: string; icon: any }> = {
  face_ocr: { label: 'สแกนใบหน้า', icon: ScanFace },
  nfc: { label: 'บัตร NFC', icon: CreditCard },
  manual: { label: 'อาจารย์แก้ไข', icon: Edit },
};

/**
 * 🌟 [เพิ่มใหม่] การ์ดแสดงจำนวน + รายชื่อนักศึกษาที่เช็คชื่อสำเร็จแล้วแบบเรียลไทม์
 * รวมทั้ง 2 ช่องทาง (สแกนใบหน้า+OCR และแตะบัตร NFC) ไว้ในที่เดียวกัน เพราะทั้งคู่บันทึกลงตาราง
 * attendance_records เดียวกัน ผูกกับ session_id เดียวกัน จึงไม่ต้องแยกดึงข้อมูลคนละที่
 */
export default function LiveCheckInFeed({ sessionId, courseCode }: LiveCheckInFeedProps) {
  const [checkIns, setCheckIns] = useState<CheckInItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ดึงรายชื่อทั้งหมดที่เช็คชื่อแล้วในคาบนี้ (join ตาราง profiles เอาชื่อ-สกุลมาด้วย)
  const fetchCheckInList = async () => {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('id, check_in_time, status, method, profiles(student_id, full_name)')
      .eq('session_id', sessionId)
      .order('check_in_time', { ascending: false });

    if (!error && data) {
      // ข้อมูลที่ Join มา profiles จะซ้อนเป็น object อยู่ข้างใน แปลงให้แบนราบใช้งานง่ายขึ้น
      const formatted: CheckInItem[] = data.map((row: any) => ({
        id: row.id,
        check_in_time: row.check_in_time,
        status: row.status,
        method: row.method,
        student_id: row.profiles?.student_id || '-',
        full_name: row.profiles?.full_name || 'ไม่ทราบชื่อ',
      }));
      setCheckIns(formatted);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCheckInList();

    // Polling as fallback since Supabase Realtime might not be enabled for attendance_records
    const interval = setInterval(fetchCheckInList, 3000);

    return () => clearInterval(interval);
  }, [sessionId]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mb-6 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Users size={18} className="text-emerald-600" />
          รายชื่อผู้เช็คชื่อแล้ว {courseCode && `· ${courseCode}`}
        </h3>
        <span className="bg-emerald-100 text-emerald-700 font-bold text-sm px-3 py-1 rounded-full">
          {checkIns.length} คน
        </span>
      </div>

      {isLoading ? (
        <p className="text-center text-gray-400 text-sm py-6">กำลังโหลด...</p>
      ) : checkIns.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-6">ยังไม่มีนักศึกษาเช็คชื่อในคาบนี้</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {checkIns.map((item) => {
            const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
            const methodCfg = item.method ? METHOD_CONFIG[item.method] : null;
            const StatusIcon = statusCfg.icon;
            const MethodIcon = methodCfg?.icon;

            return (
              <div
                key={item.id}
                className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100"
              >
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{item.full_name}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-2">
                    รหัส {item.student_id}
                    {methodCfg && MethodIcon && (
                      <span className="inline-flex items-center gap-1">
                        <MethodIcon size={12} /> {methodCfg.label}
                      </span>
                    )}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${statusCfg.color}`}>
                  <StatusIcon size={12} /> เช็คชื่อสำเร็จ · {statusCfg.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
