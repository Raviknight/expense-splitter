// Profile.jsx
// The Profile / Settings screen.
//
// What this screen lets the signed-in user do:
//   - See their email address (read-only — email changes go through Supabase
//     dashboard; we do not support them in-app yet).
//   - Edit their display name and save it to the `profiles` table.
//   - See when they joined ("Member since").
//
// Table: profiles — columns used here: id, display_name, email, created_at
// (all names match 01_schema.sql exactly)
//
// After a successful save we call refreshProfile() from AuthProvider so the
// new name propagates to the top bar and to store.js (which re-runs its data
// fetch when `profile` changes).

import { useState, useEffect } from 'react';
import { X, User, Mail, Save, Check, AlertCircle, Settings } from 'lucide-react';
import { supabase } from '../supabaseClient.js';
import { useAuth } from './AuthProvider.jsx';

export default function Profile({ onClose }) {
  // Pull what we need from the auth context.
  // refreshProfile is our new helper (added in AuthProvider.jsx).
  const { user, profile, refreshProfile } = useAuth();

  // Local copy of the name the user is currently typing.
  // Initialise from the profile that was already loaded.
  const [displayName, setDisplayName] = useState(profile?.display_name || '');

  // UI state for the save operation.
  const [saving, setSaving]   = useState(false);   // true while awaiting Supabase
  const [saved, setSaved]     = useState(false);   // true for 2 s after success
  const [error, setError]     = useState(null);    // error string, or null

  // If the profile prop changes from the outside (e.g. first load), sync the field.
  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name);
    }
  }, [profile?.display_name]);

  // Guard: if somehow no user, render nothing.
  if (!user) return null;

  // ── Format created_at as a human-readable date ──────────────────────────────
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

  // ── Save handler ─────────────────────────────────────────────────────────────
  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    // Validation: display_name is NOT NULL in the schema — block saving empty string.
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError('Display name cannot be empty.');
      return;
    }

    setSaving(true);

    // Update the profiles row. Column names match 01_schema.sql.
    const { error: updateErr } = await supabase
      .from('profiles')                         // table: profiles
      .update({ display_name: trimmedName })    // column: display_name
      .eq('id', user.id);                       // column: id (= auth user uuid)

    setSaving(false);

    if (updateErr) {
      setError(updateErr.message || 'Could not save. Please try again.');
      return;
    }

    // Success — reload the profile in context so the rest of the app updates.
    // refreshProfile() re-runs the same SELECT that AuthProvider uses on sign-in.
    await refreshProfile();

    // Show a brief "Saved" confirmation tick, then clear it after 2 seconds.
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const memberSince = formatDate(profile?.created_at);

  return (
    <div
      className="min-h-screen bg-[#FAFAF7] text-stone-900"
      style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* ── Header — mirrors Connections.jsx style ── */}
      <header className="sticky top-0 z-20 bg-[#FAFAF7]/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-3 flex items-center gap-3">
          {/* Back button */}
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
              <Settings className="w-3 h-3" /> Settings
            </p>
            <h1 className="text-xl font-semibold">Profile</h1>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="max-w-3xl mx-auto px-4 py-6 pb-32 flex flex-col gap-6">

        {/* Avatar / name hero card */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm flex items-center gap-4">
          {/* Simple initial avatar — same style as Connections accepted list */}
          <div className="w-14 h-14 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 text-2xl font-semibold shrink-0">
            {(profile?.display_name || user?.email || '?')[0].toUpperCase()}
          </div>
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

        {/* Edit form card */}
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
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={e => {
                  setDisplayName(e.target.value);
                  // Clear stale error/success when the user starts typing again.
                  setError(null);
                  setSaved(false);
                }}
                placeholder="Your name"
                maxLength={80}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 placeholder-stone-400"
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

            {/* Save button */}
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center gap-2 rounded-xl bg-stone-900 text-white px-4 py-2.5 text-sm font-medium hover:bg-stone-700 disabled:opacity-50 transition"
            >
              {saving ? (
                <>
                  {/* Inline spinner — same pattern as AuthGate loading state */}
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
