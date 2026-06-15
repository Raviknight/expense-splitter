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
// Usage:
//   const { groups, activeGroupId, loading, error, actions } = useExpenseStore(userId, profile);

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient.js';

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
  const [groups, setGroups]           = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  // Keep a stable ref so realtime callbacks can call the latest fetch without
  // being stale-closed over an old version of it.
  const fetchRef = useRef(null);

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
        if (prev && assembled.some(g => g.id === prev)) return prev;
        return assembled[0]?.id ?? null;
      });
    } catch (err) {
      console.error('[store] fetchAll error:', err);
      setError(err.message || 'Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [userId, profile]);

  // Keep the ref current so realtime callbacks always call the latest version.
  fetchRef.current = fetchAll;

  // ── initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetchAll();
  }, [userId, fetchAll]);

  // ── realtime ───────────────────────────────────────────────────────────────
  // Subscribe to all relevant tables. On any change (insert/update/delete)
  // we do a simple full refetch — straightforward and correct.
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('expense-splitter-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' },
        () => fetchRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' },
        () => fetchRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' },
        () => fetchRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' },
        () => fetchRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' },
        () => fetchRef.current())
      .subscribe();

    // Clean up when the user signs out or component unmounts.
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // ── helper: find group ─────────────────────────────────────────────────────
  const findGroup = (groupId) => groups.find(g => g.id === groupId);

  // ── actions ────────────────────────────────────────────────────────────────
  // Each action writes to Supabase using exact schema column names, then
  // triggers a full refetch so local state is always in sync with the DB.

  const actions = {

    // ── Switch active group (local only, no DB call needed) ──────────────────
    switchGroup(groupId) {
      setActiveGroupId(groupId);
    },

    // ── Add or edit an expense ───────────────────────────────────────────────
    // UI shape →  DB columns: name, amount, date, category, paid_by, split_mode, note
    async upsertExpense(groupId, uiExpense) {
      const group = findGroup(groupId);
      if (!group) return;

      // Convert the name string → group_members.id.
      const paidByMemberId = group._nameToMemberId[uiExpense.paidBy];
      if (!paidByMemberId) {
        setError(`Member "${uiExpense.paidBy}" not found in this group.`);
        return;
      }

      const row = {
        group_id:   groupId,
        name:       uiExpense.name,
        amount:     Number(uiExpense.amount),       // numeric(12,2) — must be a Number
        date:       uiExpense.date,                 // 'YYYY-MM-DD'
        category:   uiExpense.category,
        paid_by:    paidByMemberId,                 // group_members.id (UUID)
        split_mode: uiExpense.splitMode,            // 'equal' | 'full' | 'personal'
        note:       uiExpense.note || null,
      };

      let dbError;

      if (uiExpense._isExistingDbRow && uiExpense.id) {
        // Editing an existing DB row — update by id.
        ({ error: dbError } = await supabase
          .from('expenses')
          .update(row)
          .eq('id', uiExpense.id));
      } else {
        // New expense — let the DB generate the UUID via insert.
        ({ error: dbError } = await supabase
          .from('expenses')
          .insert(row));
      }

      if (dbError) {
        setError('Could not save expense: ' + dbError.message);
        return;
      }

      await fetchRef.current();
    },

    // ── Bulk import expenses (from CSV) ──────────────────────────────────────
    // rows  : array of { name, amount, date, category, note } built by csv.js.
    // opts  : { paidByName, splitMode } — applied to EVERY imported row.
    //
    // We resolve the single payer name → group_members.id once, build all DB
    // rows, then insert them in ONE batch for speed. Returns { inserted } on
    // success or { error } so the UI can report the outcome.
    async importExpenses(groupId, rows, { paidByName, splitMode }) {
      const group = findGroup(groupId);
      if (!group) return { error: 'Group not found.' };

      // Resolve the payer's display name → group_members.id (UUID).
      const paidByMemberId = group._nameToMemberId[paidByName];
      if (!paidByMemberId) {
        const msg = `Member "${paidByName}" not found in this group.`;
        setError(msg);
        return { error: msg };
      }

      if (!rows || rows.length === 0) {
        return { inserted: 0 };
      }

      // Build DB rows using EXACT schema column names.
      const dbRows = rows.map(r => ({
        group_id:   groupId,
        name:       r.name,
        amount:     Number(r.amount),       // numeric(12,2) — must be a Number
        date:       r.date,                 // 'YYYY-MM-DD'
        category:   r.category || 'Other',
        paid_by:    paidByMemberId,         // group_members.id (UUID)
        split_mode: splitMode,              // 'equal' | 'full' | 'personal'
        note:       r.note || null,
      }));

      // One batch insert for all rows.
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

    // ── Delete an expense ────────────────────────────────────────────────────
    async deleteExpense(groupId, expenseId, isSettlement) {
      let dbError;

      if (isSettlement) {
        // Settlements live in the settlements table, not expenses.
        ({ error: dbError } = await supabase
          .from('settlements')
          .delete()
          .eq('id', expenseId));
      } else {
        ({ error: dbError } = await supabase
          .from('expenses')
          .delete()
          .eq('id', expenseId));
      }

      if (dbError) {
        setError('Could not delete: ' + dbError.message);
        return;
      }

      await fetchRef.current();
    },

    // ── Create a new group ───────────────────────────────────────────────────
    // Inserts into `groups`, then inserts the owner as a group_members row
    // (user_id = userId). Any extra people typed in the form become ghost
    // members (ghost_name set, user_id null).
    async createGroup(name, type, extraPeopleNames) {
      // Insert the group row.
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

      // Insert the owner's own member row (real user, not a ghost).
      const memberRows = [{ group_id: newGroupId, user_id: userId }];

      // Extra people (typed names) become ghost members.
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
        // Group was created; still refetch so user sees it.
      }

      await fetchRef.current();
      setActiveGroupId(newGroupId);
      return newGroupId;
    },

    // ── Edit an existing group's name/type ───────────────────────────────────
    // The UI currently only edits name and type (people are managed separately).
    async updateGroup(groupId, name, type) {
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
    // The DB schema has ON DELETE CASCADE so members/expenses/settlements are
    // removed automatically.
    async deleteGroup(groupId) {
      const { error: gErr } = await supabase
        .from('groups')
        .delete()
        .eq('id', groupId);

      if (gErr) {
        setError('Could not delete group: ' + gErr.message);
        return;
      }

      // After delete, refetch. The setActiveGroupId inside fetchAll will
      // automatically pick the first remaining group if the deleted one was active.
      await fetchRef.current();
    },

    // ── Record a settlement ──────────────────────────────────────────────────
    // Inserts into `settlements` table.
    // from_member and to_member are group_members UUIDs.
    async recordSettlement(groupId, { from, to, amount, note }) {
      const group = findGroup(groupId);
      if (!group) return;

      const fromMemberId = group._nameToMemberId[from];
      const toMemberId   = group._nameToMemberId[to];

      if (!fromMemberId || !toMemberId) {
        setError('Could not find member for settlement.');
        return;
      }

      const { error: sErr } = await supabase
        .from('settlements')
        .insert({
          group_id:    groupId,
          from_member: fromMemberId,   // group_members.id
          to_member:   toMemberId,     // group_members.id
          amount:      Number(amount),
          date:        new Date().toISOString().slice(0, 10),
          note:        note || null,
        });

      if (sErr) {
        setError('Could not record settlement: ' + sErr.message);
        return;
      }

      await fetchRef.current();
    },

    // ── Add a person (ghost member) to an existing group ─────────────────────
    // Inserts a group_members row with ghost_name set and user_id null.
    // The DB check constraint (user_id IS NOT NULL) XOR (ghost_name IS NOT NULL)
    // is satisfied because we only set ghost_name here.
    async addPersonToGroup(groupId, personName) {
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
    // Maps the display-name → group_members.id via the group's _nameToMemberId
    // map, then deletes that single row.
    //
    // GUARD: we do NOT allow removing yourself (the current signed-in user).
    // This prevents the owner from losing access to their own group by accident.
    // The owner's group_members row has user_id === userId.
    async removePersonFromGroup(groupId, personName) {
      const group = findGroup(groupId);
      if (!group) return;

      // Look up the group_members row id for this display-name.
      const memberId = group._nameToMemberId[personName];
      if (!memberId) {
        setError(`Could not find member "${personName}" to remove.`);
        return;
      }

      // Guard: refuse to remove the current user's own member row.
      // _memberMeta tracks isGhost; real members have user_id set.
      // We compare memberId against the owner's own member id by checking
      // whether the meta entry is NOT a ghost AND the name matches the profile.
      const meta = group._memberMeta?.[personName];
      if (meta && !meta.isGhost) {
        // Real (connected) user — do not allow removal via this UI.
        // The only real member the owner can manage here is other connected
        // users; but the safest guard is to block removing ANY non-ghost,
        // which covers the owner themselves.
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

    // ── Clear any error (used by retry buttons) ──────────────────────────────
    clearError() {
      setError(null);
    },

    // ── Retry: just re-run fetchAll ──────────────────────────────────────────
    async retry() {
      setLoading(true);
      setError(null);
      await fetchAll();
    },
  };

  return { groups, activeGroupId, loading, error, actions };
}
