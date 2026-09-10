import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setTemporaryAdminGrantToken } from '../services/http';
import { TemporaryAdminContext } from './temporaryAdminState';

export function TemporaryAdminProvider({ children }: { children: ReactNode }) {
  const [grant, setGrant] = useState<{ token: string; expiresAt: string } | null>(null);

  const clear = useCallback(() => {
    setTemporaryAdminGrantToken(null);
    setGrant(null);
  }, []);

  const activate = useCallback((token: string, expiresAt: string) => {
    if (new Date(expiresAt).getTime() <= Date.now()) {
      setTemporaryAdminGrantToken(null);
      setGrant(null);
      return;
    }
    setTemporaryAdminGrantToken(token);
    setGrant({ token, expiresAt });
  }, []);

  useEffect(() => {
    if (!grant) return;
    const delay = new Date(grant.expiresAt).getTime() - Date.now();
    if (delay <= 0) {
      const expiredTimer = window.setTimeout(clear, 0);
      return () => window.clearTimeout(expiredTimer);
    }
    const timer = window.setTimeout(clear, delay);
    return () => window.clearTimeout(timer);
  }, [grant, clear]);

  const value = useMemo(() => ({
    active: grant !== null,
    expiresAt: grant?.expiresAt ?? null,
    activate,
    clear,
  }), [grant, activate, clear]);

  return <TemporaryAdminContext.Provider value={value}>{children}</TemporaryAdminContext.Provider>;
}
