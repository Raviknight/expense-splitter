-- "How to pay me" note on a profile.
--
-- WHAT: one short line of free text that each person writes for themselves —
-- "UPI: name@bank", "Venmo: @handle", "Bank ref: SPLITAB-RAVI", or just
-- "Cash is fine". At settle-up the payer reads it and pays in whatever app they
-- already use.
--
-- WHY FREE TEXT rather than a field per payment app: hard-coding apps per
-- country is an endless maintenance tail (a new wallet every year, in every
-- market) and it breaks the moment someone travels — an Indian UPI field is
-- useless to the same person paying a friend in Toronto. One text box works
-- everywhere and needs no code change when the next app appears.
--
-- WHY THIS IS ONLY A NOTE: the app never touches money. It displays a string
-- the user typed and records that a payment happened somewhere else. Moving
-- money in-app would make Splitab a regulated payment service, which is a
-- completely different undertaking. There is deliberately NO payment SDK, deep
-- link or API behind this column, and none should be added here.
--
-- WHY IT LIVES ON `profiles` (and not a new table): `profiles` ALREADY has an
-- "update own profile" policy from db/01 — the same one that saves
-- display_name, preferred_currency and avatar_url — so this column needs NO new
-- RLS policy at all. A new table would need one, and a wrong RLS policy is a
-- data-exposure bug, not a cosmetic one. Reads are already correct too: the
-- existing "read connected profiles" policy means only people you have an
-- accepted connection with can read the note — which is exactly the set of
-- people who might owe you money.
--
-- VISIBILITY — this is NOT private. Anyone you are connected to (i.e. everyone
-- who shares a group with you) can read it. The Profile screen says so next to
-- the field. Nothing secret belongs in here.
--
-- The app degrades gracefully if this has NOT been run: Profile.jsx catches the
-- "column does not exist" / "schema cache" error and shows a friendly
-- "needs a one-time database update — run db/20" message instead of a raw
-- PostgREST error, exactly like Settings.jsx does for db/04 and db/14.
--
-- Safe to re-run. Run once in the Supabase dashboard -> SQL Editor.

alter table public.profiles
  add column if not exists payment_note text;

-- Length cap. This is free text that OTHER people see, so it needs a ceiling:
-- 200 characters is comfortably more than any UPI id, handle or bank reference
-- (the input in Profile.jsx caps at the same number, so the constraint is a
-- backstop, not the first line of defence) while stopping the column being used
-- as unbounded storage or as a wall of text in someone else's settle-up screen.
-- `is null or` keeps rows without a note valid.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_payment_note_len'
  ) then
    alter table public.profiles
      add constraint profiles_payment_note_len
      check (payment_note is null or char_length(payment_note) <= 200);
  end if;
end $$;
