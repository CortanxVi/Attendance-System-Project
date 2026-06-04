import Tesseract from 'tesseract.js';

export interface Word {
  text: string;
  bbox: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface OCRResult {
  text: string;
  words: Word[];
}

class TesseractService {
  /**
   * อ่านข้อความจากรูปภาพโดยใช้ Tesseract.js รันบนเครื่อง Client
   */
  async extractText(file: File): Promise<OCRResult> {
    try {
      // รัน tesseract.js โดยโหลดภาษาอังกฤษ (eng)
      const result = await Tesseract.recognize(
        file,
        'eng',
        {
          logger: (m) => console.log(m)
        }
      );

      // แปลงข้อมูลให้อยู่ในรูปแบบเดียวกับที่แอปต้องการ (เหมือน EasyOCR)
      // ป้องกันกรณีที่ Tesseract มองไม่เห็นคำเลย (words เป็น undefined)
      const rawWords = result.data.words || [];
      const words: Word[] = rawWords.map((w: any) => ({
        text: w.text,
        bbox: {
          x: w.bbox.x0,
          y: w.bbox.y0,
          w: w.bbox.x1 - w.bbox.x0,
          h: w.bbox.y1 - w.bbox.y0,
        }
      }));

      return {
        text: result.data.text,
        words: words
      };
    } catch (error: any) {
      console.error("Tesseract Error:", error);
      throw new Error(`Tesseract Error: ${error.message || String(error)}`);
    }
  }
}

export const tesseractService = new TesseractService();
