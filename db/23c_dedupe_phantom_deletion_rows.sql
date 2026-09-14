-- ONE-OFF REPAIR. Run once. Safe to re-run (it finds nothing the second time).
--
-- WHAT IT CLEANS UP. Before the app learned to notice a refused delete, every
-- rejected attempt still wrote an audit row claiming the deletion had happened.
-- The owner retried four times in four seconds, so the log holds FOUR entries
-- for one 500.00 expense called "test" - of which at most one is real.
--
-- WHY db/23b COULD NOT CATCH THESE. That script removed audit rows whose target
-- still existed, which is a sound test for "this deletion never happened". But
-- by the time it ran, someone authorised had genuinely deleted that expense - so
-- all four rows pointed at something legitimately gone and all four looked
-- honest. The signal is not "does the target exist" but "the same person cannot
-- have deleted the same thing four times in four seconds".
--
-- THE RULE USED HERE, deliberately narrow: within one (item_id, deleted_by),
-- keep the EARLIEST row and drop the rest. Not a time window, not a fuzzy
-- match - an item can only be deleted once, so any second row for the same item
-- by the same person is by definition a duplicate. The earliest is kept because
-- if one of the attempts did succeed it was the first one to reach the server.
--
-- Rows with a NULL item_id are left alone: without an id there is nothing to
-- group on, and guessing would risk deleting real history.
--
-- WHY THE SQL EDITOR. `expense_deletions` has no update or delete policy - it is
-- append-only to everyone using the app, which is what makes it worth trusting.
-- The dashboard runs as the table owner and bypasses RLS, so this repair is
-- possible for you and impossible for a user. That is the design, not a gap.

-- Look first. Anything listed here is about to go.
with ranked as (
  select id, item_id, kind, description, amount, deleted_by_name, deleted_at,
         row_number() over (
           partition by item_id, deleted_by
           order by deleted_at asc
         ) as attempt_no
    from public.expense_deletions
   where item_id is not null
)
select attempt_no, kind, description, amount, deleted_by_name, deleted_at
  from ranked
 where attempt_no > 1
 order by deleted_at desc;

-- Then remove them.
with ranked as (
  select id,
         row_number() over (
           partition by item_id, deleted_by
           order by deleted_at asc
         ) as attempt_no
    from public.expense_deletions
   where item_id is not null
)
delete from public.expense_deletions d
 using ranked r
 where d.id = r.id
   and r.attempt_no > 1;

-- What is left, to confirm.
select description, amount, deleted_by_name, deleted_at
  from public.expense_deletions
 order by deleted_at desc
 limit 20;
