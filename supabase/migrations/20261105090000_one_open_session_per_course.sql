-- Enforce "one open attendance session" at the database level.
--
-- Until now the backend only checked this rule in application code, so two
-- near-simultaneous "start session" requests (for example a double click)
-- could both pass the check and leave two open sessions behind.
--
-- Two partial unique indexes make the database the final authority:
--   * a course can have at most one open session, and
--   * a teacher (opened_by) can have at most one open session.
--
-- Safe to re-run. If duplicate open sessions already exist, the migration
-- stops with a readable error and changes nothing (it runs in a transaction),
-- so existing attendance data is never closed or deleted automatically.

do $$
declare
  duplicate_courses integer;
  duplicate_openers integer;
begin
  select count(*) into duplicate_courses
  from (
    select course_id
    from public.attendance_sessions
    where status = 'open'
    group by course_id
    having count(*) > 1
  ) as duplicates;

  select count(*) into duplicate_openers
  from (
    select opened_by
    from public.attendance_sessions
    where status = 'open'
    group by opened_by
    having count(*) > 1
  ) as duplicates;

  if duplicate_courses > 0 or duplicate_openers > 0 then
    raise exception
      'Cannot add one-open-session indexes: % course(s) and % teacher(s) already have more than one open session. Close the extra open sessions first, then re-run this migration.',
      duplicate_courses,
      duplicate_openers
      using errcode = '23505';
  end if;
end;
$$;

create unique index if not exists attendance_sessions_one_open_per_course_idx
  on public.attendance_sessions (course_id)
  where status = 'open';

create unique index if not exists attendance_sessions_one_open_per_opener_idx
  on public.attendance_sessions (opened_by)
  where status = 'open';
