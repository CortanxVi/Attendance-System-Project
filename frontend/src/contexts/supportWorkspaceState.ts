import { createContext, useContext } from 'react';

export interface SupportReplyDraft {
  message: string;
  files: File[];
  clientToken: string;
  attempted: boolean;
}

export interface SupportWorkspaceContextValue {
  selectedRequestIds: Partial<Record<'student' | 'teacher', string>>;
  replyDrafts: Record<string, SupportReplyDraft>;
  selectRequest: (mode: 'student' | 'teacher', requestId: string | null) => void;
  saveReplyDraft: (requestId: string, draft: SupportReplyDraft) => void;
  clearReplyDraft: (requestId: string) => void;
}

export const SupportWorkspaceContext = createContext<SupportWorkspaceContextValue | null>(null);

export function useSupportWorkspace(): SupportWorkspaceContextValue {
  const context = useContext(SupportWorkspaceContext);
  if (!context) throw new Error('useSupportWorkspace must be used inside SupportWorkspaceProvider');
  return context;
}
