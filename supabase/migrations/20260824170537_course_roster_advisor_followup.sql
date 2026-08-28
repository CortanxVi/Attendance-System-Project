drop index if exists public.enrollments_course_student_key;

create policy profile_invite_courses_no_direct_select
on public.profile_invite_courses
for select
to authenticated
using (false);
