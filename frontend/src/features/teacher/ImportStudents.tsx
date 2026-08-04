import { useState } from 'react';
import axios from 'axios';
import { UploadCloud, FileText, CheckCircle, AlertCircle } from 'lucide-react';

export default function ImportStudents() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      if (selected.name.endsWith('.csv')) {
        setFile(selected);
        setMessage(null);
      } else {
        setFile(null);
        setMessage({ type: 'error', text: 'กรุณาอัปโหลดไฟล์นามสกุล .csv เท่านั้น' });
      }
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage({ type: 'error', text: 'กรุณาเลือกไฟล์ก่อนนำเข้า' });
      return;
    }

    setLoading(true);
    setMessage(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post('/api/v1/teacher/import/students', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setMessage({ type: 'success', text: res.data.message || 'นำเข้าสำเร็จ' });
      setFile(null);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'เกิดข้อผิดพลาดในการนำเข้า' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
          <UploadCloud className="text-orange-500 w-8 h-8" /> นำเข้ารายชื่อนักศึกษาด้วย CSV
        </h2>
        <p className="text-gray-500 mb-8">
          อัปโหลดไฟล์นามสกุล .csv ที่มีคอลัมน์ <code className="bg-gray-100 px-2 py-1 rounded">student_id</code> และ <code className="bg-gray-100 px-2 py-1 rounded">full_name</code> เพื่อเพิ่มนักศึกษาเข้าสู่ระบบ
        </p>

        {message && (
          <div className={`p-4 rounded-lg mb-6 flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {message.text}
          </div>
        )}

        <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:bg-gray-50 transition-colors">
          <input 
            type="file" 
            accept=".csv" 
            onChange={handleFileChange} 
            className="hidden" 
            id="csv-upload"
          />
          <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center">
            {file ? (
              <>
                <FileText className="w-16 h-16 text-orange-500 mb-4" />
                <p className="text-lg font-medium text-gray-800">{file.name}</p>
                <p className="text-sm text-gray-500 mt-1">{(file.size / 1024).toFixed(2)} KB</p>
                <span className="mt-4 text-orange-600 text-sm font-semibold hover:underline">เปลี่ยนไฟล์</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-16 h-16 text-gray-400 mb-4" />
                <p className="text-lg font-medium text-gray-800">คลิกที่นี่เพื่อเลือกไฟล์ CSV</p>
                <p className="text-sm text-gray-500 mt-1">รองรับเฉพาะไฟล์ .csv เท่านั้น</p>
              </>
            )}
          </label>
        </div>

        <div className="mt-8 flex justify-end">
          <button 
            onClick={handleUpload}
            disabled={!file || loading}
            className={`px-6 py-3 rounded-lg font-bold text-white shadow-md transition-all ${
              !file || loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-orange-500 to-red-500 hover:shadow-lg hover:-translate-y-0.5'
            }`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                กำลังนำเข้า...
              </span>
            ) : 'เริ่มการนำเข้า'}
          </button>
        </div>
        
        <div className="mt-10 bg-gray-50 p-4 rounded-lg border border-gray-100">
          <h3 className="text-sm font-bold text-gray-700 mb-2">ตัวอย่างโครงสร้างไฟล์ CSV</h3>
          <div className="bg-white p-3 rounded border border-gray-200 overflow-x-auto text-sm font-mono text-gray-600">
            student_id,full_name<br/>
            6401012620000,นายสมชาย ใจดี<br/>
            6401012620001,นางสาวสมหญิง น่ารัก
          </div>
        </div>
      </div>
    </div>
  );
}
