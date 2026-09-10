import { createContext, useContext } from 'react';

export type NotificationKind = 'success' | 'info' | 'error';

export interface NotificationContextValue {
  notify: (message: string, kind?: NotificationKind) => void;
}

export const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotification(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotification must be used inside NotificationProvider');
  return context;
}
