// store.js
// The single translation layer between Supabase rows and what the UI expects.
//
// The UI works with this shape per group:
//   { id, name, type, people: [name strings], expenses: [...], settlements: [...] }
//
// The DB stores expenses.paid_by as a group_members UUID, not a name string.
// This file converts in both directions so the rest of the UI never has to
// know about UUIDs.
//
// Offline write support (added in v2):
//   - After every successful fetchAll the assembled groups are saved to
//     localStorage as a "snapshot" so the app shows last-known data instantly
//     on next open, even if offline.
//   - Expense add/edit/delete and settlement add/delete are "offline-capable":
//     they apply the change to in-memory state immediately (optimistic UI),
//     try Supabase, and if that fails because of a network error they put the
//     operation in a persistent "outbox" queue instead of rolling back.
//   - When the device comes back online the outbox is flushed in order.
//   - Group creation/rename/delete and adding/removing people are online-only.
//
// Usage:
//   const { groups, activeGroupId, loading, error, online, pendingCount, actions }
//     = useExpenseStore(userId, profile);

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient.js';
import {
  loadSnapshot, saveSnapshot,
  loadOutbox,   saveOutbox,
  enqueue,      dequeue,
  applyOpToGroups,
  isNetworkError, isUniqueViolation,
} from './offline.js';

// ─── helpers ────────────────────────────────────────────────────────────────

// Shown when the scan-receipt Edge Function looks like it hasn't been deployed.
const NOT_DEPLOYED_MSG =
  "Scanning isn't set up yet — the scan function may need to be deployed.";

// Decide whether an error string smells like a missing/undeployed function
// rather than a real scanning problem (so we can show the friendly hint above).
function looksUndeployed(message) {
  const m = (message || '').toLowerCase();
  // Only treat genuine "couldn't reach the function" signatures as undeployed.
  // We deliberately do NOT match bare "not found"/"404", because a real error
  // FROM a deployed function (e.g. Gemini "model ... is not found") contains
  // those words and must show its true detail, not a misleading "deploy" hint.
  return (
    m.includes('failed to send a request to the edge function') ||
    m.includes('function not found') ||      // the Edge Function itself is missing
    m.includes('failed to fetch') ||         // browser network error
    m.includes('networkerror') ||
    m.includes('network error') ||
    m.includes('load failed')                // Safari offline
  );
}

// Build a display name for a group_members row.
// Real member (user_id set): look up the profiles map → display_name.
// Ghost member: use ghost_name directly.
function memberDisplayName(member, profilesMap) {
  if (member.user_id) {
    return profilesMap[member.user_id] || 'Unknown';
  }
  return member.ghost_name || 'Unknown';
}

// If a groups insert/update fails because the `currency` column doesn't exist
// yet (db/06_add_group_currency.sql hasn't been run), return a friendly,
// plain-language instruction. Otherwise return null so the caller shows its
// normal error. Postgres reports a missing column with code 42703 and a
// message like: column "currency" of relation "groups" does not exist.
function currencySetupMessage(dbError) {
  if (!dbError) return null;
  const msg = (dbError.message || '').toLowerCase();
  const looksLikeMissingColumn =
    dbError.code === '42703' ||
    (msg.includes('currency') && msg.includes('column')) ||
    (msg.includes('currency') && msg.includes('does not exist'));
  if (looksLikeMissingColumn) {
    return 'Currency needs a one-time database update — run db/06_add_group_currency.sql in Supabase.';
  }
  return null;
}

// If saving a CUSTOM-split expense fails because db/07_custom_split.sql hasn't
// been run yet, return a friendly instruction. Two things can go wrong before
// that script runs:
//   1. split_mode = 'custom' is rejected by the old check constraint
//      (Postgres code 23514 "check_violation", message mentions
//      split_mode_check / "violates check").
//   2. The split_detail column doesn't exist yet (code 42703, message
//      mentions split_detail / "does not exist").
// Otherwise return null so the caller shows its normal error.
function customSplitSetupMessage(dbError) {
  if (!dbError) return null;
  const msg = (dbError.message || '').toLowerCase();
  const looksLikeCustomSplit =
    dbError.code === '23514' ||                       // check constraint violation
    dbError.code === '42703' ||                       // undefined column
    msg.includes('split_detail') ||
    msg.includes('split_mode_check') ||
    msg.includes('violates check');
  if (looksLikeCustomSplit) {
    return 'Custom split needs a one-time database update — run db/07_custom_split.sql in Supabase.';
  }
  return null;
}

// ─── main hook ──────────────────────────────────────────────────────────────

export function useExpenseStore(userId, profile) {
  // ── Synchronously hydrate from snapshot so the UI is not blank on open ─────
  // We use the lazy-initializer form of useState (pass a function) so
  // localStorage is only read ONCE — on the very first render — not on every
  // re-render. This is safe: userId is stable once the auth layer resolves.
  const [groups, setGroups] = useState(() => {
    const snap = userId ? loadSnapshot(userId) : null;
    return snap?.groups || [];
  });
  const [activeGroupId, setActiveGroupId] = useState(() => {
    const snap = userId ? loadSnapshot(userId) : null;
    return snap?.activeGroupId || null;
  });

  // If we have a snapshot we can show the UI immediately; still fetch to refresh.
  // If we have no snapshot, show the spinner until the first fetch completes.
  const [loading, setLoading]         = useState(() => {
    const snap = userId ? loadSnapshot(userId) : null;
    return !snap || !snap.groups || snap.groups.length === 0;
  });
  const [error, setError]             = useState(null);

  // ── Offline / outbox state ─────────────────────────────────────────────────
  const [online, setOnline]           = useState(navigator.onLine);

  // We hold the outbox in a ref (not state) so mutations inside async callbacks
  // always see the current version without needing a state setter round-trip.
  // pendingCount is derived state exposed to the UI.
  const outboxRef                     = useRef(userId ? loadOutbox(userId) : []);
  const [pendingCount, setPendingCount] = useState(outboxRef.current.length);

  // isFlushing prevents two concurrent flush attempts.
  const isFlushingRef = useRef(false);

  // Keep a stable ref so realtime callbacks always call the latest fetch.
  const fetchRef = useRef(null);

  // Watchdog timer: a backgrounded PWA can resume with a stale auth token whose
  // refresh stalls, leaving a query pending forever and the spinner stuck. This
  // guarantees loading is always cleared so the user at least sees cached data.
  const watchdogRef = useRef(null);

  // The realtime channel, kept in a ref so we can tear it down and rebuild it
  // when the app resumes from the background (the live socket dies while suspended).
  const channelRef = useRef(null);

  // Helper: update outbox ref + localStorage + pendingCount in one shot.
  const commitOutbox = useCallback((newOutbox) => {
    outboxRef.current = newOutbox;
    if (userId) saveOutbox(userId, newOutbox);
    setPendingCount(newOutbox.length);
  }, [userId]);

  // ── fetch ──────────────────────────────────────────────────────────────────
  // Loads ALL groups the user can see (RLS scopes this to their own groups),
  // then for each group loads members and expenses in parallel.
  const fetchAll = useCallback(async () => {
    if (!userId) return;

    // Watchdog: if a query stalls (stale token after resume, dead socket, etc.)
    // never let the spinner hang — force loading off after 12s. Cached snapshot
    // data stays on screen; a later successful fetch reconciles it.
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => setLoading(false), 12000);

    try {
      setError(null);

      // 1. Load all accessible groups (RLS returns only permitted rows).
      //    We select '*' (every column) on purpose: the per-group `currency`
      //    column is added by db/06_add_group_currency.sql. Selecting '*' means
      //    the app keeps working even BEFORE that script is run — the column is
      //    simply absent and we fall back to 'USD' when we assemble each group.
      const { data: rawGroups, error: gErr } = await supabase
        .from('groups')
        .select('*')
        .order('created_at', { ascending: true });

      if (gErr) throw gErr;

      if (!rawGroups || rawGroups.length === 0) {
        setGroups([]);
        setActiveGroupId(null);
        setLoading(false);
        saveSnapshot(userId, [], null);
        return;
      }

      const groupIds = rawGroups.map(g => g.id);

      // 2. Load all members for all groups in one query.
      // We include `created_at` so the Activity timeline can show "X joined".
      // It's an existing column on every row — no schema change needed.
      const { data: rawMembers, error: mErr } = await supabase
        .from('group_members')
        .select('id, group_id, user_id, ghost_name, created_at')
        .in('group_id', groupIds);

      if (mErr) throw mErr;

      // 3. Collect real user_ids (excluding the current user whose profile we
      //    already have) so we can fetch their display names from profiles.
      const otherUserIds = [
        ...new Set(
          (rawMembers || [])
            .filter(m => m.user_id && m.user_id !== userId)
            .map(m => m.user_id)
        ),
      ];

      // Start with the current user in the map so we don't need a separate query.
      const profilesMap = { [userId]: profile?.display_name || 'Me' };

      // Parallel map: user_id → avatar_url (their profile photo). We seed it
      // with the CURRENT user's own avatar from the `profile` arg so their own
      // member row shows their photo too. profile.avatar_url is undefined until
      // db/08 is run — that's fine, it just stays empty and Avatar shows initials.
      const avatarMap = { [userId]: profile?.avatar_url || null };

      if (otherUserIds.length > 0) {
        // We want avatar_url too, but that column only exists AFTER db/08 is run.
        // Asking for a missing column makes PostgREST error and would break the
        // whole fetch. So we try WITH avatar_url first; if that fails we retry
        // with just display_name (names keep working, photos stay as initials).
        let otherProfiles = null;
        const withAvatar = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .in('id', otherUserIds);

        if (withAvatar.error) {
          // Most likely the avatar_url column doesn't exist yet (db/08 not run).
          // Fall back to the original name-only query so reads never break.
          const nameOnly = await supabase
            .from('profiles')
            .select('id, display_name')
            .in('id', otherUserIds);
          if (nameOnly.error) throw nameOnly.error;
          otherProfiles = nameOnly.data;
        } else {
          otherProfiles = withAvatar.data;
        }

        (otherProfiles || []).forEach(p => {
          profilesMap[p.id] = p.display_name;
          // avatar_url is undefined before db/08 → store null (Avatar shows initials).
          avatarMap[p.id] = p.avatar_url || null;
        });
      }

      // 4. Load all expenses for all groups in one query.
      //    We select '*' (every column) on purpose: the `split_detail` column
      //    is added by db/07_custom_split.sql. Selecting '*' means reads keep
      //    working even BEFORE that script is run — the column is simply absent
      //    and a custom split's per-person amounts won't be present until then.
      const { data: rawExpenses, error: eErr } = await supabase
        .from('expenses')
        .select('*')
        .in('group_id', groupIds)
        .order('date', { ascending: false });

      if (eErr) throw eErr;

      // 5. Load all settlements for all groups in one query.
      const { data: rawSettlements, error: sErr } = await supabase
        .from('settlements')
        .select('id, group_id, from_member, to_member, amount, date, note, created_at')
        .in('group_id', groupIds)
        .order('date', { ascending: false });

      if (sErr) throw sErr;

      // 6. Assemble the UI shape for each group.
      //
      //    Per group we build two maps:
      //      nameToMemberId : display-name string → group_members.id (for writes)
      //      memberIdToName : group_members.id    → display-name string (for reads)
      //
      //    These maps are attached to each group object so mutation helpers
      //    below can use them without a separate lookup.

      const assembled = rawGroups.map(g => {
        const members = (rawMembers || []).filter(m => m.group_id === g.id);

        const nameToMemberId = {};
        const memberIdToName = {};

        members.forEach(m => {
          const displayName = memberDisplayName(m, profilesMap);
          nameToMemberId[displayName] = m.id;
          memberIdToName[m.id] = displayName;
        });

        const people = members.map(m => memberDisplayName(m, profilesMap));

        // Map expense DB rows → UI expense shape.
        const expenses = (rawExpenses || [])
          .filter(e => e.group_id === g.id)
          .map(e => {
            // Base UI expense (same fields as before).
            const ui = {
              id:        e.id,
              name:      e.name,
              amount:    Number(e.amount),
              date:      e.date,           // already 'YYYY-MM-DD'
              category:  e.category,
              paidBy:    memberIdToName[e.paid_by] || 'Unknown',
              splitMode: e.split_mode,     // DB uses snake_case; UI uses camelCase
              note:      e.note || '',
              // When the expense was recorded — feeds the Activity timeline and
              // the "N new" home badge. Existing column, no schema change.
              createdAt: e.created_at,
            };

            // Custom split: the DB stores split_detail as { member_id: amount }.
            // The rest of the UI works with display NAMES, not member ids, so we
            // translate the keys here using this group's id→name map. The result
            // is a plain { name: amount } object the balance math can read.
            // (Absent/null split_detail → we attach nothing, so non-custom
            // expenses are completely unaffected.)
            if (e.split_detail && typeof e.split_detail === 'object') {
              const splitDetail = {};
              Object.entries(e.split_detail).forEach(([memberId, amt]) => {
                const name = memberIdToName[memberId];
                if (name) splitDetail[name] = Number(amt);
              });
              ui.splitDetail = splitDetail;
            }

            // Participants: WHO this expense is split among, frozen when the
            // expense was created. The DB stores `participants` as an array of
            // group_members ids (added by db/10). We translate those ids into
            // display NAMES here, dropping any id that's no longer a member
            // (someone removed from the group). If the column is missing/null/
            // empty (pre-db-10 expenses, or before db/10 is run), we fall back
            // to the group's full member list so old expenses behave exactly as
            // they did before — split among everyone currently in the group.
            if (Array.isArray(e.participants) && e.participants.length > 0) {
              const partNames = e.participants
                .map(memberId => memberIdToName[memberId])
                .filter(Boolean);
              // If, after filtering out departed members, nobody is left, fall
              // back to all people (never leave an expense with zero participants).
              ui.participants = partNames.length > 0 ? partNames : [...people];
            } else {
              ui.participants = [...people];
            }

            return ui;
          });

        // Map settlement DB rows → a settlement-flavoured expense shape that
        // the UI already knows how to render (type:'settlement').
        const settlements = (rawSettlements || [])
          .filter(s => s.group_id === g.id)
          .map(s => ({
            id:        s.id,
            type:      'settlement',
            date:      s.date,
            name:      `Settlement: ${memberIdToName[s.from_member] || '?'} paid ${memberIdToName[s.to_member] || '?'}`,
            amount:    Number(s.amount),
            category:  'Other',
            paidBy:    memberIdToName[s.from_member] || 'Unknown',
            splitMode: 'full',
            note:      s.note || '',
            // When the settlement was recorded — feeds the Activity timeline and
            // the "N new" home badge.
            createdAt: s.created_at,
            // Keep raw IDs so we can delete from the correct table.
            _settlementId: s.id,
            // Plain from/to display names so the settle-up math can treat a
            // settlement as a pure transfer (from -> to) for any group size.
            _settleFrom: memberIdToName[s.from_member] || 'Unknown',
            _settleTo:   memberIdToName[s.to_member] || 'Unknown',
          }));

        // Build a map from display-name → { isGhost, memberId } so the UI
        // can tell apart real connected members from ghost members without
        // knowing about UUIDs.
        const memberMeta = {};
        // Per-member avatar map: display name → avatar_url (or null).
        // Real members look up their photo by user_id; ghosts have no account
        // so they get null and the UI falls back to initials.
        const memberAvatars = {};
        members.forEach(m => {
          const displayName = memberDisplayName(m, profilesMap);
          memberMeta[displayName] = {
            isGhost:  m.ghost_name !== null && m.ghost_name !== undefined,
            memberId: m.id,
          };
          memberAvatars[displayName] = m.user_id ? (avatarMap[m.user_id] || null) : null;
        });

        // One "joined" event per member for the Activity timeline.
        //   name      : display name (real member's profile name, or ghost name)
        //   isGhost   : true when there's no linked account (no user_id)
        //   createdAt : when the member row was created (existing column)
        const memberJoins = members.map(m => ({
          name:      memberDisplayName(m, profilesMap),
          isGhost:   !m.user_id,
          createdAt: m.created_at,
        }));

        return {
          id:             g.id,
          name:           g.name,
          type:           g.type,
          owner_id:       g.owner_id,
          // Per-group currency code (e.g. 'USD', 'EUR'). Falls back to 'USD'
          // when the db/06 column hasn't been added yet (row.currency is then
          // undefined). Display-only — no money is ever converted.
          currency:       g.currency || 'USD',
          people,
          expenses:       [...expenses, ...settlements],
          // Internal maps — not used by UI rendering but needed by write helpers.
          _nameToMemberId: nameToMemberId,
          _memberIdToName: memberIdToName,
          // Per-member metadata for the UI (ghost badge, etc.).
          // Shape: { [displayName]: { isGhost: bool, memberId: uuid } }
          _memberMeta: memberMeta,
          // Per-member avatar URLs for the UI. Shape: { [displayName]: url|null }.
          // Ghosts and members without a photo are null → Avatar shows initials.
          _memberAvatars: memberAvatars,
          // "X joined" events for the Activity timeline. Shape:
          // [{ name, isGhost, createdAt }]. One entry per member.
          _memberJoins: memberJoins,
        };
      });

      setGroups(assembled);

      // Keep active group stable across refetches; fall back to first group.
      setActiveGroupId(prev => {
        const next = (prev && assembled.some(g => g.id === prev))
          ? prev
          : assembled[0]?.id ?? null;

        // Persist the fresh snapshot so offline opens show current data.
        // We compute `next` here since setActiveGroupId is not yet committed.
        saveSnapshot(userId, assembled, next);
        return next;
      });

    } catch (err) {
      console.error('[store] fetchAll error:', err);

      // If this is a network failure AND we already have snapshot data, keep
      // the snapshot silently (the offline banner in App.jsx tells the user).
      // Only show an error when we have NO data at all.
      if (isNetworkError(err)) {
        // Stay on snapshot (or empty) — do not wipe what the user can see.
        // Don't set error here; the `online` state / banner covers it.
      } else {
        setError(err.message || 'Failed to load data. Please try again.');
      }
    } finally {
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      setLoading(false);
    }
  }, [userId, profile]);

  // Keep the ref current so realtime callbacks always call the latest version.
  fetchRef.current = fetchAll;

  // ── Flush outbox ────────────────────────────────────────────────────────────
  // Replay queued writes in FIFO order against Supabase.
  // - On success or 23505 (already there): drop the item and continue.
  // - On network error: stop — the rest stays queued.
  // - On real server error: drop the item (can't retry a bad write) and log it.
  // After a clean flush, trigger a fetchAll to reconcile with server truth.
  const flushOutbox = useCallback(async () => {
    if (!userId) return;
    if (isFlushingRef.current) return; // re-entrancy guard
    if (outboxRef.current.length === 0) return;

    isFlushingRef.current = true;
    let didFlushAnything = false;

    try {
      // Process items one at a time in order (FIFO).
      // We re-read outboxRef.current each iteration because commitOutbox mutates it.
      while (outboxRef.current.length > 0) {
        // Stop if we've gone offline mid-flush.
        if (!navigator.onLine) break;

        const item = outboxRef.current[0];
        const { opId, kind, payload } = item;

        let dbError = null;

        try {
          if (kind === 'expense.insert') {
            // Supply the client-generated id so the insert is idempotent.
            ({ error: dbError } = await supabase
              .from('expenses')
              .insert(payload));

          } else if (kind === 'expense.update') {
            // Strip the primary key from the update body — use it only in .eq().
            // eslint-disable-next-line no-unused-vars
            const { id: _updateId, ...updateFields } = payload;
            ({ error: dbError } = await supabase
              .from('expenses')
              .update(updateFields)
              .eq('id', payload.id));

          } else if (kind === 'expense.delete') {
            ({ error: dbError } = await supabase
              .from('expenses')
              .delete()
              .eq('id', payload.id));

          } else if (kind === 'settlement.insert') {
            ({ error: dbError } = await supabase
              .from('settlements')
              .insert(payload));

          } else if (kind === 'settlement.delete') {
            ({ error: dbError } = await supabase
              .from('settlements')
              .delete()
              .eq('id', payload.id));
          }
        } catch (fetchErr) {
          // fetch() itself threw — still offline.
          if (isNetworkError(fetchErr)) break;
          // Unexpected JS error: drop and continue so we don't get stuck.
          console.error('[store] flush unexpected error for op', opId, fetchErr);
          commitOutbox(dequeue(outboxRef.current, opId));
          continue;
        }

        if (!dbError) {
          // Success.
          commitOutbox(dequeue(outboxRef.current, opId));
          didFlushAnything = true;
        } else if (isUniqueViolation(dbError)) {
          // Row already exists (duplicate sync) — treat as success, drop it.
          console.log('[store] flush: 23505 unique violation for op', opId, '— dropping as already synced');
          commitOutbox(dequeue(outboxRef.current, opId));
          didFlushAnything = true;
        } else if (isNetworkError(dbError)) {
          // Still offline — stop and leave the rest queued.
          break;
        } else {
          // Real server error (RLS, constraint, etc.) — drop and log.
          // We cannot retry a semantically bad write.
          console.error('[store] flush: server rejected op', opId, dbError);
          commitOutbox(dequeue(outboxRef.current, opId));
          // Don't surface this to the user as an error — the optimistic change
          // is already shown; a silent server reject is better than an alert
          // for an op the user triggered while offline.
        }
      }
    } finally {
      isFlushingRef.current = false;
    }

    // After a successful flush, refetch to reconcile with server truth.
    // This also replaces any _offline-flagged rows with the authoritative ones.
    if (didFlushAnything) {
      await fetchRef.current();
    }
  }, [userId, commitOutbox]);

  // ── initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetchAll().then(() => {
      // If there were pending ops and we're online, try to flush immediately.
      if (navigator.onLine && outboxRef.current.length > 0) {
        flushOutbox();
      }
    });
  }, [userId, fetchAll, flushOutbox]);

  // ── online / offline tracking ──────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      // Flush any queued ops now that we have connectivity.
      flushOutbox();
    };
    const handleOffline = () => {
      setOnline(false);
    };

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushOutbox]);

  // ── realtime ───────────────────────────────────────────────────────────────
  // Subscribe to all relevant tables. On any change (insert/update/delete)
  // we do a simple full refetch — straightforward and correct.
  // We skip the refetch while we have unsynced ops in the outbox: a refetch
  // at that point would wipe the optimistic state. The reconciliation happens
  // after flushOutbox() succeeds instead.
  // (Re)open the realtime channel. Kept as a callable so the resume handler can
  // rebuild it after the socket dies during background suspension.
  const subscribeRealtime = useCallback(() => {
    if (!userId) return;
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }

    const onChange = () => { if (outboxRef.current.length === 0) fetchRef.current?.(); };
    channelRef.current = supabase
      .channel('expense-splitter-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' }, onChange)
      .subscribe();
  }, [userId]);

  useEffect(() => {
    subscribeRealtime();
    // Clean up when the user signs out or component unmounts.
    return () => {
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    };
  }, [subscribeRealtime]);

  // ── resume from background ───────────────────────────────────────────────────
  // A PWA/tab suspended in the background comes back with a dead realtime socket
  // and possibly a stale auth token — which is what leaves the app "stuck loading"
  // until a manual close/reopen. When we return to the foreground (or regain
  // network), rebuild the socket, nudge the token, and refetch fresh data.
  useEffect(() => {
    if (!userId) return;
    let lastRun = 0;
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastRun < 3000) return;   // one event; visibilitychange + focus can both fire
      lastRun = now;
      subscribeRealtime();
      // getSession() refreshes an expired token; refetch either way to unstick the UI.
      Promise.resolve(supabase.auth.getSession()).finally(() => fetchRef.current?.());
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [userId, subscribeRealtime]);

  // ── helper: find group ─────────────────────────────────────────────────────
  const findGroup = (groupId) => groups.find(g => g.id === groupId);

  // ── offline-capable write helper ───────────────────────────────────────────
  // Shared logic for expense/settlement writes:
  //   1. Apply optimistic change to in-memory state immediately.
  //   2. Try Supabase.
  //   3a. On success: refetch (authoritative data replaces optimistic row).
  //   3b. On network error: enqueue to outbox, keep optimistic state.
  //   3c. On real server error: roll back optimistic state, surface error.
  //
  // `optimisticGroups`  : the groups array AFTER the optimistic change.
  // `op`                : the outbox item { opId, kind, payload, groupId }.
  // `supabaseCall`      : async function () => { error } — the actual DB call.
  async function offlineWrite(optimisticGroups, op, supabaseCall) {
    // Step 1: apply optimistically.
    setGroups(optimisticGroups);

    let dbError = null;
    let caughtNetworkError = false;

    try {
      ({ error: dbError } = await supabaseCall());
    } catch (fetchErr) {
      if (isNetworkError(fetchErr)) {
        caughtNetworkError = true;
      } else {
        // Unexpected JS error — treat as network failure to be safe.
        caughtNetworkError = true;
        console.error('[store] offlineWrite unexpected error:', fetchErr);
      }
    }

    if (!dbError && !caughtNetworkError) {
      // Success: refetch to get the authoritative server data.
      await fetchRef.current();
      return;
    }

    if (caughtNetworkError || isNetworkError(dbError)) {
      // Network failure — queue the op and persist both outbox and snapshot.
      const newOutbox = enqueue(outboxRef.current, op);
      commitOutbox(newOutbox);
      // Persist snapshot with optimistic state so offline → close → reopen works.
      setActiveGroupId(prev => {
        saveSnapshot(userId, optimisticGroups, prev);
        return prev;
      });
      return;
    }

    // Real server error — roll back optimistic change and tell the user.
    // We roll back by re-setting groups to the pre-optimistic state (before our
    // setGroups call above). Since we haven't called fetchRef yet, the previous
    // React state (before this function was called) is still in `groups`.
    // We trigger a refetch to restore authoritative state cleanly.
    //
    // Special case: if this is a custom-split expense and db/07 hasn't been run
    // yet, the DB rejects 'custom' / the missing split_detail column. Show the
    // plain "run the migration" instruction instead of a raw Postgres message.
    setError(
      customSplitSetupMessage(dbError) ||
      ('Could not save: ' + (dbError.message || 'Server error'))
    );
    await fetchRef.current();
  }

  // ── actions ────────────────────────────────────────────────────────────────

  const actions = {

    // ── Switch active group (local only, no DB call needed) ──────────────────
    switchGroup(groupId) {
      setActiveGroupId(groupId);
    },

    // ── Add or edit an expense ───────────────────────────────────────────────
    // OFFLINE-CAPABLE. Generates a client-side UUID for new expenses so the id
    // is stable whether it syncs now or later.
    async upsertExpense(groupId, uiExpense) {
      const group = findGroup(groupId);
      if (!group) return;

      const paidByMemberId = group._nameToMemberId[uiExpense.paidBy];
      if (!paidByMemberId) {
        setError(`Member "${uiExpense.paidBy}" not found in this group.`);
        return;
      }

      const isUpdate = !!(uiExpense._isExistingDbRow && uiExpense.id);

      // Build the DB row with exact schema column names.
      // For inserts we supply a client-generated id so the row has a stable
      // identity before (and after) it reaches the server.
      // Custom split: the UI hands us splitDetail keyed by display NAME
      // ({ "Shailja": 70, "Ravi": 30 }). The DB wants it keyed by the member's
      // group_members.id ({ "<uuid>": 70, ... }), so translate names→ids here
      // with this group's name→id map. For every OTHER split mode we store null
      // (those modes compute each person's share from the rules, so there's
      // nothing per-person to remember).
      let splitDetailForDb = null;
      if (uiExpense.splitMode === 'custom' && uiExpense.splitDetail) {
        splitDetailForDb = {};
        Object.entries(uiExpense.splitDetail).forEach(([name, amt]) => {
          const memberId = group._nameToMemberId[name];
          if (memberId) splitDetailForDb[memberId] = Number(amt);
        });
      }

      const row = {
        id:           isUpdate ? uiExpense.id : crypto.randomUUID(),
        group_id:     groupId,
        name:         uiExpense.name,
        amount:       Number(uiExpense.amount),
        date:         uiExpense.date,
        category:     uiExpense.category,
        paid_by:      paidByMemberId,
        split_mode:   uiExpense.splitMode,
        note:         uiExpense.note || null,
        // Per-person amounts for a custom split (or null for the other modes).
        split_detail: splitDetailForDb,
      };

      // Participants: WHO this expense is split among (a list of group_members
      // ids). We decide them in priority order:
      //
      //  1. The user picked explicitly in the "Split among" selector
      //     (equal/full): uiExpense.participants is an array of display NAMES.
      //     Translate names→ids and store exactly those — on INSERT AND UPDATE
      //     alike, so editing an expense to fix its participants actually saves.
      //
      //  2. Custom split: nobody used the picker, but the per-person split_detail
      //     already says who's involved (the people with amounts). Record those
      //     same member ids as the participants.
      //
      //  3. Fallback (personal, or no selection at all):
      //       • INSERT → snapshot the group's CURRENT member ids (every real +
      //         ghost member present right now). Adding a member later will NOT
      //         pull them into this old expense.
      //       • UPDATE → leave participants untouched: we omit the column from
      //         the update below so the original snapshot is preserved.
      let participantIds = null; // null = "don't set it" (handled per-branch)
      if (Array.isArray(uiExpense.participants) && uiExpense.participants.length) {
        // 1. Explicit selection (names → ids). Drop any name we can't resolve.
        participantIds = uiExpense.participants
          .map(name => group._nameToMemberId[name])
          .filter(Boolean);
      } else if (uiExpense.splitMode === 'custom' && splitDetailForDb) {
        // 2. Custom: the ids that have an amount in split_detail.
        participantIds = Object.keys(splitDetailForDb);
      }

      if (participantIds && participantIds.length) {
        // Cases 1 & 2: set on both insert and update.
        row.participants = participantIds;
      } else if (!isUpdate) {
        // 3a. Fallback on insert: snapshot all current members.
        row.participants = Object.values(group._nameToMemberId);
      }
      // 3b. Fallback on update: do nothing here; the update branch below strips
      //     the column when it's absent, preserving the original snapshot.

      const kind = isUpdate ? 'expense.update' : 'expense.insert';
      const op   = { opId: crypto.randomUUID(), kind, payload: row, groupId };

      // Build the optimistic groups state.
      const optimisticGroups = applyOpToGroups(groups, op);

      await offlineWrite(optimisticGroups, op, () => {
        if (isUpdate) {
          // eslint-disable-next-line no-unused-vars
          const { id, ...updateFields } = row;
          return supabase.from('expenses').update(updateFields).eq('id', row.id);
        } else {
          return supabase.from('expenses').insert(row);
        }
      });
    },

    // ── Bulk import expenses (from CSV) ──────────────────────────────────────
    // Batch insert — online only (no offline fallback for bulk ops).
    async importExpenses(groupId, rows, { paidByName, splitMode }) {
      const group = findGroup(groupId);
      if (!group) return { error: 'Group not found.' };

      const paidByMemberId = group._nameToMemberId[paidByName];
      if (!paidByMemberId) {
        const msg = `Member "${paidByName}" not found in this group.`;
        setError(msg);
        return { error: msg };
      }

      if (!rows || rows.length === 0) {
        return { inserted: 0 };
      }

      const dbRows = rows.map(r => ({
        id:         crypto.randomUUID(),
        group_id:   groupId,
        name:       r.name,
        amount:     Number(r.amount),
        date:       r.date,
        category:   r.category || 'Other',
        paid_by:    paidByMemberId,
        split_mode: splitMode,
        note:       r.note || null,
      }));

      const { error: dbError } = await supabase
        .from('expenses')
        .insert(dbRows);

      if (dbError) {
        setError('Could not import expenses: ' + dbError.message);
        return { error: dbError.message };
      }

      await fetchRef.current();
      return { inserted: dbRows.length };
    },

    // ── Scan a receipt or statement (AI vision) ──────────────────────────────
    // The browser sends the picked file (already turned into base64 + its
    // mime type) up to the `scan-receipt` Supabase Edge Function. That function
    // does the AI reading and hands back a list of expenses.
    //
    // We return a plain result object so the calling UI can show the message
    // inline (next to the file picker), rather than as a global red banner:
    //   • success → { ok: true, expenses: [{ date, description, amount, category }] }
    //   • failure → { ok: false, message: '…friendly text…' }
    async scanReceipt(fileBase64, mimeType) {
      try {
        const { data, error } = await supabase.functions.invoke('scan-receipt', {
          body: { fileBase64, mimeType },
        });

        // `error` is set when the request itself failed (network, 404, the
        // function threw, etc.). We translate the common "it isn't deployed
        // yet" cases into one friendly sentence; everything else we pass
        // through so the owner can see the real detail.
        if (error) {
          let raw = error.message || String(error);
          // supabase-js reports a generic "non-2xx status code" here; the REAL
          // reason is in the function's JSON error body on error.context (a
          // Response). Read it so the owner sees e.g. a missing GEMINI_API_KEY or
          // a Gemini error, instead of the unhelpful generic message.
          try {
            if (error.context && typeof error.context.json === 'function') {
              const body = await error.context.json();
              if (body?.error) {
                raw = body.error + (body.detail ? ` — ${String(body.detail).slice(0, 300)}` : '');
              }
            }
          } catch (_) { /* body wasn't JSON — keep the original message */ }
          if (looksUndeployed(raw)) {
            return { ok: false, message: NOT_DEPLOYED_MSG };
          }
          return { ok: false, message: raw };
        }

        // The function can also report a problem in its JSON body
        // (e.g. { ok: false, error: 'No image' }) even with a 200 status.
        if (!data || data.ok !== true) {
          const detail = data?.error || data?.detail || data?.message;
          return { ok: false, message: detail || 'Scanning failed — please try again.' };
        }

        return { ok: true, expenses: Array.isArray(data.expenses) ? data.expenses : [] };
      } catch (err) {
        // A thrown error usually means the request never reached a deployed
        // function (offline, blocked, or the function does not exist).
        const raw = err?.message || String(err);
        if (looksUndeployed(raw)) {
          return { ok: false, message: NOT_DEPLOYED_MSG };
        }
        return { ok: false, message: raw };
      }
    },

    // ── Delete an expense or settlement ──────────────────────────────────────
    // OFFLINE-CAPABLE.
    async deleteExpense(groupId, expenseId, isSettlement) {
      const kind    = isSettlement ? 'settlement.delete' : 'expense.delete';
      const payload = { id: expenseId };
      const op      = { opId: crypto.randomUUID(), kind, payload, groupId };

      const optimisticGroups = applyOpToGroups(groups, op);

      await offlineWrite(optimisticGroups, op, () => {
        const table = isSettlement ? 'settlements' : 'expenses';
        return supabase.from(table).delete().eq('id', expenseId);
      });
    },

    // ── Create a new group ───────────────────────────────────────────────────
    // ONLINE-ONLY: creating a group requires a server round-trip to get the
    // group_members UUID needed for every subsequent expense write.
    async createGroup(name, type, extraPeopleNames, currency) {
      if (!navigator.onLine) {
        setError("You're offline — creating or changing groups and people needs a connection. Expenses and settlements you add will sync automatically when you're back online.");
        return null;
      }

      const { data: newGroup, error: gErr } = await supabase
        .from('groups')
        // currency is the per-group code (e.g. 'USD', 'EUR'); default to 'USD'.
        .insert({ name, owner_id: userId, type, currency: currency || 'USD' })
        .select('id')
        .single();

      if (gErr) {
        // If the db/06 currency column hasn't been added yet, the insert fails
        // with a "column ... does not exist" schema error. Give a clear, plain
        // instruction instead of a raw Postgres message.
        setError(currencySetupMessage(gErr) || ('Could not create group: ' + gErr.message));
        return null;
      }

      const newGroupId = newGroup.id;

      const memberRows = [{ group_id: newGroupId, user_id: userId }];
      extraPeopleNames.forEach(n => {
        if (n.trim()) {
          memberRows.push({ group_id: newGroupId, ghost_name: n.trim() });
        }
      });

      const { error: mErr } = await supabase
        .from('group_members')
        .insert(memberRows);

      if (mErr) {
        setError('Could not add members: ' + mErr.message);
      }

      await fetchRef.current();
      setActiveGroupId(newGroupId);
      return newGroupId;
    },

    // ── Edit an existing group's name/type ───────────────────────────────────
    // ONLINE-ONLY.
    async updateGroup(groupId, name, type, currency) {
      if (!navigator.onLine) {
        setError("You're offline — creating or changing groups and people needs a connection. Expenses and settlements you add will sync automatically when you're back online.");
        return;
      }

      const { error: gErr } = await supabase
        .from('groups')
        // currency is the per-group code (e.g. 'USD', 'EUR'); default to 'USD'.
        .update({ name, type, currency: currency || 'USD' })
        .eq('id', groupId);

      if (gErr) {
        // Same db/06 schema-error guard as createGroup.
        setError(currencySetupMessage(gErr) || ('Could not update group: ' + gErr.message));
        return;
      }

      await fetchRef.current();
    },

    // ── Delete a group ───────────────────────────────────────────────────────
    // ONLINE-ONLY. ON DELETE CASCADE handles members/expenses/settlements.
    async deleteGroup(groupId) {
      if (!navigator.onLine) {
        setError("You're offline — creating or changing groups and people needs a connection. Expenses and settlements you add will sync automatically when you're back online.");
        return;
      }

      const { error: gErr } = await supabase
        .from('groups')
        .delete()
        .eq('id', groupId);

      if (gErr) {
        setError('Could not delete group: ' + gErr.message);
        return;
      }

      await fetchRef.current();
    },

    // ── Record a settlement ──────────────────────────────────────────────────
    // OFFLINE-CAPABLE. Client generates the UUID so the row id is stable.
    async recordSettlement(groupId, { from, to, amount, note }) {
      const group = findGroup(groupId);
      if (!group) return;

      const fromMemberId = group._nameToMemberId[from];
      const toMemberId   = group._nameToMemberId[to];

      if (!fromMemberId || !toMemberId) {
        setError('Could not find member for settlement.');
        return;
      }

      const row = {
        id:          crypto.randomUUID(),
        group_id:    groupId,
        from_member: fromMemberId,
        to_member:   toMemberId,
        amount:      Number(amount),
        date:        new Date().toISOString().slice(0, 10),
        note:        note || null,
      };

      const op = {
        opId:    crypto.randomUUID(),
        kind:    'settlement.insert',
        payload: row,
        groupId,
      };

      const optimisticGroups = applyOpToGroups(groups, op);

      await offlineWrite(optimisticGroups, op, () =>
        supabase.from('settlements').insert(row)
      );
    },

    // ── Add a person (ghost member) to an existing group ─────────────────────
    // ONLINE-ONLY: we need the new member's UUID in the _nameToMemberId map
    // before any offline expense can reference them.
    async addPersonToGroup(groupId, personName) {
      if (!navigator.onLine) {
        setError("You're offline — creating or changing groups and people needs a connection. Expenses and settlements you add will sync automatically when you're back online.");
        return;
      }

      const trimmed = personName.trim();
      if (!trimmed) return;

      const { error: mErr } = await supabase
        .from('group_members')
        .insert({ group_id: groupId, ghost_name: trimmed });

      if (mErr) {
        setError('Could not add person: ' + mErr.message);
        return;
      }
      await fetchRef.current();
    },

    // ── Remove a person (ghost or real) from an existing group ───────────────
    // ONLINE-ONLY.
    async removePersonFromGroup(groupId, personName) {
      if (!navigator.onLine) {
        setError("You're offline — creating or changing groups and people needs a connection. Expenses and settlements you add will sync automatically when you're back online.");
        return;
      }

      const group = findGroup(groupId);
      if (!group) return;

      const memberId = group._nameToMemberId[personName];
      if (!memberId) {
        setError(`Could not find member "${personName}" to remove.`);
        return;
      }

      const meta = group._memberMeta?.[personName];
      if (meta && !meta.isGhost) {
        setError('You cannot remove a real connected member this way. Only ghost members can be removed.');
        return;
      }

      const { error: dErr } = await supabase
        .from('group_members')
        .delete()
        .eq('id', memberId);

      if (dErr) {
        setError('Could not remove member: ' + dErr.message);
        return;
      }

      await fetchRef.current();
    },

    // ── Link a ghost member to a real connected user account ────────────────
    // This is the "link-ghost" flow: the owner has an accepted connection with
    // a real user, and wants to attach that user to a ghost row that already
    // exists in this group.
    //
    // How it works:
    //   1. Look up the ghost's group_members.id using the group's name→id map.
    //   2. UPDATE that row in place: set user_id = the real user's id,
    //      clear ghost_name = null.
    //   THE ROW ID DOES NOT CHANGE — so every expense whose paid_by points at
    //   this row stays perfectly attached. We never delete + reinsert.
    //   3. Refetch so the UI shows the real user's display name instead of the
    //      ghost name.
    //
    // Errors:
    //   - If the RLS policy from db/05_link_ghost_policy.sql has not been run
    //     yet (error code 42501, or message mentions policy/permission/row-level),
    //     we show a friendly setup instruction instead of a raw Postgres error.
    //   - All other errors are shown as-is.
    //
    // ONLINE-ONLY: this is a structural change (like adding/removing a person).
    async linkGhostToUser(groupId, ghostName, userId) {
      if (!navigator.onLine) {
        setError("You're offline — linking a ghost needs a connection. Try again when you're back online.");
        return;
      }

      const group = findGroup(groupId);
      if (!group) {
        setError('Group not found.');
        return;
      }

      // Find the ghost's group_members row id via the display-name map.
      const memberId = group._nameToMemberId[ghostName];
      if (!memberId) {
        setError(`Could not find ghost member "${ghostName}" in this group.`);
        return;
      }

      // Verify this is actually a ghost (belt-and-suspenders check — the RLS
      // policy also enforces it, but a clear message here is friendlier).
      const meta = group._memberMeta?.[ghostName];
      if (meta && !meta.isGhost) {
        setError(`"${ghostName}" is already a real member — only ghost members can be linked.`);
        return;
      }

      // UPDATE in place: set user_id, clear ghost_name.
      // Column names must match db/01_schema.sql exactly.
      const { error: dbError } = await supabase
        .from('group_members')           // table: group_members
        .update({
          user_id:    userId,            // column: user_id (uuid, fk → auth.users)
          ghost_name: null,              // column: ghost_name (text, now null)
        })
        .eq('id', memberId);             // column: id (the same row — no delete/reinsert)

      if (dbError) {
        // RLS/permission errors (code 42501 or message text) mean the owner
        // hasn't run db/05_link_ghost_policy.sql yet. Give a clear instruction.
        const isRlsError =
          dbError.code === '42501' ||
          (dbError.message || '').toLowerCase().includes('policy') ||
          (dbError.message || '').toLowerCase().includes('permission') ||
          (dbError.message || '').toLowerCase().includes('row-level') ||
          (dbError.message || '').toLowerCase().includes('violates row');

        if (isRlsError) {
          setError(
            'Linking needs a one-time database update — run db/05_link_ghost_policy.sql in Supabase.'
          );
        } else {
          setError('Could not link member: ' + (dbError.message || 'Server error'));
        }
        return;
      }

      // Success: refetch so the name updates to the real user's display name.
      await fetchRef.current();
    },

    // ── Invite a ghost member by email ──────────────────────────────────────
    // Calls the deployed Edge Function `send-invite` (supabase/functions/send-invite/)
    // which emails the person via Resend from hello@splitab.app.
    //
    // This action does NOT call setError globally — invite failures are shown
    // inline in the MembersPanel, not as an app-level banner. We return a small
    // result object the UI can act on directly.
    //
    // Returns: { ok: true }  on success
    //          { ok: false, message: string }  on failure
    //
    // AUTO-CONNECT: we also pass `groupId` and `ghostMemberId` so the invite
    // row records WHICH ghost in WHICH group this invitation is for. When the
    // invitee later opens their link and accept_invite runs, it can connect the
    // two users AND link that exact ghost row to their new account automatically
    // — no manual "Link to account" step needed.
    async inviteGhostByEmail({ email, groupName, inviterName, groupId, ghostMemberId }) {
      // Call the Edge Function. supabase.functions.invoke handles auth headers.
      // We only need to inspect `error`; the response body (data) is ignored.
      let error;
      try {
        ({ error } = await supabase.functions.invoke('send-invite', {
          body: { email, groupName, inviterName, groupId, ghostMemberId },
        }));
      } catch (fetchErr) {
        // The fetch itself threw — likely the function is not deployed, or a
        // network error reached the functions endpoint.
        return {
          ok: false,
          message: "Invite couldn't be sent — the invite email function may not be set up yet.",
        };
      }

      if (error) {
        // Check for signs that the Edge Function isn't deployed or is unreachable.
        // Supabase surfaces these as messages like "Function not found" or
        // "Failed to send a request to the Edge Function".
        const msg = (error.message || '').toLowerCase();
        const notDeployed =
          msg.includes('function not found') ||
          msg.includes('failed to send a request to the edge function') ||
          msg.includes('404') ||
          error.status === 404;

        if (notDeployed) {
          return {
            ok: false,
            message: "Invite couldn't be sent — the invite email function may not be set up yet.",
          };
        }

        // Any other error: return whatever detail the function gave back.
        return {
          ok: false,
          message: error.message || 'Could not send the invitation. Please try again.',
        };
      }

      return { ok: true };
    },

    // ── Accept an invite (auto-connect + auto-link the ghost) ────────────────
    // Called once, automatically, when a signed-in user arrives from an invite
    // link (the token was stashed in localStorage by main.jsx). It runs the
    // db/09 `accept_invite(invite_token)` SQL function, which — as the signed-in
    // invitee — creates the accepted connection between the two users and links
    // the ghost row that the inviter prepared to this user's account.
    //
    // Like inviteGhostByEmail, this does NOT use the global error banner; the
    // App shows a small inline notice from the returned result instead.
    //
    // Returns: { ok: true,  inviter, group }   on success
    //          { ok: false, message: string }  on failure
    async acceptInvite(token) {
      const { data, error } = await supabase.rpc('accept_invite', {
        invite_token: token,
      });

      // The function reports trouble two ways: a transport/SQL `error`, or a
      // 200 response whose JSON body says { ok: false, error: '...' } (e.g. the
      // invite was sent to a different email, or it expired). Handle both.
      if (error || data?.ok === false) {
        return {
          ok: false,
          message: data?.error || error?.message || 'Could not accept the invite.',
        };
      }

      // Success: refetch so the newly-joined group and the new connection show
      // up right away without needing a manual reload.
      await fetchRef.current();
      return { ok: true, inviter: data.inviter, group: data.group };
    },

    // ── Clear any error (used by retry / dismiss buttons) ────────────────────
    clearError() {
      setError(null);
    },

    // ── Retry: re-run fetchAll ───────────────────────────────────────────────
    async retry() {
      setLoading(true);
      setError(null);
      await fetchAll();
    },
  };

  return { groups, activeGroupId, loading, error, online, pendingCount, actions };
}
