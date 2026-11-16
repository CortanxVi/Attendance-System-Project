/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register';
import {
  CHUNK_RELOAD_KEY,
  UPDATE_CHECK_EVERY_MS,
  appUpdateGate,
  shouldReloadAfterChunkError,
} from './updateGate';

/**
 * Service-worker registration with deferred reloads (2026-11-15: a phone kept running an old cached
 * build for a whole test round). The service worker itself still activates at once (skipWaiting +
 * clientsClaim, registerType 'autoUpdate'), so even pages of OLD builds load the new one on their
 * next launch. On pages of this build:
 *  - the server is asked for a new build every few minutes and whenever the page becomes visible;
 *  - when a new build took over, the page reloads, but never during a scan or a check-in upload
 *    (those screens hold `appUpdateGate`; the reload runs when they close).
 */
export { appUpdateGate };

function readChunkReloadAt(): number | null {
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

function writeChunkReloadAt(nowMs: number): void {
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(nowMs));
  } catch {
    // Without storage the guard cannot work, so the reload is skipped below.
  }
}

/** Reload once (loop-guarded) when a lazily loaded file of this build is gone after an update. */
function handleChunkLoadError(event: Event): void {
  const now = Date.now();
  if (!shouldReloadAfterChunkError(readChunkReloadAt(), now)) return;
  writeChunkReloadAt(now);
  if (readChunkReloadAt() !== now) return; // no storage: never risk a loop
  event.preventDefault();
  // Mid-scan the reload waits for the hold like any other update.
  appUpdateGate.requestReload();
}

/** Hold reloads while a scan / upload is on screen; returns the release function. */
export function holdAppUpdates(): () => void {
  return appUpdateGate.hold();
}

export function registerAppServiceWorker(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', handleChunkLoadError);
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onNeedReload() {
      appUpdateGate.requestReload();
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine === false || registration.installing) return;
        void registration.update().catch(() => undefined);
      };
      window.setInterval(check, UPDATE_CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}
