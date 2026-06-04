// src/components/layout/StudentLayout.tsx
import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Home, History, User } from 'lucide-react'; // ใช้ไอคอนจาก lucide-react

export default function StudentLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { name: 'หน้าหลัก', path: '/student', icon: Home },
    { name: 'ประวัติ', path: '/student/history', icon: History },
    { name: 'โปรไฟล์', path: '/student/profile', icon: User },
  ];

  return (
    // จำกัดความกว้างสูงสุดเพื่อให้ดูเหมือนแอปมือถือแม้เปิดบน PC
    <div className="min-h-screen bg-gray-50 flex justify-center">
      <div className="w-full max-w-md bg-white min-h-screen shadow-lg flex flex-col relative">
        
        {/* พื้นที่สำหรับแสดงเนื้อหาหน้าต่างๆ (เช่น กล้อง, ประวัติ) */}
        <main className="flex-1 overflow-y-auto pb-20">
          <Outlet /> 
        </main>

        {/* แถบเมนูด้านล่าง (Bottom Navigation) */}
        <nav className="absolute bottom-0 w-full bg-white border-t border-gray-200 flex justify-around p-3 z-50 rounded-t-xl shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.name}
                onClick={() => navigate(item.path)}
                className={`flex flex-col items-center p-2 rounded-lg transition-colors cursor-pointer ${
                  isActive ? 'text-orange-500' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Icon size={24} className={isActive ? 'mb-1' : 'mb-1 opacity-80'} />
                <span className="text-[10px] font-medium">{item.name}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}