// Initial Page and for all menus
import { useCallback, useEffect, useState } from 'react';
import { Users, BookOpen, ShieldCheck } from 'lucide-react';
import axios from 'axios';

export default function SystemOverview() {
  const [stats, setStats] = useState({ users: 0, courses: 0, adminCount: 0 });

  const fetchStats = useCallback(async () => {
    try {
      const [usersRes, coursesRes] = await Promise.all([
        axios.get<{ users?: Array<{ role?: string }> }>('/api/v1/admin/users'),
        axios.get<{ courses?: unknown[] }>('/api/v1/admin/courses'),
      ]);
      const users = usersRes.data.users ?? [];
      const courses = coursesRes.data.courses ?? [];

      setStats({
        users: users.length,
        courses: courses.length,
        adminCount: users.filter((user) => user.role === 'admin').length
      });
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchStats(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchStats]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800 sm:text-2xl">ภาพรวมระบบ (System Overview)</h2>
          <p className="text-gray-500 mt-1">ยินดีต้อนรับสู่ศูนย์ควบคุมผู้ดูแลระบบ</p>
        </div>
        
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:gap-6">
        <div className="flex min-w-0 items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="bg-blue-100 p-4 rounded-xl text-blue-600">
            <Users size={28} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">ผู้ใช้งานทั้งหมด</p>
            <p className="text-2xl font-bold text-gray-900">{stats.users} <span className="text-sm font-normal text-gray-500">บัญชี</span></p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="bg-orange-100 p-4 rounded-xl text-orange-600">
            <BookOpen size={28} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">รายวิชาในระบบ</p>
            <p className="text-2xl font-bold text-gray-900">{stats.courses} <span className="text-sm font-normal text-gray-500">วิชา</span></p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="bg-red-100 p-4 rounded-xl text-red-600">
            <ShieldCheck size={28} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">ผู้ดูแลระบบ (Admin)</p>
            <p className="text-2xl font-bold text-gray-900">{stats.adminCount} <span className="text-sm font-normal text-gray-500">บัญชี</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
