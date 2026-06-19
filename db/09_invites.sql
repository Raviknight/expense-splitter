-- ============================================================
-- Auto-connect invites. Run this ONCE in the Supabase SQL Editor.
--
-- WHAT IT DOES:
--   When you invite someone by email, we remember the invite (with a secret
--   token) and who/what it was for. When that person signs up and opens their
--   invite link, the app calls accept_invite(token), which — running with
--   elevated rights — automatically:
--     1. creates an ACCEPTED connection between the two of you, and
--     2. links the ghost member you created to their new account (so they join
--        the group and the ghost's expenses become theirs).
--   No manual handshake, no manual linking.
--
--   Security: accept_invite verifies the signed-in user's email matches the
--   address the invite was sent to, so a forwarded link can't attach expenses
--   to the wrong person.
-- ============================================================

create table if not exists invites (
  id              uuid primary key default gen_random_uuid(),
  token           text unique not null,
  inviter         uuid not null references profiles(id) on delete cascade,
  email           text not null,
  group_id        uuid references groups(id) on delete cascade,
  ghost_member_id uuid references group_members(id) on delete set null,
  status          text not null default 'pending' check (status in ('pending','accepted')),
  created_at      timestamptz default now()
);

alter table invites enable row level security;

-- The inviter may create invites as themselves and read their own.
drop policy if exists "inviter inserts invite" on invites;
drop policy if exists "inviter reads invite"   on invites;
create policy "inviter inserts invite" on invites
  for insert with check (inviter = auth.uid());
create policy "inviter reads invite" on invites
  for select using (inviter = auth.uid());

-- Accept an invite by its token. SECURITY DEFINER so it can create the accepted
-- connection (normally only the addressee can accept) and link the ghost member
-- (normally owner-only) — but only AFTER validating the token + email.
create or replace function accept_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv        invites;
  me         uuid := auth.uid();
  my_email   text;
  inviter_nm text;
  group_nm   text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  select * into inv from invites where token = invite_token and status = 'pending' limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This invite is invalid or already used.');
  end if;

  if inv.inviter = me then
    update invites set status = 'accepted' where id = inv.id;
    return jsonb_build_object('ok', false, 'error', 'own invite');
  end if;

  -- The signed-in user's email must match the address the invite was sent to.
  select email into my_email from auth.users where id = me;
  if lower(coalesce(my_email, '')) <> lower(inv.email) then
    return jsonb_build_object('ok', false, 'error',
      'This invite was sent to a different email address.');
  end if;

  -- 1) Accepted connection between inviter and the new user.
  insert into connections (requester, addressee, status)
    values (inv.inviter, me, 'accepted')
    on conflict (requester, addressee) do update set status = 'accepted';

  -- 2) Link the ghost member to the new user (only if it is still a ghost).
  if inv.ghost_member_id is not null then
    update group_members
       set user_id = me, ghost_name = null
     where id = inv.ghost_member_id
       and user_id is null;
  end if;

  -- 3) Mark the invite used.
  update invites set status = 'accepted' where id = inv.id;

  select display_name into inviter_nm from profiles where id = inv.inviter;
  select name         into group_nm   from groups   where id = inv.group_id;

  return jsonb_build_object('ok', true, 'inviter', inviter_nm, 'group', group_nm);
end;
$$;

grant execute on function accept_invite(text) to authenticated;

-- Done. Re-deploy the send-invite Edge Function (it now creates an invite row),
-- and the app will auto-connect invitees when they sign up.
