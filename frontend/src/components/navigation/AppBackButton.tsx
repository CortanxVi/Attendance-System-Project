import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function AppBackButton({
  fallbackPath,
  label = 'ย้อนกลับ',
  tone = 'orange',
}: {
  fallbackPath: string;
  label?: string;
  tone?: 'orange' | 'red';
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const canUseBrowserHistory = Number(window.history.state?.idx ?? 0) > 0;
  const atFallback = location.pathname === fallbackPath;

  const goBack = () => {
    if (canUseBrowserHistory) navigate(-1);
    else if (!atFallback) navigate(fallbackPath, { replace: true });
  };

  const ring = tone === 'red' ? 'focus-visible:ring-red-400' : 'focus-visible:ring-orange-400';
  return (
    <button
      type="button"
      onClick={goBack}
      disabled={!canUseBrowserHistory && atFallback}
      aria-label={label}
      className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-35 ${ring}`}
    >
      <ArrowLeft aria-hidden="true" size={20} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
