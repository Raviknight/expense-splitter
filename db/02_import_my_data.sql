-- ============================================================
-- Personal data import - Ravi only
-- Run this ONCE, AFTER you have signed up in the app, in the Supabase
-- SQL Editor. It loads your Niagara trip into YOUR account only. No one
-- else who signs up is affected by this file.
--
-- STEP 1: Find your user id. Run this first, on its own, and copy the id
--         for your email:
--
--           select id, email from auth.users;
--
-- STEP 2: Paste that id between the quotes on the "me uuid :=" line below.
-- STEP 3: Run the whole block.
--
-- Notes:
--   - Shailja is added as a GHOST member for now, so this works even before
--     she has an account. Once she signs up and you two connect, you can add
--     her as a real member from the app.
--   - Every expense is recorded as paid by you, split equally. Change any of
--     them later in the app.
--   - The two ~$100 placeholders (Sunoco, 7-Eleven 44753) and the pending
--     items carry a note so you remember to confirm the final amounts.
-- ============================================================

do $$
declare
  me           uuid := 'PASTE-YOUR-USER-ID-HERE';
  trip_group   uuid;
  solo_group   uuid;
  me_member    uuid;
  ghost_member uuid;
begin
  -- Your private solo group (for personal-only tracking)
  insert into groups (name, owner_id, type)
    values ('My personal', me, 'solo')
    returning id into solo_group;
  insert into group_members (group_id, user_id)
    values (solo_group, me);

  -- The shared trip group
  insert into groups (name, owner_id, type)
    values ('NY · Niagara · Adirondacks', me, 'shared')
    returning id into trip_group;

  insert into group_members (group_id, user_id)
    values (trip_group, me)
    returning id into me_member;

  insert into group_members (group_id, ghost_name)
    values (trip_group, 'Shailja')
    returning id into ghost_member;

  -- All trip expenses (paid by you, equal split)
  insert into expenses (group_id, name, amount, date, category, paid_by, split_mode, note) values
    (trip_group, 'AMNH (Museum of Natural History)',      172.00, '2026-05-30', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Empire State Observatory',              423.52, '2026-05-30', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Hudson Toyota Jersey City',             110.35, '2026-05-30', 'Auto Service',   me_member, 'equal', ''),
    (trip_group, 'Starbucks NYC',                          11.65, '2026-05-30', 'Restaurants',    me_member, 'equal', ''),
    (trip_group, 'America''s Natl Parks (Liberty Island)', 25.96, '2026-05-31', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Metropolis Parking',                      7.99, '2026-05-31', 'Parking',        me_member, 'equal', ''),
    (trip_group, 'NYCDOT ParkNYC',                          3.20, '2026-05-31', 'Parking',        me_member, 'equal', ''),
    (trip_group, 'NYCDOT ParkNYC',                         14.70, '2026-05-31', 'Parking',        me_member, 'equal', ''),
    (trip_group, 'Seabra Foods Harrison',                  26.22, '2026-05-31', 'Groceries',      me_member, 'equal', ''),
    (trip_group, 'Airbnb (Niagara stay)',                 531.24, '2026-06-04', 'Lodging',        me_member, 'equal', ''),
    (trip_group, 'Budget Car Rental - GMC Yukon (net)',   699.02, '2026-06-04', 'Car Rental',     me_member, 'equal', 'Net of -739.32 refund and +739.32 charge from statement'),
    (trip_group, 'WM Supercenter Kearny',                   2.33, '2026-06-06', 'Groceries',      me_member, 'equal', ''),
    (trip_group, 'Wal-Mart #2107 Lockport',                26.77, '2026-06-07', 'Shopping',       me_member, 'equal', ''),
    (trip_group, '7-Eleven Oakfield (snacks)',              3.00, '2026-06-07', 'Convenience',    me_member, 'equal', ''),
    (trip_group, '7-Eleven Oakfield (gas)',               101.38, '2026-06-07', 'Fuel',           me_member, 'equal', 'Re-categorized as fuel (large amount)'),
    (trip_group, '7-Eleven Niagara Falls',                 17.46, '2026-06-07', 'Convenience',    me_member, 'equal', ''),
    (trip_group, '777 Food Bazaar Niagara Falls',          10.00, '2026-06-07', 'Groceries',      me_member, 'equal', ''),
    (trip_group, 'Watkins Glen State Park',                10.00, '2026-06-07', 'Attractions',    me_member, 'equal', ''),
    (trip_group, '7-Eleven Niagara Falls',                 13.69, '2026-06-08', 'Convenience',    me_member, 'equal', ''),
    (trip_group, '7-Eleven Niagara Falls',                 18.95, '2026-06-08', 'Convenience',    me_member, 'equal', ''),
    (trip_group, 'Maid of the Mist (store)',               33.45, '2026-06-08', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Maid of the Mist (tickets)',            181.50, '2026-06-08', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Niagara Falls State Park',               30.00, '2026-06-08', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Niagara Falls State Park',              138.00, '2026-06-08', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Niagra Tandoori Hut',                    20.41, '2026-06-08', 'Restaurants',    me_member, 'equal', ''),
    (trip_group, 'NJ EZPass',                              25.00, '2026-06-08', 'Tolls',          me_member, 'equal', ''),
    (trip_group, 'Hannaford Lake Placid',                  31.24, '2026-06-09', 'Groceries',      me_member, 'equal', ''),
    (trip_group, 'Lake Placid Inn',                       216.41, '2026-06-09', 'Lodging',        me_member, 'equal', ''),
    (trip_group, 'Letchworth Concessions',                 10.25, '2026-06-09', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Letchworth State Park entry',            10.00, '2026-06-09', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Subway Rochester',                        5.38, '2026-06-09', 'Restaurants',    me_member, 'equal', ''),
    (trip_group, 'Subway Rochester',                       37.38, '2026-06-09', 'Restaurants',    me_member, 'equal', ''),
    (trip_group, 'Walgreens Niagara Falls',                 9.99, '2026-06-09', 'Pharmacy',       me_member, 'equal', ''),
    (trip_group, 'Refuel Fulton',                           5.18, '2026-06-09', 'Convenience',    me_member, 'equal', ''),
    (trip_group, 'ExxonMobil Lake Placid',                106.85, '2026-06-10', 'Fuel',           me_member, 'equal', ''),
    (trip_group, 'ExxonMobil New Paltz',                    3.77, '2026-06-10', 'Fuel',           me_member, 'equal', ''),
    (trip_group, 'Lake George Parking',                     2.00, '2026-06-10', 'Parking',        me_member, 'equal', ''),
    (trip_group, 'Subway Queensbury',                       3.29, '2026-06-10', 'Restaurants',    me_member, 'equal', ''),
    (trip_group, 'Subway Queensbury',                      37.61, '2026-06-10', 'Restaurants',    me_member, 'equal', ''),
    (trip_group, 'Whiteface Mountain',                      7.56, '2026-06-10', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Whiteface Mountain',                     85.00, '2026-06-10', 'Attractions',    me_member, 'equal', ''),
    (trip_group, 'Refuel Fulton NY',                        5.38, '2026-06-10', 'Convenience',    me_member, 'equal', ''),
    (trip_group, 'WM Supercenter Kearny',                  88.71, '2026-06-11', 'Groceries',      me_member, 'equal', ''),
    (trip_group, 'Uber',                                   25.97, '2026-06-12', 'Transportation', me_member, 'equal', 'Pending'),
    (trip_group, 'Sunoco',                                100.00, '2026-06-12', 'Fuel',           me_member, 'equal', 'Pending - placeholder ~100, confirm settled amount'),
    (trip_group, 'NJ Harrison Municipal',                  41.20, '2026-06-12', 'Government',     me_member, 'equal', 'Pending'),
    (trip_group, 'Dunkin',                                 29.79, '2026-06-12', 'Restaurants',    me_member, 'equal', 'Pending'),
    (trip_group, 'Union Kitchen Eckington',                28.43, '2026-06-12', 'Restaurants',    me_member, 'equal', 'Pending'),
    (trip_group, 'DC Park Meter',                           4.60, '2026-06-12', 'Parking',        me_member, 'equal', 'Pending'),
    (trip_group, 'Walmart Store 01985',                    33.82, '2026-06-12', 'Shopping',       me_member, 'equal', 'Pending'),
    (trip_group, 'Aksharpith Robbinsville',                11.73, '2026-06-12', 'Restaurants',    me_member, 'equal', 'Pending - BAPS food court'),
    (trip_group, '7-Eleven 44753',                        100.00, '2026-06-12', 'Fuel',           me_member, 'equal', 'Pending - placeholder ~100, confirm settled amount'),
    (trip_group, 'Booking.com (Partners on Booking BV)',  254.13, '2026-06-12', 'Lodging',        me_member, 'equal', 'Pending');

  raise notice 'Import complete. Trip group: %, Solo group: %', trip_group, solo_group;
end $$;
