/**
 * The prep modal before every face scan (owner request 2026-11-16):
 *  A. source wiring: StudentHome and StudentRegister wrap LivenessScanner in FaceScanPrepGate, the
 *     gate mounts its children only after "เข้าใจแล้ว", Escape never acknowledges, dialog ARIA;
 *  B. a real server render (Vite SSR loader + react-dom/server): before acknowledgement only the
 *     dialog is in the markup and the scanner child is absent.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const gate = await read('../src/features/student/FaceScanPrepGate.tsx');
const home = await read('../src/features/student/StudentHome.tsx');
const register = await read('../src/features/student/StudentRegister.tsx');

// A. Gate source.
assert.match(gate, /export const FACE_SCAN_PREP_ACK_LABEL = 'เข้าใจแล้ว';/);
assert.match(gate, /if \(acknowledged\) return <>\{children\}<\/>;/, 'children mount only after acknowledgement');
assert.equal((gate.match(/setAcknowledged\(true\)/g) ?? []).length, 1, 'only one path acknowledges');
assert.match(gate, /onClick=\{\(\) => setAcknowledged\(true\)\}/, 'the button is that path');
assert.match(gate, /ref=\{cancelRef\}[\s\S]{0,80}onClick=\{onCancel\}/, 'the X button only cancels; it never acknowledges');
assert.match(gate, /role="dialog"/);
assert.match(gate, /aria-modal="true"/);
assert.match(gate, /aria-labelledby=\{titleId\}/);
assert.match(gate, /aria-describedby=\{descriptionId\}/);
assert.match(gate, /ackRef\.current\?\.focus\(\)/, 'focus moves to the button on open');
assert.match(gate, /event\.key === 'Escape'[\s\S]{0,200}onCancel\?\.\(\);[\s\S]{0,20}return;/, 'Escape cancels or is ignored');
assert.match(gate, /min-h-11/);
assert.match(gate, /overflow-y-auto/);
assert.doesNotMatch(gate, /localStorage|sessionStorage/, 'no persistent "do not show again"');

// A. Parents wrap the scanner.
for (const [name, source] of [['StudentHome', home], ['StudentRegister', register]] as const) {
  assert.match(source, /import FaceScanPrepGate from '\.\/FaceScanPrepGate';/, `${name} imports the gate`);
  assert.match(source, /<FaceScanPrepGate onCancel=\{[^}]+\}>\s*<LivenessScanner[\s\S]*?\/>\s*<\/FaceScanPrepGate>/, `${name} wraps LivenessScanner`);
  assert.equal((source.match(/<LivenessScanner\b/g) ?? []).length, 1, `${name} has no unwrapped scanner`);
  assert.doesNotMatch(source, /กะพริบ|กระพริบ/, `${name} no longer says "blink" (the action is close the eyes 1 s)`);
}
// StudentHome keeps its reload guard for a pending challenge.
assert.match(home, /hasChallengeToken: livenessToken !== null/);
assert.match(home, /livenessActive: isLivenessActive/);
assert.match(register, /enrollmentHoldsPage\(\{ hasChallenge: challenge !== null, phase \}\)/);

// B. Real render before acknowledgement.
const server = await createServer({
  configFile: false,
  root: new URL('..', import.meta.url).pathname,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const mod = await server.ssrLoadModule('/src/features/student/FaceScanPrepGate.tsx');
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const html = renderToString(
    createElement(mod.default, { onCancel: () => undefined }, createElement('div', { id: 'scanner-child' }, 'SCANNER-MOUNTED')),
  );
  assert.doesNotMatch(html, /SCANNER-MOUNTED|scanner-child/, 'the scanner is not mounted before acknowledgement');
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="[^"]+"/);
  assert.match(html, /aria-describedby="[^"]+"/);
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 2, 'the X cancel button and the acknowledge button');
  assert.match(buttons[0][1], /aria-label="ยกเลิกการสแกนใบหน้า"/, 'the X button has an accessible name');
  assert.match(buttons[0][1], /right-2 top-2/, 'the X button sits in the top-right corner');
  assert.equal(buttons[1][2], 'เข้าใจแล้ว', 'the acknowledge label is exactly "เข้าใจแล้ว"');
  assert.match(html, /30–40 ซม\./, 'phone distance matches PAD_RETRY_CHECKLIST');
  assert.doesNotMatch(html, /ช่วงแขน/);
  for (const text of ['ที่สว่าง', 'เก็บผม', 'หน้ากาก', 'ระดับสายตา', 'คนเดียว', 'หลับตาทั้งสองข้าง 1 วินาที', 'ขยับเข้าใกล้', 'กลับมาอยู่ท่าเดิม']) {
    assert.ok(html.includes(text), `the modal mentions "${text}"`);
  }
} finally {
  await server.close();
}

console.log('scan prep gate tests passed');
