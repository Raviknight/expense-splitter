// AuthGate.jsx
// A wrapper component that sits between main.jsx and the rest of the app.
//
// Three states:
//   1. loading  — session check is in progress → show a spinner
//   2. no session — nobody is signed in → show <AuthScreen />
//   3. signed in — render children (the normal <App />) plus a top bar
//      with the user's avatar (→ Profile), a Connections button, and a gear
//      icon (→ Settings). Sign-out now lives inside the Settings screen.
//
// The Connections, Profile, and Settings screens are each rendered as a
// full-page overlay so we don't need any routing library.

import { useState } from 'react';
import { Users, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from './AuthProvider.jsx';
import AuthScreen from './AuthScreen.jsx';
import Connections from './Connections.jsx';
import Profile from './Profile.jsx';
import Settings from './Settings.jsx';
import ResetPassword from './ResetPassword.jsx';
import Avatar from '../ui/Avatar.jsx';

export default function AuthGate({ children }) {
  const { session, profile, user, loading, recoveryMode } = useAuth();
  const [showConnections, setShowConnections] = useState(false);
  // Profile overlay — opened by tapping the avatar. Same pattern as Connections.
  const [showProfile, setShowProfile] = useState(false);
  // Settings overlay — opened by the gear icon. Holds currency, appearance,
  // password, notifications (placeholder), and sign out.
  const [showSettings, setShowSettings] = useState(false);

  // ---- 1. Initial load ----
  if (loading) {
    return (
      <div
        className="min-h-screen bg-[#FAFAF7] flex items-center justify-center"
        style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
      >
        {/* Simple animated spinner made with Tailwind */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-stone-200 border-t-stone-600 animate-spin" />
          <p className="text-sm text-stone-400">Loading…</p>
        </div>
      </div>
    );
  }

  // ---- 2. Password-recovery mode ----
  // The user clicked a reset link in their email. Supabase fired the
  // PASSWORD_RECOVERY event, which set recoveryMode = true in AuthProvider.
  // Show the set-new-password screen regardless of whether a session exists.
  // (A temporary recovery session is always present at this point, but we
  // check recoveryMode rather than the session type so the branch is explicit.)
  if (recoveryMode) {
    return <ResetPassword />;
  }

  // ---- 3. Not signed in ----
  if (!session) {
    return <AuthScreen />;
  }

  // ---- 4. Signed in ----

  // Derive a friendly display name from the profile or fall back to the email.
  const displayName = profile?.display_name || user?.email || 'You';

  // If the Connections screen is open, render it as a full-page overlay.
  if (showConnections) {
    return <Connections onClose={() => setShowConnections(false)} />;
  }

  // If the Profile screen is open, render it as a full-page overlay.
  // Same window-less pattern — no router required.
  if (showProfile) {
    return <Profile onClose={() => setShowProfile(false)} />;
  }

  // If the Settings screen is open, render it as a full-page overlay too.
  if (showSettings) {
    return <Settings onClose={() => setShowSettings(false)} />;
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7]">
      {/* Slim auth bar — sits above App's own sticky header */}
      <div className="bg-stone-900 text-white">
        <div className="max-w-3xl mx-auto px-4 py-1.5 flex items-center justify-between gap-3">
          {/* Left: tap the avatar to open your Profile (photo, name, email).
              The name label next to it is part of the same button on wider
              screens. profile.avatar_url is undefined until db/08 is run →
              the Avatar shows initials in that case. */}
          <button
            onClick={() => setShowProfile(true)}
            className="flex items-center gap-1.5 min-w-0 rounded-lg px-1 py-0.5 hover:bg-stone-700 transition"
            title="Your profile"
            aria-label="Open your profile"
          >
            <Avatar name={displayName} url={profile?.avatar_url} size={20} />
            <span className="text-xs text-stone-300 truncate hidden sm:block">{displayName}</span>
          </button>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setShowConnections(true)}
              className="flex items-center gap-1.5 text-xs text-stone-300 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-stone-700 transition"
              title="Manage connections"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Connections</span>
            </button>

            {/* Gear icon — opens the Settings overlay (currency, appearance,
                password, notifications, sign out). */}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 text-xs text-stone-300 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-stone-700 transition"
              title="Settings"
              aria-label="Open settings"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>
      </div>

      {/* The actual app — children is <App /> */}
      {children}
    </div>
  );
}
