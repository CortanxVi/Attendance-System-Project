import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { compressImage, base64ToFile, prepareStudentCardImage } from '../../utils/imageUtils';
import { faceService } from '../../services/api';
import axios from 'axios';
import { useNotification } from '../../components/notifications/notificationContext';

export default function StudentRegister() {
  const { notify } = useNotification();
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
      // ใช้กติกาเดียวกับขั้นตอนเช็คชื่อ: หมุนตาม EXIF, คงสัดส่วน,
      // ไม่ตัดภาพ และเข้ารหัส JPEG คุณภาพสูงก่อนส่งให้ Light OCR
      const preparedCard = await prepareStudentCardImage(file);
      
      const formData = new FormData();
      formData.append('image', preparedCard.file);
      
      const response = await axios.post('/api/v1/ocr/student-card', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = response.data;
      
      if (result.foundId) {
        setStudentId(result.foundId);
        setStep(2);
        startCamera();
      } else {
        setErrorMsg('Light OCR อ่านรหัส 13 หลักไม่ได้ กรุณาถ่ายบัตรใหม่ให้ชัด');
      }
    } catch (err: unknown) {
      console.error('OCR Error:', err);
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : undefined;
      setErrorMsg(typeof detail === 'string' ? detail : err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการวิเคราะห์บัตร');
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
      
      const res = await faceService.registerFace(studentId, compressedFace);
      
      if (res.success || res.message) {
        notify('ลงทะเบียนใบหน้าสำเร็จเรียบร้อย', 'success');
        navigate('/student/profile', { replace: true });
      }
    } catch (err: unknown) {
      console.error('Register Error:', err);
      setErrorMsg(err instanceof Error ? err.message : 'ไม่สามารถลงทะเบียนใบหน้าได้');
      // หากพัง ให้เปิดกล้องใหม่
      startCamera();
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <div className="mx-3 my-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm min-[390px]:mx-4 min-[390px]:p-5">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-800">ลงทะเบียนเข้าสู่ระบบ</h1>
        <p className="text-gray-500 mt-2">โปรดทำตามขั้นตอนเพื่อลงทะเบียนใบหน้าสำหรับใช้เช็คชื่อ</p>
      </div>

      {errorMsg && (
        <div id="registration-card-error" role="alert" className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start gap-3">
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
            <p id="registration-card-help" className="mt-1 text-xs text-gray-500">รองรับ JPEG/PNG และปรับรูปให้เหมาะกับ Light OCR อัตโนมัติ</p>
          </div>
          
          <label className={`relative w-full rounded-xl focus-within:ring-2 focus-within:ring-orange-600 ${ocrLoading ? 'cursor-wait' : 'cursor-pointer'}`}>
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
              accept="image/jpeg,image/png"
              className="sr-only"
              onChange={handleIdCardUpload}
              disabled={ocrLoading}
              aria-describedby={errorMsg ? 'registration-card-help registration-card-error' : 'registration-card-help'}
              aria-invalid={Boolean(errorMsg)}
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
