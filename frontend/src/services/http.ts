import axios from 'axios';
import {
  needsNgrokBrowserWarningBypass,
  normalizeApiOrigin,
} from '../config/apiOrigin';

const apiOrigin = normalizeApiOrigin(
  import.meta.env.VITE_API_ORIGIN,
  import.meta.env.PROD,
);
const bypassNgrokBrowserWarning = needsNgrokBrowserWarningBypass(apiOrigin);

// Keep relative /api paths for local/reverse-proxy deployments. A cloud-hosted
// frontend may instead send them directly to the Mini PC's public HTTPS origin.
if (apiOrigin) axios.defaults.baseURL = apiOrigin;

let interceptorInstalled = false;
let temporaryAdminGrantToken: string | null = null;
let authAccessToken: string | null = null;

/** Keep the current Supabase access token in memory to avoid auth-lock re-entry. */
export function setAuthAccessToken(token: string | null) {
  authAccessToken = token;
}

/** Keep elevated credentials in memory only; never persist them in browser storage. */
export function setTemporaryAdminGrantToken(token: string | null) {
  temporaryAdminGrantToken = token;
}

/**
 * Attach the current Supabase access token to every backend API request.
 * The backend validates this token again and never trusts the browser role.
 */
export function installAuthInterceptor() {
  if (interceptorInstalled) return;
  interceptorInstalled = true;

  axios.interceptors.request.use((config) => {
    if (!config.url?.startsWith('/api/')) return config;

    if (bypassNgrokBrowserWarning) {
      config.headers.set('ngrok-skip-browser-warning', '1');
    }
    if (authAccessToken) {
      config.headers.set('Authorization', `Bearer ${authAccessToken}`);
    }
    if (temporaryAdminGrantToken) {
      config.headers.set('X-Admin-Grant', temporaryAdminGrantToken);
    }
    return config;
  });
}
