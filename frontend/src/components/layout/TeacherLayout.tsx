import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { BookOpen, FileText, Settings, LogOut, LayoutDashboard, Menu, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useResponsiveDrawer } from './useResponsiveDrawer';
import { useDesktopSidebar } from './useDesktopSidebar';
import PullToRefreshIndicator from './PullToRefreshIndicator';
import { usePullToRefresh } from './usePullToRefresh';
import AppBackButton from '../navigation/AppBackButton';

export default function TeacherLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { drawerRef, triggerRef, closeRef } = useResponsiveDrawer(isSidebarOpen, setIsSidebarOpen);
  const sidebar = useDesktopSidebar('attendance.teacher.sidebar');
  const { containerRef, pullDistance, refreshing, threshold } = usePullToRefresh<HTMLElement>();

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
      <aside ref={drawerRef} id="teacher-navigation" aria-label="เมนูอาจารย์" onMouseEnter={sidebar.expandOnHover} onMouseLeave={sidebar.stopHoverExpansion} className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,86vw)] flex-col overflow-hidden bg-slate-900 text-white shadow-2xl transition-[width,transform] duration-300 ease-in-out lg:visible lg:sticky lg:top-0 lg:h-svh lg:shrink-0 lg:translate-x-0 lg:shadow-none ${sidebar.desktopExpanded ? 'lg:w-[clamp(14rem,20vw,18rem)]' : 'lg:w-20'} ${isSidebarOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}`}>
        <div className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 px-4 sm:px-5">
          <h1 className="flex min-w-0 items-center gap-2 font-bold">
            <LayoutDashboard size={24} className="text-orange-500" />
            <span className={`truncate text-base text-orange-400 transition-opacity xl:text-lg ${sidebar.desktopExpanded ? 'lg:opacity-100' : 'lg:w-0 lg:opacity-0'}`}>Attendance System</span>
          </h1>
          <button ref={closeRef} type="button" aria-label="ปิดเมนูด้านข้าง" onClick={() => setIsSidebarOpen(false)} className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-400 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 lg:hidden">
            <X size={24} />
          </button>
          <button type="button" aria-label={sidebar.collapsed ? 'ขยายเมนูด้านข้าง' : 'ยุบเมนูด้านข้าง'} aria-pressed={sidebar.collapsed} onClick={sidebar.toggleCollapsed} className="hidden size-10 shrink-0 items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 lg:flex">
            {sidebar.collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
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
                title={!sidebar.desktopExpanded ? item.name : undefined}
                className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${
                  active ? 'bg-orange-500 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="shrink-0" size={20} />
                <span className={`whitespace-nowrap transition-opacity ${sidebar.desktopExpanded ? 'lg:opacity-100' : 'lg:w-0 lg:overflow-hidden lg:opacity-0'}`}>{item.name}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button 
            onClick={handleLogout}
            title={!sidebar.desktopExpanded ? 'ออกจากระบบ' : undefined}
            className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-2 text-sm text-red-400 transition-colors hover:bg-slate-800"
          >
            <LogOut className="shrink-0" size={20} />
            <span className={`whitespace-nowrap transition-opacity ${sidebar.desktopExpanded ? 'lg:opacity-100' : 'lg:w-0 lg:overflow-hidden lg:opacity-0'}`}>ออกจากระบบ</span>
          </button>
        </div>
      </aside>

      {/* พื้นที่หลักแสดงเนื้อหา (Main Content) */}
      <main ref={containerRef} className="h-svh min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
        <PullToRefreshIndicator distance={pullDistance} refreshing={refreshing} threshold={threshold} />
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-gray-200 bg-white/95 px-3 shadow-sm backdrop-blur sm:px-5 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button ref={triggerRef} type="button" aria-label="เปิดเมนูด้านข้าง" aria-controls="teacher-navigation" aria-expanded={isSidebarOpen} onClick={() => setIsSidebarOpen(true)} className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 lg:hidden">
              <Menu size={28} />
            </button>
            <AppBackButton fallbackPath="/teacher" />
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
