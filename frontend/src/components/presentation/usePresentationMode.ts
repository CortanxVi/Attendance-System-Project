import { useCallback, useEffect, useRef, useState } from 'react';

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function usePresentationMode<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const [fallbackActive, setFallbackActive] = useState(false);
  const [nativeActive, setNativeActive] = useState(false);
  const isActive = nativeActive || fallbackActive;

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreenDocument = document as FullscreenDocument;
      const fullscreenElement = document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement;
      setNativeActive(fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    if (!fallbackActive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFallbackActive(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [fallbackActive]);

  const exit = useCallback(async () => {
    setFallbackActive(false);
    const fullscreenDocument = document as FullscreenDocument;
    const fullscreenElement = document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement;
    if (fullscreenElement === containerRef.current) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else await fullscreenDocument.webkitExitFullscreen?.();
    }
  }, []);

  const toggle = useCallback(async () => {
    if (isActive) {
      await exit();
      return;
    }

    const element = containerRef.current as FullscreenElement | null;
    if (!element) return;
    try {
      if (element.requestFullscreen) await element.requestFullscreen();
      else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
      else setFallbackActive(true);
    } catch {
      setFallbackActive(true);
    }
  }, [exit, isActive]);

  return { containerRef, isActive, toggle, exit };
}
