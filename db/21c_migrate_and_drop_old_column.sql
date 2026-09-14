-- PART 3 of 3. Run AFTER db/21b. No dollar-quoted blocks.
--
-- Copies any note already saved under db/20 into the new table, then removes
-- the old column — which is the only way the loose `profiles` read policy stops
-- applying to this data.
--
-- THIS IS THE ONE FILE THAT IS NOT SAFE TO RE-RUN BLINDLY. The original version
-- wrapped the copy in a block that checked whether `profiles.payment_note`
-- still existed, because a plain statement naming a missing column fails at
-- PARSE time, before any `if` could guard it. That block is exactly what the
-- dashboard's SQL editor could not swallow. Since db/20 has definitely been run
-- on this database, the guard is unnecessary here — so it is gone, and the
-- trade is that running this file a SECOND time errors with
-- "column payment_note does not exist".
--
-- That error is harmless and means the work is already done. It is not a
-- failure to investigate. Run it once.
--
-- ORDER MATTERS: the copy comes first, the drop second, in that order, so the
-- data is safe in the new table before anything is removed.
--
-- The app is already deployed and handles BOTH states: it reads `payment_notes`
-- and falls back to `profiles.payment_note` while the table is missing. So
-- there is no window in which notes are lost — before these scripts it used the
-- old column, after them it uses the new table.

insert into public.payment_notes (user_id, note)
select id, payment_note
  from public.profiles
 where payment_note is not null
   and btrim(payment_note) <> ''
on conflict (user_id) do nothing;

alter table public.profiles drop column if exists payment_note;
