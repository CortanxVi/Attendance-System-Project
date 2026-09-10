import { useState } from 'react';
import { X } from 'lucide-react';
import axios from 'axios';
import { useNotification } from '../../components/notifications/notificationContext';
import { apiErrorMessage } from '../../services/apiError';

interface AddCourseModalProps {
  onClose: () => void;      // ฟังก์ชันสำหรับปิดหน้าต่างป็อปอัป
  onSuccess: () => void;    // ฟังก์ชันสั่งให้หน้าหลักรีโหลดข้อมูลหลังบันทึกสำเร็จ
}

export default function AddCourseModal({ onClose, onSuccess }: AddCourseModalProps) {
  const { notify } = useNotification();
  const [courseCode, setCourseCode] = useState<string>('');
  const [courseName, setCourseName] = useState<string>('');
  const [section, setSection] = useState<number>(1);
  const [year, setYear] = useState<number>(0);
  const [semester, setSemester] = useState<number>(1);
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
        year: Number(year),
        semester: Number(semester),
      });

      if (response.data.status === 'success') {
        onSuccess(); // รีเฟรชยอดวิชาบนหน้าจอหลัก
        onClose();   // ปิดหน้าต่างนี้ลงไป
      }
    } catch (error: unknown) {
      console.error(error);
      const detailMsg = apiErrorMessage(error, 'ไม่สามารถบันทึกข้อมูลวิชาเรียนลงฐานข้อมูลได้');
      notify(`เพิ่มรายวิชาไม่สำเร็จ: ${detailMsg}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-2xl animate-fade-in sm:max-h-[calc(100dvh-2rem)]">
        
        {/* หัวข้อโมดอล */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white p-4 sm:p-6">
          <h3 className="text-lg font-bold text-gray-900">➕ เพิ่มรายวิชาใหม่</h3>
          <button type="button" aria-label="ปิดหน้าต่างเพิ่มรายวิชา" onClick={onClose} className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
            <X size={20} />
          </button>
        </div>

        {/* ฟอร์มกรอกข้อมูล */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4 p-4 sm:p-6">
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

          <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2">
            <div className="flex-1">
              <label className="block text-sm font-bold text-gray-700 mb-1">ภาคการศึกษา (Semester)</label>
              <input 
                type="number" 
                min="1"
                max="3"
                value={semester}
                onChange={(s) => setSemester(Number(s.target.value))}
                className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                required
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-bold text-gray-700 mb-1">ปีการศึกษา (Year)</label>
              <input 
                type="number"
                min="1"
                value={year}
                onChange={(y) => setYear(Number(y.target.value))}
                className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                required
              />
            </div>
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
