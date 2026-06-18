// Connections.jsx
// The "friends" / handshake screen.
//
// What this screen lets you do:
//   1. Send a connection request to another user by their email address.
//      - Looks up their profile in the `profiles` table by email.
//      - Inserts a row into `connections` with status='pending'.
//      - Shows a friendly message if no account with that email exists yet.
//   2. See incoming pending requests (where you are the addressee) and
//      Accept or Decline them (updates the `status` column).
//   3. See outgoing requests (where you are the requester) and their status.
//   4. See your current accepted connections.
//
// Table: connections  — columns: id, requester, addressee, status, created_at
// Table: profiles     — columns: id, display_name, email

import { useState } from 'react';
import { UserPlus, Check, X, Clock, Users, Mail, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../supabaseClient.js';
import { useAuth } from './AuthProvider.jsx';
import { useConnections } from './useConnections.js';
import Avatar from '../ui/Avatar.jsx';

// ---- Small shared UI pieces ----

function SectionHeader({ icon: Icon, title, count }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-stone-500" />
      <span className="text-sm font-semibold text-stone-700">{title}</span>
      {count != null && (
        <span className="ml-auto text-xs bg-stone-100 text-stone-500 rounded-full px-2 py-0.5">
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyState({ text }) {
  return <p className="text-sm text-stone-400 py-2">{text}</p>;
}

// Status pill shown next to outgoing requests
const STATUS_STYLE = {
  pending:  'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  declined: 'bg-rose-50 text-rose-600 border-rose-200',
};
function StatusPill({ status }) {
  return (
    <span className={`text-[10px] uppercase tracking-widest font-semibold border rounded px-1.5 py-0.5 ${STATUS_STYLE[status] || STATUS_STYLE.pending}`}>
      {status}
    </span>
  );
}

// ---- Send request form ----
function SendRequestForm({ onSent, currentUserId }) {
  const [email, setEmail]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [message, setMessage] = useState(null); // { text, type: 'success'|'error'|'warn' }

  const MSG_STYLE = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    error:   'bg-rose-50 border-rose-200 text-rose-600',
    warn:    'bg-amber-50 border-amber-200 text-amber-700',
  };

  async function handleSend(e) {
    e.preventDefault();
    setMessage(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setMessage({ text: 'Please enter an email address.', type: 'error' }); return; }
    if (trimmed === /* the current user's email — compare by checking profile later */ '') return;
    setBusy(true);

    // Step 1: look up the addressee by email.
    // We call the find_profile_by_email database function (db/03_find_profile_by_email.sql)
    // instead of querying the profiles table directly. The privacy rules hide
    // profiles of people you're not yet connected to, so a direct query would
    // never find a brand-new friend. The function does this one narrow lookup
    // safely and returns id, display_name, email.
    const { data: profiles, error: lookupErr } = await supabase
      .rpc('find_profile_by_email', { lookup_email: trimmed });

    if (lookupErr) {
      setMessage({ text: 'Something went wrong looking up that email. Try again.', type: 'error' });
      setBusy(false);
      return;
    }

    if (!profiles || profiles.length === 0) {
      // The lookup function checks every account, so an empty result genuinely
      // means nobody has signed up with that email yet.
      setMessage({
        text: `No account found for "${trimmed}". Ask them to sign up first, then try again.`,
        type: 'warn',
      });
      setBusy(false);
      return;
    }

    const addressee = profiles[0];

    if (addressee.id === currentUserId) {
      setMessage({ text: "That's your own email address.", type: 'error' });
      setBusy(false);
      return;
    }

    // Step 2: Insert the connection row.
    // Columns match 01_schema.sql: requester, addressee, status
    const { error: insertErr } = await supabase
      .from('connections')         // table: connections
      .insert({
        requester: currentUserId,  // column: requester (uuid)
        addressee: addressee.id,   // column: addressee (uuid)
        status: 'pending',         // column: status
      });

    setBusy(false);

    if (insertErr) {
      // Unique constraint fires if a request already exists between these two.
      if (insertErr.code === '23505') {
        setMessage({ text: 'A connection request between you two already exists.', type: 'warn' });
      } else {
        setMessage({ text: insertErr.message, type: 'error' });
      }
      return;
    }

    setMessage({ text: `Request sent to ${addressee.display_name || addressee.email}!`, type: 'success' });
    setEmail('');
    onSent(); // re-fetch the connections list
  }

  return (
    <form onSubmit={handleSend} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="email"
          placeholder="friend@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="flex-1 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 placeholder-stone-400"
        />
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 rounded-xl bg-stone-900 text-white px-4 py-2.5 text-sm font-medium hover:bg-stone-700 disabled:opacity-50 transition whitespace-nowrap"
        >
          <UserPlus className="w-4 h-4" />
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {message && (
        <p className={`text-sm border rounded-lg px-3 py-2 ${MSG_STYLE[message.type]}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}

// ---- Incoming requests ----
function IncomingList({ incoming, onAction }) {
  const [busy, setBusy] = useState(null); // connection id currently being actioned

  async function respond(connectionId, newStatus) {
    setBusy(connectionId);
    // Update the `status` column. RLS policy "respond to connection" allows
    // this only when addressee = auth.uid(), which matches our case.
    const { error } = await supabase
      .from('connections')              // table: connections
      .update({ status: newStatus })    // column: status
      .eq('id', connectionId);          // column: id

    setBusy(null);
    if (!error) onAction();
    else console.error('[Connections] respond error:', error.message);
  }

  if (incoming.length === 0) return <EmptyState text="No pending requests." />;

  return (
    <ul className="flex flex-col gap-2">
      {incoming.map(c => {
        const sender = c.requester_profile;
        return (
          <li key={c.id} className="flex items-center justify-between gap-3 bg-white border border-stone-200 rounded-xl px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-800 truncate">
                {sender?.display_name || sender?.email || 'Unknown user'}
              </p>
              <p className="text-xs text-stone-400 truncate">{sender?.email}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                disabled={busy === c.id}
                onClick={() => respond(c.id, 'accepted')}
                className="flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 text-xs font-medium hover:bg-emerald-100 disabled:opacity-50 transition"
              >
                <Check className="w-3.5 h-3.5" /> Accept
              </button>
              <button
                disabled={busy === c.id}
                onClick={() => respond(c.id, 'declined')}
                className="flex items-center gap-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 px-3 py-1.5 text-xs font-medium hover:bg-rose-100 disabled:opacity-50 transition"
              >
                <X className="w-3.5 h-3.5" /> Decline
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Outgoing requests ----
function OutgoingList({ outgoing, currentUserId }) {
  const [expanded, setExpanded] = useState(false);
  // Show only non-accepted by default to keep it tidy; let user expand to see all.
  const pending  = outgoing.filter(c => c.status === 'pending');
  const others   = outgoing.filter(c => c.status !== 'pending');

  function PersonRow({ c }) {
    const other = c.requester === currentUserId ? c.addressee_profile : c.requester_profile;
    return (
      <li className="flex items-center justify-between gap-3 bg-white border border-stone-200 rounded-xl px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-800 truncate">
            {other?.display_name || other?.email || 'Unknown user'}
          </p>
          <p className="text-xs text-stone-400 truncate">{other?.email}</p>
        </div>
        <StatusPill status={c.status} />
      </li>
    );
  }

  if (outgoing.length === 0) return <EmptyState text="No outgoing requests." />;

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {pending.map(c => <PersonRow key={c.id} c={c} />)}
      </ul>

      {others.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 transition self-start"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Hide' : `Show ${others.length} more`}
          </button>
          {expanded && (
            <ul className="flex flex-col gap-2">
              {others.map(c => <PersonRow key={c.id} c={c} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ---- Accepted connections ----
function AcceptedList({ accepted, currentUserId }) {
  if (accepted.length === 0) return <EmptyState text="No connections yet. Send a request above." />;

  return (
    <ul className="flex flex-col gap-2">
      {accepted.map(c => {
        // Show the OTHER person's details (not me).
        const other = c.requester === currentUserId ? c.addressee_profile : c.requester_profile;
        return (
          <li key={c.id} className="flex items-center gap-3 bg-white border border-stone-200 rounded-xl px-4 py-3">
            {/* Photo when set (avatar_url comes from useConnections), else initials. */}
            <Avatar
              name={other?.display_name || other?.email}
              url={other?.avatar_url}
              size={32}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-800 truncate">
                {other?.display_name || other?.email || 'Unknown user'}
              </p>
              <p className="text-xs text-stone-400 truncate">{other?.email}</p>
            </div>
            <StatusPill status="accepted" />
          </li>
        );
      })}
    </ul>
  );
}

// ---- Main screen ----
export default function Connections({ onClose }) {
  const { user } = useAuth();
  const { incoming, outgoing, accepted, loading, error, refetch } = useConnections();

  if (!user) return null;

  return (
    <div
      className="min-h-screen bg-[#FAFAF7] text-stone-900"
      style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#FAFAF7]/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-3 flex items-center gap-3">
          {onClose && (
            <button onClick={onClose} className="text-stone-500 hover:text-stone-800 transition">
              <X className="w-5 h-5" />
            </button>
          )}
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500 font-medium flex items-center gap-1">
              <Users className="w-3 h-3" /> Connections
            </p>
            <h1 className="text-xl font-semibold">Friends &amp; Requests</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-32 flex flex-col gap-8">
        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {loading && (
          <p className="text-sm text-stone-400 text-center py-8">Loading connections…</p>
        )}

        {/* Send a request */}
        {!loading && (
          <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
            <SectionHeader icon={Mail} title="Add a connection" />
            <p className="text-xs text-stone-500 mb-3">
              Enter your friend's email address. They must already have an account.
            </p>
            <SendRequestForm onSent={refetch} currentUserId={user.id} />
          </section>
        )}

        {/* Incoming requests */}
        {!loading && incoming.length > 0 && (
          <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
            <SectionHeader icon={UserPlus} title="Incoming requests" count={incoming.length} />
            <IncomingList incoming={incoming} onAction={refetch} />
          </section>
        )}

        {/* Outgoing requests */}
        {!loading && outgoing.length > 0 && (
          <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
            <SectionHeader icon={Clock} title="Sent requests" count={outgoing.length} />
            <OutgoingList outgoing={outgoing} currentUserId={user.id} />
          </section>
        )}

        {/* Accepted connections */}
        {!loading && (
          <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
            <SectionHeader icon={Users} title="My connections" count={accepted.length} />
            <AcceptedList accepted={accepted} currentUserId={user.id} />
          </section>
        )}
      </main>
    </div>
  );
}
