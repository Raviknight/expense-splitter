-- FIX: nobody can EDIT their payment note, only set it once.
--
-- THE SYMPTOM. Saving a payment note failed with
--
--   42501  new row violates row-level security policy (USING expression)
--          for table "payment_notes"
--
-- THE CAUSE, confirmed against production on 2026-09-18 by listing pg_policies
-- rather than trusting the migration file: payment_notes has FOUR policies, not
-- six. The three SELECT policies and the INSERT policy are present. The UPDATE
-- and DELETE policies defined at the end of db/21b are ABSENT.
--
-- With row-level security enabled and no policy for a command, Postgres denies
-- that command outright, and reports it as the USING expression failing. The
-- app saves with an upsert -- INSERT ... ON CONFLICT (user_id) DO UPDATE -- so:
--
--     first ever save  -> INSERT path  -> insert policy exists  -> works
--     every edit after -> UPDATE path  -> no update policy      -> 42501
--
-- Which is why this looked intermittent and personal rather than systematic. It
-- is systematic: EVERY user can set a payment note once and never change it.
-- Anyone whose note was carried over by db/21c had a row from the start, so for
-- them it never worked at all.
--
-- WHY THE POLICIES ARE MISSING. db/21b creates them in this order: read own,
-- read accepted connection, read co-member, insert, update, delete. Exactly the
-- first four exist. That is the signature of a script that stopped partway
-- through -- the same failure seen earlier the same day, where "policy already
-- exists" (42710) aborted a run and everything after that line silently did not
-- happen. A green-looking SQL editor after a partial run is indistinguishable
-- from a successful one, which is the real lesson here.
--
-- WHY THIS IS A NEW FILE rather than "just run db/21b again". Re-running db/21b
-- would work, but it would also re-run the table creation and the three SELECT
-- policies, and if any of those now errors the run aborts again BEFORE reaching
-- the two policies that are actually missing -- reproducing the original bug
-- while appearing to fix it. This file does one thing and cannot half-succeed
-- in a way that matters.
--
-- Safe to re-run. drop-then-create is idempotent, and dropping a policy that is
-- not there is a no-op.


-- Writes are yours alone. `using` decides which existing rows you may touch;
-- `with check` decides what the row is allowed to look like afterwards. Both
-- are needed on UPDATE, otherwise a row could be edited into pointing at
-- somebody else.
drop policy if exists "update own payment note" on public.payment_notes;
create policy "update own payment note" on public.payment_notes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own payment note" on public.payment_notes;
create policy "delete own payment note" on public.payment_notes
  for delete using (user_id = auth.uid());


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY. Run this after the two statements above. It must return SIX rows:
-- three SELECT, one INSERT, one UPDATE, one DELETE.
--
-- Checking pg_policies rather than assuming the script worked is the entire
-- point -- assuming it worked is what produced this bug.
-- ═════════════════════════════════════════════════════════════════════════════

select cmd        as applies_to,
       policyname,
       qual       as using_expression,
       with_check as with_check_expression
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'payment_notes'
 order by cmd, policyname;
