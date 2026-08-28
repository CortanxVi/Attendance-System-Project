import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

type NotificationKind = 'success' | 'info' | 'error';

interface NotificationItem {
  id: number;
  message: string;
  kind: NotificationKind;
}

interface NotificationContextValue {
  notify: (message: string, kind?: NotificationKind) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const nextId = useRef(1);
  const recentMessages = useRef(new Map<string, number>());

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback((message: string, kind: NotificationKind = 'info') => {
    const now = Date.now();
    const key = `${kind}:${message}`;
    if (now - (recentMessages.current.get(key) ?? 0) < 2000) return;
    recentMessages.current.set(key, now);

    const id = nextId.current++;
    setItems((current) => [...current.slice(-3), { id, message, kind }]);
    if (kind !== 'error') {
      window.setTimeout(() => dismiss(id), 5000);
    }
  }, [dismiss]);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        style={{ zIndex: 'var(--z-toast)' }}
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((item) => {
          const Icon = item.kind === 'success' ? CheckCircle2 : item.kind === 'error' ? TriangleAlert : Info;
          const tone = item.kind === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : item.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-blue-200 bg-blue-50 text-blue-900';
          return (
            <div
              key={item.id}
              role={item.kind === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-lg ${tone}`}
            >
              <Icon className="mt-0.5 shrink-0" size={18} />
              <p className="flex-1 text-sm font-medium leading-5">{item.message}</p>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded-md p-1 hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current"
                aria-label="ปิดการแจ้งเตือน"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotification must be used inside NotificationProvider');
  return context;
}
