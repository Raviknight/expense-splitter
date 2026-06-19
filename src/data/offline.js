// offline.js
// Pure helpers for offline write support: snapshot (last-known data) and
// outbox (queued writes that haven't reached Supabase yet).
//
// Nothing in this file imports React or Supabase — it only uses plain JS so
// every function can be tested in isolation (no mocks needed).
//
// ─── Storage key generators ──────────────────────────────────────────────────
// One snapshot and one outbox per user so a shared device doesn't mix data.

export const SNAPSHOT_KEY = (userId) => `slitab.snapshot.${userId}`;
export const OUTBOX_KEY   = (userId) => `slitab.outbox.${userId}`;

// ─── Snapshot helpers ────────────────────────────────────────────────────────
// The snapshot is the last successfully-fetched groups array (+ activeGroupId).
// Shape stored: { groups: [...], activeGroupId: string|null }
//
// The _nameToMemberId and _memberIdToName maps are plain objects and survive
// JSON round-trips fine.

export function loadSnapshot(userId) {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Basic sanity check.
    if (!parsed || !Array.isArray(parsed.groups)) return null;
    return parsed; // { groups, activeGroupId }
  } catch (_) {
    return null; // private mode or corrupted — degrade gracefully
  }
}

export function saveSnapshot(userId, groups, activeGroupId) {
  try {
    localStorage.setItem(
      SNAPSHOT_KEY(userId),
      JSON.stringify({ groups, activeGroupId })
    );
  } catch (_) {
    // Quota exceeded or private mode — silently skip persistence.
  }
}

export function clearSnapshot(userId) {
  try { localStorage.removeItem(SNAPSHOT_KEY(userId)); } catch (_) {}
}

// ─── Outbox helpers ──────────────────────────────────────────────────────────
// The outbox is a FIFO array of pending write operations.
//
// Each item shape:
//   {
//     opId:    string (randomUUID — also doubles as idempotency key),
//     kind:    'expense.insert' | 'expense.update' | 'expense.delete'
//            | 'settlement.insert' | 'settlement.delete',
//     payload: object (the DB row or { id } for deletes),
//     groupId: string,
//   }

export function loadOutbox(userId) {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function saveOutbox(userId, outbox) {
  try {
    localStorage.setItem(OUTBOX_KEY(userId), JSON.stringify(outbox));
  } catch (_) {}
}

export function clearOutbox(userId) {
  try { localStorage.removeItem(OUTBOX_KEY(userId)); } catch (_) {}
}

// Add one item to the end of the outbox and return the new array.
// (Pure — does NOT write to localStorage; the caller must call saveOutbox.)
export function enqueue(outbox, item) {
  return [...outbox, item];
}

// Remove the item with the given opId and return the new array.
// (Pure — caller must call saveOutbox.)
export function dequeue(outbox, opId) {
  return outbox.filter(item => item.opId !== opId);
}

// ─── Optimistic apply ────────────────────────────────────────────────────────
// Apply a single outbox operation to the in-memory groups array WITHOUT hitting
// the network. Returns a NEW groups array (does not mutate the input).
//
// This is what makes the UI update immediately even when offline.
// It mirrors the shape that fetchAll produces so the UI never sees a difference.

export function applyOpToGroups(groups, op) {
  const { kind, payload, groupId } = op;

  return groups.map(g => {
    if (g.id !== groupId) return g; // not this group — pass through unchanged

    // Work on a copy of the expenses array.
    let expenses = [...g.expenses];

    // Helper: turn a DB `participants` id array into display NAMES, mirroring the
    // read layer in store.js. Falls back to ALL current member names when the
    // payload has no participants (legacy/personal) so the balance math (which
    // splits among `e.participants`) stays correct in the optimistic view too.
    const allNames = g._memberIdToName ? Object.values(g._memberIdToName) : [];
    const participantNames = (ids) => {
      if (Array.isArray(ids) && ids.length > 0) {
        const names = ids.map(id => g._memberIdToName?.[id]).filter(Boolean);
        return names.length > 0 ? names : [...allNames];
      }
      return [...allNames];
    };

    if (kind === 'expense.insert') {
      // Build the same shape fetchAll's .map(e => ...) produces.
      const uiExpense = {
        id:        payload.id,
        name:      payload.name,
        amount:    Number(payload.amount),
        date:      payload.date,
        category:  payload.category,
        paidBy:    g._memberIdToName[payload.paid_by] || 'Unknown',
        splitMode: payload.split_mode,
        note:      payload.note || '',
        // Who this expense is split among (names), so balances are right now.
        participants: participantNames(payload.participants),
        // Mark as a local-only row so we can tell it apart if needed.
        _offline:  true,
      };
      // Prepend (newest first, matching the date-desc order fetchAll uses).
      expenses = [uiExpense, ...expenses];

    } else if (kind === 'expense.update') {
      expenses = expenses.map(e => {
        if (e.id !== payload.id) return e;
        return {
          ...e,
          name:      payload.name,
          amount:    Number(payload.amount),
          date:      payload.date,
          category:  payload.category,
          paidBy:    g._memberIdToName[payload.paid_by] || e.paidBy,
          splitMode: payload.split_mode,
          note:      payload.note || '',
          // If the save included participants (equal/full selection, or custom),
          // reflect the new set; otherwise keep what the expense already had
          // (matches the store: an update omits the column to preserve it).
          participants: ('participants' in payload)
            ? participantNames(payload.participants)
            : e.participants,
          _offline:  true,
        };
      });

    } else if (kind === 'expense.delete') {
      expenses = expenses.filter(e => e.id !== payload.id);

    } else if (kind === 'settlement.insert') {
      // Build the settlement display object fetchAll produces.
      const s = payload;
      const uiSettlement = {
        id:          s.id,
        type:        'settlement',
        date:        s.date,
        name:        `Settlement: ${g._memberIdToName[s.from_member] || '?'} paid ${g._memberIdToName[s.to_member] || '?'}`,
        amount:      Number(s.amount),
        category:    'Other',
        paidBy:      g._memberIdToName[s.from_member] || 'Unknown',
        splitMode:   'full',
        note:        s.note || '',
        _settlementId: s.id,
        _settleFrom: g._memberIdToName[s.from_member] || 'Unknown',
        _settleTo:   g._memberIdToName[s.to_member]   || 'Unknown',
        _offline:    true,
      };
      expenses = [uiSettlement, ...expenses];

    } else if (kind === 'settlement.delete') {
      expenses = expenses.filter(e => e.id !== payload.id);
    }

    return { ...g, expenses };
  });
}

// ─── Network error detection ─────────────────────────────────────────────────
// Distinguish "network is down / offline" from "server rejected the request".
// We treat a request as a network failure when:
//   - navigator.onLine is false, OR
//   - the error is a TypeError (fetch itself threw — no response arrived), OR
//   - the Supabase error has no HTTP status code (connection refused / DNS failure).
//
// A real server error (RLS rejection, constraint violation, etc.) has a non-null
// `status` / `code` field and should NOT be queued — it needs to surface to the user.

export function isNetworkError(err) {
  if (!navigator.onLine) return true;
  if (err instanceof TypeError) return true;
  // Supabase wraps fetch errors; their message includes "fetch failed" or "Failed to fetch".
  if (typeof err?.message === 'string') {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('failed to fetch') ||
      msg.includes('fetch failed') ||
      msg.includes('network request failed') ||
      msg.includes('networkerror') ||
      msg.includes('load failed')   // Safari offline
    ) return true;
  }
  return false;
}

// A 23505 PostgreSQL error means "unique violation" — the row was already
// inserted on a previous sync attempt. Treat it as success and drop the item.
export function isUniqueViolation(err) {
  return (
    err?.code === '23505' ||
    (typeof err?.message === 'string' && err.message.includes('23505'))
  );
}
