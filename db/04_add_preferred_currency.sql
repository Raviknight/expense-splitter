-- ============================================================
-- Add a "preferred currency" setting to each profile
-- Run this ONCE in the Supabase SQL Editor, the same way you ran 01_schema.sql.
--
-- WHAT THIS DOES, in plain language:
--   It adds one new column to the `profiles` table called preferred_currency.
--   This remembers which currency symbol a person likes to see next to their
--   amounts (for example USD shows "$", EUR shows "€", INR shows "₹").
--
--   It is display-only: it does NOT convert money between currencies. It just
--   changes which symbol the app shows. Everyone starts on 'USD' by default,
--   so existing profiles keep working with no surprises.
--
--   "if not exists" means it is safe to run more than once — if the column is
--   already there, this script simply does nothing.
-- ============================================================

alter table profiles add column if not exists preferred_currency text not null default 'USD';

-- Done. The app now reads profile.preferred_currency to pick the money symbol.
