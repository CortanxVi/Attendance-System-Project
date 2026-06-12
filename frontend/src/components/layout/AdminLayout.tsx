import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Shield, Users, BookOpen, FileText, ClipboardList, LogOut, LayoutDashboard, Menu, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const menuItems = [
    { name: 'ภาพรวมระบบ', path: '/admin', icon: LayoutDashboard },
    { name: 'จัดการผู้ใช้งาน', path: '/admin/users', icon: Users },
    { name: 'จัดการรายวิชา', path: '/admin/courses', icon: BookOpen },
    { name: 'ตรวจสอบ Log (Audit)', path: '/admin/logs', icon: ClipboardList },
    { name: 'ออกรายงาน (Export)', path: '/admin/reports', icon: FileText },
  ];

  const isActive = (path: string) => {
    if (path === '/admin') {
      return location.pathname === '/admin';
    }
    return location.pathname.startsWith(path);
  };

  const currentPageName = menuItems.find(item => isActive(item.path))?.name || 'ระบบผู้ดูแล (Admin)';

  return (
    <div className="flex h-screen bg-slate-50">
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800">
          <h1 className="font-bold text-xl flex items-center gap-2">
            <Shield size={24} className="text-red-500" />
            <span className="text-red-400 text-sm">Admin Control Center</span>
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
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer ${active ? 'bg-red-500 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
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
