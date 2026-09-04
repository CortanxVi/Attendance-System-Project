import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  AlertCircle, CheckCircle2, Edit3, FileSpreadsheet, LoaderCircle,
  Plus, Search, ShieldCheck, Trash2, UploadCloud, X,
} from 'lucide-react';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { useNotification } from '../../components/notifications/notificationContext';

interface Course { id: string; course_code: string; course_name: string }
interface RosterStudent { id: string; email: string; student_id: string; full_name: string; academic_year?: number | null; class_level?: string | null; roster_kind: 'active' | 'pending' }
interface StudentForm { email: string; student_id: string; full_name: string; academic_year: string; class_level: string }
interface ImportRow {
  source_row: number; student_id: string; display_student_id: string; full_name: string;
  email: string; academic_year: number | null; class_level: string | null;
  errors: string[]; action: 'enroll' | 'create_invite' | 'link_invite' | 'unchanged' | 'invalid';
}
interface ImportPreview {
  ready: boolean;
  file: { name: string; type: 'xlsx' | 'csv'; sha256: string; sheet_name?: string | null; encoding?: string | null; header_row: number };
  detected: { course_code?: string | null; course_name?: string | null; academic_year?: number | null };
  summary: { enroll: number; create_invite: number; link_invite: number; unchanged: number; invalid: number };
  warnings: string[]; blocking_errors: string[]; rows: ImportRow[];
}

const EMPTY_FORM: StudentForm = { email: '', student_id: '', full_name: '', academic_year: '', class_level: '' };
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PREVIEW_PAGE_SIZE = 25;

function detail(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
    ? error.response.data.detail : fallback;
}

function actionLabel(action: ImportRow['action']) {
  if (action === 'enroll') return 'เพิ่มบัญชีที่สมัครแล้ว';
  if (action === 'create_invite') return 'สร้างคำเชิญใหม่';
  if (action === 'link_invite') return 'ผูกคำเชิญเดิม';
  if (action === 'unchanged') return 'มีอยู่แล้ว';
  return 'ต้องแก้ไข';
}

function actionTone(action: ImportRow['action']) {
  if (action === 'invalid') return 'bg-red-100 text-red-700';
  if (action === 'unchanged') return 'bg-slate-100 text-slate-600';
  if (action === 'enroll') return 'bg-emerald-100 text-emerald-800';
  return 'bg-blue-100 text-blue-800';
}

interface ImportStudentsProps { fixedCourseId?: string; embedded?: boolean }

export default function ImportStudents({ fixedCourseId, embedded = false }: ImportStudentsProps) {
  const { notify } = useNotification();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState(fixedCourseId ?? '');
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
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);

  useEffect(() => {
    if (fixedCourseId) return;
    const loadCourses = async () => {
      try {
        const profile = await axios.get('/api/v1/auth/me');
        const response = await axios.get(`/api/v1/courses/${profile.data.user.id}`);
        const next = response.data.courses || [];
        setCourses(next);
        if (next.length) setCourseId(next[0].id);
      } catch {
        setImportMessage({ type: 'error', text: 'ไม่สามารถโหลดรายวิชาของคุณได้' });
      }
    };
    void loadCourses();
  }, [fixedCourseId]);

  const loadRoster = useCallback(async () => {
    if (!courseId) { setStudents([]); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await axios.get(`/api/v1/teacher/courses/${courseId}/roster`, {
        params: { page, page_size: 25, search: query },
      });
      setStudents(response.data.students ?? []);
      setTotal(response.data.total ?? 0);
    } catch (error) {
      notify(detail(error, 'ไม่สามารถโหลดรายชื่อนักศึกษาได้'), 'error');
    } finally { setLoading(false); }
  }, [courseId, page, query, notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRoster(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRoster]);

  const resetImport = () => {
    setFile(null); setPreview(null); setPreviewPage(1); setImportMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectFile = (selected: File | null) => {
    if (!selected) return;
    const suffix = selected.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'csv'].includes(suffix ?? '')) {
      resetImport(); setImportMessage({ type: 'error', text: 'รองรับเฉพาะไฟล์ .xlsx และ .csv' }); return;
    }
    if (selected.size === 0 || selected.size > MAX_FILE_BYTES) {
      resetImport(); setImportMessage({ type: 'error', text: 'ไฟล์ต้องมีข้อมูลและมีขนาดไม่เกิน 5 MB' }); return;
    }
    setFile(selected); setPreview(null); setPreviewPage(1); setImportMessage(null);
  };

  const previewFile = async () => {
    if (!file || !courseId) return;
    setBusy(true); setImportMessage(null);
    const data = new FormData(); data.append('file', file);
    try {
      const response = await axios.post(`/api/v1/teacher/courses/${courseId}/roster/import/preview`, data);
      setPreview(response.data); setPreviewPage(1);
    } catch (error) {
      setPreview(null); setImportMessage({ type: 'error', text: detail(error, 'ตรวจไฟล์รายชื่อไม่สำเร็จ') });
    } finally { setBusy(false); }
  };

  const commitImport = async () => {
    if (!file || !preview?.ready) return;
    setBusy(true);
    const data = new FormData(); data.append('file', file); data.append('expected_sha256', preview.file.sha256);
    try {
      const response = await axios.post(`/api/v1/teacher/courses/${courseId}/roster/import/commit`, data);
      notify(response.data.message || 'นำเข้ารายชื่อสำเร็จ', 'success');
      setImportConfirmOpen(false); resetImport(); setPage(1); await loadRoster();
    } catch (error) {
      setImportConfirmOpen(false);
      setImportMessage({ type: 'error', text: detail(error, 'นำเข้ารายชื่อไม่สำเร็จ') });
    } finally { setBusy(false); }
  };

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setFormOpen(true); };
  const openEdit = (student: RosterStudent) => {
    setEditing(student);
    setForm({ email: student.email, student_id: student.student_id, full_name: student.full_name, academic_year: student.academic_year?.toString() ?? '', class_level: student.class_level ?? '' });
    setFormError(''); setFormOpen(true);
  };

  const saveStudent = async (event: React.FormEvent) => {
    event.preventDefault(); setFormError('');
    if (!form.full_name.trim() || (!editing && (!/^\d{13}$/.test(form.student_id) || !/^[^@]+@email\.kmutnb\.ac\.th$/i.test(form.email)))) {
      setFormError('กรุณากรอกชื่อ อีเมลนักศึกษา และรหัสนักศึกษา 13 หลักให้ถูกต้อง'); return;
    }
    const payload = { full_name: form.full_name.trim(), academic_year: form.academic_year ? Number(form.academic_year) : null, class_level: form.class_level.trim() || null };
    setBusy(true);
    try {
      if (editing) await axios.put(`/api/v1/teacher/courses/${courseId}/roster/${editing.roster_kind}/${editing.id}`, payload);
      else await axios.post(`/api/v1/teacher/courses/${courseId}/roster`, { ...payload, email: form.email.trim().toLowerCase(), student_id: form.student_id });
      notify(editing ? 'แก้ไขข้อมูลนักศึกษาแล้ว' : 'เพิ่มนักศึกษาในรายวิชาแล้ว', 'success');
      setFormOpen(false); await loadRoster();
    } catch (error) { setFormError(detail(error, 'บันทึกข้อมูลไม่สำเร็จ')); }
    finally { setBusy(false); }
  };

  const removeStudent = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await axios.delete(`/api/v1/teacher/courses/${courseId}/roster/${pendingDelete.roster_kind}/${pendingDelete.id}`);
      notify('นำรายชื่อออกจากรายวิชาแล้ว', 'success'); setPendingDelete(null); await loadRoster();
    } catch (error) { notify(detail(error, 'นำรายชื่อออกไม่สำเร็จ'), 'error'); }
    finally { setBusy(false); }
  };

  const pages = Math.max(1, Math.ceil(total / 25));
  const previewPages = Math.max(1, Math.ceil((preview?.rows.length ?? 0) / PREVIEW_PAGE_SIZE));
  const visiblePreviewRows = useMemo(() => {
    const start = (previewPage - 1) * PREVIEW_PAGE_SIZE;
    return preview?.rows.slice(start, start + PREVIEW_PAGE_SIZE) ?? [];
  }, [preview, previewPage]);
  const changeCount = preview ? preview.summary.enroll + preview.summary.create_invite + preview.summary.link_invite : 0;

  return <div className={`${embedded ? '' : 'mx-auto max-w-6xl'} space-y-6`}>
    {!embedded && <header><h2 className="text-2xl font-bold text-gray-900">จัดการนักศึกษาในรายวิชา</h2><p className="mt-1 text-sm text-gray-500">เพิ่ม แก้ไข ค้นหา หรือนำรายชื่อออก โดยไม่ลบบัญชีนักศึกษาออกจากระบบ</p></header>}

    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className={`grid gap-3 ${embedded ? '' : 'md:grid-cols-[1fr_auto]'}`}>
        {!embedded && <label className="text-sm font-semibold text-gray-700">รายวิชา<select value={courseId} onChange={(event) => { setCourseId(event.target.value); setPage(1); resetImport(); }} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-normal focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200">{courses.map((course) => <option key={course.id} value={course.id}>{course.course_code} — {course.course_name}</option>)}</select></label>}
        <button type="button" disabled={!courseId} onClick={openAdd} className="mt-auto flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 text-sm font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={18} />เพิ่มนักศึกษา</button>
      </div>
      <form noValidate onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }} role="search" className="mt-5 flex gap-2">
        <label htmlFor="roster-search" className="sr-only">ค้นหารายชื่อ</label>
        <div className="relative flex-1"><Search aria-hidden="true" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input id="roster-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อ รหัส หรืออีเมล" className="w-full rounded-xl border border-gray-300 py-2 pl-10 pr-11 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" />{search && <button type="button" aria-label="ล้างคำค้นหา" onClick={() => { setSearch(''); setQuery(''); setPage(1); }} className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-300"><X size={17} /></button>}</div>
        <button className="min-h-11 cursor-pointer rounded-xl border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-300">ค้นหา</button>
      </form>
    </section>

    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-gray-600"><tr><th scope="col" className="px-4 py-3">นักศึกษา</th><th scope="col" className="px-4 py-3">ชั้นปี / กลุ่ม</th><th scope="col" className="px-4 py-3">สถานะ</th><th scope="col" className="px-4 py-3 text-right">การจัดการ</th></tr></thead><tbody className="divide-y divide-gray-100">{loading ? <tr><td colSpan={4} className="p-8 text-center text-gray-500">กำลังโหลด…</td></tr> : students.length === 0 ? <tr><td colSpan={4} className="p-8 text-center text-gray-500">ยังไม่มีรายชื่อในรายวิชานี้</td></tr> : students.map((student) => <tr key={`${student.roster_kind}-${student.id}`}><td className="px-4 py-3"><p className="font-semibold text-gray-900">{student.full_name}</p><p className="text-xs text-gray-500">{student.student_id} · {student.email}</p></td><td className="px-4 py-3">{student.academic_year ? `ปี ${student.academic_year}` : '–'}{student.class_level ? ` / ${student.class_level}` : ''}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${student.roster_kind === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{student.roster_kind === 'active' ? 'สมัครแล้ว' : 'รอเข้าสู่ระบบ'}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-2">{student.roster_kind === 'pending' && <button type="button" onClick={() => openEdit(student)} aria-label={`แก้ไข ${student.full_name}`} className="cursor-pointer rounded-lg p-2 text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-300"><Edit3 size={17} /></button>}<button type="button" onClick={() => setPendingDelete(student)} aria-label={`นำ ${student.full_name} ออก`} className="cursor-pointer rounded-lg p-2 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300"><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></div>
      <Pager page={page} pages={pages} total={total} noun="คน" onPrevious={() => setPage((value) => value - 1)} onNext={() => setPage((value) => value + 1)} />
    </section>

    <section aria-labelledby="roster-import-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-orange-100 p-2 text-orange-700"><UploadCloud aria-hidden="true" /></span><div><h3 id="roster-import-title" className="text-lg font-bold text-slate-900">นำเข้ารายชื่อจาก Excel หรือ CSV</h3><p className="mt-1 text-sm leading-6 text-slate-600">รองรับใบรายชื่อมหาวิทยาลัยแบบตัวอย่างและตารางมาตรฐานที่มีคอลัมน์รหัสนักศึกษาและชื่อ-นามสกุล ระบบจะแสดงตัวอย่างก่อนบันทึกทุกครั้ง</p></div></div>
      {importMessage && <p role={importMessage.type === 'error' ? 'alert' : 'status'} className={`mt-4 flex gap-2 rounded-xl p-3 text-sm ${importMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{importMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}{importMessage.text}</p>}
      <label onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); selectFile(event.dataTransfer.files[0] ?? null); }} className={`mt-5 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-6 text-center transition-colors focus-within:ring-2 focus-within:ring-orange-300 ${dragOver ? 'border-orange-500 bg-orange-50' : 'border-slate-300 bg-slate-50 hover:border-orange-400 hover:bg-orange-50/50'}`}>
        <input ref={fileInputRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
        <FileSpreadsheet aria-hidden="true" size={34} className="text-slate-500" /><span className="mt-3 font-bold text-slate-800">ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์</span><span className="mt-1 text-xs text-slate-500">.xlsx หรือ .csv · ไม่เกิน 5 MB · สูงสุด 1,000 รายชื่อ</span>
      </label>
      {file && <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{file.name}</p><p className="mt-1 text-xs text-slate-500">{(file.size / 1024).toLocaleString('th-TH', { maximumFractionDigits: 1 })} KB</p></div><button type="button" disabled={busy} onClick={resetImport} className="min-h-10 cursor-pointer rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">นำไฟล์ออก</button><button type="button" disabled={busy || !courseId} onClick={() => void previewFile()} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-bold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />}{busy ? 'กำลังตรวจไฟล์…' : 'ตรวจไฟล์และแสดงตัวอย่าง'}</button></div>}
      {preview && <ImportPreviewPanel preview={preview} page={previewPage} pages={previewPages} visibleRows={visiblePreviewRows} changeCount={changeCount} busy={busy} onPrevious={() => setPreviewPage((value) => value - 1)} onNext={() => setPreviewPage((value) => value + 1)} onConfirm={() => setImportConfirmOpen(true)} />}
    </section>

    {formOpen && <StudentFormDialog editing={editing} form={form} error={formError} busy={busy} onChange={setForm} onClose={() => setFormOpen(false)} onSubmit={saveStudent} />}
    <ConfirmDialog open={Boolean(pendingDelete)} title="นำรายชื่อออกจากรายวิชาหรือไม่" description={`ระบบจะนำ “${pendingDelete?.full_name || ''}” ออกจากรายวิชานี้เท่านั้น บัญชีและข้อมูลในรายวิชาอื่นจะไม่ถูกลบ`} confirmLabel="นำออกจากรายวิชา" danger busy={busy} onConfirm={removeStudent} onCancel={() => setPendingDelete(null)} />
    <ConfirmDialog open={importConfirmOpen} title="ยืนยันนำเข้ารายชื่อ" description={`ระบบจะเพิ่มหรือผูกสมาชิก ${changeCount} รายการจากไฟล์ ${preview?.file.name ?? ''} และข้าม ${preview?.summary.unchanged ?? 0} รายการที่มีอยู่แล้ว`} confirmLabel="นำเข้ารายชื่อ" busy={busy} onConfirm={() => void commitImport()} onCancel={() => setImportConfirmOpen(false)} />
  </div>;
}

function ImportPreviewPanel({ preview, page, pages, visibleRows, changeCount, busy, onPrevious, onNext, onConfirm }: { preview: ImportPreview; page: number; pages: number; visibleRows: ImportRow[]; changeCount: number; busy: boolean; onPrevious: () => void; onNext: () => void; onConfirm: () => void }) {
  return <div className="mt-5 space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Summary label="เพิ่มสมาชิก" value={preview.summary.enroll} tone="emerald" /><Summary label="สร้างคำเชิญ" value={preview.summary.create_invite} tone="blue" /><Summary label="ผูกคำเชิญเดิม" value={preview.summary.link_invite} tone="blue" /><Summary label="มีอยู่แล้ว" value={preview.summary.unchanged} tone="slate" /><Summary label="ต้องแก้ไข" value={preview.summary.invalid} tone="red" /></div>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"><p className="font-bold">ข้อมูลที่ตรวจพบ</p><p className="mt-1">{preview.detected.course_code ? `${preview.detected.course_code} ${preview.detected.course_name ?? ''}` : 'ไม่พบรหัสวิชาในไฟล์'}{preview.detected.academic_year ? ` · ปีการศึกษา ${preview.detected.academic_year}` : ''}{preview.file.sheet_name ? ` · ชีต ${preview.file.sheet_name}` : ''}</p></div>
    {preview.warnings.map((warning) => <p key={warning} role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{warning}</p>)}
    {preview.blocking_errors.map((error) => <p key={error} role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>)}
    <div className="overflow-hidden rounded-xl border border-slate-200"><div className="overflow-x-auto"><table aria-label="ตัวอย่างรายชื่อที่จะนำเข้า" className="w-full text-left text-sm"><thead className="bg-slate-100 text-xs font-bold text-slate-600"><tr><th scope="col" className="px-3 py-3">แถว</th><th scope="col" className="px-3 py-3">รหัส / ชื่อ</th><th scope="col" className="px-3 py-3">ชั้นปี / กลุ่ม</th><th scope="col" className="px-3 py-3">ผลตรวจ</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{visibleRows.map((row) => <tr key={`${row.source_row}-${row.student_id}`}><td className="px-3 py-3 font-mono text-xs text-slate-500">{row.source_row}</td><td className="px-3 py-3"><p className="font-semibold text-slate-900">{row.full_name || '—'}</p><p className="mt-0.5 text-xs text-slate-500">{row.display_student_id || 'ไม่พบรหัส'}</p></td><td className="px-3 py-3 text-slate-600">{row.academic_year ? `ปี ${row.academic_year}` : 'ไม่ระบุ'}{row.class_level ? ` · ${row.class_level}` : ''}</td><td className="px-3 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${actionTone(row.action)}`}>{actionLabel(row.action)}</span>{row.errors.map((error) => <p key={error} className="mt-1 text-xs text-red-700">{error}</p>)}</td></tr>)}</tbody></table></div><Pager page={page} pages={pages} total={preview.rows.length} noun="แถว" onPrevious={onPrevious} onNext={onNext} /></div>
    <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center"><div><p className={`font-bold ${preview.ready ? 'text-emerald-800' : 'text-red-700'}`}>{preview.ready ? 'ไฟล์พร้อมนำเข้า' : 'ยังไม่สามารถนำเข้าไฟล์นี้ได้'}</p><p className="mt-1 text-xs text-slate-500">ระบบจะตรวจไฟล์เดิมซ้ำและบันทึกทั้งชุดแบบ transaction เดียว</p></div><button type="button" disabled={!preview.ready || busy || changeCount === 0} onClick={onConfirm} className="min-h-11 cursor-pointer rounded-xl bg-orange-600 px-5 text-sm font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-50">ยืนยันนำเข้า {changeCount} รายการ</button></div>
  </div>;
}

function Pager({ page, pages, total, noun, onPrevious, onNext }: { page: number; pages: number; total: number; noun: string; onPrevious: () => void; onNext: () => void }) {
  return <nav aria-label="เปลี่ยนหน้ารายการ" className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-3 text-sm"><span>ทั้งหมด {total} {noun}</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={onPrevious} className="min-h-10 cursor-pointer rounded-lg border px-3 disabled:cursor-not-allowed disabled:opacity-40">ก่อนหน้า</button><span aria-current="page">{page}/{pages}</span><button type="button" disabled={page >= pages} onClick={onNext} className="min-h-10 cursor-pointer rounded-lg border px-3 disabled:cursor-not-allowed disabled:opacity-40">ถัดไป</button></div></nav>;
}

function Summary({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'blue' | 'slate' | 'red' }) {
  const colors = tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : tone === 'blue' ? 'border-blue-200 bg-blue-50 text-blue-800' : tone === 'red' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700';
  return <div className={`rounded-xl border p-3 ${colors}`}><p className="text-xs font-semibold">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{value}</p></div>;
}

function StudentFormDialog({ editing, form, error, busy, onChange, onClose, onSubmit }: { editing: RosterStudent | null; form: StudentForm; error: string; busy: boolean; onChange: (form: StudentForm) => void; onClose: () => void; onSubmit: (event: React.FormEvent) => void }) {
  return <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 'var(--z-backdrop)' }}><button type="button" aria-label="ปิดแบบฟอร์ม" onClick={() => !busy && onClose()} className="absolute inset-0 cursor-pointer bg-slate-950/60" /><form noValidate onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="student-form-title" className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" style={{ zIndex: 'var(--z-dialog)' }}><div className="flex items-center justify-between"><h3 id="student-form-title" className="text-xl font-bold text-gray-900">{editing ? 'แก้ไขข้อมูลนักศึกษา' : 'เพิ่มนักศึกษา'}</h3><button type="button" onClick={onClose} aria-label="ปิด" className="cursor-pointer rounded-lg p-1 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-300"><X /></button></div>{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="ชื่อ-นามสกุล" value={form.full_name} onChange={(value) => onChange({ ...form, full_name: value })} /><Field label="รหัสนักศึกษา 13 หลัก" value={form.student_id} disabled={Boolean(editing)} onChange={(value) => onChange({ ...form, student_id: value.replace(/\D/g, '').slice(0, 13) })} /><Field label="อีเมลนักศึกษา" value={form.email} disabled={Boolean(editing)} onChange={(value) => onChange({ ...form, email: value })} /><label className="text-sm font-semibold text-gray-700">ชั้นปี<select value={form.academic_year} onChange={(event) => onChange({ ...form, academic_year: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 font-normal"><option value="">ไม่ระบุ</option>{[1,2,3,4,5,6,7,8].map((year) => <option key={year} value={year}>{year}</option>)}</select></label><Field label="ห้องเรียน / กลุ่ม" value={form.class_level} onChange={(value) => onChange({ ...form, class_level: value.slice(0, 50) })} /></div><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 cursor-pointer rounded-xl border border-gray-300 px-4 text-sm font-semibold disabled:cursor-not-allowed">ยกเลิก</button><button type="submit" disabled={busy} className="min-h-11 cursor-pointer rounded-xl bg-orange-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button></div></form></div>;
}

function Field({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="text-sm font-semibold text-gray-700">{label}<input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 font-normal disabled:bg-gray-100" /></label>;
}
