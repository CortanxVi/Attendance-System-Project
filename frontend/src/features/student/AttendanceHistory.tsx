import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { AlertTriangle, BookOpen, CalendarClock, CheckCircle2, ChevronRight, Clock3, Search, X, XCircle } from 'lucide-react';
import { apiErrorMessage } from '../../services/apiError';

interface CourseSummary {
  course_id: string; course_code: string; course_name: string; total_sessions: number;
  present: number; late: number; absent: number; absence_percentage: number; evaluation: 'Normal' | 'Fa';
}
interface HistoryItem {
  course_id: string | null; course_code: string; course_name: string; check_in_time: string;
  status: 'pending' | 'present' | 'late' | 'absent'; method: 'face_ocr' | 'nfc' | 'manual' | null;
}
const METHOD_LABEL: Record<string, string> = { face_ocr: 'สแกนใบหน้า', nfc: 'บัตร NFC', manual: 'อาจารย์แก้ไข' };

function StatusBadge({ status }: { status: HistoryItem['status'] }) {
  const config = {
    present: { text: 'มาเรียน', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
    late: { text: 'มาสาย', color: 'bg-orange-100 text-orange-700', icon: Clock3 },
    absent: { text: 'ขาดเรียน', color: 'bg-red-100 text-red-700', icon: XCircle },
    pending: { text: 'รอตรวจสอบ', color: 'bg-gray-100 text-gray-600', icon: Clock3 },
  }[status];
  const Icon = config.icon;
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${config.color}`}><Icon size={12} />{config.text}</span>;
}

export default function AttendanceHistory() {
  const { courseId } = useParams<{ courseId: string }>();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [courseSummary, setCourseSummary] = useState<CourseSummary[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState('');

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true); setErrorMsg(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) { setErrorMsg('ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่'); return; }
      const res = await axios.get(`/api/v1/students/${session.user.id}/attendance-history`);
      setCourseSummary(res.data.course_summary || []); setHistory(res.data.history || []);
    } catch (error: unknown) { setErrorMsg(apiErrorMessage(error, 'ไม่สามารถโหลดประวัติการเข้าเรียนได้')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void loadHistory(), 0); return () => window.clearTimeout(timer); }, [loadHistory]);
  const selectedCourse = courseId ? courseSummary.find((course) => course.course_id === courseId) : undefined;
  const selectedHistory = useMemo(() => history.filter((item) => item.course_id === courseId), [courseId, history]);
  const filteredCourses = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('th-TH');
    return normalized ? courseSummary.filter((course) => `${course.course_code} ${course.course_name}`.toLocaleLowerCase('th-TH').includes(normalized)) : courseSummary;
  }, [courseSummary, query]);
  const formatDateTime = (date: string) => new Date(date).toLocaleString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (loading) return <div role="status" className="mt-10 p-6 text-center text-gray-500">กำลังโหลดประวัติการเข้าเรียน...</div>;
  if (errorMsg) return <div role="alert" className="mx-4 mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600"><AlertTriangle className="mx-auto mb-2" size={28} />{errorMsg}</div>;

  if (courseId) {
    if (!selectedCourse) return <div role="alert" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">ไม่พบรายวิชานี้ในประวัติของคุณ</div>;
    return <div className="space-y-4 p-4 pb-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="font-mono text-xs font-bold text-orange-700">{selectedCourse.course_code}</p><h1 className="mt-1 text-xl font-bold text-slate-900">{selectedCourse.course_name}</h1>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><Stat value={selectedCourse.present} label="มาเรียน" tone="green" /><Stat value={selectedCourse.late} label="มาสาย" tone="orange" /><Stat value={selectedCourse.absent} label="ขาดเรียน" tone="red" /></div>
        <p className="mt-4 text-xs text-slate-500">ขาดเรียน {selectedCourse.absence_percentage}% จากแผนทั้งหมด {selectedCourse.total_sessions} ครั้ง</p>
      </section>
      <section aria-labelledby="course-history-title"><h2 id="course-history-title" className="mb-2 px-1 text-sm font-bold text-slate-600">รายการเข้าเรียน</h2>
        {selectedHistory.length ? <ul className="space-y-2">{selectedHistory.map((item, index) => <li key={`${item.check_in_time}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{formatDateTime(item.check_in_time)}</p><p className="mt-0.5 text-xs text-slate-500">{item.method ? METHOD_LABEL[item.method] || item.method : 'ไม่ระบุวิธี'}</p></div><StatusBadge status={item.status} /></li>)}</ul> : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">ยังไม่มีรายการเช็คชื่อในวิชานี้</div>}
      </section>
    </div>;
  }

  return <div className="space-y-5 p-4 pb-6">
    <div><h1 className="flex items-center gap-2 text-xl font-bold text-gray-800"><CalendarClock className="text-blue-600" />ประวัติการเข้าเรียน</h1><p className="mt-1 text-sm text-slate-500">เลือกรายวิชาเพื่อดูรายละเอียดการเข้าเรียนแต่ละครั้ง</p></div>
    <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><label htmlFor="student-history-search" className="sr-only">ค้นหารายวิชา</label><input id="student-history-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหารหัสหรือชื่อรายวิชา" className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-11 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" />{query && <button type="button" onClick={() => setQuery('')} aria-label="ล้างคำค้นหา" className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-300"><X size={17} /></button>}</div>
    {filteredCourses.length ? <ul className="space-y-3">{filteredCourses.map((course) => <li key={course.course_id}><Link to={`/student/history/${course.course_id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50/30 focus:outline-none focus:ring-2 focus:ring-orange-300"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><BookOpen size={20} /></span><div className="min-w-0 flex-1"><p className="font-mono text-xs font-bold text-orange-700">{course.course_code}</p><h2 className="mt-0.5 font-bold text-slate-900">{course.course_name}</h2><p className="mt-2 text-xs text-slate-500">มา {course.present} · สาย {course.late} · ขาด {course.absent}</p></div><ChevronRight className="mt-2 shrink-0 text-slate-400" size={20} /></div></Link></li>)}</ul> : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">{courseSummary.length ? 'ไม่พบรายวิชาที่ตรงกับคำค้นหา' : 'ยังไม่มีรายวิชาที่ลงทะเบียนในระบบ'}</div>}
  </div>;
}

function Stat({ value, label, tone }: { value: number; label: string; tone: 'green' | 'orange' | 'red' }) {
  const classes = tone === 'green' ? 'bg-green-50 text-green-700' : tone === 'orange' ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700';
  return <div className={`rounded-lg py-2 ${classes}`}><p className="text-base font-bold">{value}</p><p>{label}</p></div>;
}
