import { useEffect, useState } from 'react';
import axios from 'axios';
import { supabase } from '../../lib/supabaseClient';
import { CalendarClock, BookOpen, AlertTriangle, CheckCircle2, Clock3, XCircle } from 'lucide-react';

// 🌟 Type ของข้อมูลที่ได้จาก backend (GET /api/v1/students/{uuid}/attendance-history)
interface CourseSummary {
  course_id: string;
  course_code: string;
  course_name: string;
  total_sessions: number;
  present: number;
  late: number;
  absent: number;
  absence_percentage: number;
  evaluation: 'Normal' | 'Fa';
}

interface HistoryItem {
  course_code: string;
  course_name: string;
  check_in_time: string;
  status: 'pending' | 'present' | 'late' | 'absent';
  method: 'face_ocr' | 'nfc' | 'manual' | null;
}

// 🌟 ป้ายสถานะ ใช้ซ้ำได้ทั้งใน summary card และ history list
function StatusBadge({ status }: { status: HistoryItem['status'] }) {
  const config = {
    present: { text: 'มาเรียน', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
    late: { text: 'มาสาย', color: 'bg-orange-100 text-orange-700', icon: Clock3 },
    absent: { text: 'ขาดเรียน', color: 'bg-red-100 text-red-700', icon: XCircle },
    pending: { text: 'รอตรวจสอบ', color: 'bg-gray-100 text-gray-600', icon: Clock3 },
  }[status];

  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${config.color}`}>
      <Icon size={12} /> {config.text}
    </span>
  );
}

const METHOD_LABEL: Record<string, string> = {
  face_ocr: 'สแกนใบหน้า',
  nfc: 'บัตร NFC',
  manual: 'อาจารย์แก้ไข',
};

export default function AttendanceHistory() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [courseSummary, setCourseSummary] = useState<CourseSummary[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setErrorMsg('ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่');
        return;
      }

      const res = await axios.get(`/api/v1/students/${session.user.id}/attendance-history`);
      setCourseSummary(res.data.course_summary || []);
      setHistory(res.data.history || []);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'ไม่สามารถโหลดประวัติการเข้าเรียนได้');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('th-TH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-500 mt-10">กำลังโหลดประวัติการเข้าเรียน...</div>
    );
  }

  if (errorMsg) {
    return (
      <div className="p-6 mt-6 mx-4 bg-red-50 border border-red-200 rounded-xl text-center text-red-600 text-sm">
        <AlertTriangle className="mx-auto mb-2" size={28} />
        {errorMsg}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-4">
      <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2 px-1">
        <CalendarClock className="text-blue-600" /> ประวัติการเข้าเรียนของฉัน
      </h1>

      {/* 🌟 สรุปสถิติรายวิชา */}
      <section className="space-y-3">
        {courseSummary.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm">
            ยังไม่มีรายวิชาที่ลงทะเบียนในระบบ
          </div>
        ) : (
          courseSummary.map((c) => (
            <div key={c.course_id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-bold text-gray-900 flex items-center gap-1.5">
                    <BookOpen size={16} className="text-blue-500" /> {c.course_code}
                  </p>
                  <p className="text-sm text-gray-500">{c.course_name}</p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    c.evaluation === 'Fa' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}
                >
                  {c.evaluation === 'Fa' ? 'ขาดเกินเกณฑ์' : 'ปกติ'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
                <div className="bg-green-50 rounded-lg py-2">
                  <p className="font-bold text-green-700 text-base">{c.present}</p>
                  <p className="text-green-600">มาเรียน</p>
                </div>
                <div className="bg-orange-50 rounded-lg py-2">
                  <p className="font-bold text-orange-700 text-base">{c.late}</p>
                  <p className="text-orange-600">มาสาย</p>
                </div>
                <div className="bg-red-50 rounded-lg py-2">
                  <p className="font-bold text-red-700 text-base">{c.absent}</p>
                  <p className="text-red-600">ขาดเรียน</p>
                </div>
              </div>

              <p className="text-xs text-gray-500">
                ขาดเรียนไปแล้ว <b>{c.absence_percentage}%</b> จากทั้งหมด {c.total_sessions} ครั้ง
              </p>
            </div>
          ))
        )}
      </section>

      {/* 🌟 รายการประวัติเช็คชื่อทั้งหมด (เรียงล่าสุดก่อน) */}
      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2 px-1">
          รายการทั้งหมด
        </h2>
        {history.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm">
            ยังไม่มีประวัติการเช็คชื่อ
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((item, idx) => (
              <div
                key={idx}
                className="bg-white border border-gray-100 rounded-xl p-3 flex items-center justify-between shadow-sm"
              >
                <div>
                  <p className="font-semibold text-gray-800 text-sm">
                    {item.course_code} <span className="text-gray-400 font-normal">· {item.course_name}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDateTime(item.check_in_time)}
                    {item.method && ` · ${METHOD_LABEL[item.method] || item.method}`}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
