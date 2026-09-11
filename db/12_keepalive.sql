-- Keep-alive target for the scheduled ping (see .github/workflows/keepalive.yml).
--
-- Why this exists: Supabase pauses Free-plan projects after about 7 days of low
-- DATABASE activity. A few real Postgres queries per day is enough to prevent
-- that. We give the pinger its own tiny table rather than pointing it at a real
-- table, so the daily request is self-explanatory in the logs and touches none
-- of anyone's expense data.
--
-- Run once in the Supabase dashboard -> SQL Editor. "Success. No rows returned"
-- is the expected result.

create table if not exists public.keepalive (
  id         smallint primary key default 1,
  created_at timestamptz not null default now(),
  -- Belt and braces: this table should only ever hold the single ping target.
  constraint keepalive_single_row check (id = 1)
);

insert into public.keepalive (id) values (1)
on conflict (id) do nothing;

alter table public.keepalive enable row level security;

-- The ping runs with the PUBLIC anon key, so anon has to be able to read this
-- row. The table holds nothing but an id and a creation timestamp, so allowing
-- this exposes no user data.
drop policy if exists "anyone may read keepalive" on public.keepalive;
create policy "anyone may read keepalive"
  on public.keepalive for select
  to anon, authenticated
  using (true);

-- Deliberately no insert/update/delete policies: with RLS on, that means nobody
-- can write to this table through the API. A SELECT is all the ping needs.
