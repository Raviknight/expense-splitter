// Profile.jsx
// The Profile screen — PERSONAL info only.
//
// What this screen lets the signed-in user do:
//   1. Upload / change / remove their profile photo (avatar).
//   2. Edit their display name — saved to profiles.display_name.
//   3. See their email address (read-only) and "member since" date.
//   4. Write a free-text "how to pay me" note — saved to its own
//      `payment_notes` table (db/21). It is SHOWN TO OTHER PEOPLE at settle-up,
//      so the UI says so. The app never touches money: this is a note the payer
//      reads, nothing more. No payment SDK, deep link or API — see
//      db/21_payment_notes_table.sql.
//
//      WHY ITS OWN TABLE. The note used to be profiles.payment_note (db/20),
//      but reads of `profiles` are granted by a policy that only checks that a
//      `connections` row EXISTS — it never looks at `status` — so a PENDING or
//      even DECLINED request could read it. `payment_notes` is readable only by
//      yourself or by someone you have an ACCEPTED connection with.
//
//      BOTH STATES MUST WORK. The owner deploys this build first and runs
//      db/21 later, so every read and write here tries `payment_notes` and
//      falls back to the old `profiles.payment_note` column while the table is
//      still missing. Querying a missing table (or, after db/21, a missing
//      column) makes PostgREST error, so neither path may assume one shape.
//
// Account-level settings (default currency, appearance, password change, and
// sign out) now live on the separate Settings screen (src/auth/Settings.jsx),
// opened from the gear icon in the top bar. This keeps Profile focused on
// "who am I" and Settings on "how the app behaves".
//
// Tables: profiles — columns used: id, display_name, email, created_at,
// avatar_url; payment_notes — columns used: user_id, note, updated_at.
// All names match 01_schema.sql / db/08 / db/21 exactly.
//
// After a successful save we call refreshProfile() from AuthProvider so the
// new values propagate to the top bar and to store.js.

import { useState, useEffect, useRef } from 'react';
import {
  X, User, Mail, Save, Check, AlertCircle,
  Camera, Trash2, Wallet, Eye,
} from 'lucide-react';
import { supabase } from '../supabaseClient.js';
import { useAuth } from './AuthProvider.jsx';
import Avatar from '../ui/Avatar.jsx';
import { reportSetupError, genericSaveFailure } from '../data/errors.js';

// Longest "how to pay me" note we accept. MUST match the check constraint in
// db/21_payment_notes_table.sql (payment_notes_len) — and the identical cap the
// old db/20 column carried (profiles_payment_note_len), since we still write
// that column before db/21 is run. If the input let someone type more than the
// database allows, the save would fail with a constraint error they could do
// nothing about.
const PAYMENT_NOTE_MAX = 200;

// ── Example payment notes, ordered by the user's preferred currency ─────────
//
// It stays ONE free-text box. This does not add a UPI field and a Venmo field
// and a PayPal field — that per-app, per-country design was explicitly rejected
// (CLAUDE.md §8) because it never stops growing and breaks the moment someone
// travels. All this does is decide which example a person reads FIRST.
//
// Why currency and not IP geolocation: a VPN, a work proxy or a two-week trip
// all make an IP lie, and asking for a location permission to reorder four
// words is absurd. profiles.preferred_currency (db/04) is something the user
// set themselves, so it is both more accurate and free.
//
// Rules for every list:
//   • several examples, always — someone in India still has to pay a friend
//     abroad, so the other options must stay visible rather than be hidden;
//   • one internationally-usable option (PayPal / Wise) in every list;
//   • "Cash is fine" everywhere, because it is always a valid answer;
//   • never an example that invites private data. The copy next to the box
//     says no card or full account numbers, so the bank-transfer examples are
//     a reference or "ask me", never an account number or a full IBAN.
const PAYMENT_NOTE_HINTS = {
  INR:     ['UPI: name@bank', 'Bank ref: SPLITAB-RAVI', 'PayPal: you@email', 'Cash is fine'],
  USD:     ['Venmo: @handle', 'Zelle: you@email', 'Cash App: $handle', 'PayPal: you@email', 'Cash is fine'],
  GBP:     ['Bank transfer — ask me for details', 'Monzo: monzo.me/yourname', 'Revolut: @handle', 'PayPal: you@email', 'Cash is fine'],
  EUR:     ['Bank transfer — IBAN on request', 'Revolut: @handle', 'Wise: you@email', 'PayPal: you@email', 'Cash is fine'],
  CAD:     ['Interac e-Transfer: you@email', 'Bank transfer — ask me for details', 'PayPal: you@email', 'Cash is fine'],
  AUD:     ['PayID: you@email', 'Bank transfer — ask me for details', 'Wise: you@email', 'Cash is fine'],
  NZD:     ['Bank transfer — ask me for details', 'Wise: you@email', 'PayPal: you@email', 'Cash is fine'],
  SGD:     ['PayNow: you@email', 'Bank transfer — ask me for details', 'Wise: you@email', 'Cash is fine'],
  AED:     ['Bank transfer — ask me for details', 'Careem Pay: @handle', 'Wise: you@email', 'Cash is fine'],
  // Anything else, or nobody has set a currency yet: nothing country-specific
  // goes first, just the options that work more or less anywhere.
  DEFAULT: ['PayPal: you@email', 'Wise: you@email', 'Bank transfer — ask me for details', 'Cash is fine'],
};

// Pick the example list for a currency code. Unknown / missing / not-yet-run
// db/04 all fall through to the neutral generic order.
function paymentHintsFor(currency) {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  return PAYMENT_NOTE_HINTS[code] || PAYMENT_NOTE_HINTS.DEFAULT;
}

// Does this error mean the `payment_notes` table simply isn't there yet — i.e.
// db/21 hasn't been run? Used to decide whether to retry a save against the old
// db/20 column. Deliberately NARROW: it must NOT match a length-constraint
// violation or an RLS refusal, which are real answers from a table that exists.
//
// PostgREST reports an unknown table as 404 with code PGRST205 and a message
// like: Could not find the table 'public.payment_notes' in the schema cache.
// Postgres itself uses 42P01 ("relation ... does not exist").
function looksLikeMissingNotesTable(dbError) {
  if (!dbError) return false;
  const m = (dbError.message || '').toLowerCase();
  return (
    dbError.code === '42P01' ||
    dbError.code === 'PGRST205' ||
    (m.includes('payment_notes') &&
      (m.includes('does not exist') ||
       m.includes('schema cache') ||
       m.includes('could not find'))) ||
    (m.includes('relation') && m.includes('does not exist'))
  );
}

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

  // ── "How to pay me" note state (db/21) ────────────────────────────────────
  // Kept SEPARATE from the display-name form on purpose: if neither db/20 nor
  // db/21 has been run, saving this fails — and it must not take the (working)
  // display-name save down with it. Same reasoning as the currency section in
  // Settings.jsx.
  //
  // These hooks MUST stay above the `if (!user) return null` guard further
  // down. A hook after a conditional return only runs on some renders, which
  // React rejects with a hook-order error.
  //
  // The real value is loaded from the `payment_notes` table by the effect
  // further down. We still seed from profile?.payment_note so the box is
  // populated on the very first paint on a database where db/21 hasn't run yet
  // (AuthProvider's select('*') carries that column while it exists); after
  // db/21 it is undefined and this is simply ''.
  const [paymentNote, setPaymentNote]   = useState(profile?.payment_note || '');

  // Which examples to show, and in what order. Driven by the currency the user
  // already chose in Settings (profiles.preferred_currency, db/04) — see
  // PAYMENT_NOTE_HINTS above. Plain derived value, no state and no hook: it is
  // recomputed on render, so changing the currency in Settings is reflected
  // the next time this screen renders.
  const noteHints = paymentHintsFor(profile?.preferred_currency);
  const [noteSaving, setNoteSaving]     = useState(false);
  const [noteSaved, setNoteSaved]       = useState(false);
  const [noteError, setNoteError]       = useState(null);

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
          setPhotoError(reportSetupError({
            userMessage: genericSaveFailure('your photo'),
            devHint: 'avatars storage bucket missing — run db/08_avatars.sql.',
            error: uploadErr,
          }));
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
          setPhotoError(reportSetupError({
            userMessage: genericSaveFailure('your photo'),
            devHint: 'profiles.avatar_url missing — run db/08_avatars.sql.',
            error: updateErr,
          }));
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

  // Same for the payment note, which now lives in its own `payment_notes` table
  // (db/21) rather than on the profile row.
  //
  // Two rungs, because the owner deploys this build BEFORE running db/21:
  //   1. payment_notes  — the table exists (db/21 run). `limit(1)` rather than
  //      single(): a user who has never written a note has NO row, and single()
  //      turns that ordinary case into an error.
  //   2. profiles.payment_note — the table is missing, so the note is still on
  //      the profile row, which AuthProvider already fetched with select('*').
  //      Checked with typeof rather than truthiness so an intentionally-cleared
  //      note ('') still replaces whatever was typed before.
  // If both are unavailable the box just stays as it is — never an error.
  //
  // Re-runs when the profile changes underneath us (e.g. after refreshProfile),
  // preserving the old re-sync behaviour.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('payment_notes')            // table added by db/21
          .select('note')                   // column: note
          .eq('user_id', uid)               // column: user_id (pk)
          .limit(1);
        if (cancelled) return;
        if (!error) {
          // No row yet = no note written = empty box.
          setPaymentNote((data && data[0] && data[0].note) || '');
          return;
        }
        // Table missing (db/21 not run) → fall back to the old column.
        if (typeof profile?.payment_note === 'string') setPaymentNote(profile.payment_note);
      } catch {
        /* offline, or the table isn't there — leave the box as it is */
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, profile?.payment_note]);

  // Guard: if somehow no user, render nothing.
  // ⚠️ Every hook above this line — no hooks below it.
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

  // ── Save the "how to pay me" note ─────────────────────────────────────────
  // Writes the `payment_notes` table (db/21). An empty box saves NULL, so
  // clearing the note removes it rather than leaving an empty string that the
  // settle-up screen would have to special-case.
  //
  // Upsert, not update: the row only exists once you have saved a note, and the
  // primary key IS the user id, so `onConflict: 'user_id'` means "create it, or
  // overwrite mine" and can never produce a second row.
  //
  // If db/21 hasn't been run the table doesn't exist and PostgREST errors, so we
  // retry the old db/20 write (profiles.payment_note) and saving keeps working
  // on an un-migrated database. If THAT errors too, the message mentions the
  // column name or "schema cache" — the same shape Settings.jsx handles for
  // db/04 and db/14 — and we translate it into a friendly nudge instead of
  // showing the raw message.
  async function handleNoteSave(e) {
    e.preventDefault();
    setNoteError(null);
    setNoteSaved(false);

    const trimmedNote = paymentNote.trim();
    if (trimmedNote.length > PAYMENT_NOTE_MAX) {
      setNoteError(`Please keep this under ${PAYMENT_NOTE_MAX} characters.`);
      return;
    }

    setNoteSaving(true);

    // Rung 1: the dedicated table (db/21).
    const upsertRes = await supabase
      .from('payment_notes')                              // table added by db/21
      .upsert({
        user_id:    user.id,                              // column: user_id (pk)
        note:       trimmedNote || null,                  // column: note (NULL clears it)
        updated_at: new Date().toISOString(),             // column: updated_at
      }, { onConflict: 'user_id' });

    let updateErr = upsertRes.error;

    // Rung 2: the table isn't there yet (db/21 not run) — write the old column.
    // We only retry for a MISSING TABLE. Anything else (a length violation, an
    // RLS refusal) is a real answer from a table that does exist, and re-sending
    // it to `profiles` would only replace one true error with a confusing one.
    if (updateErr && looksLikeMissingNotesTable(updateErr)) {
      const legacyRes = await supabase
        .from('profiles')
        .update({ payment_note: trimmedNote || null })    // column: payment_note (db/20)
        .eq('id', user.id);                               // column: id
      updateErr = legacyRes.error;
    }

    setNoteSaving(false);

    if (updateErr) {
      const msg = updateErr.message || '';
      const lower = msg.toLowerCase();
      // Length constraint FIRST: both constraint names (db/20's
      // profiles_payment_note_len and db/21's payment_notes_len) contain
      // "payment_note", so the missing-table/column test below would swallow
      // them and tell the user to run a migration that is already applied.
      if (
        lower.includes('payment_notes_len') ||
        lower.includes('payment_note_len') ||
        lower.includes('check constraint')
      ) {
        // The database backstop fired (should be unreachable — the input is capped).
        setNoteError(`Please keep this under ${PAYMENT_NOTE_MAX} characters.`);
      } else {
        // ⚠️ THIS BRANCH USED TO GUESS, AND GUESSED WRONG.
        //
        // It tested `lower.includes('payment_note')` and announced "run db/21".
        // But "payment_note" is a SUBSTRING OF "payment_notes", which appears
        // in the text of every error Postgres raises about that table — an RLS
        // refusal, a foreign-key violation, a serialisation failure. So a
        // perfectly present table producing a perfectly real error was
        // reported as a missing migration. Verified against production on
        // 2026-09-18: payment_notes, its user_id/note/updated_at columns, its
        // primary key and all five policies were present and correct while the
        // screen insisted db/21 had not been run.
        //
        // `column` and `relation` were just as loose — both words turn up in
        // errors that have nothing to do with a missing migration.
        //
        // So it no longer tries to tell them apart. The user gets one honest
        // sentence, and the RAW error goes to the console, which is both more
        // useful to a developer than a guessed migration number and incapable
        // of being wrong.
        setNoteError(reportSetupError({
          userMessage: genericSaveFailure('your payment details'),
          devHint: 'payment_notes write failed. If this is a fresh project, check db/21a-c have run; ' +
                   'otherwise read the error below — it is the real one, not a missing migration.',
          error: updateErr,
        }));
      }
      return;
    }

    await refreshProfile();
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
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

          {/* Photo error. Always plain language now — the migration hint it
              used to carry goes to the console instead (data/errors.js). */}
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

        {/* ── How people pay you (payment_notes, db/21) ──
            Its own section and its own Save button, deliberately: neither the
            table nor the old column is guaranteed to exist, and a failure here
            must not stop the display name above from saving.

            The app NEVER moves money. This is a note the other person reads
            before paying you in whatever app they already use — no payment
            integration exists or is planned. */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-4 h-4 text-stone-500" />
            <span className="text-sm font-semibold text-stone-700">How people pay you</span>
          </div>

          <form onSubmit={handleNoteSave} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="payment-note"
                className="text-xs font-medium text-stone-500 uppercase tracking-wide"
              >
                Payment details (visible to your groups)
              </label>

              {/* Said plainly and BEFORE the box, not as fine print underneath:
                  whatever goes in here is shown to other people. */}
              <p className="flex items-start gap-1.5 text-xs text-stone-500">
                <Eye className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Anyone in your groups can see this at settle-up. Don’t put anything
                  private here — no passwords, card numbers or full account numbers.
                </span>
              </p>

              {/* text-base = 16 px — prevents iOS zoom on focus */}
              <textarea
                id="payment-note"
                rows={2}
                value={paymentNote}
                onChange={e => {
                  setPaymentNote(e.target.value);
                  setNoteError(null);
                  setNoteSaved(false);
                }}
                placeholder={`e.g. ${noteHints[0]}`}
                maxLength={PAYMENT_NOTE_MAX}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-stone-400 resize-none"
              />

              <div className="flex items-start justify-between gap-3">
                {/* Still ONE box and still several examples — the currency only
                    decides which one is read first. Anything on this list is a
                    valid answer, including paying a friend in another country. */}
                <p className="text-xs text-stone-400">
                  Examples: {noteHints.map(h => `“${h}”`).join(' · ')}. Splitab never handles
                  the money — it only shows this note and records that you were paid.
                </p>
                <span className="text-xs text-stone-400 shrink-0 tabular-nums">
                  {paymentNote.length}/{PAYMENT_NOTE_MAX}
                </span>
              </div>
            </div>

            {/* Error. Plain language only; the db/21 hint it used to show the
                USER now goes to the console (data/errors.js). */}
            {noteError && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{noteError}</span>
              </div>
            )}

            {/* Success confirmation */}
            {noteSaved && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <Check className="w-4 h-4 shrink-0" />
                <span>Payment details saved.</span>
              </div>
            )}

            <button
              type="submit"
              disabled={noteSaving}
              className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50 transition"
            >
              {noteSaving ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save payment details
                </>
              )}
            </button>
          </form>
        </section>

      </main>
    </div>
  );
}
