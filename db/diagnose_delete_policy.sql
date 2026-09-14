-- DIAGNOSTIC ONLY. Changes nothing. Run in Supabase -> SQL Editor and send me
-- the output of all three queries.
--
-- Question being answered: when Ravikant deletes an expense in "Test Group" and
-- sees no refusal, is that
--   (a) correct — he owns the group, and the policy is "payer OR OWNER", or
--   (b) the policy never actually installed, or
--   (c) something else.
-- Guessing between these wastes your time, so let's look.

-- 1. WHO OWNS THE GROUPS, and who is who. If Ravikant is the owner of the group
--    being tested, "no refusal" is the policy working exactly as designed and
--    there is nothing to fix — the test simply needs an account that is neither
--    the payer nor the owner.
select g.name          as group_name,
       p.display_name  as owner_name,
       p.email         as owner_email
  from public.groups g
  join public.profiles p on p.id = g.owner_id
 order by g.name;

-- 2. IS THE NEW POLICY ACTUALLY THERE? db/23 dropped "members delete expenses"
--    and created "payer or owner deletes expenses". If the old name still shows
--    up here, or the new one is missing, the migration did not take effect the
--    way we think and everything downstream is moot.
select polname as policy_name,
       case polcmd when 'd' then 'DELETE' when 'r' then 'SELECT'
                   when 'a' then 'INSERT' when 'w' then 'UPDATE'
                   else polcmd::text end as applies_to
  from pg_policy
 where polrelid = 'public.expenses'::regclass
 order by applies_to, policy_name;

-- 3. WHAT THE AUDIT LOG HOLDS NOW. After db/23b this should contain only real
--    deletions — entries whose expense is genuinely gone. If a row appears here
--    for an expense you can still see in the app, the "reports success on a
--    refusal" bug is still happening and I have more work to do.
select d.description,
       d.amount,
       d.deleted_by_name,
       d.deleted_at,
       case when d.kind = 'expense'
                 and exists (select 1 from public.expenses e where e.id = d.item_id)
            then 'STILL EXISTS - false entry'
            else 'really gone - correct' end as reality_check
  from public.expense_deletions d
 order by d.deleted_at desc
 limit 20;
