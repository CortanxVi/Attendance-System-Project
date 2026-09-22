import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, ShieldCheck, UserRound, X } from 'lucide-react';
import { useModalIsolation } from '../overlays/useModalIsolation';

export interface SidebarAccountProfile {
  id?: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  base_role?: string | null;
}

type SidebarAccountRole = 'teacher' | 'admin' | 'temporary_admin';

const rolePresentation: Record<SidebarAccountRole, { label: string; badgeClass: string }> = {
  teacher: {
    label: 'อาจารย์',
    badgeClass: 'border-orange-300/30 bg-orange-400/15 text-orange-200',
  },
  admin: {
    label: 'ผู้ดูแลระบบ',
    badgeClass: 'border-red-300/30 bg-red-400/15 text-red-200',
  },
  temporary_admin: {
    label: 'ผู้ดูแลระบบชั่วคราว',
    badgeClass: 'border-amber-300/30 bg-amber-400/15 text-amber-100',
  },
};

export default function SidebarAccountCard({
  profile,
  role,
  desktopExpanded,
}: {
  profile: SidebarAccountProfile;
  role: SidebarAccountRole;
  desktopExpanded: boolean;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const presentation = rolePresentation[role];
  const displayName = profile.full_name.trim() || profile.email;
  const initials = useMemo(() => displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase(), [displayName]);

  useModalIsolation(profileOpen);

  const closeProfile = useCallback(() => {
    setProfileOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeProfile();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeProfile, profileOpen]);

  const avatar = (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/15 bg-slate-700 text-sm font-bold text-white">
      {profile.avatar_url && !avatarFailed
        ? <img src={profile.avatar_url} alt="" onError={() => setAvatarFailed(true)} referrerPolicy="no-referrer" className="size-full object-cover" />
        : initials || <UserRound aria-hidden="true" size={22} />}
    </span>
  );

  return <>
    <button
      ref={triggerRef}
      type="button"
      aria-label={`ดูโปรไฟล์ ${displayName}, บทบาท ${presentation.label}`}
      aria-haspopup="dialog"
      aria-expanded={profileOpen}
      title="ดูโปรไฟล์"
      onClick={() => setProfileOpen(true)}
      className={`mx-3 mt-4 flex min-h-16 shrink-0 cursor-pointer items-center gap-3 rounded-2xl border border-slate-700 bg-slate-800/80 p-3 text-left shadow-sm transition-colors hover:border-slate-600 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${desktopExpanded ? '' : 'lg:justify-center lg:px-2'}`}
    >
      {avatar}
      <span className={`min-w-0 flex-1 ${desktopExpanded ? 'lg:block' : 'lg:hidden'}`}>
        <span className="block truncate text-sm font-bold text-white">{displayName}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-300">{profile.email}</span>
        <span className={`mt-2 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold leading-none ${presentation.badgeClass}`}>
          <ShieldCheck aria-hidden="true" size={13} className="shrink-0" />
          <span className="truncate">{presentation.label}</span>
        </span>
      </span>
    </button>

    {profileOpen && createPortal(
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-5" style={{ zIndex: 'var(--z-dialog)' }}>
        <button type="button" aria-label="ปิดหน้าต่างโปรไฟล์" onClick={closeProfile} className="absolute inset-0 cursor-pointer bg-slate-950/70 backdrop-blur-sm" />
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl"
        >
          <header className="relative bg-slate-900 px-5 pb-16 pt-5 text-white sm:px-6">
            <div className="pr-12">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Account profile</p>
              <h2 id={titleId} className="mt-1 text-xl font-bold">รายละเอียดบัญชี</h2>
            </div>
            <button ref={closeRef} type="button" onClick={closeProfile} aria-label="ปิดหน้าต่างโปรไฟล์" className="absolute right-4 top-4 flex size-11 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><X aria-hidden="true" size={22} /></button>
          </header>

          <div className="relative px-5 pb-6 sm:px-6">
            <div className="-mt-10 flex size-20 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-slate-700 text-xl font-bold text-white shadow-lg">
              {profile.avatar_url && !avatarFailed
                ? <img src={profile.avatar_url} alt={`รูปโปรไฟล์ Google ของ ${displayName}`} onError={() => setAvatarFailed(true)} referrerPolicy="no-referrer" className="size-full object-cover" />
                : initials || <UserRound aria-hidden="true" size={30} />}
            </div>
            <h3 className="mt-4 break-words text-xl font-bold text-slate-900">{displayName}</h3>
            <span className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${role === 'admin' ? 'border-red-200 bg-red-50 text-red-700' : role === 'temporary_admin' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-orange-200 bg-orange-50 text-orange-700'}`}>
              <ShieldCheck aria-hidden="true" size={14} />{presentation.label}
            </span>

            <dl className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70">
              <div className="flex items-start gap-3 p-4">
                <Mail className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" size={19} />
                <div className="min-w-0"><dt className="text-xs font-bold text-slate-500">อีเมลบัญชี</dt><dd className="mt-1 break-all text-sm font-semibold text-slate-800">{profile.email}</dd></div>
              </div>
              <div className="flex items-start gap-3 p-4">
                <ShieldCheck className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" size={19} />
                <div className="min-w-0"><dt className="text-xs font-bold text-slate-500">สิทธิ์ที่กำลังใช้งาน</dt><dd className="mt-1 text-sm font-semibold text-slate-800">{presentation.label}</dd></div>
              </div>
            </dl>
            <p id={descriptionId} className="mt-4 text-xs leading-5 text-slate-500">รูปและอีเมลดึงจากบัญชี Google ที่เข้าสู่ระบบ ส่วนสิทธิ์ยืนยันจาก Backend ของระบบ</p>
          </div>
        </section>
      </div>,
      document.body,
    )}
  </>;
}
