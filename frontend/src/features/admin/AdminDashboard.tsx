import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Users, BookOpen, ShieldCheck } from 'lucide-react';
import axios from 'axios';

export default function AdminDashboard() {
  const [stats, setStats] = useState({ users: 0, courses: 0, adminCount: 0 });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      // Fetch users
      const usersRes = await axios.get('/api/v1/admin/users');
      const users = usersRes.data.users || [];
      
      // Fetch courses
      const coursesRes = await axios.get('/api/v1/admin/courses');
      const courses = coursesRes.data.courses || [];

      setStats({
        users: users.length,
        courses: courses.length,
        adminCount: users.filter((u: any) => u.role === 'admin').length
      });
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">ภาพรวมระบบ (System Overview)</h2>
          <p className="text-gray-500 mt-1">ยินดีต้อนรับสู่ศูนย์ควบคุมผู้ดูแลระบบ</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="bg-blue-100 p-4 rounded-xl text-blue-600">
            <Users size={28} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">ผู้ใช้งานทั้งหมด</p>
            <p className="text-2xl font-bold text-gray-900">{stats.users} <span className="text-sm font-normal text-gray-500">บัญชี</span></p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="bg-orange-100 p-4 rounded-xl text-orange-600">
            <BookOpen size={28} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">รายวิชาในระบบ</p>
            <p className="text-2xl font-bold text-gray-900">{stats.courses} <span className="text-sm font-normal text-gray-500">วิชา</span></p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
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
