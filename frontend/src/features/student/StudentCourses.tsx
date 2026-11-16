import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Inbox,
  KeyRound,
  LoaderCircle,
  Plus,
  X,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { useModalIsolation } from '../../components/overlays/useModalIsolation';
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

type Tab = 'courses' | 'requests';
const TABS: readonly Tab[] = ['courses', 'requests'];

function detail(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
    ? error.response.data.detail
    : fallback;
}

function formatInput(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8);
  return normalized.length > 4 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
}

function semesterText(course: Course) {
  return course.semester || course.year ? `ภาค ${course.semester ?? '-'}/${course.year ?? '-'}` : '';
}

export default function StudentCourses() {
  const { notify } = useNotification();
  const [courses, setCourses] = useState<Course[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<JoinRequest | null>(null);
  // null = not chosen yet: the first load picks "requests" when there are no courses but open requests.
  const [tab, setTab] = useState<Tab | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const joinButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ courses: null, requests: null });
  const baseId = useId();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await axios.get('/api/v1/students/me/courses');
      const loadedCourses: Course[] = response.data.courses ?? [];
      const loadedRequests: JoinRequest[] = response.data.join_requests ?? [];
      setCourses(loadedCourses);
      setRequests(loadedRequests);
      setTab((current) => current ?? (loadedCourses.length === 0 && loadedRequests.some((item) => item.status === 'pending') ? 'requests' : 'courses'));
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

  const activeTab: Tab = tab ?? 'courses';
  const pendingCount = requests.filter((item) => item.status === 'pending').length;

  const selectTab = (next: Tab, focus = false) => {
    setTab(next);
    if (focus) tabRefs.current[next]?.focus();
  };

  // Arrow keys move between the two tabs (WAI-ARIA tabs pattern).
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(activeTab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      selectTab(TABS[(index + step + TABS.length) % TABS.length], true);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      selectTab(event.key === 'Home' ? TABS[0] : TABS[TABS.length - 1], true);
    }
  };

  const closeJoin = () => {
    setJoinOpen(false);
    window.requestAnimationFrame(() => joinButtonRef.current?.focus());
  };

  const onJoined = async (message: string) => {
    notify(message, 'success');
    setJoinOpen(false);
    setTab('requests');
    await load();
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

  const tabId = (value: Tab) => `${baseId}-tab-${value}`;
  const panelId = (value: Tab) => `${baseId}-panel-${value}`;

  return <div className="student-page flex min-h-full flex-col gap-4 bg-slate-50">
    <ConfirmDialog open={Boolean(cancelTarget)} title="ยกเลิกคำขอเข้าร่วมหรือไม่" description={`ยกเลิกคำขอเข้าร่วม ${cancelTarget?.course?.course_code || 'รายวิชานี้'} คุณสามารถกรอกรหัสเพื่อส่งคำขอใหม่ได้ภายหลัง`} confirmLabel="ยกเลิกคำขอ" danger busy={submitting} onConfirm={() => void cancelRequest()} onCancel={() => setCancelTarget(null)} />
    {joinOpen && <JoinSheet onClose={closeJoin} onJoined={(message) => void onJoined(message)} />}

    <div role="tablist" aria-label="มุมมองรายวิชา" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200 p-1">
      {TABS.map((value) => {
        const selected = activeTab === value;
        return <button
          key={value}
          ref={(node) => { tabRefs.current[value] = node; }}
          type="button"
          role="tab"
          id={tabId(value)}
          aria-selected={selected}
          aria-controls={panelId(value)}
          tabIndex={selected ? 0 : -1}
          onClick={() => selectTab(value)}
          onKeyDown={onTabKeyDown}
          className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${selected ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {value === 'courses' ? 'วิชาของฉัน' : 'คำขอ'}
          {value === 'courses'
            ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600">{courses.length}</span>
            : pendingCount > 0 && <span className="flex min-w-5 items-center justify-center rounded-full bg-amber-600 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white" aria-label={`รออนุมัติ ${pendingCount} รายการ`}>{pendingCount}</span>}
        </button>;
      })}
    </div>

    <div className="flex-1">
      {loading ? <div role="status" className="flex min-h-36 items-center justify-center gap-2 text-sm text-slate-600"><LoaderCircle className="animate-spin motion-reduce:animate-none" />กำลังโหลดรายวิชา…</div>
        : error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-red-200 bg-white px-3 font-bold hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">ลองโหลดใหม่</button></div>
          : <>
            <section role="tabpanel" id={panelId('courses')} aria-labelledby={tabId('courses')} hidden={activeTab !== 'courses'} tabIndex={0} className="focus:outline-none">
              {courses.length === 0
                ? <EmptyState icon={<BookOpen />} title="ยังไม่มีรายวิชาที่เข้าร่วม" text="กด “เข้าร่วมวิชา” แล้วกรอกรหัสคลาสจากอาจารย์ หรือรออาจารย์เพิ่มรายชื่อ" />
                : <>
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="รายวิชาที่เข้าร่วมแล้ว">
                    {courses.map((course) => <li key={course.id}>
                      <Link to={`/student/history/${course.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500">
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-xs font-bold tabular-nums text-orange-700">{course.course_code} · Sec {course.section}</span>
                          <span className="mt-0.5 block font-bold leading-snug text-slate-900">{course.course_name}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-slate-600">{[course.teacher?.full_name || 'ไม่ระบุอาจารย์', semesterText(course)].filter(Boolean).join(' · ')}</span>
                        </span>
                        <ChevronRight aria-hidden="true" className="shrink-0 text-slate-500" size={20} />
                      </Link>
                    </li>)}
                  </ul>
                  <p className="mt-3 text-center text-xs text-slate-600">แตะวิชาเพื่อดูประวัติการเข้าเรียน</p>
                </>}
            </section>

            <section role="tabpanel" id={panelId('requests')} aria-labelledby={tabId('requests')} hidden={activeTab !== 'requests'} tabIndex={0} className="focus:outline-none">
              {requests.length === 0
                ? <EmptyState icon={<Inbox />} title="ยังไม่มีคำขอเข้าร่วม" text="คำขอที่ส่งด้วยรหัสคลาสจะแสดงที่นี่ พร้อมสถานะการอนุมัติ" />
                : <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="คำขอเข้าร่วมรายวิชา">
                  {requests.map((item) => <li key={item.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-bold tabular-nums text-slate-600">{item.course?.course_code || '-'}</p>
                        <p className="mt-0.5 font-bold leading-snug text-slate-900">{item.course?.course_name || 'รายวิชา'}</p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-600">ส่งเมื่อ {new Date(item.requested_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      </div>
                      <RequestStatus status={item.status} />
                    </div>
                    {item.review_note && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">หมายเหตุจากอาจารย์: {item.review_note}</p>}
                    {item.status === 'pending' && <button type="button" disabled={submitting} onClick={() => setCancelTarget(item)} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-sm font-bold text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"><XCircle size={17} aria-hidden="true" />ยกเลิกคำขอ</button>}
                  </li>)}
                </ul>}
            </section>
          </>}
    </div>

    {/* Sticky inside the page's own scroller, so it never covers the bottom navigation. */}
    <div className="pointer-events-none sticky bottom-3 flex justify-end">
      <button ref={joinButtonRef} type="button" onClick={() => setJoinOpen(true)} aria-haspopup="dialog" className="pointer-events-auto inline-flex min-h-12 items-center gap-2 rounded-full bg-orange-700 px-5 font-bold text-white shadow-[0_8px_18px_rgb(194_65_12/0.35)] hover:bg-orange-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">
        <Plus size={20} aria-hidden="true" />เข้าร่วมวิชา
      </button>
    </div>
  </div>;
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center">
    <span className="mx-auto flex size-10 items-center justify-center text-slate-500" aria-hidden="true">{icon}</span>
    <p className="mt-2 text-sm font-bold text-slate-800">{title}</p>
    <p className="mx-auto mt-1 max-w-[30ch] text-xs leading-5 text-slate-600">{text}</p>
  </div>;
}

/** Bottom sheet with the class-code form. Escape, the X and the backdrop close it. */
function JoinSheet({ onClose, onJoined }: { onClose: () => void; onJoined: (message: string) => void }) {
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLFormElement>(null);
  const titleId = useId();

  useModalIsolation(true);
  // Latest close handler and busy flag for the key listener, so it is attached once.
  const onCloseRef = useRef(onClose);
  const submittingRef = useRef(submitting);
  useEffect(() => { onCloseRef.current = onClose; submittingRef.current = submitting; });

  useEffect(() => {
    inputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      // Keep focus inside the sheet.
      const focusable = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setCodeError('');
    if (code.replace('-', '').length !== 8) {
      setCodeError('กรุณากรอกรหัสคลาสให้ครบ 8 ตัว');
      return;
    }
    setSubmitting(true);
    try {
      const response = await axios.post('/api/v1/students/me/courses/join', { code });
      onJoined(response.data.message || 'ส่งคำขอเข้าร่วมรายวิชาแล้ว');
    } catch (joinError) {
      setCodeError(detail(joinError, 'ไม่สามารถส่งคำขอเข้าร่วมได้'));
      setSubmitting(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return createPortal(
    <div className="fixed inset-0 flex items-end justify-center bg-slate-950/50" style={{ zIndex: 'var(--z-dialog)' }} onClick={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <form
        ref={sheetRef}
        noValidate
        onSubmit={(event) => void submit(event)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[480px] rounded-t-3xl bg-white px-5 pt-3 shadow-[0_-12px_32px_rgb(15_23_42/0.18)]"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <span className="mx-auto block h-1.5 w-10 rounded-full bg-slate-300" aria-hidden="true" />
        <button type="button" onClick={onClose} disabled={submitting} aria-label="ปิด" className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50"><X size={22} aria-hidden="true" /></button>
        <h2 id={titleId} className="mt-4 flex items-center gap-2 pr-10 text-lg font-bold text-slate-900"><KeyRound className="text-orange-700" size={20} aria-hidden="true" />เข้าร่วมด้วยรหัสคลาส</h2>
        <label htmlFor="student-join-code" className="mt-4 block text-sm font-semibold text-slate-700">รหัสคลาส 8 ตัวจากอาจารย์</label>
        <input ref={inputRef} id="student-join-code" value={code} onChange={(event) => { setCode(formatInput(event.target.value)); setCodeError(''); }} autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text" placeholder="ABCD-2345" disabled={submitting} aria-invalid={Boolean(codeError)} aria-describedby={codeError ? 'student-join-code-error' : 'student-join-code-help'} className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 text-center font-mono text-2xl font-black uppercase tracking-[0.16em] placeholder:text-slate-500 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:bg-slate-100" />
        {codeError ? <p id="student-join-code-error" role="alert" className="mt-2 text-sm font-medium text-red-700">{codeError}</p> : <p id="student-join-code-help" className="mt-2 text-xs leading-5 text-slate-600">อาจารย์จะตรวจและอนุมัติคำขออีกครั้ง ดูสถานะได้ที่แท็บ “คำขอ”</p>}
        <button type="submit" disabled={submitting || code.replace('-', '').length !== 8} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-700 px-4 text-sm font-bold text-white hover:bg-orange-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <LoaderCircle className="animate-spin motion-reduce:animate-none" size={19} aria-hidden="true" /> : <CheckCircle2 size={19} aria-hidden="true" />}{submitting ? 'กำลังส่งคำขอ…' : 'ส่งคำขอเข้าร่วมรายวิชา'}</button>
      </form>
    </div>,
    document.body,
  );
}

function RequestStatus({ status }: { status: JoinRequest['status'] }) {
  const map = {
    pending: { text: 'รออนุมัติ', className: 'bg-amber-100 text-amber-800', icon: Clock3 },
    approved: { text: 'อนุมัติแล้ว', className: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
    rejected: { text: 'ปฏิเสธ', className: 'bg-red-100 text-red-700', icon: XCircle },
    cancelled: { text: 'ยกเลิกแล้ว', className: 'bg-slate-100 text-slate-700', icon: XCircle },
  } as const;
  const value = map[status];
  const Icon = value.icon;
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${value.className}`}><Icon size={13} aria-hidden="true" />{value.text}</span>;
}
