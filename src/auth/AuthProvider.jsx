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
    const { data, error } = await supabase
      .from('profiles')   // table name matches 01_schema.sql
      .select('*')        // select all columns — resilient to new columns being added
      .eq('id', authUser.id)
      .single();

    if (error) {
      // Profile might not exist yet (edge case: trigger hasn't fired yet).
      // Log and continue — the UI can still work with the auth user alone.
      console.warn('[AuthProvider] Could not load profile:', error.message);
      setProfile(null);
    } else {
      setProfile(data);
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
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
        await loadProfile(s?.user ?? null);
      }
    );

    // 3. Clean up on unmount: stop the watchdog and the subscription.
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      subscription.unsubscribe();
    };
  }, []);

  // signOut: called by the sign-out button in the UI.
  async function signOut() {
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
