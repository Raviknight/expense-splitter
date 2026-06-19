import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthProvider.jsx';
import AuthGate from './auth/AuthGate.jsx';

// ── Capture an invite token BEFORE anything else ────────────────────────────
// An invite email links to https://splitab.app/?invite=<token>. When the
// person clicks it they may need to sign in first, and the magic-link redirect
// that follows DROPS the query string. So we grab the token the moment the page
// loads and stash it in localStorage, where it survives the redirect. Later,
// once the user is signed in, App reads it back and calls accept_invite.
// We also scrub it from the visible address bar so it isn't shared/bookmarked.
try {
  const inviteToken = new URLSearchParams(window.location.search).get('invite');
  if (inviteToken) {
    localStorage.setItem('slitab.pendingInvite', inviteToken);
    // Remove ?invite=... from the URL without reloading the page.
    history.replaceState({}, '', window.location.pathname);
  }
} catch (e) {
  // Reading localStorage / URL can throw in rare locked-down browsers.
  // Failing here must never block the app from loading, so we ignore it.
}

// AuthProvider manages the session state for the whole app.
// AuthGate shows the login screen when nobody is signed in,
// and renders <App /> (plus the slim auth bar) when signed in.
createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <AuthGate>
      <App />
    </AuthGate>
  </AuthProvider>
);
