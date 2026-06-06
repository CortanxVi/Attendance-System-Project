import React, { useState } from 'react';
import { X } from 'lucide-react';
import axios from 'axios';

interface AddCourseModalProps {
  onClose: () => void;      // ฟังก์ชันสำหรับปิดหน้าต่างป็อปอัป
  onSuccess: () => void;    // ฟังก์ชันสั่งให้หน้าหลักรีโหลดข้อมูลหลังบันทึกสำเร็จ
  teacherId: string;        // ส่ง UUID อาจารย์เข้าไปผูกกับวิชา
}

export default function AddCourseModal({ onClose, onSuccess, teacherId }: AddCourseModalProps) {
  const [courseCode, setCourseCode] = useState<string>('');
  const [courseName, setCourseName] = useState<string>('');
  const [section, setSection] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseCode || !courseName) return;

    try {
      setIsLoading(true);
      // ยิงข้อมูลไปหา API หลังบ้านที่เราเพิ่งสร้างไว้ในขั้นตอนที่ 1
      const response = await axios.post('/api/v1/courses', {
        course_code: courseCode,
        course_name: courseName,
        section: Number(section),
        teacher_id: teacherId
      });

      if (response.data.status === 'success') {
        onSuccess(); // รีเฟรชยอดวิชาบนหน้าจอหลัก
        onClose();   // ปิดหน้าต่างนี้ลงไป
      }
    } catch (error: any) {
      console.error(error);
      const detailMsg = error.response?.data?.detail || error.message || 'ไม่สามารถบันทึกข้อมูลวิชาเรียนลงฐานข้อมูลได้';
      alert(`เกิดข้อผิดพลาด: ${detailMsg}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in border border-gray-100">
        
        {/* หัวข้อโมดอล */}
        <div className="flex justify-between items-center p-6 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">➕ เพิ่มรายวิชาใหม่</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer p-1">
            <X size={20} />
          </button>
        </div>

        {/* ฟอร์มกรอกข้อมูล */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">รหัสวิชา</label>
            <input 
              type="text" 
              placeholder="ตัวอย่าง 030513xxx" 
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">ชื่อรายวิชา</label>
            <input 
              type="text" 
              placeholder="ตัวอย่าง Computer Programming" 
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">หมู่เรียน (Section)</label>
            <input 
              type="number" 
              min="1"
              value={section}
              onChange={(e) => setSection(Number(e.target.value))}
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              required
            />
          </div>

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full mt-4 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-bold py-3 rounded-xl transition-colors cursor-pointer shadow-sm text-sm"
          >
            {isLoading ? 'กำลังบันทึกข้อมูล...' : '💾 บันทึกข้อมูลรายวิชา'}
          </button>
        </form>
      </div>
    </div>
  );
}