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

import { useState, useEffect, useRef } from 'react';
import { Users, Settings as SettingsIcon, User as UserIcon, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from './AuthProvider.jsx';
import AuthScreen from './AuthScreen.jsx';
import Connections from './Connections.jsx';
import Profile from './Profile.jsx';
import Settings from './Settings.jsx';
import ResetPassword from './ResetPassword.jsx';
import Avatar from '../ui/Avatar.jsx';

// One row of the account menu. `hint` is the second line that says what the
// item actually does — the old three-icon bar gave no clue which icon led where.
//
// min-h-[44px] is the minimum comfortable tap target on a phone. Rows with a
// hint clear it from their two lines of text, but "Sign out" has no hint and
// measured 38px without it. Written as an arbitrary value, not `min-h-11` —
// that scale step isn't in the Tailwind version the Play CDN serves, so it
// silently did nothing.
function MenuItem({ icon: Icon, label, hint, onClick, danger }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-3.5 py-2.5 min-h-[44px] text-left transition hover:bg-stone-50 ${
        danger ? 'text-red-700' : 'text-stone-800'
      }`}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${danger ? 'text-red-600' : 'text-stone-500'}`} />
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{label}</span>
        {hint && <span className="block text-[11px] text-stone-500 mt-0.5 leading-tight">{hint}</span>}
      </span>
    </button>
  );
}

export default function AuthGate({ children }) {
  const { session, profile, user, loading, recoveryMode, signOut } = useAuth();
  const [showConnections, setShowConnections] = useState(false);
  // Profile overlay — opened from the account menu.
  const [showProfile, setShowProfile] = useState(false);
  // Settings overlay — currency, appearance, password, notifications, sign out.
  const [showSettings, setShowSettings] = useState(false);

  // ── Account menu ──────────────────────────────────────────────────────────
  // There used to be THREE separate top-bar controls (avatar → Profile, people
  // icon → Connections, gear → Settings). Three entry points for "things about
  // me" is a lot of chrome on a phone, and which icon led where wasn't obvious.
  // They're now one avatar button that opens a menu.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close on outside click / Escape. Without this a tap elsewhere leaves the
  // menu hanging open over the app, which on a phone looks like a stuck UI.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // Every menu item closes the menu first, so the overlay opens onto a clean screen.
  const pick = (fn) => () => { setMenuOpen(false); fn(); };

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

  // First name only for the greeting — a full name or an email address would
  // push the centred wordmark around on a narrow screen.
  const firstName = profile?.display_name
    ? String(profile.display_name).split(' ')[0]
    : 'there';

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
      {/* Slim auth bar — sticky so Profile/Settings/Connections stay reachable
          while scrolling. Fixed height (h-11) so the page headers below can
          offset by exactly that much (they use `sticky top-11`). */}
      <div className="sticky top-0 z-30 bg-stone-900 text-white h-11">
        {/* Three columns so the wordmark sits TRUE centre regardless of how long
            the greeting or the avatar block is. A flex row with justify-between
            would drift off-centre as those change width; equal-basis outer
            columns keep the middle fixed. */}
        <div className="max-w-3xl mx-auto px-4 h-full flex items-center gap-3">
          {/* Left: greeting. Moved up from the dashboard header so the page
              below starts with content instead of chrome. */}
          <div className="flex-1 min-w-0">
            <span className="text-sm text-stone-300 truncate block">
              Hi {firstName}
            </span>
          </div>

          {/* Centre: wordmark. */}
          <span className="text-sm font-semibold tracking-tight text-stone-100 select-none shrink-0">
            Splitab
          </span>

          {/* Right: one control for everything about "me". */}
          <div className="flex-1 flex justify-end min-w-0">
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-stone-700 transition"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              title="Account"
            >
              {/* profile.avatar_url is undefined until db/08 is run → initials. */}
              <Avatar name={displayName} url={profile?.avatar_url} size={22} />
              {/* The name is no longer repeated here — the greeting on the left
                  already says who you are, and two copies crowded the bar. */}
              <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-60 rounded-xl bg-white text-stone-800 shadow-lg ring-1 ring-black/10 overflow-hidden z-40"
              >
                {/* Who you're signed in as — the email was previously only
                    discoverable by opening Profile. */}
                <div className="px-3.5 py-3 border-b border-stone-100">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={displayName} url={profile?.avatar_url} size={32} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{profile?.display_name || 'You'}</div>
                      <div className="text-xs text-stone-500 truncate">{user?.email}</div>
                    </div>
                  </div>
                </div>

                <div className="py-1">
                  <MenuItem icon={UserIcon}      label="Profile"     hint="Name, photo, email" onClick={pick(() => setShowProfile(true))} />
                  <MenuItem icon={Users}         label="Connections" hint="Friends and requests" onClick={pick(() => setShowConnections(true))} />
                  <MenuItem icon={SettingsIcon}  label="Settings"    hint="Currency, password, appearance" onClick={pick(() => setShowSettings(true))} />
                </div>

                {/* Sign out is also inside Settings; surfacing it here saves a
                    two-step dig for the one action people look for by name. */}
                <div className="py-1 border-t border-stone-100">
                  <MenuItem icon={LogOut} label="Sign out" danger onClick={pick(() => signOut())} />
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* The actual app — children is <App /> */}
      {children}
    </div>
  );
}
