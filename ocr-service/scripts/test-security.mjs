import assert from 'node:assert/strict';

import { assertIsolatedOcrEnvironment } from '../security.mjs';


assert.doesNotThrow(() => assertIsolatedOcrEnvironment({
  OCR_SERVICE_TOKEN: 'internal-only',
  HOST: '127.0.0.1',
}));

for (const name of [
  'SUPABASE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
]) {
  assert.throws(
    () => assertIsolatedOcrEnvironment({ [name]: 'sentinel' }),
    new RegExp(name),
  );
}

console.log('OCR environment isolation checks passed');
