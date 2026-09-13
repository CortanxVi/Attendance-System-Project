import { createContext, useContext } from 'react';

export interface ActiveTeacherSession {
  id: string;
  course_id: string;
  course_code: string;
  course_name: string;
  section?: number | null;
  created_at?: string | null;
  status: 'open';
}

export type AttendancePanel = 'qr' | 'nfc' | null;

export interface TeacherAttendanceContextValue {
  activeSession: ActiveTeacherSession | null;
  activePanel: AttendancePanel;
  loading: boolean;
  mutating: boolean;
  recoveryError: string;
  refreshActiveSession: () => Promise<void>;
  startSession: (course: { id: string; course_code: string; course_name: string; section?: number | null }) => Promise<void>;
  closeSession: () => Promise<void>;
  setActivePanel: (panel: AttendancePanel) => void;
}

export const TeacherAttendanceContext = createContext<TeacherAttendanceContextValue | null>(null);

export function useTeacherAttendance(): TeacherAttendanceContextValue {
  const context = useContext(TeacherAttendanceContext);
  if (!context) throw new Error('useTeacherAttendance must be used inside TeacherAttendanceProvider');
  return context;
}
