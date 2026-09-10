-- Follow-up for Supabase security/performance advisor findings.

create index if not exists attendance_challenges_session_id_idx
  on public.attendance_checkin_challenges (session_id);
create index if not exists profile_invites_invited_by_idx
  on public.profile_invites (invited_by);

drop policy if exists attendance_challenges_no_direct_access
  on public.attendance_checkin_challenges;
create policy attendance_challenges_no_direct_access
  on public.attendance_checkin_challenges
  for select
  to authenticated
  using (false);
