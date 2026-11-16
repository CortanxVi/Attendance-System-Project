import { useEffect, useState } from 'react';
import { detectDeviceSupport, type DeviceSupport } from '../utils/deviceSupport';

/** Resolves once per page whether this phone is inside the supported range (Android 11+). */
let cached: Promise<DeviceSupport> | null = null;

function check(): Promise<DeviceSupport> {
  cached ??= detectDeviceSupport(navigator as unknown as Parameters<typeof detectDeviceSupport>[0]);
  return cached;
}

export function useDeviceSupport(): DeviceSupport {
  const [support, setSupport] = useState<DeviceSupport>({ status: 'checking' });
  useEffect(() => {
    let active = true;
    void check().then((result) => { if (active) setSupport(result); });
    return () => { active = false; };
  }, []);
  return support;
}
