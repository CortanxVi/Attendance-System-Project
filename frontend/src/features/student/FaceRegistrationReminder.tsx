import { useEffect, useId, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ScanFace, X } from 'lucide-react';

export const FACE_REMINDER_TITLE = 'คุณยังไม่ได้ลงทะเบียนใบหน้า';
export const FACE_REMINDER_TEXT = 'ก่อนเริ่มเช็คชื่อเข้าเรียน ขอให้ลงทะเบียนใบหน้าไว้สักครั้งก่อน ใช้เวลาไม่ถึงนาที '
  + 'เพียงไปที่หน้าโปรไฟล์ แล้วกดปุ่ม “ลงทะเบียนใบหน้า” ในแถบการสแกนใบหน้า';
export const FACE_REMINDER_ACTION_LABEL = 'ไปที่หน้าโปรไฟล์';
export const FACE_REMINDER_CLOSE_LABEL = 'ปิดการแจ้งเตือน';
/** Router state that asks the profile page to highlight the face-scan row. */
const HIGHLIGHT_FACE_ROW_STATE = { highlightFaceRow: true } as const;

// Closing with X hides the reminder until the browser tab is closed or the person signs in again
// (sessionStorage), so a first login or the next visit reminds them again.
const DISMISS_KEY = 'face-registration-reminder-dismissed.v1';
// Pages where the reminder would only repeat what is already on screen.
const HIDDEN_ON = ['/student/profile', '/student/register'];

function readDismissed(): boolean {
  try { return window.sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

function writeDismissed(): void {
  try { window.sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode: state only */ }
}

/**
 * Shown on the student pages while the account has no registered face. It points to the profile
 * page, where the face-scan row blinks so the "ลงทะเบียนใบหน้า" button is easy to find.
 */
export default function FaceRegistrationReminder() {
  const location = useLocation();
  const navigate = useNavigate();
  const titleId = useId();
  // null = not known yet (never show a reminder before the profile says so).
  const [faceRegistered, setFaceRegistered] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const hiddenHere = HIDDEN_ON.includes(location.pathname);

  useEffect(() => {
    // Ask again on page changes while unregistered, so the reminder disappears right after enrolment.
    if (faceRegistered === true || dismissed) return;
    const controller = new AbortController();
    axios.get('/api/v1/students/me/profile', { signal: controller.signal })
      .then((response) => setFaceRegistered(Boolean(response.data?.profile?.face_registered)))
      .catch(() => { /* a failed load shows nothing; the profile page reports its own errors */ });
    return () => controller.abort();
  }, [location.pathname, faceRegistered, dismissed]);

  if (faceRegistered !== false || dismissed || hiddenHere) return null;

  const close = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      data-testid="face-registration-reminder"
      className="relative mx-[clamp(0.75rem,4vw,1.25rem)] mt-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 pr-12 shadow-sm"
    >
      <button
        type="button"
        onClick={close}
        aria-label={FACE_REMINDER_CLOSE_LABEL}
        title={FACE_REMINDER_CLOSE_LABEL}
        className="absolute right-1.5 top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
      >
        <X size={20} aria-hidden="true" />
      </button>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700" aria-hidden="true">
          <ScanFace />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-bold text-amber-950">{FACE_REMINDER_TITLE}</h2>
          <p className="mt-1 text-sm leading-6 text-amber-900">{FACE_REMINDER_TEXT}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate('/student/profile', { state: HIGHLIGHT_FACE_ROW_STATE })}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 font-bold text-white hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2"
      >
        {FACE_REMINDER_ACTION_LABEL}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}
