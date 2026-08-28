-- Fail closed for privileged account provisioning. Students may self-provision
-- from the dedicated student domain; teacher/admin accounts require an
-- unclaimed invitation created through the protected admin API.
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

  if derived_role = 'student' and derived_student_id !~ '^[0-9]{13}$' then
    raise exception 'บัญชีนักศึกษาต้องมีรหัสนักศึกษา 13 หลัก';
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
