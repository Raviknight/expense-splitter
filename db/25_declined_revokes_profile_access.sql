-- Make declining a connection actually revoke something (backlog #22).
--
-- Run in Supabase -> SQL Editor. No dollar-quoted blocks. Safe to re-run.
-- Run AFTER the app build that stops listing declined requests — see the note
-- at the bottom for why that order, though neither order breaks anything.
--
-- ── THE PROBLEM ──────────────────────────────────────────────────────────────
-- db/01's "read connected profiles" policy grants a profile read whenever a
-- `connections` row EXISTS between two people:
--
--     exists (select 1 from connections c
--             where (c.requester = auth.uid() and c.addressee = profiles.id)
--                or (c.addressee = auth.uid() and c.requester = profiles.id))
--
-- It never looks at `c.status`, which can be 'pending', 'accepted' or
-- 'declined'. So sending someone a request granted immediate access to their
-- profile row, and DECLINING IT TOOK NOTHING AWAY — the row stays (it has to,
-- it is what enforces the re-request cool-off) and so did the access.
--
-- "Declined" that revokes nothing is a checkbox, not a decision. This is the
-- last piece of #22; the payment note was already moved out of `profiles`
-- (db/21) precisely because this policy could not be trusted with it.
--
-- ── WHAT REPLACES IT ─────────────────────────────────────────────────────────
-- Accepted, or still pending. Nothing on declined.
--
-- PENDING IS DELIBERATELY ALLOWED IN BOTH DIRECTIONS, which looks lax and is
-- not. The person being asked must see WHO is asking, or "Ravi wants to connect"
-- becomes an anonymous prompt they cannot judge. And the asker must see who they
-- asked, or their own sent list is a row of strangers. Requiring 'accepted' here
-- was the obvious fix and it is wrong: it blanks out both screens and teaches
-- people to accept blind, which is worse for privacy than the leak it closes.
--
-- The exposure that remains on pending is bounded and one-way-ish: to create the
-- row at all you must already know the person's email address, so the only new
-- fact is a display name. Declining now ends even that.
--
-- ── WHAT IS NOT AFFECTED ─────────────────────────────────────────────────────
--   * "read own profile" (db/01) — untouched.
--   * "read co-member profiles" (db/22) — untouched. Sharing a group still
--     grants a name, which is what stopped group members rendering as
--     "Unknown". A declined connection between two people who ALSO share a
--     group keeps working through that policy, which is correct: you can see
--     the name of someone you are splitting money with regardless of whether
--     you are social contacts.
--   * The connections table itself — reads of your own rows are unchanged, so
--     the decline cool-off (Connections.jsx) still finds the row it needs.

drop policy if exists "read connected profiles" on public.profiles;
drop policy if exists "read active connection profiles" on public.profiles;
create policy "read active connection profiles" on public.profiles
  for select using (
    exists (
      select 1 from public.connections c
      where c.status in ('accepted', 'pending')
        and (
             (c.requester = auth.uid() and c.addressee = profiles.id)
          or (c.addressee = auth.uid() and c.requester = profiles.id)
        )
    )
  );

-- ── ORDER RELATIVE TO THE APP ────────────────────────────────────────────────
-- The app change drops declined requests from the "Sent requests" list, because
-- a dead request that you were never told was refused is just clutter — and
-- without it, such a row would render as "Unknown user" next to a red DECLINED
-- pill once this policy lands.
--
-- Running this migration FIRST is therefore cosmetically worse for a moment
-- (those rows show "Unknown user") but breaks nothing. Running the app first is
-- tidier. Neither order loses data or blocks anyone.
