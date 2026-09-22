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
const modalIsolation = await readFile(
  new URL('../src/components/overlays/useModalIsolation.ts', import.meta.url),
  'utf8',
);

assert.match(livenessScanner, /width: \{ ideal: 1280, min: 640 \}/);
assert.match(livenessScanner, /height: \{ ideal: 720, min: 480 \}/);
assert.match(livenessScanner, /CameraQualityControls/);
assert.match(livenessScanner, /createPortal/);
assert.match(livenessScanner, /document\.body/);
assert.match(livenessScanner, /useModalIsolation\(true\)/);
assert.match(livenessScanner, /compact/);
assert.match(livenessScanner, /onClose/);
assert.match(qrScanner, /useDevices/);
assert.match(qrScanner, /width: \{ ideal: 1920, min: 640 \}/);
assert.match(qrScanner, /height: \{ ideal: 1080, min: 480 \}/);
assert.match(qrScanner, /deviceId: \{ exact: selectedCameraId \}/);
assert.match(qrScanner, /createPortal/);
assert.match(qrScanner, /document\.body/);
assert.match(qrScanner, /useModalIsolation\(true\)/);
assert.match(qrScanner, /sound=\{false\}/);
assert.match(qrScanner, /compact/);
assert.match(modalIsolation, /appRoot\.inert = true/);
assert.match(modalIsolation, /document\.body\.style\.overflow = 'hidden'/);
assert.match(modalIsolation, /document\.documentElement\.style\.overflow = 'hidden'/);
assert.match(qualityHook, /focusMode: 'continuous'/);
assert.match(qualityHook, /'sharpness' \| 'zoom'/);
assert.match(qualityHook, /track\.applyConstraints/);
assert.match(controls, /cameras\.length > 1/);
assert.match(controls, /sharpnessRange && sharpness !== null/);
assert.match(controls, /zoomRange && zoom !== null/);
assert.match(controls, /aria-expanded=\{expanded\}/);

console.log('Camera quality contract: isolated viewport portals, silent QR scans, compact controls, HD constraints, lens selection, focus, sharpness, and zoom pass.');
