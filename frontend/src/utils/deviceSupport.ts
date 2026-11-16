/**
 * Which phones may use the face scan.
 *
 * Android 11 or newer is supported; older Android is not (the face model is too slow there to
 * reach the frame rate the Backend requires). Everything that is not Android is unaffected.
 *
 * Browsers cannot be trusted to report the Android version in the User-Agent string: Chrome
 * (and the browsers built on it) freezes it at "Android 10; K" to reduce fingerprinting, which
 * would make every new phone look old. The real version is read from User-Agent Client Hints
 * (platformVersion). If it cannot be determined, the device is allowed (fail open), because a
 * wrong block is worse than letting the Backend and the scan decide.
 *
 * This is a support policy shown to the user, not a security control: the Backend never relies
 * on it.
 */

export const MIN_ANDROID_MAJOR = 11;

export type DeviceSupport =
  | { status: 'checking' }
  | { status: 'supported' }
  | { status: 'unsupported'; androidMajor: number };

type ClientHintsNavigator = {
  userAgent: string;
  userAgentData?: {
    getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string }>;
  };
};

/** "Android 9" -> 9. Returns null when the string is not an Android User-Agent. */
export function parseAndroidMajor(userAgent: string): number | null {
  const match = /Android\s+(\d+)/i.exec(userAgent);
  return match ? Number(match[1]) : null;
}

/** "13.0.0" -> 13. Returns null for anything that is not a version string. */
export function majorFromPlatformVersion(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+)(?:\.\d+)*$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** Chrome's frozen User-Agent: the Android number in it says nothing about the phone. */
function hasFrozenAndroidVersion(userAgent: string): boolean {
  return /Android 10; K\)/.test(userAgent);
}

export async function detectDeviceSupport(nav: ClientHintsNavigator): Promise<DeviceSupport> {
  const userAgent = nav.userAgent ?? '';
  if (!/Android/i.test(userAgent)) return { status: 'supported' };

  let major: number | null;
  try {
    const hints = await nav.userAgentData?.getHighEntropyValues?.(['platformVersion']);
    major = majorFromPlatformVersion(hints?.platformVersion);
  } catch {
    major = null;
  }
  if (major === null && !hasFrozenAndroidVersion(userAgent)) {
    major = parseAndroidMajor(userAgent);
  }

  if (major === null || major >= MIN_ANDROID_MAJOR) return { status: 'supported' };
  return { status: 'unsupported', androidMajor: major };
}
