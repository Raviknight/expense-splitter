-- ============================================================
-- Per-expense participants. Run this ONCE in the Supabase SQL Editor.
--
-- THE PROBLEM IT FIXES:
--   Equal/Full splits used to divide among whoever is CURRENTLY in the group.
--   So adding a new member later retroactively changed who owed what on OLD
--   expenses. That's wrong — an expense should only ever be split among the
--   people who were in on it.
--
-- THE FIX:
--   Each expense now records `participants` — a JSON array of the group_members
--   ids it is split among (frozen when the expense is created). The balance math
--   splits an expense among ITS participants, not the live group membership.
--
--   Backfill below LOCKS every existing expense to its group's current members,
--   so past expenses stop changing when you add someone new from now on.
-- ============================================================

alter table expenses add column if not exists participants jsonb;

-- Lock existing expenses to their group's current members (one-time snapshot).
update expenses e
set participants = (
  select coalesce(jsonb_agg(gm.id), '[]'::jsonb)
  from group_members gm
  where gm.group_id = e.group_id
)
where e.participants is null;

-- Done. New expenses store the members present at creation; adding a member
-- later no longer affects older expenses.
