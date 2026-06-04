import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface User {
  student_id: string;
  full_name: string;
}

export interface LoginResponse {
  message: string;
  token: string;
  user: User;
}

export const authService = {
  loginWithStudentId: async (studentId: string): Promise<LoginResponse> => {
    const response = await axios.post<LoginResponse>(`${API_URL}/api/auth/login-with-id`, {
      student_id: studentId
    });
    return response.data;
  }
};
