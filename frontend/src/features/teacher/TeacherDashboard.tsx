import { useState, useEffect } from 'react';
import * as Lucide from 'lucide-react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import LiveAttendance from './LiveAttendance'; 
import NFCManager from './NFCManager';
import LiveCheckInFeed from './LiveCheckInFeed';
import AddCourseModal from './AddCourseModal';
import { useNotification } from '../../components/notifications/notificationContext';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';

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

function apiDetail(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
    ? error.response.data.detail
    : fallback;
}

export default function TeacherDashboard() {
  const { notify } = useNotification();
  // 🌟 State ของระบบเช็คชื่อ
  const [isLive, setIsLive] = useState(false); 
  const [isNfcOpen, setIsNfcOpen] = useState(false); 
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentSelectedCourseCode, setCurrentSelectedCourseCode] = useState('');
  const [currentSelectedCourseName, setCurrentSelectedCourseName] = useState('');
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // 🌟 State ทักทายชื่ออาจารย์ และสลับมุมมอง
  const [teacherName, setTeacherName] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [teacherId, setTeacherId] = useState<string>('');
  const [pendingAction, setPendingAction] = useState<{ type: 'close-session' } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

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
        }
      } catch (error) {
        console.error('Unable to resolve teacher profile', error);
      }
    };
    resolveTeacherId();
  }, []);

  async function fetchCourses(tId: string) {
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
  }

  const handleStartSession = async (courseId: string, courseCode: string, courseName: string) => {
    try {
      setIsCreatingSession(true);
      setCurrentSelectedCourseCode(courseCode);
      setCurrentSelectedCourseName(courseName);
      const response = await axios.post('/api/v1/sessions/start', {
        course_id: courseId
      });

      if (response.data.status === 'success') {
        setActiveSessionId(response.data.session_id);
      }
    } catch (error: unknown) {
      notify(`ไม่สามารถเปิดห้องเรียนได้: ${apiDetail(error, 'เกิดข้อผิดพลาด')}`, 'error');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleEndSession = () => {
    if (!activeSessionId) return;
    setPendingAction({ type: 'close-session' });
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    setActionBusy(true);
    if (pendingAction.type === 'close-session') {
      if (!activeSessionId) {
        setPendingAction(null);
        setActionBusy(false);
        return;
      }
      try {
        await axios.post(`/api/v1/sessions/${activeSessionId}/close`);
        setActiveSessionId(null);
        setIsLive(false);
        setIsNfcOpen(false);
        notify('ปิดระบบและบันทึกเวลาลงฐานข้อมูลเรียบร้อยแล้ว', 'success');
      } catch {
        notify('เกิดข้อผิดพลาดในการเชื่อมต่อเพื่อปิดเซสชัน', 'error');
      }
    }
    setPendingAction(null);
    setActionBusy(false);
  };

  return (
    <div className="flex min-w-0 flex-col bg-transparent">
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title="ปิดการเช็คชื่อ"
        description="ต้องการปิดคลาสและบันทึกเวลาสิ้นสุดการเช็คชื่อหรือไม่?"
        confirmLabel="ปิดการเช็คชื่อ"
        busy={actionBusy}
        onConfirm={confirmAction}
        onCancel={() => setPendingAction(null)}
      />
      
      {/* โซน Modals ต่างๆ (โค้ดเดิม) */}
      {isLive && activeSessionId && <LiveAttendance courseCode={currentSelectedCourseCode} courseName={currentSelectedCourseName} activeSessionId={activeSessionId} onClose={() => setIsLive(false)} />}
      {isNfcOpen && activeSessionId && <NFCManager defaultCourseCode={currentSelectedCourseCode} activeSessionId={activeSessionId} onClose={() => setIsNfcOpen(false)} />}
      {isAddModalOpen && <AddCourseModal onClose={() => setIsAddModalOpen(false)} onSuccess={() => fetchCourses(teacherId)} />}
      
      {/* 🌟 ส่วนต้อนรับและปุ่มคอนโทรล */}
      <div className="min-w-0 animate-fade-in">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 md:mb-8 md:flex-row md:items-center">
          <div>
            {/* 🌟 ข้อความทักทายอาจารย์ */}
            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-800 sm:text-3xl">
              สวัสดี! {teacherName || 'อาจารย์'}
            </h2>
            <p className="text-gray-500 mt-1">จัดการรายวิชาและเปิดระบบเช็คชื่อนักศึกษา</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:flex-nowrap">
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

        {/* 🌟 [เพิ่มใหม่] รายชื่อ+จำนวนผู้เช็คชื่อแล้วแบบเรียลไทม์ โชว์ตลอดเวลาที่มีคาบเรียนเปิดอยู่
            (ไม่ต้องเปิดหน้าจอ QR หรือ NFC ค้างไว้ก็เห็นได้ รวมทั้ง 2 ช่องทางในที่เดียว) */}
        {activeSessionId && (
          <LiveCheckInFeed sessionId={activeSessionId} courseCode={currentSelectedCourseCode} />
        )}

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
                <div key={course.id} className={`flex min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md ${viewMode === 'list' ? 'flex-col gap-4 p-4 md:flex-row md:items-center' : 'flex-col p-4 sm:p-6'}`}>
                  
                    <div className={`min-w-0 flex-1 ${viewMode === 'list' ? 'flex flex-col gap-3 md:flex-row md:items-center md:gap-6' : ''}`}>
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        <span className="inline-block px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full">{course.course_code}</span>
                        <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full">เทอม {course.semester}/{course.year}</span>                        
                      </div>

                      {/* เครื่องมือทั้งหมดของวิชารวมอยู่ในศูนย์จัดการเดียว */}
                      {viewMode === 'grid' && (
                        <Link to={`/teacher/courses/${course.id}/manage/overview`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-800 focus:outline-none focus:ring-2 focus:ring-orange-300"><Lucide.Settings size={16} />จัดการรายวิชา</Link>
                      )}
                    </div>

                    <div>
                      <h3 className={`font-bold text-gray-900 ${viewMode === 'list' ? 'text-lg mb-1' : 'text-xl mb-2'}`}>
                        <Link to={`/teacher/courses/${course.id}/manage/overview`} className="hover:text-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300">
                          {course.course_name}
                        </Link>
                      </h3>
                      <p className="text-sm text-gray-500 mb-0">Section: {course.section}</p>
                    </div>

                    {/* ปุ่มจัดการเดียวสำหรับมุมมองแบบ List */}
                    {viewMode === 'list' && (
                       <div className="mt-3 flex items-center gap-2 md:mt-0 md:ml-auto">
                          <Link to={`/teacher/courses/${course.id}/manage/overview`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-800 focus:outline-none focus:ring-2 focus:ring-orange-300"><Lucide.Settings size={16} />จัดการรายวิชา</Link>
                       </div>
                    )}
                  </div>
                  
                  {/* ปุ่มคอนโทรลระบบเช็คชื่อ */}
                  <div className={`${viewMode === 'list' ? 'w-full border-t border-gray-100 pt-4 md:w-[clamp(13rem,25%,16rem)] md:shrink-0 md:border-t-0 md:border-l md:pt-0 md:pl-4' : 'mt-6'}`}>
                    {!activeSessionId ? (
                      <button onClick={() => handleStartSession(course.id, course.course_code, course.course_name)} disabled={isCreatingSession} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm text-sm">
                        <Lucide.Power size={18} /> {isCreatingSession ? 'กำลังเปิดระบบ...' : 'เปิดระบบเช็คชื่อ'}
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
