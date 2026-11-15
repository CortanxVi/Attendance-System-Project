/**
 * Test-build-only device summary sent with an attendance check-in as `client_diagnostics`, so the
 * failure table can be split by device. Contract shared with the Backend: enums and numbers only,
 * never the User-Agent string or anything that identifies the person.
 */
import { detectInAppBrowser } from './inAppBrowser.ts';

export type DiagnosticsPlatform = 'android' | 'ios' | 'desktop' | 'other';
export type DiagnosticsBrowser = 'chrome' | 'safari' | 'samsung' | 'firefox' | 'edge' | 'inapp' | 'other';
export type DiagnosticsDelegate = 'gpu' | 'cpu' | 'main' | 'unknown';

export interface ClientDiagnostics {
  platform: DiagnosticsPlatform;
  browser: DiagnosticsBrowser;
  delegate: DiagnosticsDelegate;
  camera_w: number;
  camera_h: number;
  analysis_fps: number;
  luma: number | null;
  sharpness: number | null;
  frame_errors: number;
  warmup_ms: number;
  /** Web build time (s since epoch) and commit (short sha as a hex integer): spots stale PWA builds. */
  web_build: number;
  web_commit: number;
}

export function detectPlatform(userAgent: string, maxTouchPoints = 0, platform = ''): DiagnosticsPlatform {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
  if (/Windows NT|Macintosh|Mac OS X|X11|Linux x86_64|CrOS/.test(userAgent)) return 'desktop';
  return 'other';
}

export function detectBrowser(userAgent: string): DiagnosticsBrowser {
  if (detectInAppBrowser(userAgent)) return 'inapp';
  if (/SamsungBrowser\//.test(userAgent)) return 'samsung';
  if (/\bEdg(A|iOS)?\//.test(userAgent)) return 'edge';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'firefox';
  // Android WebView ("; wv)") is an in-app browser of some other app.
  if (/Android/i.test(userAgent) && /; wv\)/.test(userAgent)) return 'inapp';
  if (/Chrome\/|CriOS\//.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return 'safari';
  return 'other';
}

export function diagnosticsDelegate(
  runtimeMode: 'worker' | 'main-thread' | null,
  delegate: 'GPU' | 'CPU' | null,
): DiagnosticsDelegate {
  if (runtimeMode === 'main-thread') return 'main';
  if (runtimeMode === 'worker' && delegate === 'GPU') return 'gpu';
  if (runtimeMode === 'worker' && delegate === 'CPU') return 'cpu';
  return 'unknown';
}

function wholeNumber(value: number, max: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
}

function rounded(value: number | null | undefined, digits: number, max: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(Math.max(0, Math.min(max, value)) * factor) / factor;
}

/** Ranges the Backend accepts (shared contract); the JSON must stay <= MAX_BYTES. */
export const DIAGNOSTICS_LIMITS = Object.freeze({
  cameraSide: 8192,
  fps: 120,
  sharpness: 100_000,
  frameErrors: 100_000,
  warmupMs: 600_000,
  /** Up to 2100-01-01 in seconds, and the largest 7-hex-digit value. */
  webBuild: 4_102_444_800,
  webCommit: 0xfffffff,
  maxBytes: 1024,
});

/** The multipart field value, or null when it would break the size contract (never expected). */
export function serializeClientDiagnostics(diagnostics: ClientDiagnostics): string | null {
  const json = JSON.stringify(diagnostics);
  return new TextEncoder().encode(json).length <= DIAGNOSTICS_LIMITS.maxBytes ? json : null;
}

export interface ClientDiagnosticsInput {
  userAgent: string;
  maxTouchPoints?: number;
  navigatorPlatform?: string;
  runtimeMode: 'worker' | 'main-thread' | null;
  delegate: 'GPU' | 'CPU' | null;
  cameraWidth: number;
  cameraHeight: number;
  analysisFps: number;
  luma: number | null;
  sharpness: number | null;
  frameErrors: number;
  warmupMs: number;
  webBuild?: number;
  webCommit?: number;
}

/** Builds the payload; every field is an enum or a clamped number. */
export function buildClientDiagnostics(input: ClientDiagnosticsInput): ClientDiagnostics {
  return {
    platform: detectPlatform(input.userAgent, input.maxTouchPoints, input.navigatorPlatform),
    browser: detectBrowser(input.userAgent),
    delegate: diagnosticsDelegate(input.runtimeMode, input.delegate),
    camera_w: wholeNumber(input.cameraWidth, DIAGNOSTICS_LIMITS.cameraSide),
    camera_h: wholeNumber(input.cameraHeight, DIAGNOSTICS_LIMITS.cameraSide),
    analysis_fps: rounded(input.analysisFps, 2, DIAGNOSTICS_LIMITS.fps) ?? 0,
    luma: rounded(input.luma, 1, 255),
    sharpness: rounded(input.sharpness, 2, DIAGNOSTICS_LIMITS.sharpness),
    frame_errors: wholeNumber(input.frameErrors, DIAGNOSTICS_LIMITS.frameErrors),
    warmup_ms: wholeNumber(input.warmupMs, DIAGNOSTICS_LIMITS.warmupMs),
    web_build: wholeNumber(input.webBuild ?? 0, DIAGNOSTICS_LIMITS.webBuild),
    web_commit: wholeNumber(input.webCommit ?? 0, DIAGNOSTICS_LIMITS.webCommit),
  };
}

/**
 * Enum-only diagnostics for a capture that came without them (never expected, but a test-build
 * check-in must always carry the field so the device can be identified). Numbers stay 0/null.
 */
export function fallbackClientDiagnostics(
  userAgent: string,
  maxTouchPoints = 0,
  navigatorPlatform = '',
  build: { web_build: number; web_commit: number } = { web_build: 0, web_commit: 0 },
): ClientDiagnostics {
  return buildClientDiagnostics({
    userAgent, maxTouchPoints, navigatorPlatform, runtimeMode: null, delegate: null,
    cameraWidth: 0, cameraHeight: 0, analysisFps: 0, luma: null, sharpness: null,
    frameErrors: 0, warmupMs: 0, webBuild: build.web_build, webCommit: build.web_commit,
  });
}
