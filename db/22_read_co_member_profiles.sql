-- Let people in the same group see each other's names.
--
-- THE BUG THIS FIXES. In a group of three or more, members who are not
-- connected to each other showed up as the literal string "Unknown" — in the
-- member list, in the balances, and in settle-up suggestions ("Unknown pays
-- Ravi $40"). That makes the app unusable for its main purpose: you cannot tell
-- who owes what, or who you owe, if you cannot read their name.
--
-- WHY IT HAPPENED. Reads of `profiles` are governed by db/01's "read connected
-- profiles" policy, which requires a `connections` row between you and the
-- profile you are reading. But CO-MEMBERS ARE NEVER AUTO-CONNECTED:
--   * App.jsx only offers the GROUP OWNER's accepted connections as candidates
--     when linking a member (`useConnections().accepted`), and
--   * db/09's invite flow inserts a connection between the INVITER and the new
--     user only.
-- Nothing anywhere connects two non-owner members to each other. So in a group
-- of Ravi (owner) + Shailja + Alex, Shailja and Alex have no connection, the
-- policy denies the read, and `memberDisplayName` in store.js falls back to
-- 'Unknown'.
--
-- It went unnoticed because every group so far has been 2-person, where the
-- only other member IS the owner's connection. It appears the moment anyone
-- builds a real 3-person group — which is the app's whole point.
--
-- WHY A POLICY RATHER THAN AUTO-CREATING CONNECTIONS. Silently inserting
-- connection rows when someone joins a group would overload what "connection"
-- means: it is a mutual, consented relationship the user manages on the
-- Connections screen, and forging it as a side effect would put people in each
-- other's contact lists without either of them agreeing. Worse, because db/01's
-- existing policy ignores `status`, a forged row would hand over MORE than a
-- name. A read policy scoped to shared group membership grants exactly what is
-- needed and nothing else.
--
-- WHAT THIS DOES NOT DO. It does not touch the existing "read connected
-- profiles" policy, so it does not fix the separate problem that a PENDING or
-- DECLINED request still grants profile reads (BACKLOG #22). That needs its own
-- change, and it needs care: useConnections.js reads the profiles on BOTH sides
-- of every connection row, including pending ones, so naively requiring
-- 'accepted' there would blank out the names on your own sent invites.
--
-- Safe to re-run. Run AFTER db/21. Run once in the Supabase dashboard -> SQL Editor.

-- Same helper db/21 defines, repeated verbatim so this file stands alone.
-- `security definer` is what prevents infinite recursion: without it, a policy
-- on `profiles` that reads `group_members` would be filtered by
-- `group_members`'s own policy, which calls `is_member_of`. db/01 uses exactly
-- this pattern for the same reason.
create or replace function public.shares_group_with(other uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from group_members mine
      join group_members theirs on theirs.group_id = mine.group_id
     where mine.user_id   = auth.uid()
       and theirs.user_id = other
  );
$$;

-- The new read path. Policies are OR'd, so this ADDS to "read own profile" and
-- "read connected profiles" rather than replacing either — nothing that works
-- today stops working.
drop policy if exists "read co-member profiles" on public.profiles;
create policy "read co-member profiles" on public.profiles
  for select using (public.shares_group_with(profiles.id));
