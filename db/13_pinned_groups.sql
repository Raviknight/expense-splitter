-- Pinned groups on the home dashboard.
--
-- Stored on `profiles` rather than in a new table or a column on `group_members`
-- for one specific reason: `profiles` ALREADY has a policy letting a user update
-- their own row (that is how display_name, preferred_currency and avatar_url are
-- saved). So this needs no new RLS policy. A new table would, and a wrong RLS
-- policy is a data-exposure bug, not a cosmetic one.
--
-- Shape: a JSON array of group ids, e.g. ["uuid-a", "uuid-b"].
-- Order in the array is the order they appear on the dashboard.
--
-- The app degrades gracefully if this has NOT been run: pinning falls back to
-- per-device localStorage, exactly like it handles a missing preferred_currency.
-- Run once in the Supabase dashboard -> SQL Editor.

alter table public.profiles
  add column if not exists pinned_groups jsonb not null default '[]'::jsonb;

-- Guard against a non-array value being written by a future bug: the app always
-- sends an array, and the dashboard code assumes it can iterate this.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_pinned_groups_is_array'
  ) then
    alter table public.profiles
      add constraint profiles_pinned_groups_is_array
      check (jsonb_typeof(pinned_groups) = 'array');
  end if;
end $$;
