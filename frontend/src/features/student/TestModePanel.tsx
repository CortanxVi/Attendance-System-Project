import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical, Loader2, RefreshCw, ScanFace } from 'lucide-react';
import { apiErrorMessage } from '../../services/apiError';
import {
  fetchTestOpenSessions,
  requestTestChallenge,
  type TestOpenSession,
} from '../../services/testMode';
import type { VerifiedSessionInfo } from './QRScanner';

interface TestModePanelProps {
  /** True while the face model is still loading. */
  disabled: boolean;
  onChallenge: (info: VerifiedSessionInfo) => void;
}

const REFRESH_MS = 2_000;

/**
 * Test-only replacement for the QR step. It lists the open sessions of the
 * listed test courses this student belongs to and starts the face scan directly.
 */
export default function TestModePanel({ disabled, onChallenge }: TestModePanelProps) {
  const [sessions, setSessions] = useState<TestOpenSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startingId, setStartingId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const next = await fetchTestOpenSessions(controller.signal);
      if (controller.signal.aborted) return;
      setSessions(next);
      setError('');
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(apiErrorMessage(caught, 'โหลดรายการคาบทดสอบไม่สำเร็จ'));
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, REFRESH_MS);
    // Refresh at once when the student comes back to the tab or the phone wakes up.
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      controllerRef.current?.abort();
    };
  }, [load]);

  const start = async (sessionId: string) => {
    setStartingId(sessionId);
    setError('');
    try {
      onChallenge(await requestTestChallenge(sessionId));
    } catch (caught) {
      setError(apiErrorMessage(caught, 'ขอสิทธิ์สแกนใบหน้าไม่สำเร็จ'));
    } finally {
      setStartingId(null);
    }
  };

  return (
    <section
      className="rounded-3xl border-2 border-red-300 bg-red-50 p-[clamp(1rem,5vw,1.5rem)] shadow-sm"
      aria-labelledby="test-mode-title"
    >
      <p className="flex items-center gap-2 text-xs font-bold tracking-wide text-red-700">
        <FlaskConical aria-hidden="true" size={16} />
        TEST MODE: ไม่ต้องสแกน QR และไม่มีตัวจับเวลา
      </p>
      <h2 id="test-mode-title" className="mt-2 text-[clamp(1.2rem,5.5vw,1.5rem)] font-black leading-tight text-slate-900">
        คาบทดสอบที่เปิดอยู่
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        เมื่ออาจารย์เปิดคาบของวิชาที่คุณเป็นสมาชิก จะแสดงที่นี่ กดเพื่อเริ่มสแกนใบหน้าได้ทันที
        ระบบตรวจบุคคลจริงและเทียบใบหน้ายังทำงานตามปกติ เช็คชื่อซ้ำได้ไม่จำกัด
        และผลทุกครั้ง (สำเร็จ/ไม่สำเร็จ พร้อมคะแนนความเหมือนและเหตุผล) ถูกบันทึกในตารางผลทดสอบ
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {sessions.map((session) => (
          <li
            key={session.sessionId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">
                {session.courseCode || 'รายวิชา'} {session.courseName}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void start(session.sessionId); }}
              disabled={disabled || startingId !== null}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-bold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {startingId === session.sessionId
                ? <Loader2 className="animate-spin" size={18} aria-hidden="true" />
                : <ScanFace size={18} aria-hidden="true" />}
              เริ่มสแกนใบหน้า
            </button>
          </li>
        ))}
        {!loading && sessions.length === 0 && !error && (
          <li className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">
            ยังไม่มีคาบที่เปิดอยู่ในวิชาที่คุณเป็นสมาชิก
          </li>
        )}
      </ul>

      <button
        type="button"
        onClick={() => { void load(); }}
        className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-600 underline underline-offset-2"
      >
        <RefreshCw size={16} aria-hidden="true" /> รีเฟรชรายการ
      </button>
    </section>
  );
}
