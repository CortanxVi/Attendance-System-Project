import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, Clock3, Eye, EyeOff, KeyRound,
  MessagesSquare, ScanText, ShieldCheck, SlidersHorizontal, TriangleAlert,
} from 'lucide-react';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { useNotification } from '../../components/notifications/notificationContext';
import { useTemporaryAdmin } from '../../contexts/temporaryAdminState';
import SupportCenter from '../support/SupportCenter';

interface RuntimeConfig { qr_refresh_seconds: number; qr_challenge_seconds: number; ocr_provider: string; attendance_methods: string[]; email_policy: string }
interface AccessRequest { id: string; reason: string; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; review_note?: string | null; enrollment_expires_at?: string | null; created_at: string }
interface AccessStatus { request: AccessRequest | null; enrolled: boolean; enrollment?: { locked_until?: string | null; last_used_at?: string | null } | null; grant_ttl_seconds: number }

function apiMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
    ? error.response.data.detail : fallback;
}

const sections = [
  { key: 'student-requests', title: 'คำร้องของนักศึกษา', description: 'อ่านข้อความ ตอบกลับ และตรวจไฟล์แนบจากนักศึกษา', icon: MessagesSquare, tone: 'bg-blue-100 text-blue-700' },
  { key: 'admin-access', title: 'สิทธิ์ผู้ดูแลชั่วคราว', description: 'ส่งคำขอ ตั้ง PIN และเปิดสิทธิ์ที่ได้รับอนุมัติ', icon: ShieldCheck, tone: 'bg-orange-100 text-orange-700' },
  { key: 'system-info', title: 'ข้อมูลระบบและความปลอดภัย', description: 'ตรวจรอบเวลา Dynamic QR, OCR และวิธีเช็คชื่อที่เปิดใช้', icon: SlidersHorizontal, tone: 'bg-slate-100 text-slate-700' },
] as const;

export default function TeacherSettings() {
  const { section } = useParams();
  if (!section) return <SettingsHome />;
  if (section === 'student-requests') return <StudentRequestsSettings />;
  if (section === 'admin-access') return <TemporaryAdminSettings />;
  if (section === 'system-info') return <SystemInfoSettings />;
  return <Navigate to="/teacher/settings" replace />;
}

function SettingsHome() {
  useEffect(() => { document.title = 'ตั้งค่าระบบ — ระบบบันทึกเวลาเข้าเรียน KMUTNB'; }, []);
  return <div className="mx-auto max-w-4xl space-y-6">
    <header><h2 className="text-2xl font-bold text-slate-900">ตั้งค่าระบบ</h2><p className="mt-1 text-sm text-slate-500">เลือกหัวข้อที่ต้องการจัดการ แต่ละหัวข้อเปิดเป็นหน้าแยกและกลับมาหน้านี้ได้</p></header>
    <nav aria-label="หัวข้อการตั้งค่าระบบ" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <ul className="divide-y divide-slate-100">{sections.map((item) => { const Icon = item.icon; return <li key={item.key}><Link to={`/teacher/settings/${item.key}`} className="group flex min-h-20 cursor-pointer items-center gap-4 px-5 py-4 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange-300"><span className={`rounded-xl p-2.5 ${item.tone}`}><Icon aria-hidden="true" size={22} /></span><span className="min-w-0 flex-1"><span className="block font-bold text-slate-900">{item.title}</span><span className="mt-1 block text-sm leading-5 text-slate-500">{item.description}</span></span><ChevronRight aria-hidden="true" className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-1" /></Link></li>; })}</ul>
    </nav>
  </div>;
}

function SettingsHeader({ title, description }: { title: string; description: string }) {
  return <header><Link to="/teacher/settings" className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-300"><ArrowLeft size={18} />กลับไปหน้าตั้งค่า</Link><h2 className="mt-3 text-2xl font-bold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></header>;
}

function StudentRequestsSettings() {
  useEffect(() => { document.title = 'คำร้องของนักศึกษา — ระบบบันทึกเวลาเข้าเรียน KMUTNB'; }, []);
  return <div className="mx-auto max-w-4xl space-y-6"><SettingsHeader title="คำร้องของนักศึกษา" description="ตอบกลับข้อความและตรวจตัวอย่างไฟล์แนบในคำร้องที่เกี่ยวข้องกับรายวิชาของคุณ" /><SupportCenter mode="teacher" /></div>;
}

function TemporaryAdminSettings() {
  const navigate = useNavigate();
  const { notify } = useNotification();
  const temporaryAdmin = useTemporaryAdmin();
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const loadAccess = useCallback(async () => {
    const response = await axios.get('/api/v1/temporary-admin/status');
    setAccess(response.data);
  }, []);

  useEffect(() => {
    document.title = 'สิทธิ์ผู้ดูแลชั่วคราว — ระบบบันทึกเวลาเข้าเรียน KMUTNB';
    const timer = window.setTimeout(() => { loadAccess().catch((loadError) => setError(apiMessage(loadError, 'ไม่สามารถโหลดสถานะสิทธิ์ได้'))); }, 0);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearTimeout(timer); window.clearInterval(clock); };
  }, [loadAccess]);

  const requestAccess = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (reason.trim().length < 10) { setError('กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร'); return; }
    setBusy(true);
    try { await axios.post('/api/v1/temporary-admin/requests', { reason: reason.trim() }); setReason(''); await loadAccess(); notify('ส่งคำขอให้ผู้ดูแลระบบพิจารณาแล้ว', 'success'); }
    catch (requestError) { setError(apiMessage(requestError, 'ส่งคำขอไม่สำเร็จ')); }
    finally { setBusy(false); }
  };

  const cancelRequest = async () => {
    if (!access?.request) return;
    setBusy(true);
    try { await axios.delete(`/api/v1/temporary-admin/requests/${access.request.id}`); await loadAccess(); notify('ยกเลิกคำขอแล้ว', 'success'); setCancelOpen(false); }
    catch (cancelError) { setError(apiMessage(cancelError, 'ยกเลิกคำขอไม่สำเร็จ')); }
    finally { setBusy(false); }
  };

  const enrollPin = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!/^\d{6}$/.test(pin) || pin !== confirmPin) { setError('กรุณากรอก PIN ตัวเลข 6 หลักให้ตรงกันทั้งสองช่อง'); return; }
    setBusy(true);
    try { await axios.post('/api/v1/temporary-admin/pin/enroll', { pin, confirm_pin: confirmPin }); setPin(''); setConfirmPin(''); await loadAccess(); notify('ตั้ง PIN สำเร็จ สามารถใช้เปิดสิทธิ์ผู้ดูแลชั่วคราวได้แล้ว', 'success'); }
    catch (enrollError) { setError(apiMessage(enrollError, 'ตั้ง PIN ไม่สำเร็จ')); }
    finally { setBusy(false); }
  };

  const activateAccess = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!/^\d{6}$/.test(pin)) { setError('กรุณากรอก PIN ตัวเลข 6 หลัก'); return; }
    setBusy(true);
    try { const response = await axios.post('/api/v1/temporary-admin/activate', { pin }); temporaryAdmin.activate(response.data.grant_token, response.data.expires_at); setPin(''); notify('เปิดสิทธิ์ผู้ดูแลชั่วคราวแล้ว', 'success'); navigate('/admin'); }
    catch (activateError) { setError(apiMessage(activateError, 'ไม่สามารถเปิดสิทธิ์ชั่วคราวได้')); }
    finally { setBusy(false); }
  };

  const request = access?.request;
  const enrollmentDeadlinePassed = request?.enrollment_expires_at ? new Date(request.enrollment_expires_at).getTime() <= now : false;
  const locked = access?.enrollment?.locked_until ? new Date(access.enrollment.locked_until).getTime() > now : false;

  return <div className="mx-auto max-w-4xl space-y-6">
    <SettingsHeader title="สิทธิ์ผู้ดูแลชั่วคราว" description="สิทธิ์ครั้งแรกต้องผ่านการอนุมัติสองฝ่าย จากนั้นใช้ PIN 6 หลักเปิดสิทธิ์ตามเวลาที่กำหนด" />
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p>}
    <section aria-labelledby="temporary-admin-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-orange-100 p-2 text-orange-700"><ShieldCheck aria-hidden="true" /></span><div><h3 id="temporary-admin-title" className="text-lg font-bold text-gray-900">การเปิดใช้สิทธิ์</h3><p className="mt-1 text-sm leading-6 text-gray-600">ผู้ดูแลระบบถาวรต้องอนุมัติครั้งแรก จากนั้น PIN จะใช้เปิดสิทธิ์ครั้งละ {Math.round((access?.grant_ttl_seconds ?? 600) / 60)} นาที โดยไม่เปลี่ยนบทบาทถาวรของบัญชี</p></div></div>
      <div className="mt-5 border-t border-gray-100 pt-5">{!access ? <p className="text-sm text-gray-500">กำลังโหลดสถานะ…</p> : access.enrolled ? <form noValidate onSubmit={activateAccess} className="max-w-md space-y-4"><p className="text-sm font-medium text-emerald-700">บัญชีนี้ผ่านการอนุมัติและตั้ง PIN แล้ว</p>{locked && <p role="alert" className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><TriangleAlert size={18} /> PIN ถูกล็อกชั่วคราวถึง {new Date(access.enrollment!.locked_until!).toLocaleTimeString('th-TH')}</p>}<PinField label="PIN 6 หลัก" value={pin} onChange={setPin} visible={showPin} onToggle={() => setShowPin((value) => !value)} /><PrimaryButton busy={busy} disabled={locked} label="เปิดสิทธิ์ผู้ดูแลชั่วคราว" busyLabel="กำลังตรวจสอบ…" /></form> : request?.status === 'pending' ? <div className="space-y-3"><p className="font-semibold text-amber-700">กำลังรอผู้ดูแลระบบพิจารณา</p><p className="text-sm text-gray-600">เหตุผล: {request.reason}</p><button type="button" onClick={() => setCancelOpen(true)} className="min-h-11 cursor-pointer rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-50">ยกเลิกคำขอ</button></div> : request?.status === 'approved' && !enrollmentDeadlinePassed ? <form noValidate onSubmit={enrollPin} className="max-w-md space-y-4"><p className="text-sm font-semibold text-emerald-700">คำขอได้รับอนุมัติ กรุณาตั้ง PIN ภายใน {new Date(request.enrollment_expires_at!).toLocaleString('th-TH')}</p><p className="text-xs leading-5 text-gray-500">หลีกเลี่ยงเลขเรียง เลขซ้ำ วันเกิด หรือเลขที่ผู้อื่นเดาได้ง่าย ระบบจะไม่แสดง PIN อีกหลังบันทึก</p><PinField label="ตั้ง PIN 6 หลัก" value={pin} onChange={setPin} visible={showPin} onToggle={() => setShowPin((value) => !value)} /><PinField label="ยืนยัน PIN" value={confirmPin} onChange={setConfirmPin} visible={showPin} /><PrimaryButton busy={busy} label="บันทึก PIN" busyLabel="กำลังบันทึก…" /></form> : <form noValidate onSubmit={requestAccess} className="max-w-xl space-y-4">{request?.status === 'rejected' && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">คำขอก่อนหน้าถูกปฏิเสธ{request.review_note ? `: ${request.review_note}` : ''}</p>}{request?.status === 'approved' && enrollmentDeadlinePassed && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ระยะเวลาตั้ง PIN หมดอายุ กรุณาส่งคำขอใหม่</p>}<label className="block text-sm font-semibold text-gray-800" htmlFor="admin-access-reason">เหตุผลที่ต้องใช้สิทธิ์ผู้ดูแล</label><textarea id="admin-access-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} rows={4} className="w-full resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" aria-describedby="admin-access-help" /><p id="admin-access-help" className="text-xs text-gray-500">ระบุงานที่ต้องทำอย่างน้อย 10 ตัวอักษร ผู้ดูแลระบบถาวรจะเห็นข้อความนี้</p><PrimaryButton busy={busy} label="ส่งคำขอสิทธิ์" busyLabel="กำลังส่ง…" /></form>}</div>
    </section>
    <ConfirmDialog open={cancelOpen} title="ยกเลิกคำขอสิทธิ์หรือไม่" description="คำขอนี้จะไม่ถูกนำไปพิจารณา และคุณสามารถส่งคำขอใหม่ภายหลังได้" confirmLabel="ยกเลิกคำขอ" danger busy={busy} onConfirm={cancelRequest} onCancel={() => setCancelOpen(false)} />
  </div>;
}

function SystemInfoSettings() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    document.title = 'ข้อมูลระบบและความปลอดภัย — ระบบบันทึกเวลาเข้าเรียน KMUTNB';
    const timer = window.setTimeout(() => { axios.get('/api/v1/system/config').then((response) => setConfig(response.data)).catch((loadError) => setError(apiMessage(loadError, 'ไม่สามารถโหลดข้อมูลระบบได้'))); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return <div className="mx-auto max-w-4xl space-y-6"><SettingsHeader title="ข้อมูลระบบและความปลอดภัย" description="ค่าที่ Backend ใช้งานจริงสำหรับการเช็คชื่อและการยืนยันตัวตน" />{error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}{!config && !error ? <p className="rounded-xl bg-white p-5 text-sm text-slate-500">กำลังโหลดข้อมูลระบบ…</p> : config && <section aria-label="ค่าความปลอดภัยส่วนกลาง" className="grid gap-4 md:grid-cols-2"><InfoCard icon={Clock3} tone="text-orange-600" title="Dynamic QR">เปลี่ยนทุก {config.qr_refresh_seconds} วินาที · challenge ใช้ได้ {config.qr_challenge_seconds} วินาทีและใช้ได้ครั้งเดียว</InfoCard><InfoCard icon={ScanText} tone="text-blue-600" title="OCR">{config.ocr_provider} ทำงานผ่าน Backend แบบ server-to-server</InfoCard><InfoCard icon={KeyRound} tone="text-violet-600" title="บัญชีที่อนุญาต">{config.email_policy}</InfoCard><InfoCard icon={ShieldCheck} tone="text-emerald-600" title="วิธีเช็คชื่อ">{config.attendance_methods.join(' · ')}</InfoCard></section>}</div>;
}

function InfoCard({ icon: Icon, tone, title, children }: { icon: typeof Clock3; tone: string; title: string; children: React.ReactNode }) { return <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><Icon className={`mb-3 ${tone}`} /><h3 className="font-bold text-gray-900">{title}</h3><p className="mt-2 text-sm leading-6 text-gray-600">{children}</p></article>; }
function PrimaryButton({ busy, disabled = false, label, busyLabel }: { busy: boolean; disabled?: boolean; label: string; busyLabel: string }) { return <button type="submit" disabled={busy || disabled} className="min-h-11 cursor-pointer rounded-xl bg-orange-600 px-5 text-sm font-bold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? busyLabel : label}</button>; }
function PinField({ label, value, onChange, visible, onToggle }: { label: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle?: () => void }) { return <div><label className="mb-1 block text-sm font-semibold text-gray-800">{label}</label><div className="relative"><input aria-label={label} type={visible ? 'text' : 'password'} inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))} className="w-full rounded-xl border border-gray-300 px-3 py-2 pr-11 tracking-[0.35em] focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" />{onToggle && <button type="button" onClick={onToggle} className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center text-gray-500" aria-label={visible ? 'ซ่อน PIN' : 'แสดง PIN'}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>}</div></div>; }
