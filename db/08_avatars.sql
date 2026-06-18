-- ============================================================
-- Profile photos (avatars). Run this ONCE in the Supabase SQL Editor.
--
-- WHAT IT DOES:
--   1. Creates a PUBLIC storage bucket called 'avatars' to hold profile photos.
--      (Public = the image URLs are viewable by anyone who has the link, which
--      is normal for avatars. Uploading is still restricted — see policies.)
--   2. Adds storage rules: a signed-in user may upload/replace/delete files only
--      inside their OWN folder (the folder name must equal their user id), and
--      anyone may read avatar images.
--   3. Adds profiles.avatar_url to remember each person's photo URL.
--
-- The app stores each photo at:  avatars/<user-id>/avatar-<timestamp>.<ext>
-- ============================================================

-- 1. The bucket (id and name 'avatars', public read).
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- 2. Storage access rules on the objects in that bucket.
--    foldername(name)[1] is the first path segment, which we require to equal
--    the uploader's user id — so you can only write to your own folder.
drop policy if exists "avatars read all"   on storage.objects;
drop policy if exists "avatars insert own" on storage.objects;
drop policy if exists "avatars update own" on storage.objects;
drop policy if exists "avatars delete own" on storage.objects;

create policy "avatars read all" on storage.objects
  for select using ( bucket_id = 'avatars' );

create policy "avatars insert own" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "avatars update own" on storage.objects
  for update to authenticated
  using ( bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using ( bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text );

-- 3. Remember each person's photo URL.
alter table profiles add column if not exists avatar_url text;

-- Done. The Profile screen can now upload a photo; it shows everywhere a person
-- appears (top bar, group members, home cards, connections).
