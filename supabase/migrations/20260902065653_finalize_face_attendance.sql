-- Finalize face/OCR attendance and consume its QR challenge in one transaction.
-- Expensive image/OCR checks happen before this function; all mutable state is
-- revalidated and written atomically here to prevent races and burnt retries.

create or replace function public.finalize_face_attendance(
  target_challenge_id uuid,
  target_student_id uuid,
  target_session_id uuid,
  attendance_status text,
  face_similarity real,
  checked_in_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  challenge_row public.attendance_checkin_challenges%rowtype;
  target_course_id uuid;
  created_record_id uuid;
begin
  if attendance_status not in ('present', 'late', 'absent')
     or face_similarity is null
     or face_similarity < -1
     or face_similarity > 1
     or checked_in_at is null then
    raise exception 'invalid attendance finalization input' using errcode = '22023';
  end if;

  select challenge.*
  into challenge_row
  from public.attendance_checkin_challenges challenge
  where challenge.id = target_challenge_id
    and challenge.student_id = target_student_id
  for update;

  if not found then
    return jsonb_build_object('result', 'challenge_invalid');
  end if;
  if challenge_row.consumed_at is not null then
    return jsonb_build_object('result', 'challenge_used');
  end if;
  if challenge_row.expires_at <= now() then
    return jsonb_build_object('result', 'challenge_expired');
  end if;
  if challenge_row.session_id <> target_session_id then
    return jsonb_build_object('result', 'challenge_invalid');
  end if;

  select session.course_id
  into target_course_id
  from public.attendance_sessions session
  where session.id = target_session_id
    and session.status = 'open';

  if target_course_id is null then
    return jsonb_build_object('result', 'session_closed');
  end if;
  if not exists (
    select 1
    from public.enrollments enrollment
    where enrollment.course_id = target_course_id
      and enrollment.student_id = target_student_id
  ) then
    return jsonb_build_object('result', 'not_enrolled');
  end if;

  insert into public.attendance_records (
    session_id,
    student_id,
    check_in_time,
    status,
    method,
    similarity_score
  )
  values (
    target_session_id,
    target_student_id,
    checked_in_at,
    attendance_status,
    'face_ocr',
    face_similarity
  )
  on conflict (session_id, student_id) do nothing
  returning id into created_record_id;

  if created_record_id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;

  update public.attendance_checkin_challenges
  set consumed_at = checked_in_at
  where id = target_challenge_id;

  return jsonb_build_object(
    'result', 'created',
    'record_id', created_record_id
  );
end;
$$;

revoke all on function public.finalize_face_attendance(
  uuid, uuid, uuid, text, real, timestamptz
) from public, anon, authenticated;
grant execute on function public.finalize_face_attendance(
  uuid, uuid, uuid, text, real, timestamptz
) to service_role;
