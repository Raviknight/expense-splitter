-- ============================================================
-- Helper: find a profile by email (for sending connection requests)
-- Run this ONCE in the Supabase SQL Editor, the same way you ran 01_schema.sql.
--
-- WHY THIS EXISTS, in plain language:
--   The privacy rules (Row-Level Security) only let you READ the profile of
--   someone you are ALREADY connected to. That is good for privacy, but it
--   creates a chicken-and-egg problem: to send your very first request to a
--   friend, you need to find them by email BEFORE you are connected.
--
--   This tiny function solves exactly that one need. "security definer" means
--   it runs with elevated rights and is allowed to look past the read rules —
--   but ONLY to do this single, narrow lookup. It returns just enough to send
--   a request (id, name, email) and nothing else. It cannot list everyone; it
--   answers one email at a time.
-- ============================================================

create or replace function find_profile_by_email(lookup_email text)
returns table (id uuid, display_name text, email text)
language sql
security definer
set search_path = public
as $$
  select id, display_name, email
  from profiles
  where lower(email) = lower(trim(lookup_email))
  limit 1;
$$;

-- Allow signed-in users to call this function.
grant execute on function find_profile_by_email(text) to authenticated;

-- Done. The app's "Add a connection" box now finds friends by email.
