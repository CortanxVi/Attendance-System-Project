import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Check, Clock3, ShieldCheck, X } from 'lucide-react';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { useNotification } from '../../components/notifications/NotificationProvider';

interface TemporaryRequest {
  id: string;
  teacher_id: string;
  reason: string;
  status: string;
  created_at: string;
  profiles?: { full_name?: string; email?: string } | null;
}
interface Enrollment { teacher_id: string; created_at: string; last_used_at?: string | null; profiles?: { full_name?: string; email?: string } | null }
interface RuntimeConfig { temporary_admin_grant_seconds: number; temporary_admin_enrollment_seconds: number }

type Decision = { request: TemporaryRequest; value: 'approved' | 'rejected' } | null;

export default function TemporaryAdminRequests() {
  const { notify } = useNotification();
  const [items, setItems] = useState<TemporaryRequest[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [decision, setDecision] = useState<Decision>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<Enrollment | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({
    temporary_admin_grant_seconds: 600,
    temporary_admin_enrollment_seconds: 86400,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [requestResponse, enrollmentResponse, configResponse] = await Promise.all([
        axios.get('/api/v1/admin/temporary-admin/requests', { params: { request_status: 'pending' } }),
        axios.get('/api/v1/admin/temporary-admin/enrollments'),
        axios.get('/api/v1/system/config'),
      ]);
      setItems(requestResponse.data.requests ?? []);
      setEnrollments(enrollmentResponse.data.enrollments ?? []);
      setRuntimeConfig(configResponse.data);
    } catch {
      setError('ไม่สามารถโหลดคำขอสิทธิ์ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submitDecision = async () => {
    if (!decision) return;
    if (decision.value === 'rejected' && note.trim().length < 3) {
      setError('กรุณาระบุเหตุผลที่ปฏิเสธอย่างน้อย 3 ตัวอักษร');
      return;
    }
    setBusy(true); setError('');
    try {
      await axios.post(`/api/v1/admin/temporary-admin/requests/${decision.request.id}/decision`, {
        decision: decision.value,
        note: note.trim() || null,
      });
      const enrollmentHours = Math.round(runtimeConfig.temporary_admin_enrollment_seconds / 3600);
      notify(decision.value === 'approved' ? `อนุมัติคำขอแล้ว อาจารย์มีเวลา ${enrollmentHours} ชั่วโมงเพื่อตั้ง PIN` : 'ปฏิเสธคำขอแล้ว', 'success');
      setDecision(null); setNote(''); await load();
    } catch (requestError) {
      const message = axios.isAxiosError(requestError) && typeof requestError.response?.data?.detail === 'string' ? requestError.response.data.detail : 'บันทึกผลพิจารณาไม่สำเร็จ';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!revoking || revokeReason.trim().length < 5) { setError('กรุณาระบุเหตุผลเพิกถอนอย่างน้อย 5 ตัวอักษร'); return; }
    setBusy(true); setError('');
    try {
      await axios.post(`/api/v1/admin/temporary-admin/enrollments/${revoking.teacher_id}/revoke`, { reason: revokeReason.trim() });
      notify('เพิกถอนสิทธิ์ชั่วคราวและ session ที่กำลังใช้งานแล้ว', 'success'); setRevoking(null); setRevokeReason(''); await load();
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) && typeof requestError.response?.data?.detail === 'string' ? requestError.response.data.detail : 'เพิกถอนสิทธิ์ไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div><h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ShieldCheck className="text-red-600" />คำขอสิทธิ์ผู้ดูแลชั่วคราว</h2><p className="mt-1 text-sm text-gray-500">ตรวจสอบตัวตนและเหตุผลก่อนอนุมัติ การอนุมัติไม่เปลี่ยนบทบาทถาวรของอาจารย์</p></div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p>}
      {loading ? <p className="text-sm text-gray-500">กำลังโหลดคำขอ…</p> : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center"><Clock3 className="mx-auto text-gray-400" /><p className="mt-3 font-semibold text-gray-700">ไม่มีคำขอที่รอพิจารณา</p></div>
      ) : <div className="space-y-4">{items.map((item) => <article key={item.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div><h3 className="font-bold text-gray-900">{item.profiles?.full_name || 'อาจารย์'}</h3><p className="text-sm text-gray-500">{item.profiles?.email || item.teacher_id}</p><p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-gray-700">{item.reason}</p><p className="mt-2 text-xs text-gray-500">ส่งเมื่อ {new Date(item.created_at).toLocaleString('th-TH')}</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => { setDecision({ request: item, value: 'rejected' }); setError(''); }} className="flex items-center gap-1 rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"><X size={17} />ปฏิเสธ</button><button type="button" onClick={() => { setDecision({ request: item, value: 'approved' }); setError(''); }} className="flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><Check size={17} />อนุมัติ</button></div></div>
      </article>)}</div>}

      <section aria-labelledby="enrollment-title" className="space-y-3"><div><h3 id="enrollment-title" className="text-lg font-bold text-gray-900">อาจารย์ที่ได้รับอนุมัติแล้ว</h3><p className="text-sm text-gray-500">เพิกถอนเมื่ออุปกรณ์หรือ PIN อาจรั่วไหล หรือไม่มีความจำเป็นต้องใช้สิทธิ์อีก</p></div>{enrollments.length === 0 ? <p className="rounded-xl border border-dashed p-5 text-sm text-gray-500">ยังไม่มีอาจารย์ที่ตั้ง PIN</p> : <div className="grid gap-3 md:grid-cols-2">{enrollments.map((item) => <article key={item.teacher_id} className="rounded-2xl border border-gray-200 bg-white p-4"><p className="font-bold text-gray-900">{item.profiles?.full_name || 'อาจารย์'}</p><p className="text-xs text-gray-500">{item.profiles?.email || item.teacher_id}</p><p className="mt-2 text-xs text-gray-500">ใช้งานล่าสุด: {item.last_used_at ? new Date(item.last_used_at).toLocaleString('th-TH') : 'ยังไม่เคยเปิดสิทธิ์'}</p><button type="button" onClick={() => { setRevoking(item); setError(''); }} className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">เพิกถอนสิทธิ์</button></article>)}</div>}</section>

      {decision?.value === 'rejected' && <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 'var(--z-backdrop)' }}><button type="button" aria-label="ปิดหน้าต่าง" className="absolute inset-0 bg-slate-950/60" onClick={() => !busy && setDecision(null)} /><form noValidate onSubmit={(event) => { event.preventDefault(); void submitDecision(); }} role="dialog" aria-modal="true" aria-labelledby="reject-title" className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" style={{ zIndex: 'var(--z-dialog)' }}><h3 id="reject-title" className="text-xl font-bold text-gray-900">เหตุผลที่ปฏิเสธคำขอ</h3><p className="mt-2 text-sm text-gray-600">ข้อความนี้จะแสดงให้อาจารย์เห็นและถูกเก็บใน Audit Log</p><label htmlFor="reject-note" className="mt-4 block text-sm font-semibold text-gray-800">เหตุผล</label><textarea autoFocus id="reject-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={4} className="mt-1 w-full resize-none rounded-xl border border-gray-300 p-3 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200" /><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setDecision(null)} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold">ยกเลิก</button><button type="submit" disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'กำลังบันทึก…' : 'ยืนยันการปฏิเสธ'}</button></div></form></div>}
      <ConfirmDialog open={decision?.value === 'approved'} title="อนุมัติสิทธิ์ผู้ดูแลชั่วคราวหรือไม่" description={`อาจารย์ ${decision?.request.profiles?.full_name || ''} จะมีเวลา ${Math.round(runtimeConfig.temporary_admin_enrollment_seconds / 3600)} ชั่วโมงเพื่อตั้ง PIN หลังจากนั้นเปิดสิทธิ์ได้ครั้งละ ${Math.round(runtimeConfig.temporary_admin_grant_seconds / 60)} นาที`} confirmLabel="อนุมัติคำขอ" busy={busy} onConfirm={submitDecision} onCancel={() => setDecision(null)} />
      {revoking && <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 'var(--z-backdrop)' }}><button type="button" aria-label="ปิดหน้าต่าง" className="absolute inset-0 bg-slate-950/60" onClick={() => !busy && setRevoking(null)} /><form noValidate onSubmit={revoke} role="alertdialog" aria-modal="true" aria-labelledby="revoke-title" className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" style={{ zIndex: 'var(--z-dialog)' }}><h3 id="revoke-title" className="text-xl font-bold text-gray-900">เพิกถอนสิทธิ์ของ {revoking.profiles?.full_name || 'อาจารย์'}</h3><p className="mt-2 text-sm text-gray-600">PIN เดิมและสิทธิ์ที่กำลังใช้งานจะใช้ต่อไม่ได้ หากต้องการใช้อีกต้องส่งคำขอใหม่</p><label htmlFor="revoke-reason" className="mt-4 block text-sm font-semibold">เหตุผล</label><textarea autoFocus id="revoke-reason" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} maxLength={500} rows={4} className="mt-1 w-full resize-none rounded-xl border border-gray-300 p-3 text-sm" /><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setRevoking(null)} className="rounded-xl border px-4 py-2 text-sm font-semibold">ยกเลิก</button><button type="submit" disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'กำลังเพิกถอน…' : 'ยืนยันเพิกถอน'}</button></div></form></div>}
    </div>
  );
}
