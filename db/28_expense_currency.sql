-- Per-expense currency: record what was ACTUALLY paid, alongside the group's
-- own currency.
--
-- THE PROBLEM. A group has one currency (db/06). That works for a flat and for
-- a trip inside one country, and falls apart on a trip that crosses borders:
-- India to Thailand to Malaysia to Singapore is four currencies and one set of
-- balances. Today you would have to convert every receipt by hand before
-- typing it, and the original figure — the one printed on the receipt you are
-- checking against — would be lost.
--
-- THE SHAPE, and the reasoning, because the obvious design is wrong.
--
-- `amount` DOES NOT CHANGE MEANING. It stays the value in the GROUP's
-- currency, which is what every balance, settle-up suggestion, insight and
-- export already reads. Nothing downstream needs to know this feature exists.
-- That is deliberate: the settle-up rounding was hard-won (whole cents, 17
-- tested scenarios) and re-deriving balances from mixed currencies would put
-- all of it back in play for no gain.
--
-- The three new columns record what was actually paid:
--
--     original_amount    1500.00        what the receipt said
--     original_currency  'THB'          what it said it in
--     fx_rate            2.34000000     group currency per 1 unit of original
--
-- so that amount = round(original_amount * fx_rate, 2), fixed at entry.
--
-- ⚠️ CONVERTED ONCE, AT ENTRY, AND NEVER AGAIN. This is the decision the whole
-- feature turns on, agreed with the owner before any code was written.
--
-- The tempting alternative is to store only the original and convert at
-- DISPLAY time using a current rate. It is wrong, and expensively so: a
-- balance settled exactly today reopens tomorrow because the rate moved, and
-- settle-up suggestions become a target that never stops moving. During a trip
-- people check balances daily -- "I owed 4,200 yesterday and 4,350 today and
-- nobody spent anything" destroys trust in every other number the app shows.
-- It is the phantom-one-cent bug this project already fixed once, except the
-- amounts are large and no payment can ever clear them.
--
-- Rate-at-first-settlement was also considered and rejected for the same
-- reason plus one more: it has no answer for the SECOND settlement, after
-- which one expense would carry two different rates.
--
-- WHERE THE RATE COMES FROM: the user types it. No API. The rate that is true
-- for the person paying is the one their own bank charged them, and no
-- exchange-rate service knows that. An API would also be a dependency that
-- fails silently, which this project has been bitten by more than once. The app
-- remembers the last rate used for a currency pair in a group and pre-fills it,
-- so it is typed once per trip rather than once per expense.
--
-- ALL THREE COLUMNS ARE NULLABLE, and null means "this expense is already in
-- the group's currency". Every existing row is therefore correct as it stands
-- and there is no backfill -- which also means this migration cannot corrupt
-- anything that is already recorded.
--
-- Safe to re-run.

alter table public.expenses
  add column if not exists original_amount   numeric(14,2),
  add column if not exists original_currency text,
  add column if not exists fx_rate           numeric(18,8);

-- Either all three are set, or none of them are. A half-filled row is the one
-- state that would be genuinely ambiguous: an original amount with no rate
-- cannot be reconciled with `amount`, and a rate with no original cannot be
-- checked. Better refused by the database than discovered months later in
-- somebody's balance.
alter table public.expenses drop constraint if exists expenses_currency_triple;
alter table public.expenses
  add constraint expenses_currency_triple check (
    (original_amount is null and original_currency is null and fx_rate is null)
    or
    (original_amount is not null and original_currency is not null and fx_rate is not null)
  );

-- A rate must be positive. Zero would make every converted amount zero, and a
-- negative rate would flip the direction of a debt -- both silently.
alter table public.expenses drop constraint if exists expenses_fx_rate_positive;
alter table public.expenses
  add constraint expenses_fx_rate_positive check (fx_rate is null or fx_rate > 0);

-- ISO 4217 is three letters. This does not verify the code EXISTS -- new ones
-- appear and the app's list will grow -- it only refuses obvious rubbish such
-- as a symbol or a whole sentence ending up in the column.
alter table public.expenses drop constraint if exists expenses_original_currency_shape;
alter table public.expenses
  add constraint expenses_original_currency_shape check (
    original_currency is null or original_currency ~ '^[A-Z]{3}$'
  );

-- No new RLS policies. These are columns on `expenses`, which already has its
-- own policies; a column inherits the row's protection.


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY. Expect three rows: original_amount, original_currency, fx_rate.
-- ═════════════════════════════════════════════════════════════════════════════

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'expenses'
   and column_name in ('original_amount', 'original_currency', 'fx_rate')
 order by column_name;
