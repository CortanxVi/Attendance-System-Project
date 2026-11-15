/**
 * Identity of the running web build, so a stale (cached PWA) build is visible in the test overlay
 * and in the test-mode attempt table. `__APP_BUILD__` is replaced at build time by vite.config.ts
 * (commit short sha, whether the tree had uncommitted changes, build time). The Backend's
 * `app_version` is the SERVER version and cannot tell web builds apart.
 */
declare const __APP_BUILD__: { commit: string; dirty: boolean; builtAt: string } | undefined;

export interface BuildInfo {
  commit: string;
  dirty: boolean;
  /** Build time, ms since epoch (0 when unknown, e.g. in unit tests). */
  builtAtMs: number;
}

export function parseBuildInfo(raw: { commit?: unknown; dirty?: unknown; builtAt?: unknown } | undefined | null): BuildInfo {
  const commit = typeof raw?.commit === 'string' && /^[0-9a-f]{7,12}$/.test(raw.commit) ? raw.commit : 'unknown';
  const builtAtMs = typeof raw?.builtAt === 'string' ? Date.parse(raw.builtAt) : Number.NaN;
  return { commit, dirty: raw?.dirty === true, builtAtMs: Number.isFinite(builtAtMs) ? builtAtMs : 0 };
}

export const BUILD_INFO: BuildInfo = parseBuildInfo(typeof __APP_BUILD__ === 'undefined' ? null : __APP_BUILD__);

/** "59c9306+dirty · 2026-11-15 10:30 UTC" */
export function buildLabel(info: BuildInfo): string {
  const time = info.builtAtMs ? new Date(info.builtAtMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown time';
  return `${info.commit}${info.dirty ? '+dirty' : ''} · ${time}`;
}

/**
 * Numbers for client_diagnostics (the contract allows numbers/enums only):
 * web_build = build time in whole seconds since epoch, web_commit = short sha read as a hex integer
 * (first 7 hex digits; 0 when unknown).
 */
export function buildDiagnostics(info: BuildInfo): { web_build: number; web_commit: number } {
  return {
    web_build: Math.max(0, Math.floor(info.builtAtMs / 1000)),
    web_commit: info.commit === 'unknown' ? 0 : Number.parseInt(info.commit.slice(0, 7), 16),
  };
}
