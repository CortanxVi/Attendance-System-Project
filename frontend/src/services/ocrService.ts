import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Word {
  text: string;
  bbox: BBox;
}

export interface OCRResult {
  text: string;
  words: Word[];
}

export const ocrService = {
  extractText: async (imageFile: File | Blob): Promise<OCRResult> => {
    const formData = new FormData();
    formData.append('file', imageFile, 'image.jpg');

    const response = await axios.post<OCRResult>(`${API_URL}/api/ocr`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  }
};
