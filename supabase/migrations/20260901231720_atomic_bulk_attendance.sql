-- Apply a teacher's bulk attendance edit as one all-or-nothing transaction.
-- The function is backend-only and repeats ownership/enrollment checks in SQL.

create or replace function public.bulk_set_attendance_status(
  target_session_id uuid,
  actor_id uuid,
  student_numbers jsonb,
  new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_course_id uuid;
  requested_count integer;
  matched_count integer;
  affected_count integer;
begin
  if new_status not in ('present', 'late', 'absent') then
    raise exception 'invalid attendance status' using errcode = '22023';
  end if;
  if jsonb_typeof(student_numbers) <> 'array' then
    raise exception 'student_numbers must be an array' using errcode = '22023';
  end if;

  requested_count := jsonb_array_length(student_numbers);
  if requested_count < 1 or requested_count > 1000 then
    raise exception 'student count must be between 1 and 1000' using errcode = '22023';
  end if;
  if requested_count <> (
    select count(distinct value)
    from jsonb_array_elements_text(student_numbers)
  ) then
    raise exception 'student_numbers contains duplicates' using errcode = '22023';
  end if;

  select s.course_id
  into target_course_id
  from public.attendance_sessions s
  left join public.profiles actor on actor.id = actor_id
  where s.id = target_session_id
    and (s.opened_by = actor_id or actor.role = 'admin');

  if target_course_id is null then
    raise exception 'not authorized to manage this session' using errcode = '42501';
  end if;

  select count(*)
  into matched_count
  from (
    select distinct p.id
    from jsonb_array_elements_text(student_numbers) requested(student_number)
    join public.profiles p
      on p.student_id = requested.student_number
     and p.role = 'student'
    join public.enrollments e
      on e.student_id = p.id
     and e.course_id = target_course_id
  ) matched;

  if matched_count <> requested_count then
    raise exception 'one or more students are not enrolled in this course' using errcode = '23503';
  end if;

  insert into public.attendance_records (session_id, student_id, status, method)
  select target_session_id, p.id, new_status, 'manual'
  from jsonb_array_elements_text(student_numbers) requested(student_number)
  join public.profiles p on p.student_id = requested.student_number
  join public.enrollments e
    on e.student_id = p.id
   and e.course_id = target_course_id
  on conflict (session_id, student_id) do update
    set status = excluded.status,
        method = 'manual';

  get diagnostics affected_count = row_count;
  return jsonb_build_object('updated', affected_count);
end;
$$;

revoke all on function public.bulk_set_attendance_status(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.bulk_set_attendance_status(uuid, uuid, jsonb, text)
  to service_role;
