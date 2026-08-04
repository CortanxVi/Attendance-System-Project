import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { createEngine } from '@arcships/light-ocr';

const app = express();
const port = 3001;

app.use(cors());

// Configure multer to store files in memory
const upload = multer({ storage: multer.memoryStorage() });

let engine = null;

// Initialize the OCR engine once when the server starts
async function initEngine() {
  console.log("Initializing light-ocr engine...");
  try {
    engine = await createEngine();
    console.log("Engine initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize engine:", error);
  }
}

initEngine();

app.post('/ocr', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  if (!engine) {
    return res.status(503).json({ error: 'OCR engine is still initializing or failed.' });
  }

  try {
    const result = await engine.recognizeEncoded(req.file.buffer);
    
    // Extract text from lines
    let fullText = '';
    let foundId = null;
    
    for (const line of result.lines) {
      fullText += line.text + '\n';
      
      const cleanLine = line.text.replace(/[\s-]/g, '');
      const match = cleanLine.match(/(?:^|\D)(\d{13})(?:\D|$)/);
      if (match) {
        foundId = match[1];
      }
    }
    
    res.json({
      success: true,
      foundId: foundId,
      rawText: fullText,
      lines: result.lines
    });
  } catch (error) {
    console.error("OCR processing error:", error);
    res.status(500).json({ error: 'OCR processing failed' });
  }
});

app.listen(port, () => {
  console.log(`OCR server running at http://localhost:${port}`);
});
