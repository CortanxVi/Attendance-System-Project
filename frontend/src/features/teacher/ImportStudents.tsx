import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { AlertCircle, CheckCircle, Edit3, FileText, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { useNotification } from '../../components/notifications/NotificationProvider';

interface Course { id: string; course_code: string; course_name: string }
interface RosterStudent { id: string; email: string; student_id: string; full_name: string; academic_year?: number | null; class_level?: string | null; roster_kind: 'active' | 'pending' }
interface StudentForm { email: string; student_id: string; full_name: string; academic_year: string; class_level: string }
const EMPTY_FORM: StudentForm = { email: '', student_id: '', full_name: '', academic_year: '', class_level: '' };

function detail(error: unknown, fallback: string) { return axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string' ? error.response.data.detail : fallback; }

export default function ImportStudents() {
  const { notify } = useNotification();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RosterStudent | null>(null);
  const [form, setForm] = useState<StudentForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<RosterStudent | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [csvMessage, setCsvMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const loadCourses = async () => {
      try {
        const profile = await axios.get('/api/v1/auth/me');
        const response = await axios.get(`/api/v1/courses/${profile.data.user.id}`);
        const next = response.data.courses || []; setCourses(next); if (next.length) setCourseId(next[0].id);
      } catch { setCsvMessage({ type: 'error', text: 'ไม่สามารถโหลดรายวิชาของคุณได้' }); }
    };
    void loadCourses();
  }, []);

  const loadRoster = useCallback(async () => {
    if (!courseId) { setStudents([]); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await axios.get(`/api/v1/teacher/courses/${courseId}/roster`, { params: { page, page_size: 25, search: query } });
      setStudents(response.data.students ?? []); setTotal(response.data.total ?? 0);
    } catch (error) { notify(detail(error, 'ไม่สามารถโหลดรายชื่อนักศึกษาได้'), 'error'); }
    finally { setLoading(false); }
  }, [courseId, page, query, notify]);
  useEffect(() => { void loadRoster(); }, [loadRoster]);

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setFormOpen(true); };
  const openEdit = (student: RosterStudent) => { setEditing(student); setForm({ email: student.email, student_id: student.student_id, full_name: student.full_name, academic_year: student.academic_year?.toString() ?? '', class_level: student.class_level ?? '' }); setFormError(''); setFormOpen(true); };

  const saveStudent = async (event: React.FormEvent) => {
    event.preventDefault(); setFormError('');
    if (!form.full_name.trim() || (!editing && (!/^\d{13}$/.test(form.student_id) || !/^[^@]+@email\.kmutnb\.ac\.th$/i.test(form.email)))) { setFormError('กรุณากรอกชื่อ อีเมลนักศึกษา และรหัสนักศึกษา 13 หลักให้ถูกต้อง'); return; }
    const payload = { full_name: form.full_name.trim(), academic_year: form.academic_year ? Number(form.academic_year) : null, class_level: form.class_level.trim() || null };
    setBusy(true);
    try {
      if (editing) await axios.put(`/api/v1/teacher/courses/${courseId}/roster/${editing.roster_kind}/${editing.id}`, payload);
      else await axios.post(`/api/v1/teacher/courses/${courseId}/roster`, { ...payload, email: form.email.trim().toLowerCase(), student_id: form.student_id });
      notify(editing ? 'แก้ไขข้อมูลนักศึกษาแล้ว' : 'เพิ่มนักศึกษาในรายวิชาแล้ว', 'success'); setFormOpen(false); await loadRoster();
    } catch (error) { setFormError(detail(error, 'บันทึกข้อมูลไม่สำเร็จ')); } finally { setBusy(false); }
  };

  const removeStudent = async () => {
    if (!pendingDelete) return; setBusy(true);
    try { await axios.delete(`/api/v1/teacher/courses/${courseId}/roster/${pendingDelete.roster_kind}/${pendingDelete.id}`); notify('นำรายชื่อออกจากรายวิชาแล้ว', 'success'); setPendingDelete(null); await loadRoster(); }
    catch (error) { notify(detail(error, 'นำรายชื่อออกไม่สำเร็จ'), 'error'); } finally { setBusy(false); }
  };

  const uploadCsv = async () => {
    if (!file || !courseId) return; setBusy(true); setCsvMessage(null);
    const data = new FormData(); data.append('file', file); data.append('course_id', courseId);
    try { const response = await axios.post('/api/v1/teacher/import/students', data); setCsvMessage({ type: 'success', text: response.data.message }); setFile(null); await loadRoster(); }
    catch (error) { setCsvMessage({ type: 'error', text: detail(error, 'นำเข้าไฟล์ไม่สำเร็จ') }); } finally { setBusy(false); }
  };

  const pages = Math.max(1, Math.ceil(total / 25));
  return <div className="mx-auto max-w-6xl space-y-6">
    <header><h2 className="text-2xl font-bold text-gray-900">จัดการนักศึกษาในรายวิชา</h2><p className="mt-1 text-sm text-gray-500">เพิ่ม แก้ไข ค้นหา หรือนำรายชื่อออก โดยไม่ลบบัญชีนักศึกษาออกจากระบบ</p></header>
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="text-sm font-semibold text-gray-700">รายวิชา<select value={courseId} onChange={(event) => { setCourseId(event.target.value); setPage(1); }} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-normal focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200">{courses.map((course) => <option key={course.id} value={course.id}>{course.course_code} — {course.course_name}</option>)}</select></label>
        <button type="button" disabled={!courseId} onClick={openAdd} className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50"><Plus size={18} />เพิ่มนักศึกษา</button>
      </div>
      <form noValidate onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }} role="search" className="mt-5 flex gap-2"><label htmlFor="roster-search" className="sr-only">ค้นหารายชื่อ</label><div className="relative flex-1"><Search aria-hidden="true" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input id="roster-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อ รหัส หรืออีเมล" className="w-full rounded-xl border border-gray-300 py-2 pl-10 pr-3 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" /></div><button className="rounded-xl border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50">ค้นหา</button></form>
    </section>

    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-gray-600"><tr><th className="px-4 py-3">นักศึกษา</th><th className="px-4 py-3">ชั้นปี / ห้อง</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3 text-right">การจัดการ</th></tr></thead><tbody className="divide-y divide-gray-100">{loading ? <tr><td colSpan={4} className="p-8 text-center text-gray-500">กำลังโหลด…</td></tr> : students.length === 0 ? <tr><td colSpan={4} className="p-8 text-center text-gray-500">ยังไม่มีรายชื่อในรายวิชานี้</td></tr> : students.map((student) => <tr key={`${student.roster_kind}-${student.id}`}><td className="px-4 py-3"><p className="font-semibold text-gray-900">{student.full_name}</p><p className="text-xs text-gray-500">{student.student_id} · {student.email}</p></td><td className="px-4 py-3">{student.academic_year ? `ปี ${student.academic_year}` : '–'}{student.class_level ? ` / ${student.class_level}` : ''}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${student.roster_kind === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{student.roster_kind === 'active' ? 'สมัครแล้ว' : 'รอเข้าสู่ระบบ'}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-2">{student.roster_kind === 'pending' && <button type="button" onClick={() => openEdit(student)} aria-label={`แก้ไข ${student.full_name}`} className="rounded-lg p-2 text-blue-700 hover:bg-blue-50"><Edit3 size={17} /></button>}<button type="button" onClick={() => setPendingDelete(student)} aria-label={`นำ ${student.full_name} ออก`} className="rounded-lg p-2 text-red-700 hover:bg-red-50"><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm"><span>ทั้งหมด {total} คน</span><div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">ก่อนหน้า</button><span>{page}/{pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">ถัดไป</button></div></div></section>

    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><h3 className="flex items-center gap-2 text-lg font-bold text-gray-900"><UploadCloud className="text-orange-600" />นำเข้าหลายคนด้วย CSV</h3><p className="mt-1 text-sm text-gray-500">คอลัมน์บังคับ: email, student_id, full_name · คอลัมน์เสริม: academic_year, class_level · UTF-8 ไม่เกิน 2 MB</p>{csvMessage && <p role={csvMessage.type === 'error' ? 'alert' : 'status'} className={`mt-4 flex gap-2 rounded-xl p-3 text-sm ${csvMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{csvMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}{csvMessage.text}</p>}<div className="mt-4 flex flex-col gap-3 sm:flex-row"><label className="flex flex-1 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-gray-300 p-4 hover:bg-gray-50"><FileText className="text-gray-400" /><span className="text-sm text-gray-600">{file?.name || 'เลือกไฟล์ .csv'}</span><input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const selected = event.target.files?.[0] ?? null; if (selected && selected.size <= 2 * 1024 * 1024) { setFile(selected); setCsvMessage(null); } else { setFile(null); setCsvMessage({ type: 'error', text: 'ไฟล์ต้องไม่เกิน 2 MB' }); } }} /></label><button type="button" disabled={!file || busy} onClick={uploadCsv} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'กำลังนำเข้า…' : 'นำเข้าไฟล์'}</button></div></section>

    {formOpen && <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 'var(--z-backdrop)' }}><button type="button" aria-label="ปิดแบบฟอร์ม" onClick={() => !busy && setFormOpen(false)} className="absolute inset-0 bg-slate-950/60" /><form noValidate onSubmit={saveStudent} role="dialog" aria-modal="true" aria-labelledby="student-form-title" className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" style={{ zIndex: 'var(--z-dialog)' }}><div className="flex items-center justify-between"><h3 id="student-form-title" className="text-xl font-bold text-gray-900">{editing ? 'แก้ไขข้อมูลนักศึกษา' : 'เพิ่มนักศึกษา'}</h3><button type="button" onClick={() => setFormOpen(false)} aria-label="ปิด"><X /></button></div>{formError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{formError}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="ชื่อ-นามสกุล" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} /><Field label="รหัสนักศึกษา 13 หลัก" value={form.student_id} disabled={Boolean(editing)} onChange={(value) => setForm({ ...form, student_id: value.replace(/\D/g, '').slice(0, 13) })} /><Field label="อีเมลนักศึกษา" value={form.email} disabled={Boolean(editing)} onChange={(value) => setForm({ ...form, email: value })} /><label className="text-sm font-semibold text-gray-700">ชั้นปี<select value={form.academic_year} onChange={(event) => setForm({ ...form, academic_year: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 font-normal"><option value="">ไม่ระบุ</option>{[1,2,3,4,5,6,7,8].map((year) => <option key={year} value={year}>{year}</option>)}</select></label><Field label="ห้องเรียน / กลุ่ม" value={form.class_level} onChange={(value) => setForm({ ...form, class_level: value.slice(0, 50) })} /></div><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setFormOpen(false)} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold">ยกเลิก</button><button type="submit" disabled={busy} className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button></div></form></div>}
    <ConfirmDialog open={Boolean(pendingDelete)} title="นำรายชื่อออกจากรายวิชาหรือไม่" description={`ระบบจะนำ “${pendingDelete?.full_name || ''}” ออกจากรายวิชานี้เท่านั้น บัญชีและข้อมูลในรายวิชาอื่นจะไม่ถูกลบ`} confirmLabel="นำออกจากรายวิชา" danger busy={busy} onConfirm={removeStudent} onCancel={() => setPendingDelete(null)} />
  </div>;
}

function Field({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) { return <label className="text-sm font-semibold text-gray-700">{label}<input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 font-normal disabled:bg-gray-100" /></label>; }
