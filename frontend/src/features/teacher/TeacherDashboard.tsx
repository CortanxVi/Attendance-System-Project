import React, { useState, useEffect } from 'react';
import { Plus, CreditCard, Power, QrCode, Settings } from 'lucide-react';
import axios from 'axios';
import { supabase } from '../../lib/supabaseClient';
import LiveAttendance from './LiveAttendance'; 
import NFCManager from './NFCManager';
import AddCourseModal from './AddCourseModal';
import CourseSettingsModal from './CourseSettings';

// 🌟 Interface มารองรับฟิลด์เกณฑ์การตั้งค่าที่จะดึงมาจากฐานข้อมูล
interface Course {
  id: string;
  course_code: string;
  course_name: string;
  section: number;
  total_sessions?: number;
  late_threshold_minutes?: number;
  absent_threshold_minutes?: number;
  max_absence_percent?: number;
}

export default function TeacherDashboard() {
  // 🌟 State ของระบบเช็คชื่อ
  const [isLive, setIsLive] = useState(false); 
  const [isNfcOpen, setIsNfcOpen] = useState(false); 
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentSelectedCourseCode, setCurrentSelectedCourseCode] = useState('');
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // 🌟 State สำหรับควบคุมการเปิด-ปิดหน้าต่างตั้งค่าเกณฑ์รายวิชา
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [selectedCourseForConfig, setSelectedCourseForConfig] = useState<Course | null>(null);

  // 💡 UUID จำลองของอาจารย์ (ใส่ของจริงของคุณตรงนี้)
  const mockTeacherId = "de9c3f99-5867-4340-a813-1b8dc447f9cc"; 
  const [teacherId, setTeacherId] = useState<string>(mockTeacherId);

  useEffect(() => {
    const resolveTeacherId = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          setTeacherId(session.user.id);
          fetchCourses(session.user.id);
        } else {
          fetchCourses(mockTeacherId);
        }
      } catch (error) {
        console.error("Error fetching session:", error);
        fetchCourses(mockTeacherId);
      }
    };
    resolveTeacherId();
  }, []);

  const fetchCourses = async (tId: string) => {
    try {
      setIsLoading(true);
      const response = await axios.get(`/api/v1/courses/${tId}`);
      if (response.data.status === 'success') {
        setCourses(response.data.courses);
      }
    } catch (error) {
      console.error("Error loading courses:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartSession = async (courseId: string, courseCode: string) => {
    try {
      setIsCreatingSession(true);
      setCurrentSelectedCourseCode(courseCode);
      const response = await axios.post('/api/v1/sessions/start', {
        course_id: courseId,
        teacher_id: teacherId
      });

      if (response.data.status === 'success') {
        setActiveSessionId(response.data.session_id);
      }
    } catch (error: any) {
      alert(`ไม่สามารถเปิดห้องเรียนได้: ${error.response?.data?.detail || "Error"}`);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleEndSession = async () => {
    if (!activeSessionId) return;
    if (window.confirm("คุณต้องการปิดคลาสและบันทึกเวลาสิ้นสุดการเช็คชื่อใช่หรือไม่?")) {
      try {
        await axios.post(`/api/v1/sessions/${activeSessionId}/close`);
        setActiveSessionId(null);
        setIsLive(false);
        setIsNfcOpen(false);
        alert("ปิดระบบและบันทึกเวลาลงฐานข้อมูลเรียบร้อยแล้ว");
      } catch (error) {
        alert("เกิดข้อผิดพลาดในการเชื่อมต่อเพื่อปิดเซสชัน");
      }
    }
  };

  return (
    <>
      {/* 🌟 หน้าต่างป็อปอัปทับหน้าจอ */}
      {isLive && activeSessionId && (
        <LiveAttendance courseCode={currentSelectedCourseCode} activeSessionId={activeSessionId} onClose={() => setIsLive(false)} />
      )}
      {isNfcOpen && activeSessionId && (
        <NFCManager defaultCourseCode={currentSelectedCourseCode} activeSessionId={activeSessionId} onClose={() => setIsNfcOpen(false)} />
      )}
      {isAddModalOpen && (
        <AddCourseModal teacherId={teacherId} onClose={() => setIsAddModalOpen(false)} onSuccess={() => fetchCourses(teacherId)} />
      )}
      
      {/* 🌟 หน้าต่างตั้งค่าเกณฑ์เมื่อสั่งเปิดและเลือกวิชาแล้ว */}
      {isSettingsModalOpen && selectedCourseForConfig && (
        <CourseSettingsModal 
          courseId={selectedCourseForConfig.id}
          currentConfig={{
            total_sessions: selectedCourseForConfig.total_sessions,
            late_threshold_minutes: selectedCourseForConfig.late_threshold_minutes,
            absent_threshold_minutes: selectedCourseForConfig.absent_threshold_minutes,
            max_absence_percent: selectedCourseForConfig.max_absence_percent
          }}
          onSaveSuccess={() => fetchCourses(teacherId)}
          onClose={() => setIsSettingsModalOpen(false)}
        />
      )}

      {/* เนื้อหาหลัก: รายวิชาที่สอน */}
      <div className="animate-fade-in">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold text-gray-800">รายวิชาที่สอน</h2>
          <button onClick={() => setIsAddModalOpen(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 text-sm font-semibold transition-all shadow-md hover:shadow-lg">
            <Plus size={18} /> เพิ่มรายวิชาใหม่
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">กำลังโหลด...</div>
        ) : courses.length === 0 ? (
           <div className="text-center py-12 text-gray-400 bg-white rounded-xl shadow-sm border border-gray-200">ยังไม่มีรายวิชา</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => {
              const isThisCourseActive = activeSessionId && currentSelectedCourseCode === course.course_code;
              return (
                <div key={course.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col hover:shadow-md transition-shadow">
                  <div className="flex-1">
                    
                    {/* 🌟 ส่วนหัวการ์ดวิชา พร้อมปุ่มไอคอนฟันเฟืองสำหรับเปิดตั้งค่าเกณฑ์รายวิชา */}
                    <div className="flex justify-between items-start mb-3">
                      <span className="inline-block px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-full">{course.course_code}</span>
                      <button 
                        onClick={() => {
                          setSelectedCourseForConfig(course);
                          setIsSettingsModalOpen(true);
                        }}
                        className="text-gray-400 hover:text-slate-700 p-1 hover:bg-gray-100 rounded-lg transition-all"
                        title="ตั้งค่าเกณฑ์คะแนนและเวลาวิชาเรียน"
                      >
                        <Settings size={18} />
                      </button>
                    </div>

                    <h3 className="font-bold text-xl text-gray-900 mb-2">{course.course_name}</h3>
                    <p className="text-sm text-gray-500 mb-6">Section: {course.section}</p>
                  </div>
                  
                  {!activeSessionId ? (
                    <button onClick={() => handleStartSession(course.id, course.course_code)} disabled={isCreatingSession} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm">
                      <Power size={18} /> {isCreatingSession ? 'กำลังเปิดระบบ...' : 'เปิดรับเช็คชื่อ'}
                    </button>
                  ) : isThisCourseActive ? (
                    <div className="space-y-3 animate-fade-in bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                      <div className="text-center text-emerald-700 text-sm font-bold mb-3 flex items-center justify-center gap-1.5">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                        </span> 
                        กำลังเปิดระบบ
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setIsLive(true)} className="bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-2 rounded-lg border border-gray-300 transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm"><QrCode size={16} /> จอ QR</button>
                        <button onClick={() => setIsNfcOpen(true)} className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-2 px-2 rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm"><CreditCard size={16} /> เครื่องสแกน</button>
                      </div>
                      <button onClick={handleEndSession} className="w-full text-red-600 hover:bg-red-50 font-semibold py-2 rounded-lg transition-colors text-sm text-center border border-red-200 bg-white mt-2">ปิดรับเช็คชื่อ</button>
                    </div>
                  ) : (
                    <button disabled className="w-full bg-gray-100 text-gray-400 font-medium py-3 rounded-xl text-sm cursor-not-allowed">มีวิชาอื่นเปิดอยู่</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}