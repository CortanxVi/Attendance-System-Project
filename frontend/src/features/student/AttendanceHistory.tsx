import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { AlertTriangle, BookOpen, CalendarClock, ChevronRight, Search, X } from 'lucide-react';
import { apiErrorMessage } from '../../services/apiError';
import CourseHistoryDetail, { type CourseSummary, type HistoryItem } from './CourseHistoryDetail';

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

  if (loading) return <div role="status" className="mt-10 p-6 text-center text-gray-500">กำลังโหลดประวัติการเข้าเรียน...</div>;
  if (errorMsg) return <div role="alert" className="mx-4 mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600"><AlertTriangle className="mx-auto mb-2" size={28} />{errorMsg}</div>;

  if (courseId) {
    if (!selectedCourse) return <div role="alert" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">ไม่พบรายวิชานี้ในประวัติของคุณ</div>;
    return <CourseHistoryDetail course={selectedCourse} history={selectedHistory} />;
  }

  return <div className="student-page space-y-5">
    <div><h1 className="flex items-center gap-2 text-xl font-bold text-gray-800"><CalendarClock className="text-blue-600" />ประวัติการเข้าเรียน</h1><p className="mt-1 text-sm text-slate-500">เลือกรายวิชาเพื่อดูรายละเอียดการเข้าเรียนแต่ละครั้ง</p></div>
    <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><label htmlFor="student-history-search" className="sr-only">ค้นหารายวิชา</label><input id="student-history-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหารหัสหรือชื่อรายวิชา" className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-11 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" />{query && <button type="button" onClick={() => setQuery('')} aria-label="ล้างคำค้นหา" className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-300"><X size={17} /></button>}</div>
    {filteredCourses.length ? <ul className="space-y-3">{filteredCourses.map((course) => <li key={course.course_id}><Link to={`/student/history/${course.course_id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50/30 focus:outline-none focus:ring-2 focus:ring-orange-300"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><BookOpen size={20} /></span><div className="min-w-0 flex-1"><p className="font-mono text-xs font-bold text-orange-700">{course.course_code}</p><h2 className="mt-0.5 font-bold text-slate-900">{course.course_name}</h2><p className="mt-2 text-xs text-slate-500">มา {course.present} · สาย {course.late} · ขาด {course.absent}</p></div><ChevronRight className="mt-2 shrink-0 text-slate-400" size={20} /></div></Link></li>)}</ul> : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">{courseSummary.length ? 'ไม่พบรายวิชาที่ตรงกับคำค้นหา' : 'ยังไม่มีรายวิชาที่ลงทะเบียนในระบบ'}</div>}
  </div>;
}

