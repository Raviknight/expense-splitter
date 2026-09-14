-- Move the "how to pay me" note out of `profiles` into its own table, so that
-- ONLY people you have an ACCEPTED connection with can read it.
--
-- WHY THIS EXISTS. db/20 put the note on `profiles` and its header claimed the
-- note was readable only by accepted connections. That was wrong. Reads of
-- `profiles` are governed by the "read connected profiles" policy from db/01,
-- which only tests that a `connections` row EXISTS:
--
--     exists (select 1 from connections c
--             where (c.requester = auth.uid() and c.addressee = profiles.id)
--                or (c.addressee = auth.uid() and c.requester = profiles.id))
--
-- It never looks at `c.status`, which can be 'pending', 'accepted' or
-- 'declined'. So anyone who sent you a request could read your profile the
-- moment they sent it, and DECLINING DID NOT TAKE THAT AWAY — the row stays,
-- and so did the access. For display_name and email that was already
-- questionable. For a payment handle it is the field someone would actually go
-- fishing for, so it gets a policy that means what it says.
--
-- WHY A NEW TABLE rather than fixing the profiles policy. RLS is row-level: a
-- policy on `profiles` governs the WHOLE ROW, so there is no way to say "a
-- pending connection may read display_name but not payment_note" without
-- splitting the data. And tightening `profiles` itself is NOT safe to do
-- casually: useConnections.js reads the profiles of BOTH sides of every
-- connection row, including pending ones, so an accepted-only policy there
-- would blank out the names on your own sent invites. Splitting the sensitive
-- field into its own table fixes the real exposure without that collateral
-- damage. Tightening the `profiles` policy to stop honouring DECLINED rows is
-- still worth doing separately (BACKLOG #22) — this migration does not do it.
--
-- WHAT THIS DOES NOT CHANGE. The app still never touches money. This is one
-- string the user typed, displayed to someone who owes them. There is no
-- payment SDK, deep link or API behind it and none should ever be added.
--
-- WHY "SHARES A GROUP WITH YOU" IS ALSO ALLOWED, not just accepted connections.
-- The first draft of this migration granted reads to accepted connections only.
-- That was wrong, and the reason is worth recording because it is not obvious:
-- CO-MEMBERS ARE NOT AUTO-CONNECTED TO EACH OTHER. Members are linked from the
-- GROUP OWNER's accepted connections, and db/09's invite flow connects the
-- INVITER to the new user — nothing ever connects two non-owner members. So in
-- a group of Ravi (owner) + Shailja + Alex, Shailja and Alex have no connection
-- at all. Under an accepted-only rule Shailja could owe Alex money and be
-- unable to see how to pay him, which defeats the entire feature at exactly the
-- moment it is needed.
--
-- Sharing a group is a DELIBERATE act by someone with authority to add you, and
-- it is the precise relationship that creates a debt. It is a stronger signal
-- than a pending connection request, which is unilateral and needs no consent
-- from the person being read. So the rule is: yourself, OR an accepted
-- connection, OR someone you actually share a group with. That is still far
-- tighter than what `profiles` does today, where a merely PENDING — or even
-- DECLINED — request grants access.
--
-- Safe to re-run. Run once in the Supabase dashboard -> SQL Editor.

-- 0. Helper: does the signed-in user share at least one group with `other`?
--
-- `security definer` is LOAD-BEARING, not an optimisation. Without it, a policy
-- on `profiles` or `payment_notes` that reads `group_members` would itself be
-- filtered by `group_members`'s own policy, which calls `is_member_of`, and
-- Postgres can end up in infinite recursion. db/01 solved exactly this problem
-- the same way (see the comment above `is_member_of`), so this follows that
-- established pattern rather than inventing a new one.
--
-- `stable` lets the planner cache the result within a statement — this is
-- called once per candidate row, so it matters.
--
-- Defined here AND in db/22 with identical bodies (`create or replace` makes
-- that a no-op) so neither migration depends on the other having been run.
create or replace function public.shares_group_with(other uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from group_members mine
      join group_members theirs on theirs.group_id = mine.group_id
     where mine.user_id   = auth.uid()
       and theirs.user_id = other
  );
$$;

-- 1. The table. One row per user, so the primary key IS the user id.
create table if not exists public.payment_notes (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  note       text,
  updated_at timestamptz not null default now()
);

-- Same 200-char cap db/20 used: a note is one short line, not unbounded
-- storage, and not a wall of text in someone else's settle-up screen.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payment_notes_len'
  ) then
    alter table public.payment_notes
      add constraint payment_notes_len
      check (note is null or char_length(note) <= 200);
  end if;
end $$;

alter table public.payment_notes enable row level security;

-- Explicit grants. Supabase normally sets default privileges on `public` so new
-- tables are reachable by the `authenticated` role, but that is project
-- configuration rather than a guarantee, and if it is missing every query here
-- fails with "permission denied for table payment_notes" — which looks nothing
-- like an RLS problem and would be genuinely confusing to debug. Stating them
-- costs nothing and is idempotent.
--
-- NOTE these are TABLE-level grants, which is not the security boundary: RLS
-- above decides which ROWS are visible. `anon` is deliberately NOT granted —
-- a signed-out visitor has no business reading payment handles.
grant select, insert, update, delete on public.payment_notes to authenticated;

-- 2. Carry across anything already written under db/20, so nobody has to
--    retype a note they have already saved. Guarded so this migration still
--    runs cleanly on a database where db/20 was never applied.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'payment_note'
  ) then
    insert into public.payment_notes (user_id, note)
    select id, payment_note
      from public.profiles
     where payment_note is not null
       and btrim(payment_note) <> ''
    on conflict (user_id) do nothing;   -- never clobber a newer note
  end if;
end $$;

-- 3. Policies.
--
-- Read your own, always — you must be able to see and edit what you wrote.
drop policy if exists "read own payment note" on public.payment_notes;
create policy "read own payment note" on public.payment_notes
  for select using (user_id = auth.uid());

-- Read someone else's ONLY on an accepted connection. `c.status = 'accepted'`
-- is the whole point of this migration: pending grants nothing, and declining
-- now actually revokes.
drop policy if exists "read accepted connection payment note" on public.payment_notes;
create policy "read accepted connection payment note" on public.payment_notes
  for select using (
    exists (
      select 1 from public.connections c
      where c.status = 'accepted'
        and (
             (c.requester = auth.uid() and c.addressee = payment_notes.user_id)
          or (c.addressee = auth.uid() and c.requester = payment_notes.user_id)
        )
    )
  );

-- Read the note of anyone you actually SHARE A GROUP WITH. Without this, the
-- two non-owner members of a group cannot see each other's details even though
-- they are precisely the people who may owe each other money. See the long note
-- at the top for why co-members are not connections.
drop policy if exists "read co-member payment note" on public.payment_notes;
create policy "read co-member payment note" on public.payment_notes
  for select using (public.shares_group_with(user_id));

-- Writes are yours alone. `with check` on insert AND update so a row can never
-- be created for, or moved to, another user.
drop policy if exists "insert own payment note" on public.payment_notes;
create policy "insert own payment note" on public.payment_notes
  for insert with check (user_id = auth.uid());

drop policy if exists "update own payment note" on public.payment_notes;
create policy "update own payment note" on public.payment_notes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own payment note" on public.payment_notes;
create policy "delete own payment note" on public.payment_notes
  for delete using (user_id = auth.uid());

-- 4. Drop the old column, which is the only way the loose policy stops
--    applying to this data. Deliberately LAST, and deliberately after the copy
--    above, so the data is already safe in the new table.
--
--    ORDER OF OPERATIONS: deploy the app BEFORE running this. The app reads
--    payment_notes and falls back to profiles.payment_note when the table is
--    missing, so an app deployed ahead of this script keeps working, and after
--    this script it uses the new table. Running this against an OLD app build
--    is not destructive either — notes simply stop displaying until the new
--    build lands, because the old code reads a column that no longer exists and
--    its existing fallback ladder skips it.
alter table public.profiles drop column if exists payment_note;
