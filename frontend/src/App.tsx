// src/App.tsx
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { Session } from '@supabase/supabase-js';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import Login from './features/auth/Login';

// นำเข้า Layouts และ Pages ที่เพิ่งสร้าง
import StudentLayout from './components/layout/StudentLayout';
import TeacherLayout from './components/layout/TeacherLayout';
import AdminLayout from './components/layout/AdminLayout';
import { useTemporaryAdmin } from './contexts/temporaryAdminState';
import { setAuthAccessToken } from './services/http';

const StudentHome = lazy(() => import('./features/student/StudentHome'));
const AttendanceHistory = lazy(() => import('./features/student/AttendanceHistory'));
const StudentRegister = lazy(() => import('./features/student/StudentRegister'));
const StudentProfile = lazy(() => import('./features/student/StudentProfile'));
const StudentRequests = lazy(() => import('./features/student/StudentRequests'));
const StudentCourses = lazy(() => import('./features/student/StudentCourses'));
const TeacherDashboard = lazy(() => import('./features/teacher/TeacherDashboard'));
const TeacherExportReports = lazy(() => import('./features/teacher/ExportReports'));
const TeacherSettings = lazy(() => import('./features/teacher/TeacherSettings'));
const CourseManagement = lazy(() => import('./features/teacher/CourseManagement'));
const SystemOverview = lazy(() => import('./features/admin/SystemOverview'));
const UserManagement = lazy(() => import('./features/admin/UserManagement'));
const AllCoursesManagement = lazy(() => import('./features/admin/AllCoursesManagement'));
const SystemLogs = lazy(() => import('./features/admin/SystemLogs'));
const ExportReports = lazy(() => import('./features/admin/ExportReports'));
const RegistrationManagement = lazy(() => import('./features/admin/RegistrationManagement'));
const TemporaryAdminRequests = lazy(() => import('./features/admin/TemporaryAdminRequests'));

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
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const temporaryAdmin = useTemporaryAdmin();
  const clearTemporaryAdmin = temporaryAdmin.clear;
  const pendingProfileToken = useRef<string | null>(null);
  const loadedProfileToken = useRef<string | null>(null);
  const profileRequestController = useRef<AbortController | null>(null);
  const profileFetchTimer = useRef<number | null>(null);

  const fetchProfile = useCallback(async (activeSession: Session, force = false) => {
    const accessToken = activeSession.access_token;
    if (!force && (
      pendingProfileToken.current === accessToken
      || loadedProfileToken.current === accessToken
    )) return;

    profileRequestController.current?.abort();
    const controller = new AbortController();
    profileRequestController.current = controller;
    pendingProfileToken.current = accessToken;
    setProfileError(null);
    setLoading(true);
    try {
      const response = await axios.get('/api/v1/auth/me', {
        // Send the exact event token so profile loading does not depend on a
        // nested Supabase getSession() call while the auth callback is locked.
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      loadedProfileToken.current = accessToken;
      setProfile(response.data.user);
    } catch (error) {
      if (axios.isCancel(error)) return;

      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const detail = axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
        ? error.response.data.detail
        : null;
      console.error('Profile request failed', { status: status ?? 'network' });
      setProfile(null);
      loadedProfileToken.current = null;

      if (status === 401) {
        setAuthAccessToken(null);
        await supabase.auth.signOut({ scope: 'local' });
        return;
      }
      setProfileError(
        detail || 'เข้าสู่ระบบสำเร็จ แต่ไม่สามารถโหลดโปรไฟล์ได้ กรุณาลองใหม่',
      );
    } finally {
      if (profileRequestController.current === controller) {
        profileRequestController.current = null;
        pendingProfileToken.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    document.title = 'ระบบบันทึกเวลาเข้าเรียน | KMUTNB';
    // INITIAL_SESSION already provides the stored session. Deferring the API
    // call avoids re-entering Supabase auth methods inside its exclusive lock.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthAccessToken(nextSession?.access_token ?? null);
      if (nextSession) {
        if (profileFetchTimer.current !== null) window.clearTimeout(profileFetchTimer.current);
        profileFetchTimer.current = window.setTimeout(() => {
          profileFetchTimer.current = null;
          void fetchProfile(nextSession);
        }, 0);
      }
      else {
        if (profileFetchTimer.current !== null) window.clearTimeout(profileFetchTimer.current);
        profileFetchTimer.current = null;
        profileRequestController.current?.abort();
        profileRequestController.current = null;
        setProfile(null);
        setProfileError(null);
        pendingProfileToken.current = null;
        loadedProfileToken.current = null;
        clearTemporaryAdmin();
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (profileFetchTimer.current !== null) window.clearTimeout(profileFetchTimer.current);
      profileFetchTimer.current = null;
      profileRequestController.current?.abort();
      profileRequestController.current = null;
    };
  }, [clearTemporaryAdmin, fetchProfile]);

  // หน้าโหลดครั้งแรกที่ npm run dev ก่อนจะแสดงผลหน้าต่าง Login
  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  // ทั้งเซสชันและโปรไฟล์ถ้าไม่มีข้อมูลจะให้โยนผู้ใช้ไปหน้าเพจเข้าสู่ระบบ
  if (session && !profile && profileError) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-7 text-center shadow-lg">
          <h2 className="text-xl font-bold text-gray-900">โหลดข้อมูลผู้ใช้งานไม่สำเร็จ</h2>
          <p role="alert" className="mt-3 text-sm leading-6 text-amber-800">{profileError}</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button type="button" onClick={() => { void fetchProfile(session, true); }} className="rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-orange-700">ลองใหม่</button>
            <button type="button" onClick={() => { void supabase.auth.signOut({ scope: 'local' }); }} className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">ออกจากระบบ</button>
          </div>
        </div>
      </div>
    );
  }

  if (!session || !profile) {
    return <Login />;
  }

  const baseRole = profile.base_role ?? profile.role;
  const activeRole = baseRole === 'teacher' && temporaryAdmin.active ? 'admin' : baseRole;

  // Component สำหรับแยกทาง (Routing Gatekeeper)
  // ถ้านักศึกษาไปเข้า URL ของอาจารย์ จะถูกดีดกลับมาหน้าแรกของตัวเอง
  return (
      <BrowserRouter>
        <Suspense fallback={<div className="flex min-h-48 items-center justify-center text-sm text-slate-500"><span className="mr-2 size-5 animate-spin rounded-full border-2 border-slate-300 border-t-orange-500" />กำลังโหลดหน้า…</div>}>
        <Routes>
          {/* เส้นทางสำหรับนักศึกษา */}
          {activeRole === 'student' && (
            <Route path="/student" element={<StudentLayout />}>
            <Route index element={<StudentHome />} />
            <Route path="history" element={<AttendanceHistory />} />
            <Route path="history/:courseId" element={<AttendanceHistory />} />
            <Route path="register" element={<StudentRegister />} />
            <Route path="profile" element={<StudentProfile />} />
            <Route path="requests" element={<StudentRequests />} />
            <Route path="courses" element={<StudentCourses />} />
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
            <Route path="courses/:courseId/manage/:tab?" element={<CourseManagement />} />
            <Route path="settings/:section?" element={<TeacherSettings />} />
          </Route>
        )}

        {/* หากเข้ามา URL ผิด หรือเข้าหน้าหลัก (/) ให้ Redirect ไปที่หน้าของตัวเอง */}
        <Route 
          path="*" 
          element={<Navigate to={activeRole === 'admin' ? "/admin" : activeRole === 'student' ? "/student" : "/teacher"} replace />} 
        />
        </Routes>
        </Suspense>
    </BrowserRouter>
  );
}
