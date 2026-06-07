import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { BookOpen, UserPlus, FileText, Users, Settings, LogOut, LayoutDashboard, Menu, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

export default function TeacherLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // เมื่อ log out ระบบจะจัดการส่งกลับหน้า login เองผ่าน App.tsx
  };

  const menuItems = [
    { name: 'รายวิชาที่สอน', path: '/teacher', icon: BookOpen },
    { name: 'ลงทะเบียนบัตร NFC', path: '/teacher/register-nfc', icon: UserPlus },
    { name: 'รายงานการเข้าเรียน', path: '/teacher/reports', icon: FileText },
    { name: 'จัดการนักศึกษา', path: '/teacher/students', icon: Users },
    { name: 'ตั้งค่าระบบ', path: '/teacher/settings', icon: Settings },
  ];

  // ตรวจสอบว่าเมนูไหน Active: index route ใช้ exact match, sub-routes ใช้ startsWith
  const isActive = (path: string) => {
    if (path === '/teacher') {
      return location.pathname === '/teacher';
    }
    return location.pathname.startsWith(path);
  };

  // ชื่อหน้าปัจจุบันสำหรับแสดงบน mobile header
  const currentPageName = menuItems.find(item => isActive(item.path))?.name || 'ระบบจัดการการเข้าเรียน';

  return (
    <div className="flex h-screen bg-gray-100">
      {/* แถบดำทับหน้าจอเมื่อเปิด Sidebar บนมือถือ */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* แถบเมนูด้านซ้าย (Sidebar) */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800">
          <h1 className="font-bold text-xl flex items-center gap-2">
            <LayoutDashboard size={24} className="text-orange-500" />
            <span className="text-orange-400 text-lg">Attendance System</span>
          </h1>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 py-6 space-y-1 px-3">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.name}
                onClick={() => { navigate(item.path); setIsSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
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
      <main className="flex-1 overflow-y-auto">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shadow-sm">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden text-slate-800 focus:outline-none">
              <Menu size={28} />
            </button>
            <h1 className="text-xl font-semibold text-gray-800">{currentPageName}</h1>
          </div>
        </header>
        <div className="p-6 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}