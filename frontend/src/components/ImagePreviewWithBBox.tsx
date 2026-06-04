import { useRef, useEffect } from 'react';
import type { Word } from '../services/ocrService';

interface Props {
  imageFile: File | null;
  words: Word[];
}

export default function ImagePreviewWithBBox({ imageFile, words }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!imageFile || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    const objectUrl = URL.createObjectURL(imageFile);
    
    img.onload = () => {
      // Set canvas size to match image original size for drawing
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Draw image
      ctx.drawImage(img, 0, 0);

      // Draw bounding boxes
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3B82F6'; // Blue-500
      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)'; // Blue-500 with opacity

      words.forEach(word => {
        const { x, y, w, h } = word.bbox;
        ctx.strokeRect(x, y, w, h);
        ctx.fillRect(x, y, w, h);
      });

      URL.revokeObjectURL(objectUrl);
    };

    img.src = objectUrl;

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [imageFile, words]);

  if (!imageFile) return null;

  return (
    <div ref={containerRef} className="w-full overflow-auto bg-slate-100 rounded-xl border border-slate-200">
      {/* ใช้ CSS เพื่อย่อรูปให้พอดีกรอบ แต่ขนาดวาดจริงบน canvas อิงตาม original size */}
      <canvas 
        ref={canvasRef} 
        className="max-w-full h-auto mx-auto block"
      />
    </div>
  );
}
