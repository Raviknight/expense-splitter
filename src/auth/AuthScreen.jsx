// AuthScreen.jsx
// The login page. Shown whenever nobody is signed in.
//
// Three ways to sign in:
//   1. Magic link (primary) — enter your email, get a one-click link in your inbox.
//      Uses supabase.auth.signInWithOtp({ email }). No password needed.
//   2. Google (secondary) — one click, uses OAuth redirect.
//   3. Email + password (collapsible) — traditional sign-up / sign-in.
//      Works only if you enable the Email provider in Supabase Auth settings.
//
// Visual style: background #FAFAF7, indigo accent for primary actions,
// Tailwind via CDN, lucide-react icons, rounded cards, mobile-first layout.

import { useState } from 'react';
import {
  Mail, KeyRound, Eye, EyeOff, ChevronDown, ChevronUp,
  ArrowRight, CheckCircle, Users, WifiOff, Smartphone,
} from 'lucide-react';
import { supabase } from '../supabaseClient.js';

// The exact URL of this app, INCLUDING the path. On GitHub Pages the app lives
// at https://<user>.github.io/<repo>/ — window.location.origin alone drops the
// "/<repo>/" part, which would send the sign-in redirect to the wrong place.
// origin + pathname keeps it correct on both localhost and GitHub Pages.
const APP_URL = window.location.origin + window.location.pathname;

// ---- small helpers ----

// Generic error message strip
function ErrorMsg({ msg }) {
  if (!msg) return null;
  return (
    <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
      {msg}
    </p>
  );
}

// ---- Feature highlights (shown below the hero) ----
// Three compact bullets that communicate the app's value at a glance.
const FEATURES = [
  {
    icon: Users,
    text: 'Split with friends in real time',
  },
  {
    icon: Smartphone,
    // "ghosts" = the app's term for people added without an account
    text: 'Add people without accounts',
  },
  {
    icon: WifiOff,
    text: 'Works on your phone, offline-ready',
  },
];

// ---- Magic-link section (primary) ----
function MagicLinkForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  async function handleSend(e) {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // After clicking the link, the browser is redirected back to this URL.
        emailRedirectTo: APP_URL,
      },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setSent(true);
  }

  // "Check your email" confirmation state
  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle className="w-10 h-10 text-emerald-500" />
        <p className="font-semibold text-stone-800">Check your email</p>
        <p className="text-sm text-stone-500 max-w-xs">
          We sent a sign-in link to <strong>{email}</strong>. Click it to continue — no password needed.
        </p>
        <button
          onClick={() => { setSent(false); setEmail(''); }}
          className="text-xs text-indigo-600 underline underline-offset-2 mt-1 hover:text-indigo-800 transition"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSend} className="flex flex-col gap-3">
      <label className="text-xs font-medium text-stone-600 uppercase tracking-wider">
        Email address
      </label>
      <div className="flex gap-2">
        {/* text-base = 16 px — prevents iOS from zooming on input focus */}
        <input
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="flex-1 rounded-xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {/* Primary send button — indigo accent */}
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 text-sm font-medium disabled:opacity-50 transition"
        >
          {busy ? 'Sending…' : <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
      <ErrorMsg msg={error} />
      <p className="text-xs text-stone-400">
        We'll email you a one-click sign-in link. No password required.
      </p>
    </form>
  );
}

// ---- Google section ----
function GoogleButton() {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  async function handleGoogle() {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: APP_URL,
      },
    });
    // If there's an error before the redirect happens, show it.
    // (Normally the browser navigates away and this never runs.)
    if (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleGoogle}
        disabled={busy}
        className="flex items-center justify-center gap-2.5 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition shadow-sm"
      >
        {/* Simple coloured G icon using SVG — avoids an external image dependency */}
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
          <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
        </svg>
        {busy ? 'Redirecting…' : 'Continue with Google'}
      </button>
      <ErrorMsg msg={error} />
    </div>
  );
}

// ---- Email + password (collapsible, optional) ----
function EmailPasswordForm() {
  const [open, setOpen]         = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  // ---- Forgot-password state ----
  // resetSent: true after the reset email has been dispatched successfully.
  // resetBusy: true while the request is in-flight.
  const [resetSent, setResetSent] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!email.trim() || !password) { setError('Please fill in email and password.'); return; }
    setBusy(true);
    if (isSignUp) {
      const { error: err } = await supabase.auth.signUp({ email: email.trim(), password });
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSuccess('Account created! Check your email to confirm, then sign in.');
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (err) { setError(err.message); return; }
      // On success AuthProvider's onAuthStateChange fires and the gate swaps to the app.
    }
  }

  // handleForgotPassword: sends a Supabase password-reset email.
  // The reset link in the email redirects back to APP_URL, where
  // supabase-js detects the recovery tokens and fires PASSWORD_RECOVERY
  // in onAuthStateChange, which sets recoveryMode = true in AuthProvider.
  async function handleForgotPassword() {
    setError('');
    // Require an email address to be typed first.
    if (!email.trim()) {
      setError('Enter your email address above, then click "Forgot password?".');
      return;
    }
    setResetBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: APP_URL }   // same base URL used by magic-link and Google
    );
    setResetBusy(false);
    if (err) { setError(err.message); return; }
    // Show the "check your email" confirmation state.
    setResetSent(true);
  }

  // ---- "Check your email" confirmation for the reset link ----
  // Mirrors the MagicLinkForm's sent state in look and feel.
  if (resetSent) {
    return (
      <div className="flex flex-col gap-3 mt-3">
        {/* Collapsible header stays visible so the user knows what section this is */}
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center justify-between w-full text-sm text-stone-500 hover:text-stone-700 transition py-1"
        >
          <span className="flex items-center gap-1.5">
            <KeyRound className="w-4 h-4" />
            Email &amp; password
            <span className="text-[10px] uppercase tracking-widest text-stone-400 ml-1">optional</span>
          </span>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle className="w-10 h-10 text-emerald-500" />
          <p className="font-semibold text-stone-800">Check your email</p>
          <p className="text-sm text-stone-500 max-w-xs">
            We sent a password-reset link to <strong>{email}</strong>.
            Click it to set a new password.
          </p>
          <button
            onClick={() => { setResetSent(false); setEmail(''); setError(''); }}
            className="text-xs text-indigo-600 underline underline-offset-2 mt-1 hover:text-indigo-800 transition"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full text-sm text-stone-500 hover:text-stone-700 transition py-1"
      >
        <span className="flex items-center gap-1.5">
          <KeyRound className="w-4 h-4" />
          Email &amp; password
          <span className="text-[10px] uppercase tracking-widest text-stone-400 ml-1">optional</span>
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-3">
          {/* Sign in / sign up toggle — indigo for active tab */}
          <div className="flex rounded-lg overflow-hidden border border-stone-200 text-sm">
            <button
              type="button"
              onClick={() => setIsSignUp(false)}
              className={`flex-1 py-2 transition ${!isSignUp ? 'bg-indigo-600 text-white font-medium' : 'text-stone-500 hover:bg-stone-50'}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setIsSignUp(true)}
              className={`flex-1 py-2 transition ${isSignUp ? 'bg-indigo-600 text-white font-medium' : 'text-stone-500 hover:bg-stone-50'}`}
            >
              Sign up
            </button>
          </div>

          {/* text-base (16 px) prevents iOS zoom on input focus */}
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-stone-400"
          />

          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 pr-10 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-stone-400"
            />
            <button
              type="button"
              onClick={() => setShowPw(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              tabIndex={-1}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Submit button — indigo accent */}
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white py-3 text-sm font-medium disabled:opacity-50 transition"
          >
            {busy ? (isSignUp ? 'Creating account…' : 'Signing in…') : (isSignUp ? 'Create account' : 'Sign in')}
          </button>

          {/* "Forgot password?" — only shown on the Sign in tab, not Sign up.
              The user must have their email typed in already (validation above
              will remind them if not). */}
          {!isSignUp && (
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={resetBusy}
              className="text-xs text-indigo-600 hover:text-indigo-800 underline underline-offset-2 self-start disabled:opacity-50 transition"
            >
              {resetBusy ? 'Sending reset link…' : 'Forgot password?'}
            </button>
          )}

          <ErrorMsg msg={error} />
          {success && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {success}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

// ---- Main screen ----
export default function AuthScreen() {
  return (
    <div
      className="min-h-screen bg-[#FAFAF7] flex flex-col items-center justify-center px-4 py-12"
      style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
    >

      {/* ── Hero / title area ── */}
      <div className="mb-8 text-center">
        {/* App mark — indigo background with a split/receipt icon */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 mb-4 shadow-md">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {/* Receipt icon drawn inline — no extra import needed */}
            <polyline points="1 6 1 22 23 22 23 6" />
            <path d="M1 6l11-4 11 4" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="8" y1="16" x2="16" y2="16" />
          </svg>
        </div>

        {/* App name */}
        <h1 className="text-3xl font-bold text-stone-900 tracking-tight">Splitab</h1>

        {/* Tagline — value proposition in one line */}
        <p className="text-sm text-stone-500 mt-2 max-w-xs mx-auto leading-relaxed">
          Split trip expenses with anyone — even friends who aren't on the app.
        </p>

        {/* Three feature highlights — compact icon + text rows */}
        <ul className="mt-5 flex flex-col gap-2 text-left max-w-[260px] mx-auto">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5">
              {/* Small indigo pill icon container */}
              <span className="flex items-center justify-center w-6 h-6 rounded-md bg-indigo-50 shrink-0">
                <Icon className="w-3.5 h-3.5 text-indigo-600" />
              </span>
              <span className="text-xs text-stone-600">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Card ── */}
      <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 shadow-sm p-6 flex flex-col gap-6">

        {/* 1. Magic link (primary) */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Mail className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-medium text-stone-700">Sign in with email link</span>
            {/* "Recommended" badge — emerald to keep the positive/recommended semantic */}
            <span className="ml-auto text-[10px] uppercase tracking-widest text-emerald-600 font-semibold bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
              Recommended
            </span>
          </div>
          <MagicLinkForm />
        </section>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-stone-100" />
          <span className="text-xs text-stone-400">or</span>
          <div className="flex-1 border-t border-stone-100" />
        </div>

        {/* 2. Google */}
        <section>
          <GoogleButton />
          <p className="text-xs text-stone-400 mt-2">
            Requires Google OAuth to be enabled in Supabase Auth settings.
          </p>
        </section>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-stone-100" />
          <span className="text-xs text-stone-400">or</span>
          <div className="flex-1 border-t border-stone-100" />
        </div>

        {/* 3. Email + password (collapsible) */}
        <section>
          <EmailPasswordForm />
        </section>
      </div>

      {/* Footer privacy line */}
      <p className="text-xs text-stone-400 mt-6 text-center max-w-xs">
        Your data is protected by Row-Level Security. Only you and your accepted connections can see your expenses.
      </p>
    </div>
  );
}
