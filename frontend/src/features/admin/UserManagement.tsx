import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  ShieldAlert,
  User,
  Edit,
  Trash2,
  X,
} from "lucide-react";
import { useNotification } from '../../components/notifications/notificationContext';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { useTemporaryAdmin } from '../../contexts/temporaryAdminState';
import { apiErrorMessage } from '../../services/apiError';

// 🌟 1. Interface สำหรับข้อมูลผู้ใช้ที่ดึงมาจาก API
interface UserProfile {
  id: string;
  student_id: string;
  full_name: string;
  role: string;
  face_registered: boolean;
  nfc_uid: string | null;
  academic_year?: number | null;
  class_level?: string | null;
}

// 🌟 2. Interface สำหรับ Form Data (ข้อมูลในช่องกรอก)
interface UserFormData {
  student_id: string;
  full_name: string;
  role: string;
  academic_year: string;
  class_level: string;
}

// Backend derives the admin actor from the verified JWT, never from this payload.
type UpdateUserPayload = {
  student_id?: string;
  full_name?: string;
  role?: string;
  academic_year?: number | null;
  class_level?: string | null;
};

export default function UserManagement() {
  const { notify } = useNotification();
  const temporaryAdmin = useTemporaryAdmin();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // นำ Interface มาผูกกับ State
  const [formData, setFormData] = useState<UserFormData>({
    student_id: "",
    full_name: "",
    role: "student",
    academic_year: "",
    class_level: "",
  });
  
  const [originalData, setOriginalData] = useState<UserFormData>({
    student_id: "",
    full_name: "",
    role: "student",
    academic_year: "",
    class_level: "",
  });
  
  const [formSubmitLoading, setFormSubmitLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get("/api/v1/admin/users");
      setUsers(res.data.users);
    } catch (err) {
      console.error("Error fetching users", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchUsers(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchUsers]);

  const openEditModal = (user: UserProfile) => {
    setSelectedUserId(user.id);
    
    const initialData: UserFormData = {
      student_id: user.student_id || "",
      full_name: user.full_name || "",
      role: user.role,
      academic_year: user.academic_year?.toString() || "",
      class_level: user.class_level || "",
    };
    
    setFormData(initialData);
    setOriginalData(initialData); 
    setIsModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 🌟 ดักจับ Error กรณีไม่มี ID
    if (!selectedUserId) {
      notify('เกิดข้อผิดพลาด: ไม่พบ ID ของผู้ใช้งาน', 'error');
      return;
    }

    if (!formData.full_name.trim()) {
      notify('กรุณากรอกชื่อ-นามสกุล', 'error');
      return;
    }

    const payload: UpdateUserPayload = {};

    let hasChanges = false;

    // เช็คทีละฟิลด์ ถ้าอันไหนเปลี่ยน ค่อยยัดใส่ Payload
    if (formData.student_id !== originalData.student_id) {
      payload.student_id = formData.student_id;
      hasChanges = true;
    }
    if (formData.full_name !== originalData.full_name) {
      payload.full_name = formData.full_name;
      hasChanges = true;
    }
    if (formData.role !== originalData.role) {
      payload.role = formData.role;
      hasChanges = true;
    }
    if (formData.academic_year !== originalData.academic_year) {
      payload.academic_year = formData.academic_year ? Number(formData.academic_year) : null;
      hasChanges = true;
    }
    if (formData.class_level !== originalData.class_level) {
      payload.class_level = formData.class_level.trim() || null;
      hasChanges = true;
    }

    // ถ้าไม่มีการเปลี่ยนแปลง ให้ปิด Modal ไปเลย ไม่ต้องส่ง API
    if (!hasChanges) {
      setIsModalOpen(false);
      return;
    }

    try {
      setFormSubmitLoading(true);
      
      // ส่งเฉพาะข้อมูลที่เปลี่ยน; backend อ่าน admin id จาก access token
      await axios.put(`/api/v1/admin/users/${selectedUserId}/info`, payload);
      
      notify('แก้ไขข้อมูลผู้ใช้งานสำเร็จ', 'success');
      setIsModalOpen(false);
      fetchUsers(); 
    } catch (err: unknown) {
      notify(apiErrorMessage(err, "เกิดข้อผิดพลาดในการบันทึกข้อมูล"), 'error');
    } finally {
      setFormSubmitLoading(false);
    }
  };

  const handleDeleteUser = (userId: string, userName: string) => {
    setPendingDelete({ id: userId, name: userName });
  };

  const confirmDeleteUser = async () => {
    if (!pendingDelete) return;
    try {
      setDeleteLoading(true);
      await axios.delete(`/api/v1/admin/users/${pendingDelete.id}`);
      notify('ลบผู้ใช้งานสำเร็จ', 'success');
      setPendingDelete(null);
      fetchUsers();
    } catch (err: unknown) {
      notify(apiErrorMessage(err, 'เกิดข้อผิดพลาดในการลบผู้ใช้งาน'), 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm animate-fade-in sm:p-6">
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="ลบผู้ใช้งาน"
        description={`ต้องการลบ “${pendingDelete?.name || ''}” ออกจากระบบหรือไม่?\nการดำเนินการนี้ไม่สามารถย้อนกลับได้`}
        confirmLabel="ลบผู้ใช้งาน"
        danger
        busy={deleteLoading}
        onConfirm={confirmDeleteUser}
        onCancel={() => setPendingDelete(null)}
      />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="bg-red-50 p-2 rounded-xl text-red-500">
            <ShieldAlert size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">
              จัดการผู้ใช้งานและสิทธิ์ (User Management)
            </h2>
            <p className="text-sm text-gray-500">
              ตรวจสอบสิทธิ์ เปลี่ยนระดับผู้ใช้งาน และจัดการข้อมูลนักศึกษา/อาจารย์
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">
          กำลังโหลดข้อมูลผู้ใช้งาน...
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-max border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <th className="py-3 px-4">ผู้ใช้งาน</th>
                <th className="py-3 px-4">รหัสนักศึกษา/พนักงาน</th>
                <th className="py-3 px-4 text-center">สถานะการลงทะเบียน</th>
                <th className="py-3 px-4">ชั้นปี / ห้อง</th>
                <th className="py-3 px-4">สิทธิ์ปัจจุบัน</th>
                <th className="py-3 px-4 text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="hover:bg-slate-50/50 transition-colors"
                >
                  <td className="py-3 px-4 font-medium flex items-center gap-3">
                    <div className="bg-gray-100 p-2 rounded-full text-gray-500">
                      <User size={16} />
                    </div>
                    <span>{user.full_name || "ไม่ระบุชื่อ"}</span>
                  </td>
                  <td className="py-3 px-4 font-mono text-gray-600">
                    {user.student_id || "-"}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-4 text-xs font-medium">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${user.face_registered ? "bg-green-500" : "bg-gray-300"}`}
                        ></span>
                        ใบหน้า
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${user.nfc_uid ? "bg-blue-500" : "bg-gray-300"}`}
                        ></span>
                        บัตร NFC
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-600">{user.academic_year ? `ปี ${user.academic_year}` : '-'}{user.class_level ? ` / ${user.class_level}` : ''}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase ${
                        user.role === "admin"
                          ? "bg-red-100 text-red-700"
                          : user.role === "teacher"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => openEditModal(user)}
                        className="text-blue-500 hover:text-blue-700 p-1.5 hover:bg-white border border-transparent hover:border-gray-200 rounded-md transition-all shadow-sm cursor-pointer"
                        title="แก้ไขข้อมูลรายละเอียดและสิทธิ์"
                      >
                        <Edit size={16} />
                      </button>

                      {!temporaryAdmin.active && (
                        <button
                          onClick={() => handleDeleteUser(user.id, user.full_name)}
                          className="text-red-500 hover:text-red-700 p-1.5 hover:bg-white border border-transparent hover:border-gray-200 rounded-md transition-all shadow-sm cursor-pointer"
                          title="ลบผู้ใช้งาน"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    ไม่มีข้อมูลผู้ใช้งานในระบบ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm animate-fade-in sm:p-4">
          <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-xl transition-all sm:max-h-[calc(100dvh-2rem)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-slate-50 px-4 py-4 sm:px-6">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Edit size={18} className="text-blue-500" />{" "}
                แก้ไขข้อมูลผู้ใช้งาน
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                aria-label="ปิดหน้าต่างแก้ไขผู้ใช้งาน"
                className="flex size-10 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveUser} noValidate className="space-y-4 p-4 sm:p-6">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  ชื่อ-นามสกุล <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น นายสมชาย ใจดี"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                />
              </div>

              {formData.role === 'student' && <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                <div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">ชั้นปี</label><select value={formData.academic_year} onChange={(e) => setFormData({ ...formData, academic_year: e.target.value })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"><option value="">ไม่ระบุ</option>{[1,2,3,4,5,6,7,8].map((year) => <option key={year} value={year}>{year}</option>)}</select></div>
                <div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">ห้อง / กลุ่ม</label><input value={formData.class_level} maxLength={50} onChange={(e) => setFormData({ ...formData, class_level: e.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" /></div>
              </div>}

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  รหัสนักศึกษา / รหัสพนักงาน
                </label>
                <input
                  type="text"
                  placeholder="เช่น 64010123"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  value={formData.student_id}
                  onChange={(e) => setFormData({ ...formData, student_id: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  สิทธิ์การใช้งาน (Role)
                </label>
                <select
                  disabled={temporaryAdmin.active}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="student">Student (นักศึกษา)</option>
                  <option value="teacher">Teacher (อาจารย์)</option>
                  <option value="admin">Admin (ผู้ดูแลระบบ)</option>
                </select>
                {temporaryAdmin.active && (
                  <p className="mt-1.5 text-xs text-amber-700">สิทธิ์ชั่วคราวแก้ไขระดับสิทธิ์ของบัญชีไม่ได้</p>
                )}
              </div>

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
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors cursor-pointer bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400"
                >
                  {formSubmitLoading ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
