import React, { useState } from 'react';
import { Plus, CreditCard, Power, QrCode } from 'lucide-react';
import axios from 'axios';
import LiveAttendance from './LiveAttendance'; 
import NFCManager from './NFCManager'; // 🌟 นำเข้า NFCManager เข้ามาใช้งานร่วมกัน

export default function TeacherDashboard() {
  // 🌟 State ควบคุมการเปิด-ปิดหน้าต่าง UI แยกจากกันอิสระ
  const [isLive, setIsLive] = useState(false); 
  const [isNfcOpen, setIsNfcOpen] = useState(false); 
  
  // 🌟 State สำหรับเก็บรหัสเซสชันจริงจากหลังบ้าน
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // 💡 ข้อมูลจำลองสิทธิ์ระบบ (ในระบบจริงต้องดึงมาจากการ Login ของอาจารย์)
  const mockCourseId = "ใส่_UUID_ของวิชาจากตาราง_courses_ตรงนี้"; 
  const mockTeacherId = "ใส่_UUID_ของอาจารย์จากตาราง_auth_users_ตรงนี้";

  // ฟังก์ชันกดยิง API เพื่อเปิดคลาสเรียนใหม่
  const handleStartSession = async () => {
    try {
      setIsCreatingSession(true);
      const response = await axios.post('/api/v1/sessions/start', {
        course_id: mockCourseId,
        teacher_id: mockTeacherId
      });

      if (response.data.status === 'success') {
        // เก็บรหัสเซสชันที่ได้จากฐานข้อมูลลงใน State หลัก
        setActiveSessionId(response.data.session_id);
      }
    } catch (error) {
      console.error(error);
      alert("เกิดข้อผิดพลาดในการเปิดเซสชัน กรุณาตรวจสอบการเชื่อมต่อ Server หลังบ้าน");
    } finally {
      setIsCreatingSession(false);
    }
  };

  // ฟังก์ชันปิดเซสชันและล้างค่าหน้าจอทั้งหมด
  const handleEndSession = () => {
    if (window.confirm("คุณต้องการปิดคลาสและสิ้นสุดการเช็คชื่อของวิชานี้ใช่หรือไม่?")) {
      setActiveSessionId(null);
      setIsLive(false);
      setIsNfcOpen(false);
      // 💡 ในอนาคตสามารถยิง API /sessions/end เพื่ออัปเดต status เป็น closed ในฐานข้อมูลได้ที่ตรงนี้
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      
      {/* 🌟 1. หน้าต่างส่อง QR Code (เปิด-ปิดแยกอิสระ โดยไม่ทำให้ Session หลุด) */}
      {isLive && activeSessionId && (
        <LiveAttendance 
          courseCode="CS301" 
          activeSessionId={activeSessionId} 
          onClose={() => setIsLive(false)} 
        />
      )}
      
      {/* 🌟 2. หน้าต่างเครื่องสแกน NFC (เปิด-ปิดแยกอิสระ สามารถทำควบคู่กันได้) */}
      {isNfcOpen && activeSessionId && (
        <NFCManager 
          defaultCourseCode="CS301" 
          activeSessionId={activeSessionId} 
          onClose={() => setIsNfcOpen(false)} 
        />
      )}
      
      {/* ส่วนหัวหน้าจอ */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">รายวิชาที่สอน</h2>
        <button className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors cursor-pointer shadow-sm">
          <Plus size={18} />
          เพิ่มรายวิชาใหม่
        </button>
      </div>

      {/* การ์ดวิชาเรียน */}
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
          
          {/* 🌟 3. เงื่อนไขการแสดงผลปุ่มตาม Lifecycle ของจริง */}
          {!activeSessionId ? (
            // สถานะปกติ: ยังไม่ได้เปิดวิชาเรียน
            <button 
              onClick={handleStartSession}
              disabled={isCreatingSession}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors cursor-pointer flex justify-center items-center gap-2 text-sm shadow-sm"
            >
              <Power size={16} />
              {isCreatingSession ? 'กำลังเปิดระบบ...' : 'เปิดระบบเช็คชื่อ (Start Session)'}
            </button>
          ) : (
            // สถานะเปิดคลาสแล้ว: แสดงแผงควบคุมระบบย่อย
            <div className="space-y-3 animate-fade-in">
              <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-center text-emerald-800 text-xs font-bold">
                🟢 ห้องเรียนนี้กำลังเปิดรับข้อมูลเช็คชื่อ
              </div>
              
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsLive(true)}
                  className="flex-1 bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-3 rounded-lg border border-gray-300 transition-colors cursor-pointer flex justify-center items-center gap-1.5 text-xs"
                >
                  <QrCode size={14} />
                  ฉายจอ QR Code
                </button>
                <button 
                  onClick={() => setIsNfcOpen(true)}
                  className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-medium py-2 px-3 rounded-lg transition-colors cursor-pointer flex justify-center items-center gap-1.5 text-xs"
                >
                  <CreditCard size={14} />
                  เครื่องสแกน NFC
                </button>
              </div>
              
              <button 
                onClick={handleEndSession}
                className="w-full text-red-600 hover:bg-red-50 font-medium py-2 rounded-lg transition-colors cursor-pointer text-xs text-center block mt-1"
              >
                ปิดรับเช็คชื่อ (End Session)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}