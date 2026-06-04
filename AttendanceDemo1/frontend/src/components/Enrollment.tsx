import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { faceService } from '../services/api';
import { base64ToFile } from '../utils/imageUtils';

const Enrollment: React.FC = () => {
  const webcamRef = useRef<Webcam>(null);
  const [studentId, setStudentId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  const captureAndRegister = useCallback(async () => {
    if (!studentId) {
      setMessage('❌ กรุณากรอกรหัสนักศึกษาก่อน');
      return;
    }

    // 1. แคปรูปจาก Webcam (ได้มาเป็น Base64)
    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) {
      setMessage('❌ ไม่สามารถจับภาพจากกล้องได้');
      return;
    }

    try {
      setLoading(true);
      setMessage('กำลังประมวลผลใบหน้า... ⏳');

      // 2. แปลง Base64 เป็น File object
      const imageFile = base64ToFile(imageSrc, `face_${studentId}.jpg`);

      // 3. ส่งข้อมูลไปที่ FastAPI
      const result = await faceService.registerFace(studentId, imageFile);
      
      setMessage(`✅ ${result.message}`);
      setStudentId(''); // ล้างช่องกรอกข้อมูลเมื่อสำเร็จ
      
    } catch (error: any) {
      setMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [webcamRef, studentId]);

  return (
    <div style={{ textAlign: 'center', padding: '20px' }}>
      <h2>ลงทะเบียนใบหน้า (ถอดแว่นตาและหน้ากากอนามัย)</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          videoConstraints={{ width: 640, height: 480, facingMode: "user" }}
          style={{ borderRadius: '10px', border: '2px solid #ccc' }}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="รหัสนักศึกษา 13 หลัก"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          style={{ padding: '10px', width: '200px', marginRight: '10px' }}
        />
        <button 
          onClick={captureAndRegister} 
          disabled={loading}
          style={{ padding: '10px 20px', cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'กำลังบันทึก...' : '📸 ถ่ายรูปและลงทะเบียน'}
        </button>
      </div>

      {message && (
        <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
          <strong>{message}</strong>
        </div>
      )}
    </div>
  );
};

export default Enrollment;