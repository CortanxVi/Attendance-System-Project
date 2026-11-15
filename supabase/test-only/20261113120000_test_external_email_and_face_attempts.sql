-- TEST-ONLY features. Apply this migration to a TEST Supabase project, not to production.
--
-- 1. public.test_mode_flags: a switch table. With allow_external_email = false (the
--    default) sign-in works exactly like before; the owner turns it on with one UPDATE
--    while testing and off again afterwards.
-- 2. public.handle_new_user(): unchanged rules for university e-mail addresses. When the
--    switch is on, any other well-formed e-mail may sign in and becomes a student with a
--    placeholder student id '0000' + nine digits from a sequence (13 digits, unique, and
--    clearly not a real id). Unclaimed invitations still win over everything else.
-- 3. public.face_checkin_attempts: one row per face check-in attempt of a test course,
--    with the similarity score and, for failures, the stage and the reason shown to the
--    user. It stores no images, no embeddings, no names and no e-mail addresses.

create table if not exists public.test_mode_flags (
  key text primary key check (key ~ '^[a-z_]{1,64}$'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.test_mode_flags enable row level security;
revoke all on public.test_mode_flags from public, anon, authenticated;

create policy "deny browser access to test mode flags"
on public.test_mode_flags
for all to anon, authenticated
using (false)
with check (false);

insert into public.test_mode_flags (key, enabled)
values ('allow_external_email', false)
on conflict (key) do nothing;

create sequence if not exists public.test_student_id_seq
  as bigint minvalue 1 maxvalue 999999999 start 1 no cycle;
revoke all on sequence public.test_student_id_seq from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(coalesce(new.email, ''));
  email_local text;
  email_subdomain text;
  is_university boolean;
  external_allowed boolean;
  invite public.profile_invites%rowtype;
  derived_role text;
  derived_student_id text;
begin
  is_university := normalized_email ~ '^[^@]+@([a-z0-9-]+\.)*kmutnb\.ac\.th$';

  select coalesce(bool_or(enabled), false)
  into external_allowed
  from public.test_mode_flags
  where key = 'allow_external_email';

  if not is_university
     and not (external_allowed and normalized_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'อนุญาตให้ใช้งานเฉพาะบัญชี Google ของ KMUTNB เท่านั้น';
  end if;

  email_local := split_part(normalized_email, '@', 1);
  -- Empty string when the address is on the bare kmutnb.ac.th domain or is external.
  email_subdomain := case
    when is_university then regexp_replace(
      split_part(normalized_email, '@', 2), '(^|\.)kmutnb\.ac\.th$', ''
    )
    else ''
  end;

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
  elsif not is_university then
    -- Only reachable when allow_external_email is on (checked above).
    derived_role := 'student';
    derived_student_id := '0000' || lpad(nextval('public.test_student_id_seq')::text, 9, '0');
  elsif email_subdomain <> ''
        and email_local !~ '^s?[0-9]{13}$'
        and not exists (
          select 1
          from public.teacher_domain_exclusions excluded
          where email_subdomain = excluded.subdomain
             or email_subdomain like '%.' || excluded.subdomain
        ) then
    derived_role := 'teacher';
    derived_student_id := null;
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

create table if not exists public.face_checkin_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  session_id uuid references public.attendance_sessions(id) on delete set null,
  outcome text not null check (outcome in ('success', 'failed')),
  attendance_status text check (attendance_status in ('present', 'late', 'absent')),
  similarity_score real,
  threshold_used real,
  liveness_action text check (liveness_action in ('blink', 'move_closer')),
  failure_stage text check (failure_stage is null or char_length(failure_stage) <= 40),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  app_version text check (app_version is null or char_length(app_version) <= 80),
  constraint face_checkin_attempts_outcome_shape check (
    (outcome = 'success'
      and failure_stage is null and failure_reason is null
      and attendance_status is not null and similarity_score is not null)
    or
    (outcome = 'failed'
      and failure_reason is not null and attendance_status is null)
  )
);

create index if not exists face_checkin_attempts_student_created_idx
  on public.face_checkin_attempts (student_id, created_at desc);
create index if not exists face_checkin_attempts_course_created_idx
  on public.face_checkin_attempts (course_id, created_at desc);
create index if not exists face_checkin_attempts_outcome_created_idx
  on public.face_checkin_attempts (outcome, created_at desc);

alter table public.face_checkin_attempts enable row level security;
revoke all on public.face_checkin_attempts from public, anon, authenticated;

create policy "deny browser access to face check-in attempts"
on public.face_checkin_attempts
for all to anon, authenticated
using (false)
with check (false);
