import { useState } from 'react';
import { Copy, ExternalLink, X } from 'lucide-react';
import { IN_APP_BROWSER_MESSAGE } from '../utils/inAppBrowser';

/** Advisory notice for in-app browsers: suggests Chrome or Safari, with a copy-link button. */
export default function InAppBrowserNotice({ onDismiss }: { onDismiss: () => void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <section
      role="note"
      aria-label="คำแนะนำเบราว์เซอร์"
      className="pointer-events-auto rounded-2xl border border-amber-300/60 bg-amber-50/95 p-3 text-sm text-amber-950 shadow-xl"
    >
      <div className="flex items-start gap-2">
        <ExternalLink aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
        <p className="flex-1 font-semibold leading-5">{IN_APP_BROWSER_MESSAGE}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
          aria-label="ปิดคำแนะนำเบราว์เซอร์"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
        <button
          type="button"
          onClick={() => void copyLink()}
          className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-amber-900 px-3 text-xs font-bold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
        >
          <Copy aria-hidden="true" size={14} />
          คัดลอกลิงก์
        </button>
        <span role="status" aria-live="polite" className="text-xs">
          {copyState === 'copied' && 'คัดลอกแล้ว นำไปวางใน Chrome หรือ Safari'}
          {copyState === 'failed' && 'คัดลอกไม่ได้ กรุณากดเมนูของแอปแล้วเลือกเปิดในเบราว์เซอร์'}
        </span>
      </div>
    </section>
  );
}
