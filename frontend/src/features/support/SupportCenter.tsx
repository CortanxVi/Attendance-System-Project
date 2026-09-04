import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  CheckCircle2,
  FileImage,
  FileText,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { useNotification } from '../../components/notifications/notificationContext';

const MAX_FILES = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

interface SupportPerson { id: string; full_name?: string | null; role: string }
interface SupportCourse { id: string; course_code: string; course_name: string; section?: number | null; teacher_id?: string | null }
interface SupportAttachment { id: string; original_name: string; content_type: string; size_bytes: number; preview_url: string }
interface SupportMessage { id: string; sender_id: string; body?: string | null; created_at: string; sender?: SupportPerson | null; attachments: SupportAttachment[] }
interface SupportRequest {
  id: string;
  subject: string;
  status: 'open' | 'resolved';
  student_id: string;
  teacher_id: string;
  last_message_at: string;
  course?: SupportCourse | null;
  student?: SupportPerson | null;
  teacher?: SupportPerson | null;
  messages?: SupportMessage[];
}

interface SupportCenterProps {
  mode: 'student' | 'teacher';
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  hideCreateButton?: boolean;
}

function apiMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
    ? error.response.data.detail
    : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function initials(name?: string | null) {
  const parts = (name || 'ผู้ใช้').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export default function SupportCenter({
  mode,
  createOpen,
  onCreateOpenChange,
  hideCreateButton = false,
}: SupportCenterProps) {
  const { notify } = useNotification();
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [courses, setCourses] = useState<SupportCourse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const resolvedCreateOpen = createOpen ?? internalCreateOpen;
  const setCreateOpen = onCreateOpenChange ?? setInternalCreateOpen;

  const loadRequests = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await axios.get('/api/v1/support/requests', { signal });
      const next = response.data.requests as SupportRequest[];
      setRequests(next);
      setSelectedId((current) => current && next.some((request) => request.id === current)
        ? current
        : next[0]?.id ?? null);
      setError('');
    } catch (requestError) {
      if (!axios.isCancel(requestError)) setError(apiMessage(requestError, 'ไม่สามารถโหลดรายการคำร้องได้'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (requestId: string, signal?: AbortSignal, quiet = false) => {
    if (!quiet) setDetailLoading(true);
    try {
      const response = await axios.get(`/api/v1/support/requests/${requestId}`, { signal });
      setDetail(response.data.request);
    } catch (requestError) {
      if (!axios.isCancel(requestError)) setError(apiMessage(requestError, 'ไม่สามารถโหลดข้อความในคำร้องได้'));
    } finally {
      if (!quiet) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void loadRequests(controller.signal), 0);
    if (mode === 'student') {
      axios.get('/api/v1/support/courses', { signal: controller.signal })
        .then((response) => setCourses(response.data.courses))
        .catch((requestError) => {
          if (!axios.isCancel(requestError)) setError(apiMessage(requestError, 'ไม่สามารถโหลดรายวิชาสำหรับยื่นคำขอได้'));
        });
    }
    const timer = window.setInterval(() => {
      void loadRequests(undefined, true);
      if (selectedId) void loadDetail(selectedId, undefined, true);
    }, 15_000);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadDetail, loadRequests, mode, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadDetail(selectedId, controller.signal), 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [loadDetail, selectedId]);

  const refresh = async () => {
    await loadRequests();
    if (selectedId) await loadDetail(selectedId);
  };

  const handleCreated = (request: SupportRequest) => {
    setCreateOpen(false);
    setSelectedId(request.id);
    setDetail(request);
    void loadRequests(undefined, true);
    notify('ส่งคำร้องให้อาจารย์ผู้รับผิดชอบแล้ว', 'success');
  };

  const handleUpdated = (request: SupportRequest) => {
    setDetail(request);
    void loadRequests(undefined, true);
  };

  return (
    <section id="student-support" aria-labelledby="support-title" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-orange-50 p-2 text-orange-700"><MessageSquareText aria-hidden="true" size={22} /></span>
          <div>
            <h2 id="support-title" className="font-bold text-slate-900">{mode === 'student' ? 'คำร้องถึงอาจารย์' : 'คำร้องจากนักศึกษา'}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {mode === 'student' ? 'ส่งข้อความ รูปภาพ หรือ PDF ให้อาจารย์เจ้าของรายวิชา' : 'ตอบกลับและตรวจไฟล์ของนักศึกษาเฉพาะรายวิชาที่คุณรับผิดชอบ'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading || detailLoading} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-50" aria-label="รีเฟรชคำร้อง"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
          {mode === 'student' && !hideCreateButton && <button type="button" onClick={() => setCreateOpen(!resolvedCreateOpen)} className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300"><Plus size={18} />คำร้องใหม่</button>}
        </div>
      </div>

      {error && <p role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {mode === 'student' && resolvedCreateOpen && (
        <CreateRequestForm courses={courses} onCancel={() => setCreateOpen(false)} onCreated={handleCreated} />
      )}

      <div className={`grid min-h-64 ${mode === 'teacher' ? 'md:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.4fr)]' : ''}`}>
        <div className={`border-b border-slate-100 p-3 ${mode === 'teacher' ? 'md:border-r md:border-b-0' : ''}`}>
          {loading ? <LoadingLabel label="กำลังโหลดคำร้อง…" /> : requests.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              <MessageSquareText className="mx-auto mb-3 text-slate-300" size={30} />
              {mode === 'student' ? 'ยังไม่มีคำร้อง เริ่มต้นได้จากปุ่มคำร้องใหม่' : 'ยังไม่มีคำร้องจากนักศึกษา'}
            </div>
          ) : (
            <ul className="space-y-2" aria-label="รายการคำร้อง">
              {requests.map((request) => {
                const active = selectedId === request.id;
                const person = mode === 'teacher' ? request.student : request.teacher;
                return <li key={request.id}><button type="button" onClick={() => setSelectedId(request.id)} aria-current={active ? 'true' : undefined} className={`w-full rounded-xl border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-orange-300 ${active ? 'border-orange-300 bg-orange-50' : 'border-transparent hover:bg-slate-50'}`}>
                  <div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-sm font-bold text-slate-900">{request.subject}</p><StatusBadge status={request.status} /></div>
                  <p className="mt-1 text-xs text-slate-600">{request.course?.course_code || 'ไม่ทราบรายวิชา'} · {person?.full_name || (mode === 'teacher' ? 'นักศึกษา' : 'อาจารย์')}</p>
                  <p className="mt-2 text-[11px] text-slate-400">อัปเดต {formatDate(request.last_message_at)}</p>
                </button></li>;
              })}
            </ul>
          )}
        </div>
        <div className="min-w-0 p-4">
          {!selectedId ? <p className="p-8 text-center text-sm text-slate-500">เลือกคำร้องเพื่ออ่านข้อความ</p> : detailLoading && !detail ? <LoadingLabel label="กำลังโหลดข้อความ…" /> : detail ? (
            <SupportThread request={detail} mode={mode} onUpdated={handleUpdated} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function LoadingLabel({ label }: { label: string }) {
  return <p className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />{label}</p>;
}

function StatusBadge({ status }: { status: SupportRequest['status'] }) {
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${status === 'resolved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{status === 'resolved' ? 'เสร็จสิ้น' : 'กำลังดำเนินการ'}</span>;
}

function CreateRequestForm({ courses, onCancel, onCreated }: { courses: SupportCourse[]; onCancel: () => void; onCreated: (request: SupportRequest) => void }) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clientToken, setClientToken] = useState(() => crypto.randomUUID());
  const attempted = useRef(false);

  const markEdited = () => {
    if (attempted.current) {
      setClientToken(crypto.randomUUID());
      attempted.current = false;
    }
  };

  const selectedCourseId = courseId || courses[0]?.id || '';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!selectedCourseId) { setError('กรุณาเลือกรายวิชา'); return; }
    if (subject.trim().length < 3) { setError('หัวข้อคำร้องต้องมีอย่างน้อย 3 ตัวอักษร'); return; }
    if (!message.trim() && files.length === 0) { setError('กรุณาพิมพ์ข้อความหรือแนบไฟล์'); return; }
    setBusy(true);
    attempted.current = true;
    const data = new FormData();
    data.set('course_id', selectedCourseId);
    data.set('subject', subject.trim());
    data.set('message', message.trim());
    data.set('client_token', clientToken);
    files.forEach((file) => data.append('attachments', file));
    try {
      const response = await axios.post('/api/v1/support/requests', data);
      setClientToken(crypto.randomUUID());
      attempted.current = false;
      onCreated(response.data.request);
    } catch (requestError) {
      setError(apiMessage(requestError, 'ส่งคำร้องไม่สำเร็จ ข้อมูลที่กรอกยังคงอยู่เพื่อให้ลองใหม่'));
    } finally { setBusy(false); }
  };

  return <form noValidate onSubmit={submit} className="space-y-4 border-b border-slate-100 bg-orange-50/40 p-5">
    <div className="flex items-center justify-between"><h3 className="font-bold text-slate-900">สร้างคำร้องใหม่</h3><button type="button" onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" aria-label="ปิดแบบฟอร์ม"><X size={18} /></button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {courses.length === 0 ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ยังไม่มีรายวิชาที่ลงทะเบียนและมีอาจารย์ผู้รับผิดชอบ จึงยังส่งคำร้องไม่ได้</p> : <>
      <div><label htmlFor="support-course" className="mb-1.5 block text-sm font-semibold text-slate-800">รายวิชา</label><select id="support-course" value={selectedCourseId} onChange={(event) => { markEdited(); setCourseId(event.target.value); }} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200">{courses.map((course) => <option key={course.id} value={course.id}>{course.course_code} · {course.course_name}{course.section ? ` (กลุ่ม ${course.section})` : ''}</option>)}</select></div>
      <div><label htmlFor="support-subject" className="mb-1.5 block text-sm font-semibold text-slate-800">หัวข้อ</label><input id="support-subject" value={subject} onChange={(event) => { markEdited(); setSubject(event.target.value); }} maxLength={160} aria-invalid={subject.length > 0 && subject.trim().length < 3} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" placeholder="เช่น ขอแก้ไขข้อมูลการเข้าเรียน" /></div>
      <MessageFields message={message} onMessageChange={(value) => { markEdited(); setMessage(value); }} files={files} onFilesChange={(value) => { markEdited(); setFiles(value); }} />
      <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50">ยกเลิก</button><button type="submit" disabled={busy} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Send size={17} />}{busy ? 'กำลังส่ง…' : 'ส่งคำร้อง'}</button></div>
    </>}
  </form>;
}

function SupportThread({ request, mode, onUpdated }: { request: SupportRequest; mode: 'student' | 'teacher'; onUpdated: (request: SupportRequest) => void }) {
  const { notify } = useNotification();
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const messageEnd = useRef<HTMLDivElement | null>(null);
  const [clientToken, setClientToken] = useState(() => crypto.randomUUID());
  const attempted = useRef(false);
  const otherPerson = mode === 'teacher' ? request.student : request.teacher;

  useEffect(() => { messageEnd.current?.scrollIntoView({ block: 'nearest' }); }, [request.messages?.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!message.trim() && files.length === 0) { setError('กรุณาพิมพ์ข้อความหรือแนบไฟล์'); return; }
    setBusy(true);
    attempted.current = true;
    const data = new FormData();
    data.set('message', message.trim());
    data.set('client_token', clientToken);
    files.forEach((file) => data.append('attachments', file));
    try {
      const response = await axios.post(`/api/v1/support/requests/${request.id}/messages`, data);
      setClientToken(crypto.randomUUID()); attempted.current = false;
      setMessage(''); setFiles([]); onUpdated(response.data.request); notify('ส่งข้อความแล้ว', 'success');
    } catch (requestError) { setError(apiMessage(requestError, 'ส่งข้อความไม่สำเร็จ ข้อความและไฟล์ยังคงอยู่')); } finally { setBusy(false); }
  };

  const resolveRequest = async () => {
    setBusy(true); setError('');
    try {
      const response = await axios.patch(`/api/v1/support/requests/${request.id}/status`, { status: 'resolved' });
      onUpdated(response.data.request); notify('ทำเครื่องหมายคำร้องว่าเสร็จสิ้นแล้ว', 'success');
    } catch (requestError) { setError(apiMessage(requestError, 'เปลี่ยนสถานะคำร้องไม่สำเร็จ')); } finally { setBusy(false); }
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4"><div><div className="flex items-center gap-2"><h3 className="font-bold text-slate-900">{request.subject}</h3><StatusBadge status={request.status} /></div><p className="mt-1 text-xs text-slate-500">{request.course?.course_code} · สนทนากับ {otherPerson?.full_name || (mode === 'teacher' ? 'นักศึกษา' : 'อาจารย์')}</p></div>{mode === 'teacher' && request.status === 'open' && <button type="button" onClick={() => void resolveRequest()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"><CheckCircle2 size={16} />เสร็จสิ้น</button>}</div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <ol className="space-y-3" aria-label="ข้อความในคำร้อง">
      {(request.messages || []).map((item) => {
        const mine = item.sender_id === (mode === 'student' ? request.student_id : request.teacher_id);
        return <li key={item.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><article className={`max-w-[92%] rounded-2xl border p-3 ${mine ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-slate-50'}`}><div className="mb-2 flex items-center gap-2"><span aria-hidden="true" className={`flex size-7 items-center justify-center rounded-full text-[10px] font-bold ${mine ? 'bg-orange-600 text-white' : 'bg-slate-700 text-white'}`}>{initials(item.sender?.full_name)}</span><p className="text-xs font-semibold text-slate-700">{mine ? 'คุณ' : item.sender?.full_name || 'ผู้ส่ง'}</p></div>{item.body && <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{item.body}</p>}{item.attachments.length > 0 && <div className="mt-3 space-y-2">{item.attachments.map((attachment) => <SecureAttachmentPreview key={attachment.id} attachment={attachment} />)}</div>}<p className="mt-2 text-[10px] text-slate-400">{formatDate(item.created_at)}</p></article></li>;
      })}
      <div ref={messageEnd} />
    </ol>
    {request.status === 'resolved' && mode === 'teacher' ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">คำร้องนี้เสร็จสิ้นแล้ว นักศึกษาสามารถส่งข้อความใหม่เพื่อเปิดคำร้องอีกครั้ง</p> : <form noValidate onSubmit={send} className="space-y-3 border-t border-slate-100 pt-4"><MessageFields message={message} onMessageChange={(value) => { if (attempted.current) { setClientToken(crypto.randomUUID()); attempted.current = false; } setMessage(value); }} files={files} onFilesChange={(value) => { if (attempted.current) { setClientToken(crypto.randomUUID()); attempted.current = false; } setFiles(value); }} compact /><button type="submit" disabled={busy} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Send size={17} />}{busy ? 'กำลังส่ง…' : request.status === 'resolved' ? 'ส่งและเปิดคำร้องอีกครั้ง' : 'ส่งข้อความ'}</button></form>}
  </div>;
}

function MessageFields({ message, onMessageChange, files, onFilesChange, compact = false }: { message: string; onMessageChange: (value: string) => void; files: File[]; onFilesChange: (files: File[]) => void; compact?: boolean }) {
  const [fileError, setFileError] = useState('');
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  const chooseFiles = (incoming: FileList | null) => {
    setFileError('');
    if (!incoming) return;
    const next = [...files, ...Array.from(incoming)];
    if (next.length > MAX_FILES) { setFileError(`แนบไฟล์ได้ไม่เกิน ${MAX_FILES} ไฟล์ต่อข้อความ`); return; }
    const invalid = next.find((file) => !ACCEPTED_TYPES.has(file.type) || file.size === 0 || file.size > MAX_FILE_BYTES);
    if (invalid) { setFileError(`ไฟล์ ${invalid.name} ต้องเป็น JPEG, PNG, WebP หรือ PDF และไม่เกิน 10 MB`); return; }
    onFilesChange(next);
  };

  return <div className="space-y-3"><div><label htmlFor={compact ? 'support-reply' : 'support-message'} className="mb-1.5 block text-sm font-semibold text-slate-800">ข้อความ</label><textarea id={compact ? 'support-reply' : 'support-message'} value={message} onChange={(event) => onMessageChange(event.target.value)} maxLength={4000} rows={compact ? 3 : 4} className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm leading-6 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" placeholder={compact ? 'พิมพ์ข้อความตอบกลับ…' : 'อธิบายรายละเอียดที่ต้องการให้อาจารย์ตรวจสอบ…'} /></div>
    <div><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-orange-300"><Paperclip size={17} />แนบรูปหรือ PDF<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ''; }} className="sr-only" /></label><p className="mt-1.5 text-xs text-slate-500">สูงสุด {MAX_FILES} ไฟล์ · ไฟล์ละไม่เกิน 10 MB · ตรวจตัวอย่างได้ก่อนส่ง</p></div>
    {fileError && <p role="alert" className="text-xs font-medium text-red-700">{fileError}</p>}
    {previews.length > 0 && <ul className="grid gap-2 sm:grid-cols-2" aria-label="ตัวอย่างไฟล์ก่อนส่ง">{previews.map(({ file, url }, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="relative bg-slate-100">{file.type === 'application/pdf' ? <iframe title={`ตัวอย่าง ${file.name}`} src={url} sandbox="" className="h-40 w-full" /> : <img src={url} alt={`ตัวอย่าง ${file.name}`} className="h-40 w-full object-contain" />}<button type="button" onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))} className="absolute right-2 top-2 rounded-full bg-slate-900/80 p-1.5 text-white hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-300" aria-label={`นำ ${file.name} ออก`}><X size={14} /></button></div><div className="p-2"><p className="truncate text-xs font-semibold text-slate-700">{file.name}</p><p className="text-[10px] text-slate-400">{formatBytes(file.size)}</p></div></li>)}</ul>}
  </div>;
}

function SecureAttachmentPreview({ attachment }: { attachment: SupportAttachment }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const togglePreview = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (url) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true); setError('');
    try {
      const response = await axios.get(attachment.preview_url, { responseType: 'blob', signal: controller.signal });
      setUrl(URL.createObjectURL(response.data));
    } catch (requestError) {
      if (!axios.isCancel(requestError)) setError('เปิดตัวอย่างไฟล์ไม่สำเร็จ');
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setLoading(false);
    }
  };

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const Icon = attachment.content_type === 'application/pdf' ? FileText : FileImage;
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><button type="button" onClick={() => void togglePreview()} className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange-300"><Icon className="shrink-0 text-orange-600" size={20} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-800">{attachment.original_name}</span><span className="block text-[10px] text-slate-400">{formatBytes(attachment.size_bytes)} · {open ? 'ซ่อนตัวอย่าง' : 'เปิดตัวอย่างแบบปลอดภัย'}</span></span>{loading && <LoaderCircle className="animate-spin text-slate-400" size={16} />}</button>{error && <p role="alert" className="px-3 pb-3 text-xs text-red-700">{error}</p>}{open && url && <div className="border-t border-slate-200 bg-slate-100 p-2">{attachment.content_type === 'application/pdf' ? <iframe title={`ตัวอย่าง ${attachment.original_name}`} src={url} sandbox="" className="h-72 w-full rounded-lg bg-white" /> : <img src={url} alt={`ไฟล์แนบ ${attachment.original_name}`} className="max-h-72 w-full rounded-lg object-contain" />}</div>}</div>;
}
