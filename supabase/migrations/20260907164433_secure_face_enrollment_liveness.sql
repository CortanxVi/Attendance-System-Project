-- Require a short-lived, account-bound and one-use liveness challenge before
-- a student may replace the face embedding used for attendance. Administrators
-- retain the separate supervised enrollment path in the backend.

create table if not exists public.face_enrollment_challenges (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references public.profiles(id) on delete cascade,
  student_id text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  processing_at timestamptz,
  processing_token uuid,
  created_at timestamptz not null default now(),
  constraint face_enrollment_challenges_expiry_check check (expires_at > created_at)
);

create index if not exists face_enrollment_challenges_user_expiry_idx
  on public.face_enrollment_challenges (student_user_id, expires_at desc);
create unique index if not exists face_enrollment_challenges_one_pending_per_user_idx
  on public.face_enrollment_challenges (student_user_id)
  where consumed_at is null;
create index if not exists face_enrollment_challenges_cleanup_idx
  on public.face_enrollment_challenges (expires_at)
  where consumed_at is null;

alter table public.face_enrollment_challenges enable row level security;
revoke all on table public.face_enrollment_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.face_enrollment_challenges to service_role;

create or replace function public.claim_face_enrollment_challenge(
  target_challenge_id uuid,
  target_user_id uuid,
  claim_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed_id uuid;
  challenge_row public.face_enrollment_challenges%rowtype;
begin
  if claim_token is null then
    raise exception 'claim token is required' using errcode = '22023';
  end if;

  update public.face_enrollment_challenges challenge
  set processing_at = now(), processing_token = claim_token
  where challenge.id = target_challenge_id
    and challenge.student_user_id = target_user_id
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

  select challenge.* into challenge_row
  from public.face_enrollment_challenges challenge
  where challenge.id = target_challenge_id
    and challenge.student_user_id = target_user_id;

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

create or replace function public.release_face_enrollment_challenge(
  target_challenge_id uuid,
  target_user_id uuid,
  claim_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with released as (
    update public.face_enrollment_challenges challenge
    set processing_at = null, processing_token = null
    where challenge.id = target_challenge_id
      and challenge.student_user_id = target_user_id
      and challenge.processing_token = claim_token
      and challenge.consumed_at is null
    returning 1
  )
  select exists (select 1 from released);
$$;

create or replace function public.renew_face_enrollment_challenge(
  target_challenge_id uuid,
  target_user_id uuid,
  claim_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with renewed as (
    update public.face_enrollment_challenges challenge
    set processing_at = now()
    where challenge.id = target_challenge_id
      and challenge.student_user_id = target_user_id
      and challenge.processing_token = claim_token
      and challenge.consumed_at is null
      and challenge.expires_at > now()
    returning 1
  )
  select exists (select 1 from renewed);
$$;

create or replace function public.finalize_face_enrollment(
  target_challenge_id uuid,
  target_user_id uuid,
  target_student_id text,
  target_embedding text,
  claim_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  challenge_row public.face_enrollment_challenges%rowtype;
  updated_profile_id uuid;
begin
  if target_student_id is null
     or target_student_id !~ '^[0-9]{13}$'
     or claim_token is null
     or target_embedding is null
     or length(target_embedding) > 20000 then
    raise exception 'invalid face enrollment input' using errcode = '22023';
  end if;

  select challenge.* into challenge_row
  from public.face_enrollment_challenges challenge
  where challenge.id = target_challenge_id
    and challenge.student_user_id = target_user_id
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
  if challenge_row.student_id <> target_student_id
     or challenge_row.processing_token is distinct from claim_token then
    return jsonb_build_object('result', 'claim_invalid');
  end if;

  update public.profiles profile
  set face_registered = true,
      face_embedding = target_embedding::extensions.vector(512)
  where profile.id = target_user_id
    and profile.student_id = target_student_id
    and coalesce(profile.face_registered, false) = false
  returning profile.id into updated_profile_id;

  if updated_profile_id is null then
    if exists (
      select 1 from public.profiles profile
      where profile.id = target_user_id
        and profile.student_id = target_student_id
        and coalesce(profile.face_registered, false) = true
    ) then
      return jsonb_build_object('result', 'already_registered');
    end if;
    return jsonb_build_object('result', 'profile_missing');
  end if;

  update public.face_enrollment_challenges
  set consumed_at = now(), processing_at = null, processing_token = null
  where id = target_challenge_id;

  return jsonb_build_object('result', 'registered');
end;
$$;

revoke all on function public.claim_face_enrollment_challenge(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.release_face_enrollment_challenge(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.renew_face_enrollment_challenge(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_face_enrollment(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_face_enrollment_challenge(uuid, uuid, uuid)
  to service_role;
grant execute on function public.release_face_enrollment_challenge(uuid, uuid, uuid)
  to service_role;
grant execute on function public.renew_face_enrollment_challenge(uuid, uuid, uuid)
  to service_role;
grant execute on function public.finalize_face_enrollment(uuid, uuid, text, text, uuid)
  to service_role;
