import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const confirmDialog = await readFile(
  new URL('../src/components/overlays/ConfirmDialog.tsx', import.meta.url),
  'utf8',
);
const modalIsolation = await readFile(
  new URL('../src/components/overlays/useModalIsolation.ts', import.meta.url),
  'utf8',
);
const textPromptDialog = await readFile(
  new URL('../src/components/overlays/TextPromptDialog.tsx', import.meta.url),
  'utf8',
);
const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const periodManager = await readFile(
  new URL('../src/features/teacher/AttendancePeriodManager.tsx', import.meta.url),
  'utf8',
);
const temporaryAdminRequests = await readFile(
  new URL('../src/features/admin/TemporaryAdminRequests.tsx', import.meta.url),
  'utf8',
);

assert.match(confirmDialog, /createPortal/);
assert.match(confirmDialog, /document\.body/);
assert.match(confirmDialog, /var\(--z-confirmation\)/);
assert.match(confirmDialog, /useModalIsolation\(open\)/);
assert.match(confirmDialog, /role="alertdialog"/);
assert.match(confirmDialog, /event\.key !== 'Tab'/);
assert.match(textPromptDialog, /createPortal/);
assert.match(textPromptDialog, /document\.body/);
assert.match(textPromptDialog, /var\(--z-confirmation\)/);
assert.match(textPromptDialog, /useModalIsolation\(open\)/);
assert.match(textPromptDialog, /role="alertdialog"/);
assert.match(modalIsolation, /appRoot\.inert = true/);
assert.match(modalIsolation, /appRoot\.inert = rootWasInert/);
assert.match(styles, /--z-confirmation:\s*800/);
assert.match(styles, /--z-toast:\s*900/);
assert.match(periodManager, /<ConfirmDialog/);
assert.match(temporaryAdminRequests, /<TextPromptDialog/);
assert.doesNotMatch(temporaryAdminRequests, /style=\{\{ zIndex: 'var\(--z-backdrop\)' \}\}/);

console.log('Overlay contract: confirmation and reason dialogs portal above parent dialogs, isolate the app shell, trap focus, and remain below toasts.');
