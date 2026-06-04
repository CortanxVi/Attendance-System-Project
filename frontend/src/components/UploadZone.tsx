import { useCallback } from 'react';

interface Props {
  onImageSelected: (file: File) => void;
}

export default function UploadZone({ onImageSelected }: Props) {
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      onImageSelected(file);
    }
  }, [onImageSelected]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageSelected(file);
    }
  };

  return (
    <div 
      className="border-2 border-dashed border-blue-300 rounded-xl p-10 text-center bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer flex flex-col items-center justify-center min-h-[300px]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => document.getElementById('fileInput')?.click()}
    >
      <input 
        id="fileInput" 
        type="file" 
        accept="image/*" 
        className="hidden" 
        onChange={handleChange} 
      />
      <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mb-4 text-white">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
      </div>
      <h3 className="text-xl font-semibold text-slate-700 mb-2">ลากวางรูปภาพที่นี่</h3>
      <p className="text-slate-500">หรือคลิกเพื่อเลือกไฟล์ (JPG, PNG, WEBP)</p>
    </div>
  );
}
