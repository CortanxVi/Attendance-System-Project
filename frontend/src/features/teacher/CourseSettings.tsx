import React, { useState } from 'react';
import axios from 'axios';
import { X, Settings, Save } from 'lucide-react';

// 🌟 1. กำหนดรูปแบบโครงสร้างข้อมูล (Type Definition) สำหรับการตั้งค่า
interface CourseConfig {
  total_sessions?: number;
  late_threshold_minutes?: number;
  absent_threshold_minutes?: number;
  max_absence_percent?: number;
}

// 🌟 2. กำหนด Interface สำหรับ Props ที่จะรับเข้ามาใน Component นี้
interface CourseSettingsModalProps {
  courseId: string;
  currentConfig: CourseConfig;
  onSaveSuccess: () => void;
  onClose: () => void; // เพิ่มฟังก์ชันปิดหน้าต่างเข้ามาด้วยเพื่อความสมบูรณ์
}

export default function CourseSettingsModal({ 
  courseId, 
  currentConfig, 
  onSaveSuccess, 
  onClose 
}: CourseSettingsModalProps) { // 🌟 3. นำ Interface มาครอบชุดตัวแปรตรงนี้

  // กำหนดค่าเริ่มต้นให้กับ State โดยมี Fallback เผื่อกรณียังไม่เคยตั้งค่ามาก่อน
  const [totalSessions, setTotalSessions] = useState(currentConfig?.total_sessions || 15);
  const [lateMinutes, setLateMinutes] = useState(currentConfig?.late_threshold_minutes || 15);
  const [absentMinutes, setAbsentMinutes] = useState(currentConfig?.absent_threshold_minutes || 45);
  const [maxAbsentPct, setMaxAbsentPct] = useState(currentConfig?.max_absence_percent || 20);
  const [isSaving, setIsSaving] = useState(false);

  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      await axios.put(`/api/v1/courses/${courseId}/settings`, {
        total_sessions: Number(totalSessions),
        late_threshold_minutes: Number(lateMinutes),
        absent_threshold_minutes: Number(absentMinutes),
        max_absence_percent: Number(maxAbsentPct)
      });
      
      alert("✅ บันทึกเกณฑ์การเข้าเรียนใหม่สำเร็จ!");
      onSaveSuccess(); // รีเฟรชข้อมูลที่หน้าหลัก
      onClose();       // ปิดหน้าต่างลง
    } catch (error: any) {
      console.error(error);
      const detailMsg = error.response?.data?.detail || error.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูลตั้งค่า';
      alert(`${detailMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in">
        
        {/* ส่วนหัวหน้าต่าง */}
        <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-gray-50">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Settings size={20} className="text-slate-600" /> 
            ตั้งค่าเกณฑ์รายวิชา
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-md hover:bg-gray-200">
            <X size={20} />
          </button>
        </div>

        {/* ส่วนฟอร์มกรอกข้อมูล */}
        <form onSubmit={handleUpdateConfig} className="p-6 space-y-5">
          
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              จำนวนครั้งที่เรียนทั้งหมดในเทอมนี้ (ครั้ง)
            </label>
            <input 
              type="number" 
              min="1"
              value={totalSessions} 
              onChange={e => setTotalSessions(Number(e.target.value))} 
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              มาหลังเริ่มคลาสเกิน (นาที) <span className="text-orange-500">➡️ ถือว่า "มาสาย"</span>
            </label>
            <input 
              type="number" 
              min="0"
              value={lateMinutes} 
              onChange={e => setLateMinutes(Number(e.target.value))} 
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500" 
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              มาหลังเริ่มคลาสเกิน (นาที) <span className="text-red-500">➡️ ถือว่า "ขาดเรียน"</span>
            </label>
            <input 
              type="number" 
              min="0"
              value={absentMinutes} 
              onChange={e => setAbsentMinutes(Number(e.target.value))} 
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500" 
            />
          </div>

          <div className="pt-2 border-t border-gray-100">
            <label className="block text-sm font-bold text-gray-700 mb-1">
              เปอร์เซ็นต์ขาดเรียนสูงสุด (%) <span className="text-purple-600">เกินนี้ได้ Fa</span>
            </label>
            <input 
              type="number" 
              min="0"
              max="100"
              value={maxAbsentPct} 
              onChange={e => setMaxAbsentPct(Number(e.target.value))} 
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500" 
            />
            <p className="text-xs text-gray-500 mt-2 bg-gray-50 p-2 rounded-lg border border-gray-100">
              * ขาดเรียนได้ไม่เกิน <b>{Math.floor(totalSessions * (Number(maxAbsentPct)/100))}</b> ครั้งต่อเทอม
            </p>
          </div>

          <button 
            type="submit" 
            disabled={isSaving}
            className="w-full mt-2 bg-slate-800 hover:bg-slate-900 disabled:bg-gray-400 text-white font-bold py-3 rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm"
          >
            <Save size={18} />
            {isSaving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
          </button>
        </form>

      </div>
    </div>
  );
}