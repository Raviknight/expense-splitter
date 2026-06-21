// Profile.jsx
// The Profile screen — PERSONAL info only.
//
// What this screen lets the signed-in user do:
//   1. Upload / change / remove their profile photo (avatar).
//   2. Edit their display name — saved to profiles.display_name.
//   3. See their email address (read-only) and "member since" date.
//
// Account-level settings (default currency, appearance, password change, and
// sign out) now live on the separate Settings screen (src/auth/Settings.jsx),
// opened from the gear icon in the top bar. This keeps Profile focused on
// "who am I" and Settings on "how the app behaves".
//
// Table: profiles — columns used: id, display_name, email, created_at, avatar_url.
// All names match 01_schema.sql / db/08 exactly.
//
// After a successful save we call refreshProfile() from AuthProvider so the
// new values propagate to the top bar and to store.js.

import { useState, useEffect, useRef } from 'react';
import {
  X, User, Mail, Save, Check, AlertCircle,
  Camera, Trash2,
} from 'lucide-react';
import { supabase } from '../supabaseClient.js';
import { useAuth } from './AuthProvider.jsx';
import Avatar from '../ui/Avatar.jsx';

export default function Profile({ onClose }) {
  // Pull what we need from the auth context.
  // refreshProfile re-fetches the profiles row and updates the whole app.
  const { user, profile, refreshProfile } = useAuth();

  // ── Display name state ────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState(null);

  // ── Profile photo (avatar) state ──────────────────────────────────────────
  // We keep a hidden <input type="file"> and click it from a normal button.
  const fileInputRef = useRef(null);
  const [photoBusy, setPhotoBusy]   = useState(false);   // uploading / removing
  const [photoError, setPhotoError] = useState(null);
  const [photoSaved, setPhotoSaved] = useState(false);

  // Downscale an image file to a max dimension using a <canvas>, returning a
  // small JPEG Blob. Keeps stored photos tiny and fast to load. If anything
  // goes wrong we resolve with null so the caller falls back to the original.
  function downscaleImage(file, maxSize = 256) {
    return new Promise(resolve => {
      try {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          try {
            // Work out the new size, keeping the aspect ratio.
            let { width, height } = img;
            if (width > height && width > maxSize) {
              height = Math.round(height * (maxSize / width));
              width = maxSize;
            } else if (height >= width && height > maxSize) {
              width = Math.round(width * (maxSize / height));
              height = maxSize;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(objectUrl);
            // Export as JPEG (smaller than PNG for photos).
            canvas.toBlob(blob => resolve(blob || null), 'image/jpeg', 0.85);
          } catch {
            URL.revokeObjectURL(objectUrl);
            resolve(null);
          }
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
        img.src = objectUrl;
      } catch {
        resolve(null);
      }
    });
  }

  // Called when the user picks a file from the hidden input.
  async function handlePhotoSelected(e) {
    const file = e.target.files && e.target.files[0];
    // Reset the input so picking the same file again still fires onChange.
    e.target.value = '';
    if (!file) return;

    setPhotoError(null);
    setPhotoSaved(false);
    setPhotoBusy(true);

    try {
      // 1. Try to shrink the image; fall back to the original on any failure.
      let uploadBody = file;
      let contentType = file.type || 'image/jpeg';
      let ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const small = await downscaleImage(file, 256);
      if (small) {
        uploadBody = small;
        contentType = 'image/jpeg';
        ext = 'jpg';
      }

      // 2. Upload to the public `avatars` bucket. The path MUST start with the
      //    user's id (the storage policy requires the first folder = user id).
      //    upsert:true so re-uploading overwrites cleanly.
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase
        .storage
        .from('avatars')
        .upload(path, uploadBody, { upsert: true, contentType });

      if (uploadErr) {
        // If the bucket doesn't exist yet (db/08 not run), guide the owner.
        const m = (uploadErr.message || '').toLowerCase();
        if (m.includes('bucket') || m.includes('not found') || m.includes('does not exist')) {
          setPhotoError('Photos need a one-time setup — run db/08_avatars.sql in Supabase.');
        } else {
          setPhotoError(uploadErr.message || 'Could not upload photo. Please try again.');
        }
        setPhotoBusy(false);
        return;
      }

      // 3. Get the public URL for the uploaded file.
      const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;

      // 4. Save it on the profile row so it shows everywhere.
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })   // column: avatar_url (added by db/08)
        .eq('id', user.id);

      if (updateErr) {
        const m = (updateErr.message || '').toLowerCase();
        if (m.includes('avatar_url') || m.includes('schema cache') || m.includes('column')) {
          setPhotoError('Photos need a one-time setup — run db/08_avatars.sql in Supabase.');
        } else {
          setPhotoError(updateErr.message || 'Could not save photo. Please try again.');
        }
        setPhotoBusy(false);
        return;
      }

      // 5. Refresh so the new photo appears immediately across the app.
      await refreshProfile();
      setPhotoSaved(true);
      setTimeout(() => setPhotoSaved(false), 2000);
    } catch (err) {
      setPhotoError(err?.message || 'Could not upload photo. Please try again.');
    } finally {
      setPhotoBusy(false);
    }
  }

  // Remove the current photo: null out the column and refresh. (We leave the old
  // storage object in place — null-ing the column is enough to stop showing it.)
  async function handleRemovePhoto() {
    setPhotoError(null);
    setPhotoSaved(false);
    setPhotoBusy(true);

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', user.id);

    setPhotoBusy(false);

    if (updateErr) {
      setPhotoError(updateErr.message || 'Could not remove photo. Please try again.');
      return;
    }
    await refreshProfile();
  }

  // Sync the display name when the profile prop arrives from context (first load).
  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile?.display_name]);

  // Guard: if somehow no user, render nothing.
  if (!user) return null;

  // ── Date formatter ────────────────────────────────────────────────────────
  function formatDate(ts) {
    if (!ts) return null;
    try {
      return new Date(ts).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch {
      return null;
    }
  }

  // ── Save display name ─────────────────────────────────────────────────────
  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError('Display name cannot be empty.');
      return;
    }

    setSaving(true);
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ display_name: trimmedName })   // column: display_name
      .eq('id', user.id);                      // column: id
    setSaving(false);

    if (updateErr) {
      setError(updateErr.message || 'Could not save. Please try again.');
      return;
    }

    await refreshProfile();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const memberSince = formatDate(profile?.created_at);

  return (
    <div
      className="min-h-screen bg-[#FAFAF7] text-stone-900"
      style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-[#FAFAF7]/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-3 flex items-center gap-3">
          {onClose && (
            <button
              onClick={onClose}
              className="text-stone-500 hover:text-stone-800 transition"
              aria-label="Go back"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500 font-medium flex items-center gap-1">
              <User className="w-3 h-3" /> Account
            </p>
            <h1 className="text-xl font-semibold">Profile</h1>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="max-w-3xl mx-auto px-4 py-6 pb-32 flex flex-col gap-6">

        {/* Avatar / name hero card — with photo upload */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center gap-4">
            {/* Current photo (or initials). profile.avatar_url is undefined until
                db/08 is run — Avatar just shows initials in that case. */}
            <Avatar
              name={profile?.display_name || user?.email}
              url={profile?.avatar_url}
              size={56}
              className="text-2xl"
            />
            <div className="min-w-0">
              <p className="text-base font-semibold text-stone-900 truncate">
                {profile?.display_name || 'No name set'}
              </p>
              <p className="text-sm text-stone-400 truncate">{user?.email}</p>
              {memberSince && (
                <p className="text-xs text-stone-400 mt-0.5">Member since {memberSince}</p>
              )}
            </div>
          </div>

          {/* Hidden file input, triggered by the button below. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoSelected}
          />

          {/* Upload / Remove buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={photoBusy}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50 transition"
            >
              {photoBusy ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Working…
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" />
                  {profile?.avatar_url ? 'Change photo' : 'Upload photo'}
                </>
              )}
            </button>

            {/* Remove only shows when a photo exists. */}
            {profile?.avatar_url && !photoBusy && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="flex items-center gap-2 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 px-4 py-2 text-sm font-medium transition"
              >
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            )}
          </div>

          {/* Photo error (may include the "run db/08" hint) */}
          {photoError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{photoError}</span>
            </div>
          )}

          {/* Photo success */}
          {photoSaved && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <Check className="w-4 h-4 shrink-0" />
              <span>Photo updated.</span>
            </div>
          )}
        </div>

        {/* ── Edit display name ── */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-4 h-4 text-stone-500" />
            <span className="text-sm font-semibold text-stone-700">Edit profile</span>
          </div>

          <form onSubmit={handleSave} className="flex flex-col gap-4">

            {/* Display name — editable */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="display-name"
                className="text-xs font-medium text-stone-500 uppercase tracking-wide"
              >
                Display name
              </label>
              {/* text-base = 16 px — prevents iOS zoom on focus */}
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={e => {
                  setDisplayName(e.target.value);
                  setError(null);
                  setSaved(false);
                }}
                placeholder="Your name"
                maxLength={80}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-stone-400"
              />
            </div>

            {/* Email — read-only */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-stone-500 uppercase tracking-wide flex items-center gap-1">
                <Mail className="w-3 h-3" /> Email
              </label>
              <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-2.5 text-sm text-stone-500 select-all">
                {user?.email}
              </div>
              <p className="text-xs text-stone-400">
                Email address cannot be changed here. Contact support if you need to update it.
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Success confirmation */}
            {saved && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <Check className="w-4 h-4 shrink-0" />
                <span>Display name saved.</span>
              </div>
            )}

            {/* Save button — indigo accent */}
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50 transition"
            >
              {saving ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save changes
                </>
              )}
            </button>
          </form>
        </section>

      </main>
    </div>
  );
}
