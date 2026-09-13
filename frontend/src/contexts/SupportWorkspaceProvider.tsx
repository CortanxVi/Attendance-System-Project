import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { SupportWorkspaceContext, type SupportReplyDraft } from './supportWorkspaceState';

export function SupportWorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedRequestIds, setSelectedRequestIds] = useState<Partial<Record<'student' | 'teacher', string>>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, SupportReplyDraft>>({});

  const selectRequest = useCallback((mode: 'student' | 'teacher', requestId: string | null) => {
    setSelectedRequestIds((current) => {
      if (requestId) return { ...current, [mode]: requestId };
      const next = { ...current };
      delete next[mode];
      return next;
    });
  }, []);

  const saveReplyDraft = useCallback((requestId: string, draft: SupportReplyDraft) => {
    setReplyDrafts((current) => ({ ...current, [requestId]: draft }));
  }, []);

  const clearReplyDraft = useCallback((requestId: string) => {
    setReplyDrafts((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    selectedRequestIds,
    replyDrafts,
    selectRequest,
    saveReplyDraft,
    clearReplyDraft,
  }), [selectedRequestIds, replyDrafts, selectRequest, saveReplyDraft, clearReplyDraft]);

  return <SupportWorkspaceContext.Provider value={value}>{children}</SupportWorkspaceContext.Provider>;
}
