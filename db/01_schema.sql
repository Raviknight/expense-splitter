-- ============================================================
-- Expense Splitter - Supabase schema, security, and privacy rules
-- Run this ONCE in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- What this file does, in plain language:
--   1. Creates the tables that hold profiles, friend-connections,
--      groups, members, expenses, and settlements.
--   2. Turns on Row-Level Security (RLS). RLS is the rule layer that
--      decides, per row, who is allowed to read or change it. Even though
--      everyone shares one database, RLS guarantees you can only ever see
--      your own data and data from groups you belong to.
--   3. Auto-creates a profile row whenever someone signs up.
--   4. Turns on realtime so a new expense shows up live on both phones.
--
-- You do not need to understand every line. The comments mark the parts
-- that matter if you ever want to change behavior.
-- ============================================================


-- ------------------------------------------------------------
-- TABLES
-- ------------------------------------------------------------

-- One row per signed-up user. id matches Supabase's auth user id.
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email        text,
  created_at   timestamptz default now()
);

-- The friend handshake. A connection is only usable once status = 'accepted'.
create table if not exists connections (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null references profiles(id) on delete cascade,
  addressee  uuid not null references profiles(id) on delete cascade,
  status     text not null default 'pending'
             check (status in ('pending','accepted','declined')),
  created_at timestamptz default now(),
  unique (requester, addressee)
);

-- A group is a container for expenses. type 'solo' = just you, 'shared' = with others.
create table if not exists groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references profiles(id) on delete cascade,
  type       text not null default 'shared' check (type in ('solo','shared')),
  created_at timestamptz default now()
);

-- A member is EITHER a real connected user (user_id set) OR a ghost
-- (ghost_name set) - a person not on the platform, for your own tracking.
-- The check makes sure exactly one of the two is filled in.
create table if not exists group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  user_id    uuid references profiles(id) on delete cascade,
  ghost_name text,
  created_at timestamptz default now(),
  check ((user_id is not null) <> (ghost_name is not null))
);

-- An expense belongs to a group and is paid by one of that group's members.
create table if not exists expenses (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  name       text not null,
  amount     numeric(12,2) not null,
  date       date not null,
  category   text not null default 'Other',
  paid_by    uuid not null references group_members(id) on delete cascade,
  split_mode text not null default 'equal'
             check (split_mode in ('equal','full','personal')),
  note       text,
  created_at timestamptz default now()
);

-- A settlement records a real payment from one member to another (the "settle up").
create table if not exists settlements (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  from_member uuid not null references group_members(id),
  to_member   uuid not null references group_members(id),
  amount      numeric(12,2) not null,
  date        date not null,
  note        text,
  created_at  timestamptz default now()
);


-- ------------------------------------------------------------
-- HELPER FUNCTION (this is what prevents the infinite-recursion bug)
--
-- "security definer" means this function runs with elevated rights and
-- bypasses RLS while it checks membership. That breaks the loop where a
-- policy on group_members would otherwise query group_members forever.
-- ------------------------------------------------------------
create or replace function is_member_of(g uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = g and user_id = auth.uid()
  );
$$;


-- ------------------------------------------------------------
-- AUTO-CREATE A PROFILE ON SIGNUP
-- When a new auth user is created, copy a profile row for them.
-- ------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ------------------------------------------------------------
-- TURN ON ROW-LEVEL SECURITY
-- ------------------------------------------------------------
alter table profiles      enable row level security;
alter table connections   enable row level security;
alter table groups        enable row level security;
alter table group_members enable row level security;
alter table expenses      enable row level security;
alter table settlements   enable row level security;


-- ------------------------------------------------------------
-- POLICIES: profiles
-- You can always see your own profile. You can also see the profile of
-- anyone you have a connection with (so the app can show their name).
-- ------------------------------------------------------------
create policy "read own profile" on profiles
  for select using (id = auth.uid());

create policy "read connected profiles" on profiles
  for select using (
    exists (
      select 1 from connections c
      where (c.requester = auth.uid() and c.addressee = profiles.id)
         or (c.addressee = auth.uid() and c.requester = profiles.id)
    )
  );

create policy "insert own profile" on profiles
  for insert with check (id = auth.uid());

create policy "update own profile" on profiles
  for update using (id = auth.uid());


-- ------------------------------------------------------------
-- POLICIES: connections (the handshake)
-- You see connections you are part of. You can send a request as yourself.
-- Only the person who received it can accept or decline it.
-- ------------------------------------------------------------
create policy "read own connections" on connections
  for select using (requester = auth.uid() or addressee = auth.uid());

create policy "send connection" on connections
  for insert with check (requester = auth.uid());

create policy "respond to connection" on connections
  for update using (addressee = auth.uid());

create policy "cancel own request" on connections
  for delete using (requester = auth.uid() or addressee = auth.uid());


-- ------------------------------------------------------------
-- POLICIES: groups
-- Members (and the owner) can read a group. Only the owner can change it.
-- ------------------------------------------------------------
create policy "read groups you belong to" on groups
  for select using (is_member_of(id) or owner_id = auth.uid());

create policy "create your own group" on groups
  for insert with check (owner_id = auth.uid());

create policy "owner updates group" on groups
  for update using (owner_id = auth.uid());

create policy "owner deletes group" on groups
  for delete using (owner_id = auth.uid());


-- ------------------------------------------------------------
-- POLICIES: group_members
-- Members can see who else is in their group.
-- Only the group owner can add members. A REAL user can only be added if
-- the owner has an ACCEPTED connection with them. Ghosts are always allowed.
-- ------------------------------------------------------------
create policy "read members of your groups" on group_members
  for select using (is_member_of(group_id));

create policy "owner adds members" on group_members
  for insert with check (
    exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid())
    and (
      ghost_name is not null               -- ghost member, always allowed
      or user_id = auth.uid()              -- owner adding themselves
      or exists (                          -- adding a real, accepted connection
        select 1 from connections c
        where c.status = 'accepted'
          and ((c.requester = auth.uid() and c.addressee = group_members.user_id)
            or (c.addressee = auth.uid() and c.requester = group_members.user_id))
      )
    )
  );

create policy "owner removes members" on group_members
  for delete using (
    exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid())
  );


-- ------------------------------------------------------------
-- POLICIES: expenses
-- Anyone who is a member of the group can read and write its expenses.
-- ------------------------------------------------------------
create policy "members read expenses" on expenses
  for select using (is_member_of(group_id));

create policy "members add expenses" on expenses
  for insert with check (is_member_of(group_id));

create policy "members update expenses" on expenses
  for update using (is_member_of(group_id));

create policy "members delete expenses" on expenses
  for delete using (is_member_of(group_id));


-- ------------------------------------------------------------
-- POLICIES: settlements (same access rule as expenses)
-- ------------------------------------------------------------
create policy "members read settlements" on settlements
  for select using (is_member_of(group_id));

create policy "members add settlements" on settlements
  for insert with check (is_member_of(group_id));

create policy "members delete settlements" on settlements
  for delete using (is_member_of(group_id));


-- ------------------------------------------------------------
-- REALTIME
-- Add the tables to the realtime publication so changes push live to
-- every signed-in device (this is what makes Shailja's new expense
-- appear on your phone without a refresh).
-- ------------------------------------------------------------
alter publication supabase_realtime add table expenses;
alter publication supabase_realtime add table settlements;
alter publication supabase_realtime add table group_members;
alter publication supabase_realtime add table groups;
alter publication supabase_realtime add table connections;

-- Done. Next: sign up in the app, then run 02_import_my_data.sql.
