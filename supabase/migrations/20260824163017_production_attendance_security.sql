-- Production hardening for authenticated attendance, Dynamic QR and Realtime.
-- This migration is additive except for replacing overly broad grants/policies.

create schema if not exists private;

create table if not exists public.profile_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  student_id text,
  full_name text not null,
  role text not null check (role in ('student', 'teacher', 'admin')),
  invited_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists profile_invites_email_lower_key
  on public.profile_invites (lower(email));
create unique index if not exists profile_invites_student_id_key
  on public.profile_invites (student_id)
  where student_id is not null;

alter table public.attendance_sessions
  add column if not exists qr_token_rotated_at timestamptz not null default now();
alter table public.attendance_sessions
  alter column qr_refresh_rate_seconds set default 12;
update public.attendance_sessions
set qr_refresh_rate_seconds = 12
where qr_refresh_rate_seconds is null
   or qr_refresh_rate_seconds < 10
   or qr_refresh_rate_seconds > 15;
alter table public.attendance_sessions
  drop constraint if exists attendance_sessions_qr_refresh_rate_check;
alter table public.attendance_sessions
  add constraint attendance_sessions_qr_refresh_rate_check
  check (qr_refresh_rate_seconds between 10 and 15);

create table if not exists public.attendance_checkin_challenges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_checkin_challenges_expiry_check check (expires_at > created_at)
);

create index if not exists attendance_challenges_student_session_idx
  on public.attendance_checkin_challenges (student_id, session_id, expires_at desc);
create index if not exists attendance_challenges_expiry_idx
  on public.attendance_checkin_challenges (expires_at)
  where consumed_at is null;
create index if not exists attendance_sessions_course_id_idx
  on public.attendance_sessions (course_id);
create index if not exists attendance_sessions_opened_by_idx
  on public.attendance_sessions (opened_by);
create index if not exists attendance_records_student_id_idx
  on public.attendance_records (student_id);
create index if not exists enrollments_student_id_idx
  on public.enrollments (student_id);
create index if not exists courses_teacher_id_idx
  on public.courses (teacher_id);

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function private.owns_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses
    where id = target_course_id and teacher_id = (select auth.uid())
  );
$$;

create or replace function private.owns_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_sessions
    where id = target_session_id and opened_by = (select auth.uid())
  );
$$;

revoke all on function private.current_profile_role() from public, anon;
revoke all on function private.owns_course(uuid) from public, anon;
revoke all on function private.owns_session(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_profile_role() to authenticated;
grant execute on function private.owns_course(uuid) to authenticated;
grant execute on function private.owns_session(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(coalesce(new.email, ''));
  invite public.profile_invites%rowtype;
  derived_role text;
  derived_student_id text;
begin
  if normalized_email !~ '^[^@]+@([a-z0-9-]+\.)*kmutnb\.ac\.th$' then
    raise exception 'อนุญาตให้ใช้งานเฉพาะบัญชี Google ของ KMUTNB เท่านั้น';
  end if;

  select * into invite
  from public.profile_invites
  where lower(email) = normalized_email and claimed_at is null
  order by created_at desc
  limit 1;

  if found then
    derived_role := invite.role;
    derived_student_id := invite.student_id;
  elsif normalized_email like '%@email.kmutnb.ac.th' then
    derived_role := 'student';
    derived_student_id := substring(normalized_email from '^s?([0-9]{13})@');
  else
    derived_role := 'teacher';
    derived_student_id := null;
  end if;

  insert into public.profiles (id, email, full_name, student_id, role)
  values (
    new.id,
    normalized_email,
    coalesce(nullif(invite.full_name, ''), new.raw_user_meta_data->>'full_name', 'KMUTNB User'),
    derived_student_id,
    derived_role
  );

  if invite.id is not null then
    update public.profile_invites set claimed_at = now() where id = invite.id;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_checkin_challenges enable row level security;
alter table public.profile_invites enable row level security;
alter table public.audit_logs enable row level security;

do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles', 'courses', 'enrollments', 'attendance_sessions',
        'attendance_records', 'attendance_checkin_challenges',
        'profile_invites', 'audit_logs'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end $$;

create policy profiles_select_own_or_admin
on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.current_profile_role() = 'admin');

create policy courses_select_authorized
on public.courses for select to authenticated
using (
  teacher_id = (select auth.uid())
  or private.current_profile_role() = 'admin'
  or exists (
    select 1 from public.enrollments e
    where e.course_id = courses.id and e.student_id = (select auth.uid())
  )
);

create policy enrollments_select_authorized
on public.enrollments for select to authenticated
using (
  student_id = (select auth.uid())
  or private.current_profile_role() = 'admin'
  or private.owns_course(course_id)
);

create policy sessions_select_authorized
on public.attendance_sessions for select to authenticated
using (
  opened_by = (select auth.uid())
  or private.current_profile_role() = 'admin'
  or exists (
    select 1 from public.enrollments e
    where e.course_id = attendance_sessions.course_id
      and e.student_id = (select auth.uid())
  )
);

create policy records_select_authorized
on public.attendance_records for select to authenticated
using (
  student_id = (select auth.uid())
  or private.current_profile_role() = 'admin'
  or private.owns_session(session_id)
);

create policy profile_invites_admin_select
on public.profile_invites for select to authenticated
using (private.current_profile_role() = 'admin');

create policy audit_logs_admin_select
on public.audit_logs for select to authenticated
using (private.current_profile_role() = 'admin');

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on public.profiles, public.courses, public.enrollments,
  public.attendance_sessions, public.attendance_records,
  public.profile_invites, public.audit_logs to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attendance_records'
  ) then
    alter publication supabase_realtime add table public.attendance_records;
  end if;
end $$;

