import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { BookOpen, FileText, Settings, LogOut, LayoutDashboard, Menu, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useResponsiveDrawer } from './useResponsiveDrawer';

export default function TeacherLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { drawerRef, triggerRef, closeRef } = useResponsiveDrawer(isSidebarOpen, setIsSidebarOpen);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // เมื่อ log out ระบบจะจัดการส่งกลับหน้า login เองผ่าน App.tsx
  };

  const menuItems = [
    { name: 'รายวิชาที่สอน', path: '/teacher', icon: BookOpen },
    { name: 'รายงานการเข้าเรียน', path: '/teacher/reports', icon: FileText },
    { name: 'ตั้งค่าระบบ', path: '/teacher/settings', icon: Settings },
  ];

  // ตรวจสอบว่าเมนูไหน Active: index route ใช้ exact match, sub-routes ใช้ startsWith
  const isActive = (path: string) => {
    if (path === '/teacher') {
      return location.pathname === '/teacher' || location.pathname.startsWith('/teacher/courses/');
    }
    return location.pathname.startsWith(path);
  };

  // ชื่อหน้าปัจจุบันสำหรับแสดงบน mobile header
  const currentPageName = location.pathname.startsWith('/teacher/courses/')
    ? 'จัดการรายวิชา'
    : menuItems.find(item => isActive(item.path))?.name || 'ระบบจัดการการเข้าเรียน';
  
  return (
    <div className="flex min-h-svh w-full min-w-0 bg-gray-100">
      {/* แถบดำทับหน้าจอเมื่อเปิด Sidebar บนมือถือ */}
      {isSidebarOpen && (
        <button type="button" aria-label="ปิดเมนูด้านข้าง" className="fixed inset-0 z-40 cursor-pointer bg-black/50 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* แถบเมนูด้านซ้าย (Sidebar) */}
      <aside ref={drawerRef} id="teacher-navigation" aria-label="เมนูอาจารย์" className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,86vw)] flex-col overflow-hidden bg-slate-900 text-white shadow-2xl transition-transform duration-300 ease-in-out lg:visible lg:sticky lg:top-0 lg:h-svh lg:w-[clamp(14rem,20vw,18rem)] lg:shrink-0 lg:translate-x-0 lg:shadow-none ${isSidebarOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}`}>
        <div className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 px-4 sm:px-5">
          <h1 className="flex min-w-0 items-center gap-2 font-bold">
            <LayoutDashboard size={24} className="text-orange-500" />
            <span className="truncate text-base text-orange-400 xl:text-lg">Attendance System</span>
          </h1>
          <button ref={closeRef} type="button" aria-label="ปิดเมนูด้านข้าง" onClick={() => setIsSidebarOpen(false)} className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-400 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 lg:hidden">
            <X size={24} />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.name}
                onClick={() => { navigate(item.path); setIsSidebarOpen(false); }}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${
                  active ? 'bg-orange-500 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon size={20} />
                {item.name}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut size={20} />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* พื้นที่หลักแสดงเนื้อหา (Main Content) */}
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-gray-200 bg-white/95 px-3 shadow-sm backdrop-blur sm:px-5 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button ref={triggerRef} type="button" aria-label="เปิดเมนูด้านข้าง" aria-controls="teacher-navigation" aria-expanded={isSidebarOpen} onClick={() => setIsSidebarOpen(true)} className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 lg:hidden">
              <Menu size={28} />
            </button>
            <h1 className="truncate text-base font-semibold text-gray-800 sm:text-xl">{currentPageName}</h1>
          </div>
        </header>
        <div className="w-full min-w-0 p-3 sm:p-5 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
