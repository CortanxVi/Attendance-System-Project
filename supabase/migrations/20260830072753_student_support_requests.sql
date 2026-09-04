-- Private student-to-teacher support requests and message attachments.
-- The browser has no direct table or Storage access: the FastAPI backend uses
-- the service role after checking that the caller is the enrolled student or
-- the teacher who owns the selected course.

create table public.student_support_requests (
  id uuid primary key default gen_random_uuid(),
  client_token uuid not null unique,
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 3 and 160),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index student_support_requests_student_activity_idx
  on public.student_support_requests (student_id, last_message_at desc);
create index student_support_requests_teacher_activity_idx
  on public.student_support_requests (teacher_id, last_message_at desc);
create index student_support_requests_course_idx
  on public.student_support_requests (course_id);

create table public.student_support_messages (
  id uuid primary key default gen_random_uuid(),
  client_token uuid not null unique,
  request_id uuid not null references public.student_support_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text check (body is null or char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index student_support_messages_request_created_idx
  on public.student_support_messages (request_id, created_at);
create index student_support_messages_sender_idx
  on public.student_support_messages (sender_id);

create table public.student_support_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.student_support_messages(id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) between 10 and 500),
  original_name text not null check (char_length(original_name) between 1 and 255),
  content_type text not null check (
    content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);

create index student_support_attachments_message_idx
  on public.student_support_attachments (message_id);

create or replace function public.touch_student_support_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.student_support_requests
  set updated_at = now(), last_message_at = new.created_at
  where id = new.request_id;
  return new;
end;
$$;

create trigger student_support_message_touch_request
after insert on public.student_support_messages
for each row execute function public.touch_student_support_request();

alter table public.student_support_requests enable row level security;
alter table public.student_support_messages enable row level security;
alter table public.student_support_attachments enable row level security;

revoke all on public.student_support_requests from public, anon, authenticated;
revoke all on public.student_support_messages from public, anon, authenticated;
revoke all on public.student_support_attachments from public, anon, authenticated;
revoke all on function public.touch_student_support_request() from public, anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'student-request-files',
  'student-request-files',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
