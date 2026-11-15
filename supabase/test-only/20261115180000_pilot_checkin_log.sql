-- TEST-ONLY. Apply this migration to a TEST Supabase project, not to production.
-- Requires 20261113120000_test_external_email_and_face_attempts.sql (face_checkin_attempts,
-- test_mode_flags).
--
-- public.pilot_checkin_log: one row per face check-in attempt (passed AND failed) for the
-- 30-50 person pilot, readable as a plain spreadsheet:
--   who      user_id (profile uuid), email, student_code   (copied when the attempt happens)
--   where    course_id, course_code, session_id
--   result   outcome, attendance_status, similarity_score, threshold_used, face_match
--   why      liveness_action, failure_stage, failure_reason
--   order    attempt_no = the student's 1st, 2nd, 3rd ... attempt in this log
--
-- How rows get here: an AFTER INSERT trigger on face_checkin_attempts copies each new attempt.
-- The Backend is unchanged. A problem in this copy never blocks a check-in or the attempt row:
-- the trigger catches its own errors and only raises a warning.
--
-- Switch: test_mode_flags key 'pilot_checkin_log' (on after this migration).
--   update public.test_mode_flags set enabled = false, updated_at = now() where key = 'pilot_checkin_log';
--
-- PERSONAL DATA: this table holds e-mail addresses and student ids next to face scores.
-- Collect only from participants who agreed, and when the pilot ends delete it:
--   truncate public.pilot_checkin_log;            -- or: drop table public.pilot_checkin_log cascade;
-- Deleting a profile deletes that person's rows (on delete cascade).
-- No images, embeddings, names or diagnostics are copied.
--
-- Access: RLS on with a deny policy, no privileges for anon/authenticated; only the server role
-- (Supabase dashboard / SQL editor) can read it. Same for the summary view.

insert into public.test_mode_flags (key, enabled)
values ('pilot_checkin_log', true)
on conflict (key) do nothing;

create table if not exists public.pilot_checkin_log (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid unique references public.face_checkin_attempts(id) on delete set null,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null check (char_length(email) <= 320),
  student_code text check (student_code is null or char_length(student_code) <= 32),
  course_id uuid references public.courses(id) on delete set null,
  course_code text check (course_code is null or char_length(course_code) <= 64),
  session_id uuid references public.attendance_sessions(id) on delete set null,
  attempt_no integer not null check (attempt_no >= 1),
  outcome text not null check (outcome in ('success', 'failed')),
  attendance_status text check (attendance_status in ('present', 'late', 'absent')),
  similarity_score real,
  threshold_used real,
  -- True/false only when both numbers exist; null when the scan stopped before face matching.
  face_match boolean generated always as (similarity_score >= threshold_used) stored,
  liveness_action text check (liveness_action in ('blink', 'move_closer')),
  failure_stage text check (failure_stage is null or char_length(failure_stage) <= 40),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500)
);

create index if not exists pilot_checkin_log_user_created_idx
  on public.pilot_checkin_log (user_id, created_at);
create index if not exists pilot_checkin_log_created_idx
  on public.pilot_checkin_log (created_at desc);
create index if not exists pilot_checkin_log_course_id_idx
  on public.pilot_checkin_log (course_id);
create index if not exists pilot_checkin_log_session_id_idx
  on public.pilot_checkin_log (session_id);

alter table public.pilot_checkin_log enable row level security;
revoke all on public.pilot_checkin_log from public, anon, authenticated;

drop policy if exists "deny browser access to pilot check-in log" on public.pilot_checkin_log;
create policy "deny browser access to pilot check-in log"
on public.pilot_checkin_log
for all to anon, authenticated
using (false)
with check (false);

comment on table public.pilot_checkin_log is
  'TEST-ONLY pilot log: every face check-in attempt with e-mail, student id, score and failure reason. Personal data: delete after the pilot.';

create or replace function public.copy_face_attempt_to_pilot_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  logging_on boolean;
  person public.profiles%rowtype;
  next_attempt integer;
begin
  select coalesce(bool_or(flag.enabled), false)
  into logging_on
  from public.test_mode_flags flag
  where flag.key = 'pilot_checkin_log';
  if not logging_on then
    return new;
  end if;

  begin
    select * into person from public.profiles where id = new.student_id;
    if not found then
      return new;
    end if;

    -- Serialise per student so attempt_no stays 1, 2, 3 ... when two attempts arrive together.
    perform pg_advisory_xact_lock(hashtextextended(new.student_id::text, 0));
    select count(*)::integer + 1
    into next_attempt
    from public.pilot_checkin_log log
    where log.user_id = new.student_id;

    insert into public.pilot_checkin_log (
      attempt_id, created_at, user_id, email, student_code,
      course_id, course_code, session_id, attempt_no,
      outcome, attendance_status, similarity_score, threshold_used,
      liveness_action, failure_stage, failure_reason
    ) values (
      new.id, new.created_at, new.student_id, coalesce(person.email, ''), person.student_id,
      new.course_id,
      (select course.course_code from public.courses course where course.id = new.course_id),
      new.session_id, next_attempt,
      new.outcome, new.attendance_status, new.similarity_score, new.threshold_used,
      new.liveness_action, new.failure_stage, new.failure_reason
    )
    on conflict (attempt_id) do nothing;
  exception when others then
    -- Never block the attempt row (and so never the check-in) because of the pilot copy.
    raise warning 'pilot_checkin_log copy skipped (%)', sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.copy_face_attempt_to_pilot_log() from public, anon, authenticated;

drop trigger if exists face_checkin_attempts_copy_to_pilot_log on public.face_checkin_attempts;
create trigger face_checkin_attempts_copy_to_pilot_log
after insert on public.face_checkin_attempts
for each row execute function public.copy_face_attempt_to_pilot_log();

-- One row per participant: how many tries, how many passed, and the typical score.
create or replace view public.pilot_checkin_summary
with (security_invoker = true)
as
select
  log.user_id,
  max(log.email) as email,
  max(log.student_code) as student_code,
  count(*) as attempts,
  count(*) filter (where log.outcome = 'success') as successes,
  count(*) filter (where log.outcome = 'failed') as failures,
  bool_or(log.attempt_no = 1 and log.outcome = 'success') as passed_first_try,
  min(log.attempt_no) filter (where log.outcome = 'success') as attempts_until_first_success,
  round(avg(log.similarity_score) filter (where log.outcome = 'success')::numeric, 4) as avg_success_score,
  round(min(log.similarity_score) filter (where log.outcome = 'success')::numeric, 4) as min_success_score,
  mode() within group (order by log.failure_stage) filter (where log.outcome = 'failed') as most_common_failure,
  min(log.created_at) as first_attempt_at,
  max(log.created_at) as last_attempt_at
from public.pilot_checkin_log log
group by log.user_id;

revoke all on public.pilot_checkin_summary from public, anon, authenticated;

comment on view public.pilot_checkin_summary is
  'TEST-ONLY per-participant summary of pilot_checkin_log. Personal data: drop with the table after the pilot.';
