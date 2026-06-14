import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthProvider.jsx';
import AuthGate from './auth/AuthGate.jsx';

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
