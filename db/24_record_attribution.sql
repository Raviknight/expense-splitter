-- Who recorded this, and who may record it at all.
--
-- Run in Supabase -> SQL Editor. No dollar-quoted blocks. Safe to re-run.
-- Order does not matter relative to the app: see the note at the bottom.
--
-- ── THE HOLE THIS CLOSES ─────────────────────────────────────────────────────
-- db/23 restricted who may DELETE an expense or settlement, and left CREATING
-- them wide open:
--
--     members add settlements  ->  with check (is_member_of(group_id))
--
-- So any member could record any payment between any two people. Recording
-- "Alex paid Ravi 500" wipes a debt that was never paid — and because there was
-- no record of who entered it, nobody could tell where it came from.
--
-- That is strictly worse than the deletion problem already fixed. A deletion is
-- now audited and attributed; a fabricated settlement was silent, unattributed,
-- and zeroed real money owed. Locking the back door while the front door stood
-- open was the wrong half to do first.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────
-- 1. `created_by` on expenses and settlements, so every record says who entered
--    it. The app shows "recorded by …".
-- 2. Recording a settlement now requires being one of the two people in it, or
--    the group owner.
-- 3. The DELETE rules gain the CREATOR, which fixes a limitation noted when
--    db/23 shipped: someone who added an expense and correctly attributed it to
--    another person could not then delete their own mis-entry. Now they can.
--
-- ── WHY THE OWNER KEEPS A BACKSTOP ───────────────────────────────────────────
-- Decided deliberately rather than by default. A settlement between two GHOST
-- members has no account on either side, so if only the two parties could
-- record it, it could never be recorded at all. The owner also has to be able
-- to correct a mistake. The risk was never that the owner has this power — it
-- is that the power was INVISIBLE. `created_by` is what makes it accountable,
-- which is why the two changes belong in one migration.
--
-- Note the ghost case is narrower than it first appears: when a ghost pays a
-- real user, the RECEIVER has an account and is a party, so they can record it
-- themselves. Only ghost-to-ghost genuinely needs the owner.

-- ── 1. Attribution ───────────────────────────────────────────────────────────
-- Nullable, and `on delete set null`, for the same reason as
-- expense_deletions.deleted_by: the record must outlive the account. Existing
-- rows keep a NULL, which the app renders as "recorded by someone" rather than
-- inventing an author — guessing would be worse than admitting we do not know.
alter table public.expenses
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.settlements
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- ── 2. Recording a settlement ────────────────────────────────────────────────
-- Either party, or the group owner. Mirrors the delete rule from db/23 on
-- purpose: one concept to hold in your head rather than two.
--
-- `created_by` is checked too — it may be left NULL (an older app build that
-- does not set it yet) but if it IS set it must be the caller. Otherwise the
-- attribution could be forged, which would make it worse than useless: a
-- record that names the wrong person is more damaging than one that names
-- nobody.
drop policy if exists "members add settlements" on public.settlements;
drop policy if exists "party or owner adds settlements" on public.settlements;
create policy "party or owner adds settlements" on public.settlements
  for insert with check (
    is_member_of(group_id)
    and (created_by is null or created_by = auth.uid())
    and (
      exists (
        select 1 from public.groups g
        where g.id = group_id and g.owner_id = auth.uid()
      )
      or exists (
        select 1 from public.group_members m
        where m.id in (from_member, to_member) and m.user_id = auth.uid()
      )
    )
  );

-- Adding an EXPENSE stays open to any member, deliberately. Recording a shared
-- cost is ordinary collaborative behaviour — "I'll add the hotel" — and
-- restricting it would break normal use for a risk that attribution already
-- addresses. The same forgery guard applies.
drop policy if exists "members add expenses" on public.expenses;
drop policy if exists "members add expenses attributed" on public.expenses;
create policy "members add expenses attributed" on public.expenses
  for insert with check (
    is_member_of(group_id)
    and (created_by is null or created_by = auth.uid())
  );

-- ── 3. Deleting: the creator may remove their own mis-entry ──────────────────
-- Replaces db/23's rules, adding the creator. Everything else is unchanged.
drop policy if exists "payer or owner deletes expenses" on public.expenses;
drop policy if exists "payer creator or owner deletes expenses" on public.expenses;
create policy "payer creator or owner deletes expenses" on public.expenses
  for delete using (
    exists (
      select 1 from public.groups g
      where g.id = expenses.group_id and g.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.group_members m
      where m.id = expenses.paid_by and m.user_id = auth.uid()
    )
    or expenses.created_by = auth.uid()
  );

drop policy if exists "party or owner deletes settlements" on public.settlements;
drop policy if exists "party creator or owner deletes settlements" on public.settlements;
create policy "party creator or owner deletes settlements" on public.settlements
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
    or settlements.created_by = auth.uid()
  );

-- ── ORDER RELATIVE TO THE APP ────────────────────────────────────────────────
-- Either order is safe, which is the point of allowing `created_by` to be NULL.
--   * Migration first: an older build inserts without created_by, the column is
--     nullable, nothing breaks. Those rows simply have no author recorded.
--   * App first: it inserts WITH created_by, the column does not exist yet, and
--     the app falls back to an insert without it — the same graceful
--     degradation used for avatar_url (db/08) and payment_note (db/20).
-- The one visible change the moment this runs: a member who is NEITHER party to
-- a settlement NOR the owner can no longer record it. The app predicts that and
-- explains it rather than letting the insert fail with a raw error.
