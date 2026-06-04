import { useState } from 'react';
import UploadZone from './components/UploadZone';
import CameraZone from './components/CameraZone';
import ImagePreviewWithBBox from './components/ImagePreviewWithBBox';
import { tesseractService } from './services/tesseractService';
import type { OCRResult } from './services/tesseractService';
import { extractStudentId } from './utils/studentIdParser';
import { authService } from './services/authService';
import { useAuth } from './context/AuthContext';
import Swal from 'sweetalert2';

function App() {
  const [useCamera, setUseCamera] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [result, setResult] = useState<OCRResult | null>(null);
  const [extractedStudentId, setExtractedStudentId] = useState<string | null>(null);
  
  const { user, login, logout } = useAuth();

  const handleImageSelect = (file: File) => {
    setImageFile(file);
    setUseCamera(false);
    setResult(null);
    setExtractedStudentId(null);
  };

  const handleConfirmSend = async () => {
    if (!imageFile) return;

    setIsLoading(true);

    // แสดง Popup Loading ทันสมัย
    Swal.fire({
      title: 'กำลังประมวลผล...',
      text: 'ระบบกำลังอ่านข้อความจากรูปภาพ กรุณารอสักครู่',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    try {
      const data = await tesseractService.extractText(imageFile);
      setResult(data);
      
      // พยายามดึงรหัสนักศึกษาจากข้อความที่ได้
      const studentId = extractStudentId(data.text);
      setExtractedStudentId(studentId);
      
      Swal.close(); // ปิด loading

      if (!studentId) {
        Swal.fire({
          icon: 'warning',
          title: 'ไม่พบรหัสนักศึกษา',
          text: 'ระบบไม่สามารถหารหัสนักศึกษาจากรูปได้ กรุณาลองรูปอื่นที่ชัดเจนกว่านี้',
          confirmButtonColor: '#3b82f6'
        });
      }
    } catch (error: any) {
      console.error(error);
      const errorMessage = error.message || error.response?.data?.detail || 'เกิดข้อผิดพลาดในการถอดข้อความ กรุณาลองใหม่อีกครั้ง';
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: errorMessage,
        confirmButtonColor: '#ef4444'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!extractedStudentId) return;
    
    setIsLoggingIn(true);
    try {
      const response = await authService.loginWithStudentId(extractedStudentId);
      login(response);
      Swal.fire({
        icon: 'success',
        title: 'เข้าสู่ระบบสำเร็จ!',
        text: `ยินดีต้อนรับ ${response.user.full_name} (${response.user.student_id})`,
        confirmButtonColor: '#16a34a'
      });
    } catch (error: any) {
      console.error(error);
      const errorMessage = error.response?.data?.detail || 'รหัสนักศึกษานี้ไม่ถูกต้อง หรือไม่พบในระบบ';
      Swal.fire({
        icon: 'error',
        title: 'ไม่สามารถเข้าสู่ระบบได้',
        text: errorMessage,
        confirmButtonColor: '#ef4444'
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <header className="max-w-6xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-center text-center md:text-left gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">OCR</h1>
          <p className="text-slate-500 mt-2">ระบบถอดข้อความจากรูปภาพ (รองรับภาษาไทยและอังกฤษ)</p>
        </div>
        {user && (
          <div className="bg-blue-50 text-blue-800 px-4 py-2 rounded-lg border border-blue-200 flex items-center gap-3">
            <div className="text-sm">
              <span className="block font-semibold">{user.full_name}</span>
              <span className="block text-blue-600 text-xs">รหัสนักศึกษา: {user.student_id}</span>
            </div>
            <button 
              onClick={logout}
              className="text-xs bg-white text-slate-600 px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
            >
              ออกจากระบบ
            </button>
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto flex flex-col gap-8">
        
        {/* Panel รับรูปภาพและแสดงพรีวิว */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-slate-700">รูปภาพต้นฉบับ</h2>
            {!useCamera && (
              <button 
                onClick={() => setUseCamera(true)}
                className="text-sm px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path></svg>
                เปิดกล้อง
              </button>
            )}
          </div>

          {useCamera ? (
            <CameraZone 
              onImageCaptured={handleImageSelect} 
              onCancel={() => setUseCamera(false)} 
            />
          ) : !imageFile ? (
            <UploadZone onImageSelected={handleImageSelect} />
          ) : (
            <div className="flex flex-col gap-4 animate-fade-in">
              <ImagePreviewWithBBox imageFile={imageFile} words={result?.words || []} />
              
              {!result && (
                <div className="flex flex-col sm:flex-row gap-3 mt-2">
                  <button 
                    onClick={handleConfirmSend}
                    disabled={isLoading}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors flex justify-center items-center shadow-sm"
                  >
                    {isLoading ? 'กำลังส่งข้อมูล...' : 'ส่งภาพเพื่ออ่านรหัส'}
                  </button>
                  <button 
                    onClick={() => setImageFile(null)}
                    disabled={isLoading}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-lg transition-colors"
                  >
                    ยกเลิก / ถ่ายใหม่
                  </button>
                </div>
              )}

              {result && (
                <button 
                  onClick={() => {
                    setImageFile(null);
                    setResult(null);
                    setExtractedStudentId(null);
                  }}
                  className="text-slate-500 text-sm hover:text-slate-700 underline text-center mt-2"
                >
                  เลือกรูปภาพใหม่
                </button>
              )}
            </div>
          )}
        </section>

        {/* ส่วนของการเข้าสู่ระบบด้วยรหัสนักศึกษา */}
        {extractedStudentId && !user && (
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-4">
            <div className="p-5 bg-green-50 border border-green-200 rounded-xl flex flex-col items-center gap-3 animate-fade-in">
              <div className="flex items-center gap-2 text-green-700">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span className="font-medium">ตรวจพบรหัสนักศึกษา: <strong>{extractedStudentId}</strong></span>
              </div>
              <button 
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold py-2.5 rounded-lg transition-colors flex justify-center items-center gap-2"
              >
                {isLoggingIn ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    กำลังตรวจสอบ...
                  </>
                ) : (
                  'เข้าสู่ระบบด้วยรหัสนักศึกษานี้'
                )}
              </button>
            </div>
          </section>
        )}

      </main>
    </div>
  );
}

export default App;
