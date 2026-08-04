import { useEffect, useState } from "react";
import axios from "axios";
import { supabase } from "../../lib/supabaseClient";
import {
  ShieldAlert,
  User,
  ShieldCheck,
  Edit,
  Trash2,
  X,
} from "lucide-react";

// 🌟 1. Interface สำหรับข้อมูลผู้ใช้ที่ดึงมาจาก API
interface UserProfile {
  id: string;
  student_id: string;
  full_name: string;
  role: string;
  face_registered: boolean;
  nfc_uid: string | null;
}

// 🌟 2. Interface สำหรับ Form Data (ข้อมูลในช่องกรอก)
interface UserFormData {
  student_id: string;
  full_name: string;
  role: string;
}

// 🌟 3. Interface สำหรับ Payload ที่จะส่งไป API หลังบ้าน (ใช้ Partial เพื่อให้ฟิลด์บางตัวเป็น Optional ได้)
interface UpdateUserPayload extends Partial<UserFormData> {
  admin_id: string; // บังคับว่าต้องมี admin_id เสมอเพื่อเอาไปบันทึก Log
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminId, setAdminId] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // นำ Interface มาผูกกับ State
  const [formData, setFormData] = useState<UserFormData>({
    student_id: "",
    full_name: "",
    role: "student",
  });
  
  const [originalData, setOriginalData] = useState<UserFormData>({
    student_id: "",
    full_name: "",
    role: "student",
  });
  
  const [formSubmitLoading, setFormSubmitLoading] = useState(false);

  useEffect(() => {
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
      const res = await axios.get("/api/v1/admin/users");
      setUsers(res.data.users);
    } catch (err) {
      console.error("Error fetching users", err);
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (user: UserProfile) => {
    setSelectedUserId(user.id);
    
    const initialData: UserFormData = {
      student_id: user.student_id || "",
      full_name: user.full_name || "",
      role: user.role,
    };
    
    setFormData(initialData);
    setOriginalData(initialData); 
    setIsModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 🌟 ดักจับ Error กรณีไม่มี ID
    if (!selectedUserId) {
      alert("เกิดข้อผิดพลาด: ไม่พบ ID ของผู้ใช้งาน");
      return;
    }

    if (!formData.full_name.trim()) {
      alert("กรุณากรอกชื่อ-นามสกุล");
      return;
    }

    // 🌟 จัดเตรียม Payload โดยบังคับใส่ admin_id เสมอ
    const payload: UpdateUserPayload = {
      admin_id: adminId,
    };

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

    // ถ้าไม่มีการเปลี่ยนแปลง ให้ปิด Modal ไปเลย ไม่ต้องส่ง API
    if (!hasChanges) {
      setIsModalOpen(false);
      return;
    }

    try {
      setFormSubmitLoading(true);
      
      // ส่ง payload ที่มีเฉพาะข้อมูลที่ถูกแก้ + admin_id ไปที่ API
      await axios.put(`/api/v1/admin/users/${selectedUserId}/info`, payload);
      
      alert("แก้ไขข้อมูลผู้ใช้งานสำเร็จ");
      setIsModalOpen(false);
      fetchUsers(); 
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      let errMsg = "เกิดข้อผิดพลาดในการบันทึกข้อมูล";
      if (typeof detail === 'string') {
        errMsg = detail;
      } else if (Array.isArray(detail)) {
        errMsg = detail.map((d: any) => `${d.loc?.join('.')} : ${d.msg}`).join('\\n');
      }
      alert(errMsg);
    } finally {
      setFormSubmitLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!window.confirm(`⚠️ คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้ "${userName}" ออกจากระบบ?\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้`)) return;
    try {
      await axios.delete(`/api/v1/admin/users/${userId}`, {
        params: { admin_id: adminId },
      });
      alert("ลบผู้ใช้งานสำเร็จ");
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.detail || "เกิดข้อผิดพลาดในการลบผู้ใช้งาน");
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6 animate-fade-in">
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
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <th className="py-3 px-4">ผู้ใช้งาน</th>
                <th className="py-3 px-4">รหัสนักศึกษา/พนักงาน</th>
                <th className="py-3 px-4 text-center">สถานะการลงทะเบียน</th>
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
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    ไม่มีข้อมูลผู้ใช้งานในระบบ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl border border-gray-100 overflow-hidden transform transition-all">
            <div className="bg-slate-50 px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Edit size={18} className="text-blue-500" />{" "}
                แก้ไขข้อมูลผู้ใช้งาน
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 space-y-4">
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
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="student">Student (นักศึกษา)</option>
                  <option value="teacher">Teacher (อาจารย์)</option>
                  <option value="admin">Admin (ผู้ดูแลระบบ)</option>
                </select>
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