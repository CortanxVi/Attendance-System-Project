import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { TeacherAttendanceContext, type ActiveTeacherSession, type AttendancePanel } from './teacherAttendanceState';
import { useNotification } from '../components/notifications/notificationContext';
import { useDocumentPip } from '../hooks/useDocumentPip';
import { buildQrPayload, useQrTokenRotation } from '../hooks/useQrTokenRotation';
import FloatingQrWindow from '../features/teacher/FloatingQrWindow';
import { apiErrorMessage } from '../services/apiError';
import { autoCloseDeadlineMs, normalizeLateThresholdMinutes } from '../utils/sessionDeadline';

const AUTO_CLOSE_RETRY_MS = 10_000;
// setTimeout cannot wait longer than ~24.8 days; cap it so very old sessions still work.
const MAX_TIMER_MS = 2_000_000_000;

interface ActiveSessionResponse {
  session: ActiveTeacherSession | null;
}

export function TeacherAttendanceProvider({ children }: { children: ReactNode }) {
  const [activeSession, setActiveSession] = useState<ActiveTeacherSession | null>(null);
  const [activePanel, setActivePanel] = useState<AttendancePanel>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [autoCloseAt, setAutoCloseAt] = useState<number | null>(null);
  const { notify } = useNotification();
  const { supported: pipSupported, pipWindow, open: openPipWindow, close: closePipWindow } = useDocumentPip();
  const requestController = useRef<AbortController | null>(null);
  const mutationInFlight = useRef(false);

  const applyActiveSession = useCallback((session: ActiveTeacherSession | null) => {
    setActiveSession(session);
    setAutoCloseAt(session
      ? autoCloseDeadlineMs(session.elapsed_seconds, session.late_threshold_minutes, Date.now())
      : null);
  }, []);

  const refreshActiveSession = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const response = await axios.get<ActiveSessionResponse>('/api/v1/sessions/active', {
        signal: controller.signal,
      });
      applyActiveSession(response.data.session);
      if (!response.data.session) setActivePanel(null);
      setRecoveryError('');
    } catch (error) {
      if (!axios.isCancel(error)) {
        setRecoveryError('ไม่สามารถตรวจสอบคาบเรียนที่เปิดอยู่ได้ กรุณาลองรีเฟรชอีกครั้ง');
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setLoading(false);
      }
    }
  }, [applyActiveSession]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => { void refreshActiveSession(); }, 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshActiveSession();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearTimeout(initialTimer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      requestController.current?.abort();
    };
  }, [refreshActiveSession]);

  const startSession = useCallback(async (course: { id: string; course_code: string; course_name: string; section?: number | null }) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setMutating(true);
    try {
      const response = await axios.post<{ session?: ActiveTeacherSession; session_id: string }>('/api/v1/sessions/start', {
        course_id: course.id,
      });
      applyActiveSession(response.data.session ?? {
        id: response.data.session_id,
        course_id: course.id,
        course_code: course.course_code,
        course_name: course.course_name,
        section: course.section,
        status: 'open',
      });
      setActivePanel('qr');
      setRecoveryError('');
    } finally {
      mutationInFlight.current = false;
      setMutating(false);
    }
  }, [applyActiveSession]);

  const closeSession = useCallback(async () => {
    if (!activeSession || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setMutating(true);
    try {
      await axios.post(`/api/v1/sessions/${activeSession.id}/close`);
      applyActiveSession(null);
      setActivePanel(null);
      setRecoveryError('');
    } finally {
      mutationInFlight.current = false;
      setMutating(false);
    }
  }, [activeSession, applyActiveSession]);

  // --- Shared QR token: rotates while the QR dialog or the floating window is showing ---
  const qrNeeded = Boolean(activeSession) && (activePanel === 'qr' || pipWindow !== null);
  const { token: qrToken, error: qrError } = useQrTokenRotation(activeSession?.id ?? null, qrNeeded);

  // --- Floating window: only while a session is open ---
  const openQrPip = useCallback(async (): Promise<boolean> => {
    if (!activeSession) return false;
    try {
      await openPipWindow({ width: 300, height: 380, title: `QR Code ${activeSession.course_code}` });
      return true;
    } catch (error: unknown) {
      notify(apiErrorMessage(error, 'ไม่สามารถเปิดหน้าต่างลอยได้ กรุณาใช้ Chrome หรือ Edge บนคอมพิวเตอร์'), 'error');
      return false;
    }
  }, [activeSession, notify, openPipWindow]);

  useEffect(() => {
    if (!activeSession) closePipWindow();
  }, [activeSession, closePipWindow]);

  // --- Auto-close when the course's late window ends ---
  const refreshRef = useRef(refreshActiveSession);
  useEffect(() => {
    refreshRef.current = refreshActiveSession;
  }, [refreshActiveSession]);

  const autoCloseSessionId = activeSession?.id ?? null;
  const autoCloseMinutes = activeSession ? normalizeLateThresholdMinutes(activeSession.late_threshold_minutes) : null;
  useEffect(() => {
    if (!autoCloseSessionId || autoCloseAt === null) return;
    let cancelled = false;
    let timer: number | undefined;

    const attempt = async () => {
      const wait = autoCloseAt - Date.now();
      if (wait > 0) {
        timer = window.setTimeout(() => { void attempt(); }, Math.min(wait, MAX_TIMER_MS));
        return;
      }
      try {
        await axios.post(`/api/v1/sessions/${autoCloseSessionId}/close`);
        // Closed on the server, so always clear local state even if this effect was replaced mid-request.
        applyActiveSession(null);
        setActivePanel(null);
        if (!cancelled) notify(`ครบ ${autoCloseMinutes} นาทีตามเกณฑ์สาย ระบบปิดการเช็คชื่ออัตโนมัติแล้ว`, 'info');
      } catch {
        if (cancelled) return;
        // Maybe it was already closed elsewhere: re-read the server state, then try again if still open.
        await refreshRef.current();
        timer = window.setTimeout(() => { void attempt(); }, AUTO_CLOSE_RETRY_MS);
      }
    };

    void attempt();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [autoCloseSessionId, autoCloseAt, autoCloseMinutes, applyActiveSession, notify]);

  const value = useMemo(() => ({
    activeSession,
    activePanel,
    loading,
    mutating,
    recoveryError,
    autoCloseMinutes,
    qrToken,
    qrError,
    pipSupported,
    pipOpen: pipWindow !== null,
    openQrPip,
    closeQrPip: closePipWindow,
    refreshActiveSession,
    startSession,
    closeSession,
    setActivePanel,
  }), [activeSession, activePanel, loading, mutating, recoveryError, autoCloseMinutes, qrToken, qrError, pipSupported, pipWindow, openQrPip, closePipWindow, refreshActiveSession, startSession, closeSession]);

  return (
    <TeacherAttendanceContext.Provider value={value}>
      {children}
      {pipWindow && activeSession && createPortal(
        <FloatingQrWindow
          courseCode={activeSession.course_code}
          courseName={activeSession.course_name}
          qrValue={buildQrPayload(activeSession.id, qrToken)}
          hasToken={Boolean(qrToken)}
          error={qrError}
        />,
        pipWindow.document.body,
      )}
    </TeacherAttendanceContext.Provider>
  );
}
