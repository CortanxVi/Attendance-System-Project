import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { ArchiveRestore, CalendarRange, Check, RotateCcw, X } from 'lucide-react';
import { useNotification } from '../../components/notifications/notificationContext';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { apiErrorMessage } from '../../services/apiError';
import type { AttendanceExportPayload, AttendanceExportSession } from '../../services/reportExport';

interface AttendancePeriodManagerProps {
  courseId: string;
  payload: AttendanceExportPayload;
  onChanged: () => Promise<void>;
}

type PendingAction =
  | { type: 'archive'; sessionIds: string[] }
  | { type: 'restore'; sessionIds: string[] }
  | { type: 'rollover'; semester: 1 | 2; year: number }
  | null;

function sessionLabel(session: AttendanceExportSession, index?: number): string {
  const prefix = index === undefined ? '' : `ครั้งที่ ${index + 1} · `;
  return `${prefix}${new Date(session.created_at).toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })}`;
}

export default function AttendancePeriodManager({ courseId, payload, onChanged }: AttendancePeriodManagerProps) {
  const { notify } = useNotification();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [semester, setSemester] = useState<1 | 2>(payload.course.semester === 1 ? 2 : 1);
  const [year, setYear] = useState(payload.course.semester === 1 ? payload.course.year : payload.course.year + 1);

  const closedSessions = useMemo(
    () => payload.sessions.filter((session) => session.status === 'closed' || Boolean(session.closed_at)),
    [payload.sessions],
  );
  const currentPeriodArchives = useMemo(
    () => (payload.archived_sessions ?? []).filter((session) => (
      session.report_semester === payload.course.semester && session.report_year === payload.course.year
    )),
    [payload.archived_sessions, payload.course.semester, payload.course.year],
  );
  const oldPeriodArchiveCount = (payload.archived_sessions?.length ?? 0) - currentPeriodArchives.length;
  const validSelectedIds = selectedIds.filter((id) => closedSessions.some((session) => session.id === id));

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !pendingAction) setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, open, pendingAction]);

  const runPendingAction = async () => {
    if (!pendingAction) return;
    setBusy(true);
    try {
      if (pendingAction.type === 'archive') {
        await axios.post(`/api/v1/teacher/courses/${courseId}/attendance-period/archive`, {
          session_ids: pendingAction.sessionIds,
          reason: 'นำออกจากรายงานปัจจุบันโดยอาจารย์ผู้สอน',
        });
        notify(`นำ ${pendingAction.sessionIds.length} ครั้งออกจากรายงานแล้ว (ข้อมูลยังอยู่และกู้คืนได้)`, 'success');
        setSelectedIds([]);
      } else if (pendingAction.type === 'restore') {
        await axios.post(`/api/v1/teacher/courses/${courseId}/attendance-period/restore`, {
          session_ids: pendingAction.sessionIds,
        });
        notify('คืนคาบเรียนเข้าสู่รายงานแล้ว', 'success');
      } else {
        await axios.post(`/api/v1/teacher/courses/${courseId}/attendance-period/rollover`, {
          semester: pendingAction.semester,
          year: pendingAction.year,
          reason: `สิ้นสุดภาคเรียน ${payload.course.semester}/${payload.course.year}`,
        });
        notify(`เริ่มภาคเรียน ${pendingAction.semester}/${pendingAction.year} แล้ว รายงานปัจจุบันเป็นเอกสารเปล่า`, 'success');
      }
      setPendingAction(null);
      await onChanged();
    } catch (error: unknown) {
      notify(apiErrorMessage(error, 'ไม่สามารถจัดการรอบรายงานได้'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const pendingDescription = pendingAction?.type === 'archive'
    ? `นำข้อมูล ${pendingAction.sessionIds.length} ครั้งออกจากรายงานปัจจุบันหรือไม่?\nระบบจะไม่ลบหลักฐานการเช็คชื่อ และสามารถคืนกลับได้ในภาคเรียนนี้`
    : pendingAction?.type === 'restore'
      ? `คืนข้อมูล ${pendingAction.sessionIds.length} ครั้งเข้าสู่รายงานภาคเรียนปัจจุบันหรือไม่?`
      : pendingAction?.type === 'rollover'
        ? `เริ่มภาคเรียน ${pendingAction.semester}/${pendingAction.year} หรือไม่?\nคาบปัจจุบันทั้งหมดจะถูกพักไว้ รายงานใหม่จะเป็นเอกสารเปล่า แต่ข้อมูลเดิมจะไม่ถูกลบ`
        : '';

  return <>
    <button
      type="button"
      onClick={() => {
        setSemester(payload.course.semester === 1 ? 2 : 1);
        setYear(payload.course.semester === 1 ? payload.course.year : payload.course.year + 1);
        setOpen(true);
      }}
      className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-bold text-orange-800 hover:bg-orange-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 sm:text-sm"
    >
      <CalendarRange size={17} /> จัดการรอบรายงาน
    </button>

    {open && <div className="fixed inset-0 flex items-center justify-center p-2 sm:p-4" style={{ zIndex: 'var(--z-dialog)' }}>
      <button type="button" aria-label="ปิดหน้าต่างจัดการรอบรายงาน" onClick={() => { if (!busy) setOpen(false); }} className="absolute inset-0 bg-slate-950/70" />
      <section role="dialog" aria-modal="true" aria-labelledby="attendance-period-title" className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 p-4 sm:p-5">
          <div>
            <h2 id="attendance-period-title" className="text-lg font-bold text-slate-900 sm:text-xl">จัดการรอบรายงานการเข้าเรียน</h2>
            <p className="mt-1 text-sm text-slate-600">พักคาบที่ไม่ต้องการนับ หรือเริ่มภาคเรียนใหม่โดยไม่ลบประวัติเดิม</p>
          </div>
          <button ref={closeButtonRef} type="button" disabled={busy} onClick={() => setOpen(false)} aria-label="ปิดหน้าต่างจัดการรอบรายงาน" className="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-50"><X size={20} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          <dl className="grid gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs font-bold uppercase tracking-wide text-orange-700">รอบปัจจุบัน</dt><dd className="mt-1 text-lg font-bold text-slate-900">ภาคเรียน {payload.course.semester}/{payload.course.year}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wide text-orange-700">คาบในรายงาน</dt><dd className="mt-1 text-lg font-bold text-slate-900">{payload.sessions.length} / {payload.course.total_sessions ?? '-'} ครั้ง</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wide text-orange-700">เกณฑ์ขั้นต่ำ</dt><dd className="mt-1 text-lg font-bold text-slate-900">{100 - Number(payload.course.max_absence_percent ?? 0)}%</dd></div>
          </dl>

          <section aria-labelledby="archive-session-title" className="rounded-2xl border border-slate-200">
            <div className="border-b border-slate-200 p-4">
              <h3 id="archive-session-title" className="font-bold text-slate-900">นำบางครั้งออกจากรายงาน</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">เลือกได้เฉพาะคาบที่ปิดแล้ว ข้อมูลและหลักฐานเดิมจะยังอยู่ในฐานข้อมูล</p>
            </div>
            {closedSessions.length ? <div className="max-h-64 overflow-y-auto p-2">
              {closedSessions.map((session) => {
                const checked = selectedIds.includes(session.id);
                return <label key={session.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50">
                  <input type="checkbox" checked={checked} onChange={() => setSelectedIds((current) => checked ? current.filter((id) => id !== session.id) : [...current, session.id])} className="size-4 rounded border-slate-300 text-orange-600 focus:ring-orange-400" />
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-700">{sessionLabel(session, payload.sessions.findIndex((item) => item.id === session.id))}</span>
                  {checked && <Check aria-hidden="true" className="text-orange-600" size={17} />}
                </label>;
              })}
            </div> : <p className="p-5 text-sm text-slate-500">ยังไม่มีคาบที่ปิดแล้วสำหรับนำออกจากรายงาน</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-3">
              <button type="button" disabled={!closedSessions.length || busy} onClick={() => setSelectedIds(validSelectedIds.length === closedSessions.length ? [] : closedSessions.map((session) => session.id))} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">{validSelectedIds.length === closedSessions.length && closedSessions.length ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกคาบที่ปิดแล้วทั้งหมด'}</button>
              <button type="button" disabled={!validSelectedIds.length || busy} onClick={() => setPendingAction({ type: 'archive', sessionIds: validSelectedIds })} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-bold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"><ArchiveRestore size={17} />นำ {validSelectedIds.length || ''} ครั้งออก</button>
            </div>
          </section>

          <section aria-labelledby="rollover-title" className="rounded-2xl border border-slate-200 p-4">
            <h3 id="rollover-title" className="font-bold text-slate-900">เริ่มภาคเรียนใหม่ด้วยรายงานเปล่า</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">ระบบจะพักคาบทั้งหมดของรอบปัจจุบันและคงรายชื่อ เกณฑ์ และข้อมูลวิชาไว้ ต้องปิดคาบที่กำลังเปิดก่อน</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div><label htmlFor="next-semester" className="mb-1 block text-xs font-bold text-slate-600">ภาคเรียนใหม่</label><select id="next-semester" value={semester} onChange={(event) => setSemester(Number(event.target.value) as 1 | 2)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"><option value={1}>ภาคเรียน 1</option><option value={2}>ภาคเรียน 2</option></select></div>
              <div><label htmlFor="next-year" className="mb-1 block text-xs font-bold text-slate-600">ปีการศึกษา</label><input id="next-year" type="number" min={2000} max={3000} value={year} onChange={(event) => setYear(Number(event.target.value))} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" /></div>
              <button type="button" disabled={busy || year < 2000 || year > 3000} onClick={() => setPendingAction({ type: 'rollover', semester, year })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50"><CalendarRange size={17} />เริ่มรอบใหม่</button>
            </div>
          </section>

          <section aria-labelledby="restore-title" className="rounded-2xl border border-slate-200 p-4">
            <h3 id="restore-title" className="font-bold text-slate-900">คาบที่พักไว้ในภาคเรียนปัจจุบัน</h3>
            {currentPeriodArchives.length ? <ul className="mt-3 divide-y divide-slate-100">{currentPeriodArchives.map((session) => <li key={session.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-slate-700">{sessionLabel(session)}</p>{session.archive_reason && <p className="mt-0.5 text-xs text-slate-500">{session.archive_reason}</p>}</div><button type="button" disabled={busy} onClick={() => setPendingAction({ type: 'restore', sessionIds: [session.id] })} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RotateCcw size={16} />คืนกลับ</button></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">ไม่มีคาบที่พักไว้ในภาคเรียนนี้</p>}
            {oldPeriodArchiveCount > 0 && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">มีข้อมูลจากภาคเรียนก่อนหน้าเก็บไว้อีก {oldPeriodArchiveCount} ครั้ง ระบบไม่อนุญาตให้นำมาปะปนกับรอบปัจจุบัน</p>}
          </section>
        </div>
      </section>
    </div>}

    <ConfirmDialog
      open={Boolean(pendingAction)}
      title={pendingAction?.type === 'rollover' ? 'เริ่มภาคเรียนใหม่' : pendingAction?.type === 'restore' ? 'คืนคาบเรียน' : 'นำคาบออกจากรายงาน'}
      description={pendingDescription}
      confirmLabel={pendingAction?.type === 'rollover' ? 'เริ่มภาคเรียนใหม่' : pendingAction?.type === 'restore' ? 'คืนกลับ' : 'นำออกจากรายงาน'}
      danger={pendingAction?.type !== 'restore'}
      busy={busy}
      onConfirm={() => void runPendingAction()}
      onCancel={() => setPendingAction(null)}
    />
  </>;
}
