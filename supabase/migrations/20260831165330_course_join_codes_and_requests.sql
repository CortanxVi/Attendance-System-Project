-- Course join codes are capability tokens. Keep both tables backend-only;
-- authenticated browser clients must use the FastAPI authorization layer.
create table public.course_join_codes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null unique references public.courses(id) on delete cascade,
  join_code text not null unique,
  is_active boolean not null default true,
  expires_at timestamptz,
  usage_count integer not null default 0 check (usage_count >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  constraint course_join_codes_format_check
    check (join_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  constraint course_join_codes_expiry_check
    check (expires_at is null or expires_at > created_at)
);

create index course_join_codes_active_expiry_idx
  on public.course_join_codes (is_active, expires_at)
  where is_active;

create table public.course_join_requests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  join_code_id uuid references public.course_join_codes(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  updated_at timestamptz not null default now(),
  constraint course_join_requests_course_student_key unique (course_id, student_id),
  constraint course_join_requests_review_state_check check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status = 'cancelled' and reviewed_at is null and reviewed_by is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
  )
);

create index course_join_requests_course_status_requested_idx
  on public.course_join_requests (course_id, status, requested_at desc);
create index course_join_requests_student_updated_idx
  on public.course_join_requests (student_id, updated_at desc);
create index course_join_requests_join_code_id_idx
  on public.course_join_requests (join_code_id)
  where join_code_id is not null;
create index course_join_requests_reviewed_by_idx
  on public.course_join_requests (reviewed_by)
  where reviewed_by is not null;

alter table public.course_join_codes enable row level security;
alter table public.course_join_requests enable row level security;
revoke all on public.course_join_codes from public, anon, authenticated;
revoke all on public.course_join_requests from public, anon, authenticated;

-- The backend calls this service-role-only function after it has authenticated
-- the reviewer. The function repeats ownership checks and performs approval plus
-- enrollment in one short transaction.
create or replace function public.review_course_join_request(
  target_request_id uuid,
  reviewer_id uuid,
  decision text,
  reviewer_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.course_join_requests%rowtype;
  course_teacher_id uuid;
  reviewer_role text;
begin
  if decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid review decision';
  end if;

  if reviewer_note is not null and char_length(reviewer_note) > 500 then
    raise exception using errcode = '22001', message = 'review note is too long';
  end if;

  select * into request_row
  from public.course_join_requests
  where id = target_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'join request not found';
  end if;

  select teacher_id into course_teacher_id
  from public.courses
  where id = request_row.course_id;

  select role into reviewer_role
  from public.profiles
  where id = reviewer_id;

  if reviewer_role is null
     or (reviewer_role <> 'admin' and course_teacher_id is distinct from reviewer_id) then
    raise exception using errcode = '42501', message = 'reviewer cannot manage this course';
  end if;

  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'join request is not pending';
  end if;

  if decision = 'approved' then
    insert into public.enrollments (course_id, student_id)
    values (request_row.course_id, request_row.student_id)
    on conflict (course_id, student_id) do nothing;

    if request_row.join_code_id is not null then
      update public.course_join_codes
      set usage_count = usage_count + 1
      where id = request_row.join_code_id;
    end if;
  end if;

  update public.course_join_requests
  set status = decision,
      reviewed_at = now(),
      reviewed_by = reviewer_id,
      review_note = nullif(btrim(reviewer_note), ''),
      updated_at = now()
  where id = target_request_id;

  insert into public.audit_logs (
    admin_id, action, target_type, target_id, details
  ) values (
    reviewer_id,
    case when decision = 'approved'
      then 'COURSE_JOIN_REQUEST_APPROVED'
      else 'COURSE_JOIN_REQUEST_REJECTED'
    end,
    'course_join_request',
    target_request_id::text,
    jsonb_build_object(
      'course_id', request_row.course_id,
      'student_id', request_row.student_id
    )
  );

  return jsonb_build_object(
    'request_id', target_request_id,
    'course_id', request_row.course_id,
    'student_id', request_row.student_id,
    'status', decision
  );
end;
$$;

revoke all on function public.review_course_join_request(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_course_join_request(uuid, uuid, text, text)
  to service_role;
