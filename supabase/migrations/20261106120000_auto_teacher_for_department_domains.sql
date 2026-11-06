-- Automatic teacher role for department mailboxes.
--
-- Mailbox shapes at KMUTNB:
--   student  s<13-digit id>@email.kmutnb.ac.th
--   teacher  <name>@<department>.kmutnb.ac.th   (cit, eng, ... may change)
--
-- Sign-in decision order (first match wins):
--   1. not a *.kmutnb.ac.th address              -> rejected
--   2. an unclaimed invitation exists            -> role from the invitation
--      (this is how admin accounts are provisioned, and how pending roster
--      students are linked)
--   3. @email.kmutnb.ac.th                       -> student
--   4. <name>@<subdomain>.kmutnb.ac.th           -> teacher, unless the local
--      part looks like a student id or the subdomain is in
--      public.teacher_domain_exclusions
--   5. anything else (e.g. name@kmutnb.ac.th)    -> rejected, invitation needed
--
-- The admin role is NEVER derived from an email address. The database owner
-- grants it with an invitation or a direct profiles update.

create table if not exists public.teacher_domain_exclusions (
  subdomain text primary key
    check (
      subdomain = lower(subdomain)
      and subdomain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*$'
    ),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);

alter table public.teacher_domain_exclusions enable row level security;
revoke all on public.teacher_domain_exclusions from public, anon, authenticated;

create policy "deny browser access to teacher domain exclusions"
on public.teacher_domain_exclusions
for all to anon, authenticated
using (false)
with check (false);

-- The student mailbox subdomain must never be treated as a department.
insert into public.teacher_domain_exclusions (subdomain, note)
values ('email', 'Student mailbox domain')
on conflict (subdomain) do nothing;

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
  invite public.profile_invites%rowtype;
  derived_role text;
  derived_student_id text;
begin
  if normalized_email !~ '^[^@]+@([a-z0-9-]+\.)*kmutnb\.ac\.th$' then
    raise exception 'อนุญาตให้ใช้งานเฉพาะบัญชี Google ของ KMUTNB เท่านั้น';
  end if;

  email_local := split_part(normalized_email, '@', 1);
  -- Empty string when the address is on the bare kmutnb.ac.th domain.
  email_subdomain := regexp_replace(
    split_part(normalized_email, '@', 2), '(^|\.)kmutnb\.ac\.th$', ''
  );

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
