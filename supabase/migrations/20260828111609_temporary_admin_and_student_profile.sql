-- Temporary teacher-to-admin elevation and student academic profile fields.
-- All temporary-admin secrets are backend-only. The browser never receives
-- direct table privileges and a teacher's permanent profile role is unchanged.

alter table public.profiles
  add column if not exists academic_year smallint,
  add column if not exists class_level text;

alter table public.profile_invites
  add column if not exists academic_year smallint,
  add column if not exists class_level text;

alter table public.profiles
  drop constraint if exists profiles_academic_year_check,
  add constraint profiles_academic_year_check
    check (academic_year is null or academic_year between 1 and 8),
  drop constraint if exists profiles_class_level_check,
  add constraint profiles_class_level_check
    check (class_level is null or char_length(class_level) between 1 and 50);

alter table public.profile_invites
  drop constraint if exists profile_invites_academic_year_check,
  add constraint profile_invites_academic_year_check
    check (academic_year is null or academic_year between 1 and 8),
  drop constraint if exists profile_invites_class_level_check,
  add constraint profile_invites_class_level_check
    check (class_level is null or char_length(class_level) between 1 and 50);

create table if not exists public.temporary_admin_requests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 500),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  enrollment_expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint temporary_admin_requests_review_state_check check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status = 'cancelled' and reviewed_by is null)
    or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

create unique index if not exists temporary_admin_requests_one_pending_per_teacher
  on public.temporary_admin_requests (teacher_id)
  where status = 'pending';
create index if not exists temporary_admin_requests_status_created_idx
  on public.temporary_admin_requests (status, created_at desc);
create index if not exists temporary_admin_requests_reviewed_by_idx
  on public.temporary_admin_requests (reviewed_by);

create table if not exists public.temporary_admin_enrollments (
  teacher_id uuid primary key references public.profiles(id) on delete cascade,
  approved_request_id uuid not null unique
    references public.temporary_admin_requests(id) on delete restrict,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  pin_hash text not null,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 20),
  locked_until timestamptz,
  last_failed_at timestamptz,
  last_used_at timestamptz,
  pin_changed_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists temporary_admin_enrollments_approved_by_idx
  on public.temporary_admin_enrollments (approved_by);
create index if not exists temporary_admin_enrollments_revoked_by_idx
  on public.temporary_admin_enrollments (revoked_by);

create table if not exists public.temporary_admin_grants (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  auth_session_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint temporary_admin_grants_expiry_check check (expires_at > created_at)
);

create index if not exists temporary_admin_grants_teacher_expiry_idx
  on public.temporary_admin_grants (teacher_id, expires_at desc);
create index if not exists temporary_admin_grants_expiry_idx
  on public.temporary_admin_grants (expires_at)
  where revoked_at is null;
create unique index if not exists temporary_admin_grants_one_active_per_teacher
  on public.temporary_admin_grants (teacher_id)
  where revoked_at is null;

alter table public.temporary_admin_requests enable row level security;
alter table public.temporary_admin_enrollments enable row level security;
alter table public.temporary_admin_grants enable row level security;

revoke all on public.temporary_admin_requests from public, anon, authenticated;
revoke all on public.temporary_admin_enrollments from public, anon, authenticated;
revoke all on public.temporary_admin_grants from public, anon, authenticated;

-- Keep account provisioning aligned with the new student profile fields.
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
    raise exception 'บัญชีอาจารย์หรือผู้ดูแลต้องได้รับคำเชิญจากผู้ดูแลระบบก่อน';
  end if;

  if derived_role = 'student'
     and (derived_student_id is null or derived_student_id !~ '^[0-9]{13}$') then
    raise exception 'บัญชีนักศึกษาต้องมีรหัสนักศึกษา 13 หลัก';
  end if;

  insert into public.profiles (
    id, email, full_name, student_id, role, academic_year, class_level
  ) values (
    new.id,
    normalized_email,
    coalesce(nullif(invite.full_name, ''), new.raw_user_meta_data->>'full_name', 'KMUTNB User'),
    derived_student_id,
    derived_role,
    invite.academic_year,
    invite.class_level
  );

  if invite.id is not null then
    insert into public.enrollments (course_id, student_id)
    select course_id, new.id
    from public.profile_invite_courses
    where invite_id = invite.id
    on conflict (course_id, student_id) do nothing;

    update public.profile_invites set claimed_at = now() where id = invite.id;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Increment PIN failures atomically so parallel guesses cannot bypass the lock counter.
create or replace function public.record_temporary_admin_pin_failure(
  target_teacher_id uuid,
  maximum_attempts integer,
  lock_duration_seconds integer
)
returns table (failed_attempts integer, locked_until timestamptz)
language sql
security definer
set search_path = ''
as $$
  update public.temporary_admin_enrollments
  set failed_attempts = least(
        temporary_admin_enrollments.failed_attempts + 1,
        maximum_attempts
      ),
      last_failed_at = now(),
      locked_until = case
        when temporary_admin_enrollments.failed_attempts + 1 >= maximum_attempts
          then now() + make_interval(secs => lock_duration_seconds)
        else temporary_admin_enrollments.locked_until
      end
  where teacher_id = target_teacher_id and revoked_at is null
  returning temporary_admin_enrollments.failed_attempts::integer, temporary_admin_enrollments.locked_until;
$$;

revoke all on function public.record_temporary_admin_pin_failure(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.record_temporary_admin_pin_failure(uuid, integer, integer) to service_role;
