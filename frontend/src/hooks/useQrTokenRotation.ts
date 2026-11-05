import { useEffect, useState } from 'react';
import axios from 'axios';
import { apiErrorMessage } from '../services/apiError';

const DEFAULT_REFRESH_SECONDS = 12;
const RETRY_AFTER_ERROR_MS = 5000;

interface TokenState {
  sessionId: string;
  token: string;
  error: string | null;
}

/** The text encoded in the QR image; students' scanners expect exactly this shape. */
export function buildQrPayload(sessionId: string, token: string): string {
  return JSON.stringify({ session_id: sessionId, token });
}

/**
 * Keeps one fresh QR token for an open session.
 *
 * Every rotation invalidates the previous token on the server, so only ONE place
 * in the app may run this hook at a time. The teacher workspace provider owns it
 * and shares the token with the QR dialog and the floating window.
 */
export function useQrTokenRotation(sessionId: string | null, enabled: boolean) {
  const [state, setState] = useState<TokenState | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) return;
    let cancelled = false;
    let timer: number | undefined;

    const rotate = async () => {
      try {
        const response = await axios.post(`/api/v1/sessions/${sessionId}/rotate-token`);
        if (cancelled) return;
        setState({ sessionId, token: String(response.data.qr_token ?? ''), error: null });
        const seconds = Number(response.data.qr_refresh_rate_seconds) || DEFAULT_REFRESH_SECONDS;
        timer = window.setTimeout(() => { void rotate(); }, seconds * 1000);
      } catch (error: unknown) {
        if (cancelled) return;
        const message = apiErrorMessage(error, 'ไม่สามารถสุ่มค่า token QR Code ใหม่ได้ กรุณาลองใหม่');
        setState((current) => ({
          sessionId,
          token: current?.sessionId === sessionId ? current.token : '',
          error: message,
        }));
        timer = window.setTimeout(() => { void rotate(); }, RETRY_AFTER_ERROR_MS);
      }
    };

    void rotate();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // Forget the token so a reopened view never flashes an already-replaced QR.
      setState(null);
    };
  }, [sessionId, enabled]);

  const current = state && state.sessionId === sessionId && enabled ? state : null;
  return { token: current?.token ?? '', error: current?.error ?? null };
}
