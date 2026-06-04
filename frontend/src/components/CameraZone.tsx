import { useRef, useCallback } from 'react';
import Webcam from 'react-webcam';

interface Props {
  onImageCaptured: (file: File) => void;
  onCancel: () => void;
}

export default function CameraZone({ onImageCaptured, onCancel }: Props) {
  const webcamRef = useRef<Webcam>(null);

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      // แปลง base64 เป็น File
      fetch(imageSrc)
        .then(res => res.blob())
        .then(blob => {
          const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
          onImageCaptured(file);
        });
    }
  }, [onImageCaptured]);

  return (
    <div className="flex flex-col items-center justify-center bg-slate-900 rounded-xl overflow-hidden min-h-[300px] relative">
      <Webcam
        audio={false}
        ref={webcamRef}
        screenshotFormat="image/jpeg"
        className="w-full h-auto max-h-[400px] object-cover"
      />
      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
        <button 
          onClick={onCancel}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg shadow-md transition-colors font-medium"
        >
          ยกเลิก
        </button>
        <button 
          onClick={capture}
          className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-md transition-colors font-medium flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
          ถ่ายรูป
        </button>
      </div>
    </div>
  );
}
