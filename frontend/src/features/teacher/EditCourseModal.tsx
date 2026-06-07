import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import axios from 'axios';

interface Course {
  id: string;
  course_code: string;
  course_name: string;
  section: number;
  semester?: number;
  year?: number;
}

interface EditCourseModalProps {
  course: Course;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditCourseModal({ course, onClose, onSuccess }: EditCourseModalProps) {
  const [courseCode, setCourseCode] = useState(course.course_code);
  const [courseName, setCourseName] = useState(course.course_name);
  const [section, setSection] = useState(course.section);
  const [year, setYear] = useState(course.year || new Date().getFullYear() + 543);
  const [semester, setSemester] = useState(course.semester || 1);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      await axios.put(`/api/v1/courses/${course.id}`, {
        course_code: courseCode,
        course_name: courseName,
        section: Number(section),
        year: Number(year),
        semester: Number(semester),
      });
      alert("✅ แก้ไขข้อมูลวิชาสำเร็จ!");
      onSuccess();
      onClose();
    } catch (error: any) {
      alert(`❌ เกิดข้อผิดพลาด: ${error.response?.data?.detail || "ไม่สามารถอัปเดตได้"}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in border border-gray-100">
        <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-gray-50">
          <h3 className="text-lg font-bold text-gray-900">✏️ แก้ไขข้อมูลรายวิชา</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div><label className="block text-sm font-bold text-gray-700 mb-1">รหัสวิชา</label><input type="text" value={courseCode} onChange={(e) => setCourseCode(e.target.value)} className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500" required /></div>
          <div><label className="block text-sm font-bold text-gray-700 mb-1">ชื่อรายวิชา</label><input type="text" value={courseName} onChange={(e) => setCourseName(e.target.value)} className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500" required /></div>
          <div><label className="block text-sm font-bold text-gray-700 mb-1">หมู่เรียน (Section)</label><input type="number" min="1" value={section} onChange={(e) => setSection(Number(e.target.value))} className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500" required /></div>
          <div className="flex gap-4">
            <div className="flex-1"><label className="block text-sm font-bold text-gray-700 mb-1">ภาคการศึกษา</label><input type="number" min="1" max="3" value={semester} onChange={(e) => setSemester(Number(e.target.value))} className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500" required /></div>
            <div className="flex-1"><label className="block text-sm font-bold text-gray-700 mb-1">ปีการศึกษา</label><input type="number" min="1" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500" required /></div>
          </div>
          <button type="submit" disabled={isLoading} className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-xl flex justify-center items-center gap-2"><Save size={18} /> {isLoading ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}</button>
        </form>
      </div>
    </div>
  );
}