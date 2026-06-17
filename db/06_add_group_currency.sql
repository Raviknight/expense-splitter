-- ============================================================
-- Per-group currency
-- Run this ONCE in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- What this does, in plain language:
--   Adds a `currency` column to the `groups` table so each group can have its
--   own currency (a Europe trip in EUR, a US trip in USD, etc.). It is a plain
--   3-letter code like 'USD' or 'EUR'. Existing groups get 'USD' by default.
--   This is DISPLAY-ONLY: the app just swaps which symbol is shown, it never
--   converts money between currencies.
--
-- A green "Success. No rows returned" is the expected result.
-- ============================================================

alter table groups add column if not exists currency text not null default 'USD';
