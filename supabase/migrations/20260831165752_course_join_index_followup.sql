-- Cover the created_by foreign key for profile deletion and remove an index
-- that does not match any application query (codes are looked up by unique
-- join_code or unique course_id instead).
create index course_join_codes_created_by_idx
  on public.course_join_codes (created_by)
  where created_by is not null;

drop index if exists public.course_join_codes_active_expiry_idx;
