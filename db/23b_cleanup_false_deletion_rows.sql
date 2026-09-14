-- ONE-OFF REPAIR, not a schema change. Run once, after the app build that
-- contains the fix is live. Safe to re-run (it simply finds nothing).
--
-- WHAT WENT WRONG. db/23 narrowed deletes to the payer or the group owner. RLS
-- does not report a refusal as an error: when the policy excludes a row,
-- PostgREST deletes NOTHING and still returns success. The app checked only for
-- an error, so it believed every delete had worked. It therefore:
--   * removed the expense from the screen optimistically,
--   * wrote an audit row claiming the person had deleted it,
--   * and then the next refetch brought the expense back, because it had never
--     actually been deleted.
-- The owner retried, so the same false entry was logged four times, while the
-- expense sat there at its original amount. The app was wrong in both
-- directions at once: it claimed a deletion that did not happen, and it hid an
-- expense that still existed.
--
-- Fixed in the app by asking for the deleted rows back (`.select('id')` on the
-- delete) and treating "zero rows, no error" as a refusal — so the audit row is
-- only ever written when the server actually removed something.
--
-- THIS SCRIPT cleans up the false entries that the bug already wrote. It is
-- deliberately conservative: it deletes an audit row ONLY when the thing it
-- claims was deleted is demonstrably still present. A genuine deletion leaves
-- no such row behind, so real history cannot be touched by this.
--
-- WHY THIS NEEDS THE SQL EDITOR. `expense_deletions` has no update or delete
-- policy on purpose — the log is append-only to everyone using the app, which
-- is what makes it worth trusting. The dashboard runs as the table owner and
-- bypasses RLS, so the repair is possible for you and impossible for a user.
-- That is the intended shape, not a loophole.

-- Have a look at what will go, before it goes.
select d.id, d.kind, d.description, d.amount, d.deleted_by_name, d.deleted_at
  from public.expense_deletions d
 where (d.kind = 'expense'
        and exists (select 1 from public.expenses e where e.id = d.item_id))
    or (d.kind = 'settlement'
        and exists (select 1 from public.settlements s where s.id = d.item_id))
 order by d.deleted_at desc;

-- Then remove them.
delete from public.expense_deletions d
 where (d.kind = 'expense'
        and exists (select 1 from public.expenses e where e.id = d.item_id))
    or (d.kind = 'settlement'
        and exists (select 1 from public.settlements s where s.id = d.item_id));
