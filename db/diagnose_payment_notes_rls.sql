-- READ-ONLY diagnosis for: saving a payment note fails with
--
--   42501  new row violates row-level security policy (USING expression)
--          for table "payment_notes"
--
-- WHAT THE ERROR ALREADY TELLS US, so these queries only have to settle what
-- is left. The app upserts, which is INSERT ... ON CONFLICT (user_id) DO
-- UPDATE. Postgres evaluates a USING clause ONLY on the UPDATE path, and only
-- against a row that already exists — a pure INSERT refusal says "with check"
-- instead. So two things are already established:
--
--   1. A payment_notes row for this user EXISTS. Most likely written by db/21c
--      when it copied notes over from the old profiles.payment_note column.
--   2. The UPDATE policy's USING expression returns FALSE for that row.
--
-- Since user_id is both the primary key and the conflict target, the
-- conflicting row's user_id must equal the value being inserted. So
-- `using (user_id = auth.uid())` returning false points at one of:
--
--   (a) the policy in the database is NOT the one db/21b defines — an earlier
--       draft, or an extra condition added by hand, or
--   (b) the stored user_id does not match the signed-in user's auth id.
--
-- Run these ONE AT A TIME (select the statement, press Run). The SQL editor
-- shows only the LAST result when several run together.
--
-- NOTE: auth.uid() is NULL in the SQL editor — it runs as the postgres role,
-- not as a signed-in user. That is why query 3 compares ids by hand instead of
-- calling auth.uid().


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. THE POLICIES AS THEY ACTUALLY EXIST. This is the one that matters most.
--
--    Expected, from db/21b:
--      UPDATE  "update own payment note"   using: (user_id = auth.uid())
--                                     with check: (user_id = auth.uid())
--      INSERT  "insert own payment note"   with check: (user_id = auth.uid())
--      SELECT  three policies (own / accepted connection / co-member)
--      DELETE  "delete own payment note"
--
--    If the UPDATE policy is missing, or its `using_expression` is anything
--    other than (user_id = auth.uid()), that is the bug and query 2 and 3 are
--    unnecessary.
-- ═════════════════════════════════════════════════════════════════════════════

select policyname,
       cmd                         as applies_to,
       qual                        as using_expression,
       with_check                  as with_check_expression
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'payment_notes'
 order by cmd, policyname;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. WHAT IS ACTUALLY STORED. The note itself is not printed in full — it is
--    personal data and the length is enough to tell whether a row is there.
-- ═════════════════════════════════════════════════════════════════════════════

select user_id,
       char_length(coalesce(note, '')) as note_length,
       updated_at
  from public.payment_notes
 order by updated_at desc;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. DO THE IDS LINE UP? Joins the stored rows to the actual accounts.
--
--    `has_matching_account` must be true. If a payment_notes row has no
--    matching auth.users row — or matches a DIFFERENT account than the one you
--    sign in with — then (b) above is the cause: the row was written against
--    the wrong id and no policy keyed on auth.uid() can ever update it.
-- ═════════════════════════════════════════════════════════════════════════════

select n.user_id,
       u.email,
       (u.id is not null)              as has_matching_account,
       char_length(coalesce(n.note,'')) as note_length
  from public.payment_notes n
  left join auth.users u on u.id = n.user_id
 order by u.email nulls first;
