import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setTemporaryAdminGrantToken } from '../services/http';

interface TemporaryAdminContextValue {
  active: boolean;
  expiresAt: string | null;
  activate: (token: string, expiresAt: string) => void;
  clear: () => void;
}

const TemporaryAdminContext = createContext<TemporaryAdminContextValue | null>(null);

export function TemporaryAdminProvider({ children }: { children: ReactNode }) {
  const [grant, setGrant] = useState<{ token: string; expiresAt: string } | null>(null);

  const clear = useCallback(() => {
    setTemporaryAdminGrantToken(null);
    setGrant(null);
  }, []);

  const activate = useCallback((token: string, expiresAt: string) => {
    setTemporaryAdminGrantToken(token);
    setGrant({ token, expiresAt });
  }, []);

  useEffect(() => {
    if (!grant) return;
    const delay = new Date(grant.expiresAt).getTime() - Date.now();
    if (delay <= 0) {
      clear();
      return;
    }
    const timer = window.setTimeout(clear, delay);
    return () => window.clearTimeout(timer);
  }, [grant, clear]);

  const value = useMemo(() => ({
    active: Boolean(grant && new Date(grant.expiresAt).getTime() > Date.now()),
    expiresAt: grant?.expiresAt ?? null,
    activate,
    clear,
  }), [grant, activate, clear]);

  return <TemporaryAdminContext.Provider value={value}>{children}</TemporaryAdminContext.Provider>;
}

export function useTemporaryAdmin(): TemporaryAdminContextValue {
  const context = useContext(TemporaryAdminContext);
  if (!context) throw new Error('useTemporaryAdmin must be used inside TemporaryAdminProvider');
  return context;
}
