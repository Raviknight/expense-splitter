-- DIAGNOSTIC ONLY. Changes nothing. Run all four and send the output.
--
-- Everything checked so far says this should work, and it does not. Confirmed so
-- far: the delete policy EXISTS and the old permissive one is gone (query 2);
-- the app has exactly one delete path and it is the fixed one; the error banner
-- is now pinned to the viewport so a raised error cannot be missed.
--
-- The thing never checked: whether row-level security is actually ENABLED on the
-- table. A policy on a table with RLS switched off is completely inert — it
-- exists, it lists correctly in pg_policy, and Postgres ignores it entirely.
-- That would explain every symptom precisely: the delete succeeds, no error is
-- raised, so no banner appears no matter where it is rendered.

-- 1. IS RLS ON? `rowsecurity` must be true for the policy to mean anything.
--    If this says false for `expenses`, that is the whole answer.
select c.relname                      as table_name,
       c.relrowsecurity               as rls_enabled,
       c.relforcerowsecurity          as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('expenses','settlements','expense_deletions','groups','group_members')
 order by c.relname;

-- 2. WHO IS WHO. Needed to read query 3.
select id, display_name, email from public.profiles order by display_name;

-- 3. WOULD THE POLICY ALLOW IT? Evaluates the exact predicate from db/23 for
--    every expense in Test Group, for EVERY member — so we can see plainly who
--    Postgres would permit, without signing in as anyone.
--    `can_delete` false for Ravikant means the rule is correct and the problem
--    is enforcement; true means the rule itself is wrong.
select g.name                as group_name,
       e.name                as expense,
       p.display_name        as acting_as,
       exists (select 1 from public.groups g2
                where g2.id = e.group_id and g2.owner_id = p.id)      as is_owner,
       exists (select 1 from public.group_members m
                where m.id = e.paid_by and m.user_id = p.id)          as is_payer,
       (exists (select 1 from public.groups g2
                 where g2.id = e.group_id and g2.owner_id = p.id)
        or exists (select 1 from public.group_members m
                    where m.id = e.paid_by and m.user_id = p.id))     as can_delete
  from public.expenses e
  join public.groups g on g.id = e.group_id
  join public.group_members gm on gm.group_id = g.id
  join public.profiles p on p.id = gm.user_id
 where g.name ilike '%test%'
 order by e.name, p.display_name;

-- 4. WHICH ROLE DOES THE APP CONNECT AS? A signed-in user should be
--    `authenticated`. If anything here is unexpected — or if grants were handed
--    to a role that bypasses RLS — policies would not apply.
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name   = 'expenses'
 order by grantee, privilege_type;
