import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalIsolation } from './useModalIsolation';

interface TextPromptDialogProps {
  open: boolean;
  title: string;
  description: string;
  label: string;
  value: string;
  maxLength?: number;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function TextPromptDialog({
  open,
  title,
  description,
  label,
  value,
  maxLength = 500,
  confirmLabel,
  busy = false,
  error = '',
  onChange,
  onConfirm,
  onCancel,
}: TextPromptDialogProps) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelCallbackRef = useRef(onCancel);
  const titleId = useId();
  const descriptionId = useId();
  const fieldId = useId();
  const errorId = useId();

  useModalIsolation(open);

  useEffect(() => { cancelCallbackRef.current = onCancel; }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        cancelCallbackRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-4" style={{ zIndex: 'var(--z-confirmation)' }}>
      <button type="button" aria-label="ปิดหน้าต่างยืนยัน" onClick={() => { if (!busy) onCancel(); }} className="absolute inset-0 bg-slate-950/60" />
      <form
        ref={dialogRef}
        noValidate
        onSubmit={(event) => { event.preventDefault(); onConfirm(); }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6"
      >
        <h2 id={titleId} className="text-xl font-bold text-gray-900">{title}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-gray-600">{description}</p>
        <label htmlFor={fieldId} className="mt-4 block text-sm font-semibold text-gray-800">{label}</label>
        <textarea
          ref={textareaRef}
          id={fieldId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          rows={4}
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 w-full resize-none rounded-xl border border-gray-300 p-3 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:bg-gray-100"
        />
        {error && <p id={errorId} role="alert" className="mt-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">ยกเลิก</button>
          <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'กำลังดำเนินการ…' : confirmLabel}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
