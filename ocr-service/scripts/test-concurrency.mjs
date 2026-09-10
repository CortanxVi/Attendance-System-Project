import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const [imageArgument, concurrencyArgument = '30', expectedId] = process.argv.slice(2);
const serviceUrl = (process.env.OCR_SERVICE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const serviceToken = process.env.OCR_SERVICE_TOKEN || '';
const concurrency = Number.parseInt(concurrencyArgument, 10);

if (!imageArgument || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
  console.error('Usage: npm run test:concurrency -- /absolute/path/card.jpg [1-64] [expected-13-digit-id]');
  process.exit(2);
}

const imagePath = resolve(imageArgument);
const extension = extname(imagePath).toLowerCase();
const mimeType = extension === '.png' ? 'image/png' : 'image/jpeg';
const image = await readFile(imagePath);

const health = await fetch(`${serviceUrl}/health`);
if (!health.ok) {
  throw new Error(`OCR service is not ready (${health.status})`);
}

const startedAll = performance.now();
const results = await Promise.all(Array.from({ length: concurrency }, async (_unused, index) => {
  const form = new FormData();
  form.append('image', new Blob([image], { type: mimeType }), `load-${index}${extension || '.jpg'}`);
  const started = performance.now();
  const response = await fetch(`${serviceUrl}/ocr`, {
    method: 'POST',
    headers: serviceToken ? { 'X-OCR-Service-Token': serviceToken } : undefined,
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  return {
    status: response.status,
    foundId: payload.foundId || null,
    latencyMs: Math.round(performance.now() - started),
  };
}));

const failures = results.filter((result) => (
  result.status !== 200 || (expectedId && result.foundId !== expectedId)
));
const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
const percentile = (value) => latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * value) - 1)];
const summary = {
  concurrency,
  succeeded: results.length - failures.length,
  failed: failures.length,
  wallMs: Math.round(performance.now() - startedAll),
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  maxMs: latencies.at(-1),
  statusCounts: Object.fromEntries(
    [...new Set(results.map((result) => result.status))]
      .map((status) => [status, results.filter((result) => result.status === status).length]),
  ),
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0 || summary.maxMs > 45_000) {
  process.exit(1);
}
