import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  GraduationCap,
  LoaderCircle,
  Mail,
  MessageSquareText,
  Pencil,
  ScanFace,
  UserRound,
  X,
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

function apiMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
    ? error.response.data.detail
    : fallback;
}

export default function StudentProfile() {
  const { notify } = useNotification();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [editingYear, setEditingYear] = useState(false);
  const [academicYear, setAcademicYear] = useState('1');
  const [yearError, setYearError] = useState('');
  const [savingYear, setSavingYear] = useState(false);

  useEffect(() => {
    document.title = 'โปรไฟล์นักศึกษา — KMUTNB Attendance';
    const controller = new AbortController();
    axios.get('/api/v1/students/me/profile', { signal: controller.signal })
      .then((response) => {
        const loaded = response.data.profile as Profile;
        setProfile(loaded);
        setAcademicYear(String(loaded.academic_year ?? 1));
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

  const saveAcademicYear = async (event: FormEvent) => {
    event.preventDefault();
    const nextYear = Number(academicYear);
    if (!Number.isInteger(nextYear) || nextYear < 1 || nextYear > 8) {
      setYearError('ชั้นปีต้องเป็นตัวเลขตั้งแต่ 1 ถึง 8');
      return;
    }

    setSavingYear(true);
    setYearError('');
    try {
      const response = await axios.patch('/api/v1/students/me/profile', {
        academic_year: nextYear,
      });
      const savedYear = response.data.profile.academic_year as number;
      setProfile((current) => current ? { ...current, academic_year: savedYear } : current);
      setAcademicYear(String(savedYear));
      setEditingYear(false);
      notify(`บันทึกชั้นปี ${savedYear} แล้ว`, 'success');
    } catch (saveError) {
      setYearError(apiMessage(saveError, 'ไม่สามารถบันทึกชั้นปีได้ กรุณาลองใหม่'));
    } finally {
      setSavingYear(false);
    }
  };

  const cancelAcademicYearEdit = () => {
    setAcademicYear(String(profile?.academic_year ?? 1));
    setYearError('');
    setEditingYear(false);
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
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">ข้อมูลการศึกษา</p>
                {!editingYear && <button type="button" onClick={() => setEditingYear(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-orange-700 hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-300"><Pencil size={14} />แก้ไขชั้นปี</button>}
              </div>
              {!editingYear ? (
                <p className="mt-0.5 break-words text-xs text-slate-500">{profile.academic_year ? `ชั้นปี ${profile.academic_year}` : 'ยังไม่ระบุชั้นปี'}{profile.class_level ? ` · ${profile.class_level}` : ''}</p>
              ) : (
                <form noValidate onSubmit={saveAcademicYear} className="mt-3 space-y-2">
                  <label htmlFor="student-academic-year" className="block text-xs font-semibold text-slate-700">เลือกชั้นปี (1–8)</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select id="student-academic-year" value={academicYear} onChange={(event) => { setAcademicYear(event.target.value); setYearError(''); }} disabled={savingYear} aria-invalid={Boolean(yearError)} aria-describedby={yearError ? 'academic-year-error' : undefined} className="min-h-10 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:bg-slate-100">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((year) => <option key={year} value={year}>ชั้นปี {year}</option>)}
                    </select>
                    <button type="submit" disabled={savingYear} className="inline-flex min-h-10 min-w-20 items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3 text-xs font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-60">{savingYear && <LoaderCircle className="animate-spin" size={15} />}{savingYear ? 'กำลังบันทึก…' : 'บันทึก'}</button>
                    <button type="button" onClick={cancelAcademicYearEdit} disabled={savingYear} aria-label="ยกเลิกการแก้ไขชั้นปี" className="flex size-10 items-center justify-center rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-50"><X size={17} /></button>
                  </div>
                  {yearError && <p id="academic-year-error" role="alert" className="text-xs font-medium text-red-700">{yearError}</p>}
                </form>
              )}
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

      <p className="m-5 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={16} />แก้ไขชั้นปีได้จากหน้านี้ ส่วนชื่อ อีเมล และรหัสนักศึกษาเป็นข้อมูลยืนยันตัวตน หากไม่ถูกต้องให้ยื่นคำร้องถึงอาจารย์</p>
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
