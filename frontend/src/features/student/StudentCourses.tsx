import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  GraduationCap,
  KeyRound,
  LoaderCircle,
  UserRound,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { useNotification } from '../../components/notifications/notificationContext';

interface Course {
  id: string;
  course_code: string;
  course_name: string;
  section: number;
  semester?: number | null;
  year?: number | null;
  teacher?: { full_name?: string | null } | null;
}

interface JoinRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_at: string;
  reviewed_at?: string | null;
  review_note?: string | null;
  course?: Course | null;
}

function detail(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
    ? error.response.data.detail
    : fallback;
}

function formatInput(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8);
  return normalized.length > 4 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
}

export default function StudentCourses() {
  const { notify } = useNotification();
  const [courses, setCourses] = useState<Course[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<JoinRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await axios.get('/api/v1/students/me/courses');
      setCourses(response.data.courses ?? []);
      setRequests(response.data.join_requests ?? []);
    } catch (loadError) {
      setError(detail(loadError, 'ไม่สามารถโหลดรายวิชาได้'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'จัดการรายวิชา — KMUTNB Attendance';
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setCodeError('');
    if (code.replace('-', '').length !== 8) {
      setCodeError('กรุณากรอกรหัสคลาสให้ครบ 8 ตัว');
      return;
    }
    setSubmitting(true);
    try {
      const response = await axios.post('/api/v1/students/me/courses/join', { code });
      notify(response.data.message || 'ส่งคำขอเข้าร่วมรายวิชาแล้ว', 'success');
      setCode('');
      await load();
    } catch (joinError) {
      setCodeError(detail(joinError, 'ไม่สามารถส่งคำขอเข้าร่วมได้'));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async () => {
    if (!cancelTarget) return;
    setSubmitting(true);
    try {
      await axios.delete(`/api/v1/students/me/courses/join-requests/${cancelTarget.id}`);
      notify('ยกเลิกคำขอเข้าร่วมแล้ว', 'success');
      setCancelTarget(null);
      await load();
    } catch (cancelError) {
      notify(detail(cancelError, 'ไม่สามารถยกเลิกคำขอได้'), 'error');
      setCancelTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="space-y-5 bg-slate-50 p-4 pb-8">
    <ConfirmDialog open={Boolean(cancelTarget)} title="ยกเลิกคำขอเข้าร่วมหรือไม่" description={`ยกเลิกคำขอเข้าร่วม ${cancelTarget?.course?.course_code || 'รายวิชานี้'} คุณสามารถกรอกรหัสเพื่อส่งคำขอใหม่ได้ภายหลัง`} confirmLabel="ยกเลิกคำขอ" danger busy={submitting} onConfirm={() => void cancelRequest()} onCancel={() => setCancelTarget(null)} />

    <header className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
      <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-orange-500"><GraduationCap size={24} /></span><div><p className="text-xs font-semibold text-orange-300">KMUTNB Attendance</p><h1 className="text-xl font-bold">จัดการรายวิชา</h1></div></div>
      <p className="mt-3 text-sm leading-6 text-slate-300">กรอกรหัสที่ได้รับจากอาจารย์และติดตามสถานะการเข้าร่วมรายวิชาของคุณ</p>
    </header>

    <section className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2"><KeyRound className="text-orange-600" /><h2 className="font-bold text-slate-900">เข้าร่วมด้วยรหัสคลาส</h2></div>
      <form noValidate onSubmit={submitCode} className="mt-4 space-y-3">
        <label htmlFor="student-join-code" className="block text-sm font-semibold text-slate-700">รหัสคลาส 8 ตัว</label>
        <input id="student-join-code" value={code} onChange={(event) => { setCode(formatInput(event.target.value)); setCodeError(''); }} autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text" placeholder="ABCD-2345" disabled={submitting} aria-invalid={Boolean(codeError)} aria-describedby={codeError ? 'student-join-code-error' : 'student-join-code-help'} className="min-h-14 w-full rounded-xl border border-slate-300 px-4 text-center font-mono text-2xl font-black tracking-[0.16em] uppercase focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:bg-slate-100" />
        {codeError ? <p id="student-join-code-error" role="alert" className="text-sm font-medium text-red-700">{codeError}</p> : <p id="student-join-code-help" className="text-xs leading-5 text-slate-500">การมีรหัสไม่ได้ยืนยันสิทธิ์โดยอัตโนมัติ อาจารย์จะตรวจและอนุมัติคำขออีกครั้ง</p>}
        <button type="submit" disabled={submitting || code.replace('-', '').length !== 8} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <LoaderCircle className="animate-spin" size={19} /> : <CheckCircle2 size={19} />}{submitting ? 'กำลังส่งคำขอ…' : 'ส่งคำขอเข้าร่วมรายวิชา'}</button>
      </form>
    </section>

    {loading ? <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" />กำลังโหลดรายวิชา…</div> : error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : <>
      <section aria-labelledby="enrolled-course-title" className="space-y-3"><div className="flex items-center justify-between"><h2 id="enrolled-course-title" className="font-bold text-slate-900">รายวิชาที่เข้าร่วมแล้ว</h2><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">{courses.length} วิชา</span></div>{courses.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center"><BookOpen className="mx-auto text-slate-400" /><p className="mt-3 text-sm font-semibold text-slate-700">ยังไม่มีรายวิชาที่เข้าร่วม</p><p className="mt-1 text-xs text-slate-500">กรอกรหัสคลาสด้านบน หรือรออาจารย์เพิ่มรายชื่อ</p></div> : <ul className="space-y-3">{courses.map((course) => <li key={course.id}><article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-xs font-bold text-orange-700">{course.course_code}</p><h3 className="mt-1 font-bold text-slate-900">{course.course_name}</h3></div><span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">เข้าร่วมแล้ว</span></div><dl className="mt-3 grid gap-2 text-xs text-slate-500"><div className="flex items-center gap-2"><UserRound size={15} /><dt className="sr-only">อาจารย์</dt><dd>{course.teacher?.full_name || 'ไม่ระบุอาจารย์'}</dd></div><div className="flex items-center gap-2"><CalendarDays size={15} /><dt className="sr-only">ภาคเรียน</dt><dd>Section {course.section} · ภาคเรียน {course.semester ?? '-'} / {course.year ?? '-'}</dd></div></dl><Link to="/student/history" className="mt-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-700 hover:text-orange-800 focus:outline-none focus:ring-2 focus:ring-orange-300">ดูประวัติการเข้าเรียน</Link></article></li>)}</ul>}</section>

      <section aria-labelledby="join-request-title" className="space-y-3"><h2 id="join-request-title" className="font-bold text-slate-900">คำขอเข้าร่วม</h2>{requests.length === 0 ? <p className="rounded-xl bg-white p-4 text-center text-sm text-slate-500">ยังไม่มีคำขอเข้าร่วม</p> : <ul className="space-y-3">{requests.map((item) => <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold text-slate-500">{item.course?.course_code || '-'}</p><p className="mt-1 font-semibold text-slate-900">{item.course?.course_name || 'รายวิชา'}</p><p className="mt-1 text-xs text-slate-500">ส่งเมื่อ {new Date(item.requested_at).toLocaleString('th-TH')}</p></div><RequestStatus status={item.status} /></div>{item.review_note && <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">หมายเหตุ: {item.review_note}</p>}{item.status === 'pending' && <button type="button" disabled={submitting} onClick={() => setCancelTarget(item)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-200 px-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"><XCircle size={17} />ยกเลิกคำขอ</button>}</li>)}</ul>}</section>
    </>}
  </div>;
}

function RequestStatus({ status }: { status: JoinRequest['status'] }) {
  const map = {
    pending: { text: 'รออนุมัติ', className: 'bg-amber-100 text-amber-800', icon: Clock3 },
    approved: { text: 'อนุมัติแล้ว', className: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
    rejected: { text: 'ปฏิเสธ', className: 'bg-red-100 text-red-700', icon: XCircle },
    cancelled: { text: 'ยกเลิกแล้ว', className: 'bg-slate-100 text-slate-600', icon: XCircle },
  } as const;
  const value = map[status];
  const Icon = value.icon;
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${value.className}`}><Icon size={13} />{value.text}</span>;
}
