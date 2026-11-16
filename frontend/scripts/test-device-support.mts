import assert from 'node:assert/strict';
import {
  MIN_ANDROID_MAJOR,
  detectDeviceSupport,
  majorFromPlatformVersion,
  parseAndroidMajor,
} from '../src/utils/deviceSupport.ts';

assert.equal(MIN_ANDROID_MAJOR, 11);

// Plain parsing helpers.
assert.equal(parseAndroidMajor('Mozilla/5.0 (Linux; Android 9; HUAWEI) Chrome/90'), 9);
assert.equal(parseAndroidMajor('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), null);
assert.equal(majorFromPlatformVersion('13.0.0'), 13);
assert.equal(majorFromPlatformVersion('9.0.0'), 9);
assert.equal(majorFromPlatformVersion('11'), 11);
assert.equal(majorFromPlatformVersion(''), null);
assert.equal(majorFromPlatformVersion(undefined), null);
assert.equal(majorFromPlatformVersion('Android 12'), null);

const reducedChrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
const oldAndroid9 = 'Mozilla/5.0 (Linux; Android 9; JKM-LX2) AppleWebKit/537.36 Chrome/96.0.4664.104 Mobile Safari/537.36';
const hints = (platformVersion: string) => ({
  getHighEntropyValues: async () => ({ platformVersion }),
});

// Not Android: never blocked.
assert.deepEqual(
  await detectDeviceSupport({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit' }),
  { status: 'supported' },
);
assert.deepEqual(
  await detectDeviceSupport({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130' }),
  { status: 'supported' },
);

// Chrome freezes the User-Agent at Android 10: the real version comes from the client hints.
assert.deepEqual(
  await detectDeviceSupport({ userAgent: reducedChrome, userAgentData: hints('14.0.0') }),
  { status: 'supported' },
  'a new phone behind the frozen "Android 10" User-Agent must NOT be blocked',
);
assert.deepEqual(
  await detectDeviceSupport({ userAgent: reducedChrome, userAgentData: hints('11.0.0') }),
  { status: 'supported' },
);
assert.deepEqual(
  await detectDeviceSupport({ userAgent: reducedChrome, userAgentData: hints('10.0.0') }),
  { status: 'unsupported', androidMajor: 10 },
);
assert.deepEqual(
  await detectDeviceSupport({ userAgent: oldAndroid9, userAgentData: hints('9.0.0') }),
  { status: 'unsupported', androidMajor: 9 },
);

// If the hints fail, the frozen User-Agent proves nothing: allow. A real old User-Agent is trusted.
assert.deepEqual(
  await detectDeviceSupport({
    userAgent: reducedChrome,
    userAgentData: { getHighEntropyValues: async () => { throw new Error('denied'); } },
  }),
  { status: 'supported' },
  'fail open when the version cannot be determined',
);
assert.deepEqual(await detectDeviceSupport({ userAgent: reducedChrome }), { status: 'supported' });
assert.deepEqual(
  await detectDeviceSupport({ userAgent: oldAndroid9 }),
  { status: 'unsupported', androidMajor: 9 },
  'a browser without client hints (for example an old WebView) reports its real version',
);
assert.deepEqual(
  await detectDeviceSupport({ userAgent: 'Mozilla/5.0 (Android 12; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0' }),
  { status: 'supported' },
);

console.log('Device support: Android 11+ gate handles frozen user agents, client hints and fail-open.');
