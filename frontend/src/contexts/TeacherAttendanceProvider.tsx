import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { TeacherAttendanceContext, type ActiveTeacherSession, type AttendancePanel } from './teacherAttendanceState';

interface ActiveSessionResponse {
  session: ActiveTeacherSession | null;
}

export function TeacherAttendanceProvider({ children }: { children: ReactNode }) {
  const [activeSession, setActiveSession] = useState<ActiveTeacherSession | null>(null);
  const [activePanel, setActivePanel] = useState<AttendancePanel>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const requestController = useRef<AbortController | null>(null);
  const mutationInFlight = useRef(false);

  const refreshActiveSession = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const response = await axios.get<ActiveSessionResponse>('/api/v1/sessions/active', {
        signal: controller.signal,
      });
      setActiveSession(response.data.session);
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
  }, []);

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
      setActiveSession(response.data.session ?? {
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
  }, []);

  const closeSession = useCallback(async () => {
    if (!activeSession || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setMutating(true);
    try {
      await axios.post(`/api/v1/sessions/${activeSession.id}/close`);
      setActiveSession(null);
      setActivePanel(null);
      setRecoveryError('');
    } finally {
      mutationInFlight.current = false;
      setMutating(false);
    }
  }, [activeSession]);

  const value = useMemo(() => ({
    activeSession,
    activePanel,
    loading,
    mutating,
    recoveryError,
    refreshActiveSession,
    startSession,
    closeSession,
    setActivePanel,
  }), [activeSession, activePanel, loading, mutating, recoveryError, refreshActiveSession, startSession, closeSession]);

  return <TeacherAttendanceContext.Provider value={value}>{children}</TeacherAttendanceContext.Provider>;
}
