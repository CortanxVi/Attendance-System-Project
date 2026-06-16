import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { supabase } from '../../lib/supabaseClient';
import { ShieldAlert, User, ShieldCheck, Plus, Edit, Trash2, X } from 'lucide-react';

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

  // 🌟 States สำหรับจัดการ Modal (เพิ่ม / แก้ไข ผู้ใช้งาน)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  
  // States สำหรับข้อมูลในฟอร์ม
  const [formData, setFormData] = useState({
    student_id: '',
    full_name: '',
    role: 'student'
  });
  const [formSubmitLoading, setFormSubmitLoading] = useState(false);

  useEffect(() => {
    // ดึงรหัสแอดมินปัจจุบันเพื่อใช้ในการบันทึก Log
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

  // 🔄 ฟังก์ชันเปลี่ยน Role แบบด่วนจาก Dropdown (โค้ดเดิมคงไว้)
  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!window.confirm(`ต้องการเปลี่ยนสิทธิ์ผู้ใช้นี้เป็น ${newRole.toUpperCase()} ใช่หรือไม่?`)) return;
    try {
      await axios.put(`/api/v1/admin/users/${userId}/role`, {
        role: newRole,
        admin_id: adminId
      });
      alert("เปลี่ยนสิทธิ์สำเร็จ");
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.detail || "เกิดข้อผิดพลาดในการเปลี่ยนสิทธิ์");
    }
  };

  // ➕ เปิด Modal สำหรับเพิ่มผู้ใช้ใหม่
  const openAddModal = () => {
    setModalMode('add');
    setSelectedUserId(null);
    setFormData({ student_id: '', full_name: '', role: 'student' });
    setIsModalOpen(true);
  };

  // 🛠️ เปิด Modal สำหรับแก้ไขข้อมูลผู้ใช้เดิม
  const openEditModal = (user: UserProfile) => {
    setModalMode('edit');
    setSelectedUserId(user.id);
    setFormData({
      student_id: user.student_id || '',
      full_name: user.full_name || '',
      role: user.role
    });
    setIsModalOpen(true);
  };

  // 💾 ฟังก์ชันบันทึกข้อมูล (ทั้ง Add และ Edit)
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.full_name.trim()) {
      alert("กรุณากรอกชื่อ-นามสกุล");
      return;
    }

    try {
      setFormSubmitLoading(true);
      if (modalMode === 'add') {
        // เรียก API เพิ่มผู้ใช้ใหม่
        await axios.post('/api/v1/admin/users', {
          ...formData,
          admin_id: adminId
        });
        alert("เพิ่มผู้ใช้งานสำเร็จ");
      } else {
        // เรียก API แก้ไขข้อมูลผู้ใช้เดิม
        await axios.put(`/api/v1/admin/users/${selectedUserId}/info`, {
          ...formData,
          admin_id: adminId
        });
        alert("แก้ไขข้อมูลผู้ใช้งานสำเร็จ");
      }
      setIsModalOpen(false);
      fetchUsers(); // รีเฟรชตารางข้อมูล
    } catch (err: any) {
      alert(err.response?.data?.detail || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
    } finally {
      setFormSubmitLoading(false);
    }
  };

  // ❌ ฟังก์ชันลบผู้ใช้งาน
  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!window.confirm(`⚠️ คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้ "${userName}"ออกจากระบบ?\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้`)) return;
    try {
      await axios.delete(`/api/v1/admin/users/${userId}`, {
        params: { admin_id: adminId }
      });
      alert("ลบผู้ใช้งานสำเร็จ");
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.detail || "เกิดข้อผิดพลาดในการลบผู้ใช้งาน");
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6 animate-fade-in">
      {/* ส่วนหัวหน้าเว็บและปุ่มเพิ่มผู้ใช้ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="bg-red-50 p-2 rounded-xl text-red-500">
            <ShieldAlert size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">จัดการผู้ใช้งานและสิทธิ์ (User Management)</h2>
            <p className="text-sm text-gray-500">ตรวจสอบสิทธิ์ เปลี่ยนระดับผู้ใช้งาน และจัดการข้อมูลนักศึกษา/อาจารย์</p>
          </div>
        </div>
        
        {/* ปุ่มเพิ่มผู้ใช้งานใหม่ */}
        <button
          onClick={openAddModal}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer self-start sm:self-center"
        >
          <Plus size={18} />
          เพิ่มผู้ใช้งาน
        </button>
      </div>

      {/* ตารางแสดงข้อมูล */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <th className="py-3 px-4">ผู้ใช้งาน</th>
                <th className="py-3 px-4">รหัสนักศึกษา/พนักงาน</th>
                <th className="py-3 px-4 text-center">สถานะอุปกรณ์</th>
                <th className="py-3 px-4">สิทธิ์ปัจจุบัน</th>
                <th className="py-3 px-4 text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3 px-4 font-medium flex items-center gap-3">
                    <div className="bg-gray-100 p-2 rounded-full text-gray-500">
                      <User size={16} />
                    </div>
                    <span>{user.full_name || 'ไม่ระบุชื่อ'}</span>
                  </td>
                  <td className="py-3 px-4 font-mono text-gray-600">
                    {user.student_id || '-'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-4 text-xs font-medium">
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${user.face_registered ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        ใบหน้า
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${user.nfc_uid ? 'bg-blue-500' : 'bg-gray-300'}`}></span>
                        บัตร NFC
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase ${
                      user.role === 'admin' ? 'bg-red-100 text-red-700' : 
                      user.role === 'teacher' ? 'bg-orange-100 text-orange-700' : 
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {/* Dropdown เปลี่ยนบทบาทด่วน (โค้ดเดิมคงไว้เพื่อความสะดวก) */}
                      <select 
                        className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                        value={user.role}
                        onChange={(e) => handleChangeRole(user.id, e.target.value)}
                      >
                        <option value="student">Student</option>
                        <option value="teacher">Teacher</option>
                        <option value="admin">Admin</option>
                      </select>

                      {/* ปุ่มแก้ไขข้อมูล */}
                      <button
                        onClick={() => openEditModal(user)}
                        className="text-blue-500 hover:text-blue-700 p-1.5 hover:bg-white border border-transparent hover:border-gray-200 rounded-md transition-all shadow-sm cursor-pointer"
                        title="แก้ไขข้อมูลรายละเอียด"
                      >
                        <Edit size={16} />
                      </button>

                      {/* ปุ่มลบผู้ใช้ */}
                      <button
                        onClick={() => handleDeleteUser(user.id, user.full_name)}
                        className="text-red-500 hover:text-red-700 p-1.5 hover:bg-white border border-transparent hover:border-gray-200 rounded-md transition-all shadow-sm cursor-pointer"
                        title="ลบผู้ใช้งาน"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">ไม่มีข้อมูลผู้ใช้งานในระบบ</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 🖥️ หน้าต่าง Modal สำหรับเพิ่ม/แก้ไขผู้ใช้งาน (Popup Form) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl border border-gray-100 overflow-hidden transform transition-all">
            {/* ส่วนหัว Modal */}
            <div className="bg-slate-50 px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                {modalMode === 'add' ? (
                  <><Plus size={18} className="text-red-500" /> เพิ่มผู้ใช้งานใหม่</>
                ) : (
                  <><Edit size={18} className="text-blue-500" /> แก้ไขข้อมูลผู้ใช้งาน</>
                )}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* ฟอร์มกรอกข้อมูล */}
            <form onSubmit={handleSaveUser} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  ชื่อ-นามสกุล <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น นายสมชาย ใจดี"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  รหัสนักศึกษา / รหัสพนักงาน
                </label>
                <input
                  type="text"
                  placeholder="เช่น 64010123 (ระบุเฉพาะกลุ่มนักศึกษา/อาจารย์)"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                  value={formData.student_id}
                  onChange={(e) => setFormData({ ...formData, student_id: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  สิทธิ์การใช้งาน (Role)
                </label>
                <select
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="student">Student (นักศึกษา)</option>
                  <option value="teacher">Teacher (อาจารย์ผู้สอน)</option>
                  <option value="admin">Admin (ผู้ดูแลระบบ)</option>
                </select>
              </div>

              {/* ปุ่มกดยืนยัน / ยกเลิก */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={formSubmitLoading}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors cursor-pointer ${
                    modalMode === 'add' 
                      ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-400' 
                      : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400'
                  }`}
                >
                  {formSubmitLoading ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}