import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

export const importStudents = async (courseId: number, file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await axios.post(`${API_URL}/import/students/${courseId}`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const getReportSummary = async (courseId: number) => {
  const response = await axios.get(`${API_URL}/report/${courseId}/summary`);
  return response.data;
};

export const getExportUrl = (courseId: number, format: 'excel' | 'csv' | 'pdf') => {
  return `${API_URL}/report/${courseId}/export/${format}`;
};
