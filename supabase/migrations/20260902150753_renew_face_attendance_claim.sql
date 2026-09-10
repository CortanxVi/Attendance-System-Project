-- Keep an active verification lease alive while OCR and face inference are
-- queued. Only the backend process holding the unguessable claim token can renew.

create or replace function public.renew_face_attendance_challenge(
  target_challenge_id uuid,
  target_student_id uuid,
  claim_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with renewed as (
    update public.attendance_checkin_challenges challenge
    set processing_at = now()
    where challenge.id = target_challenge_id
      and challenge.student_id = target_student_id
      and challenge.processing_token = claim_token
      and challenge.consumed_at is null
      and challenge.expires_at > now()
    returning 1
  )
  select exists (select 1 from renewed);
$$;

revoke all on function public.renew_face_attendance_challenge(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.renew_face_attendance_challenge(uuid, uuid, uuid)
  to service_role;
