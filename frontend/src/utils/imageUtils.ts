export const base64ToFile = (base64String: string, filename: string): File => {
  const arr = base64String.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  
  return new File([u8arr], filename, { type: mime });
};

export const STUDENT_CARD_IMAGE_RULES = Object.freeze({
  maxWidth: 1920,
  maxHeight: 1920,
  outputType: 'image/jpeg',
  outputQuality: 0.94,
  maxOutputBytes: 8 * 1024 * 1024,
});

export interface PreparedStudentCardImage {
  file: File;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
}

export const calculateContainedImageSize = (
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } => {
  if (![width, height, maxWidth, maxHeight].every(Number.isFinite) || Math.min(width, height, maxWidth, maxHeight) <= 0) {
    throw new Error('ขนาดรูปภาพไม่ถูกต้อง');
  }

  // Do not upscale a small source: it cannot restore missing text detail and
  // may make OCR edges softer. Large sources keep their ratio and full frame.
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> => (
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('ไม่สามารถแปลงรูปบัตรได้'));
    }, type, quality);
  })
);

const getJpegFilename = (filename: string): string => {
  const baseName = filename.replace(/\.[^.]+$/, '') || 'student-card';
  return `${baseName}.jpg`;
};

/**
 * Prepare a student-card photo for Light OCR. Browser EXIF orientation is
 * applied, the full frame is fitted inside 1920 x 1920 without distortion or
 * cropping, then encoded once as a high-quality JPEG.
 */
export const prepareStudentCardImage = async (file: File): Promise<PreparedStudentCardImage> => {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    throw new Error('รองรับเฉพาะภาพ JPEG หรือ PNG');
  }
  if (file.size === 0) {
    throw new Error('ไฟล์รูปบัตรเป็นไฟล์ว่าง');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('เปิดรูปบัตรไม่ได้ กรุณาเลือกไฟล์ JPEG หรือ PNG ที่สมบูรณ์');
  }

  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const output = calculateContainedImageSize(
      originalWidth,
      originalHeight,
      STUDENT_CARD_IMAGE_RULES.maxWidth,
      STUDENT_CARD_IMAGE_RULES.maxHeight,
    );

    const canvas = document.createElement('canvas');
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('เบราว์เซอร์ไม่สามารถเตรียมรูปบัตรได้');
    }

    // Prevent transparent PNG pixels from becoming black after JPEG encoding.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, output.width, output.height);

    const blob = await canvasToBlob(
      canvas,
      STUDENT_CARD_IMAGE_RULES.outputType,
      STUDENT_CARD_IMAGE_RULES.outputQuality,
    );
    if (blob.size > STUDENT_CARD_IMAGE_RULES.maxOutputBytes) {
      throw new Error('รูปบัตรที่ปรับแล้วมีขนาดเกิน 8 MB กรุณาถ่ายใหม่ให้เห็นเฉพาะบัตร');
    }

    return {
      file: new File([blob], getJpegFilename(file.name), {
        type: STUDENT_CARD_IMAGE_RULES.outputType,
        lastModified: Date.now(),
      }),
      originalWidth,
      originalHeight,
      width: output.width,
      height: output.height,
    };
  } finally {
    bitmap.close();
  }
};

/**
 * บีบอัดรูปภาพด้วย HTML5 Canvas 
 * @param file ไฟล์รูปภาพต้นฉบับ
 * @param maxWidth ความกว้างสูงสุดที่ต้องการ (เช่น 800)
 * @param quality คุณภาพรูป 0.1 - 1.0 (เช่น 0.7)
 * @returns ไฟล์รูปที่บีบอัดแล้ว
 */
export const compressImage = (file: File, maxWidth: number = 800, quality: number = 0.7): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error("Cannot get canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              reject(new Error("Canvas to Blob failed"));
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};
