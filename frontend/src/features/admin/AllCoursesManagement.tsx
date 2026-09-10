import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { BookOpen, Settings, Edit, Trash2 } from 'lucide-react';
import EditCourseModal from '../teacher/EditCourseModal';
import CourseSettingsModal from '../teacher/CourseSettings';
import { useNotification } from '../../components/notifications/notificationContext';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { useTemporaryAdmin } from '../../contexts/temporaryAdminState';
import { apiErrorMessage } from '../../services/apiError';

interface Course {
  id: string;
  course_code: string;
  course_name: string;
  section: number;
  semester: number;
  year: number;
  total_sessions?: number;
  late_threshold_minutes?: number;
  absent_threshold_minutes?: number;
  max_absence_percent?: number;
  profiles?: { full_name?: string | null } | null;
}

export default function AllCoursesManagement() {
  const { notify } = useNotification();
  const temporaryAdmin = useTemporaryAdmin();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  // States for Modals
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedCourseForEdit, setSelectedCourseForEdit] = useState<Course | null>(null);
  
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [selectedCourseForConfig, setSelectedCourseForConfig] = useState<Course | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; code: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fetchCourses = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/v1/admin/courses');
      setCourses(res.data.courses || []);
    } catch (err) {
      console.error("Error fetching courses", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchCourses(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchCourses]);

  const confirmDeleteCourse = async () => {
    if (!pendingDelete) return;
    try {
      setDeleteBusy(true);
      await axios.delete(`/api/v1/courses/${pendingDelete.id}`);
      notify('ลบรายวิชาสำเร็จ', 'success');
      setPendingDelete(null);
      await fetchCourses();
    } catch (error: unknown) {
      notify(`ลบไม่สำเร็จ: ${apiErrorMessage(error, 'ติดข้อจำกัดด้านฐานข้อมูล')}`, 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm animate-fade-in sm:p-6">
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="ลบรายวิชา"
        description={`ต้องการลบรายวิชา ${pendingDelete?.code || ''} หรือไม่?\nข้อมูลที่เกี่ยวข้องอาจไม่สามารถกู้คืนได้`}
        confirmLabel="ลบรายวิชา"
        danger
        busy={deleteBusy}
        onConfirm={confirmDeleteCourse}
        onCancel={() => setPendingDelete(null)}
      />
      {/* 🌟 Modal แก้ไขรายวิชา (ใช้ร่วมกับ Teacher) */}
      {isEditModalOpen && selectedCourseForEdit && (
        <EditCourseModal course={selectedCourseForEdit} onClose={() => setIsEditModalOpen(false)} onSuccess={fetchCourses} />
      )}

      {/* 🌟 Modal ตั้งค่าเกณฑ์ (ใช้ร่วมกับ Teacher) */}
      {isSettingsModalOpen && selectedCourseForConfig && (
        <CourseSettingsModal courseId={selectedCourseForConfig.id} currentConfig={{ total_sessions: selectedCourseForConfig.total_sessions, late_threshold_minutes: selectedCourseForConfig.late_threshold_minutes, absent_threshold_minutes: selectedCourseForConfig.absent_threshold_minutes, max_absence_percent: selectedCourseForConfig.max_absence_percent }} onSaveSuccess={fetchCourses} onClose={() => setIsSettingsModalOpen(false)} />
      )}

      <h2 className="mb-6 flex items-start gap-2 text-xl font-bold text-gray-800 sm:items-center sm:text-2xl">
        <BookOpen className="shrink-0 text-red-500" /> จัดการข้อมูลรายวิชา (All Courses)
      </h2>

      {loading ? (
        <div className="text-center py-10 text-gray-500">กำลังโหลดข้อมูล...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 text-sm">
                <th className="py-3 px-4 rounded-tl-xl font-semibold">รหัสวิชา</th>
                <th className="py-3 px-4 font-semibold">ชื่อวิชา</th>
                <th className="py-3 px-4 font-semibold">ผู้สอน (อาจารย์)</th>
                <th className="py-3 px-4 font-semibold">เทอม/ปี</th>
                <th className="py-3 px-4 font-semibold text-center">จำนวนครั้งที่สอน</th>
                <th className="py-3 px-4 rounded-tr-xl font-semibold text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {courses.map(course => (
                <tr key={course.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 font-bold text-red-600">{course.course_code}</td>
                  <td className="py-3 px-4 font-medium text-gray-900">{course.course_name} <span className="text-xs text-gray-500 block">Sec: {course.section}</span></td>
                  <td className="py-3 px-4 text-gray-700">{course.profiles?.full_name || 'ไม่ทราบ'}</td>
                  <td className="py-3 px-4 text-gray-700">{course.semester}/{course.year}</td>
                  <td className="py-3 px-4 text-center">{course.total_sessions}</td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => { setSelectedCourseForConfig(course); setIsSettingsModalOpen(true); }} className="text-gray-500 hover:text-slate-800 p-1.5 hover:bg-white border border-transparent hover:border-gray-200 rounded-md transition-all shadow-sm" title="ตั้งค่าเกณฑ์เข้าเรียน"><Settings size={18} /></button>
                      <button onClick={() => { setSelectedCourseForEdit(course); setIsEditModalOpen(true); }} className="text-blue-500 hover:text-blue-700 p-1.5 hover:bg-white border border-transparent hover:border-gray-200 rounded-md transition-all shadow-sm" title="แก้ไขข้อมูล"><Edit size={18} /></button>
                      {!temporaryAdmin.active && (
                        <button onClick={() => setPendingDelete({ id: course.id, code: course.course_code })} className="text-red-500 hover:text-red-700 p-1.5 hover:bg-white border border-transparent hover:border-gray-200 rounded-md transition-all shadow-sm" title="ลบรายวิชา"><Trash2 size={18} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {courses.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">ไม่มีข้อมูลรายวิชาในระบบ</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
