-- ============================================================
-- Allow the group owner to LINK a ghost member to a real account.
-- Run this ONCE in the Supabase SQL Editor (like the other db/ scripts).
--
-- WHY THIS EXISTS, in plain language:
--   A "ghost" is a person with no account that you added by name. When that
--   person later signs up AND you two have an ACCEPTED connection, you can
--   "link" them: the app sets user_id on their existing group_members row and
--   clears ghost_name. Keeping the SAME row means all their past expenses stay
--   attached (expenses.paid_by points at that row's id).
--
--   The original schema only had INSERT and DELETE rules for group_members, so
--   an UPDATE was blocked. This adds a narrow UPDATE rule with the SAME safety
--   check used when adding a real member: you can only attach a user_id that
--   belongs to an accepted connection of yours.
-- ============================================================

create policy "owner links members" on group_members
  for update
  using (
    -- You may update member rows only in groups you own.
    exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid())
    and (
      ghost_name is not null            -- still a ghost, allowed
      or user_id = auth.uid()           -- linking to yourself, allowed
      or exists (                       -- linking to a real, accepted connection
        select 1 from connections c
        where c.status = 'accepted'
          and ((c.requester = auth.uid() and c.addressee = group_members.user_id)
            or (c.addressee = auth.uid() and c.requester = group_members.user_id))
      )
    )
  );

-- Done. The app's "Link to account" action on a ghost member now works.
