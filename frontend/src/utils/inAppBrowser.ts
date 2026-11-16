/**
 * In-app browsers (Facebook, Messenger, LINE, Instagram, WeChat, TikTok) often give the page a
 * throttled camera or no WebGL/WASM threads, which makes the face scan slow or inaccurate. The
 * scanner shows an advisory notice asking the person to open the link in Chrome or Safari; it never
 * blocks the scan.
 */
export type InAppBrowser = 'facebook' | 'line' | 'instagram' | 'wechat' | 'tiktok';

const PATTERNS: ReadonlyArray<[InAppBrowser, RegExp]> = [
  // Instagram's UA also carries FBAN/FBAV on some builds, so it is checked first.
  ['instagram', /\bInstagram\b/i],
  ['facebook', /\bFB_IAB\b|\bFBAN\/|\bFBAV\/|\bFBIOS\b/],
  ['line', /\bLine\/\d/],
  ['wechat', /\bMicroMessenger\//i],
  ['tiktok', /\bTikTok\b|\bmusical_ly|\bBytedanceWebview\b/i],
];

export function detectInAppBrowser(userAgent: string | null | undefined): InAppBrowser | null {
  if (!userAgent) return null;
  for (const [name, pattern] of PATTERNS) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}

export const IN_APP_BROWSER_MESSAGE = 'กรุณาเปิดลิงก์นี้ใน Chrome หรือ Safari เพื่อให้สแกนใบหน้าได้แม่นยำ';
