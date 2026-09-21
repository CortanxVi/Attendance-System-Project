import { useMemo, useState } from 'react';
import { ShieldCheck, UserRound } from 'lucide-react';

export interface SidebarAccountProfile {
  email: string;
  full_name: string;
  avatar_url?: string | null;
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
  const presentation = rolePresentation[role];
  const displayName = profile.full_name.trim() || profile.email;
  const initials = useMemo(() => displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase(), [displayName]);

  return (
    <section
      aria-label={`บัญชี ${displayName}, บทบาท ${presentation.label}`}
      className={`mx-3 mt-4 flex shrink-0 items-center gap-3 rounded-2xl border border-slate-700 bg-slate-800/80 p-3 shadow-sm ${desktopExpanded ? '' : 'lg:justify-center lg:px-2'}`}
    >
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/15 bg-slate-700 text-sm font-bold text-white">
        {profile.avatar_url && !avatarFailed
          ? <img src={profile.avatar_url} alt="" onError={() => setAvatarFailed(true)} referrerPolicy="no-referrer" className="size-full object-cover" />
          : initials || <UserRound aria-hidden="true" size={22} />}
      </span>
      <span className={`min-w-0 flex-1 ${desktopExpanded ? 'lg:block' : 'lg:hidden'}`}>
        <span className="block truncate text-sm font-bold text-white">{displayName}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-300">{profile.email}</span>
        <span className={`mt-2 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold leading-none ${presentation.badgeClass}`}>
          <ShieldCheck aria-hidden="true" size={13} className="shrink-0" />
          <span className="truncate">{presentation.label}</span>
        </span>
      </span>
    </section>
  );
}
