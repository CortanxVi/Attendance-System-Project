import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { Shield, Users, BookOpen, FileText, ClipboardList, LogOut, LayoutDashboard, Menu, X, UserPlus, KeyRound, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useTemporaryAdmin } from '../../contexts/temporaryAdminState';
import { useNotification } from '../notifications/notificationContext';
import { useResponsiveDrawer } from './useResponsiveDrawer';
import { useDesktopSidebar } from './useDesktopSidebar';
import PullToRefreshIndicator from './PullToRefreshIndicator';
import { usePullToRefresh } from './usePullToRefresh';
import AppBackButton from '../navigation/AppBackButton';

export default function AdminLayout({ temporary = false }: { temporary?: boolean }) {
  const navigate = useNavigate(); // for Redirect
  const location = useLocation(); // passing state สำหรับรับค่า state มาจาก component อื่น
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { drawerRef, triggerRef, closeRef } = useResponsiveDrawer(isSidebarOpen, setIsSidebarOpen);
  const sidebar = useDesktopSidebar('attendance.admin.sidebar');
  const { containerRef, pullDistance, refreshing, threshold } = usePullToRefresh<HTMLElement>();
  const temporaryAdmin = useTemporaryAdmin();
  const { notify } = useNotification();

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // สารบัญข้อมูล สำหรับแสดงผลชื่อหน้าเพจ
  const menuItems = [
    { name: 'ภาพรวมระบบ', path: '/admin', icon: LayoutDashboard },
    { name: 'จัดการผู้ใช้งาน', path: '/admin/users', icon: Users },
    { name: 'จัดการรายวิชา', path: '/admin/courses', icon: BookOpen },
    { name: 'จัดการการลงทะเบียน', path: '/admin/registration', icon: UserPlus },
    { name: 'ตรวจสอบ Log (Audit)', path: '/admin/logs', icon: ClipboardList },
    { name: 'ออกรายงาน (Export)', path: '/admin/reports', icon: FileText },
    ...(!temporary ? [{ name: 'อนุมัติสิทธิ์ชั่วคราว', path: '/admin/temporary-access', icon: KeyRound }] : []),
  ];

  const leaveTemporaryAdmin = async () => {
    try { await axios.post('/api/v1/temporary-admin/deactivate'); } catch { /* clear locally even if already expired */ }
    temporaryAdmin.clear();
    notify('กลับสู่สิทธิ์อาจารย์แล้ว', 'success');
    navigate('/teacher/settings');
  };

  /* ตรวจสอบว่า path ที่อยู่ปัจจุบันคือหน้าเพจอะไร เริ่มต้น: /admin
     อื่นๆ เช่น หน้าเพจจัดการผู้ใช้งาน จัดการรายวิชา ฯลฯ */
  const isActive = (path: string) => {
    if (path === '/admin') {
      return location.pathname === '/admin';
    }
    return location.pathname.startsWith(path);
  };

  // แสดงผลชื่อหน้าเพจ
  const currentPageName = menuItems.find(item => isActive(item.path))?.name || 'ระบบผู้ดูแล (Admin)';

  return (
    <div className="flex min-h-svh w-full min-w-0 bg-slate-50">
      {isSidebarOpen && (
        <button type="button" aria-label="ปิดเมนูด้านข้าง" className="fixed inset-0 z-40 cursor-pointer bg-black/50 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      <aside ref={drawerRef} id="admin-navigation" aria-label="เมนูผู้ดูแลระบบ" onMouseEnter={sidebar.expandOnHover} onMouseLeave={sidebar.stopHoverExpansion} className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,86vw)] flex-col overflow-hidden bg-slate-900 text-white shadow-2xl transition-[width,transform] duration-300 ease-in-out lg:visible lg:sticky lg:top-0 lg:h-svh lg:shrink-0 lg:translate-x-0 lg:shadow-none ${sidebar.desktopExpanded ? 'lg:w-[clamp(14rem,20vw,18rem)]' : 'lg:w-20'} ${isSidebarOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}`}>
        <div className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 px-4 sm:px-5">
          <h1 className="flex min-w-0 items-center gap-2 font-bold">
            {/* Logo */}
            <Shield size={24} className="text-red-500" />
            <span className={`truncate text-sm text-red-400 transition-opacity ${sidebar.desktopExpanded ? 'lg:opacity-100' : 'lg:w-0 lg:opacity-0'}`}>Admin Control Center</span>
          </h1>
          <button ref={closeRef} type="button" aria-label="ปิดเมนูด้านข้าง" onClick={() => setIsSidebarOpen(false)} className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-400 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 lg:hidden">
            <X size={24} />
          </button>
          <button type="button" aria-label={sidebar.collapsed ? 'ขยายเมนูด้านข้าง' : 'ยุบเมนูด้านข้าง'} aria-pressed={sidebar.collapsed} onClick={sidebar.toggleCollapsed} className="hidden size-10 shrink-0 items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 lg:flex">
            {sidebar.collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>
        </div>

        {/* Menu Navigate buttons */}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {/* .map() function ทำหน้าที่วิ่งลูปไปดูข้อมูลในกล่องอาร์เรย์ทีละ element
              จะหยิบข้อมูลทีละตัวส่งเข้าไปในฟังก์ชันที่เขียนไว้ข้างใน
              ส่งอาร์เรย์ชุดใหม่ออกมา: เมื่อมันทำงานครบทุกตัว มันจะรวบรวมผลลัพธ์ทั้งหมดแพ็กใส่กล่องอาร์เรย์ชุดใหม่ item params */}
          {menuItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path); 
            return (
              // กดปุ่มเพื่อ reddirect ไปปยังหน้าต่างที่กำหนด
              <button
                key={item.name}
                onClick={() => { navigate(item.path); setIsSidebarOpen(false); }}
                aria-current={active ? 'page' : undefined}
                title={!sidebar.desktopExpanded ? item.name : undefined}
                className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${active ? 'bg-red-500 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
              >
                <Icon className="shrink-0" size={20} />
                <span className={`whitespace-nowrap transition-opacity ${sidebar.desktopExpanded ? 'lg:opacity-100' : 'lg:w-0 lg:overflow-hidden lg:opacity-0'}`}>{item.name}</span>
              </button>
            );
          })}
        </nav>

        {/* Logout button */}
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

      <main ref={containerRef} className="h-svh min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
        <PullToRefreshIndicator distance={pullDistance} refreshing={refreshing} threshold={threshold} />
        <div className="sticky top-0 z-30">
        {temporary && temporaryAdmin.expiresAt && <div role="status" className="flex flex-wrap items-center justify-between gap-3 bg-amber-100 px-3 py-3 text-sm text-amber-950 sm:px-5 lg:px-8"><span><strong>กำลังใช้สิทธิ์ผู้ดูแลชั่วคราว</strong> · หมดอายุ {new Date(temporaryAdmin.expiresAt).toLocaleTimeString('th-TH')}</span><button type="button" onClick={leaveTemporaryAdmin} className="min-h-10 cursor-pointer rounded-lg border border-amber-700 px-3 py-1.5 font-semibold hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-800">กลับสิทธิ์อาจารย์</button></div>}
        <header className="flex min-h-16 items-center justify-between border-b border-gray-200 bg-white/95 px-3 shadow-sm backdrop-blur sm:px-5 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button ref={triggerRef} type="button" aria-label="เปิดเมนูด้านข้าง" aria-controls="admin-navigation" aria-expanded={isSidebarOpen} onClick={() => setIsSidebarOpen(true)} className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 lg:hidden">
              <Menu size={28} />
            </button>
            <AppBackButton fallbackPath="/admin" tone="red" />
            <h1 className="truncate text-base font-semibold text-gray-800 sm:text-xl">{currentPageName}</h1>
          </div>
        </header>
        </div>
        <div className="w-full min-w-0 p-3 sm:p-5 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
