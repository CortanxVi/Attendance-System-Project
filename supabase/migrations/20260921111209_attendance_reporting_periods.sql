-- Recoverable attendance-report periods.
-- Sessions are archived from the active report instead of deleting attendance evidence.

alter table public.attendance_sessions
  add column if not exists report_semester smallint,
  add column if not exists report_year integer,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

update public.attendance_sessions as attendance_session
set
  report_semester = course.semester,
  report_year = course.year
from public.courses as course
where course.id = attendance_session.course_id
  and (attendance_session.report_semester is null or attendance_session.report_year is null);

alter table public.attendance_sessions
  alter column report_semester set not null,
  alter column report_year set not null;

alter table public.attendance_sessions
  drop constraint if exists attendance_sessions_report_semester_check;
alter table public.attendance_sessions
  add constraint attendance_sessions_report_semester_check
  check (report_semester between 1 and 3);

alter table public.attendance_sessions
  drop constraint if exists attendance_sessions_archive_reason_length_check;
alter table public.attendance_sessions
  add constraint attendance_sessions_archive_reason_length_check
  check (archive_reason is null or char_length(archive_reason) <= 300);

create index if not exists attendance_sessions_active_report_idx
  on public.attendance_sessions (course_id, created_at)
  where archived_at is null;

create index if not exists attendance_sessions_archived_report_idx
  on public.attendance_sessions (course_id, report_year, report_semester, archived_at desc)
  where archived_at is not null;

create or replace function private.snapshot_attendance_session_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  course_period record;
begin
  select semester, year
  into course_period
  from public.courses
  where id = new.course_id;

  if not found then
    raise exception 'ไม่พบรายวิชาสำหรับสร้างคาบเรียน';
  end if;

  new.report_semester := course_period.semester;
  new.report_year := course_period.year;
  return new;
end;
$$;

drop trigger if exists snapshot_attendance_session_period on public.attendance_sessions;
create trigger snapshot_attendance_session_period
before insert or update of course_id on public.attendance_sessions
for each row execute function private.snapshot_attendance_session_period();

create or replace function public.archive_attendance_sessions(
  target_course_id uuid,
  actor_id uuid,
  target_session_ids uuid[],
  archive_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  course_owner uuid;
  requested_count integer;
  eligible_count integer;
  changed_count integer;
begin
  select role into actor_role from public.profiles where id = actor_id;
  select teacher_id into course_owner from public.courses where id = target_course_id;
  if course_owner is null then
    raise exception 'ไม่พบรายวิชา';
  end if;
  if actor_role <> 'admin' and course_owner <> actor_id then
    raise exception 'ไม่มีสิทธิ์จัดการรอบรายงานนี้';
  end if;

  select count(*) into requested_count
  from (select distinct unnest(target_session_ids) as id) requested;
  if requested_count = 0 then
    raise exception 'กรุณาเลือกคาบเรียนอย่างน้อยหนึ่งครั้ง';
  end if;

  select count(*) into eligible_count
  from public.attendance_sessions
  where course_id = target_course_id
    and id = any(target_session_ids)
    and archived_at is null
    and status = 'closed';
  if eligible_count <> requested_count then
    raise exception 'บางคาบไม่พบ ถูกพักไว้แล้ว หรือยังไม่ปิดคาบ';
  end if;

  update public.attendance_sessions
  set
    archived_at = now(),
    archived_by = actor_id,
    archive_reason = nullif(left(trim(coalesce(archive_note, '')), 300), '')
  where course_id = target_course_id
    and id = any(target_session_ids)
    and archived_at is null
    and status = 'closed';
  get diagnostics changed_count = row_count;

  return jsonb_build_object('archived_count', changed_count);
end;
$$;

create or replace function public.restore_attendance_sessions(
  target_course_id uuid,
  actor_id uuid,
  target_session_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  course_owner uuid;
  current_semester smallint;
  current_year integer;
  requested_count integer;
  eligible_count integer;
  changed_count integer;
begin
  select role into actor_role from public.profiles where id = actor_id;
  select teacher_id, semester, year
  into course_owner, current_semester, current_year
  from public.courses where id = target_course_id;
  if course_owner is null then
    raise exception 'ไม่พบรายวิชา';
  end if;
  if actor_role <> 'admin' and course_owner <> actor_id then
    raise exception 'ไม่มีสิทธิ์จัดการรอบรายงานนี้';
  end if;

  select count(*) into requested_count
  from (select distinct unnest(target_session_ids) as id) requested;
  if requested_count = 0 then
    raise exception 'กรุณาเลือกคาบเรียนอย่างน้อยหนึ่งครั้ง';
  end if;

  select count(*) into eligible_count
  from public.attendance_sessions
  where course_id = target_course_id
    and id = any(target_session_ids)
    and archived_at is not null
    and report_semester = current_semester
    and report_year = current_year;
  if eligible_count <> requested_count then
    raise exception 'คืนกลับได้เฉพาะคาบที่พักไว้ในภาคเรียนปัจจุบัน';
  end if;

  update public.attendance_sessions
  set archived_at = null, archived_by = null, archive_reason = null
  where course_id = target_course_id
    and id = any(target_session_ids)
    and archived_at is not null
    and report_semester = current_semester
    and report_year = current_year;
  get diagnostics changed_count = row_count;

  return jsonb_build_object('restored_count', changed_count);
end;
$$;

create or replace function public.rollover_attendance_period(
  target_course_id uuid,
  actor_id uuid,
  new_semester smallint,
  new_year integer,
  archive_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  course_owner uuid;
  changed_count integer;
begin
  if new_semester not between 1 and 2 then
    raise exception 'ภาคเรียนต้องเป็น 1 หรือ 2';
  end if;
  if new_year not between 2000 and 3000 then
    raise exception 'ปีการศึกษาไม่ถูกต้อง';
  end if;

  select role into actor_role from public.profiles where id = actor_id;
  select teacher_id into course_owner from public.courses where id = target_course_id for update;
  if course_owner is null then
    raise exception 'ไม่พบรายวิชา';
  end if;
  if actor_role <> 'admin' and course_owner <> actor_id then
    raise exception 'ไม่มีสิทธิ์จัดการรอบรายงานนี้';
  end if;
  if exists (
    select 1 from public.attendance_sessions
    where course_id = target_course_id and archived_at is null and status <> 'closed'
  ) then
    raise exception 'กรุณาปิดคาบเรียนที่กำลังเปิดอยู่ก่อนเริ่มภาคเรียนใหม่';
  end if;

  update public.attendance_sessions
  set
    archived_at = now(),
    archived_by = actor_id,
    archive_reason = coalesce(
      nullif(left(trim(coalesce(archive_note, '')), 300), ''),
      'สิ้นสุดรอบรายงานภาคเรียน'
    )
  where course_id = target_course_id and archived_at is null;
  get diagnostics changed_count = row_count;

  update public.courses
  set semester = new_semester, year = new_year
  where id = target_course_id;

  return jsonb_build_object(
    'archived_count', changed_count,
    'semester', new_semester,
    'year', new_year
  );
end;
$$;

revoke all on function private.snapshot_attendance_session_period() from public, anon, authenticated;
revoke all on function public.archive_attendance_sessions(uuid, uuid, uuid[], text) from public, anon, authenticated;
revoke all on function public.restore_attendance_sessions(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.rollover_attendance_period(uuid, uuid, smallint, integer, text) from public, anon, authenticated;
grant execute on function public.archive_attendance_sessions(uuid, uuid, uuid[], text) to service_role;
grant execute on function public.restore_attendance_sessions(uuid, uuid, uuid[]) to service_role;
grant execute on function public.rollover_attendance_period(uuid, uuid, smallint, integer, text) to service_role;
