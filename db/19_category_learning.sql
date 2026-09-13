-- Learn a user's own category choices.
--
-- The built-in RULES list in App.jsx will never cover every merchant in every
-- country — that is why Indian merchants had to be hand-added, and the same
-- would be true for the next country. Rather than keep growing a keyword list
-- by hand forever, remember what the USER corrects and reuse it.
--
-- HOW THE KEY WORKS: the expense name is normalised to a short merchant token
-- (letters only, first two words) so that
--     "UBER *TRIP 866-576-1"  and  "UBER *TRIP 901-222-8"
-- both become "uber trip" and share one learned category. Storing the full raw
-- name would learn nothing, because the digits differ every time.
--
-- PER USER on purpose. One person filing "AMAZON" under Groceries and another
-- under Shopping are both right for themselves. Aggregating across users is a
-- separate, privacy-sensitive decision and is deliberately NOT done here —
-- merchant names are user data.
--
-- Run once in the Supabase dashboard -> SQL Editor.

create table if not exists public.category_overrides (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  -- Normalised merchant token, e.g. 'uber trip'. Lowercase, no digits.
  merchant   text        not null,
  category   text        not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, merchant)
);

alter table public.category_overrides enable row level security;

-- Users manage their OWN learned categories, and only their own. Unlike
-- scan_usage (which users must never write, or the quota is meaningless), this
-- is the user's own preference data — writing it is the whole point.
drop policy if exists "own category overrides" on public.category_overrides;
create policy "own category overrides"
  on public.category_overrides for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The app loads every override for one user at sign-in.
create index if not exists category_overrides_user_idx
  on public.category_overrides (user_id);
