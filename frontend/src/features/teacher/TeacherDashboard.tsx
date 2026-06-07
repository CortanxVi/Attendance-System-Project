import React, { useState, useEffect } from 'react';
import * as Lucide from 'lucide-react';
import axios from 'axios';
import { supabase } from '../../lib/supabaseClient';
import LiveAttendance from './LiveAttendance'; 
import NFCManager from './NFCManager';
import AddCourseModal from './AddCourseModal';
import EditCourseModal from './EditCourseModal';
import CourseSettingsModal from './CourseSettings';

// 🌟 Interface มารองรับฟิลด์เกณฑ์การตั้งค่าที่จะดึงมาจากฐานข้อมูล
interface Course {
  id: string;
  course_code: string;
  course_name: string;
  section: number;
  semester?: number;
  year?: number;
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

  // 🌟 State ทักทายชื่ออาจารย์ และสลับมุมมอง
  const [teacherName, setTeacherName] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // 🌟 State สำหรับการแก้ไข
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedCourseForEdit, setSelectedCourseForEdit] = useState<Course | null>(null);

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
          
          // 🌟 ดึงชื่ออาจารย์มาแสดงผล
          const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).single();
          if (profile?.full_name) setTeacherName(profile.full_name);
        } else {
          fetchCourses(mockTeacherId);
        }
      } catch (error) {
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

  // 🌟 ฟังก์ชันลบรายวิชา
  const handleDeleteCourse = async (courseId: string, courseCode: string) => {
    if (window.confirm(`⚠️ คุณแน่ใจหรือไม่ว่าต้องการลบรายวิชา ${courseCode}?\n\nการลบวิชานี้อาจส่งผลต่อข้อมูลประวัติการเช็คชื่อทั้งหมดที่เกี่ยวข้อง หากลบแล้วจะไม่สามารถกู้คืนได้!`)) {
      try {
        await axios.delete(`/api/v1/courses/${courseId}`);
        alert("✅ ลบรายวิชาสำเร็จ");
        fetchCourses(teacherId);
      } catch (error: any) {
        alert(`❌ ลบไม่สำเร็จ: ${error.response?.data?.detail || "ติดข้อจำกัดด้านฐานข้อมูล"}`);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      
      {/* โซน Modals ต่างๆ (โค้ดเดิม) */}
      {isLive && activeSessionId && <LiveAttendance courseCode={currentSelectedCourseCode} activeSessionId={activeSessionId} onClose={() => setIsLive(false)} />}
      {isNfcOpen && activeSessionId && <NFCManager defaultCourseCode={currentSelectedCourseCode} activeSessionId={activeSessionId} onClose={() => setIsNfcOpen(false)} />}
      {isAddModalOpen && <AddCourseModal teacherId={teacherId} onClose={() => setIsAddModalOpen(false)} onSuccess={() => fetchCourses(teacherId)} />}
      
      {/* 🌟 Modal แก้ไขรายวิชา */}
      {isEditModalOpen && selectedCourseForEdit && (
        <EditCourseModal course={selectedCourseForEdit} onClose={() => setIsEditModalOpen(false)} onSuccess={() => fetchCourses(teacherId)} />
      )}

      {isSettingsModalOpen && selectedCourseForConfig && (
        <CourseSettingsModal courseId={selectedCourseForConfig.id} currentConfig={{ total_sessions: selectedCourseForConfig.total_sessions, late_threshold_minutes: selectedCourseForConfig.late_threshold_minutes, absent_threshold_minutes: selectedCourseForConfig.absent_threshold_minutes, max_absence_percent: selectedCourseForConfig.max_absence_percent }} onSaveSuccess={() => fetchCourses(teacherId)} onClose={() => setIsSettingsModalOpen(false)} />
      )}

      {/* 🌟 ส่วนต้อนรับและปุ่มคอนโทรล */}
      <div className="animate-fade-in p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            {/* 🌟 ข้อความทักทายอาจารย์ */}
            <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
              สวัสดี! {teacherName || 'อาจารย์'}
            </h2>
            <p className="text-gray-500 mt-1">จัดการรายวิชาและเปิดระบบเช็คชื่อนักศึกษา</p>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto">
            {/* 🌟 ปุ่มสลับมุมมอง Grid/List */}
            <div className="flex bg-white border border-gray-200 p-1 rounded-xl shadow-sm">
              <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-orange-100 text-orange-600' : 'text-gray-400 hover:text-gray-600'}`} title="Grid View"><Lucide.Grid size={20} /></button>
              <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-orange-100 text-orange-600' : 'text-gray-400 hover:text-gray-600'}`} title="List View"><Lucide.List size={20} /></button> {/*<List size={20} />*/}
            </div>

            <button onClick={() => setIsAddModalOpen(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all shadow-md w-full md:w-auto">
              <Lucide.Plus size={18} /> เพิ่มรายวิชา
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">กำลังโหลดข้อมูลรายวิชา...</div>
        ) : courses.length === 0 ? (
           <div className="text-center py-16 text-gray-400 bg-white rounded-2xl shadow-sm border border-gray-200">ยังไม่มีรายวิชาในระบบ กรุณากดเพิ่มรายวิชา</div>
        ) : (
          /* 🌟 สลับ Layout CSS ตาม State viewMode */
          <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" : "flex flex-col gap-4"}>
            {courses.map((course) => {
              const isThisCourseActive = activeSessionId && currentSelectedCourseCode === course.course_code;
              return (
                <div key={course.id} className={`bg-white rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-all flex ${viewMode === 'list' ? 'flex-col md:flex-row md:items-center p-4 gap-4' : 'flex-col p-6'}`}>
                  
                  <div className={`flex-1 ${viewMode === 'list' && 'flex items-center gap-6'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="space-x-2">
                        <span className="inline-block px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full">{course.course_code}</span>
                        <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full">เทอม {course.semester}/{course.year}</span>                        
                      </div>

                      {/* 🌟 3 ปุ่มจัดการ: Settings, Edit, Delete */}
                      {viewMode === 'grid' && (
                        <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg border border-gray-100">
                          <button onClick={() => { setSelectedCourseForConfig(course); setIsSettingsModalOpen(true); }} className="text-gray-400 hover:text-slate-700 p-1.5 hover:bg-white rounded-md transition-all shadow-sm" title="ตั้งค่าเกณฑ์เข้าเรียน"><Lucide.Settings size={16} /></button>
                          <button onClick={() => { setSelectedCourseForEdit(course); setIsEditModalOpen(true); }} className="text-gray-400 hover:text-blue-600 p-1.5 hover:bg-white rounded-md transition-all shadow-sm" title="แก้ไขข้อมูล"><Lucide.Edit size={16} /></button>
                          <button onClick={() => handleDeleteCourse(course.id, course.course_code)} className="text-gray-400 hover:text-red-600 p-1.5 hover:bg-white rounded-md transition-all shadow-sm" title="ลบรายวิชา"><Lucide.Trash2 size={16} /></button>
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 className={`font-bold text-gray-900 ${viewMode === 'list' ? 'text-lg mb-1' : 'text-xl mb-2'}`}>{course.course_name}</h3>
                      <p className="text-sm text-gray-500 mb-0">Section: {course.section}</p>
                    </div>

                    {/* ปุ่มจัดการสำหรับมุมมองแบบ List (โชว์ตรงกลาง) */}
                    {viewMode === 'list' && (
                       <div className="flex items-center gap-2 mt-3 md:mt-0 ml-auto">
                          <button onClick={() => { setSelectedCourseForConfig(course); setIsSettingsModalOpen(true); }} className="text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Lucide.Settings size={14} /> ตั้งค่า</button>
                          <button onClick={() => { setSelectedCourseForEdit(course); setIsEditModalOpen(true); }} className="text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Lucide.Edit size={14} />แก้ไข</button>
                          <button onClick={() => handleDeleteCourse(course.id, course.course_code)} className="text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Lucide.Trash2 size={14} /> ลบ</button>
                       </div>
                    )}
                  </div>
                  
                  {/* ปุ่มคอนโทรลระบบเช็คชื่อ */}
                  <div className={`${viewMode === 'list' ? 'w-full md:w-64 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-4' : 'mt-6'}`}>
                    {!activeSessionId ? (
                      <button onClick={() => handleStartSession(course.id, course.course_code)} disabled={isCreatingSession} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm text-sm">
                        <Lucide.Power size={18} /> {isCreatingSession ? 'กำลังเปิดระบบ...' : 'เปิดรับเช็คชื่อ'}
                      </button>
                    ) : isThisCourseActive ? (
                      <div className="space-y-2 bg-emerald-50/50 p-3 rounded-xl border border-emerald-100">
                        <div className="text-center text-emerald-700 text-xs font-bold mb-2 flex items-center justify-center gap-1.5">
                          <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span></span> เปิดระบบอยู่
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => setIsLive(true)} className="bg-white hover:bg-gray-50 text-gray-700 font-medium py-1.5 px-2 rounded-lg border border-gray-300 flex justify-center items-center gap-1 text-xs shadow-sm"><Lucide.QrCode size={14} /> จอ QR</button>
                          <button onClick={() => setIsNfcOpen(true)} className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-1.5 px-2 rounded-lg flex justify-center items-center gap-1 text-xs shadow-sm"><Lucide.CreditCard size={14} /> NFC</button>
                        </div>
                        <button onClick={handleEndSession} className="w-full text-red-600 hover:bg-red-50 font-semibold py-1.5 rounded-lg text-xs text-center border border-red-200 bg-white mt-1">ปิดระบบ</button>
                      </div>
                    ) : (
                      <button disabled className="w-full bg-gray-100 text-gray-400 font-medium py-3 rounded-xl text-sm cursor-not-allowed">มีวิชาอื่นเปิดอยู่</button>
                    )}
                  </div>
                  
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}