import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const livenessScanner = await readFile(
  new URL('../src/features/student/LivenessScanner.tsx', import.meta.url),
  'utf8',
);
const qrScanner = await readFile(
  new URL('../src/features/student/QRScanner.tsx', import.meta.url),
  'utf8',
);
const qualityHook = await readFile(
  new URL('../src/hooks/useCameraQuality.ts', import.meta.url),
  'utf8',
);
const controls = await readFile(
  new URL('../src/components/camera/CameraQualityControls.tsx', import.meta.url),
  'utf8',
);

assert.match(livenessScanner, /width: \{ ideal: 1280, min: 640 \}/);
assert.match(livenessScanner, /height: \{ ideal: 720, min: 480 \}/);
assert.match(livenessScanner, /CameraQualityControls/);
assert.match(qrScanner, /useDevices/);
assert.match(qrScanner, /width: \{ ideal: 1920, min: 640 \}/);
assert.match(qrScanner, /height: \{ ideal: 1080, min: 480 \}/);
assert.match(qrScanner, /deviceId: \{ exact: selectedCameraId \}/);
assert.match(qualityHook, /focusMode: 'continuous'/);
assert.match(qualityHook, /'sharpness' \| 'zoom'/);
assert.match(qualityHook, /track\.applyConstraints/);
assert.match(controls, /cameras\.length > 1/);
assert.match(controls, /sharpnessRange && sharpness !== null/);
assert.match(controls, /zoomRange && zoom !== null/);

console.log('Camera quality contract: HD constraints, lens selection, focus, sharpness, and zoom pass.');
