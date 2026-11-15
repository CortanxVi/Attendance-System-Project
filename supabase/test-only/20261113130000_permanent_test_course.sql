-- TEST-ONLY. Apply to the separate TEST Supabase project, never to production.
--
-- The permanent test course used for all system testing:
--   code 030513702, name "Select Topic React", section 1, semester 1.
-- Idempotent: an existing row is kept as it is and only created when missing.
-- After (re)creating the database, put the course's UUID in STAGING_TEST_DB_COURSE_IDS
-- of the private settings file (the Backend only treats listed course UUIDs as test courses).

insert into public.courses (course_code, course_name, section, year, semester, total_sessions)
select '030513702', 'Select Topic React', 1, 2569, 1, 15
where not exists (
  select 1 from public.courses where course_code = '030513702' and section = 1
);

-- Students who registered a face before this course existed join it too (idempotent).
insert into public.enrollments (course_id, student_id)
select c.id, p.id
from public.courses c
join public.profiles p on p.role = 'student' and p.face_registered
where c.course_code = '030513702' and c.section = 1
on conflict (course_id, student_id) do nothing;

-- Guard: the permanent test course cannot be deleted by accident.
-- To remove it deliberately: alter table public.courses disable trigger protect_permanent_test_course;
create or replace function public.protect_permanent_test_course()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.course_code = '030513702' and old.section = 1 then
    raise exception 'รายวิชา 030513702 เป็นวิชาทดสอบถาวร ลบไม่ได้';
  end if;
  return old;
end;
$$;
revoke all on function public.protect_permanent_test_course() from public, anon, authenticated;

drop trigger if exists protect_permanent_test_course on public.courses;
create trigger protect_permanent_test_course
before delete on public.courses
for each row execute function public.protect_permanent_test_course();
