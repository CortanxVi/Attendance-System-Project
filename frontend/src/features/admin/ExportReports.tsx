import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Download, FileSpreadsheet, LayoutList, Search, Table2, UserRound, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useNotification } from '../../components/notifications/notificationContext';
import { apiErrorMessage } from '../../services/apiError';
import { exportAttendanceReport, type AttendanceExportPayload, type ReportCourse, type ReportFormat } from '../../services/reportExport';

export default function ExportReports() {
  const { notify } = useNotification();
  const [courses, setCourses] = useState<ReportCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list');
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';

  const fetchCourses = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get<{ courses?: ReportCourse[] }>('/api/v1/admin/courses');
      setCourses(response.data.courses ?? []);
    } catch (error: unknown) { notify(apiErrorMessage(error, 'ไม่สามารถโหลดรายวิชาได้'), 'error'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchCourses(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchCourses]);

  const handleExport = async (course: ReportCourse, format: ReportFormat) => {
    if (exporting) return;
    const operation = `${course.id}:${format}`; setExporting(operation);
    try {
      const response = await axios.get<AttendanceExportPayload & { status: string }>(`/api/v1/admin/export/attendance/${course.id}`);
      if (!(response.data.students?.length || response.data.records?.length)) { notify('ไม่มีรายชื่อนักศึกษาสำหรับวิชานี้', 'info'); return; }
      await exportAttendanceReport(response.data, format);
      notify(`สร้างไฟล์ ${format.toUpperCase()} สำเร็จ`, 'success');
    } catch (error: unknown) { notify(`Export ล้มเหลว: ${apiErrorMessage(error, 'ไม่สามารถสร้างรายงานได้')}`, 'error'); }
    finally { setExporting(null); }
  };

  const filteredCourses = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('th-TH');
    if (!normalized) return courses;
    return courses.filter((course) => [
      course.course_code,
      course.course_name,
      course.profiles?.full_name,
    ].some((value) => value?.toLocaleLowerCase('th-TH').includes(normalized)));
  }, [courses, query]);

  const updateQuery = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  return <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800 sm:text-2xl"><FileSpreadsheet className="shrink-0 text-red-500" />ออกรายงานการเช็คชื่อ</h2>
      <div role="group" aria-label="รูปแบบการแสดงรายวิชา" className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1">
        <ViewButton active={viewMode === 'list'} onClick={() => setViewMode('list')} icon={<LayoutList size={17} />} label="รายการ" />
        <ViewButton active={viewMode === 'table'} onClick={() => setViewMode('table')} icon={<Table2 size={17} />} label="ตาราง" />
      </div>
    </div>
    <div className="mb-5 flex flex-col gap-2">
      <div className="relative w-full max-w-2xl">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={19} />
        <label htmlFor="admin-export-search" className="sr-only">ค้นหารายวิชาสำหรับออกรายงาน</label>
        <input id="admin-export-search" type="search" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="ค้นหารหัสวิชา ชื่อวิชา หรือชื่ออาจารย์ผู้สอน" className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-11 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200" />
        {query && <button type="button" onClick={() => updateQuery('')} aria-label="ล้างคำค้นหารายวิชา" className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-red-300"><X size={17} /></button>}
      </div>
      {!loading && <p aria-live="polite" className="text-xs text-slate-500">พบ {filteredCourses.length} จาก {courses.length} รายวิชา</p>}
    </div>
    {loading ? <div className="py-10 text-center text-gray-500">กำลังโหลดรายวิชา...</div> : viewMode === 'list' ? <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {filteredCourses.map((course) => <ReportCard key={course.id} course={course} exporting={exporting} onExport={handleExport} />)}
      {!filteredCourses.length && <div className="col-span-full py-8 text-center text-gray-500">{courses.length ? 'ไม่พบรายวิชาที่ตรงกับคำค้นหา' : 'ไม่มีข้อมูลรายวิชาในระบบ'}</div>}
    </div> : <ReportTable courses={filteredCourses} exporting={exporting} onExport={handleExport} emptyLabel={courses.length ? 'ไม่พบรายวิชาที่ตรงกับคำค้นหา' : 'ไม่มีข้อมูลรายวิชาในระบบ'} />}
  </div>;
}

function ViewButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-300 ${active ? 'bg-white text-red-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{icon}{label}</button>;
}

function ExportActions({ course, exporting, onExport }: { course: ReportCourse; exporting: string | null; onExport: (course: ReportCourse, format: ReportFormat) => Promise<void> }) {
  return <div className="grid min-w-56 grid-cols-3 gap-2">
    {(['excel', 'csv', 'pdf'] as const).map((format) => { const busy = exporting === `${course.id}:${format}`; const tone = format === 'excel' ? 'bg-green-50 text-green-700 hover:bg-green-100' : format === 'csv' ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-red-50 text-red-700 hover:bg-red-100'; return <button key={format} type="button" disabled={Boolean(exporting)} onClick={() => void onExport(course, format)} className={`flex min-h-10 cursor-pointer items-center justify-center gap-1 rounded-lg px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}><Download size={14} />{busy ? 'กำลังสร้าง…' : format === 'excel' ? 'Excel' : format.toUpperCase()}</button>; })}
  </div>;
}

function ReportCard({ course, exporting, onExport }: { course: ReportCourse; exporting: string | null; onExport: (course: ReportCourse, format: ReportFormat) => Promise<void> }) {
  return <article className="rounded-xl border border-gray-200 p-5 transition-shadow hover:shadow-md">
    <span className="mb-2 inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">{course.course_code}</span>
    <h3 className="text-lg font-bold text-gray-900">{course.course_name}</h3><p className="text-sm text-gray-500">เทอม {course.semester}/{course.year} | Sec {course.section}</p>
    <p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><UserRound size={16} className="text-slate-400" />ผู้สอน: {course.profiles?.full_name || 'ไม่ระบุ'}</p>
    <div className="mt-4 border-t border-gray-100 pt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">เลือกรูปแบบไฟล์</p><ExportActions course={course} exporting={exporting} onExport={onExport} /></div>
  </article>;
}

function ReportTable({ courses, exporting, onExport, emptyLabel }: { courses: ReportCourse[]; exporting: string | null; onExport: (course: ReportCourse, format: ReportFormat) => Promise<void>; emptyLabel: string }) {
  if (!courses.length) return <div className="py-8 text-center text-gray-500">{emptyLabel}</div>;
  return <div className="overflow-x-auto rounded-xl border border-slate-200">
    <table className="w-full min-w-[860px] text-left text-sm">
      <thead className="bg-slate-50 text-slate-600"><tr><th className="px-4 py-3">รหัสวิชา</th><th className="px-4 py-3">ชื่อวิชา</th><th className="px-4 py-3">ผู้สอน</th><th className="px-4 py-3">เทอม/ปี · Sec</th><th className="px-4 py-3">ดาวน์โหลด</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{courses.map((course) => <tr key={course.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono font-bold text-red-700">{course.course_code}</td><td className="px-4 py-3 font-semibold text-slate-900">{course.course_name}</td><td className="px-4 py-3 text-slate-600">{course.profiles?.full_name || 'ไม่ระบุ'}</td><td className="px-4 py-3 text-slate-600">{course.semester}/{course.year} · {course.section}</td><td className="px-4 py-3"><ExportActions course={course} exporting={exporting} onExport={onExport} /></td></tr>)}</tbody>
    </table>
  </div>;
}
