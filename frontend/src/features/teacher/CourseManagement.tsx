import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  Clipboard,
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { useNotification } from '../../components/notifications/notificationContext';
import CourseAttendanceView from './CourseAttendanceView';
import CourseSettingsModal from './CourseSettings';
import EditCourseModal from './EditCourseModal';
import ImportStudents from './ImportStudents';

interface Course {
  id: string;
  course_code: string;
  course_name: string;
  section: number;
  semester?: number;
  year?: number;
  total_sessions?: number;
  late_threshold_minutes?: number;
  absent_threshold_minutes?: number;
  max_absence_percent?: number;
}

interface JoinCode {
  id: string;
  join_code: string;
  is_active: boolean;
  expires_at?: string | null;
  usage_count: number;
  rotated_at?: string | null;
}

interface JoinRequestRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_at: string;
  review_note?: string | null;
  student?: {
    student_id?: string | null;
    full_name?: string | null;
    email?: string | null;
    academic_year?: number | null;
    class_level?: string | null;
  } | null;
}

const tabs = [
  { key: 'overview', label: 'ข้อมูลรายวิชา', icon: BookOpen },
  { key: 'attendance-settings', label: 'เกณฑ์เข้าเรียน', icon: SlidersHorizontal },
  { key: 'members', label: 'สมาชิก', icon: Users },
  { key: 'join-code', label: 'รหัสคลาส', icon: KeyRound },
  { key: 'attendance', label: 'ประวัติเข้าเรียน', icon: BarChart3 },
  { key: 'danger', label: 'พื้นที่อันตราย', icon: ShieldAlert },
] as const;

type TabKey = typeof tabs[number]['key'];

function apiDetail(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
    ? error.response.data.detail
    : fallback;
}

export default function CourseManagement() {
  const { courseId = '', tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const { notify } = useNotification();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const activeTab: TabKey = tabs.some((item) => item.key === tab) ? tab as TabKey : 'overview';

  const loadCourse = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`/api/v1/teacher/courses/${courseId}/management`);
      setCourse(response.data.course);
    } catch (loadError) {
      setError(apiDetail(loadError, 'ไม่สามารถโหลดข้อมูลรายวิชาได้'));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCourse(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCourse]);
  useEffect(() => { document.title = 'จัดการรายวิชา — KMUTNB Attendance'; }, []);

  const deleteCourse = async () => {
    if (!course) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/v1/courses/${course.id}`);
      notify(`ลบรายวิชา ${course.course_code} แล้ว`, 'success');
      navigate('/teacher', { replace: true });
    } catch (deleteError) {
      notify(apiDetail(deleteError, 'ไม่สามารถลบรายวิชาได้'), 'error');
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  if (loading) return <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-slate-500"><LoaderCircle className="animate-spin" />กำลังโหลดรายวิชา…</div>;
  if (error || !course) return <section className="rounded-2xl border border-red-200 bg-red-50 p-6"><p role="alert" className="text-sm text-red-700">{error || 'ไม่พบรายวิชา'}</p><Link to="/teacher" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-red-800"><ArrowLeft size={17} />กลับหน้ารายวิชา</Link></section>;

  return <div className="mx-auto max-w-7xl space-y-5">
    {editOpen && <EditCourseModal course={course} onClose={() => setEditOpen(false)} onSuccess={() => void loadCourse()} />}
    {settingsOpen && <CourseSettingsModal courseId={course.id} currentConfig={{ total_sessions: course.total_sessions, late_threshold_minutes: course.late_threshold_minutes, absent_threshold_minutes: course.absent_threshold_minutes, max_absence_percent: course.max_absence_percent }} onSaveSuccess={() => void loadCourse()} onClose={() => setSettingsOpen(false)} />}
    {attendanceOpen && <CourseAttendanceView courseId={course.id} courseCode={course.course_code} courseName={course.course_name} onClose={() => setAttendanceOpen(false)} />}
    <ConfirmDialog open={deleteOpen} title="ลบรายวิชานี้หรือไม่" description={`รายวิชา ${course.course_code} และข้อมูลที่เกี่ยวข้องจะถูกลบ การดำเนินการนี้ไม่สามารถย้อนกลับได้`} confirmLabel="ลบรายวิชา" danger busy={deleting} onConfirm={() => void deleteCourse()} onCancel={() => setDeleteOpen(false)} />

    <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 bg-slate-900 px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link to="/teacher" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-300"><ArrowLeft size={17} />กลับหน้ารายวิชา</Link>
          <p className="font-mono text-sm font-bold text-orange-300">{course.course_code}</p>
          <h1 className="mt-1 truncate text-2xl font-bold">{course.course_name}</h1>
          <p className="mt-1 text-sm text-slate-300">Section {course.section} · ภาคเรียน {course.semester ?? '-'} / {course.year ?? '-'}</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold"><Settings2 size={18} />ศูนย์จัดการรายวิชา</span>
      </div>
    </header>

    <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="หัวข้อจัดการรายวิชา" className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:sticky lg:top-4">
        <ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
          {tabs.map((item) => {
            const Icon = item.icon;
            return <li key={item.key}><NavLink to={`/teacher/courses/${course.id}/manage/${item.key}`} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-orange-300 ${isActive ? item.key === 'danger' ? 'bg-red-50 text-red-700' : 'bg-orange-50 text-orange-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Icon size={18} />{item.label}</NavLink></li>;
          })}
        </ul>
      </nav>

      <main className="min-w-0">
        {activeTab === 'overview' && <OverviewPanel course={course} onEdit={() => setEditOpen(true)} />}
        {activeTab === 'attendance-settings' && <AttendanceSettingsPanel course={course} onOpen={() => setSettingsOpen(true)} />}
        {activeTab === 'members' && <ImportStudents fixedCourseId={course.id} embedded />}
        {activeTab === 'join-code' && <JoinCodePanel courseId={course.id} />}
        {activeTab === 'attendance' && <AttendancePanel onOpen={() => setAttendanceOpen(true)} />}
        {activeTab === 'danger' && <DangerPanel course={course} onDelete={() => setDeleteOpen(true)} />}
      </main>
    </div>
  </div>;
}

function OverviewPanel({ course, onEdit }: { course: Course; onEdit: () => void }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-slate-900">ข้อมูลรายวิชา</h2><p className="mt-1 text-sm text-slate-500">ข้อมูลที่นักศึกษาเห็นในหน้ารายวิชาและประวัติการเข้าเรียน</p></div><button type="button" onClick={onEdit} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300"><Settings2 size={18} />แก้ไขข้อมูล</button></div>
    <dl className="mt-6 grid gap-4 sm:grid-cols-2"><Info label="รหัสวิชา" value={course.course_code} mono /><Info label="ชื่อวิชา" value={course.course_name} /><Info label="Section" value={String(course.section)} /><Info label="ภาคเรียน / ปีการศึกษา" value={`${course.semester ?? '-'} / ${course.year ?? '-'}`} /></dl>
  </section>;
}

function AttendanceSettingsPanel({ course, onOpen }: { course: Course; onOpen: () => void }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-slate-900">เกณฑ์การเข้าเรียน</h2><p className="mt-1 text-sm text-slate-500">ใช้คำนวณสถานะมาเรียน มาสาย และขาดเรียน</p></div><button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300"><SlidersHorizontal size={18} />แก้ไขเกณฑ์</button></div><dl className="mt-6 grid gap-4 sm:grid-cols-2"><Info label="จำนวนคาบทั้งหมด" value={`${course.total_sessions ?? 0} คาบ`} /><Info label="มาสายหลังจาก" value={`${course.late_threshold_minutes ?? 15} นาที`} /><Info label="ขาดเรียนหลังจาก" value={`${course.absent_threshold_minutes ?? 45} นาที`} /><Info label="ขาดเรียนได้สูงสุด" value={`${course.max_absence_percent ?? 20}%`} /></dl></section>;
}

function AttendancePanel({ onOpen }: { onOpen: () => void }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><BarChart3 className="text-emerald-600" size={30} /><h2 className="mt-4 text-xl font-bold text-slate-900">ประวัติและรายงานการเข้าเรียน</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">ตรวจรายชื่อแต่ละคาบ แก้สถานะด้วยมือเมื่อมีหลักฐาน และส่งออกข้อมูลจากหน้ารายงาน</p><div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-300"><UserCheck size={18} />เปิดประวัติเช็คชื่อ</button><Link to="/teacher/reports" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300"><Clipboard size={18} />ไปหน้าส่งออกรายงาน</Link></div></section>;
}

function DangerPanel({ course, onDelete }: { course: Course; onDelete: () => void }) {
  return <section className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm"><ShieldAlert className="text-red-600" size={30} /><h2 className="mt-4 text-xl font-bold text-red-800">พื้นที่อันตราย</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">การลบรายวิชา {course.course_code} จะลบสมาชิก คาบเรียน ประวัติที่ผูกไว้ คำร้อง และรหัสคลาส โปรดส่งออกรายงานก่อนดำเนินการ</p><button type="button" onClick={onDelete} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300"><Trash2 size={18} />ลบรายวิชา</button></section>;
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className={`mt-1 break-words font-bold text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</dd></div>;
}

function JoinCodePanel({ courseId }: { courseId: string }) {
  const { notify } = useNotification();
  const [joinCode, setJoinCode] = useState<JoinCode | null>(null);
  const [requests, setRequests] = useState<JoinRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'cancelled' | 'all'>('pending');
  const [expiry, setExpiry] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ type: 'rotate' } | { type: 'review'; request: JoinRequestRow; decision: 'approved' | 'rejected' } | null>(null);

  const loadCode = useCallback(async () => {
    const response = await axios.get(`/api/v1/teacher/courses/${courseId}/join-code`);
    const code = response.data.join_code as JoinCode;
    setJoinCode(code);
    setExpiry(code.expires_at ? new Date(code.expires_at).toISOString().slice(0, 16) : '');
  }, [courseId]);

  const loadRequests = useCallback(async () => {
    const response = await axios.get(`/api/v1/teacher/courses/${courseId}/join-requests`, { params: { page, page_size: 10, status_filter: filter } });
    setRequests(response.data.requests ?? []);
    setTotal(response.data.total ?? 0);
  }, [courseId, filter, page]);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { await Promise.all([loadCode(), loadRequests()]); }
    catch (loadError) { setError(apiDetail(loadError, 'ไม่สามารถโหลดรหัสคลาสได้')); }
    finally { setLoading(false); }
  }, [loadCode, loadRequests]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const updateSettings = async (payload: { is_active?: boolean; expires_at?: string | null }) => {
    setBusy(true);
    try {
      const response = await axios.patch(`/api/v1/teacher/courses/${courseId}/join-code`, payload);
      setJoinCode(response.data.join_code);
      notify('บันทึกการตั้งค่ารหัสคลาสแล้ว', 'success');
    } catch (updateError) { notify(apiDetail(updateError, 'บันทึกการตั้งค่าไม่สำเร็จ'), 'error'); }
    finally { setBusy(false); }
  };

  const saveExpiry = async () => {
    if (expiry && new Date(expiry).getTime() <= Date.now()) { notify('วันหมดอายุต้องอยู่ในอนาคต', 'error'); return; }
    await updateSettings({ expires_at: expiry ? new Date(expiry).toISOString() : null });
  };

  const performConfirmedAction = async () => {
    if (!confirmAction) return;
    setBusy(true);
    try {
      if (confirmAction.type === 'rotate') {
        const response = await axios.post(`/api/v1/teacher/courses/${courseId}/join-code/rotate`);
        setJoinCode(response.data.join_code);
        notify('สร้างรหัสคลาสใหม่แล้ว รหัสเดิมถูกยกเลิกทันที', 'success');
      } else {
        await axios.post(`/api/v1/teacher/courses/${courseId}/join-requests/${confirmAction.request.id}/review`, { decision: confirmAction.decision });
        notify(confirmAction.decision === 'approved' ? 'อนุมัตินักศึกษาเข้ารายวิชาแล้ว' : 'ปฏิเสธคำขอแล้ว', 'success');
        await loadRequests();
      }
      setConfirmAction(null);
    } catch (actionError) { notify(apiDetail(actionError, 'ดำเนินการไม่สำเร็จ'), 'error'); }
    finally { setBusy(false); }
  };

  const pages = Math.max(1, Math.ceil(total / 10));
  const confirmTitle = confirmAction?.type === 'rotate' ? 'สร้างรหัสคลาสใหม่หรือไม่' : confirmAction?.decision === 'approved' ? 'อนุมัติเข้าร่วมรายวิชาหรือไม่' : 'ปฏิเสธคำขอนี้หรือไม่';
  const confirmDescription = confirmAction?.type === 'rotate' ? 'รหัสเดิมจะใช้ไม่ได้ทันที นักศึกษาที่ส่งคำขอไว้แล้วจะไม่ได้รับผลกระทบ' : `ดำเนินการกับคำขอของ ${confirmAction?.type === 'review' ? confirmAction.request.student?.full_name || confirmAction.request.student?.student_id || 'นักศึกษา' : ''}`;

  return <div className="space-y-5">
    <ConfirmDialog open={Boolean(confirmAction)} title={confirmTitle} description={confirmDescription} confirmLabel={confirmAction?.type === 'rotate' ? 'สร้างรหัสใหม่' : confirmAction?.decision === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'} danger={confirmAction?.type === 'rotate' || confirmAction?.decision === 'rejected'} busy={busy} onConfirm={() => void performConfirmedAction()} onCancel={() => setConfirmAction(null)} />
    {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" />กำลังโหลดรหัสคลาส…</div> : error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : joinCode && <>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-900 px-6 py-5 text-white"><p className="text-sm font-semibold text-orange-300">รหัสเข้าร่วมคลาส</p><div className="mt-2 flex flex-wrap items-center gap-3"><code className="text-3xl font-black tracking-[0.18em] sm:text-4xl">{joinCode.join_code}</code><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(joinCode.join_code.replace('-', '')); notify('คัดลอกรหัสคลาสแล้ว', 'success'); } catch { notify('เบราว์เซอร์ไม่อนุญาตให้คัดลอก กรุณาเลือกรหัสด้วยตนเอง', 'error'); } }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-bold hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-orange-300"><Copy size={18} />คัดลอก</button></div><p className="mt-3 text-sm text-slate-300">ผู้ที่ไม่มีรายชื่อเดิมจะต้องรออาจารย์อนุมัติก่อนเข้าร่วม</p></div>
        <div className="grid gap-5 p-6 md:grid-cols-2"><div><p className="text-sm font-bold text-slate-800">สถานะการรับสมาชิก</p><button type="button" disabled={busy} onClick={() => void updateSettings({ is_active: !joinCode.is_active })} className={`mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold focus:outline-none focus:ring-2 disabled:opacity-50 ${joinCode.is_active ? 'bg-emerald-100 text-emerald-800 focus:ring-emerald-300' : 'bg-slate-200 text-slate-700 focus:ring-slate-400'}`}>{joinCode.is_active ? <Check size={18} /> : <X size={18} />}{joinCode.is_active ? 'เปิดรับสมาชิก' : 'ปิดรับสมาชิก'}</button><p className="mt-3 text-xs text-slate-500">อนุมัติเข้าร่วมแล้ว {joinCode.usage_count} คน</p></div><div><label htmlFor="join-code-expiry" className="text-sm font-bold text-slate-800">วันหมดอายุ</label><div className="mt-2 flex flex-wrap gap-2"><input id="join-code-expiry" type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} disabled={busy} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-3 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" /><button type="button" disabled={busy} onClick={() => void saveExpiry()} className="min-h-11 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50">บันทึก</button>{expiry && <button type="button" disabled={busy} onClick={() => { setExpiry(''); void updateSettings({ expires_at: null }); }} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">ไม่หมดอายุ</button>}</div></div></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4"><p className="text-xs text-slate-500">สร้างรหัสล่าสุด {joinCode.rotated_at ? new Date(joinCode.rotated_at).toLocaleString('th-TH') : '-'}</p><button type="button" disabled={busy} onClick={() => setConfirmAction({ type: 'rotate' })} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300 px-3 text-sm font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50"><RefreshCw size={17} />สร้างรหัสใหม่</button></div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-slate-900">คำขอเข้าร่วมรายวิชา</h2><p className="mt-1 text-xs text-slate-500">ตรวจตัวตนนักศึกษาก่อนอนุมัติทุกครั้ง</p></div><label className="text-xs font-semibold text-slate-600">สถานะ<select value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setPage(1); }} className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5"><option value="pending">รออนุมัติ</option><option value="approved">อนุมัติแล้ว</option><option value="rejected">ปฏิเสธ</option><option value="cancelled">ยกเลิก</option><option value="all">ทั้งหมด</option></select></label></div>
        {requests.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">ไม่มีคำขอในสถานะนี้</p> : <ul className="divide-y divide-slate-100">{requests.map((item) => <li key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{item.student?.full_name || 'ไม่พบชื่อ'}</p><p className="mt-0.5 break-all text-xs text-slate-500">{item.student?.student_id || '-'} · {item.student?.email || '-'}</p><p className="mt-1 text-xs text-slate-400">ส่งเมื่อ {new Date(item.requested_at).toLocaleString('th-TH')}{item.student?.academic_year ? ` · ชั้นปี ${item.student.academic_year}` : ''}{item.student?.class_level ? ` · ${item.student.class_level}` : ''}</p></div>{item.status === 'pending' ? <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => setConfirmAction({ type: 'review', request: item, decision: 'approved' })} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={17} />อนุมัติ</button><button type="button" disabled={busy} onClick={() => setConfirmAction({ type: 'review', request: item, decision: 'rejected' })} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-red-300 px-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"><X size={17} />ปฏิเสธ</button></div> : <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${item.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : item.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{item.status === 'approved' ? 'อนุมัติแล้ว' : item.status === 'rejected' ? 'ปฏิเสธ' : 'นักศึกษายกเลิก'}</span>}</li>)}</ul>}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm"><span>ทั้งหมด {total} รายการ</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">ก่อนหน้า</button><span>{page}/{pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">ถัดไป</button></div></div>
      </section>
    </>}
  </div>;
}
