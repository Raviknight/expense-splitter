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

import { useState, useEffect, useRef, useCallback } from 'react';
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

// ---- Cloudflare Turnstile (the CAPTCHA) ----
//
// PUBLIC value. A Turnstile sitekey is designed to be readable in the page
// source — it only names the widget. The secret half lives in Supabase and is
// never in this repo. (The script tag that loads Turnstile is in
// public/index.html.)
const TURNSTILE_SITEKEY = '0x4AAAAAAEyIZXeY6pnjwznA';

// How long to keep waiting for the Turnstile script before giving up, in ms.
// The script is loaded async, so it is normally NOT ready when React mounts.
const TURNSTILE_WAIT_MS = 10000;
const TURNSTILE_POLL_MS = 200;

// How long a SUBMIT will wait for a solved token before going ahead without
// one. Separate from the two above, which are about the script arriving.
//
// 12s is chosen to cover the slowest legitimate case: Cloudflare escalating to
// an interactive checkbox that the user has to notice and click. Shorter values
// re-introduce the race this exists to kill. It is still bounded, because a
// Turnstile outage must never stop someone signing in — on timeout the request
// goes out with no token, which is exactly how the app behaved before CAPTCHA.
const CAPTCHA_WAIT_MS = 12000;
const CAPTCHA_POLL_MS = 150;

// useTurnstile — renders ONE Turnstile widget and hands its token to whichever
// form submits.
//
// WHY ONE WIDGET, NOT THREE: this screen has three sign-in routes (magic link,
// Google, email+password) but a person only ever uses one of them. Three
// widgets would mean three Cloudflare challenges on one page, three times the
// script work, and three tokens to keep straight. One shared widget sits in the
// card and every form reads from it.
//
// WHY REFS AND NOT useState: the token is only ever read inside a submit
// handler, never rendered. Keeping it in a ref means a solved challenge does
// not re-render the whole sign-in card (which would, among other things, throw
// away whatever the user had half-typed into a field).
//
// WHY EXPLICIT RENDERING: the alternative is putting class="cf-turnstile" on a
// div and letting the script find it. That works on a static page, but React
// owns this div's lifecycle — it can mount, unmount and remount it — and the
// auto-scan has no idea about any of that, so widgets stack up. Calling
// window.turnstile.render() ourselves means we hold the widget id and can
// remove it again on unmount.
//
// THE WHOLE THING IS BEST-EFFORT. If Cloudflare is blocked, slow, or the user
// is on a network that eats the script, there is simply no token and sign-in
// proceeds without one. Sign-in is the door to the entire app: a CDN hiccup
// must never be the reason nobody can get in.
function useTurnstile() {
  const containerRef = useRef(null);   // the <div> the widget is drawn into
  const widgetIdRef  = useRef(null);   // what render() gave us; needed by reset()/remove()
  const tokenRef     = useRef('');     // the most recent solved token

  useEffect(() => {
    let cancelled = false;    // set on unmount, so a late poll can't render into a dead div
    let pollId    = null;
    let waited    = 0;

    // Returns true when there is nothing left to wait for (rendered, or gave up).
    function tryRender() {
      if (cancelled) return true;
      // window.turnstile only exists once the script from index.html has run.
      const api = window.turnstile;
      if (!api || !containerRef.current) return false;

      // Belt and braces: if this effect ever runs twice against the same div
      // (React StrictMode double-mounts in development), start from an empty
      // container so widgets cannot stack.
      containerRef.current.innerHTML = '';

      try {
        // Documented signature: render(container, params) -> widgetId.
        // The container is passed as a CSS selector string, which is the form
        // Cloudflare's own example uses.
        widgetIdRef.current = api.render('#turnstile-container', {
          sitekey: TURNSTILE_SITEKEY,
          // Fired when the challenge is solved. The token is SINGLE USE.
          callback: (token) => { tokenRef.current = token || ''; },
          // Tokens go stale (~5 minutes). Drop ours so we never send a dead one.
          'expired-callback': () => { tokenRef.current = ''; },
          // Network error, blocked domain, etc. No token — and that is fine,
          // the forms still submit.
          'error-callback': () => { tokenRef.current = ''; },
          // Match the app's own theme. This app drives dark mode with a `.dark`
          // class on <html> (see tailwind.config.js darkMode: 'class'), which
          // can differ from the OS preference the user picked — so read the
          // class rather than using Turnstile's OS-following 'auto'.
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        });
      } catch (e) {
        // A throw here means no widget and no token. Sign-in still works.
        widgetIdRef.current = null;
      }
      return true;
    }

    // The script is async, so it usually is NOT ready on first paint. Poll for
    // it briefly, then stop asking. Stopping matters: an interval that never
    // clears would keep running for as long as the sign-in screen is open.
    if (!tryRender()) {
      pollId = setInterval(() => {
        waited += TURNSTILE_POLL_MS;
        if (tryRender() || waited >= TURNSTILE_WAIT_MS) {
          clearInterval(pollId);
          pollId = null;
        }
      }, TURNSTILE_POLL_MS);
    }

    // Clean up so a remount (dev hot reload, or React re-mounting this screen)
    // does not leave an orphaned widget behind and then stack a second one.
    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch (e) { /* already gone — nothing to do */ }
      widgetIdRef.current = null;
      tokenRef.current    = '';
    };
  }, []);

  // WAIT for a token rather than snatching whatever happens to be there.
  //
  // This was synchronous — `() => tokenRef.current || undefined` — and that
  // shipped a race that broke password reset in production. There is no token
  // during the first second or two after load while the challenge solves; there
  // is none for a moment after EVERY submit, because resetCaptcha() deliberately
  // throws the spent one away and a replacement takes time to arrive; and there
  // is none at all while Cloudflare is showing an interactive checkbox, until
  // the user clicks it. Reading synchronously in any of those windows sent NO
  // token, and once CAPTCHA protection is enforced Supabase answers
  // "captcha protection: request disallowed (no captcha_token found)".
  //
  // Sign-in appeared to work only because typing a password takes long enough
  // for the token to land. Password reset is a single click, so it lost the
  // race almost every time. The bug was in the timing, not the call shape.
  //
  // So: poll briefly for a token. The wait is generous enough to cover a
  // re-solve and an interactive click, and it STILL gives up rather than
  // blocking sign-in forever — a Turnstile outage must never lock anyone out,
  // which is the rule this whole integration is built around. On give-up we
  // return undefined and the request goes out bare, exactly as before.
  const getCaptchaToken = useCallback(async () => {
    if (tokenRef.current) return tokenRef.current;
    const deadline = Date.now() + CAPTCHA_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, CAPTCHA_POLL_MS));
      if (tokenRef.current) return tokenRef.current;
    }
    return undefined;
  }, []);

  // A Turnstile token can only be spent ONCE. If someone mistypes their
  // password and tries again, the second attempt would reuse a spent token and
  // fail with a confusing "captcha protection: request disallowed" — so we ask
  // for a fresh challenge after every submit attempt, successful or not.
  const resetCaptcha = useCallback(() => {
    tokenRef.current = '';
    try {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    } catch (e) { /* no widget to reset — nothing to do */ }
  }, []);

  return { containerRef, getCaptchaToken, resetCaptcha };
}

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
    text: 'Split bills, rent, or a whole trip',
  },
  {
    icon: Smartphone,
    // "ghosts" = the app's term for people added without an account
    text: 'Add people who aren’t on the app',
  },
  {
    icon: WifiOff,
    text: 'Works offline, syncs across devices',
  },
];

// The three selling points. `className` lets the caller control placement.
function FeatureList({ className = '' }) {
  return (
    <ul className={`flex-col gap-2.5 text-left max-w-[260px] mx-auto ${className}`}>
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
  );
}

// ---- Magic-link section (primary) ----
//
// WHY THERE IS ALSO A CODE BOX:
//   Corporate and university mail security (Outlook Safe Links, Barracuda,
//   Proofpoint, and similar) PRE-FETCHES every link in an incoming email to
//   scan it. A Supabase magic link is single-use, so the scanner consumes the
//   token and the real click then fails with "invalid or has expired". This is
//   a well-known Supabase issue (supabase/auth#1214), not a misconfiguration,
//   and it makes magic links unusable on many work addresses.
//
//   The same email also carries a 6-digit code. A scanner cannot consume a code
//   that has to be typed, so the code path works where the link does not. The
//   link stays the happy path for personal inboxes; the code is the fallback.
//
//   NOTE: the code only appears in the email once the Supabase email template
//   includes {{ .Token }} — see the setup note in CLAUDE.md.
//
//   DO NOT hard-code the code length. Supabase's OTP length is a project
//   setting (Authentication → Sign In/Up → OTP length); this project issues 8
//   digits, not the documented default of 6. An input capped at 6 truncates the
//   pasted code and every verification fails with no visible cause.
//
// The two captcha props come from useTurnstile() up in AuthScreen. Defaults are
// provided so this form still works if it is ever rendered on its own.
function MagicLinkForm({ getCaptchaToken = () => undefined, resetCaptcha = () => {} }) {
  const [email, setEmail] = useState('');
  const [sent, setSent]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  // Code-entry state, used only after the email has been sent.
  const [code, setCode]         = useState('');
  const [verifying, setVerify]  = useState(false);
  const [codeError, setCodeErr] = useState('');

  async function handleSend(e) {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    setBusy(true);
    // AWAIT: this waits for the challenge to solve instead of grabbing whatever
    // is there this instant. `setBusy(true)` above already put the button in its
    // pending state, so the wait reads as a normal submit. Still may resolve to
    // undefined if Turnstile never answers — see useTurnstile for why that has
    // to stay possible.
    const captchaToken = await getCaptchaToken();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // After clicking the link, the browser is redirected back to this URL.
        emailRedirectTo: APP_URL,
        captchaToken,
      },
    });
    // Single-use token: burn it and get a fresh challenge, whether or not the
    // request succeeded, so a retry is not doomed before it starts.
    resetCaptcha();
    setBusy(false);
    if (err) { setError(err.message); return; }
    setSent(true);
  }

  async function handleVerify(e) {
    e.preventDefault();
    setCodeErr('');
    const token = code.replace(/\D/g, '');   // tolerate spaces/dashes when pasting
    // Supabase's OTP length is CONFIGURABLE (Auth → Sign In/Up → OTP length) and
    // this project issues 8 digits, not the documented default of 6. Hard-coding
    // 6 here silently truncated the code and every verification failed. Accept
    // any plausible length instead of pinning it to one project's setting.
    if (token.length < 6) { setCodeErr('Enter the code from the email.'); return; }
    setVerify(true);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    });
    setVerify(false);
    // On success, onAuthStateChange fires and AuthGate swaps to the app —
    // nothing more to do here.
    if (err) setCodeErr(err.message);
  }

  // "Check your email" state — link first, code as the fallback that survives
  // link scanners.
  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <CheckCircle className="w-10 h-10 text-emerald-500" />
        <p className="font-semibold text-stone-800">Check your email</p>
        <p className="text-sm text-stone-500 max-w-xs">
          We sent a sign-in link to <strong>{email}</strong>. Click it to continue — no password needed.
        </p>

        <div className="w-full flex items-center gap-3 pt-1">
          <div className="flex-1 border-t border-stone-100" />
          <span className="text-xs text-stone-400">or enter the code</span>
          <div className="flex-1 border-t border-stone-100" />
        </div>

        <form onSubmit={handleVerify} className="w-full flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              // inputMode/pattern bring up the numeric keypad on a phone.
              // text-base (16px) stops iOS zooming the page on focus.
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              // 10, not 6: the OTP length is a project setting and this one
              // issues 8 digits. A tight maxLength truncates the pasted code
              // with no error shown, which is the worst kind of failure.
              maxLength={10}
              placeholder="12345678"
              value={code}
              onChange={e => setCode(e.target.value)}
              className="flex-1 rounded-xl border border-stone-200 bg-white px-4 py-3 text-base tracking-[0.3em] text-center text-stone-900 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={verifying}
              // shrink-0 + whitespace-nowrap: without them the flex row squeezes
              // this button until "Sign in" wraps onto two lines next to a
              // wide code field. The input is flex-1 and will give up the space.
              className="shrink-0 whitespace-nowrap rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 text-sm font-medium disabled:opacity-50 transition"
            >
              {verifying ? 'Checking…' : 'Sign in'}
            </button>
          </div>
          <ErrorMsg msg={codeError} />
          {/* This used to end "The code always works." It does not, and the
              project's own auth logs disproved it: /otp at 08:43:00, then a
              /verify AND a completed Login at 08:44:04 — a full minute before
              the email reached the inbox at 08:45. A scanner opened the link
              and spent the token. The link and the code are the SAME single-use
              token in Supabase, so burning one kills the other. Promising the
              code "always works" sent people to try the one thing that was
              already dead. */}
          <p className="text-xs text-stone-400 text-left">
            Work email? Company security scanners often open the link before you
            do, which uses up the code as well. If that happens, ask for a new
            one and enter the code as soon as it arrives.
          </p>
        </form>

        <button
          onClick={() => { setSent(false); setEmail(''); setCode(''); setCodeErr(''); }}
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
//
// NO CAPTCHA TOKEN HERE, DELIBERATELY. signInWithOAuth does not accept a
// captchaToken — its options are only redirectTo / scopes / queryParams /
// skipBrowserRedirect. That is not an oversight in supabase-js: this call does
// not post credentials to Supabase at all, it just builds a URL and sends the
// browser to Google, who does its own abuse checking. Adding a captchaToken
// here would be silently ignored. So this button takes no captcha props.
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
// The two captcha props come from useTurnstile() up in AuthScreen. Defaults are
// provided so this form still works if it is ever rendered on its own.
function EmailPasswordForm({ getCaptchaToken = () => undefined, resetCaptcha = () => {} }) {
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

  // ---- Sign-up confirmation-code state ----
  // Same problem the magic link has: a corporate mail scanner pre-fetches the
  // confirmation link and spends the single-use token before the user gets to
  // it. The same email carries a typed code, which a scanner cannot consume.
  //
  // signupSent: true once signUp succeeded AND confirmation is required.
  // ALL of these hooks live up here with the others, ABOVE every early return
  // (the first is the `if (resetSent)` block further down). A hook declared
  // below a return runs on some renders and not others, which changes the hook
  // order between renders and crashes React.
  const [signupSent, setSignupSent] = useState(false);
  const [code, setCode]             = useState('');
  const [codeErr, setCodeErr]       = useState('');
  const [verifying, setVerifying]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!email.trim() || !password) { setError('Please fill in email and password.'); return; }
    setBusy(true);
    // AWAIT — see useTurnstile. Reading this synchronously is what broke
    // password reset: the token is frequently not there yet at click time.
    const captchaToken = await getCaptchaToken();
    if (isSignUp) {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(), password, options: { captchaToken },
      });
      // Single-use token — burn it so a retry gets a fresh challenge.
      resetCaptcha();
      setBusy(false);
      if (err) { setError(err.message); return; }
      // DO NOT "SIMPLIFY" THIS AWAY — the two outcomes of signUp are different.
      //
      // If the Supabase project has email confirmation DISABLED, signUp returns
      // a LIVE SESSION and the user is already signed in. Showing them "enter
      // the code we emailed you" would be nonsense — no email was sent, no code
      // exists, and they would be stranded on a screen they can never complete.
      // In that case do nothing: onAuthStateChange fires and AuthGate swaps to
      // the app, exactly as this branch behaved before.
      //
      // Only when there is NO session is confirmation required — that is the
      // case where an email went out and the code screen is the right thing.
      if (data?.session) return;
      setSignupSent(true);
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(), password, options: { captchaToken },
      });
      // Single-use token — burn it. A mistyped password is the common case
      // here, and the retry must not fail on a spent captcha instead.
      resetCaptcha();
      setBusy(false);
      if (err) { setError(err.message); return; }
      // On success AuthProvider's onAuthStateChange fires and the gate swaps to the app.
    }
  }

  // handleVerifySignup: confirms a brand-new account with the code from the
  // confirmation email. Mirrors MagicLinkForm's handleVerify — the one thing
  // that differs is `type`.
  async function handleVerifySignup(e) {
    e.preventDefault();
    setCodeErr('');
    const token = code.replace(/\D/g, '');   // tolerate spaces/dashes when pasting
    // Supabase's OTP length is CONFIGURABLE (Auth → Sign In/Up → OTP length) and
    // this project issues 8 digits, not the documented default of 6. Hard-coding
    // 6 here silently truncated the code and every verification failed. Accept
    // any plausible length instead of pinning it to one project's setting.
    if (token.length < 6) { setCodeErr('Enter the code from the email.'); return; }
    setVerifying(true);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      // 'signup' — confirming a NEW account. NOT 'email', which is the sign-in
      // variant MagicLinkForm uses. The wrong type is rejected as invalid.
      type: 'signup',
    });
    setVerifying(false);
    // On success, onAuthStateChange fires and AuthGate swaps to the app —
    // nothing more to do here.
    if (err) setCodeErr(err.message);
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
    // AWAIT THE TOKEN BEFORE CALLING. This single line is the bug that broke
    // password reset in production: it used to read `getCaptchaToken()`
    // synchronously, and reset is ONE CLICK with no typing to cover the delay,
    // so it almost always fired before a token existed and Supabase rejected it
    // with "captcha protection: request disallowed (no captcha_token found)".
    const captchaToken = await getCaptchaToken();
    // NOTE THE SHAPE: resetPasswordForEmail takes (email, options) and
    // captchaToken sits DIRECTLY in that second argument — there is no nested
    // `options: {...}` here, unlike signInWithOtp / signInWithPassword / signUp
    // which take a single credentials object with an `options` key inside it.
    // Nesting it would put the token somewhere supabase-js never reads, and it
    // would fail silently until CAPTCHA protection is switched on.
    const { error: err } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: APP_URL,          // same base URL used by magic-link and Google
        captchaToken,
      }
    );
    // Single-use token — burn it so a second reset request still works.
    resetCaptcha();
    setResetBusy(false);
    if (err) { setError(err.message); return; }
    // Show the "check your email" confirmation state.
    setResetSent(true);
  }

  // ---- "Check your email" state for a new sign-up ----
  // Mirrors MagicLinkForm's sent state: link first, code as the fallback that
  // survives link scanners. Only reached when confirmation is REQUIRED — see
  // the comment in handleSubmit.
  if (signupSent) {
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
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <CheckCircle className="w-10 h-10 text-emerald-500" />
          <p className="font-semibold text-stone-800">Check your email</p>
          <p className="text-sm text-stone-500 max-w-xs">
            We sent a confirmation link to <strong>{email}</strong>. Click it to
            finish setting up your account.
          </p>

          <div className="w-full flex items-center gap-3 pt-1">
            <div className="flex-1 border-t border-stone-100" />
            <span className="text-xs text-stone-400">or enter the code</span>
            <div className="flex-1 border-t border-stone-100" />
          </div>

          <form onSubmit={handleVerifySignup} className="w-full flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                // inputMode/pattern bring up the numeric keypad on a phone.
                // text-base (16px) stops iOS zooming the page on focus.
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                // 10, not 6: the OTP length is a project setting and this one
                // issues 8 digits. A tight maxLength truncates the pasted code
                // with no error shown, which is the worst kind of failure.
                maxLength={10}
                placeholder="12345678"
                value={code}
                onChange={e => setCode(e.target.value)}
                className="flex-1 rounded-xl border border-stone-200 bg-white px-4 py-3 text-base tracking-[0.3em] text-center text-stone-900 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={verifying}
                // Same shrink-0 + whitespace-nowrap as the sign-in code button:
                // the code input is flex-1 and would otherwise squeeze this
                // until its label wraps onto two lines.
                className="shrink-0 whitespace-nowrap rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 text-sm font-medium disabled:opacity-50 transition"
              >
                {verifying ? 'Checking…' : 'Confirm'}
              </button>
            </div>
            <ErrorMsg msg={codeErr} />
            <p className="text-xs text-stone-400 text-left">
              The same email has a code. Use it if the link doesn&rsquo;t work —
              work inboxes often open the link for you, which uses it up.
            </p>
          </form>

          <button
            onClick={() => {
              setSignupSent(false); setEmail(''); setPassword('');
              setCode(''); setCodeErr(''); setError('');
            }}
            className="text-xs text-indigo-600 underline underline-offset-2 mt-1 hover:text-indigo-800 transition"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
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
          {/* "IF an account exists" is deliberate, and it is not hedging for its
              own sake. This screen is shown even when the address has no
              account, because saying "no account found" would turn the reset
              form into a way to discover who is registered — the first step of
              a credential-stuffing run. But the old copy stated flatly that we
              HAD sent a link, which is simply untrue in that case: someone who
              mistyped their address was told an email was on its way and then
              waited for something that could never arrive. This phrasing leaks
              nothing and is true either way. */}
          <p className="text-sm text-stone-500 max-w-xs">
            If an account exists for <strong>{email}</strong>, we&rsquo;ve sent it a
            password-reset link. Click it to set a new password.
          </p>
          {/* iOS cannot route a link from Mail into a home-screen web app, and
              the app and the browser keep SEPARATE storage — so finishing in
              Safari leaves the installed app still signed out, which reads as a
              broken reset. Say it before it happens. */}
          <p className="text-xs text-stone-400 max-w-xs">
            On iPhone the link opens in your browser, not the app. Set your
            password there, then return to the app and sign in.
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
  // ONE shared Turnstile widget for the whole screen. This call sits at the very
  // top of the component and AuthScreen has no early return above it, so the
  // hook order can never change between renders.
  const { containerRef, getCaptchaToken, resetCaptcha } = useTurnstile();

  return (
    <div
      className="relative overflow-hidden min-h-screen bg-[#FAFAF7] flex flex-col items-center justify-center px-4 py-12"
      style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* Soft decorative glow behind the hero — mid-tone indigo at low opacity,
          so it reads as a gentle accent in BOTH light and dark themes (no white band). */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-[460px] h-[460px] rounded-full bg-indigo-400/10 blur-3xl" />

      {/* All content sits above the glow.
          LAYOUT: the three selling points used to sit stacked ABOVE the form,
          pushing the sign-in below the fold on a phone. They are now BELOW the
          form at every width.
          A two-column version (hero beside the card on wide screens) was tried
          and reverted: it squeezed the tagline into a narrow ragged column with
          an oversized mark floating next to it. One centred column reads far
          better, and the form is still the first thing you land on. */}
      <div className="relative z-10 w-full flex flex-col items-center">

      {/* ── Hero / title area ── */}
      <div className="mb-7 text-center">
        {/* App mark — dark square with the indigo "S" monogram (matches the app icon) */}
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-stone-900 mb-3 shadow-md">
          <svg width="34" height="34" viewBox="0 0 100 100" aria-hidden="true">
            <path d="M72 34 C56 24 34 26 32 42 C30.5 54 48 56 55 59 C66 63 70 72 64 78 C56 88 36 86 27 76"
              fill="none" stroke="#818cf8" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* App name */}
        <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Splitab</h1>

        {/* Tagline — kept to a comfortable measure so it doesn't wrap raggedly. */}
        <p className="text-sm text-stone-500 mt-1.5 max-w-[22rem] mx-auto leading-relaxed">
          Split expenses with anyone — trips, rent, dinners, anything.
        </p>
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
          <MagicLinkForm getCaptchaToken={getCaptchaToken} resetCaptcha={resetCaptcha} />
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
        </section>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-stone-100" />
          <span className="text-xs text-stone-400">or</span>
          <div className="flex-1 border-t border-stone-100" />
        </div>

        {/* 3. Email + password (collapsible) */}
        <section>
          <EmailPasswordForm getCaptchaToken={getCaptchaToken} resetCaptcha={resetCaptcha} />
        </section>

        {/* ── The shared CAPTCHA ──
            ONE widget for the whole card. The magic-link form, the
            email+password form and "Forgot password?" all read their token from
            it; the Google button doesn't use one (see GoogleButton).
            It sits at the bottom because it belongs to all of them rather than
            to any single form.

            The div is deliberately EMPTY in the JSX: React owns the element,
            Turnstile owns what goes inside it. The id is what
            window.turnstile.render() is pointed at. If Turnstile never loads,
            this stays an empty div taking up no space and every form still
            submits — no token, no blocking. */}
        <div ref={containerRef} id="turnstile-container" className="flex justify-center empty:hidden" />

        {/* Features sit BELOW the form at every width, so the form is what you
            land on. */}
        <FeatureList className="flex pt-1" />
      </div>

      {/* Footer privacy line */}
      <p className="text-xs text-stone-400 mt-6 text-center max-w-xs mx-auto">
        Your data is protected by Row-Level Security. Only you and your accepted connections can see your expenses.
      </p>

      </div>
    </div>
  );
}
