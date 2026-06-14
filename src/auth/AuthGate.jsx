// AuthGate.jsx
// A wrapper component that sits between main.jsx and the rest of the app.
//
// Three states:
//   1. loading  — session check is in progress → show a spinner
//   2. no session — nobody is signed in → show <AuthScreen />
//   3. signed in — render children (the normal <App />) plus a top bar
//      with the user's name, a "Connections" button, and a sign-out button.
//
// The Connections screen is rendered as a full-page overlay so it doesn't
// require any routing library.

import { useState } from 'react';
import { LogOut, Users } from 'lucide-react';
import { useAuth } from './AuthProvider.jsx';
import AuthScreen from './AuthScreen.jsx';
import Connections from './Connections.jsx';

export default function AuthGate({ children }) {
  const { session, profile, user, loading, signOut } = useAuth();
  const [showConnections, setShowConnections] = useState(false);

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

  // ---- 2. Not signed in ----
  if (!session) {
    return <AuthScreen />;
  }

  // ---- 3. Signed in ----

  // Derive a friendly display name from the profile or fall back to the email.
  const displayName = profile?.display_name || user?.email || 'You';

  // If the Connections screen is open, render it as a full-page overlay.
  if (showConnections) {
    return <Connections onClose={() => setShowConnections(false)} />;
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7]">
      {/* Slim auth bar — sits above App's own sticky header */}
      <div className="bg-stone-900 text-white">
        <div className="max-w-3xl mx-auto px-4 py-1.5 flex items-center justify-between gap-3">
          {/* Left: signed-in-as label */}
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-5 h-5 rounded-full bg-stone-600 flex items-center justify-center text-[10px] font-semibold shrink-0">
              {displayName[0].toUpperCase()}
            </div>
            <span className="text-xs text-stone-300 truncate hidden sm:block">{displayName}</span>
          </div>

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

            <button
              onClick={signOut}
              className="flex items-center gap-1.5 text-xs text-stone-300 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-stone-700 transition"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </div>

      {/* The actual app — children is <App /> */}
      {children}
    </div>
  );
}
