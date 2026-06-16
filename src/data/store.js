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

// Build a display name for a group_members row.
// Real member (user_id set): look up the profiles map → display_name.
// Ghost member: use ghost_name directly.
function memberDisplayName(member, profilesMap) {
  if (member.user_id) {
    return profilesMap[member.user_id] || 'Unknown';
  }
  return member.ghost_name || 'Unknown';
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

    try {
      setError(null);

      // 1. Load all accessible groups (RLS returns only permitted rows).
      const { data: rawGroups, error: gErr } = await supabase
        .from('groups')
        .select('id, name, owner_id, type')
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
      const { data: rawMembers, error: mErr } = await supabase
        .from('group_members')
        .select('id, group_id, user_id, ghost_name')
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

      if (otherUserIds.length > 0) {
        const { data: otherProfiles, error: pErr } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', otherUserIds);

        if (pErr) throw pErr;
        (otherProfiles || []).forEach(p => { profilesMap[p.id] = p.display_name; });
      }

      // 4. Load all expenses for all groups in one query.
      const { data: rawExpenses, error: eErr } = await supabase
        .from('expenses')
        .select('id, group_id, name, amount, date, category, paid_by, split_mode, note')
        .in('group_id', groupIds)
        .order('date', { ascending: false });

      if (eErr) throw eErr;

      // 5. Load all settlements for all groups in one query.
      const { data: rawSettlements, error: sErr } = await supabase
        .from('settlements')
        .select('id, group_id, from_member, to_member, amount, date, note')
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
          .map(e => ({
            id:        e.id,
            name:      e.name,
            amount:    Number(e.amount),
            date:      e.date,           // already 'YYYY-MM-DD'
            category:  e.category,
            paidBy:    memberIdToName[e.paid_by] || 'Unknown',
            splitMode: e.split_mode,     // DB uses snake_case; UI uses camelCase
            note:      e.note || '',
          }));

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
        members.forEach(m => {
          const displayName = memberDisplayName(m, profilesMap);
          memberMeta[displayName] = {
            isGhost:  m.ghost_name !== null && m.ghost_name !== undefined,
            memberId: m.id,
          };
        });

        return {
          id:             g.id,
          name:           g.name,
          type:           g.type,
          owner_id:       g.owner_id,
          people,
          expenses:       [...expenses, ...settlements],
          // Internal maps — not used by UI rendering but needed by write helpers.
          _nameToMemberId: nameToMemberId,
          _memberIdToName: memberIdToName,
          // Per-member metadata for the UI (ghost badge, etc.).
          // Shape: { [displayName]: { isGhost: bool, memberId: uuid } }
          _memberMeta: memberMeta,
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
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('expense-splitter-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' },
        () => { if (outboxRef.current.length === 0) fetchRef.current(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' },
        () => { if (outboxRef.current.length === 0) fetchRef.current(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' },
        () => { if (outboxRef.current.length === 0) fetchRef.current(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' },
        () => { if (outboxRef.current.length === 0) fetchRef.current(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' },
        () => { if (outboxRef.current.length === 0) fetchRef.current(); })
      .subscribe();

    // Clean up when the user signs out or component unmounts.
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

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
    setError('Could not save: ' + (dbError.message || 'Server error'));
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
      const row = {
        id:         isUpdate ? uiExpense.id : crypto.randomUUID(),
        group_id:   groupId,
        name:       uiExpense.name,
        amount:     Number(uiExpense.amount),
        date:       uiExpense.date,
        category:   uiExpense.category,
        paid_by:    paidByMemberId,
        split_mode: uiExpense.splitMode,
        note:       uiExpense.note || null,
      };

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
    async createGroup(name, type, extraPeopleNames) {
      if (!navigator.onLine) {
        setError("You're offline — creating or changing groups and people needs a connection. Expenses and settlements you add will sync automatically when you're back online.");
        return null;
      }

      const { data: newGroup, error: gErr } = await supabase
        .from('groups')
        .insert({ name, owner_id: userId, type })
        .select('id')
        .single();

      if (gErr) {
        setError('Could not create group: ' + gErr.message);
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
    async updateGroup(groupId, name, type) {
      if (!navigator.onLine) {
        setError("You're offline — creating or changing groups and people needs a connection. Expenses and settlements you add will sync automatically when you're back online.");
        return;
      }

      const { error: gErr } = await supabase
        .from('groups')
        .update({ name, type })
        .eq('id', groupId);

      if (gErr) {
        setError('Could not update group: ' + gErr.message);
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
