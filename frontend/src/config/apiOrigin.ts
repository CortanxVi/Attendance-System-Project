const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const NGROK_FREE_HOST_SUFFIXES = ['.ngrok-free.app', '.ngrok-free.dev'];

/**
 * Normalize the optional public FastAPI origin used by split deployments.
 * An empty value intentionally preserves the existing same-origin /api proxy.
 */
export function normalizeApiOrigin(rawValue: string | undefined, production: boolean): string {
  const value = rawValue?.trim() ?? '';
  if (!value) return '';

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('VITE_API_ORIGIN ต้องเป็น URL ต้นทางที่ถูกต้อง เช่น https://api.example.org');
  }

  if (
    parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('VITE_API_ORIGIN ต้องเป็น origin เท่านั้น ห้ามมี path, query, fragment หรือข้อมูลล็อกอิน');
  }

  if (production && parsed.protocol !== 'https:') {
    throw new Error('VITE_API_ORIGIN ของ Production ต้องใช้ HTTPS');
  }
  if (!production && parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('HTTP ใช้ได้เฉพาะ localhost ระหว่างพัฒนา; อุปกรณ์อื่นต้องใช้ HTTPS');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('VITE_API_ORIGIN รองรับเฉพาะ HTTP หรือ HTTPS');
  }

  return parsed.origin;
}

/**
 * Free ngrok browser traffic may receive an interstitial HTML page unless the
 * documented bypass header is present. Scope the header strictly to ngrok's
 * free development hostnames so it is never sent to a normal API origin.
 */
export function needsNgrokBrowserWarningBypass(apiOrigin: string): boolean {
  if (!apiOrigin) return false;

  try {
    const parsed = new URL(apiOrigin);
    return parsed.protocol === 'https:'
      && NGROK_FREE_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}
