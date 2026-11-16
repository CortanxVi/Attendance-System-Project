import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Glasses, ScanFace, Smartphone, Sun, Users, X, type LucideIcon } from 'lucide-react';
import { useModalIsolation } from '../../components/overlays/useModalIsolation';

/** The only button of the prep modal. The owner asked for this exact label. */
export const FACE_SCAN_PREP_ACK_LABEL = 'เข้าใจแล้ว';
/** Accessible name of the top-right X button that cancels the scan. */
export const FACE_SCAN_PREP_CANCEL_LABEL = 'ยกเลิกการสแกนใบหน้า';
export const FACE_SCAN_PREP_TITLE = 'ขั้นตอนการเตรียมตัวก่อนเริ่มสแกนใบหน้า';
export const FACE_SCAN_PREP_DESCRIPTION = 'ปฏิบัติตามขั้นตอนด้านล่างนี้ก่อนเริ่ม ระบบจะยังไม่เปิดกล้องจนกว่าคุณจะกด “เข้าใจแล้ว”';

// Wording follows CLEAR_FACE_ADVICE (utils/liveness.ts) and PAD_RETRY_CHECKLIST (utils/padFailure.ts).
const FACE_SCAN_PREP_TIPS: readonly { icon: LucideIcon; text: string }[] = Object.freeze([
  { icon: Sun, text: 'อยู่ในที่สว่าง หันหน้าเข้าหาแสง อย่าให้แสงจ้าอยู่ด้านหลัง' },
  { icon: ScanFace, text: 'เก็บผมให้เรียบร้อย เปิดหน้าผาก คิ้วและตาให้เห็นชัด' },
  { icon: Glasses, text: 'ถอดหน้ากากและแว่นกันแดด ถ้าแว่นมีความสะท้อนแสงมากให้ถอดก่อน' },
  { icon: Smartphone, text: 'ถือโทรศัพท์ระดับสายตา ห่างจากใบหน้าประมาณ 30–40 ซม. และถือนิ่ง ๆ' },
  { icon: Users, text: 'ให้มีใบหน้าของคุณคนเดียวในกรอบ' },
]);

const FACE_SCAN_PREP_STEPS: readonly string[] = Object.freeze([
  'มองตรงที่กล้องนิ่ง ๆ สักครู่',
  'ทำตามคำสั่งบนจอ 1 อย่าง เช่น หลับตาทั้งสองข้าง 1 วินาทีแล้วลืมตาให้สุด หรือขยับเข้าใกล้กล้องเล็กน้อย',
  'กลับมาอยู่ท่าเดิมและมองตรง จนระบบบันทึกเสร็จ',
]);

interface FaceScanPrepGateProps {
  /** The scanner. It is NOT mounted (no camera, no worker, no attempt timer) until the user acknowledges. */
  children: ReactNode;
  /**
   * Leaves the scan step (the person is not ready). The top-right X button and Escape call it.
   * Without it the X button is not shown and Escape is ignored; neither ever starts the scan.
   */
  onCancel?: () => void;
}

/**
 * Shows the "prepare yourself" modal every time a face scan is about to start. Each new mount
 * shows it again (no "don't show again"). Only the "เข้าใจแล้ว" button lets the children mount.
 */
export default function FaceScanPrepGate({ children, onCancel }: FaceScanPrepGateProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const ackRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalIsolation(!acknowledged);

  useEffect(() => {
    if (acknowledged) return;
    ackRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Escape must never start the scan silently.
        event.preventDefault();
        onCancel?.();
        return;
      }
      if (event.key !== 'Tab') return;
      // Keep focus inside the dialog: Tab / Shift+Tab move between the X and the acknowledge button.
      event.preventDefault();
      const focusable = [cancelRef.current, ackRef.current].filter((item): item is HTMLButtonElement => item !== null);
      const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.shiftKey ? -1 : 1;
      focusable[(index + step + focusable.length) % focusable.length]?.focus();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [acknowledged, onCancel]);

  if (acknowledged) return <>{children}</>;

  const dialog = (
    <div
      className="fixed inset-0 flex items-center justify-center bg-slate-950/70 p-3 sm:p-4"
      style={{ zIndex: 'var(--z-dialog)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6"
      >
        {onCancel && (
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            aria-label={FACE_SCAN_PREP_CANCEL_LABEL}
            title={FACE_SCAN_PREP_CANCEL_LABEL}
            className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <X size={22} aria-hidden="true" />
          </button>
        )}
        <h2 id={titleId} className="pr-10 text-lg font-bold text-gray-900 sm:text-xl">{FACE_SCAN_PREP_TITLE}</h2>
        <p id={descriptionId} className="mt-1 text-sm leading-6 text-gray-600">{FACE_SCAN_PREP_DESCRIPTION}</p>

        <ul className="mt-4 space-y-2">
          {FACE_SCAN_PREP_TIPS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 rounded-xl bg-orange-50 px-3 py-2 text-sm leading-6 text-gray-800">
              <Icon size={20} className="mt-0.5 shrink-0 text-orange-600" aria-hidden="true" />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-5 text-sm font-bold text-gray-900">สิ่งที่จะเกิดขึ้น</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-gray-700">
          {FACE_SCAN_PREP_STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>

        <button
          ref={ackRef}
          type="button"
          onClick={() => setAcknowledged(true)}
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-600 px-5 font-bold text-white hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2"
        >
          {FACE_SCAN_PREP_ACK_LABEL}
        </button>
      </div>
    </div>
  );

  // The server renderer (used by the Node test) has no document and no portals.
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
