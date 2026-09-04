import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

const DESKTOP_DRAWER_QUERY = '(min-width: 1024px)';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useResponsiveDrawer(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
) {
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktopMedia = window.matchMedia(DESKTOP_DRAWER_QUERY);
    if (!open || desktopMedia.matches) return;

    const previousOverflow = document.body.style.overflow;
    const restoreFocusTarget = triggerRef.current;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.requestAnimationFrame(() => closeRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    desktopMedia.addEventListener('change', handleViewportChange);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      desktopMedia.removeEventListener('change', handleViewportChange);
      document.body.style.overflow = previousOverflow;
      restoreFocusTarget?.focus();
    };
  }, [open, setOpen]);

  return { drawerRef, triggerRef, closeRef };
}
