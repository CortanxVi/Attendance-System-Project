-- Keep the backend-only boundary explicit for operators and the database linter.
create policy "deny browser access to course join codes"
on public.course_join_codes
for all to anon, authenticated
using (false)
with check (false);

create policy "deny browser access to course join requests"
on public.course_join_requests
for all to anon, authenticated
using (false)
with check (false);
