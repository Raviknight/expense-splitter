-- Make deletions visible, and stop anyone deleting anyone else's expense.
--
-- Run AFTER db/22. No dollar-quoted blocks anywhere in this file, so the
-- dashboard's statement splitter has nothing to trip over (see db/21a for why
-- that matters). Safe to re-run.
--
-- THE PROBLEM. `members delete expenses` (db/01:252) allows ANY member of a
-- group to delete ANY expense in it, and the delete is a hard `delete()` on the
-- row (store.js). Nothing records that it happened. `countNewActivity`
-- (App.jsx) only counts expenses that still EXIST, so a deleted expense
-- disappears from the very history that is supposed to explain the balances.
-- Everyone's numbers move and nothing says why, or who did it. For an app whose
-- whole job is telling people what they owe, silent unattributed edits to the
-- ledger are a trust problem rather than a missing feature.
--
-- TWO HALVES, and both are needed. Visibility alone would leave people able to
-- delete each other's records; permission alone would still let a legitimate
-- deletion vanish without explanation.
--
-- WHY AN AUDIT ROW AND NOT A SOFT DELETE. A `deleted_at` column means every
-- existing read of expenses must learn to filter it out, and ONE missed filter
-- silently resurrects a deleted expense into somebody's balance — a worse bug
-- than the one being fixed, and a quiet one. A separate append-only table
-- cannot affect any existing query.
--
-- THE ROW KEEPS A SNAPSHOT, not just an id. Once the expense is gone, a
-- foreign key to it would be worthless: the audit has to say "Ravi deleted
-- 'Hotel', 100.00, paid by Alex" long after every trace of that expense is
-- gone. So the description, amount and payer NAME are copied in as plain text.
-- Names not ids, because the member row itself may later be removed.
--
-- KNOWN LIMITATION, deliberately not solved here. The rule below is "the payer
-- or the group owner". `expenses` has no `created_by` column, so if you add an
-- expense and correctly attribute it to someone else — "Alex paid for dinner" —
-- you cannot then delete your own mis-entry; only Alex or the group owner can.
-- Fixing that properly means adding `created_by`, backfilling it, and deciding
-- what it means for rows that predate it. Worth doing, but it is a bigger change
-- than this one and the owner asked for payer-or-owner.

-- ── 1. The audit table ──────────────────────────────────────────────────────
create table if not exists public.expense_deletions (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  -- 'expense' or 'settlement' — both are deletable and both matter.
  kind        text not null default 'expense' check (kind in ('expense','settlement')),
  item_id     uuid,              -- the id the row HAD; no FK, the target is gone
  description text,              -- snapshot: what it was called
  amount      numeric(12,2),     -- snapshot: how much it moved
  payer_name  text,              -- snapshot: who had paid, as a name not an id
  -- NULLABLE, and that is deliberate. The first draft had `not null` AND
  -- `on delete set null`, which contradict each other: deleting a user who had
  -- ever deleted an expense would try to null this column, violate the NOT NULL
  -- constraint, and FAIL THE ACCOUNT DELETION — leaving accounts that could not
  -- be removed. The audit row has to outlive the account, so the column gives
  -- way rather than the row.
  deleted_by      uuid references public.profiles(id) on delete set null,
  -- Snapshot of WHO, for the same reason amount and payer are snapshots: once
  -- the profile is gone the id says nothing. This is what the UI displays.
  deleted_by_name text,
  deleted_at      timestamptz not null default now()
);

create index if not exists expense_deletions_group_idx
  on public.expense_deletions (group_id, deleted_at desc);

alter table public.expense_deletions enable row level security;

grant select, insert on public.expense_deletions to authenticated;

-- Everyone in the group can SEE what was deleted. That is the entire point: the
-- people whose balances moved are the people who need to know.
drop policy if exists "members read deletions" on public.expense_deletions;
create policy "members read deletions" on public.expense_deletions
  for select using (is_member_of(group_id));

-- You may only log a deletion as YOURSELF, in a group you belong to. Without
-- the `deleted_by = auth.uid()` check the audit trail would be forgeable, which
-- would make it worse than useless — misleading rather than absent.
--
-- Making `deleted_by` nullable above does NOT open a hole here: a row inserted
-- with a null `deleted_by` evaluates `null = auth.uid()` to NULL, and a WITH
-- CHECK that is not TRUE is refused. So nobody can log an anonymous deletion.
-- Null only ever appears later, when a profile is removed and the FK nulls it.
drop policy if exists "members log own deletions" on public.expense_deletions;
create policy "members log own deletions" on public.expense_deletions
  for insert with check (is_member_of(group_id) and deleted_by = auth.uid());

-- No update or delete policy is defined, ON PURPOSE. With RLS enabled and no
-- policy, those operations are denied for everyone. An audit log you can edit
-- or erase is not an audit log.

-- ── 2. Who may delete ───────────────────────────────────────────────────────
-- Replaces db/01's "any member may delete anything".
--
-- An expense may be removed by the person it says PAID for it, or by the group
-- owner as the backstop for mistakes and for expenses attributed to ghosts
-- (a ghost has no user_id, so nobody can match it — the owner is the only route).
drop policy if exists "members delete expenses" on public.expenses;
drop policy if exists "payer or owner deletes expenses" on public.expenses;
create policy "payer or owner deletes expenses" on public.expenses
  for delete using (
    exists (
      select 1 from public.groups g
      where g.id = expenses.group_id and g.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.group_members m
      where m.id = expenses.paid_by and m.user_id = auth.uid()
    )
  );

-- A settlement records a payment between two people. EITHER party may remove it
-- — the sender if they recorded it wrongly, the recipient if they were credited
-- with money they never received — plus the owner. This is deliberately wider
-- than the expense rule: both names on a settlement have an equal, direct stake
-- in whether it stands.
drop policy if exists "members delete settlements" on public.settlements;
drop policy if exists "party or owner deletes settlements" on public.settlements;
create policy "party or owner deletes settlements" on public.settlements
  for delete using (
    exists (
      select 1 from public.groups g
      where g.id = settlements.group_id and g.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.group_members m
      where m.id in (settlements.from_member, settlements.to_member)
        and m.user_id = auth.uid()
    )
  );
