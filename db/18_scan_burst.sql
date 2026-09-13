-- Short-window (burst) tracking for receipt scanning.
--
-- The monthly quota in db/16 stops sustained abuse but NOT a burst: a script
-- can spend a whole month's allowance in a few seconds, and every scan costs
-- real money at the AI provider. A monthly cap bounds the damage; it does not
-- slow it down.
--
-- Two extra columns on the existing scan_usage row, so this needs no new table
-- and no new policy. scan_usage still grants SELECT only — writes happen solely
-- through the Edge Function using the service_role key.
--
-- The window rolls forward lazily: when the function sees a burst_start older
-- than the window it resets the counter. No scheduled job, same approach the
-- monthly period already uses.
--
-- Run once in the Supabase dashboard -> SQL Editor.

alter table public.scan_usage
  add column if not exists burst_start timestamptz;

alter table public.scan_usage
  add column if not exists burst_count integer not null default 0;

-- Extra scans bought on top of the plan allowance.
--
-- Added now, unused for the moment, because top-ups were part of the decision:
-- free 20/month, premium 500/month, buy more if you need it. With this column
-- a top-up is a number, not a migration — and it can be granted by hand today
-- (exactly like profiles.is_premium is) long before any checkout exists.
--
-- Deliberately NOT reset with the monthly period: someone who paid for extra
-- scans keeps them until they are used.
alter table public.scan_usage
  add column if not exists bonus_scans integer not null default 0;

-- Mirrors the existing non-negative guard on `used`.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scan_usage_burst_non_negative'
  ) then
    alter table public.scan_usage
      add constraint scan_usage_burst_non_negative
      check (burst_count >= 0 and bonus_scans >= 0);
  end if;
end $$;
