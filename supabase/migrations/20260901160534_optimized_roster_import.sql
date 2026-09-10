-- Backend-only, server-paginated roster reads and atomic roster imports.
-- Both functions repeat authorization checks in the database so a leaked or
-- misrouted backend call cannot let a temporary admin manage another course.

create or replace function public.list_course_roster(
  target_course_id uuid,
  actor_id uuid,
  requested_page integer default 1,
  requested_page_size integer default 25,
  search_text text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page_value integer := least(1000000, greatest(1, coalesce(requested_page, 1)));
  page_size_value integer := least(100, greatest(1, coalesce(requested_page_size, 25)));
  offset_value bigint;
  normalized_search text := lower(btrim(coalesce(search_text, '')));
  result jsonb;
begin
  if not exists (
    select 1
    from public.courses c
    left join public.profiles actor on actor.id = actor_id
    where c.id = target_course_id
      and (c.teacher_id = actor_id or actor.role = 'admin')
  ) then
    raise exception 'not authorized to manage this course' using errcode = '42501';
  end if;

  offset_value := (page_value - 1)::bigint * page_size_value;

  with roster as materialized (
    select
      p.id,
      p.email,
      p.student_id,
      p.full_name,
      p.academic_year,
      p.class_level,
      'active'::text as roster_kind
    from public.enrollments e
    join public.profiles p on p.id = e.student_id
    where e.course_id = target_course_id
      and p.role = 'student'

    union all

    select
      i.id,
      i.email,
      i.student_id,
      i.full_name,
      i.academic_year,
      i.class_level,
      'pending'::text as roster_kind
    from public.profile_invite_courses link
    join public.profile_invites i on i.id = link.invite_id
    where link.course_id = target_course_id
      and i.role = 'student'
      and i.claimed_at is null
  ),
  filtered as materialized (
    select *
    from roster
    where normalized_search = ''
       or strpos(
            lower(concat_ws(' ', full_name, student_id, email, class_level)),
            normalized_search
          ) > 0
  ),
  page_rows as (
    select *
    from filtered
    order by student_id nulls last, full_name, id
    limit page_size_value
    offset offset_value
  )
  select jsonb_build_object(
    'students', coalesce(
      (select jsonb_agg(to_jsonb(page_rows) order by student_id nulls last, full_name, id)
       from page_rows),
      '[]'::jsonb
    ),
    'page', page_value,
    'page_size', page_size_value,
    'total', (select count(*) from filtered)
  )
  into result;

  return result;
end;
$$;

create or replace function public.import_course_roster(
  target_course_id uuid,
  actor_id uuid,
  roster_rows jsonb,
  source_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  source_row_value integer;
  student_id_value text;
  email_value text;
  full_name_value text;
  academic_year_text text;
  academic_year_value integer;
  class_level_value text;
  profile_row public.profiles%rowtype;
  conflicting_profile_id uuid;
  invite_row public.profile_invites%rowtype;
  conflicting_invite_id uuid;
  invite_id_value uuid;
  affected integer;
  enrolled_count integer := 0;
  linked_invite_count integer := 0;
  created_invite_count integer := 0;
  unchanged_count integer := 0;
begin
  if not exists (
    select 1
    from public.courses c
    left join public.profiles actor on actor.id = actor_id
    where c.id = target_course_id
      and (c.teacher_id = actor_id or actor.role = 'admin')
  ) then
    raise exception 'not authorized to manage this course' using errcode = '42501';
  end if;

  if jsonb_typeof(roster_rows) <> 'array'
     or jsonb_array_length(roster_rows) < 1
     or jsonb_array_length(roster_rows) > 1000 then
    raise exception 'roster_rows must contain between 1 and 1000 rows'
      using errcode = '22023';
  end if;

  if coalesce(source_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid source digest' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(roster_rows)
  loop
    source_row_value := coalesce((item->>'source_row')::integer, 0);
    student_id_value := btrim(coalesce(item->>'student_id', ''));
    email_value := lower(btrim(coalesce(item->>'email', '')));
    full_name_value := btrim(coalesce(item->>'full_name', ''));
    academic_year_text := nullif(btrim(coalesce(item->>'academic_year', '')), '');
    class_level_value := nullif(btrim(coalesce(item->>'class_level', '')), '');
    academic_year_value := case
      when academic_year_text is null then null
      when academic_year_text ~ '^[1-8]$' then academic_year_text::integer
      else -1
    end;

    if source_row_value < 1
       or student_id_value !~ '^[0-9]{13}$'
       or email_value !~ '^[^@]+@email\.kmutnb\.ac\.th$'
       or char_length(full_name_value) not between 2 and 150
       or academic_year_value = -1
       or char_length(coalesce(class_level_value, '')) > 50 then
      raise exception 'invalid roster row %', source_row_value using errcode = '22023';
    end if;

    profile_row := null;
    select p.* into profile_row
    from public.profiles p
    where p.student_id = student_id_value
    limit 1;

    if profile_row.id is not null then
      if profile_row.role <> 'student' then
        raise exception 'student identity conflict at row %', source_row_value using errcode = '23505';
      end if;

      select p.id into conflicting_profile_id
      from public.profiles p
      where lower(p.email) = email_value
        and p.id <> profile_row.id
      limit 1;
      if conflicting_profile_id is not null then
        raise exception 'email identity conflict at row %', source_row_value using errcode = '23505';
      end if;

      insert into public.enrollments (course_id, student_id)
      values (target_course_id, profile_row.id)
      on conflict (course_id, student_id) do nothing;
      get diagnostics affected = row_count;
      if affected = 1 then
        enrolled_count := enrolled_count + 1;
      else
        unchanged_count := unchanged_count + 1;
      end if;
      continue;
    end if;

    select p.id into conflicting_profile_id
    from public.profiles p
    where lower(p.email) = email_value
    limit 1;
    if conflicting_profile_id is not null then
      raise exception 'email identity conflict at row %', source_row_value using errcode = '23505';
    end if;

    invite_row := null;
    select i.* into invite_row
    from public.profile_invites i
    where i.student_id = student_id_value
    limit 1;

    if invite_row.id is not null then
      if invite_row.claimed_at is not null or invite_row.role <> 'student' then
        raise exception 'invite identity conflict at row %', source_row_value using errcode = '23505';
      end if;

      select i.id into conflicting_invite_id
      from public.profile_invites i
      where lower(i.email) = email_value
        and i.id <> invite_row.id
      limit 1;
      if conflicting_invite_id is not null then
        raise exception 'invite email conflict at row %', source_row_value using errcode = '23505';
      end if;

      invite_id_value := invite_row.id;
      update public.profile_invites
      set full_name = full_name_value,
          academic_year = academic_year_value,
          class_level = class_level_value
      where id = invite_id_value;
    else
      select i.id into conflicting_invite_id
      from public.profile_invites i
      where lower(i.email) = email_value
      limit 1;
      if conflicting_invite_id is not null then
        raise exception 'invite email conflict at row %', source_row_value using errcode = '23505';
      end if;

      insert into public.profile_invites (
        email, student_id, full_name, role, invited_by, academic_year, class_level
      ) values (
        email_value, student_id_value, full_name_value, 'student', actor_id,
        academic_year_value, class_level_value
      )
      returning id into invite_id_value;
      created_invite_count := created_invite_count + 1;
    end if;

    insert into public.profile_invite_courses (invite_id, course_id)
    values (invite_id_value, target_course_id)
    on conflict (invite_id, course_id) do nothing;
    get diagnostics affected = row_count;
    if affected = 1 then
      linked_invite_count := linked_invite_count + 1;
    else
      unchanged_count := unchanged_count + 1;
    end if;
  end loop;

  insert into public.audit_logs (
    admin_id, action, target_type, target_id, details
  ) values (
    actor_id,
    'COURSE_ROSTER_IMPORTED',
    'course',
    target_course_id::text,
    jsonb_build_object(
      'source_sha256', source_sha256,
      'row_count', jsonb_array_length(roster_rows),
      'enrolled', enrolled_count,
      'linked_invites', linked_invite_count,
      'created_invites', created_invite_count,
      'unchanged', unchanged_count
    )
  );

  return jsonb_build_object(
    'row_count', jsonb_array_length(roster_rows),
    'enrolled', enrolled_count,
    'linked_invites', linked_invite_count,
    'created_invites', created_invite_count,
    'unchanged', unchanged_count
  );
end;
$$;

revoke all on function public.list_course_roster(uuid, uuid, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.import_course_roster(uuid, uuid, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.list_course_roster(uuid, uuid, integer, integer, text)
  to service_role;
grant execute on function public.import_course_roster(uuid, uuid, jsonb, text)
  to service_role;
