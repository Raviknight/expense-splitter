-- Tracks when each digest was last sent to each user.
--
-- WHY NOT just "everything in the last 24 hours":
--   If the scheduled job fails or is delayed (GitHub Actions cron can be), a
--   fixed 24h window silently drops whatever happened in the gap. Storing the
--   last-sent timestamp means the next successful run covers everything since
--   then, so activity is never lost — only delayed.
--   It also makes the job idempotent: re-running it the same day finds nothing
--   new and sends nothing, so a retry can't double-mail anyone.
--
-- NULL means "never sent". The digest then falls back to a sensible first
-- window (24h for daily, the previous calendar month for monthly) rather than
-- emailing someone their entire history.
--
-- These are written by the digest Edge Function using the service_role key, so
-- no user-facing RLS policy is needed — users never update these themselves.
--
-- Run once in the Supabase dashboard -> SQL Editor.

alter table public.profiles
  add column if not exists last_daily_digest_at timestamptz;

alter table public.profiles
  add column if not exists last_monthly_digest_at timestamptz;
