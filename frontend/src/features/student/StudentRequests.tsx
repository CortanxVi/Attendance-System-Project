import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import SupportCenter from '../support/SupportCenter';

export default function StudentRequests() {
  useEffect(() => {
    document.title = 'คำร้องถึงอาจารย์ — ระบบบันทึกเวลาเข้าเรียน KMUTNB';
  }, []);

  return <div className="space-y-4 bg-slate-50 p-4 pb-6">
    <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <Link to="/student/profile" className="inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300">
        <ArrowLeft aria-hidden="true" size={18} />
        กลับไปโปรไฟล์
      </Link>
      <div className="mt-3 px-3 pb-1">
        <h1 className="text-xl font-bold text-slate-900">คำร้องถึงอาจารย์</h1>
        <p className="mt-1 text-sm leading-6 text-slate-500">ติดตามรายการเดิม สร้างคำร้องใหม่ และตอบกลับพร้อมไฟล์แนบได้จากหน้านี้</p>
      </div>
    </header>
    <SupportCenter mode="student" />
  </div>;
}
