import express from 'express';
import multer from 'multer';
import { timingSafeEqual } from 'node:crypto';
import { createEngine } from '@arcships/light-ocr';
import { assertIsolatedOcrEnvironment } from './security.mjs';

assertIsolatedOcrEnvironment();

const app = express();
const port = readPositiveInteger('PORT', 3001);
const host = process.env.HOST || '127.0.0.1';
const maxFileSizeMb = readPositiveInteger('OCR_MAX_FILE_SIZE_MB', 8);
const includeRawText = process.env.OCR_INCLUDE_RAW_TEXT === 'true';
const serviceToken = process.env.OCR_SERVICE_TOKEN || '';
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (
  [process.env.NODE_ENV, process.env.APP_ENV].some((value) => value === 'production')
  && serviceToken.length < 32
) {
  throw new Error('OCR_SERVICE_TOKEN must contain at least 32 characters in production');
}
if (!serviceToken && !loopbackHosts.has(host)) {
  throw new Error('OCR_SERVICE_TOKEN is required when OCR binds to a non-loopback host');
}

function readPositiveInteger(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

app.disable('x-powered-by');
function hasValidServiceToken(request) {
  if (!serviceToken) return true;
  const supplied = request.get('x-ocr-service-token') || '';
  const expectedBuffer = Buffer.from(serviceToken);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

const acceptedMimeTypes = new Set(['image/jpeg', 'image/png']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: maxFileSizeMb * 1024 * 1024,
  },
  fileFilter(_request, file, callback) {
    if (acceptedMimeTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  },
});

let engine = null;
let engineError = null;

// Initialize the OCR engine once when the server starts
async function initEngine() {
  console.log('Initializing light-ocr engine...');
  try {
    engine = await createEngine();
    engineError = null;
    console.log('Engine initialized successfully.');
  } catch (error) {
    engineError = error;
    console.error('Failed to initialize engine:', error);
  }
}

const engineReady = initEngine();

app.get('/health', (_req, res) => {
  if (engine) {
    return res.json({ status: 'ok', engine: 'ready' });
  }

  return res.status(503).json({
    status: 'unavailable',
    engine: engineError ? 'failed' : 'initializing',
  });
});

function requireServiceToken(req, res, next) {
  if (!hasValidServiceToken(req)) {
    return res.status(401).json({ error: 'Unauthorized OCR service request' });
  }
  return next();
}

app.post('/ocr', requireServiceToken, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  if (!engine) {
    return res.status(503).json({ error: 'OCR engine is still initializing or failed.' });
  }

  const isJpeg = req.file.buffer.length >= 3
    && req.file.buffer[0] === 0xff
    && req.file.buffer[1] === 0xd8
    && req.file.buffer[2] === 0xff;
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isPng = req.file.buffer.length >= pngSignature.length
    && req.file.buffer.subarray(0, pngSignature.length).equals(pngSignature);
  if (!isJpeg && !isPng) {
    return res.status(415).json({ error: 'Uploaded content is not a valid JPEG or PNG image' });
  }

  try {
    const result = await engine.recognizeEncoded(req.file.buffer);
    
    const fullText = result.lines.map((line) => line.text).join('\n');
    const foundId = result.lines
      .map((line) => line.text
        .replace(/[๐-๙]/g, (digit) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)))
        .replace(/[\s-]/g, ''))
      .map((line) => line.match(/(?:^|\D)(\d{13})(?:\D|$)/)?.[1])
      .find(Boolean) || null;

    const response = {
      success: true,
      foundId,
    };

    // OCR output may contain personal data. Expose it only for explicit local debugging.
    if (includeRawText) {
      response.rawText = fullText;
      response.lines = result.lines;
    }

    res.json(response);
  } catch (error) {
    console.error('OCR processing error:', error);
    res.status(500).json({ error: 'OCR processing failed' });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Image exceeds ${maxFileSizeMb} MB limit` });
    }
    return res.status(415).json({ error: 'Only one JPEG or PNG image is accepted' });
  }

  console.error('Unhandled OCR service error:', error);
  return res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(port, host, () => {
  console.log(`OCR server running at http://${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down OCR service...`);
  server.close(async () => {
    await engineReady;
    if (engine) {
      await engine.close();
    }
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
