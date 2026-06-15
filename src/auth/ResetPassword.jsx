// ResetPassword.jsx
// The "set a new password" screen.
//
// HOW THE USER GETS HERE:
//   1. They clicked "Forgot password?" on the login screen and received an email.
//   2. They clicked the reset link in that email.
//   3. Supabase exchanged the one-time token for a temporary session and fired
//      the PASSWORD_RECOVERY event in onAuthStateChange.
//   4. AuthProvider set recoveryMode = true.
//   5. AuthGate rendered this screen instead of the normal app.
//
// WHAT THIS SCREEN DOES:
//   - Lets the user type a new password (with show/hide toggle) and confirm it.
//   - Validates: non-empty, at least 6 characters, both fields match.
//   - Calls supabase.auth.updateUser({ password }) — Supabase accepts this
//     because the temporary recovery session is active.
//   - On success: shows a brief confirmation, then calls endRecovery() so
//     AuthGate switches back to the normal signed-in view. The session is
//     already valid at this point, so the user lands straight in the app.
//   - On error: shows the error message so the user can try again.
//
// VISUAL STYLE: matches #FAFAF7 / stone / rounded-card pattern used in
// Profile.jsx and AuthScreen.jsx.

import { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { supabase } from '../supabaseClient.js';
import { useAuth } from './AuthProvider.jsx';

export default function ResetPassword() {
  // Pull endRecovery from context — calling it clears recoveryMode and lets
  // the rest of the app render normally.
  const { endRecovery, user } = useAuth();

  // Form field values.
  const [password, setPassword]         = useState('');
  const [confirm, setConfirm]           = useState('');

  // Show/hide toggles — each field has its own independent toggle.
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);

  // UI state.
  const [busy, setBusy]     = useState(false);  // true while awaiting Supabase
  const [error, setError]   = useState('');     // validation or API error string
  const [done, setDone]     = useState(false);  // true after a successful save

  // ── Validation ──────────────────────────────────────────────────────────────
  // Returns an error string, or '' if everything is fine.
  function validate() {
    if (!password)               return 'Please enter a new password.';
    if (password.length < 6)     return 'Password must be at least 6 characters.';
    if (password !== confirm)    return 'Passwords do not match.';
    return '';
  }

  // ── Save handler ─────────────────────────────────────────────────────────────
  async function handleSave(e) {
    e.preventDefault();
    setError('');

    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setBusy(true);

    // updateUser is the correct Supabase call while in a recovery session.
    // It updates the user's password and keeps the session alive.
    const { error: updateErr } = await supabase.auth.updateUser({ password });

    setBusy(false);

    if (updateErr) {
      // Show the Supabase error message (e.g. "Password should be at least 6 characters").
      setError(updateErr.message || 'Could not update password. Please try again.');
      return;
    }

    // Success — show confirmation briefly, then hand control back to AuthGate.
    setDone(true);
    // Short pause so the user can read the confirmation before the screen switches.
    setTimeout(() => endRecovery(), 2000);
  }

  // ── Success state ────────────────────────────────────────────────────────────
  // Shown after updateUser succeeds. endRecovery() fires 2 s later.
  if (done) {
    return (
      <div
        className="min-h-screen bg-[#FAFAF7] flex flex-col items-center justify-center px-4 py-12"
        style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
      >
        <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 shadow-sm p-8 flex flex-col items-center gap-4 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-500" />
          <p className="text-lg font-semibold text-stone-900">Password updated!</p>
          <p className="text-sm text-stone-500">
            Your new password has been saved. Taking you to the app…
          </p>
        </div>
      </div>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen bg-[#FAFAF7] flex flex-col items-center justify-center px-4 py-12"
      style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* Icon + title area — mirrors AuthScreen logo block */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4">
          <ShieldCheck className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-2xl font-semibold text-stone-900">Set a new password</h1>
        {user?.email && (
          <p className="text-sm text-stone-500 mt-1">for {user.email}</p>
        )}
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
        <form onSubmit={handleSave} className="flex flex-col gap-4">

          {/* ── New password field ── */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="new-password"
              className="text-xs font-medium text-stone-500 uppercase tracking-wide flex items-center gap-1"
            >
              <Lock className="w-3 h-3" /> New password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="At least 6 characters"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 pr-10 text-base text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                // text-base (16 px) prevents iOS from zooming in on input focus —
                // matches the same fix already applied to other forms in this app.
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 transition"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* ── Confirm password field ── */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="confirm-password"
              className="text-xs font-medium text-stone-500 uppercase tracking-wide flex items-center gap-1"
            >
              <Lock className="w-3 h-3" /> Confirm password
            </label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Repeat your new password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError(''); }}
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 pr-10 text-base text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 transition"
                tabIndex={-1}
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* ── Error message ── */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Save button ── */}
          {/* Save button — indigo accent, consistent with the rest of auth screens */}
          <button
            type="submit"
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white py-3 text-sm font-medium disabled:opacity-50 transition"
          >
            {busy ? (
              <>
                {/* Inline spinner — same as Profile.jsx save button */}
                <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Saving…
              </>
            ) : (
              'Save new password'
            )}
          </button>

        </form>
      </div>

      <p className="text-xs text-stone-400 mt-6 text-center max-w-xs">
        After saving you'll be signed in automatically.
      </p>
    </div>
  );
}
