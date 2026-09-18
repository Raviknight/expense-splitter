-- A structured UPI id, alongside the free-text payment note.
--
-- THE PROBLEM. The UPI pay button reads the free-text note and picks out the
-- first thing shaped like a VPA. That works for "UPI: ravi@okhdfcbank" and
-- fails for what people actually write:
--
--     "Hey guys pay me at xyz@ybl or abc@hdfc"
--
-- Two handles, and the parser silently takes the first. If the second was the
-- one they meant, the button sends someone to the wrong account. A guess is not
-- good enough when the output is a payment link with an amount attached.
--
-- WHY ONE COLUMN AND NOT A TABLE OF PAYMENT METHODS. CLAUDE.md section 8
-- records "a field per payment app, per country" as REJECTED, for a reason
-- that still holds: Venmo, Zelle, Cash App, PayPal, PayNow, PromptPay,
-- Revolut, Wise, Interac, Pix — a list with no end that goes stale on its own.
--
-- The line drawn instead is: STRUCTURE ONLY WHAT THE CODE ACTS ON. The app
-- builds a upi:// link and nothing else, deliberately, because per-provider
-- links differ by country and are exactly that maintenance tail. So UPI — the
-- one thing that is parsed and turned into an action — gets a validated column,
-- and everything the app merely DISPLAYS stays in the free-text note where it
-- costs nothing to support.
--
-- BACKWARDS COMPATIBLE. Nullable, no backfill. Anyone who already wrote a VPA
-- into their note keeps working: the app prefers this column and falls back to
-- parsing the note when it is empty. Filling it in is an upgrade, not a
-- requirement.
--
-- NO NEW RLS POLICIES, and that is a statement rather than an omission. These
-- are columns on payment_notes, and a column inherits the row's protection from
-- the policies already on that table. The verification at the bottom re-checks
-- all six anyway — db/27 exists because two of them were silently missing after
-- a migration aborted partway, and a green-looking SQL editor proved nothing.
--
-- Safe to re-run.

alter table public.payment_notes
  add column if not exists upi_id text;

-- Shape check. A VPA is handle@provider where the provider is a bare token —
-- okhdfcbank, ybl, paytm, upi, axl — with NO dot in it. That absent dot is what
-- separates a VPA from an email address, and it is the same rule the app's own
-- parser uses, enforced here so the two cannot drift apart.
--
-- This checks SHAPE, not existence. No database can know whether a VPA is real
-- or currently active; only the payer's UPI app finds that out. Refusing
-- obvious nonsense is the most that can honestly be done here.
alter table public.payment_notes drop constraint if exists payment_notes_upi_shape;
alter table public.payment_notes
  add constraint payment_notes_upi_shape check (
    upi_id is null
    or upi_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}@[a-zA-Z][a-zA-Z0-9]{1,63}$'
  );


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY. Run each of these separately.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. The column is there.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'payment_notes'
   and column_name  = 'upi_id';

-- 2. All SIX policies still exist — three SELECT, one INSERT, one UPDATE, one
--    DELETE. If UPDATE is missing again, saving will fail exactly as it did
--    before db/27, and the app will not be able to tell you why.
select cmd as applies_to, policyname
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'payment_notes'
 order by cmd, policyname;
