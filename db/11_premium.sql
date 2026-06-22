-- ============================================================
-- Premium / subscription status. Run once in the Supabase SQL Editor.
--
-- Phase 1 = these columns only. The payment webhook (Lemon Squeezy) and a
-- write-lock on these columns (so users can't grant themselves premium) come
-- in Phase 2, alongside enforcement.
--
-- GRANT FREE PREMIUM (you + family): in the Table Editor, set is_premium = true
-- and premium_source = 'comp' on that person's profiles row. That's it.
-- ============================================================

alter table profiles add column if not exists is_premium    boolean not null default false;
alter table profiles add column if not exists premium_source text;        -- 'comp' | 'lemonsqueezy' | 'stripe'
alter table profiles add column if not exists premium_until  timestamptz;  -- null = no expiry (e.g. comp grants)

-- Done. AuthProvider already selects '*', so profile.is_premium flows to the app.
