-- Email notification preferences.
--
-- On `profiles` for the same reason as pinned_groups (db/13): that table already
-- has a policy letting a user update their own row, so no new RLS policy is
-- needed — and a wrong RLS policy is a data-exposure bug, not a cosmetic one.
--
-- DEFAULTS ARE DELIBERATE AND DIFFERENT:
--   notify_daily   = FALSE — a daily email is high-frequency. Sending it to
--                    people who never asked is the fastest way to collect spam
--                    complaints, which damages the sending domain's reputation
--                    at Resend and can degrade delivery of EVERYTHING including
--                    sign-in emails. Opt-in only.
--   notify_monthly = TRUE  — one email a month reads as a statement rather than
--                    noise, so it is on by default and easy to turn off.
--
-- Note the daily digest is additionally skipped when a user has NO new activity,
-- so even opted-in users get nothing on quiet days. "Nothing happened" is not
-- worth an email.
--
-- Run once in the Supabase dashboard -> SQL Editor.

alter table public.profiles
  add column if not exists notify_daily boolean not null default false;

alter table public.profiles
  add column if not exists notify_monthly boolean not null default true;

-- Lets the digest job find its recipients without scanning every profile.
create index if not exists profiles_notify_daily_idx
  on public.profiles (id) where notify_daily;

create index if not exists profiles_notify_monthly_idx
  on public.profiles (id) where notify_monthly;
