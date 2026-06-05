import React, { useState, useEffect } from 'react';
import { Plus, CreditCard, Power, QrCode } from 'lucide-react';
import axios from 'axios';
import LiveAttendance from './LiveAttendance'; 
import NFCManager from './NFCManager';
import AddCourseModal from './AddCourseModal'; // 🌟 นำเข้าป็อปอัปตัวใหม่ที่เราเพิ่งเขียน

// 🌟 กำหนดแบบฟอร์มโครงสร้างวิชาให้ตรงกับข้อมูลในตารางคอลัมน์ของ Supabase
interface Course {
  id: string; // ตัวนี้จะเป็น UUID จริงที่เจนมาจากฐานข้อมูล
  course_code: string;
  course_name: string;
  section: number;
}

export default function TeacherDashboard() {
  const [isLive, setIsLive] = useState<boolean>(false); 
  const [isNfcOpen, setIsNfcOpen] = useState<boolean>(false); 
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false); // 🌟 State เปิด/ปิดหน้าต่างโมดอลเพิ่มวิชา
  
  const [courses, setCourses] = useState<Course[]>([]); // 🌟 State เก็บรายการวิชาจริงจาก DB
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentSelectedCourseCode, setCurrentSelectedCourseCode] = useState<string>('');
  const [isCreatingSession, setIsCreatingSession] = useState<boolean>(false);

  // 💡 รหัสจำลองตัวอาจารย์ผู้ใช้งาน (ในระบบจริงต้องสืบทอดมาจาก Context ตอนล็อกอินเข้าเว็บ)
  // ⚠️ สำคัญมาก: คุณต้องเอารหัส UUID แถวใดแถวหนึ่งของจริงในตาราง auth.users หรือตารางอาจารย์ของคุณมาใส่ตรงนี้เพื่อความถูกต้องเชิงความสัมพันธ์
  const mockTeacherId:string = "de9c3f99-5867-4340-a813-1b8dc447f9cc"; // Punch

  // 🌟 ฟังก์ชันดึงข้อมูลวิชาเรียนทั้งหมดของอาจารย์มาจากเซิร์ฟเวอร์
  const fetchCourses = async () => {
    try {
      setIsLoading(true);
      console.log("🔍 กำลังดึงข้อมูลของอาจารย์รหัส:", mockTeacherId); // แอบดูว่าส่งรหัสอะไรไป
      
      const response = await axios.get(`/api/v1/courses/${mockTeacherId}`);
      
      console.log("📦 ข้อมูลที่ได้จากหลังบ้าน:", response.data); // แอบดูว่าหลังบ้านส่งอะไรกลับมา

      if (response.data.status === 'success') {
        setCourses(response.data.courses);
      }
    } catch (error) {
      console.error("❌ Error loading courses:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // เรียกโหลดข้อมูลตั้งแต่ครั้งแรกที่ก้าวเท้าเข้ามาที่หน้านี้
  useEffect(() => {
    fetchCourses();
  }, []);

  // 🌟 แก้ไขฟังก์ชันเปิดคลาส: รับค่าไอดีของรายวิชาจริงมาประมวลผลยิงต่อ
  const handleStartSession = async (courseId: string, courseCode: string) => {
    try {
      setIsCreatingSession(true);
      setCurrentSelectedCourseCode(courseCode);
      const response = await axios.post('/api/v1/sessions/start', {
        course_id: courseId, // <-- นำ UUID ของวิชาจริงยิงเข้าไปแล้ว! จะผ่านฉลุย
        teacher_id: mockTeacherId
      });

      if (response.data.status === 'success') {
        setActiveSessionId(response.data.session_id);
      }
    } catch (error) {
      console.error(error);
      alert("เกิดข้อผิดพลาดในการเปิดเซสชัน กรุณาตรวจสอบ UUID ของตัวอาจารย์ในโค้ดว่ามีอยู่จริงในตารางของระบบหรือไม่");
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleEndSession = () => {
    if (window.confirm("คุณต้องการปิดคลาสและสิ้นสุดการเช็คชื่อใช่หรือไม่?")) {
      setActiveSessionId(null);
      setIsLive(false);
      setIsNfcOpen(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      
      {isLive && activeSessionId && (
        <LiveAttendance 
          courseCode={currentSelectedCourseCode} 
          activeSessionId={activeSessionId} 
          onClose={() => setIsLive(false)} 
        />
      )}
      
      {isNfcOpen && activeSessionId && (
        <NFCManager 
          defaultCourseCode={currentSelectedCourseCode} 
          activeSessionId={activeSessionId} 
          onClose={() => setIsNfcOpen(false)} 
        />
      )}

      {/* 🌟 แสดงหน้าต่างป็อปอัปเพิ่มวิชาเรียนเมื่อกดปุ่ม */}
      {isAddModalOpen && (
        <AddCourseModal 
          teacherId={mockTeacherId}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={fetchCourses} // บันทึกเสร็จจะสั่งสั่งดึงข้อมูลล่าสุดให้ทันที
        />
      )}
      
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">รายวิชาที่สอน</h2>
        <button 
          onClick={() => setIsAddModalOpen(true)} // 🌟 คลิกเพื่อเปิด Modal
          className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors cursor-pointer shadow-sm"
        >
          <Plus size={18} />
          เพิ่มรายวิชาใหม่
        </button>
      </div>

      {/* ส่วนตรวจเช็คสถานะการโหลดข้อมูล */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">กำลังดึงข้อมูลรายวิชาจากฐานข้อมูล...</div>
      ) : courses.length === 0 ? (
        <div className="text-center py-12 text-gray-400 bg-white border border-gray-200 rounded-xl">
          ยังไม่มีรายวิชาในระบบ กดปุ่ม "เพิ่มรายวิชาใหม่" เพื่อเริ่มต้นลงทะเบียนวิชาแรก
        </div>
      ) : (
        /* 🌟 ลูปสร้างการ์ดรายวิชาตามปริมาณข้อมูลจริงที่ดึงมาจากฐานข้อมูลได้ */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {courses.map((course) => {
            const isThisCourseActive = activeSessionId && currentSelectedCourseCode === course.course_code;
            
            return (
              <div key={course.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="inline-block px-2 py-1 bg-green-100 text-green-700 text-xs font-bold rounded mb-2">
                      {course.course_code}
                    </span>
                    <h3 className="font-bold text-lg text-gray-900">{course.course_name}</h3>
                  </div>
                </div>
                <div className="text-sm text-gray-600 space-y-1 mb-6">
                  <p>Section: {course.section}</p>
                </div>
                
                {/* ควบคุมการแสดงผลชุดปุ่มตามสถานะของแต่ละการ์ดวิชา */}
                {!activeSessionId ? (
                  <button 
                    onClick={() => handleStartSession(course.id, course.course_code)}
                    disabled={isCreatingSession}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors cursor-pointer flex justify-center items-center gap-2 text-sm shadow-sm"
                  >
                    <Power size={16} />
                    เปิดระบบเช็คชื่อ (Start Session)
                  </button>
                ) : isThisCourseActive ? (
                  <div className="space-y-3 animate-fade-in">
                    <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-center text-emerald-800 text-xs font-bold">
                      🟢 วิชานี้กำลังเปิดรับข้อมูลเช็คชื่อ
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setIsLive(true)}
                        className="flex-1 bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-3 rounded-lg border border-gray-300 transition-colors cursor-pointer flex justify-center items-center gap-1.5 text-xs"
                      >
                        <QrCode size={14} /> ฉายจอ QR
                      </button>
                      <button 
                        onClick={() => setIsNfcOpen(true)}
                        className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-medium py-2 px-3 rounded-lg transition-colors cursor-pointer flex justify-center items-center gap-1.5 text-xs"
                      >
                        <CreditCard size={14} /> เครื่อง NFC
                      </button>
                    </div>
                    <button 
                      onClick={handleEndSession}
                      className="w-full text-red-600 hover:bg-red-50 font-medium py-2 rounded-lg transition-colors cursor-pointer text-xs text-center block"
                    >
                      ปิดรับเช็คชื่อ (End Session)
                    </button>
                  </div>
                ) : (
                  <button 
                    disabled
                    className="w-full bg-gray-100 text-gray-400 font-medium py-3 rounded-lg text-sm flex justify-center items-center gap-2 cursor-not-allowed"
                  >
                    มีวิชาอื่นเปิดระบบอยู่ค้างไว้
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}