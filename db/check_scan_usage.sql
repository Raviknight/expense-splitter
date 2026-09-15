-- READ-ONLY. What has actually been scanned, so the free tier is set from
-- evidence rather than from a guess. Run in Supabase -> SQL Editor.
--
-- Why this matters before flipping SCAN_LIMIT_ENABLED: counting has been live
-- and enforcing off ON PURPOSE, precisely so there would be real numbers to set
-- the limit from. Turning enforcement on without reading them would throw that
-- away and pick 20 for no reason other than it being the value already there.

-- 1. USAGE PER PERSON, this month and every month recorded.
--    `used` resets when the function first sees a new month, so a row showing
--    an old period_start simply means they have not scanned since.
select p.email,
       p.display_name,
       p.is_premium,
       u.period_start,
       u.used                        as scans_this_period,
       u.updated_at                  as last_scan
  from public.scan_usage u
  join public.profiles p on p.id = u.user_id
 order by u.used desc, u.updated_at desc;

-- 2. THE SHAPE OF DEMAND — the number that should decide the free tier.
--    A free limit only makes sense somewhere above what ordinary use looks
--    like. If the busiest person is at 6, a limit of 20 constrains nobody and
--    sells nothing; if several are near 20, a limit of 20 is already biting.
select count(*)                                   as people_who_have_scanned,
       coalesce(sum(used), 0)                     as total_scans,
       coalesce(round(avg(used), 1), 0)           as mean_per_person,
       coalesce(max(used), 0)                     as busiest_person,
       coalesce(percentile_cont(0.5) within group (order by used), 0)  as median,
       coalesce(percentile_cont(0.9) within group (order by used), 0)  as p90
  from public.scan_usage
 where period_start = date_trunc('month', now())::date;

-- 3. HOW MANY WOULD BE BLOCKED at various limits, if enforcement were on today.
--    Read this as "at a free tier of N, this many people hit the wall".
select 5  as free_tier, count(*) filter (where used >= 5)  as would_be_blocked from public.scan_usage where period_start = date_trunc('month', now())::date
union all
select 10, count(*) filter (where used >= 10) from public.scan_usage where period_start = date_trunc('month', now())::date
union all
select 20, count(*) filter (where used >= 20) from public.scan_usage where period_start = date_trunc('month', now())::date
union all
select 50, count(*) filter (where used >= 50) from public.scan_usage where period_start = date_trunc('month', now())::date;
