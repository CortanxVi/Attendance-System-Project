// src/App.tsx
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import Login from './features/auth/Login';

// นำเข้า Layouts และ Pages ที่เพิ่งสร้าง
import StudentLayout from './components/layout/StudentLayout';
import StudentHome from './features/student/StudentHome';
import TeacherLayout from './components/layout/TeacherLayout';
import TeacherDashboard from './features/teacher/TeacherDashboard';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null); // เก็บข้อมูลแบบ object
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // ดูเรื่องการเชืื่อมต่อเซสชัน ตรวจสอบ session ที่มีอยู่แล้ว และคอยฟังการเปลี่ยนแปลงสถานะ login ตลอดเวลา
    // คาดว่าเป็นโค้ดจัดการหลังบ้านของ supabase ในการตรวจสอบ session ต่างๆ
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id)
      }
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []); // ทำงานครั้งเดียวเมื่อเรนเดอร์ครั้งแรก

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (err) {
      console.error('Error fetching profile:', err);
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

  // Component สำหรับแยกทาง (Routing Gatekeeper)
  // ถ้านักศึกษาไปเข้า URL ของอาจารย์ จะถูกดีดกลับมาหน้าแรกของตัวเอง
  return (
    <BrowserRouter>
      <Routes>
        {/* เส้นทางสำหรับนักศึกษา */}
        {profile.role === 'student' && (
          <Route path="/student" element={<StudentLayout />}>
            <Route index element={<StudentHome />} />
            {/* สร้าง Placeholder เปล่าๆ ป้องกัน Error หน้าที่ยังไม่ได้ทำ */}
            <Route path="history" element={<div className="p-6 text-center mt-10">หน้าประวัติ (รอดำเนินการ)</div>} />
            <Route path="profile" element={<div className="p-6 text-center mt-10">หน้าโปรไฟล์ (รอดำเนินการ)</div>} />
          </Route>
        )}

        {/* เส้นทางสำหรับอาจารย์ (และแอดมินใช้ร่วมกันก่อน) */}
        {(profile.role === 'teacher' || profile.role === 'admin') && (
          <Route path="/teacher" element={<TeacherLayout />}>
            <Route index element={<TeacherDashboard />} />
            <Route path="reports" element={<div className="p-8">หน้ารายงาน (รอดำเนินการ)</div>} />
            <Route path="students" element={<div className="p-8">หน้าจัดการนักศึกษา (รอดำเนินการ)</div>} />
            <Route path="settings" element={<div className="p-8">หน้าตั้งค่าระบบ (รอดำเนินการ)</div>} />
          </Route>
        )}

        {/* หากเข้ามา URL ผิด หรือเข้าหน้าหลัก (/) ให้ Redirect ไปที่หน้าของตัวเอง */}
        <Route 
          path="*" 
          element={<Navigate to={profile.role === 'student' ? "/student" : "/teacher"} replace />} 
        />
      </Routes>
    </BrowserRouter>
  );
}