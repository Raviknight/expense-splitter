import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthProvider.jsx';
import AuthGate from './auth/AuthGate.jsx';

// --- TEMPORARY storage bridge ---------------------------------------------
// The current UI saves through window.storage. Until the sync-engine step
// replaces this with Supabase, provide a small in-memory stand-in so the app
// runs during early steps. Data here resets on reload — that's expected.
// sync-engine will remove window.storage usage entirely.
if (!window.storage) {
  const mem = {};
  window.storage = {
    get: async (k) => (k in mem ? mem[k] : null),
    set: async (k, v) => { mem[k] = v; },
  };
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
