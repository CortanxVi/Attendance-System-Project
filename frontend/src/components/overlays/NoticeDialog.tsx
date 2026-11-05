import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle } from 'lucide-react';
import { useModalIsolation } from './useModalIsolation';

interface NoticeDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Optional second line with specifics (for example which values did not match). */
  detail?: string;
  closeLabel?: string;
  onClose: () => void;
}

/**
 * One-button warning dialog. Use it when the user only needs to acknowledge a
 * problem (ConfirmDialog is for yes/no decisions).
 */
export default function NoticeDialog({
  open,
  title,
  description,
  detail,
  closeLabel = 'ตกลง',
  onClose,
}: NoticeDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalIsolation(open);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab') {
        // The only focusable control is the close button, so keep focus on it.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-4" style={{ zIndex: 'var(--z-confirmation)' }}>
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/60"
        aria-label="ปิดหน้าต่างแจ้งเตือน"
        onClick={onClose}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertCircle aria-hidden="true" size={22} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-bold text-gray-900">{title}</h2>
            <p id={descriptionId} className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600">{description}</p>
            {detail && (
              <p className="mt-3 break-words rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">{detail}</p>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-xl bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2"
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
