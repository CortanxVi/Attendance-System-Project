import { createContext, useContext } from 'react';

export interface TemporaryAdminContextValue {
  active: boolean;
  expiresAt: string | null;
  activate: (token: string, expiresAt: string) => void;
  clear: () => void;
}

export const TemporaryAdminContext = createContext<TemporaryAdminContextValue | null>(null);

export function useTemporaryAdmin(): TemporaryAdminContextValue {
  const context = useContext(TemporaryAdminContext);
  if (!context) throw new Error('useTemporaryAdmin must be used inside TemporaryAdminProvider');
  return context;
}
