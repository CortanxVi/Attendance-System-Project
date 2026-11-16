import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Hash,
  PenLine,
  ScanFace,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useModalIsolation } from '../../components/overlays/useModalIsolation';

export interface CourseSummary {
  course_id: string; course_code: string; course_name: string; total_sessions: number;
  /** Absence limit of the course in percent (the API sends it with every summary). */
  max_absence_percent?: number | null;
  present: number; late: number; absent: number; absence_percentage: number; evaluation: 'Normal' | 'Fa';
}
export interface HistoryItem {
  course_id: string | null; course_code: string; course_name: string; check_in_time: string;
  status: 'pending' | 'present' | 'late' | 'absent'; method: 'face_ocr' | 'nfc' | 'manual' | null;
}

type Status = HistoryItem['status'];
const STATUS: Record<Status, { text: string; badge: string; dot: string; icon: LucideIcon; note: string }> = {
  present: { text: 'มาเรียน', badge: 'bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500', icon: CheckCircle2, note: 'บันทึกว่ามาเรียนตรงเวลา' },
  late: { text: 'มาสาย', badge: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500', icon: Clock3, note: 'นับเป็นมาสาย (คิดคะแนน 0.5 ครั้ง)' },
  absent: { text: 'ขาดเรียน', badge: 'bg-red-50 text-red-700', dot: 'bg-red-500', icon: XCircle, note: 'ไม่มีการเช็คชื่อในคาบนี้ จึงนับเป็นขาดเรียน' },
  pending: { text: 'รอตรวจสอบ', badge: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400', icon: Clock3, note: 'อาจารย์ยังไม่ได้ยืนยันผลการเช็คชื่อครั้งนี้' },
};
const METHOD: Record<string, { text: string; icon: LucideIcon }> = {
  face_ocr: { text: 'สแกนใบหน้า', icon: ScanFace },
  nfc: { text: 'บัตร NFC', icon: CreditCard },
  manual: { text: 'อาจารย์แก้ไขให้', icon: PenLine },
};

interface Session extends HistoryItem { number: number }

const date = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString('th-TH', options);
const checkInTime = (item: HistoryItem) => item.status === 'absent'
  ? 'ไม่ได้เช็คชื่อ'
  : `${new Date(item.check_in_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;

function StatusBadge({ status }: { status: Status }) {
  const { text, badge, icon: Icon } = STATUS[status];
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${badge}`}><Icon size={13} aria-hidden="true" />{text}</span>;
}

/** Same rule as the Backend: Fa when absences exceed total_sessions × max_absence_percent / 100. */
function absenceAllowance(course: CourseSummary) {
  const percent = course.max_absence_percent ?? 0;
  if (!course.total_sessions || !percent) return null;
  const allowed = course.total_sessions * (percent / 100);
  return { percent, allowed, left: Math.max(0, Math.floor(allowed - course.absent)) };
}

export default function CourseHistoryDetail({ course, history }: { course: CourseSummary; history: HistoryItem[] }) {
  // Session numbers follow the date order; the timeline shows the newest first.
  const sessions = useMemo<Session[]>(() => [...history]
    .sort((a, b) => new Date(a.check_in_time).getTime() - new Date(b.check_in_time).getTime())
    .map((item, index) => ({ ...item, number: index + 1 })), [history]);
  const newestFirst = useMemo(() => [...sessions].reverse(), [sessions]);
  const [openNumber, setOpenNumber] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const allowance = absenceAllowance(course);
  const left = course.total_sessions > sessions.length ? course.total_sessions - sessions.length : 0;
  const openSession = openNumber ? sessions[openNumber - 1] : undefined;

  const show = (number: number) => {
    setOpenNumber(number);
    // Keep the highlighted row visible behind the sheet while stepping through sessions.
    rowRefs.current.get(number)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const close = () => {
    const number = openNumber;
    setOpenNumber(null);
    if (number) window.requestAnimationFrame(() => rowRefs.current.get(number)?.focus());
  };

  return <div className="student-page space-y-4">
    <section aria-labelledby="course-detail-title" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="font-mono text-xs font-bold tabular-nums text-orange-700">{course.course_code}</p>
      <h1 id="course-detail-title" className="mt-1 text-xl font-bold leading-snug text-slate-900">{course.course_name}</h1>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">มาเรียน {course.present}</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">มาสาย {course.late}</span>
        <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700">ขาด {course.absent}</span>
        {left > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">เหลือ {left} ครั้ง</span>}
      </div>
      {course.evaluation === 'Fa'
        ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">ขาดเรียนเกินเกณฑ์แล้ว ({course.absence_percentage}%) กรุณาติดต่ออาจารย์ผู้สอน</p>
        : allowance
          ? <p className="mt-3 text-sm text-slate-600">ขาดได้อีก <b className="text-slate-900">{allowance.left} ครั้ง</b> ก่อนถึงเกณฑ์ {allowance.percent}% ({course.absent} จาก {Number(allowance.allowed.toFixed(2))} ครั้ง)</p>
          : <p className="mt-3 text-sm text-slate-600">ขาดเรียน {course.absence_percentage}% จากแผนทั้งหมด {course.total_sessions} ครั้ง</p>}
    </section>

    <section aria-labelledby="course-sessions-title">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h2 id="course-sessions-title" className="text-sm font-bold text-slate-700">การเข้าเรียนแต่ละครั้ง</h2>
        {sessions.length > 0 && <p className="text-xs text-slate-600">แตะเพื่อดูรายละเอียด</p>}
      </div>
      {sessions.length === 0
        ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">ยังไม่มีรายการเช็คชื่อในวิชานี้</div>
        : <ol className="relative">
          {newestFirst.map((session, index) => {
            const selected = openNumber === session.number;
            const method = session.method ? METHOD[session.method] : null;
            return <li key={`${session.check_in_time}-${session.number}`} className="relative">
              {/* Rail between the dots; it stops at the first and last item. */}
              <span aria-hidden="true" className={`absolute left-[calc(5rem-1px)] w-0.5 bg-slate-200 ${index === 0 ? 'top-6' : 'top-0'} ${index === newestFirst.length - 1 ? 'h-6' : 'bottom-0'}`} />
              <button
                ref={(node) => { if (node) rowRefs.current.set(session.number, node); else rowRefs.current.delete(session.number); }}
                type="button"
                onClick={() => show(session.number)}
                aria-haspopup="dialog"
                aria-current={selected ? 'true' : undefined}
                aria-label={`ครั้งที่ ${session.number} ${date(session.check_in_time, { weekday: 'long', day: 'numeric', month: 'long' })} ${STATUS[session.status].text} ดูรายละเอียด`}
                className={`grid w-full grid-cols-[3.5rem_1.5rem_1fr] items-start gap-x-2 rounded-2xl px-1 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 motion-reduce:transition-none ${selected ? 'bg-orange-50 ring-2 ring-orange-600' : 'hover:bg-slate-100'}`}
              >
                <span className={`flex flex-col items-center rounded-xl px-1 pb-2 pt-1.5 transition-colors motion-reduce:transition-none ${selected ? 'bg-slate-900 text-white' : ''}`}>
                  <span className="text-lg font-extrabold leading-tight tabular-nums">{date(session.check_in_time, { day: 'numeric' })}</span>
                  <span className={`text-xs font-semibold ${selected ? 'text-slate-300' : 'text-slate-600'}`}>{date(session.check_in_time, { month: 'short' })}</span>
                </span>
                <span className="relative flex justify-center pt-3" aria-hidden="true"><span className={`size-3.5 rounded-full border-[3px] border-slate-50 ${STATUS[session.status].dot}`} /></span>
                <span className="min-w-0 py-1">
                  <span className="block text-sm font-bold text-slate-900">{STATUS[session.status].text} <span className="font-semibold text-slate-600">· ครั้งที่ {session.number}</span></span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-600">{date(session.check_in_time, { weekday: 'short' })} {checkInTime(session)}{method ? ` · ${method.text}` : ''}</span>
                </span>
              </button>
            </li>;
          })}
        </ol>}
    </section>

    {openSession && <SessionSheet
      session={openSession}
      total={course.total_sessions}
      hasPrevious={openSession.number > 1}
      hasNext={openSession.number < sessions.length}
      onStep={(step) => show(openSession.number + step)}
      onClose={close}
    />}
  </div>;
}

function SessionSheet({ session, total, hasPrevious, hasNext, onStep, onClose }: {
  session: Session; total: number; hasPrevious: boolean; hasNext: boolean;
  onStep: (step: -1 | 1) => void; onClose: () => void;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useModalIsolation(true);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const method = session.method ? METHOD[session.method] : null;
  const MethodIcon = method?.icon ?? Hash;
  const facts: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: CalendarDays, label: 'วันที่', value: date(session.check_in_time, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) },
    { icon: Clock3, label: 'เวลาเช็คชื่อ', value: checkInTime(session) },
    { icon: MethodIcon, label: 'วิธี', value: method?.text ?? '—' },
  ];

  return createPortal(
    <div className="fixed inset-0 flex items-end justify-center bg-slate-950/45 motion-safe:animate-[sheet-fade_.2s_ease-out]" style={{ zIndex: 'var(--z-dialog)' }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[480px] rounded-t-3xl bg-white px-4 pt-2.5 shadow-[0_-12px_32px_rgb(15_23_42/0.18)] motion-safe:animate-[sheet-up_.3s_cubic-bezier(.22,1,.36,1)]"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <span className="mx-auto mb-2.5 block h-1.5 w-10 rounded-full bg-slate-300" aria-hidden="true" />
        <button ref={closeRef} type="button" onClick={onClose} aria-label="ปิดรายละเอียด" className="absolute right-1.5 top-1.5 inline-flex size-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"><X size={22} aria-hidden="true" /></button>
        <div className="flex items-center justify-between gap-3 pr-11">
          <h2 id={titleId} className="text-base font-extrabold text-slate-900">ครั้งที่ {session.number}{total > 0 && <span className="text-sm font-semibold text-slate-600"> จาก {total}</span>}</h2>
          <StatusBadge status={session.status} />
        </div>
        <dl className="mt-3 grid gap-2.5">
          {facts.map(({ icon: Icon, label, value }) => <div key={label} className="flex items-center gap-2.5 text-sm">
            <Icon size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
            <dt className="w-24 shrink-0 text-slate-600">{label}</dt>
            <dd className="min-w-0 font-bold tabular-nums text-slate-900">{value}</dd>
          </div>)}
        </dl>
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700">
          {STATUS[session.status].note}
          {session.status !== 'present' && <> · ข้อมูลไม่ถูกต้อง? <Link to="/student/requests" className="font-bold text-orange-700 underline underline-offset-2 hover:text-orange-800">ยื่นคำร้องถึงอาจารย์</Link></>}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={!hasPrevious} onClick={() => onStep(-1)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-45"><ChevronLeft size={18} aria-hidden="true" />ครั้งก่อน</button>
          <button type="button" disabled={!hasNext} onClick={() => onStep(1)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-45">ครั้งถัดไป<ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
