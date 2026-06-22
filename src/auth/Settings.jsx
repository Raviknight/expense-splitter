// Settings.jsx
// The account Settings screen — a full-page overlay, same pattern as
// Profile.jsx and Connections.jsx (no router; AuthGate renders it when its
// showSettings flag is true and hides it via onClose).
//
// What lives here (everything that is NOT personal "who am I" info):
//   1. Default currency — saved to profiles.preferred_currency (db/04).
//   2. Appearance       — light / dark theme toggle (localStorage 'slitab.theme'
//                         + the `.dark` class on <html>).
//   3. Password         — change password while signed in (updateUser).
//   4. Notifications     — a "Coming soon" placeholder (push is NOT built yet).
//   5. Sign out         — clear sign-out button at the bottom.
//
// Personal info (photo, display name, email) stays in Profile.jsx.
//
// We read everything we need from useAuth():
//   • user           — for the password update (the live session)
//   • profile        — to seed the currency picker
//   • refreshProfile — re-fetch the profiles row after a currency save so the
//                      rest of the app (header, store.js) picks up the change
//   • signOut        — the sign-out action (moved here from the top bar)

import { useState, useEffect } from 'react';
import {
  X, Settings as SettingsIcon, Save, Check, AlertCircle,
  Lock, Eye, EyeOff, DollarSign, Sun, Moon, Bell, LogOut,
  Crown, Sparkles,
} from 'lucide-react';
import { supabase } from '../supabaseClient.js';
import { useAuth } from './AuthProvider.jsx';

// ── Supported currencies ──────────────────────────────────────────────────────
// Each entry: { code, symbol, label } used to build the <select> options.
// Codes stored in profiles.preferred_currency must match these exactly.
const CURRENCIES = [
  { code: 'USD', symbol: '$',   label: '$ USD'  },
  { code: 'EUR', symbol: '€',   label: '€ EUR'  },
  { code: 'GBP', symbol: '£',   label: '£ GBP'  },
  { code: 'INR', symbol: '₹',   label: '₹ INR'  },
  { code: 'CAD', symbol: 'CA$', label: 'CA$ CAD' },
  { code: 'AUD', symbol: 'A$',  label: 'A$ AUD'  },
  { code: 'JPY', symbol: '¥',   label: '¥ JPY'  },
];

export default function Settings({ onClose }) {
  // Pull what we need from the auth context.
  const { user, profile, refreshProfile, signOut } = useAuth();

  // ── Premium status ────────────────────────────────────────────────────────
  // `profile.is_premium` comes from the profiles table (added by db/11). Before
  // db/11 is run the column is missing, so this is undefined → treated as false.
  const isPremium = profile?.is_premium === true;
  // How the user got premium, when present: 'comp' (complimentary / granted by
  // hand), 'lemonsqueezy', or 'stripe'. Used to label the status card.
  const premiumSource = profile?.premium_source || null;
  // Phase 1 has no checkout yet — the Upgrade button shows a "coming soon" note.
  const [showUpgradeNote, setShowUpgradeNote] = useState(false);

  // ── Currency picker state ─────────────────────────────────────────────────
  // Default to 'USD' when the profile has no preferred_currency yet.
  const [currency, setCurrency]             = useState(profile?.preferred_currency || 'USD');
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencySaved, setCurrencySaved]   = useState(false);
  const [currencyError, setCurrencyError]   = useState(null);

  // ── Password change state ─────────────────────────────────────────────────
  const [newPassword, setNewPassword]     = useState('');
  const [confirmPw, setConfirmPw]         = useState('');
  const [showNewPw, setShowNewPw]         = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwSaving, setPwSaving]           = useState(false);
  const [pwSaved, setPwSaved]             = useState(false);
  const [pwError, setPwError]             = useState(null);

  // ── Appearance (light / dark) state ───────────────────────────────────────
  // The actual theme is driven by a `.dark` class on <html> (see the overrides
  // in public/index.html). Here we just remember which mode is active so the
  // toggle highlights the right button.
  //
  // First load:
  //   • If the user saved a choice before, use it ('light' or 'dark').
  //   • If they never chose, follow the system — which the no-flash script in
  //     index.html already resolved by adding/removing `.dark` on <html>.
  //     So we read the live class to reflect whatever the system gave us.
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem('slitab.theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      // No saved choice → mirror the current <html> class (set by the bootstrap).
      return document.documentElement.classList.contains('dark');
    } catch {
      return false;
    }
  });

  // Apply a theme everywhere: flip the <html> class (instant, no reload) and
  // remember the choice so it sticks on the next visit.
  function applyTheme(dark) {
    setIsDark(dark);
    try {
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem('slitab.theme', dark ? 'dark' : 'light');
    } catch {
      // localStorage can throw in private mode — the class toggle still works
      // for this session, so we ignore it.
    }
  }

  // Sync the currency picker when the profile prop arrives from context.
  useEffect(() => {
    if (profile?.preferred_currency) setCurrency(profile.preferred_currency);
  }, [profile?.preferred_currency]);

  // Guard: if somehow no user, render nothing.
  if (!user) return null;

  // ── Save preferred currency ───────────────────────────────────────────────
  // The preferred_currency column is added by db/04_add_currency.sql.
  // If that script hasn't been run yet, Supabase returns an error whose message
  // mentions the column name or "schema cache". We catch that and show a
  // friendly nudge instead of a raw error.
  async function handleCurrencySave() {
    setCurrencyError(null);
    setCurrencySaved(false);
    setCurrencySaving(true);

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ preferred_currency: currency })  // column: preferred_currency
      .eq('id', user.id);

    setCurrencySaving(false);

    if (updateErr) {
      // Detect "column does not exist" / "schema cache" errors from PostgREST.
      const msg = updateErr.message || '';
      if (
        msg.toLowerCase().includes('preferred_currency') ||
        msg.toLowerCase().includes('schema cache') ||
        msg.toLowerCase().includes('column')
      ) {
        setCurrencyError(
          'Currency needs a one-time database update — ask to run db/04.'
        );
      } else {
        setCurrencyError(msg || 'Could not save currency. Please try again.');
      }
      return;
    }

    // Refresh so the rest of the app (header, store.js) picks up the new currency.
    await refreshProfile();
    setCurrencySaved(true);
    setTimeout(() => setCurrencySaved(false), 2000);
  }

  // ── Change password ───────────────────────────────────────────────────────
  // The user is already signed in, so no email is needed.
  // supabase.auth.updateUser({ password }) works directly with the live session.
  function validatePassword() {
    if (!newPassword)              return 'Please enter a new password.';
    if (newPassword.length < 6)    return 'Password must be at least 6 characters.';
    if (newPassword !== confirmPw) return 'Passwords do not match.';
    return '';
  }

  async function handlePasswordSave(e) {
    e.preventDefault();
    setPwError(null);
    setPwSaved(false);

    const validationError = validatePassword();
    if (validationError) { setPwError(validationError); return; }

    setPwSaving(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);

    if (updateErr) {
      setPwError(updateErr.message || 'Could not update password. Please try again.');
      return;
    }

    // Success — clear the fields and show a brief confirmation.
    setNewPassword('');
    setConfirmPw('');
    setPwSaved(true);
    setTimeout(() => setPwSaved(false), 3000);
  }

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
              <SettingsIcon className="w-3 h-3" /> Account
            </p>
            <h1 className="text-xl font-semibold">Settings</h1>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="max-w-3xl mx-auto px-4 py-6 pb-32 flex flex-col gap-6">

        {/* ── Section 0: Premium ──
            Shown at the very top. Two states:
              • Already premium  → a simple "Premium active" status card.
              • Not premium      → a benefits card with an "Upgrade" button.
            Phase 1 has no checkout, so Upgrade just shows a "coming soon" note.
            (Free premium is granted by hand in the database as 'comp'.) */}
        {isPremium ? (
          // ── Premium ACTIVE state ──
          <section className="bg-white border border-indigo-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-semibold text-stone-700">Premium</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="text-sm text-emerald-800">
                <span className="font-medium">Premium active</span>
                {/* Name the source when we know it. 'comp' reads nicer as
                    "complimentary"; paid sources show their provider. */}
                {premiumSource && (
                  <span className="text-emerald-700">
                    {' '}—{' '}
                    {premiumSource === 'comp'
                      ? 'complimentary'
                      : premiumSource === 'lemonsqueezy'
                        ? 'Lemon Squeezy'
                        : premiumSource === 'stripe'
                          ? 'Stripe'
                          : premiumSource}
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-stone-400 mt-2">
              Thanks for supporting Splitab. All premium features are unlocked.
            </p>
          </section>
        ) : (
          // ── NOT premium state (upsell) ──
          <section className="bg-white border border-indigo-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-semibold text-stone-700">Splitab Premium</span>
            </div>
            <p className="text-xs text-stone-500 mb-3">
              Unlock the power features and support the app.
            </p>

            {/* Benefit list — the agreed premium features. */}
            <ul className="flex flex-col gap-2 mb-4">
              {[
                'Unlimited receipt & statement scanning',
                'Recurring expenses',
                'Advanced insights',
                'PDF export',
              ].map(benefit => (
                <li key={benefit} className="flex items-start gap-2 text-sm text-stone-700">
                  <Check className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>

            {/* Upgrade — Phase 1 shows a "coming soon" note (no checkout yet). */}
            <button
              type="button"
              onClick={() => setShowUpgradeNote(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 text-sm font-medium transition"
            >
              <Crown className="w-4 h-4" />
              Upgrade
            </button>

            {/* Coming-soon note, revealed after tapping Upgrade. */}
            {showUpgradeNote && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Coming soon — paid plans launching shortly.</span>
              </div>
            )}
          </section>
        )}

        {/* ── Section 1: Default currency ── */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-4 h-4 text-stone-500" />
            <span className="text-sm font-semibold text-stone-700">Default currency</span>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="currency-select"
                className="text-xs font-medium text-stone-500 uppercase tracking-wide"
              >
                Preferred currency
              </label>
              {/*
                text-base = 16 px prevents iOS zoom.
                The select value is controlled by `currency` state.
                Changing the select doesn't auto-save — the user clicks Save.
              */}
              <select
                id="currency-select"
                value={currency}
                onChange={e => {
                  setCurrency(e.target.value);
                  setCurrencyError(null);
                  setCurrencySaved(false);
                }}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              <p className="text-xs text-stone-400">
                Used as the default currency when creating new groups.
              </p>
            </div>

            {/* Currency error — may include the "run db/04" hint */}
            {currencyError && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{currencyError}</span>
              </div>
            )}

            {/* Currency success */}
            {currencySaved && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <Check className="w-4 h-4 shrink-0" />
                <span>Currency saved.</span>
              </div>
            )}

            {/* Save currency button — indigo accent */}
            <button
              type="button"
              onClick={handleCurrencySave}
              disabled={currencySaving}
              className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50 transition"
            >
              {currencySaving ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save currency
                </>
              )}
            </button>
          </div>
        </section>

        {/* ── Section 2: Appearance (light / dark) ── */}
        {/*
          A two-button toggle. The active mode is highlighted with the indigo
          accent. Tapping a button applies the theme instantly (flips the
          `.dark` class on <html>) and saves the choice to localStorage — no
          page reload, no Save button needed.
        */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Sun className="w-4 h-4 text-stone-500" />
            <span className="text-sm font-semibold text-stone-700">Appearance</span>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
              Theme
            </label>

            {/* Segmented Light / Dark toggle */}
            <div className="grid grid-cols-2 gap-2">
              {/* Light option */}
              <button
                type="button"
                onClick={() => applyTheme(false)}
                aria-pressed={!isDark}
                className={
                  'flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border transition ' +
                  (!isDark
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50')
                }
              >
                <Sun className="w-4 h-4" />
                Light
              </button>

              {/* Dark option */}
              <button
                type="button"
                onClick={() => applyTheme(true)}
                aria-pressed={isDark}
                className={
                  'flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border transition ' +
                  (isDark
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50')
                }
              >
                <Moon className="w-4 h-4" />
                Dark
              </button>
            </div>

            <p className="text-xs text-stone-400">
              Choose how Splitab looks on this device. New devices start by
              following your system setting.
            </p>
          </div>
        </section>

        {/* ── Section 3: Change password ── */}
        {/*
          The user is already authenticated, so we don't need their current
          password or their email. supabase.auth.updateUser({ password }) works
          directly when a session is active.
        */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-4 h-4 text-stone-500" />
            <span className="text-sm font-semibold text-stone-700">Password</span>
          </div>

          <form onSubmit={handlePasswordSave} className="flex flex-col gap-4">

            {/* New password field */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="new-password"
                className="text-xs font-medium text-stone-500 uppercase tracking-wide"
              >
                New password
              </label>
              <div className="relative">
                {/* text-base = 16 px — prevents iOS zoom */}
                <input
                  id="new-password"
                  type={showNewPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={e => {
                    setNewPassword(e.target.value);
                    setPwError(null);
                    setPwSaved(false);
                  }}
                  className="w-full rounded-xl border border-stone-200 bg-white px-4 py-2.5 pr-10 text-base text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 transition"
                  tabIndex={-1}
                  aria-label={showNewPw ? 'Hide password' : 'Show password'}
                >
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm password field */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="confirm-password"
                className="text-xs font-medium text-stone-500 uppercase tracking-wide"
              >
                Confirm new password
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirmPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repeat your new password"
                  value={confirmPw}
                  onChange={e => {
                    setConfirmPw(e.target.value);
                    setPwError(null);
                    setPwSaved(false);
                  }}
                  className="w-full rounded-xl border border-stone-200 bg-white px-4 py-2.5 pr-10 text-base text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 transition"
                  tabIndex={-1}
                  aria-label={showConfirmPw ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Password error */}
            {pwError && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{pwError}</span>
              </div>
            )}

            {/* Password success */}
            {pwSaved && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <Check className="w-4 h-4 shrink-0" />
                <span>Password updated successfully.</span>
              </div>
            )}

            {/* Validation rules hint — visible below the fields before any error */}
            {!pwError && !pwSaved && (
              <p className="text-xs text-stone-400">
                Minimum 6 characters. Both fields must match.
              </p>
            )}

            {/* Save button — indigo accent */}
            <button
              type="submit"
              disabled={pwSaving}
              className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50 transition"
            >
              {pwSaving ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Update password
                </>
              )}
            </button>
          </form>
        </section>

        {/* ── Section 4: Notifications (placeholder) ── */}
        {/*
          Push notifications are NOT built yet. This is a clearly-disabled
          placeholder so the option's home is obvious once it exists. The toggle
          does nothing (disabled); a "Coming soon" badge sets expectations.
        */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-4 h-4 text-stone-500" />
            <span className="text-sm font-semibold text-stone-700">Notifications</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-stone-700">Push notifications</span>
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 border border-stone-200">
                  Coming soon
                </span>
              </div>
              <p className="text-xs text-stone-400 mt-0.5">
                Get a heads-up when someone adds an expense or settles up. This
                isn't available yet — we're still building it.
              </p>
            </div>

            {/* A disabled, non-functional switch (visual placeholder only). */}
            <span
              role="switch"
              aria-checked="false"
              aria-disabled="true"
              title="Coming soon"
              className="shrink-0 inline-flex items-center h-6 w-11 rounded-full bg-stone-200 opacity-60 cursor-not-allowed p-0.5"
            >
              <span className="h-5 w-5 rounded-full bg-white shadow" />
            </span>
          </div>
        </section>

        {/* ── Section 5: Sign out ── */}
        {/*
          Moved here from the top bar. A plain (non-indigo) action — destructive
          intent without being alarming, styled like the other secondary buttons
          but kept on its own so it's easy to find at the bottom.
        */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-50 px-4 py-2.5 text-sm font-medium transition"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </section>

      </main>
    </div>
  );
}
