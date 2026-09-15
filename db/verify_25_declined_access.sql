-- VERIFY db/25. Read-only, changes nothing, needs no test users.
--
-- Why this file exists: exercising RLS properly means authenticating AS a user,
-- which needs either a service-role key or a real signed-in session. Neither is
-- available outside the dashboard, so the honest way to check this is to ask the
-- database what it would decide, rather than to claim it was tested.

-- 1. IS THE OLD POLICY GONE AND THE NEW ONE IN PLACE?
--    Expect exactly these three SELECT policies on `profiles`:
--      read own profile                  (db/01)
--      read co-member profiles           (db/22 — shares a group)
--      read active connection profiles   (db/25 — accepted or pending)
--    If "read connected profiles" still appears, db/25 did not take effect and
--    declined rows still grant access.
select polname as policy_name,
       pg_get_expr(polqual, polrelid) as rule
  from pg_policy
 where polrelid = 'public.profiles'::regclass
   and polcmd = 'r'          -- SELECT
 order by polname;

-- 2. WHAT WOULD THE NEW RULE DECIDE, for the connection rows that actually
--    exist? This evaluates db/25's condition for both directions of every row.
--    A 'declined' row must come out FALSE. Anything else is the bug still open.
select p_req.display_name              as requester,
       p_add.display_name              as addressee,
       c.status,
       (c.status in ('accepted','pending')) as grants_profile_access,
       case
         when c.status = 'declined' then 'correct — access revoked'
         when c.status in ('accepted','pending') then 'correct — access allowed'
         else 'unexpected status'
       end                             as verdict
  from public.connections c
  join public.profiles p_req on p_req.id = c.requester
  join public.profiles p_add on p_add.id = c.addressee
 order by c.status, c.created_at desc;

-- 3. Are there any declined rows at all to have been affected? If this returns
--    0, nothing changed for anyone today — the fix is preventative, which is
--    worth knowing rather than assuming it silently fixed something.
select count(*) filter (where status = 'declined') as declined_rows,
       count(*) filter (where status = 'pending')  as pending_rows,
       count(*) filter (where status = 'accepted') as accepted_rows
  from public.connections;
