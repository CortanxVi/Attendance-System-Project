-- TEST-ONLY. Apply this migration to a TEST Supabase project, not to production.
-- Requires 20261113120000_test_external_email_and_face_attempts.sql (creates the table).
--
-- Adds public.face_checkin_attempts.diagnostics: one small JSON object per attempt (success and
-- failure) with the numbers the Backend measured, for threshold studies (TuningModelLog.md
-- Phase 2): per-frame PAD live probabilities, pose deltas against the first frame, the
-- move-closer scale ratio, blink aperture ratios, timing, fps and duration.
--
-- It holds numbers and short lowercase identifiers only. The Backend sanitiser
-- (backend/services/attempt_diagnostics.py) drops any free text, so the column can never contain
-- images, embeddings, names, e-mail addresses or student ids. The column is nullable: rows
-- written before this migration, or outside test mode, keep NULL. The Backend keeps working if
-- this migration is not applied yet (it retries the insert without the field).
--
-- Access is unchanged: RLS stays on with the existing deny policy, and anon/authenticated have
-- no privileges on the table. Only the server role writes and reads it.

alter table public.face_checkin_attempts
  add column if not exists diagnostics jsonb;

alter table public.face_checkin_attempts
  drop constraint if exists face_checkin_attempts_diagnostics_shape;

alter table public.face_checkin_attempts
  add constraint face_checkin_attempts_diagnostics_shape check (
    diagnostics is null
    or (jsonb_typeof(diagnostics) = 'object' and pg_column_size(diagnostics) <= 4000)
  );

comment on column public.face_checkin_attempts.diagnostics is
  'TEST-ONLY numbers-only liveness measurements (PAD, pose, blink, timing). No images, embeddings or personal data.';
