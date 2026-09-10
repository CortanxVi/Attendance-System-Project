import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const [imageArgument, expectedId] = process.argv.slice(2);
const serviceUrl = (process.env.OCR_SERVICE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const serviceToken = process.env.OCR_SERVICE_TOKEN || '';

if (!imageArgument) {
  console.error('Usage: npm run test:ocr -- /absolute/path/card.jpg [expected-13-digit-id]');
  process.exit(2);
}

const imagePath = resolve(imageArgument);
const extension = extname(imagePath).toLowerCase();
const mimeType = extension === '.png' ? 'image/png' : 'image/jpeg';

try {
  const healthResponse = await fetch(`${serviceUrl}/health`);
  if (!healthResponse.ok) {
    throw new Error(`OCR service is not ready (${healthResponse.status})`);
  }

  const image = await readFile(imagePath);
  const form = new FormData();
  form.append('image', new Blob([image], { type: mimeType }), `ocr-test${extension || '.jpg'}`);

  const response = await fetch(`${serviceUrl}/ocr`, {
    method: 'POST',
    headers: serviceToken ? { 'X-OCR-Service-Token': serviceToken } : undefined,
    body: form,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`${response.status}: ${payload.error || 'OCR request failed'}`);
  }

  console.log(JSON.stringify(payload, null, 2));

  if (expectedId && payload.foundId !== expectedId) {
    console.error(`Expected ${expectedId}, received ${payload.foundId || 'null'}`);
    process.exit(1);
  }

  if (!payload.foundId) {
    console.error('OCR completed, but no 13-digit ID was detected.');
    process.exit(1);
  }
} catch (error) {
  console.error(`OCR smoke test failed: ${error.message}`);
  process.exit(1);
}
