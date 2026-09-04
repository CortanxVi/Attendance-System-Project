-- Add a renewable processing lease so duplicate requests cannot consume OCR
-- and face-inference capacity for the same QR challenge at the same time.

alter table public.attendance_checkin_challenges
  add column if not exists processing_at timestamptz,
  add column if not exists processing_token uuid;

create or replace function public.claim_face_attendance_challenge(
  target_challenge_id uuid,
  target_student_id uuid,
  claim_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed_id uuid;
  challenge_row public.attendance_checkin_challenges%rowtype;
begin
  if claim_token is null then
    raise exception 'claim token is required' using errcode = '22023';
  end if;

  update public.attendance_checkin_challenges challenge
  set processing_at = now(),
      processing_token = claim_token
  where challenge.id = target_challenge_id
    and challenge.student_id = target_student_id
    and challenge.consumed_at is null
    and challenge.expires_at > now()
    and (
      challenge.processing_at is null
      or challenge.processing_at < now() - interval '60 seconds'
    )
  returning challenge.id into claimed_id;

  if claimed_id is not null then
    return jsonb_build_object('result', 'claimed');
  end if;

  select challenge.*
  into challenge_row
  from public.attendance_checkin_challenges challenge
  where challenge.id = target_challenge_id
    and challenge.student_id = target_student_id;

  if not found then
    return jsonb_build_object('result', 'challenge_invalid');
  end if;
  if challenge_row.consumed_at is not null then
    return jsonb_build_object('result', 'challenge_used');
  end if;
  if challenge_row.expires_at <= now() then
    return jsonb_build_object('result', 'challenge_expired');
  end if;
  return jsonb_build_object('result', 'challenge_busy');
end;
$$;

create or replace function public.release_face_attendance_challenge(
  target_challenge_id uuid,
  target_student_id uuid,
  claim_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with released as (
    update public.attendance_checkin_challenges challenge
    set processing_at = null,
        processing_token = null
    where challenge.id = target_challenge_id
      and challenge.student_id = target_student_id
      and challenge.processing_token = claim_token
      and challenge.consumed_at is null
    returning 1
  )
  select exists (select 1 from released);
$$;

create or replace function public.finalize_face_attendance(
  target_challenge_id uuid,
  target_student_id uuid,
  target_session_id uuid,
  attendance_status text,
  face_similarity real,
  checked_in_at timestamptz,
  claim_token uuid
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
     or checked_in_at is null
     or claim_token is null then
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
  if challenge_row.processing_token is distinct from claim_token then
    return jsonb_build_object('result', 'claim_invalid');
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
  set consumed_at = checked_in_at,
      processing_at = null,
      processing_token = null
  where id = target_challenge_id;

  return jsonb_build_object('result', 'created', 'record_id', created_record_id);
end;
$$;

drop function if exists public.finalize_face_attendance(
  uuid, uuid, uuid, text, real, timestamptz
);

revoke all on function public.claim_face_attendance_challenge(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.release_face_attendance_challenge(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_face_attendance(
  uuid, uuid, uuid, text, real, timestamptz, uuid
) from public, anon, authenticated;

grant execute on function public.claim_face_attendance_challenge(uuid, uuid, uuid)
  to service_role;
grant execute on function public.release_face_attendance_challenge(uuid, uuid, uuid)
  to service_role;
grant execute on function public.finalize_face_attendance(
  uuid, uuid, uuid, text, real, timestamptz, uuid
) to service_role;
