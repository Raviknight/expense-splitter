-- DIAGNOSTIC ONLY. Changes nothing.
--
-- Query 2 proved the delete policy installed correctly: the only DELETE policy
-- on `expenses` is "payer or owner deletes expenses", and db/01's permissive
-- "members delete expenses" is gone. So the rule is in force.
--
-- Which means a delete that goes through UNCHALLENGED is not a failure of the
-- policy — it means the person doing it satisfied the rule. The likeliest
-- reason a test shows no refusal is simply that the tester PAID for the expense
-- they are deleting, which the policy allows on purpose.
--
-- This lists every expense with the two facts that decide it, so a test can be
-- aimed at a row that SHOULD be refused instead of one that should not.
--
-- Look for a row where `delete_allowed_for` names someone who is NOT the
-- account you are testing with. Deleting that row should now show
-- "Only the person who paid, or the group owner, can delete this."

select g.name                        as group_name,
       e.name                        as expense,
       e.amount,
       -- Who the expense says paid. A ghost member has no account, so nobody
       -- can match it and only the owner can delete — that is intended.
       coalesce(payer.display_name, m.ghost_name, 'unknown') as paid_by,
       owner.display_name            as group_owner,
       -- The two people the policy will accept, spelled out.
       concat_ws(' or ',
                 coalesce(payer.display_name, m.ghost_name),
                 owner.display_name) as delete_allowed_for
  from public.expenses e
  join public.groups        g      on g.id = e.group_id
  join public.profiles      owner  on owner.id = g.owner_id
  left join public.group_members m  on m.id = e.paid_by
  left join public.profiles     payer on payer.id = m.user_id
 order by g.name, e.date desc, e.name;
