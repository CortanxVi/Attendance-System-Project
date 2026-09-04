-- Scope idempotency tokens to the actor/resource that owns the retry.
alter table public.student_support_requests
  drop constraint if exists student_support_requests_client_token_key;

alter table public.student_support_messages
  drop constraint if exists student_support_messages_client_token_key;

create unique index student_support_requests_student_client_token_idx
  on public.student_support_requests (student_id, client_token);

create unique index student_support_messages_request_client_token_idx
  on public.student_support_messages (request_id, client_token);

-- This RESTRICTIVE policy keeps this private bucket backend-only even if a
-- separately managed permissive policy grants browser roles access elsewhere.
-- The backend service-role client bypasses RLS after checking participants.
create policy "backend only student request files"
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id <> 'student-request-files')
with check (bucket_id <> 'student-request-files');
