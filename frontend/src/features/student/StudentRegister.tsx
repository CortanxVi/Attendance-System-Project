import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { compressImage, base64ToFile } from '../../utils/imageUtils';
import { faceService } from '../../services/api';

export default function StudentRegister() {
  const [step, setStep] = useState<1 | 2>(1);
  const [studentId, setStudentId] = useState<string>('');
  
  // สถานะโหลดและแจ้งเตือน
  const [ocrLoading, setOcrLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // กล้องหน้าต่าง
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();

  // ดึงภาพถ่ายบัตรนักศึกษามาประมวลผล OCR
  const handleIdCardUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg('');
    setOcrLoading(true);
    
    try {
      // สามารถบีบอัดภาพบัตรก่อนส่งไปทำ OCR ได้ (ป้องกันภาพใหญ่เกิน)
      const compressedFile = await compressImage(file, 1000, 0.8);
      
      const formData = new FormData();
      formData.append('image', compressedFile);
      
      const response = await fetch('http://localhost:3001/ocr', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('ระบบอ่านบัตรมีปัญหา กรุณาลองใหม่');
      }
      
      const result = await response.json();
      
      if (result.foundId) {
        setStudentId(result.foundId);
        setStep(2);
        startCamera();
      } else {
        // ให้ผู้ใช้กรอกรหัสด้วยตัวเอง
        const manualId = window.prompt(
          `AI อ่านรูปบัตรไม่สำเร็จ (ไม่พบเลข 13 หลัก)\n\nกรุณากรอกรหัสนักศึกษา 13 หลักของคุณด้วยตนเอง:`
        );
        const cleanId = manualId?.replace(/[\s-]/g, '');
        if (cleanId && cleanId.length === 13) {
          setStudentId(cleanId);
          setStep(2);
          startCamera();
        } else if (cleanId) {
          setErrorMsg('รหัสนักศึกษาไม่ถูกต้อง (ต้องมี 13 หลัก)');
        }
      }
    } catch (err: any) {
      console.error('OCR Error:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการวิเคราะห์บัตร');
    } finally {
      setOcrLoading(false);
      e.target.value = '';
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera error:', err);
      setErrorMsg('ไม่สามารถเข้าถึงกล้องได้ กรุณาอนุญาตการเข้าถึงกล้องถ่ายรูป');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const handleFaceCapture = async () => {
    if (!videoRef.current) return;
    
    setErrorMsg('');
    setRegisterLoading(true);
    
    try {
      // วาดภาพหน้าจอจากกล้องลง Canvas เพื่อแปลงเป็น File
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Canvas context failed");
      
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const faceFile = base64ToFile(dataUrl, 'face_capture.jpg');
      
      // 🌟 [สำคัญ] บีบอัดรูปภาพก่อนส่งไปหา Backend เพื่อลดภาระเซิร์ฟเวอร์
      const compressedFace = await compressImage(faceFile, 600, 0.7);
      
      // ปิดกล้องหลังถ่ายเสร็จ
      stopCamera();
      
      // ส่งรูปภาพพร้อมรหัสนักศึกษาไปที่ Backend
      const formData = new FormData();
      formData.append('student_id', studentId);
      formData.append('face_image', compressedFace);
      
      // สมมติว่า api/v1/enrollment/register-face ใช้ axios ใน backend
      // แต่หน้า studentHome ใช้ faceService เดี๋ยวเราลองปรับนิดหน่อย 
      // ใน Demo0.2 มีฟังก์ชัน faceService.registerFace(studentId, file)
      const res = await faceService.registerFace(studentId, compressedFace);
      
      if (res.success || res.message) {
        alert('ลงทะเบียนใบหน้าสำเร็จเรียบร้อย!');
        navigate('/student'); // กลับไปหน้าโฮมนักศึกษา
      }
    } catch (err: any) {
      console.error('Register Error:', err);
      setErrorMsg(err.message || 'ไม่สามารถลงทะเบียนใบหน้าได้');
      // หากพัง ให้เปิดกล้องใหม่
      startCamera();
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto mt-6 bg-white rounded-2xl shadow-sm border border-gray-100">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-800">ลงทะเบียนเข้าสู่ระบบ</h1>
        <p className="text-gray-500 mt-2">โปรดทำตามขั้นตอนเพื่อลงทะเบียนใบหน้าสำหรับใช้เช็คชื่อ</p>
      </div>

      {errorMsg && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start gap-3">
          <AlertCircle className="shrink-0 mt-0.5" size={20} />
          <span>{errorMsg}</span>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col items-center gap-6 py-6">
          <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center text-orange-600">
            <Upload size={32} />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-800">ขั้นตอนที่ 1: อัปโหลดบัตรนักศึกษา</h2>
            <p className="text-gray-500 mt-1">ระบบ AI จะดึงรหัสนักศึกษา 13 หลักให้อัตโนมัติ</p>
          </div>
          
          <label className="relative cursor-pointer w-full">
            <div className={`w-full py-4 rounded-xl border-2 border-dashed flex flex-col items-center gap-3 transition-colors ${ocrLoading ? 'bg-gray-50 border-gray-300' : 'border-orange-300 bg-orange-50 hover:bg-orange-100'}`}>
              {ocrLoading ? (
                <>
                  <Loader2 className="animate-spin text-orange-500" size={32} />
                  <span className="text-orange-600 font-medium">กำลังอ่านข้อมูลจากรูปภาพ...</span>
                </>
              ) : (
                <>
                  <Camera className="text-orange-500" size={32} />
                  <span className="text-orange-700 font-medium">ถ่ายรูปบัตร / เลือกไฟล์ภาพ</span>
                </>
              )}
            </div>
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              onChange={handleIdCardUpload}
              disabled={ocrLoading}
            />
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col items-center gap-6">
          <div className="bg-green-50 text-green-700 px-4 py-2 rounded-full font-medium flex items-center gap-2 border border-green-200">
            <CheckCircle size={18} /> รหัสนักศึกษา: {studentId}
          </div>
          
          <div className="text-center w-full">
            <h2 className="text-xl font-bold text-gray-800">ขั้นตอนที่ 2: ถ่ายรูปใบหน้า</h2>
            <p className="text-gray-500 mt-1">มองตรงไปที่กล้องในบริเวณที่มีแสงสว่างเพียงพอ</p>
            
            <div className="relative w-full aspect-[3/4] bg-gray-900 rounded-2xl overflow-hidden mt-6 mb-6 shadow-inner">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
              {/* Overlay Guideline */}
              <div className="absolute inset-0 pointer-events-none border-[6px] border-white/20 rounded-2xl">
                <div className="absolute top-[15%] left-[20%] right-[20%] bottom-[35%] border-2 border-dashed border-white/60 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] transition-all"></div>
              </div>
            </div>
            
            <button 
              onClick={handleFaceCapture}
              disabled={registerLoading}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-lg shadow-md transition-all active:scale-[0.98] disabled:opacity-70 flex justify-center items-center gap-2"
            >
              {registerLoading ? (
                <><Loader2 className="animate-spin" size={24} /> กำลังลงทะเบียน...</>
              ) : (
                <><Camera size={24} /> ถ่ายรูปเพื่อลงทะเบียน</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
