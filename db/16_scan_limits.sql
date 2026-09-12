-- Server-side quota for receipt scanning.
--
-- ⚠️ WHY THIS IS ITS OWN TABLE AND NOT A COLUMN ON `profiles`:
--   Users are allowed to UPDATE their own profiles row — that is how
--   preferred_currency, pinned_groups and the notification toggles save. A
--   scan counter stored there could be reset by any user with one API call,
--   using the public anon key. The quota would be decorative.
--
--   This table therefore grants SELECT only. There is deliberately NO insert,
--   update or delete policy, so with RLS enabled nobody can write it through
--   the API. Only the service_role key — which lives exclusively in Edge
--   Function secrets — can change a count.
--
--   Read access is kept so the app can honestly show "3 of 20 scans left"
--   without another round trip.
--
-- Counting rule (decided earlier): ONE unit per FILE, not per PDF page. The
-- scan function extracts PDF text itself and clips it at 24,000 characters, so
-- a 50-page PDF costs the same as a 3-page one. Billing per page would charge
-- 50x for 1x the cost. Images are the expensive path (vision models), and they
-- are one file = one unit.
--
-- Run once in the Supabase dashboard -> SQL Editor.

create table if not exists public.scan_usage (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  -- First day of the month this count belongs to. The function rolls this
  -- forward and zeroes `used` when it sees a new month, so no cron is needed
  -- to reset quotas.
  period_start date        not null default date_trunc('month', now())::date,
  used         integer     not null default 0,
  updated_at   timestamptz not null default now(),
  constraint scan_usage_used_non_negative check (used >= 0)
);

alter table public.scan_usage enable row level security;

-- Read your own usage (so the UI can show what's left). Nothing more.
drop policy if exists "read own scan usage" on public.scan_usage;
create policy "read own scan usage"
  on public.scan_usage for select
  to authenticated
  using (auth.uid() = user_id);

-- NO insert/update/delete policies on purpose. With RLS on, that means the
-- anon and authenticated roles cannot write this table at all. If you ever add
-- one, the quota stops being enforceable.
