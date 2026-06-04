import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Settings, LogOut, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

export default function TeacherLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // เมื่อ log out ระบบจะจัดการส่งกลับหน้า login เองผ่าน App.tsx
  };

  const menuItems = [
    { name: 'หน้าหลักรายวิชา', path: '/teacher', icon: LayoutDashboard },
    { name: 'รายงานการเข้าเรียน', path: '/teacher/reports', icon: FileText },
    { name: 'จัดการนักศึกษา', path: '/teacher/students', icon: Users },
    { name: 'ตั้งค่าระบบ', path: '/teacher/settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-gray-100">
      {/* แถบเมนูด้านซ้าย (Sidebar) */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 font-bold text-xl border-b border-slate-800 text-orange-400">
          KMUTNB Admin
        </div>
        <nav className="flex-1 py-6 space-y-1 px-3">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.name}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
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
          <h1 className="text-xl font-semibold text-gray-800">ระบบจัดการการเข้าเรียน</h1>
          <div className="flex items-center gap-4">
             {/* จุดแสดงสถานะ NFC (จะต่อเติมใน Step หลังๆ) */}
             <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full border border-gray-200">
                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                NFC: ปิดใช้งาน
             </div>
          </div>
        </header>
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}