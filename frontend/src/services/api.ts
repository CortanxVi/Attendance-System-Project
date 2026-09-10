import axios from 'axios';
import { apiErrorMessage } from './apiError';
import type { LivenessEvidence } from '../utils/liveness';

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
  student_name?: string;
  method?: 'face_ocr';
  score?: number;
  calculated_status?: 'present' | 'late' | 'absent'; // 🌟 [เพิ่มใหม่] สถานะจริงที่คำนวณจากเวลาที่ผ่านมา (มีก็ต่อเมื่อส่ง sessionId มาด้วย)
  check_in_time?: string;
  message: string;
  detail?: string; // กรณีเกิด Error จาก FastAPI
}

export interface EnrollmentLivenessChallenge {
  challenge_id: string;
  student_id: string;
  challenge_expires_at: string;
  challenge_ttl_seconds: number;
  liveness_token: string;
  liveness_actions: ('move_closer' | 'blink')[];
  liveness_required_blinks: number;
  liveness_prompt_delay_ms: number;
}

export const faceService = {
  createEnrollmentLivenessChallenge: async (studentCardImage: File): Promise<EnrollmentLivenessChallenge> => {
    const formData = new FormData();
    formData.append('student_card_image', studentCardImage);
    try {
      const response = await axios.post<EnrollmentLivenessChallenge>(
        `${API_BASE_URL}/enrollment/liveness-challenge`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 46_000 },
      );
      return response.data;
    } catch (error: unknown) {
      throw new Error(apiErrorMessage(error, 'ไม่สามารถสร้างสิทธิ์ Liveness สำหรับลงทะเบียนได้'), { cause: error });
    }
  },

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
    } catch (error: unknown) {
      throw new Error(apiErrorMessage(error, 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้'), { cause: error });
    }
  },

  registerFaceWithLiveness: async (
    studentId: string,
    challengeId: string,
    livenessToken: string,
    capture: {
      faceImage: File;
      baselineImage: File;
      nearImage: File;
      returnImage: File;
      blinkClosedImages: File[];
      blinkOpenImages: File[];
      evidence: LivenessEvidence;
    },
  ): Promise<RegisterResponse> => {
    const formData = new FormData();
    formData.append('student_id', studentId);
    formData.append('enrollment_challenge_id', challengeId);
    formData.append('liveness_token', livenessToken);
    formData.append('liveness_evidence', JSON.stringify(capture.evidence));
    formData.append('face_image', capture.faceImage);
    formData.append('liveness_baseline_image', capture.baselineImage);
    formData.append('liveness_near_image', capture.nearImage);
    formData.append('liveness_return_image', capture.returnImage);
    capture.blinkClosedImages.forEach((image) => formData.append('liveness_blink_closed_images', image));
    capture.blinkOpenImages.forEach((image) => formData.append('liveness_blink_open_images', image));
    try {
      const response = await axios.post<RegisterResponse>(
        `${API_BASE_URL}/enrollment/register-face`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000 },
      );
      return response.data;
    } catch (error: unknown) {
      throw new Error(apiErrorMessage(error, 'ลงทะเบียนใบหน้าด้วย Liveness ไม่สำเร็จ'), { cause: error });
    }
  },

  // ฟังก์ชันยิง API ยืนยันตัวตนเช็คชื่อ (ใบหน้าสด + รูปบัตรนักศึกษาหรือรหัสนักศึกษา)
  // 🌟 [เพิ่มใหม่] sessionId เป็น parameter แบบไม่บังคับ — ถ้ามี (มาจากการสแกน QR ผ่านแล้ว)
  // จะถูกส่งไปให้ backend ผูกกับคาบเรียนจริง และคำนวณสาย/ขาดให้ถูกต้อง
  verifyAttendance: async (
    faceImage: File,
    baselineImage: File,
    nearImage: File,
    returnImage: File,
    blinkClosedImages: File[],
    blinkOpenImages: File[],
    idCardImage: File,
    challengeId: string,
    livenessToken: string,
    livenessEvidence: LivenessEvidence,
  ): Promise<VerifyResponse> => {
    const formData = new FormData();
    formData.append('face_image', faceImage);
    formData.append('liveness_baseline_image', baselineImage);
    formData.append('liveness_near_image', nearImage);
    formData.append('liveness_return_image', returnImage);
    blinkClosedImages.forEach((image) => formData.append('liveness_blink_closed_images', image));
    blinkOpenImages.forEach((image) => formData.append('liveness_blink_open_images', image));
    formData.append('id_card_image', idCardImage);
    formData.append('challenge_id', challengeId);
    formData.append('liveness_token', livenessToken);
    formData.append('liveness_evidence', JSON.stringify(livenessEvidence));

    try {
      const response = await axios.post<VerifyResponse>(
        `${API_BASE_URL}/attendance/verify`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          timeout: 46_000,
        }
      );
      return response.data;
    } catch (error: unknown) {
      throw new Error(
        apiErrorMessage(error, 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่าระบบหลังบ้านทำงานอยู่'),
        { cause: error },
      );
    }
  },
};
