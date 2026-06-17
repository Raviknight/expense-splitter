-- ============================================================
-- Custom (itemized) split — store an exact amount per person on an expense.
-- Run this ONCE in the Supabase SQL Editor, like the other db/ scripts.
--
-- WHY: the original split modes (equal / full / personal) compute each person's
-- share automatically. A "custom" split lets the user type exactly how much each
-- person owes (e.g. a $100 ticket = $70 + $20 + $10). To remember those amounts
-- we add a `split_detail` column (JSON: { "<group_members.id>": amount, ... }),
-- and we allow 'custom' as a split_mode value.
-- ============================================================

-- 1. Allow 'custom' in the split_mode check (the original constraint listed only
--    equal/full/personal). We drop the auto-named constraint and recreate it.
alter table expenses drop constraint if exists expenses_split_mode_check;
alter table expenses add constraint expenses_split_mode_check
  check (split_mode in ('equal','full','personal','custom'));

-- 2. Store the per-person amounts for a custom split. Null for the other modes.
alter table expenses add column if not exists split_detail jsonb;

-- Done. The app's expense form now offers a "Custom" split with per-person amounts.
