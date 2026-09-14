-- PART 1 of 3. Run this first, on its own.
--
-- Creates one helper function used by db/21b and db/22. Nothing else is in this
-- file on purpose: the Supabase dashboard's SQL editor splits a pasted script
-- into statements itself, and it mis-handles files containing more than one
-- dollar-quoted block — it failed on the original combined migration with
-- "unterminated dollar-quoted string", then with "syntax error at end of input"
-- once the quotes were named. db/20 ran cleanly with exactly ONE such block, so
-- this file has exactly one and nothing more.
--
-- WHAT IT DOES: answers "does the signed-in user share at least one group with
-- this other person?".
--
-- `security definer` is load-bearing, not an optimisation. Without it, a policy
-- on `profiles` or `payment_notes` that reads `group_members` would itself be
-- filtered by `group_members`'s own policy, which calls `is_member_of`, and
-- Postgres can end up recursing. db/01 solved exactly this problem the same way
-- (see the comment above `is_member_of` there), so this follows the pattern
-- already established in this schema rather than inventing a new one.
--
-- `stable` lets the planner reuse the result within a statement. It is called
-- once per candidate row, so this matters.
--
-- Safe to re-run.

create or replace function public.shares_group_with(other uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select exists (
    select 1
      from group_members mine
      join group_members theirs on theirs.group_id = mine.group_id
     where mine.user_id   = auth.uid()
       and theirs.user_id = other
  );
$fn$;
