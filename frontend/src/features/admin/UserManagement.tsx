import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { supabase } from '../../lib/supabaseClient';
import { ShieldAlert, User, ShieldCheck } from 'lucide-react';

interface UserProfile {
  id: string;
  student_id: string;
  full_name: string;
  role: string;
  face_registered: boolean;
  nfc_uid: string | null;
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminId, setAdminId] = useState('');

  useEffect(() => {
    // get current admin ID for logging
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) {
         setAdminId(session.user.id);
      }
    });
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/v1/admin/users');
      setUsers(res.data.users);
    } catch (err) {
      console.error("Error fetching users", err);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!window.confirm(`ต้องการเปลี่ยนสิทธิ์ผู้ใช้นี้เป็น ${newRole.toUpperCase()} ใช่หรือไม่?`)) return;
    try {
      await axios.put(`/api/v1/admin/users/${userId}/role`, {
        role: newRole,
        admin_id: adminId
      });
      alert('เปลี่ยนสิทธิ์สำเร็จ');
      fetchUsers();
    } catch (err: any) {
      alert(`ล้มเหลว: ${err.response?.data?.detail || "เกิดข้อผิดพลาด"}`);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 animate-fade-in">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <ShieldCheck className="text-red-500" /> จัดการสิทธิ์ผู้ใช้งาน
      </h2>

      {loading ? (
        <div className="text-center py-10 text-gray-500">กำลังโหลดข้อมูล...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 text-sm">
                <th className="py-3 px-4 rounded-tl-xl font-semibold">รหัสนักศึกษา/พนักงาน</th>
                <th className="py-3 px-4 font-semibold">ชื่อ-นามสกุล</th>
                <th className="py-3 px-4 font-semibold text-center">Face/NFC</th>
                <th className="py-3 px-4 font-semibold">สิทธิ์ปัจจุบัน (Role)</th>
                <th className="py-3 px-4 rounded-tr-xl font-semibold text-right">ปรับเปลี่ยนสิทธิ์</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {users.map(user => (
                <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 font-medium text-gray-900">{user.student_id || '-'}</td>
                  <td className="py-3 px-4 text-gray-700">{user.full_name}</td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex justify-center gap-2">
                      <span title="Face Reg" className={`w-3 h-3 rounded-full ${user.face_registered ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                      <span title="NFC" className={`w-3 h-3 rounded-full ${user.nfc_uid ? 'bg-blue-500' : 'bg-gray-300'}`}></span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase ${
                      user.role === 'admin' ? 'bg-red-100 text-red-700' : 
                      user.role === 'teacher' ? 'bg-orange-100 text-orange-700' : 
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <select 
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                      value={user.role}
                      onChange={(e) => handleChangeRole(user.id, e.target.value)}
                    >
                      <option value="student">Student</option>
                      <option value="teacher">Teacher</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
