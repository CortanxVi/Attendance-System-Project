import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import LiveAttendance from './LiveAttendance'; // นำเข้า Component ใหม่

export default function TeacherDashboard() {
  const [isLive, setIsLive] = useState(false); // ควบคุมการเปิดปิดหน้า QR

  return (
    <div>
      {/* ถ้า isLive เป็น true จะแสดงหน้าจอ QR Code แบบเต็มจอ */}
      {isLive && <LiveAttendance courseCode="CS301" onClose={() => setIsLive(false)} />}
      
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">รายวิชาที่สอน</h2>
        <button className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors cursor-pointer shadow-sm">
          <Plus size={18} />
          เพิ่มรายวิชาใหม่
        </button>
      </div>

      {/* การ์ดตัวอย่างวิชาเรียน */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <div>
              <span className="inline-block px-2 py-1 bg-green-100 text-green-700 text-xs font-bold rounded mb-2">CS301</span>
              <h3 className="font-bold text-lg text-gray-900">Software Engineering</h3>
            </div>
          </div>
          <div className="text-sm text-gray-600 space-y-1 mb-6">
            <p>Section: 1</p>
            <p>นักศึกษาทั้งหมด: 45 คน</p>
          </div>
          <button 
            onClick={() => setIsLive(true)}
            className="w-full bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium py-2 rounded-lg border border-blue-200 transition-colors cursor-pointer"
          >
            เปิดระบบเช็คชื่อ (สร้าง QR)
          </button>
        </div>
      </div>
    </div>
  );
}