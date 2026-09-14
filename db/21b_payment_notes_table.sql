-- PART 2 of 3. Run AFTER db/21a. Contains NO dollar-quoted blocks at all, so
-- the dashboard's statement splitter has nothing to trip over.
--
-- Creates the `payment_notes` table that holds each person's free-text "how to
-- pay me" line, and locks reads down properly.
--
-- WHY THE NOTE IS MOVING OFF `profiles`. db/20 put it on `profiles` and claimed
-- it was readable only by accepted connections. That was wrong. Reads of
-- `profiles` go through db/01's "read connected profiles" policy, which only
-- tests that a `connections` row EXISTS — it never looks at `c.status`, which
-- can be 'pending', 'accepted' or 'declined'. So anyone who sent you a request
-- could read your profile the moment they sent it, and DECLINING DID NOT TAKE
-- THAT AWAY. For a display name that was questionable; for a payment handle it
-- is the field someone would actually go fishing for.
--
-- WHY A NEW TABLE rather than fixing the policy on `profiles`. RLS is
-- row-level: a policy governs the WHOLE row, so there is no way to say "a
-- pending connection may read display_name but not payment_note" without
-- splitting the data into two tables. And tightening `profiles` itself is not
-- safe to do casually — useConnections.js reads the profiles on BOTH sides of
-- every connection row, including pending ones, so an accepted-only rule there
-- would blank out the names on the user's own sent invites.
--
-- WHO CAN READ A NOTE: you, anyone you have an ACCEPTED connection with, and
-- anyone you actually SHARE A GROUP WITH. That last one is not padding — it is
-- required. Co-members are never auto-connected to each other: members are
-- linked from the GROUP OWNER's accepted connections, and db/09's invite flow
-- connects the INVITER to the new user. Nothing connects two non-owner members.
-- Without the shared-group rule, two people in the same group could owe each
-- other money and be unable to see how to pay — the feature failing at exactly
-- the moment it is needed. Sharing a group is a deliberate act by someone with
-- authority to add you; a pending request is unilateral and needs no consent
-- from the person being read.
--
-- THE APP NEVER TOUCHES MONEY. This stores one string the user typed and shows
-- it to someone who owes them. There is no payment SDK, deep link or API behind
-- it, and none should be added.
--
-- Safe to re-run.

create table if not exists public.payment_notes (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  note       text,
  updated_at timestamptz not null default now()
);

-- Same 200-char cap db/20 used: one short line, not unbounded storage, and not
-- a wall of text in someone else's settle-up screen. Drop-then-add is
-- idempotent; dropping a constraint that isn't there is a no-op.
alter table public.payment_notes drop constraint if exists payment_notes_len;
alter table public.payment_notes
  add constraint payment_notes_len
  check (note is null or char_length(note) <= 200);

alter table public.payment_notes enable row level security;

-- Explicit grants. Supabase normally sets default privileges on `public` so new
-- tables are reachable by `authenticated`, but that is project configuration
-- rather than a guarantee, and if it were missing every query would fail with
-- "permission denied for table payment_notes" — which looks nothing like an RLS
-- problem and would be genuinely confusing to debug.
--
-- These are TABLE-level grants and are NOT the security boundary: the policies
-- below decide which ROWS are visible. `anon` is deliberately not granted — a
-- signed-out visitor has no business reading payment handles.
grant select, insert, update, delete on public.payment_notes to authenticated;

-- Read your own, always: you must be able to see and edit what you wrote.
drop policy if exists "read own payment note" on public.payment_notes;
create policy "read own payment note" on public.payment_notes
  for select using (user_id = auth.uid());

-- Read someone else's on an ACCEPTED connection. `c.status = 'accepted'` is the
-- whole point: pending grants nothing, and declining now actually revokes.
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

-- Read the note of anyone you share a group with (see the long note above for
-- why this is required, not optional). Uses the helper from db/21a.
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
