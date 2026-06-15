// AuthProvider.jsx
// This file manages the signed-in/signed-out state for the whole app.
// It checks if a user is already signed in when the page loads, then
// listens for sign-in / sign-out events from Supabase and updates
// automatically. It also loads the user's row from the `profiles` table.
//
// Other components get access to { session, user, profile, loading, signOut,
// refreshProfile, recoveryMode, endRecovery } by calling the useAuth() hook.

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
  // Columns used here: id, display_name, email, created_at — matching 01_schema.sql exactly.
  async function loadProfile(authUser) {
    if (!authUser) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')           // table name matches schema
      .select('id, display_name, email, created_at')
      .eq('id', authUser.id)      // column: id
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
    // 1. Check for an existing session immediately on mount.
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      loadProfile(s?.user ?? null).finally(() => setLoading(false));
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
        await loadProfile(s?.user ?? null);
        // Once we get any auth event, we're definitely no longer in the
        // initial loading state.
        setLoading(false);
      }
    );

    // 3. Clean up the subscription when this component unmounts.
    return () => subscription.unsubscribe();
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
