import axios from 'axios';

// ใช้ relative path เพื่อให้ Vite Dev Proxy ส่งต่อไปยัง FastAPI (localhost:8000) ให้อัตโนมัติ
const API_BASE_URL = '/api/v1';

// กำหนด Type สำหรับ Response ที่จะได้จากหลังบ้าน
export interface RegisterResponse {
  success: boolean;
  student_id?: string;
  message: string;
  detail?: string; // กรณีเกิด Error จาก FastAPI
}

export interface VerifyResponse {
  success: boolean;
  student_id?: string;
  score?: number;
  message: string;
  detail?: string; // กรณีเกิด Error จาก FastAPI
}

export const faceService = {
  // ฟังก์ชันยิง API ลงทะเบียนใบหน้า
  registerFace: async (studentId: string, faceImage: File): Promise<RegisterResponse> => {
    const formData = new FormData();
    formData.append('student_id', studentId);
    formData.append('face_image', faceImage); // แนบไฟล์รูป

    try {
      const response = await axios.post<RegisterResponse>(
        `${API_BASE_URL}/enrollment/register-face`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      return response.data;
    } catch (error: any) {
      // ดักจับ Error ที่ส่งมาจาก FastAPI (เช่น 400 Bad Request)
      if (error.response && error.response.data) {
        throw new Error(error.response.data.detail || 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
      }
      throw new Error('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    }
  },

  // ฟังก์ชันยิง API ยืนยันตัวตนเช็คชื่อ (ใบหน้าสด + รูปบัตรนักศึกษา)
  verifyAttendance: async (faceImage: File, idCardImage: File): Promise<VerifyResponse> => {
    const formData = new FormData();
    formData.append('face_image', faceImage);       // ภาพถ่ายใบหน้าสดจาก Liveness
    formData.append('id_card_image', idCardImage);   // ภาพบัตรนักศึกษา

    try {
      const response = await axios.post<VerifyResponse>(
        `${API_BASE_URL}/attendance/verify`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      return response.data;
    } catch (error: any) {
      // ดักจับ Error ที่ส่งมาจาก FastAPI (เช่น 400, 401, 404)
      if (error.response && error.response.data) {
        throw new Error(error.response.data.detail || 'เกิดข้อผิดพลาดในการยืนยันตัวตน');
      }
      throw new Error('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่าระบบหลังบ้านทำงานอยู่');
    }
  },
};