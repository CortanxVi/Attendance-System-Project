import React, { useState } from 'react';
import QRScanner from './QRScanner'; 
import LivenessScanner from './LivenessScanner';
import { faceService } from '../../services/api';
import { base64ToFile } from '../../utils/imageUtils';
// นำเข้า Icon เพิ่มเติมจาก lucide-react
import { UploadCloud, CheckCircle, XCircle, Loader2, UserCheck } from 'lucide-react';

export default function StudentHome() {
  const [isScanning, setIsScanning] = useState(false);
  const [verifiedCourse, setVerifiedCourse] = useState<string | null>(null);
  const [isLivenessActive, setIsLivenessActive] = useState(false);

  // สถานะเก็บรูปภาพ
  const [capturedFaceData, setCapturedFaceData] = useState<string | null>(null);
  const [idCardFile, setIdCardFile] = useState<File | null>(null);
  const [idCardPreview, setIdCardPreview] = useState<string | null>(null);
  
  // สถานะการส่งข้อมูล
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [finalResult, setFinalResult] = useState<'success' | 'failed' | null>(null);
  const [resultMessage, setResultMessage] = useState<string>('');  // ข้อความจากหลังบ้าน
  const [resultStudentId, setResultStudentId] = useState<string>(''); // รหัสนักศึกษาจากหลังบ้าน
  const [resultScore, setResultScore] = useState<number | null>(null); // คะแนนความเหมือน

  const handleVerifySuccess = (course: string) => {
    setIsScanning(false);
    setVerifiedCourse(course);
  };

  const handleFaceCapture = (imageSrc: string) => {
    setCapturedFaceData(imageSrc);
    setIsLivenessActive(false);
  };

  // จัดการเมื่อผู้ใช้อัปโหลด/ถ่ายรูปบัตร
  const handleIdCardUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIdCardFile(file);
      // สร้าง Preview ให้ผู้ใช้ดูก่อนกดส่ง
      const reader = new FileReader();
      reader.onloadend = () => setIdCardPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // ฟังก์ชันกดยืนยันเช็คชื่อ — ยิง API ไปที่ FastAPI Backend จริง
  const handleSubmitAttendance = async () => {
    if (!capturedFaceData || !idCardFile) return;
    setIsSubmitting(true);

    try {
      // 1. แปลง Base64 ของภาพใบหน้าจาก Liveness เป็น File object
      const faceFile = base64ToFile(capturedFaceData, 'liveness_face.jpg');

      // 2. ส่งข้อมูลไปยัง FastAPI Backend (POST /api/v1/attendance/verify)
      const result = await faceService.verifyAttendance(faceFile, idCardFile);

      // 3. สำเร็จ — เก็บข้อมูลจากหลังบ้านเพื่อแสดงผล
      setResultMessage(result.message);
      setResultStudentId(result.student_id || '');
      setResultScore(result.score ?? null);
      setFinalResult('success');
      
    } catch (error: any) {
      console.error(error);
      setResultMessage(error.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
      setFinalResult('failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <UserCheck className="text-blue-600"/> เช็คชื่อนักศึกษา
      </h1>
      
      {finalResult === 'success' ? (
        /* หน้าจอสุดท้าย: สำเร็จ */
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center shadow-sm">
          <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />
          <h2 className="text-2xl font-bold text-green-700 mb-2">เช็คชื่อสำเร็จ!</h2>
          <p className="text-gray-600 mb-2">{resultMessage}</p>
          {resultStudentId && <p className="text-sm text-gray-500">รหัสนักศึกษา: {resultStudentId}</p>}
          {resultScore !== null && <p className="text-sm text-gray-500">คะแนนความเหมือน: {resultScore}</p>}
        </div>
      ) : finalResult === 'failed' ? (
        /* หน้าจอสุดท้าย: ไม่สำเร็จ */
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center shadow-sm">
           <XCircle size={64} className="mx-auto text-red-500 mb-4" />
           <h2 className="text-2xl font-bold text-red-700 mb-2">เช็คชื่อไม่สำเร็จ</h2>
           <p className="text-gray-600 mb-4">{resultMessage}</p>
           <button onClick={() => { setFinalResult(null); setResultMessage(''); }} className="bg-red-600 text-white px-6 py-2 rounded-lg font-bold">ลองใหม่อีกครั้ง</button>
        </div>
      ) : capturedFaceData ? (
        /* ด่านที่ 3: ถ่ายหน้าเสร็จแล้ว รออัปโหลดบัตรและกดยืนยัน */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
           <h2 className="text-xl font-bold text-gray-800 mb-4">ยืนยันใบหน้าสำเร็จ!</h2>
           <img src={capturedFaceData} alt="Captured Face" className="w-32 h-32 rounded-full mx-auto object-cover border-4 border-green-500 mb-6" />
           
           <div className="mb-6 text-left">
             <label className="block text-sm font-bold text-gray-700 mb-2">อัปโหลดรูปบัตรนักศึกษา (เพื่อเปรียบเทียบ):</label>
             {idCardPreview ? (
               <div className="relative">
                 <img src={idCardPreview} alt="ID Card Preview" className="w-full h-40 object-cover rounded-lg border border-gray-300" />
                 <button onClick={() => { setIdCardFile(null); setIdCardPreview(null); }} className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full text-xs">เปลี่ยนรูป</button>
               </div>
             ) : (
               <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                 <div className="flex flex-col items-center justify-center pt-5 pb-6">
                   <UploadCloud className="w-8 h-8 text-gray-400 mb-2" />
                   <p className="text-sm text-gray-500 font-semibold">คลิกเพื่ออัปโหลด หรือถ่ายรูปบัตร</p>
                 </div>
                 {/* ลูกเล่น capture="environment" ช่วยเปิดกล้องหลังให้ทันทีบนมือถือ */}
                 <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleIdCardUpload} />
               </label>
             )}
           </div>

           <button 
             onClick={handleSubmitAttendance}
             disabled={!idCardFile || isSubmitting}
             className={`w-full font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2
               ${!idCardFile || isSubmitting ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
           >
             {isSubmitting ? <><Loader2 className="animate-spin" size={20} /> กำลังตรวจสอบข้อมูลด้วย AI...</> : 'ยืนยันการเข้าเรียน'}
           </button>
        </div>
      ) : isLivenessActive ? (
        /* ด่านที่ 2: หน้าจอ Liveness Detection */
        <div className="relative">
           <button onClick={() => setIsLivenessActive(false)} className="absolute top-4 right-4 z-30 bg-white/80 p-2 rounded-full text-sm font-bold shadow-md">ยกเลิก</button>
           <LivenessScanner onCaptureSuccess={handleFaceCapture} />
        </div>
      ) : verifiedCourse ? (
        /* ด่านรอยต่อ: ผ่าน QR แล้ว รอสแกนหน้า */
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <h2 className="text-xl font-bold text-green-700 mb-2">เข้าสู่ห้องเรียน {verifiedCourse} แล้ว</h2>
          <p className="text-gray-600 mb-4">ขั้นตอนต่อไป: สแกนใบหน้าเพื่อยืนยันตัวตน</p>
          <button 
             onClick={() => setIsLivenessActive(true)}
             className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg w-full transition-colors"
          >
            เริ่มสแกนใบหน้า (Liveness)
          </button>
        </div>
      ) : isScanning ? (
        /* หน้าจอเปิดกล้องสแกน QR */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-2 relative">
          <button onClick={() => setIsScanning(false)} className="absolute top-4 right-4 z-10 bg-white/80 hover:bg-white text-gray-800 p-2 rounded-full shadow-md text-sm font-bold">ยกเลิก</button>
          <QRScanner onVerifySuccess={handleVerifySuccess} />
        </div>
      ) : (
        /* หน้าจอเริ่มต้น */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">เช็คชื่อเข้าเรียน (Live)</h2>
          <button 
            onClick={() => setIsScanning(true)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors"
          >
            สแกน QR Code หน้าห้องเรียน
          </button>
        </div>
      )}
    </div>
  );
}