import axios from 'axios';
import { supabase } from '../lib/supabaseClient';

let interceptorInstalled = false;
let temporaryAdminGrantToken: string | null = null;

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

  axios.interceptors.request.use(async (config) => {
    if (!config.url?.startsWith('/api/')) return config;

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      config.headers.set('Authorization', `Bearer ${session.access_token}`);
    }
    if (temporaryAdminGrantToken) {
      config.headers.set('X-Admin-Grant', temporaryAdminGrantToken);
    }
    return config;
  });
}
