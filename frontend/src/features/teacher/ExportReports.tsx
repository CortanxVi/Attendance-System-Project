import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Download, FileSpreadsheet } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import CourseAttendanceView from './CourseAttendanceView';
import { useNotification } from '../../components/notifications/notificationContext';
import { apiErrorMessage } from '../../services/apiError';
import { exportAttendanceReport, type AttendanceExportRecord, type ReportCourse, type ReportFormat } from '../../services/reportExport';

export default function ExportReports() {
  const { notify } = useNotification();
  const [courses, setCourses] = useState<ReportCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<ReportCourse | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const fetchTeacherCourses = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setCourses([]); return; }
      const response = await axios.get<{ courses?: ReportCourse[] }>(`/api/v1/courses/${session.user.id}`);
      setCourses(response.data.courses ?? []);
    } catch (error: unknown) { notify(apiErrorMessage(error, 'ไม่สามารถโหลดรายวิชาได้'), 'error'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchTeacherCourses(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchTeacherCourses]);

  const handleExport = async (course: ReportCourse, format: ReportFormat) => {
    if (exporting) return;
    const operation = `${course.id}:${format}`; setExporting(operation);
    try {
      const response = await axios.get<{ records?: AttendanceExportRecord[] }>(`/api/v1/teacher/export/attendance/${course.id}`);
      const records = response.data.records ?? [];
      if (!records.length) { notify('ไม่มีข้อมูลการเช็คชื่อสำหรับวิชานี้', 'info'); return; }
      await exportAttendanceReport(records, course.course_code, format, '#ea580c');
      notify(`สร้างไฟล์ ${format.toUpperCase()} สำเร็จ`, 'success');
    } catch (error: unknown) { notify(`Export ล้มเหลว: ${apiErrorMessage(error, 'ไม่สามารถสร้างรายงานได้')}`, 'error'); }
    finally { setExporting(null); }
  };

  return <div className="mx-auto w-full max-w-6xl"><div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
    <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-gray-800 sm:text-2xl"><FileSpreadsheet className="shrink-0 text-orange-500" />ส่งออกรายงานการเช็คชื่อ</h2>
    {loading ? <div className="flex flex-col items-center py-10 text-center text-gray-500"><div className="mb-4 size-8 animate-spin rounded-full border-b-2 border-orange-500" />กำลังโหลดรายวิชาของคุณ...</div> : <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => <article key={course.id} className="rounded-xl border border-gray-200 p-5 transition-shadow hover:shadow-md">
        <span className="mb-2 inline-block rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">{course.course_code}</span>
        <button type="button" onClick={() => setSelectedCourse(course)} className="block cursor-pointer text-left transition-colors hover:text-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-300"><span className="text-lg font-bold text-gray-900 underline decoration-gray-300 underline-offset-4">{course.course_name}</span></button>
        <p className="mt-1 text-sm text-gray-500">เทอม {course.semester}/{course.year} | Sec {course.section}</p>
        <div className="mt-4 border-t border-gray-100 pt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">เลือกรูปแบบไฟล์</p><div className="grid grid-cols-3 gap-2">
          {(['excel', 'csv', 'pdf'] as const).map((format) => { const busy = exporting === `${course.id}:${format}`; const tone = format === 'excel' ? 'bg-green-50 text-green-700 hover:bg-green-100' : format === 'csv' ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'; return <button key={format} type="button" disabled={Boolean(exporting)} onClick={() => void handleExport(course, format)} className={`flex min-h-10 cursor-pointer items-center justify-center gap-1 rounded-lg text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}><Download size={14} />{busy ? 'กำลังสร้าง…' : format === 'excel' ? 'Excel' : format.toUpperCase()}</button>; })}
        </div></div>
      </article>)}
      {!courses.length && <div className="col-span-full py-8 text-center text-gray-500">คุณยังไม่ได้เปิดรายวิชาใดๆ ในระบบ</div>}
    </div>}
  </div>
  {selectedCourse && <CourseAttendanceView courseId={selectedCourse.id} courseCode={selectedCourse.course_code} courseName={selectedCourse.course_name} onClose={() => setSelectedCourse(null)} />}
  </div>;
}
