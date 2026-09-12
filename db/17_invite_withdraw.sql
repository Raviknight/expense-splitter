-- Let an inviter withdraw an invite they sent.
--
-- `invites` had policies for INSERT and SELECT but none for DELETE, so an
-- invite could never be taken back: the link stayed live forever and the sender
-- had no way to cancel it. See docs-internal/invite-state-machine.md.
--
-- Withdrawal deletes the row. accept_invite() looks the token up, so a deleted
-- row makes the emailed link stop working immediately — no separate revocation
-- list to keep in step.
--
-- ACCEPTED invites are deliberately NOT deletable: they record how someone
-- joined, and removing that would erase the audit trail. The policy below only
-- matches rows still pending.
--
-- Run once in the Supabase dashboard -> SQL Editor.

drop policy if exists "inviter withdraws invite" on public.invites;
create policy "inviter withdraws invite"
  on public.invites for delete
  to authenticated
  using (inviter = auth.uid() and status = 'pending');

-- The sent-invites list filters by inviter and orders newest first.
create index if not exists invites_inviter_created_idx
  on public.invites (inviter, created_at desc);
