-- ONE-TIME: move existing expenses into the categories added on 2026-09-16.
--
-- WHY THIS EXISTS. Eight categories were added to App.jsx that day, and three
-- groups of merchant keywords MOVED from an old category to a new one:
--
--     airlines   Transportation -> Flights
--     cinemas    Attractions    -> Entertainment
--     IKEA etc.  Shopping       -> Household
--
-- Keyword changes only affect expenses created AFTER them, so without this an
-- American Airlines charge from last month stays in Transportation forever
-- while next month's identical charge lands in Flights. Same merchant, two
-- categories, and every insight split across both.
--
-- THIS IS THE ONLY PART OF THAT CHANGE THAT WRITES TO REAL DATA. Everything
-- else was front-end only. Read the safeguards before running it.
--
-- WHY THE BACKLOG PARKED "recategorise existing expenses" AS RISKY, and why
-- this narrower job is not the same thing. The parked idea was to re-run the
-- WHOLE rules list over every expense, which would silently overwrite
-- categories the user had fixed by hand. This does not do that. It is bounded
-- three ways:
--
--   1. ONLY merchants whose keyword actually moved. Not a general re-run.
--   2. ONLY rows still sitting in the OLD category. A row you already moved by
--      hand does not match, so it cannot be touched.
--   3. ONLY merchants you have NOT corrected yourself. Anything recorded in
--      category_overrides (db/19) is skipped — your own choice wins.
--
-- NO VIEW, ON PURPOSE. An earlier draft factored the shared query into a view
-- in the public schema. That was a bad idea: a plain view runs with its
-- OWNER's permissions, not the caller's, so it would have bypassed row-level
-- security and exposed every user's expenses through PostgREST for as long as
-- it existed. The query is therefore repeated in full in both statements. If
-- you edit the merchant list, EDIT IT IN BOTH PLACES — the preview lying about
-- what the update will do is the one failure mode worth guarding against here.
--
-- HOW TO RUN IT. Two independent statements. Run them ONE AT A TIME by
-- selecting the statement and pressing Run: the Supabase SQL editor shows only
-- the LAST result when several run together, which would hide the preview.
--
--   STEP 1  read-only. Shows exactly which rows would move, and where to.
--   STEP 2  the update. Run it only once step 1 looks right.
--
-- Step 1 returning zero rows is a fine outcome — it means nothing in your data
-- matches and step 2 would do nothing. There is no undo script, so if step 1
-- shows something unexpected, stop rather than running step 2 to find out.


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 1 - PREVIEW (read-only). Select from here to the semicolon, press Run.
-- ═════════════════════════════════════════════════════════════════════════════

with moved(pattern, from_category, to_category) as (
  values
    ('%airline%',      'Transportation', 'Flights'),
    ('%airfare%',      'Transportation', 'Flights'),
    ('%air india%',    'Transportation', 'Flights'),
    ('%spicejet%',     'Transportation', 'Flights'),
    ('%goindigo%',     'Transportation', 'Flights'),
    ('%indigo air%',   'Transportation', 'Flights'),
    ('%vistara%',      'Transportation', 'Flights'),
    ('%akasa air%',    'Transportation', 'Flights'),
    ('%emirates%',     'Transportation', 'Flights'),
    ('%lufthansa%',    'Transportation', 'Flights'),
    ('%jetblue%',      'Transportation', 'Flights'),
    ('%etihad%',       'Transportation', 'Flights'),
    ('%bookmyshow%',   'Attractions',    'Entertainment'),
    ('%book my show%', 'Attractions',    'Entertainment'),
    ('%pvr %',         'Attractions',    'Entertainment'),
    ('%inox %',        'Attractions',    'Entertainment'),
    ('%cinepolis%',    'Attractions',    'Entertainment'),
    ('%cinema%',       'Attractions',    'Entertainment'),
    ('%ikea%',         'Shopping',       'Household'),
    ('%home depot%',   'Shopping',       'Household'),
    ('%lowes%',        'Shopping',       'Household')
)
select m.to_category                    as new_category,
       e.category                       as current_category,
       count(*)                         as rows_to_move,
       min(e.date)                      as earliest,
       max(e.date)                      as latest,
       string_agg(distinct e.name, ' | ') as examples
  from public.expenses e
  join moved m
    on lower(e.name) like m.pattern
   and e.category = m.from_category
 where not exists (
         select 1
           from public.category_overrides o
          where o.merchant = (
                  select string_agg(w, ' ' order by ord)
                    from unnest(string_to_array(
                           trim(regexp_replace(lower(e.name), '[^a-z]+', ' ', 'g')),
                           ' '
                         )) with ordinality as t(w, ord)
                   where ord <= 2
                )
       )
 group by m.to_category, e.category
 order by m.to_category;


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 2 - APPLY. Identical matching to step 1. Run only after reading step 1.
-- ═════════════════════════════════════════════════════════════════════════════

with moved(pattern, from_category, to_category) as (
  values
    ('%airline%',      'Transportation', 'Flights'),
    ('%airfare%',      'Transportation', 'Flights'),
    ('%air india%',    'Transportation', 'Flights'),
    ('%spicejet%',     'Transportation', 'Flights'),
    ('%goindigo%',     'Transportation', 'Flights'),
    ('%indigo air%',   'Transportation', 'Flights'),
    ('%vistara%',      'Transportation', 'Flights'),
    ('%akasa air%',    'Transportation', 'Flights'),
    ('%emirates%',     'Transportation', 'Flights'),
    ('%lufthansa%',    'Transportation', 'Flights'),
    ('%jetblue%',      'Transportation', 'Flights'),
    ('%etihad%',       'Transportation', 'Flights'),
    ('%bookmyshow%',   'Attractions',    'Entertainment'),
    ('%book my show%', 'Attractions',    'Entertainment'),
    ('%pvr %',         'Attractions',    'Entertainment'),
    ('%inox %',        'Attractions',    'Entertainment'),
    ('%cinepolis%',    'Attractions',    'Entertainment'),
    ('%cinema%',       'Attractions',    'Entertainment'),
    ('%ikea%',         'Shopping',       'Household'),
    ('%home depot%',   'Shopping',       'Household'),
    ('%lowes%',        'Shopping',       'Household')
),
targets as (
  select distinct e.id, m.to_category
    from public.expenses e
    join moved m
      on lower(e.name) like m.pattern
     and e.category = m.from_category
   where not exists (
           select 1
             from public.category_overrides o
            where o.merchant = (
                    select string_agg(w, ' ' order by ord)
                      from unnest(string_to_array(
                             trim(regexp_replace(lower(e.name), '[^a-z]+', ' ', 'g')),
                             ' '
                           )) with ordinality as t(w, ord)
                     where ord <= 2
                  )
         )
)
update public.expenses e
   set category = t.to_category
  from targets t
 where e.id = t.id;
