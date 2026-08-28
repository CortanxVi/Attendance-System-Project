// src/App.tsx
import { useEffect, useState } from 'react';
import axios from 'axios';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import Login from './features/auth/Login';

// นำเข้า Layouts และ Pages ที่เพิ่งสร้าง
import StudentLayout from './components/layout/StudentLayout';
import StudentHome from './features/student/StudentHome';
import AttendanceHistory from './features/student/AttendanceHistory';
import StudentRegister from './features/student/StudentRegister';
import StudentProfile from './features/student/StudentProfile';
import TeacherLayout from './components/layout/TeacherLayout';
import TeacherDashboard from './features/teacher/TeacherDashboard';
import TeacherExportReports from './features/teacher/ExportReports';
import ImportStudents from './features/teacher/ImportStudents';
import TeacherSettings from './features/teacher/TeacherSettings';

import AdminLayout from './components/layout/AdminLayout';
import SystemOverview from './features/admin/SystemOverview';
import UserManagement from './features/admin/UserManagement';
import AllCoursesManagement from './features/admin/AllCoursesManagement';
import SystemLogs from './features/admin/SystemLogs';
import ExportReports from './features/admin/ExportReports';
import RegistrationManagement from './features/admin/RegistrationManagement';
import TemporaryAdminRequests from './features/admin/TemporaryAdminRequests';
import { useTemporaryAdmin } from './contexts/TemporaryAdminContext';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  base_role?: string;
  academic_year?: number | null;
  class_level?: string | null;
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const temporaryAdmin = useTemporaryAdmin();

  useEffect(() => {
    document.title = 'ระบบบันทึกเวลาเข้าเรียน | KMUTNB';
    // ดูเรื่องการเชืื่อมต่อเซสชัน ตรวจสอบ session ที่มีอยู่แล้ว และคอยฟังการเปลี่ยนแปลงสถานะ login ตลอดเวลา
    // คาดว่าเป็นโค้ดจัดการหลังบ้านของ supabase ในการตรวจสอบ session ต่างๆ
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile()
      }
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile();
      else {
        setProfile(null);
        temporaryAdmin.clear();
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []); // ทำงานครั้งเดียวเมื่อเรนเดอร์ครั้งแรก

  const fetchProfile = async () => {
    try {
      const response = await axios.get('/api/v1/auth/me');
      setProfile(response.data.user);
    } catch (err) {
      console.error('Error fetching profile:', err);
      setProfile(null);
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      setLoading(false);
    }
  };

  // หน้าโหลดครั้งแรกที่ npm run dev ก่อนจะแสดงผลหน้าต่าง Login
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  // ทั้งเซสชันและโปรไฟล์ถ้าไม่มีข้อมูลจะให้โยนผู้ใช้ไปหน้าเพจเข้าสู่ระบบ
  if (!session || !profile) {
    return <Login />;
  }

  const baseRole = profile.base_role ?? profile.role;
  const activeRole = baseRole === 'teacher' && temporaryAdmin.active ? 'admin' : baseRole;

  // Component สำหรับแยกทาง (Routing Gatekeeper)
  // ถ้านักศึกษาไปเข้า URL ของอาจารย์ จะถูกดีดกลับมาหน้าแรกของตัวเอง
  return (
      <BrowserRouter>
        <Routes>
          {/* เส้นทางสำหรับนักศึกษา */}
          {activeRole === 'student' && (
            <Route path="/student" element={<StudentLayout />}>
            <Route index element={<StudentHome />} />
            <Route path="history" element={<AttendanceHistory />} />
            <Route path="register" element={<StudentRegister />} />
            <Route path="profile" element={<StudentProfile />} />
          </Route>
        )}

        {/* เส้นทางสำหรับแอดมิน */}
        {activeRole === 'admin' && (
          <Route path="/admin" element={<AdminLayout temporary={baseRole === 'teacher'} />}>
            <Route index element={<SystemOverview />} />
            <Route path="users" element={<UserManagement />} />
            <Route path="courses" element={<AllCoursesManagement />} />
            <Route path="registration" element={<RegistrationManagement />} />
            <Route path="logs" element={<SystemLogs />} />
            <Route path="reports" element={<ExportReports />} />
            {baseRole === 'admin' && <Route path="temporary-access" element={<TemporaryAdminRequests />} />}
          </Route>
        )}

        {/* เส้นทางสำหรับอาจารย์ */}
        {activeRole === 'teacher' && (
          <Route path="/teacher" element={<TeacherLayout />}>
            <Route index element={<TeacherDashboard />} />
            <Route path="reports" element={<TeacherExportReports />} />
            <Route path="students" element={<ImportStudents />} />
            <Route path="settings" element={<TeacherSettings />} />
          </Route>
        )}

        {/* หากเข้ามา URL ผิด หรือเข้าหน้าหลัก (/) ให้ Redirect ไปที่หน้าของตัวเอง */}
        <Route 
          path="*" 
          element={<Navigate to={activeRole === 'admin' ? "/admin" : activeRole === 'student' ? "/student" : "/teacher"} replace />} 
        />
      </Routes>
    </BrowserRouter>
  );
}
