// useConnections.js
// A React hook that loads all connections for the currently signed-in user
// and exposes helper functions the rest of the app can use.
//
// Key export used by the group UI:
//   canAddAsRealMember(userId) → true if there is an 'accepted' connection
//   between the current user and userId. The DB also enforces this via RLS,
//   but the UI should check first so it can disable the button proactively.
//
// Table used: `connections`
// Columns:    id, requester, addressee, status, created_at  (matches 01_schema.sql)

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient.js';
import { useAuth } from './AuthProvider.jsx';

export function useConnections() {
  const { user } = useAuth();

  // All connections rows where I am either requester or addressee.
  const [connections, setConnections] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  // Fetch (or re-fetch) all my connections from Supabase.
  const fetchConnections = useCallback(async () => {
    if (!user) { setConnections([]); setLoading(false); return; }
    setLoading(true);
    // We fetch the two joined profiles in separate queries to avoid relying on
    // auto-generated FK constraint names (which differ between Supabase projects).
    const { data: rows, error: err } = await supabase
      .from('connections')   // table: connections
      .select('id, requester, addressee, status, created_at')
      .or(`requester.eq.${user.id},addressee.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (err) { setLoading(false); setError(err.message); return; }
    if (!rows || rows.length === 0) { setConnections([]); setLoading(false); return; }

    // Collect all distinct profile ids we need to show names for.
    const profileIds = [...new Set(rows.flatMap(r => [r.requester, r.addressee]))];
    const { data: profileRows, error: profileErr } = await supabase
      .from('profiles')      // table: profiles
      .select('id, display_name, email')
      .in('id', profileIds);

    if (profileErr) { setLoading(false); setError(profileErr.message); return; }

    // Build a quick id→profile lookup.
    const byId = Object.fromEntries((profileRows || []).map(p => [p.id, p]));

    // Attach the profile objects so the UI can read display_name and email.
    const data = rows.map(r => ({
      ...r,
      requester_profile: byId[r.requester] || null,
      addressee_profile: byId[r.addressee] || null,
    }));

    setLoading(false);
    setConnections(data);
    setError(null);
  }, [user]);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  // ---- Derived views ----

  // Requests I received that are still pending — I need to act on these.
  const incoming = connections.filter(
    c => c.addressee === user?.id && c.status === 'pending'
  );

  // Requests I sent — shows the other person what I'm waiting on.
  const outgoing = connections.filter(
    c => c.requester === user?.id
  );

  // Accepted connections — these are my "friends" in the app.
  const accepted = connections.filter(c => c.status === 'accepted');

  // ---- Privacy helper ----
  // Returns true only if there is a row with status='accepted' linking
  // the current user and the given userId (in either direction).
  function canAddAsRealMember(userId) {
    if (!user || !userId) return false;
    return accepted.some(
      c =>
        (c.requester === user.id && c.addressee === userId) ||
        (c.addressee === user.id && c.requester === userId)
    );
  }

  return {
    connections,
    incoming,
    outgoing,
    accepted,
    loading,
    error,
    refetch: fetchConnections,
    canAddAsRealMember,
  };
}
