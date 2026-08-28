import { useEffect, useState } from 'react';
import axios from 'axios';
import { BookOpen, CheckCircle2, CreditCard, Mail, ScanFace, UserRound } from 'lucide-react';

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
}

export default function StudentProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    axios.get('/api/v1/students/me/profile').then((response) => setProfile(response.data.profile)).catch(() => setError('ไม่สามารถโหลดข้อมูลโปรไฟล์ได้'));
  }, []);

  if (error) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>;
  if (!profile) return <p className="text-sm text-gray-500">กำลังโหลดโปรไฟล์…</p>;
  return <div className="mx-auto max-w-4xl space-y-6">
    <section className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white shadow-lg"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className="w-fit rounded-2xl bg-white/10 p-4"><UserRound size={36} /></span><div><p className="text-sm text-slate-300">โปรไฟล์นักศึกษา</p><h2 className="mt-1 text-2xl font-bold">{profile.full_name}</h2><p className="mt-1 font-mono text-slate-300">{profile.student_id}</p></div></div></section>
    <div className="grid gap-4 md:grid-cols-2">
      <InfoCard icon={<Mail />} label="อีเมลมหาวิทยาลัย" value={profile.email} />
      <InfoCard icon={<BookOpen />} label="ข้อมูลการศึกษา" value={`${profile.academic_year ? `ชั้นปี ${profile.academic_year}` : 'ยังไม่ระบุชั้นปี'}${profile.class_level ? ` · ${profile.class_level}` : ''}`} />
      <StatusCard icon={<ScanFace />} label="การสแกนใบหน้า" ready={profile.face_registered} />
      <StatusCard icon={<CreditCard />} label="บัตร NFC" ready={profile.nfc_registered} />
    </div>
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-sm text-gray-500">รายวิชาที่ลงทะเบียน</p><p className="mt-1 text-3xl font-bold text-gray-900">{profile.enrolled_course_count}</p><p className="mt-3 flex items-start gap-2 text-xs leading-5 text-gray-500"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={16} />ข้อมูลหน้านี้เป็นแบบอ่านอย่างเดียว หากข้อมูลประจำตัวไม่ถูกต้องให้ติดต่ออาจารย์หรือผู้ดูแลระบบ</p></section>
  </div>;
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><span className="text-blue-600">{icon}</span><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 break-words font-semibold text-gray-900">{value}</p></article>; }
function StatusCard({ icon, label, ready }: { icon: React.ReactNode; label: string; ready: boolean }) { return <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><span className={ready ? 'text-emerald-600' : 'text-gray-400'}>{icon}</span><p className="mt-3 font-bold text-gray-900">{label}</p><p className={`mt-1 text-sm font-semibold ${ready ? 'text-emerald-700' : 'text-amber-700'}`}>{ready ? 'ลงทะเบียนแล้ว' : 'ยังไม่ได้ลงทะเบียน'}</p></article>; }
