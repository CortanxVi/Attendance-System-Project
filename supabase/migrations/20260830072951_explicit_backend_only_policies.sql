-- Make the backend-only boundary explicit to both readers and Supabase's
-- database advisor. FastAPI is the sole access path and re-checks participants.

create policy "deny browser access to support requests"
on public.student_support_requests
for all to anon, authenticated
using (false)
with check (false);

create policy "deny browser access to support messages"
on public.student_support_messages
for all to anon, authenticated
using (false)
with check (false);

create policy "deny browser access to support attachments"
on public.student_support_attachments
for all to anon, authenticated
using (false)
with check (false);

create policy "deny browser access to temporary admin requests"
on public.temporary_admin_requests
for all to anon, authenticated
using (false)
with check (false);

create policy "deny browser access to temporary admin enrollments"
on public.temporary_admin_enrollments
for all to anon, authenticated
using (false)
with check (false);

create policy "deny browser access to temporary admin grants"
on public.temporary_admin_grants
for all to anon, authenticated
using (false)
with check (false);
