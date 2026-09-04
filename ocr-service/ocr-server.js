import express from 'express';
import multer from 'multer';
import { timingSafeEqual } from 'node:crypto';
import { createEngine, OcrError } from '@arcships/light-ocr';
import { assertIsolatedOcrEnvironment } from './security.mjs';

assertIsolatedOcrEnvironment();

const app = express();
const port = readPositiveInteger('PORT', 3001);
const host = process.env.HOST || '127.0.0.1';
const maxFileSizeMb = readPositiveInteger('OCR_MAX_FILE_SIZE_MB', 8);
const includeRawText = process.env.OCR_INCLUDE_RAW_TEXT === 'true';
const serviceToken = process.env.OCR_SERVICE_TOKEN || '';
const provider = readChoice('OCR_PROVIDER', ['cpu', 'auto', 'webgpu'], 'cpu');
const queueCapacity = readBoundedInteger('OCR_QUEUE_CAPACITY', 32, 30, 64);
const requestTimeoutMs = readBoundedInteger('OCR_REQUEST_TIMEOUT_MS', 40_000, 5_000, 42_000);
const detectionMaxSide = readBoundedInteger('OCR_DETECTION_MAX_SIDE', 960, 640, 960);
const maxPendingInputMb = readBoundedInteger(
  'OCR_MAX_PENDING_INPUT_MB',
  Math.max(256, maxFileSizeMb * queueCapacity),
  maxFileSizeMb * queueCapacity,
  512,
);
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

function readBoundedInteger(name, fallback, minimum, maximum) {
  const value = readPositiveInteger(name, fallback);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function readChoice(name, choices, fallback) {
  const value = (process.env[name] || fallback).trim().toLowerCase();
  if (!choices.includes(value)) {
    throw new Error(`${name} must be one of: ${choices.join(', ')}`);
  }
  return value;
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
    fields: 0,
    fieldNameSize: 32,
    fieldSize: 1,
    parts: 2,
    headerPairs: 16,
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
let activeRequests = 0;
let completedRequests = 0;
let failedRequests = 0;

// A single persistent CPU engine with a bounded FIFO is faster and lighter on
// the supported classroom hardware than spawning engines per request. The
// queue is sized for the agreed 30-student burst with two safety slots.
async function initEngine() {
  console.log(
    `Initializing light-ocr engine (provider=${provider}, queue=${queueCapacity}, deadline=${requestTimeoutMs}ms)...`,
  );
  engine = await createEngine({
    execution: { provider },
    queueCapacity,
    maxPendingInputBytes: maxPendingInputMb * 1024 * 1024,
    detection: { maxSide: detectionMaxSide },
  });
  console.log('Engine initialized successfully.');
}

app.get('/health', (_req, res) => {
  if (engine) {
    return res.json({
      status: 'ok',
      engine: 'ready',
      provider,
      queueCapacity,
      activeRequests,
      completedRequests,
      failedRequests,
      requestTimeoutMs,
      detectionMaxSide,
    });
  }

  return res.status(503).json({
    status: 'unavailable',
    engine: 'initializing',
  });
});

function requireServiceToken(req, res, next) {
  if (!hasValidServiceToken(req)) {
    return res.status(401).json({ error: 'Unauthorized OCR service request' });
  }
  return next();
}

function reserveOcrSlot(_req, res, next) {
  // Reserve before multer reads the body so a connection flood cannot place
  // more than queueCapacity encoded images in process memory.
  if (activeRequests >= queueCapacity) {
    res.set('Retry-After', '2');
    return res.status(503).json({ error: 'OCR queue is full', code: 'queue_full' });
  }
  activeRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeRequests = Math.max(0, activeRequests - 1);
  };
  res.once('finish', release);
  res.once('close', release);
  return next();
}

app.post('/ocr', requireServiceToken, reserveOcrSlot, upload.single('image'), async (req, res) => {
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

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), requestTimeoutMs);
  const abortOnDisconnect = () => controller.abort();
  req.once('aborted', abortOnDisconnect);
  try {
    const startedAt = performance.now();
    const result = await engine.recognizeEncoded(req.file.buffer, {
      detectionMaxSide,
      signal: controller.signal,
    });
    
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
      processingMs: Math.round(performance.now() - startedAt),
    };

    // OCR output may contain personal data. Expose it only for explicit local debugging.
    if (includeRawText) {
      response.rawText = fullText;
      response.lines = result.lines;
    }
    completedRequests += 1;
    res.json(response);
  } catch (error) {
    failedRequests += 1;
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'OCR processing deadline exceeded', code: 'timeout' });
    }
    if (error instanceof OcrError && error.code === 'queue_full') {
      res.set('Retry-After', '2');
      return res.status(503).json({ error: 'OCR queue is full', code: 'queue_full' });
    }
    console.error('OCR processing error:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'OCR processing failed', code: 'processing_failed' });
  } finally {
    clearTimeout(deadline);
    req.off('aborted', abortOnDisconnect);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Image exceeds ${maxFileSizeMb} MB limit` });
    }
    if (['LIMIT_FIELD_COUNT', 'LIMIT_FIELD_VALUE', 'LIMIT_PART_COUNT'].includes(error.code)) {
      return res.status(413).json({ error: 'OCR multipart request exceeds allowed structure' });
    }
    return res.status(415).json({ error: 'Only one JPEG or PNG image is accepted' });
  }

  console.error('Unhandled OCR service error:', error);
  return res.status(500).json({ error: 'Internal server error' });
});

// Do not open the TCP port until the model is ready. Launchers can therefore
// use the listening socket itself as a readiness boundary.
await initEngine();

const server = app.listen(port, host, () => {
  console.log(`OCR server ready at http://${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down OCR service...`);
  server.close(async () => {
    if (engine) {
      await engine.close();
    }
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
