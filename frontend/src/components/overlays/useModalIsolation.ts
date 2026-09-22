import { useEffect } from 'react';

/**
 * Isolate a document-level modal from the application root.
 *
 * Portal dialogs live next to #root, so making #root inert prevents the
 * underlying shell from receiving focus or pointer input while the dialog is
 * active. Previous values are preserved to keep nested portal dialogs safe.
 */
export function useModalIsolation(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const appRoot = document.getElementById('root');
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const rootWasInert = appRoot?.inert ?? false;
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden') ?? null;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute('aria-hidden', 'true');
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      if (appRoot) {
        appRoot.inert = rootWasInert;
        if (previousAriaHidden === null) appRoot.removeAttribute('aria-hidden');
        else appRoot.setAttribute('aria-hidden', previousAriaHidden);
      }
    };
  }, [active]);
}
