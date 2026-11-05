import { createContext, useContext } from 'react';

export interface ActiveTeacherSession {
  id: string;
  course_id: string;
  course_code: string;
  course_name: string;
  section?: number | null;
  created_at?: string | null;
  status: 'open';
  /** Course late threshold; the session closes automatically when it passes. */
  late_threshold_minutes?: number;
  /** Seconds the session had been open when the server answered. */
  elapsed_seconds?: number;
}

export type AttendancePanel = 'qr' | 'nfc' | null;

export interface TeacherAttendanceContextValue {
  activeSession: ActiveTeacherSession | null;
  activePanel: AttendancePanel;
  loading: boolean;
  mutating: boolean;
  recoveryError: string;
  /** Minutes after opening at which the session closes by itself (null = no open session). */
  autoCloseMinutes: number | null;
  /** Shared QR token; rotated in one place so the dialog and floating window never fight. */
  qrToken: string;
  qrError: string | null;
  pipSupported: boolean;
  pipOpen: boolean;
  openQrPip: () => Promise<boolean>;
  closeQrPip: () => void;
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
