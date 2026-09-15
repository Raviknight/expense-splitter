// AuthProvider.jsx
// This file manages the signed-in/signed-out state for the whole app.
// It checks if a user is already signed in when the page loads, then
// listens for sign-in / sign-out events from Supabase and updates
// automatically. It also loads the user's row from the `profiles` table.
//
// Other components get access to { session, user, profile, loading, signOut,
// refreshProfile, recoveryMode, endRecovery } by calling the useAuth() hook.
//
// profile now contains ALL columns from the profiles table (via select('*')),
// including preferred_currency when that column has been added by db/04.

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient.js';

// The context object — starts empty; AuthProvider fills it in.
const AuthContext = createContext({});

// ── Last-known profile, cached locally ──────────────────────────────────────
// WHY this exists, because it is not merely a speed-up:
//   The offline snapshot in data/offline.js persists groups but NOT the
//   profile, so a cold start on a bad network left `profile` null. That is not
//   cosmetic. App.jsx derives `myName` from profile.display_name and falls back
//   to 'Me', which matches no member of any group — so every balance quietly
//   rendered as "Settled up" and the home screen announced "You're all settled
//   up across your groups". The app was at its most reassuring exactly when it
//   knew least. App.jsx now refuses to claim a balance it cannot compute, and
//   this cache is the other half: it means a flaky network degrades to a
//   slightly stale NAME rather than to unavailable MONEY.
// Only the profile row is stored, which the user already has locally in the
// groups snapshot; no tokens or secrets are written here.
const PROFILE_CACHE_KEY = (uid) => `splitab.profile.${uid}`;

function readCachedProfile(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY(uid));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;   // private mode, quota, or corrupt JSON — treat as no cache
  }
}

function writeCachedProfile(uid, p) {
  if (!uid) return;
  try {
    if (p) localStorage.setItem(PROFILE_CACHE_KEY(uid), JSON.stringify(p));
    else   localStorage.removeItem(PROFILE_CACHE_KEY(uid));
  } catch (_) {
    // Quota exceeded or private mode — silently skip, same as offline.js.
  }
}

export function AuthProvider({ children }) {
  // session      = Supabase auth session (contains tokens). null when signed out.
  // user         = Supabase auth user object (id, email, etc.)
  // profile      = The matching row from our `profiles` table (display_name, email, …)
  // loading      = true while we're still checking whether someone is signed in.
  // recoveryMode = true when the user arrived via a password-reset email link.
  //                While true, AuthGate shows the ResetPassword screen instead of
  //                the normal app, so the user can set their new password.
  const [session, setSession]           = useState(null);
  const [user, setUser]                 = useState(null);
  const [profile, setProfile]           = useState(null);
  const [loading, setLoading]           = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);

  // Fetch the profiles row for a given auth user id.
  //
  // WHY select('*') instead of a named column list:
  //   The schema gains new columns over time (e.g. preferred_currency added by
  //   db/04_add_currency.sql). An explicit list like
  //     .select('id, display_name, email, created_at')
  //   would throw a PostgREST error if preferred_currency exists in the DB but
  //   is listed, or would silently omit it if we forgot to add it here.
  //   select('*') always returns whatever columns exist, so:
  //     • sign-in never breaks due to schema drift
  //     • new columns (preferred_currency etc.) become available in profile
  //       automatically, with no code change needed here
  //   Existing consumers (profile.display_name, profile.email, profile.id,
  //   profile.created_at) keep working — we're only ADDING extra keys, never
  //   removing ones the rest of the app already uses.
  async function loadProfile(authUser) {
    if (!authUser) {
      setProfile(null);
      return;
    }
    // Show the last known profile immediately so the app can identify the user
    // (and therefore compute balances) before the network answers — or at all,
    // if it never does. Never clobber a fresher profile already in state.
    const cached = readCachedProfile(authUser.id);
    if (cached) setProfile((prev) => prev || cached);

    const { data, error } = await supabase
      .from('profiles')   // table name matches 01_schema.sql
      .select('*')        // select all columns — resilient to new columns being added
      .eq('id', authUser.id)
      .single();

    if (error) {
      console.warn('[AuthProvider] Could not load profile:', error.message);
      // Distinguish "this user genuinely has no profile row" from "we could not
      // reach the server". PGRST116 is PostgREST's zero-rows-from-.single(),
      // i.e. a real answer: the row is absent (the signup trigger may not have
      // fired yet), so null is correct and the cache must be cleared.
      // Everything else is a transport failure, and this used to setProfile(null)
      // regardless — throwing away a perfectly good profile because of a
      // momentary network blip, which is what turned an iPhone resume into
      // "all settled up". On those, keep what we have.
      if (error.code === 'PGRST116') {
        setProfile(null);
        writeCachedProfile(authUser.id, null);
      } else {
        setProfile((prev) => prev || cached || null);
      }
    } else {
      setProfile(data);
      writeCachedProfile(authUser.id, data);
    }
  }

  useEffect(() => {
    // Guard against setting state after unmount.
    let cancelled = false;

    // WATCHDOG — why this exists:
    //   AuthGate renders nothing but a spinner while `loading` is true, so if
    //   anything below stalls, the app is stuck until the user force-quits it.
    //   That is exactly what happens on iOS: a backgrounded home-screen PWA has
    //   its web view purged, so reopening is a FRESH page load on a network
    //   stack that is still waking up. getSession() or the profiles query can
    //   then hang indefinitely and the spinner never clears.
    //
    //   store.js has its own 12s watchdog, but it cannot help here — <App/> is
    //   never rendered while AuthGate is still showing the spinner.
    //
    //   So: whatever happens, clear `loading` after 8s. Worst case the user
    //   lands on the sign-in screen and taps once; that beats a dead app.
    const watchdog = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 8000);

    // 1. Check for an existing session immediately on mount.
    supabase.auth.getSession()
      .then(({ data: { session: s } }) => {
        if (cancelled) return;
        setSession(s);
        setUser(s?.user ?? null);
        // Deliberately NOT awaited before clearing `loading`. The profile is
        // optional — AuthGate already falls back to the email for the display
        // name — so a slow profiles query must never hold the whole app behind
        // the spinner. It fills in a moment later when it arrives.
        loadProfile(s?.user ?? null);
      })
      .catch((e) => {
        // Previously there was no .catch() here: a REJECTED getSession() became
        // an unhandled rejection and `loading` stayed true forever.
        console.warn('[AuthProvider] getSession failed:', e?.message ?? e);
      })
      .finally(() => {
        if (cancelled) return;
        clearTimeout(watchdog);
        setLoading(false);
      });

    // 2. Subscribe to future sign-in / sign-out events.
    // ⚠️ THIS CALLBACK MUST NOT BE async, AND MUST NOT AWAIT A SUPABASE CALL.
    //
    // auth-js runs this handler WHILE HOLDING its internal auth lock, and it
    // awaits whatever the handler returns. Every Supabase query begins with
    // SupabaseClient._getAccessToken() -> auth.getSession(), which needs that
    // same lock. So an async handler that awaits a query deadlocks:
    //
    //     handler waits for the query
    //       -> query waits for the lock
    //         -> lock waits for the handler
    //
    // and nothing in the app can ever reach the database again.
    //
    // This is not theoretical. It is what produced the "Showing saved data"
    // banner that would not clear, on desktop and iPhone alike. The evidence
    // that finally identified it, from the owner's DevTools: the token refresh
    // returned 200, the realtime websocket connected — and there were ZERO
    // /rest/v1/ requests. Not slow ones, not failing ones. None. The queries
    // were never issued, because every one of them was queued behind a lock
    // held by this handler, which was waiting on a query of its own.
    //
    // It also explains why three earlier fixes did nothing: better retries,
    // longer backoff and a fetch timeout are all useless when the request never
    // reaches the network layer at all.
    //
    // So the handler is now SYNCHRONOUS and hands the profile load to a
    // separate task. It returns immediately, the lock is released, queries flow.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        // PASSWORD_RECOVERY fires when the user clicks their reset-link email.
        // Supabase exchanges the one-time token for a temporary session and
        // tells us about it here — BEFORE any normal SIGNED_IN event.
        // We flip recoveryMode on so AuthGate shows the set-new-password screen.
        //
        // IMPORTANT: a normal sign-in fires SIGNED_IN (not PASSWORD_RECOVERY),
        // so recoveryMode is only ever set by this one specific event. That
        // prevents everyday logins from accidentally entering recovery mode.
        if (event === 'PASSWORD_RECOVERY') {
          setRecoveryMode(true);
        }

        setSession(s);
        setUser(s?.user ?? null);
        // Clear `loading` BEFORE the profile fetch, not after. This used to be
        // `await loadProfile(...)` followed by setLoading(false) — so a stalled
        // profiles query left the spinner up permanently. The profile is
        // optional to render the app, so it must never gate the spinner.
        setLoading(false);
        clearTimeout(watchdog);

        // DEFERRED, not awaited — see the block above. setTimeout(…, 0) pushes
        // the profile load into a later task, so this handler returns straight
        // away and auth-js releases its lock. By the time loadProfile runs and
        // asks for a session, the lock is free and the query goes out normally.
        //
        // Do not "tidy" this back into `await loadProfile(...)`. It reads like
        // a pointless indirection and it is the difference between an app that
        // loads and one that silently never queries the database again.
        setTimeout(() => {
          loadProfile(s?.user ?? null).catch((e) => {
            console.warn('[AuthProvider] deferred profile load failed:', e?.message ?? e);
          });
        }, 0);
      }
    );

    // 3. Clean up on unmount: stop the watchdog and the subscription.
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      subscription.unsubscribe();
    };
  }, []);

  // RETRY a missing profile. loadProfile was previously called from exactly two
  // places — mount and an auth event — with no retry and no timeout, so one
  // failed fetch meant the profile stayed null for the entire life of the page.
  // store.js has its own resume listener for group data; the profile had none,
  // which is why an iPhone reopened after hours showed "Hi there" indefinitely.
  //
  // Only fires when we are signed in but have no profile, so a healthy session
  // costs nothing. Deliberately mirrors store.js's triggers.
  useEffect(() => {
    if (!user || profile) return;

    let cancelled = false;
    const attempt = () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') return;
      if (!navigator.onLine) return;   // the 'online' listener below covers this
      loadProfile(user);
    };

    // One prompt retry for the common case (first load lost a waking radio),
    // then lean on the listeners rather than polling.
    const t = setTimeout(attempt, 3000);
    document.addEventListener('visibilitychange', attempt);
    window.addEventListener('online', attempt);
    return () => {
      cancelled = true;
      clearTimeout(t);
      document.removeEventListener('visibilitychange', attempt);
      window.removeEventListener('online', attempt);
    };
  }, [user, profile]);

  // signOut: called by the sign-out button in the UI.
  async function signOut() {
    // Drop the cached profile first. Signing out should not leave the user's
    // name sitting in localStorage on a shared or borrowed device, and doing it
    // before the await means it happens even if signOut() itself fails.
    if (user?.id) writeCachedProfile(user.id, null);
    await supabase.auth.signOut();
    // onAuthStateChange fires automatically and clears session/user/profile.
    // Also make sure recovery mode is cleared on explicit sign-out.
    setRecoveryMode(false);
  }

  // endRecovery: called by ResetPassword after a successful password update.
  // Clears the recovery flag so AuthGate goes back to the normal signed-in view.
  // The user is already signed in at this point (Supabase keeps the session).
  function endRecovery() {
    setRecoveryMode(false);
  }

  // refreshProfile: re-runs the same SELECT that loadProfile uses and updates
  // the profile state. Call this after the user saves their display name so
  // the rest of the app (top bar, store.js) picks up the new value immediately.
  // It is a no-op when there is no signed-in user.
  async function refreshProfile() {
    // `user` from state may be stale inside a closure; read the live session instead.
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    await loadProfile(currentSession?.user ?? null);
  }

  // NOTE: recoveryMode and endRecovery are added here; all existing consumers
  // of useAuth() that destructure only { session, user, profile, loading,
  // signOut, refreshProfile } are unaffected — adding keys is non-breaking.
  const value = { session, user, profile, loading, signOut, refreshProfile, recoveryMode, endRecovery };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Convenience hook — any component can call useAuth() to read the context.
export function useAuth() {
  return useContext(AuthContext);
}
