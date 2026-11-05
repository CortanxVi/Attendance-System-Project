import { useCallback, useRef, useState } from 'react';

// The Document Picture-in-Picture API is not in TypeScript's DOM typings yet.
interface DocumentPipApi {
  window: Window | null;
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
}

function getDocumentPipApi(): DocumentPipApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { documentPictureInPicture?: DocumentPipApi }).documentPictureInPicture;
  return api ?? null;
}

interface OpenOptions {
  width: number;
  height: number;
  title: string;
}

/**
 * Opens a small always-on-top window that the user can drag anywhere.
 * Supported by Chromium browsers (Chrome, Edge) on desktop only.
 */
export function useDocumentPip() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const windowRef = useRef<Window | null>(null);
  const supported = getDocumentPipApi() !== null;

  const open = useCallback(async ({ width, height, title }: OpenOptions) => {
    const api = getDocumentPipApi();
    if (!api) throw new Error('Document Picture-in-Picture is not supported');
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.focus();
      return;
    }

    // Must be called straight from a click handler (browser "user gesture" rule).
    const created = await api.requestWindow({ width, height });
    created.document.title = title;
    created.document.body.style.margin = '0';
    created.document.body.style.fontFamily = 'system-ui, sans-serif';
    created.addEventListener('pagehide', () => {
      if (windowRef.current === created) windowRef.current = null;
      setPipWindow((current) => (current === created ? null : current));
    });
    windowRef.current = created;
    setPipWindow(created);
  }, []);

  const close = useCallback(() => {
    windowRef.current?.close();
  }, []);

  return { supported, pipWindow, open, close };
}
