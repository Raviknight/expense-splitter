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

import { useState, useEffect, useCallback } from 'react';
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

// How long after a decline before the same person may be asked again.
// A decline is not permanent — people change their minds, and addresses get
// mistyped — but it must not become a way to pester someone. Enforced in the
// app for now; if that is ever abused it belongs in a database policy, which is
// the only place it cannot be bypassed.
const DECLINE_COOLOFF_HOURS = 24;

// ---- Send request form ----
// ONE input and ONE button. The app decides whether that address becomes an
// in-app connection request or an emailed invite — see
// docs-internal/invite-state-machine.md. Previously these were two separate
// features both called "invite", and choosing the wrong one failed silently.
function SendRequestForm({ onSent, currentUserId, inviterName }) {
  // Calls send-invite directly rather than going through the expense store.
  // A connection invite has no group and no ghost member — it is purely
  // "person invites person" — so routing it through the group-scoped
  // inviteGhostByEmail action would mean inventing arguments it does not have.
  // send-invite already treats groupId / ghostMemberId as optional.
  async function sendEmailInvite(toEmail) {
    try {
      const { error } = await supabase.functions.invoke('send-invite', {
        body: { email: toEmail, inviterName: inviterName || 'A friend' },
      });
      if (error) {
        // The real reason lives in the function's JSON body, not in the generic
        // "non-2xx status code" message supabase-js reports.
        let detail = error.message || String(error);
        try {
          if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.json();
            if (body?.error) detail = body.error;
          }
        } catch (_) { /* not JSON — keep the original */ }
        return { ok: false, message: detail };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, message: "Couldn't send the invite — the invite email function may not be set up yet." };
    }
  }

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
      // The lookup uses the find_profile_by_email() database function (db/03).
      // If that script hasn't been run, the function is missing and the call
      // fails — surface a clear instruction instead of a vague "try again".
      const m = (lookupErr.message || '').toLowerCase();
      const missingFn =
        lookupErr.code === 'PGRST202' ||              // PostgREST: function not found
        m.includes('find_profile_by_email') ||
        m.includes('schema cache') ||
        m.includes('function') ||
        m.includes('not found');
      setMessage({
        text: missingFn
          ? 'Connection lookup needs a one-time setup — run db/03_find_profile_by_email.sql in Supabase.'
          : ('Lookup failed: ' + (lookupErr.message || 'please try again.')),
        type: 'error',
      });
      setBusy(false);
      return;
    }

    // ── ROUTING ────────────────────────────────────────────────────────────
    // No account for this address → send an EMAIL INVITE instead of failing.
    // This used to dead-end with "ask them to sign up first", which is exactly
    // backwards: inviting someone who isn't here yet is the whole point, and the
    // email invite lived on a different screen entirely, so nobody found it.
    if (!profiles || profiles.length === 0) {
      const res = await sendEmailInvite(trimmed);
      setBusy(false);
      if (res?.ok) {
        setMessage({ text: `No account yet — we emailed an invite to ${trimmed}.`, type: 'success' });
        setEmail('');
        onSent();
      } else {
        setMessage({ text: res?.message || 'Could not send the invite.', type: 'error' });
      }
      return;
    }

    const addressee = profiles[0];

    if (addressee.id === currentUserId) {
      setMessage({ text: "That's your own email address.", type: 'error' });
      setBusy(false);
      return;
    }

    // They DO have an account → in-app request, no email. Mailing existing users
    // is noise, and needless mail is what damages a sending domain's reputation.
    const insertRow = async () => supabase
      .from('connections')         // table: connections
      .insert({
        requester: currentUserId,  // column: requester (uuid)
        addressee: addressee.id,   // column: addressee (uuid)
        status: 'pending',         // column: status
      });

    let { error: insertErr } = await insertRow();

    // 23505 = the unique(requester, addressee) constraint. A row already exists
    // between these two — which previously ended here with "already exists",
    // permanently. That is the reported bug: once declined, you could never ask
    // again, because the dead row kept occupying the only slot.
    if (insertErr && insertErr.code === '23505') {
      const { data: existing } = await supabase
        .from('connections')
        .select('id, status, requester, created_at')
        .or(`and(requester.eq.${currentUserId},addressee.eq.${addressee.id}),` +
            `and(requester.eq.${addressee.id},addressee.eq.${currentUserId})`)
        .limit(1);

      const row = existing && existing[0];

      if (!row) {
        // The row is invisible to us under RLS — nothing useful to say.
        setBusy(false);
        setMessage({ text: 'A request between you two already exists.', type: 'warn' });
        return;
      }

      if (row.status === 'accepted') {
        setBusy(false);
        setMessage({ text: "You're already connected.", type: 'warn' });
        return;
      }

      if (row.status === 'pending') {
        setBusy(false);
        setMessage({
          text: row.requester === currentUserId
            ? 'You already have a request pending with them.'
            : 'They have already sent YOU a request — accept it below.',
          type: 'warn',
        });
        return;
      }

      // status === 'declined'. A decline is not permanent, but it must not
      // become a way to pester someone, so a retry waits out a cool-off.
      const declinedAgo = Date.now() - new Date(row.created_at).getTime();
      if (declinedAgo < DECLINE_COOLOFF_HOURS * 3600 * 1000) {
        const hoursLeft = Math.ceil((DECLINE_COOLOFF_HOURS * 3600 * 1000 - declinedAgo) / 3600000);
        setBusy(false);
        setMessage({
          text: `That request was declined. You can try again in about ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}.`,
          type: 'warn',
        });
        return;
      }

      // Cool-off passed: clear the dead row and ask afresh. Deleting is allowed
      // by the existing "cancel own request" policy (requester OR addressee).
      const { error: delErr } = await supabase.from('connections').delete().eq('id', row.id);
      if (delErr) {
        setBusy(false);
        setMessage({ text: 'Could not send a new request. Please try again.', type: 'error' });
        return;
      }
      ({ error: insertErr } = await insertRow());
    }

    setBusy(false);

    if (insertErr) {
      setMessage({ text: insertErr.message, type: 'error' });
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
// Also lists SENT EMAIL INVITES. Previously an emailed invite appeared nowhere
// in the app — no record it happened, no way to chase it, no way to cancel it.
// Both kinds now sit in one list with a Withdraw action.
function OutgoingList({ outgoing, currentUserId, sentInvites = [], onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // Show only non-accepted by default to keep it tidy; let user expand to see all.
  const pending  = outgoing.filter(c => c.status === 'pending');
  const others   = outgoing.filter(c => c.status !== 'pending');

  // Withdrawing DELETES the row so it disappears from the other person's list
  // too — a withdrawn request should leave no trace for them to act on.
  // Permitted by the existing "cancel own request" policy.
  async function withdrawRequest(id) {
    setBusyId(id);
    const { error } = await supabase.from('connections').delete().eq('id', id);
    setBusyId(null);
    if (error) console.error('[Connections] withdraw error:', error.message);
    else onChanged?.();
  }

  // Deleting the invite row kills the emailed link immediately, because
  // accept_invite() looks the token up and will no longer find it. Needs db/17.
  async function withdrawInvite(id) {
    setBusyId(id);
    const { error } = await supabase.from('invites').delete().eq('id', id);
    setBusyId(null);
    if (error) console.error('[Connections] withdraw invite error:', error.message);
    else onChanged?.();
  }

  function WithdrawButton({ id, onClick }) {
    return (
      <button
        onClick={onClick}
        disabled={busyId === id}
        className="text-xs text-stone-500 hover:text-rose-600 underline underline-offset-2 disabled:opacity-50 shrink-0"
      >
        {busyId === id ? 'Withdrawing…' : 'Withdraw'}
      </button>
    );
  }

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
        <div className="flex items-center gap-2.5 shrink-0">
          <StatusPill status={c.status} />
          {/* Only a PENDING request can be withdrawn. Undoing an accepted
              connection affects shared groups, so that is a separate action. */}
          {c.status === 'pending' && c.requester === currentUserId && (
            <WithdrawButton id={c.id} onClick={() => withdrawRequest(c.id)} />
          )}
        </div>
      </li>
    );
  }

  function InviteRow({ inv }) {
    return (
      <li className="flex items-center justify-between gap-3 bg-white border border-stone-200 rounded-xl px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-800 truncate">{inv.email}</p>
          <p className="text-xs text-stone-400 truncate">
            Emailed invite · no account yet
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <StatusPill status={inv.status} />
          {inv.status === 'pending' && (
            <WithdrawButton id={inv.id} onClick={() => withdrawInvite(inv.id)} />
          )}
        </div>
      </li>
    );
  }

  const pendingInvites = sentInvites.filter(i => i.status === 'pending');

  if (outgoing.length === 0 && sentInvites.length === 0) {
    return <EmptyState text="No outgoing requests." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {pending.map(c => <PersonRow key={c.id} c={c} />)}
        {pendingInvites.map(inv => <InviteRow key={inv.id} inv={inv} />)}
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
  const { user, profile } = useAuth();
  const { incoming, outgoing, accepted, loading, error, refetch } = useConnections();

  // Invites this user has emailed. Kept here rather than in useConnections
  // because it is a different table with its own lifecycle — but it is shown in
  // the same list, since from the user's point of view both are "I asked
  // someone to connect and I'm waiting".
  const [sentInvites, setSentInvites] = useState([]);

  const loadInvites = useCallback(async () => {
    if (!user?.id) return;
    const { data, error: invErr } = await supabase
      .from('invites')
      .select('id, email, status, created_at')
      .eq('inviter', user.id)
      .order('created_at', { ascending: false });
    // A missing table (db/09 not run) must not break the whole screen — the
    // connections half still works without it.
    if (invErr) { setSentInvites([]); return; }
    setSentInvites(data || []);
  }, [user?.id]);

  useEffect(() => { loadInvites(); }, [loadInvites]);

  const refreshAll = useCallback(() => { refetch(); loadInvites(); }, [refetch, loadInvites]);

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
            <SendRequestForm onSent={refreshAll} currentUserId={user.id} inviterName={profile?.display_name} />
          </section>
        )}

        {/* Incoming requests */}
        {!loading && incoming.length > 0 && (
          <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
            <SectionHeader icon={UserPlus} title="Incoming requests" count={incoming.length} />
            <IncomingList incoming={incoming} onAction={refetch} />
          </section>
        )}

        {/* Outgoing requests AND sent email invites.
            The gate must consider BOTH: it used to be `outgoing.length > 0`, so
            someone whose only pending item was an emailed invite saw no section
            at all — the invite was fetched and rendered, then hidden by a
            condition that only knew about connections. */}
        {!loading && (outgoing.length > 0 || sentInvites.length > 0) && (
          <section className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
            <SectionHeader icon={Clock} title="Sent requests" count={outgoing.length + sentInvites.length} />
            <OutgoingList outgoing={outgoing} currentUserId={user.id} sentInvites={sentInvites} onChanged={refreshAll} />
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
