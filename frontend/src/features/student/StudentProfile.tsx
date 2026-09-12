import { useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  GraduationCap,
  LogOut,
  Mail,
  MessageSquareText,
  ScanFace,
  UserRound,
} from 'lucide-react';
import { useNotification } from '../../components/notifications/notificationContext';

interface Profile {
  email: string;
  student_id: string;
  full_name: string;
  academic_year?: number | null;
  class_level?: string | null;
  face_registered: boolean;
  nfc_registered: boolean;
  enrolled_course_count: number;
  created_at: string;
  avatar_url?: string | null;
}

export default function StudentProfile() {
  const { notify } = useNotification();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    document.title = 'โปรไฟล์นักศึกษา — KMUTNB Attendance';
    const controller = new AbortController();
    axios.get('/api/v1/students/me/profile', { signal: controller.signal })
      .then((response) => {
        const loaded = response.data.profile as Profile;
        setProfile(loaded);
      })
      .catch((loadError) => {
        if (!axios.isCancel(loadError)) setError('ไม่สามารถโหลดข้อมูลโปรไฟล์ได้');
      });
    return () => controller.abort();
  }, []);

  const initials = useMemo(() => (profile?.full_name || 'นักศึกษา')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase(), [profile?.full_name]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    const { error: logoutError } = await supabase.auth.signOut();
    if (logoutError) {
      notify('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่', 'error');
      setLoggingOut(false);
    }
  };

  if (error) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>;
  if (!profile) return <p role="status" className="min-h-24 p-4 text-sm text-gray-500">กำลังโหลดโปรไฟล์…</p>;

  return <div className="space-y-5 bg-slate-50 p-4 pb-6">
    <section aria-labelledby="student-profile-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">KMUTNB Attendance</p>
      </div>

      <div className="flex flex-col items-center px-5 py-6 text-center">
        <div className="relative flex size-28 items-center justify-center overflow-hidden rounded-full border-4 border-orange-100 bg-slate-100 text-2xl font-bold text-slate-500 shadow-sm">
          {profile.avatar_url && !avatarFailed
            ? <img src={profile.avatar_url} alt={`รูปโปรไฟล์ Google ของ ${profile.full_name}`} onError={() => setAvatarFailed(true)} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            : initials || <UserRound aria-hidden="true" />}
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">{profile.full_name}</h2>
        <p className="mt-1 break-all text-sm text-slate-500">{profile.email}</p>
        <p className="mt-1 font-mono text-xs font-semibold text-slate-600">StudentID: {profile.student_id}</p>
      </div>

      <ul className="divide-y divide-slate-100 border-t border-slate-100" aria-label="ข้อมูลและการตั้งค่าโปรไฟล์">
        <li className="px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><GraduationCap aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">ข้อมูลการศึกษา</p>
              <p className="mt-0.5 break-words text-xs text-slate-500">{profile.academic_year ? `ชั้นปี ${profile.academic_year}` : 'ไม่สามารถคำนวณชั้นปีจากรหัสนักศึกษาได้'}{profile.class_level ? ` · ${profile.class_level}` : ''}</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">ระบบคำนวณอัตโนมัติจากปีรับเข้าในรหัสนักศึกษา</p>
            </div>
          </div>
        </li>

        <ProfileRow icon={<BookOpen />} label="รายวิชาที่ลงทะเบียน" value={`${profile.enrolled_course_count} รายวิชา`} action={<Link to="/student/courses" aria-label="จัดการรายวิชาที่ลงทะเบียน" className="inline-flex min-h-10 items-center gap-1 rounded-xl px-2 text-xs font-bold text-orange-700 hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-300">จัดการ<ChevronRight size={17} /></Link>} />
        <ProfileRow
          icon={<ScanFace />}
          label="การสแกนใบหน้า"
          value={profile.face_registered ? 'ลงทะเบียนแล้ว' : 'ยังไม่ได้ลงทะเบียน'}
          ready={profile.face_registered}
          action={!profile.face_registered ? <Link to="/student/register" className="shrink-0 rounded-xl bg-orange-600 px-3 py-2 text-xs font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300">ลงทะเบียนใบหน้า</Link> : undefined}
        />
        <ProfileRow
          icon={<CreditCard />}
          label="บัตร NFC"
          value={profile.nfc_registered ? 'ลงทะเบียนแล้ว' : 'ยังไม่ได้ลงทะเบียน'}
          ready={profile.nfc_registered}
          description={!profile.nfc_registered ? 'กรุณาดำเนินการลงทะเบียนบัตร NFC กับอาจารย์ผู้สอน' : undefined}
        />
        <ProfileRow icon={<Mail />} label="บัญชีมหาวิทยาลัย" value="ยืนยันผ่าน Google แล้ว" ready />
        <li>
          <Link to="/student/requests" className="flex min-h-16 items-center gap-3 px-5 py-4 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange-300">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-700"><MessageSquareText aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">คำร้องถึงอาจารย์</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">ดูรายการ ส่งข้อความ และแนบเอกสาร</span>
            </span>
            <ChevronRight aria-hidden="true" className="shrink-0 text-slate-400" size={20} />
          </Link>
        </li>
      </ul>

      <p className="m-5 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={16} />ชั้นปี ชื่อ อีเมล และรหัสนักศึกษาเป็นข้อมูลยืนยันตัวตนที่นักศึกษาแก้ไขเองไม่ได้ หากข้อมูลไม่ถูกต้องให้ยื่นคำร้องถึงอาจารย์</p>
      <div className="border-t border-slate-100 p-5">
        <button type="button" onClick={() => void handleLogout()} disabled={loggingOut} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 font-bold text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-wait disabled:opacity-60"><LogOut size={19} />{loggingOut ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}</button>
      </div>
    </section>
  </div>;
}

function ProfileRow({ icon, label, value, ready, description, action }: {
  icon: ReactNode;
  label: string;
  value: string;
  ready?: boolean;
  description?: string;
  action?: ReactNode;
}) {
  return <li className="flex items-center gap-3 px-5 py-4">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600" aria-hidden="true">{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-slate-800">{label}</p>
      <p className={`mt-0.5 break-words text-xs ${ready === false ? 'font-semibold text-amber-700' : ready ? 'font-semibold text-emerald-700' : 'text-slate-500'}`}>{value}</p>
      {description && <p className="mt-1 text-xs leading-5 text-amber-700">{description}</p>}
    </div>
    {action}
  </li>;
}
