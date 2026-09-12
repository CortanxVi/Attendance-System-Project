// src/components/layout/StudentLayout.tsx
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { BookOpen, Home, History, User } from 'lucide-react'; // ใช้ไอคอนจาก lucide-react
import AppBackButton from '../navigation/AppBackButton';
import PullToRefreshIndicator from './PullToRefreshIndicator';
import { usePullToRefresh } from './usePullToRefresh';

export default function StudentLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { containerRef, pullDistance, refreshing, threshold } = usePullToRefresh<HTMLElement>();

  const navItems = [
    { name: 'หน้าหลัก', path: '/student', icon: Home },
    { name: 'ประวัติ', path: '/student/history', icon: History },
    { name: 'รายวิชา', path: '/student/courses', icon: BookOpen },
    { name: 'โปรไฟล์', path: '/student/profile', icon: User },
  ];
  const currentPageName = location.pathname.startsWith('/student/history/')
    ? 'รายละเอียดรายวิชา'
    : location.pathname === '/student/register'
      ? 'ลงทะเบียนใบหน้า'
      : location.pathname === '/student/requests'
        ? 'คำร้องถึงอาจารย์'
        : navItems.find((item) => item.path === location.pathname)?.name || 'ระบบนักศึกษา';

  return (
    // Mobile-only shell: ใช้ความสูง visual viewport และให้ main เป็น scroll owner เพียงจุดเดียว
    <div className="student-app-viewport">
      <div className="student-app-shell">
        <header className="student-top-bar">
          <AppBackButton fallbackPath="/student" />
          <h1 className="min-w-0 flex-1 truncate pr-11 text-center text-sm font-bold text-slate-800">{currentPageName}</h1>
        </header>
        
        {/* พื้นที่สำหรับแสดงเนื้อหาหน้าต่างๆ (เช่น กล้อง, ประวัติ) */}
        <main ref={containerRef} id="student-scroll-region" className="student-content-scroll" tabIndex={-1}>
          <PullToRefreshIndicator distance={pullDistance} refreshing={refreshing} threshold={threshold} />
          <Outlet /> 
        </main>

        {/* แถบเมนูด้านล่าง (Bottom Navigation) */}
        <nav aria-label="เมนูหลักของนักศึกษา" className="student-bottom-nav z-50 flex w-full justify-around border-t border-gray-200 bg-white shadow-[0_-4px_10px_-4px_rgba(15,23,42,0.12)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.path === '/student/profile'
              ? ['/student/profile', '/student/register', '/student/requests'].includes(location.pathname)
              : location.pathname === item.path;
            return (
              <button
                type="button"
                key={item.name}
                onClick={() => navigate(item.path)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center rounded-xl px-1.5 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 ${
                  isActive ? 'text-orange-500' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Icon aria-hidden="true" size={22} className={isActive ? 'mb-1' : 'mb-1 opacity-80'} />
                <span className="max-w-full truncate text-[11px] font-semibold leading-none">{item.name}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
