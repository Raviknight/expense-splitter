import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Pencil, Trash2, X, ArrowDownUp, Receipt, Users, PieChart, Search,
  ChevronDown, ChevronRight, Check, ArrowLeft, Handshake, User,
  AlertCircle, RefreshCw, UserPlus, Ghost,
} from 'lucide-react';
import { useAuth } from './auth/AuthProvider.jsx';
import { useExpenseStore } from './data/store.js';

/* ============ Categories & auto-categorization ============ */

const CATEGORIES = [
  { name: 'Lodging',        emoji: '🏨', tone: 'bg-violet-50 text-violet-800 border-violet-200' },
  { name: 'Car Rental',     emoji: '🚗', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  { name: 'Fuel',           emoji: '⛽', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  { name: 'Tolls',          emoji: '🛣️', tone: 'bg-orange-50 text-orange-800 border-orange-200' },
  { name: 'Parking',        emoji: '🅿️', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  { name: 'Attractions',    emoji: '🎫', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  { name: 'Restaurants',    emoji: '🍽️', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
  { name: 'Groceries',      emoji: '🛒', tone: 'bg-lime-50 text-lime-800 border-lime-200' },
  { name: 'Convenience',    emoji: '🏪', tone: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  { name: 'Pharmacy',       emoji: '💊', tone: 'bg-teal-50 text-teal-800 border-teal-200' },
  { name: 'Transportation', emoji: '🚕', tone: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  { name: 'Auto Service',   emoji: '🔧', tone: 'bg-slate-100 text-slate-800 border-slate-200' },
  { name: 'Government',     emoji: '🏛️', tone: 'bg-stone-100 text-stone-800 border-stone-200' },
  { name: 'Shopping',       emoji: '🛍️', tone: 'bg-pink-50 text-pink-800 border-pink-200' },
  { name: 'Other',          emoji: '📌', tone: 'bg-gray-100 text-gray-700 border-gray-200' },
];

const catMeta = (name) => CATEGORIES.find(c => c.name === name) || CATEGORIES[CATEGORIES.length - 1];

const RULES = [
  { cat: 'Lodging',        kws: ['airbnb', 'booking', 'hotel', ' inn ', 'inn ', ' inn', 'motel', 'resort', 'lodge', 'marriott', 'hilton', 'hyatt', 'sheraton'] },
  { cat: 'Car Rental',     kws: ['budget car', 'budget rental', 'hertz', 'avis', 'enterprise rent', 'car rental', 'sixt', 'alamo', 'national rent'] },
  { cat: 'Auto Service',   kws: ['toyota', 'honda dealer', 'service center', 'oil change', 'jiffy lube', 'mavis', 'midas'] },
  { cat: 'Tolls',          kws: ['ezpass', 'e-zpass', 'turnpike', 'toll'] },
  { cat: 'Parking',        kws: ['nycdot', 'park*meter', 'parking', 'paybyphone', ' park '] },
  { cat: 'Fuel',           kws: ['exxon', 'sunoco', 'shell oil', 'shell gas', 'chevron', 'bp #', 'bp gas', 'gulf', 'speedway', 'wawa gas', 'valero', 'citgo'] },
  { cat: 'Attractions',    kws: ['amnh', 'museum', 'observatory', 'state park', 'maid of the mist', 'whiteface', 'natl park', 'national park', 'letchworth', 'watkins glen', 'aquarium', 'zoo', 'liberty isl'] },
  { cat: 'Restaurants',    kws: ['subway', 'dunkin', 'starbucks', 'mcdonald', 'chipotle', 'taco bell', 'kitchen', 'tandoori', 'restaurant', 'cafe', 'diner', 'pizza', 'bbq', 'aksharpith', 'panera', 'burger', 'noodle', 'curry', 'biryani'] },
  { cat: 'Groceries',      kws: ['wm supercenter', 'walmart supercenter', 'hannaford', 'seabra', 'food bazaar', 'wegmans', 'shoprite', 'kroger', 'whole foods', 'aldi', 'patel brothers', 'h mart', 'trader joe'] },
  { cat: 'Convenience',    kws: ['7-eleven', '7 eleven', 'refuel ', 'cumberland farm', 'sheetz'] },
  { cat: 'Pharmacy',       kws: ['walgreens', 'rite aid', 'cvs pharmacy', 'pharmacy'] },
  { cat: 'Transportation', kws: ['uber', 'lyft', 'taxi', 'amtrak', 'njt', 'nj transit', 'path', 'mta'] },
  { cat: 'Government',     kws: ['munic', 'dmv', 'court', 'irs', 'usps'] },
  { cat: 'Shopping',       kws: ['walmart', 'wal-mart', 'target', 'costco', 'best buy', 'home depot', 'lowes'] },
];

function autoCategorize(name) {
  const lower = ' ' + name.toLowerCase() + ' ';
  for (const r of RULES) {
    if (r.kws.some(k => lower.includes(k))) return r.cat;
  }
  return 'Other';
}

const SPLIT_MODES = [
  { id: 'equal',    label: 'Equal',    desc: 'Split 50/50' },
  { id: 'full',     label: 'Full',     desc: 'Other person owes it all' },
  { id: 'personal', label: 'Personal', desc: 'No split — payer keeps it' },
];

const fmt = (n) => '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* ============ App ============ */

export default function App() {
  // Get the signed-in user's id and profile from the auth layer.
  const { user, profile } = useAuth();

  // Load all data from Supabase. The store returns the same shape the UI
  // already knows how to render, so minimal UI changes are needed.
  const { groups, activeGroupId, loading, error, actions } = useExpenseStore(
    user?.id,
    profile,
  );

  const [tab, setTab] = useState('expenses');
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('All');
  const [sortBy, setSortBy] = useState('date');

  const [editing, setEditing] = useState(null);
  const [showGroups, setShowGroups] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(null);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-stone-200 border-t-stone-600 animate-spin" />
          <div className="text-stone-500 text-sm">Loading your groups…</div>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error && groups.length === 0) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white border border-red-200 rounded-2xl p-6 text-center shadow-sm">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <div className="font-semibold text-stone-900 mb-1">Something went wrong</div>
          <div className="text-sm text-stone-600 mb-4">{error}</div>
          <button
            onClick={actions.retry}
            className="flex items-center gap-2 justify-center w-full py-2.5 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Empty state: signed-in user with no groups yet ────────────────────────
  if (!loading && groups.length === 0) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <div className="text-5xl mb-4">🗂️</div>
          <div className="font-semibold text-stone-900 text-lg mb-2">No groups yet</div>
          <div className="text-sm text-stone-500 mb-6">
            Create your first group to start tracking shared expenses.
          </div>
          <button
            onClick={() => setShowGroups(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800"
          >
            <Plus className="w-4 h-4" />
            Create a group
          </button>

          {/* Still render the GroupsModal so the user can create from here */}
          {showGroups && (
            <GroupsModal
              groups={groups}
              activeGroupId={activeGroupId}
              myName={profile?.display_name || 'Me'}
              onClose={() => setShowGroups(false)}
              onSwitch={(id) => { actions.switchGroup(id); setShowGroups(false); }}
              onCreateGroup={async (name, type, extraPeople) => {
                await actions.createGroup(name, type, extraPeople);
                setShowGroups(false);
              }}
              onUpdateGroup={async (groupId, name, type) => {
                await actions.updateGroup(groupId, name, type);
              }}
              onRequestDelete={(g) => setConfirmDeleteGroup(g)}
              onAddPerson={async (groupId, personName) => {
                await actions.addPersonToGroup(groupId, personName);
              }}
              onRemovePerson={async (groupId, personName) => {
                await actions.removePersonFromGroup(groupId, personName);
              }}
            />
          )}

          {confirmDeleteGroup && (
            <ConfirmDialog
              title={`Delete "${confirmDeleteGroup.name}"?`}
              message={`This will permanently remove the group and all its expenses.`}
              confirmLabel="Delete group"
              onCancel={() => setConfirmDeleteGroup(null)}
              onConfirm={async () => {
                await actions.deleteGroup(confirmDeleteGroup.id);
                setConfirmDeleteGroup(null);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  // ── Normal state: at least one group exists ────────────────────────────────
  const activeGroup = groups.find(g => g.id === activeGroupId) || groups[0];
  const people = activeGroup?.people || [];
  const isSolo = people.length === 1;
  const expenses = activeGroup?.expenses || [];
  const realExpenses = expenses.filter(e => e.type !== 'settlement');

  /* ----- Derived ----- */
  const total = realExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  const { balances, sharedPool } = (() => {
    if (isSolo) {
      return {
        balances: [{ name: people[0], paid: total, share: total, net: 0 }],
        sharedPool: 0,
      };
    }
    const paid = Object.fromEntries(people.map(p => [p, 0]));
    const owed = Object.fromEntries(people.map(p => [p, 0]));
    let shared = 0;
    expenses.forEach(e => {
      const amt = Number(e.amount || 0);
      const mode = e.splitMode || 'equal';
      paid[e.paidBy] = (paid[e.paidBy] || 0) + amt;
      if (mode === 'personal') {
        owed[e.paidBy] = (owed[e.paidBy] || 0) + amt;
      } else if (mode === 'full') {
        people.forEach(p => { if (p !== e.paidBy) owed[p] = (owed[p] || 0) + amt; });
        if (e.type !== 'settlement') shared += amt;
      } else {
        const share = amt / people.length;
        people.forEach(p => { owed[p] = (owed[p] || 0) + share; });
        shared += amt;
      }
    });
    return {
      balances: people.map(p => ({ name: p, paid: paid[p], share: owed[p], net: paid[p] - owed[p] })),
      sharedPool: shared,
    };
  })();

  /* ----- Filter, sort, group ----- */
  const filtered = (() => {
    let list = expenses;
    if (filterCat !== 'All') list = list.filter(e => e.category === filterCat);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => (e.name || '').toLowerCase().includes(q) || (e.category || '').toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'amount') return Number(b.amount) - Number(a.amount);
      return (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || '');
    });
    return list;
  })();

  const grouped = (() => {
    if (sortBy === 'amount') return [['All', filtered]];
    const g = {};
    filtered.forEach(e => { (g[e.date] = g[e.date] || []).push(e); });
    return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  /* ----- Mutations — delegate to store actions ----- */

  const upsertExpense = async (uiExpense) => {
    await actions.upsertExpense(activeGroup.id, uiExpense);
    setEditing(null);
  };

  const removeExpense = async (id) => {
    // Work out whether this id belongs to a settlement or a regular expense.
    const item = expenses.find(e => e.id === id);
    const isSettlement = item?.type === 'settlement';
    await actions.deleteExpense(activeGroup.id, id, isSettlement);
  };

  const switchGroup = (groupId) => {
    actions.switchGroup(groupId);
    setShowGroups(false);
    setFilterCat('All');
    setSearch('');
    setTab('expenses');
  };

  const recordSettlement = async ({ from, to, amount, note }) => {
    await actions.recordSettlement(activeGroup.id, { from, to, amount, note });
    setShowSettle(false);
  };

  const deleteGroup = async (groupId) => {
    await actions.deleteGroup(groupId);
    setConfirmDeleteGroup(null);
  };

  /* ----- Tabs (conditional on solo) ----- */
  const tabs = isSolo
    ? [
        { id: 'expenses',   label: 'Expenses',   icon: Receipt },
        { id: 'categories', label: 'Categories', icon: PieChart },
      ]
    : [
        { id: 'expenses',   label: 'Expenses',   icon: Receipt },
        { id: 'categories', label: 'Categories', icon: PieChart },
        { id: 'summary',    label: 'Settle Up',  icon: Handshake },
      ];

  return (
    <div className="min-h-screen bg-[#FAFAF7] text-stone-900" style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>

      {/* Non-blocking error banner — shown when a write fails but data is loaded */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center gap-3 max-w-3xl mx-auto">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <div className="text-sm text-red-800 flex-1">{error}</div>
          <button
            onClick={actions.clearError}
            className="text-xs text-red-600 underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <header className="sticky top-0 z-20 bg-[#FAFAF7]/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <button onClick={() => setShowGroups(true)} className="text-left min-w-0 group">
              <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500 font-medium flex items-center gap-1">
                {isSolo ? <><User className="w-3 h-3" /> Personal</> : <><Users className="w-3 h-3" /> {people.join(' & ')}</>}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <h1 className="text-xl font-semibold truncate">{activeGroup.name}</h1>
                <ChevronDown className="w-4 h-4 text-stone-400 group-hover:text-stone-700 shrink-0" />
              </div>
            </button>
            <div className="text-right shrink-0">
              <div className="text-[11px] uppercase tracking-[0.14em] text-stone-500">Total</div>
              <div className="text-lg font-semibold tabular-nums">{fmt(total)}</div>
            </div>
          </div>

          {isSolo ? (
            <SoloStrip expenses={realExpenses} total={total} />
          ) : (
            <BalanceStrip balances={balances} />
          )}

          <nav className="mt-3 flex gap-1 text-sm">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition ${
                  tab === t.id ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                <t.icon className="w-4 h-4" />
                <span className="font-medium">{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-4 pb-32">
        {tab === 'expenses' && (
          <ExpensesTab
            grouped={grouped}
            count={filtered.length}
            visibleTotal={filtered.filter(e => e.type !== 'settlement').reduce((s, e) => s + Number(e.amount || 0), 0)}
            search={search} setSearch={setSearch}
            filterCat={filterCat} setFilterCat={setFilterCat}
            sortBy={sortBy} setSortBy={setSortBy}
            onEdit={setEditing}
            onDelete={removeExpense}
            isSolo={isSolo}
          />
        )}
        {tab === 'categories' && (
          <CategoriesTab
            expenses={realExpenses}
            total={total}
            onPick={(c) => { setFilterCat(c); setTab('expenses'); }}
          />
        )}
        {tab === 'summary' && !isSolo && (
          <SummaryTab
            expenses={realExpenses}
            settlements={expenses.filter(e => e.type === 'settlement')}
            balances={balances}
            sharedPool={sharedPool}
            total={total}
            people={people}
            onSettle={() => setShowSettle(true)}
          />
        )}
      </main>

      {/* FAB */}
      <button
        onClick={() => setEditing('new')}
        className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-stone-900 text-white shadow-lg hover:bg-stone-800 active:scale-95 transition flex items-center justify-center"
        aria-label="Add expense"
      >
        <Plus className="w-6 h-6" />
      </button>

      {editing && (
        <ExpenseModal
          expense={editing === 'new' ? null : editing}
          people={people}
          isSolo={isSolo}
          onClose={() => setEditing(null)}
          onSave={upsertExpense}
        />
      )}

      {showGroups && (
        <GroupsModal
          groups={groups}
          activeGroupId={activeGroupId}
          myName={profile?.display_name || 'Me'}
          onClose={() => setShowGroups(false)}
          onSwitch={switchGroup}
          onCreateGroup={async (name, type, extraPeople) => {
            await actions.createGroup(name, type, extraPeople);
            setShowGroups(false);
          }}
          onUpdateGroup={async (groupId, name, type) => {
            await actions.updateGroup(groupId, name, type);
          }}
          onRequestDelete={(g) => setConfirmDeleteGroup(g)}
          onAddPerson={async (groupId, personName) => {
            await actions.addPersonToGroup(groupId, personName);
          }}
          onRemovePerson={async (groupId, personName) => {
            await actions.removePersonFromGroup(groupId, personName);
          }}
        />
      )}

      {showSettle && (
        <SettleModal
          balances={balances}
          people={people}
          onClose={() => setShowSettle(false)}
          onConfirm={recordSettlement}
        />
      )}

      {confirmDeleteGroup && (
        <ConfirmDialog
          title={`Delete "${confirmDeleteGroup.name}"?`}
          message={`This will permanently remove the group and all ${
            (confirmDeleteGroup.expenses || []).length
          } expense${(confirmDeleteGroup.expenses || []).length === 1 ? '' : 's'} in it.`}
          confirmLabel="Delete group"
          onCancel={() => setConfirmDeleteGroup(null)}
          onConfirm={() => deleteGroup(confirmDeleteGroup.id)}
        />
      )}
    </div>
  );
}

/* ============ Header strips ============ */

function BalanceStrip({ balances }) {
  // For exactly 2 members keep the original compact layout.
  // For 3+ members (possible when ghost members are added) show a scrollable
  // row of "name paid X" tiles and a "who owes most" summary on the right.
  if (balances.length === 2) {
    const a = balances[0];
    const b = balances[1];
    const settleAmt = Math.abs(a.net);
    return (
      <div className="mt-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-stone-500">{a.name} paid</div>
            <div className="font-semibold tabular-nums">{fmt(a.paid)}</div>
          </div>
          <div className="w-px h-8 bg-stone-200" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-stone-500">{b.name} paid</div>
            <div className="font-semibold tabular-nums">{fmt(b.paid)}</div>
          </div>
        </div>
        {settleAmt > 0.005 ? (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-stone-500">Settle</div>
            <div className="font-semibold text-emerald-700 tabular-nums">
              {a.net > 0 ? `${b.name} → ${a.name}` : `${a.name} → ${b.name}`} {fmt(settleAmt)}
            </div>
          </div>
        ) : (
          <div className="text-emerald-700 font-medium text-xs">Settled</div>
        )}
      </div>
    );
  }

  // Multi-member (3+): scrollable row of tiles.
  // Find the person who owes the most (most negative net).
  const biggestDebtor = [...balances].sort((a, b) => a.net - b.net)[0];
  const allSettled = balances.every(b => Math.abs(b.net) < 0.005);
  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm">
      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        {balances.map((b, i) => (
          <div key={b.name} className="shrink-0 flex items-center gap-3">
            {i > 0 && <div className="w-px h-8 bg-stone-200" />}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 truncate max-w-[80px]">{b.name} paid</div>
              <div className="font-semibold tabular-nums">{fmt(b.paid)}</div>
            </div>
          </div>
        ))}
        <div className="w-px h-8 bg-stone-200 shrink-0" />
        <div className="shrink-0 text-right">
          {allSettled ? (
            <div className="text-emerald-700 font-medium text-xs">Settled</div>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wider text-stone-500">Most owes</div>
              <div className="font-semibold text-red-700 tabular-nums">
                {biggestDebtor.name} {fmt(Math.abs(biggestDebtor.net))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SoloStrip({ expenses, total }) {
  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 flex items-center justify-between text-sm">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-stone-500">Tracked</div>
        <div className="font-semibold tabular-nums">{expenses.length} {expenses.length === 1 ? 'item' : 'items'}</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-stone-500">Spent</div>
        <div className="font-semibold tabular-nums">{fmt(total)}</div>
      </div>
    </div>
  );
}

/* ============ Tabs ============ */

function ExpensesTab({ grouped, count, visibleTotal, search, setSearch, filterCat, setFilterCat, sortBy, setSortBy, onEdit, onDelete, isSolo }) {
  return (
    <div>
      <div className="space-y-2 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or category"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-stone-200 bg-white text-sm focus:outline-none focus:border-stone-400"
          />
        </div>
        <div className="flex gap-2 items-center overflow-x-auto -mx-1 px-1 pb-1">
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-full border border-stone-300 bg-white shrink-0"
          >
            <option value="All">All categories</option>
            {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
          </select>
          <button
            onClick={() => setSortBy(sortBy === 'date' ? 'amount' : 'date')}
            className="text-xs px-2.5 py-1.5 rounded-full border border-stone-300 bg-white shrink-0 flex items-center gap-1"
          >
            <ArrowDownUp className="w-3 h-3" />
            {sortBy === 'date' ? 'Date' : 'Amount'}
          </button>
          <div className="text-xs text-stone-500 ml-auto shrink-0 tabular-nums">
            {count} {count === 1 ? 'item' : 'items'} · {fmt(visibleTotal)}
          </div>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="text-center py-16 text-stone-500">
          <div className="text-4xl mb-3">🧾</div>
          <div className="text-sm font-medium">No expenses yet</div>
          <div className="text-xs mt-1">Tap the + button to add your first one.</div>
        </div>
      ) : grouped.map(([date, list]) => (
        <section key={date} className="mb-4">
          <div className="px-1 py-1.5 text-[11px] uppercase tracking-wider text-stone-500 font-medium">
            {date === 'All' ? `${list.length} results` : formatDay(date)}
          </div>
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
            {list.map(e => (
              <ExpenseRow key={e.id} e={e} onEdit={() => onEdit(e)} onDelete={() => onDelete(e.id)} isSolo={isSolo} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ExpenseRow({ e, onEdit, onDelete, isSolo }) {
  const isSettle = e.type === 'settlement';
  const meta = catMeta(e.category);
  const mode = e.splitMode || 'equal';
  const modeMeta = SPLIT_MODES.find(m => m.id === mode);
  const modeTone = mode === 'personal'
    ? 'bg-stone-900 text-white border-stone-900'
    : 'bg-emerald-700 text-white border-emerald-700';

  if (isSettle) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50/40">
        <div className="text-xl shrink-0 w-8 text-center">🤝</div>
        <button onClick={onEdit} className="flex-1 min-w-0 text-left">
          <div className="font-medium text-sm truncate text-emerald-900">{e.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-700 text-white border-emerald-700">Settlement</span>
            {e.note && <span className="text-[10px] text-stone-500 truncate">{e.note}</span>}
          </div>
        </button>
        <div className="text-right shrink-0">
          <div className="font-semibold tabular-nums text-sm text-emerald-900">{fmt(Number(e.amount || 0))}</div>
        </div>
        <button onClick={onDelete} className="p-1.5 text-stone-400 hover:text-red-600 rounded shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 group">
      <div className="text-xl shrink-0 w-8 text-center">{meta.emoji}</div>
      <button onClick={onEdit} className="flex-1 min-w-0 text-left">
        <div className="font-medium text-sm truncate">{e.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.tone}`}>{e.category}</span>
          {!isSolo && mode !== 'equal' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${modeTone}`}>{modeMeta.label}</span>
          )}
          {e.note && <span className="text-[10px] text-stone-500 truncate">{e.note}</span>}
        </div>
      </button>
      <div className="text-right shrink-0">
        <div className="font-semibold tabular-nums text-sm">{fmt(Number(e.amount || 0))}</div>
        {!isSolo && <div className="text-[10px] text-stone-500">paid · {e.paidBy}</div>}
      </div>
      <div className="flex gap-0.5 shrink-0">
        <button onClick={onEdit} className="p-1.5 text-stone-400 hover:text-stone-700 rounded">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} className="p-1.5 text-stone-400 hover:text-red-600 rounded">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function CategoriesTab({ expenses, total, onPick }) {
  const byCategory = useMemo(() => {
    const m = {};
    expenses.forEach(e => { m[e.category] = (m[e.category] || 0) + Number(e.amount || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  if (total === 0) return (
    <div className="text-center py-12 text-stone-500">
      <div className="text-sm">No expenses yet.</div>
      <div className="text-xs mt-1">Add expenses to see category breakdown.</div>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium px-1 pb-1">
        Spending by category
      </div>
      {byCategory.map(([cat, amt]) => {
        const meta = catMeta(cat);
        const pct = (amt / total) * 100;
        return (
          <button
            key={cat}
            onClick={() => onPick(cat)}
            className="w-full bg-white border border-stone-200 rounded-xl p-3 hover:border-stone-400 transition text-left"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-lg">{meta.emoji}</span>
                <span className="font-medium text-sm">{cat}</span>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums text-sm">{fmt(amt)}</div>
                <div className="text-[10px] text-stone-500 tabular-nums">{pct.toFixed(1)}%</div>
              </div>
            </div>
            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full bg-stone-900 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SummaryTab({ expenses, settlements, balances, sharedPool, total, people, onSettle }) {
  const a = balances[0];
  const settleAmt = Math.abs(a.net);
  const personalTotal = total - sharedPool;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium mb-3">Trip total</div>
        <div className="text-3xl font-semibold tabular-nums mb-1">{fmt(total)}</div>
        <div className="text-sm text-stone-500">
          {expenses.length} expenses
          {settlements.length > 0 && ` · ${settlements.length} settlement${settlements.length === 1 ? '' : 's'}`}
        </div>
        {personalTotal > 0 && (
          <div className="mt-3 pt-3 border-t border-stone-100 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-stone-500">Shared pool</div>
              <div className="font-semibold tabular-nums text-sm mt-0.5">{fmt(sharedPool)}</div>
            </div>
            <div>
              <div className="text-stone-500">Personal (not split)</div>
              <div className="font-semibold tabular-nums text-sm mt-0.5">{fmt(personalTotal)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100">
        {balances.map(b => (
          <div key={b.name} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{b.name}</div>
              <div className="text-xs text-stone-500 mt-0.5">
                Paid {fmt(b.paid)} · Owes {fmt(b.share)}
              </div>
            </div>
            <div className={`text-right tabular-nums font-semibold ${b.net > 0 ? 'text-emerald-700' : b.net < 0 ? 'text-red-700' : 'text-stone-500'}`}>
              {b.net > 0 ? '+' : ''}{fmt(b.net)}
              <div className="text-[10px] font-normal text-stone-500 uppercase tracking-wider mt-0.5">
                {b.net > 0 ? 'is owed' : b.net < 0 ? 'owes' : 'even'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-stone-900 text-white rounded-xl p-4">
        <div className="text-[11px] uppercase tracking-wider text-stone-400 font-medium mb-2">Settle up</div>
        {settleAmt > 0.005 ? (
          <>
            <div className="text-lg font-semibold">
              {a.net > 0 ? `${balances[1].name} pays ${a.name}` : `${a.name} pays ${balances[1].name}`}
            </div>
            <div className="text-3xl font-semibold tabular-nums mt-1 mb-3">{fmt(settleAmt)}</div>
            <button
              onClick={onSettle}
              className="w-full py-2.5 rounded-lg bg-white text-stone-900 text-sm font-medium hover:bg-stone-100 active:scale-[0.99] transition flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Mark as settled
            </button>
          </>
        ) : (
          <div className="text-lg font-semibold">All settled.</div>
        )}
      </div>

      {settlements.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 text-[11px] uppercase tracking-wider text-stone-500 font-medium border-b border-stone-100">
            Settlement history
          </div>
          {settlements.slice().sort((a, b) => b.date.localeCompare(a.date)).map(s => (
            <div key={s.id} className="px-4 py-2.5 text-sm flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-medium truncate">{s.name}</div>
                <div className="text-[11px] text-stone-500">{formatDay(s.date)}</div>
              </div>
              <div className="font-semibold tabular-nums text-emerald-700 shrink-0">{fmt(s.amount)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ Groups modal ============ */

function GroupsModal({ groups, activeGroupId, myName, onClose, onSwitch, onCreateGroup, onUpdateGroup, onRequestDelete, onAddPerson, onRemovePerson }) {
  // view can be: 'list' | 'form' | 'members'
  const [view, setView] = useState('list');
  const [editingGroup, setEditingGroup] = useState(null);
  // managingGroup is set when the user opens the Members panel for a group.
  const [managingGroup, setManagingGroup] = useState(null);
  // State for confirming ghost removal.
  const [confirmRemoveMember, setConfirmRemoveMember] = useState(null); // { group, personName }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-stone-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          {view === 'form' ? (
            <button onClick={() => { setView('list'); setEditingGroup(null); }} className="flex items-center gap-1.5 text-sm font-medium text-stone-700">
              <ArrowLeft className="w-4 h-4" />
              {editingGroup ? 'Edit group' : 'New group'}
            </button>
          ) : view === 'members' ? (
            <button onClick={() => { setView('list'); setManagingGroup(null); }} className="flex items-center gap-1.5 text-sm font-medium text-stone-700">
              <ArrowLeft className="w-4 h-4" />
              Members
            </button>
          ) : (
            <h2 className="font-semibold">Your groups</h2>
          )}
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {view === 'list' ? (
          <>
            <div className="p-3 space-y-2">
              {groups.length === 0 && (
                <div className="text-center py-8 text-stone-500 text-sm">
                  No groups yet. Create one below.
                </div>
              )}
              {groups.map(g => {
                const isActive = g.id === activeGroupId;
                const isSolo = g.people.length === 1;
                const expenseCount = (g.expenses || []).filter(e => e.type !== 'settlement').length;
                const expenseTotal = (g.expenses || [])
                  .filter(e => e.type !== 'settlement')
                  .reduce((s, e) => s + Number(e.amount || 0), 0);
                return (
                  <div
                    key={g.id}
                    className={`border rounded-xl p-3 transition ${
                      isActive ? 'border-stone-900 bg-stone-50' : 'border-stone-200 bg-white hover:border-stone-400'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button onClick={() => onSwitch(g.id)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-stone-500">
                          {isSolo ? <><User className="w-3 h-3" /> Personal</> : <><Users className="w-3 h-3" /> {g.people.join(' & ')}</>}
                        </div>
                        <div className="font-medium mt-0.5 truncate">{g.name}</div>
                        <div className="text-xs text-stone-500 mt-0.5 tabular-nums">
                          {expenseCount} {expenseCount === 1 ? 'item' : 'items'} · {fmt(expenseTotal)}
                        </div>
                      </button>
                      <div className="flex flex-col gap-1 shrink-0">
                        {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-900 text-white">Active</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2 pt-2 border-t border-stone-100">
                      <button
                        onClick={() => { setEditingGroup(g); setView('form'); }}
                        className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                      {/* Show People button for shared groups so the owner can manage members */}
                      {!isSolo && (
                        <button
                          onClick={() => { setManagingGroup(g); setView('members'); }}
                          className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1"
                        >
                          <Users className="w-3 h-3" /> People
                        </button>
                      )}
                      {groups.length > 1 && (
                        <button
                          onClick={() => onRequestDelete(g)}
                          className="text-xs text-stone-600 hover:text-red-600 flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      )}
                      {!isActive && (
                        <button
                          onClick={() => onSwitch(g.id)}
                          className="text-xs text-emerald-700 hover:text-emerald-900 flex items-center gap-1 ml-auto"
                        >
                          Open <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-stone-200 p-3">
              <button
                onClick={() => { setEditingGroup(null); setView('form'); }}
                className="w-full py-2.5 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                New group
              </button>
            </div>
          </>
        ) : view === 'members' && managingGroup ? (
          // ── Members management panel ────────────────────────────────────────
          // Find the freshest copy of this group from the groups list (it
          // re-renders after each add/remove because fetchAll refetches).
          <MembersPanel
            group={groups.find(g => g.id === managingGroup.id) || managingGroup}
            myName={myName}
            onAddPerson={(name) => onAddPerson(managingGroup.id, name)}
            onRequestRemove={(personName) =>
              setConfirmRemoveMember({ group: managingGroup, personName })
            }
          />
        ) : (
          <GroupForm
            group={editingGroup}
            myName={myName}
            onSave={async (groupData) => {
              if (editingGroup) {
                // Editing an existing group — only name and type can change.
                await onUpdateGroup(editingGroup.id, groupData.name, groupData.type);
              } else {
                // Creating a new group.
                await onCreateGroup(groupData.name, groupData.type, groupData.extraPeople || []);
              }
              setView('list');
              setEditingGroup(null);
            }}
            onCancel={() => { setView('list'); setEditingGroup(null); }}
          />
        )}
      </div>

      {/* Confirm dialog for removing a ghost member — rendered at z-50 above the modal */}
      {confirmRemoveMember && (
        <ConfirmDialog
          title={`Remove "${confirmRemoveMember.personName}"?`}
          message={`They will no longer appear in this group. Any expenses they are part of will still show their name.`}
          confirmLabel="Remove"
          onCancel={() => setConfirmRemoveMember(null)}
          onConfirm={async () => {
            await onRemovePerson(confirmRemoveMember.group.id, confirmRemoveMember.personName);
            setConfirmRemoveMember(null);
          }}
        />
      )}
    </div>
  );
}

/* ============ Members panel (inside GroupsModal) ============
 *
 * Shows all members of a shared group with badges:
 *   "you"   — the signed-in owner
 *   (no badge) — real connected user
 *   "not on app" — ghost member (ghost_name set, user_id null)
 *
 * Lets the owner:
 *   - Add a new ghost by typing a name (calls onAddPerson)
 *   - Remove a ghost (calls onRequestRemove, which triggers a ConfirmDialog)
 *
 * Real connected members (non-ghost) cannot be removed here — the remove
 * button is absent for them, keeping the UX simple and safe.
 */
function MembersPanel({ group, myName, onAddPerson, onRequestRemove }) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setAdding(true);
    await onAddPerson(trimmed);
    setNewName('');
    setAdding(false);
  };

  const people = group?.people || [];
  const memberMeta = group?._memberMeta || {};

  return (
    <div>
      <div className="p-4 space-y-4">
        {/* Section title */}
        <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">
          {people.length} {people.length === 1 ? 'member' : 'members'}
        </div>

        {/* Member list */}
        <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100">
          {people.map(personName => {
            const meta = memberMeta[personName] || {};
            const isMe = personName === myName;
            const isGhost = meta.isGhost === true;

            return (
              <div key={personName} className="flex items-center gap-3 px-3 py-2.5">
                {/* Avatar icon */}
                <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center shrink-0">
                  {isGhost
                    ? <Ghost className="w-4 h-4 text-stone-400" />
                    : <User className="w-4 h-4 text-stone-500" />
                  }
                </div>

                {/* Name and badge */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-sm">{personName}</span>
                    {isMe && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-900 text-white">you</span>
                    )}
                    {isGhost && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-stone-300 text-stone-500 bg-stone-50">
                        not on app
                      </span>
                    )}
                    {/* TODO(link-ghost): Once this person signs up and the owner has an
                     *  'accepted' connection with them (see canAddAsRealMember in
                     *  src/auth/useConnections.js), show a "Link to account" button here.
                     *  That flow should:
                     *    1. Let the owner pick the matching real user from their connections.
                     *    2. Update this group_members row: set user_id, clear ghost_name.
                     *  Do NOT build that flow now — this comment is the seam.
                     *  The disabled placeholder below keeps the space so future work is
                     *  drop-in without restructuring this list item. */}
                    {isGhost && (
                      <span
                        title="Link-to-account is not yet available"
                        className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-stone-300 text-stone-400 cursor-not-allowed select-none"
                      >
                        Link to account (coming soon)
                      </span>
                    )}
                  </div>
                </div>

                {/* Remove button — only for ghost members */}
                {isGhost && (
                  <button
                    onClick={() => onRequestRemove(personName)}
                    className="p-1.5 text-stone-400 hover:text-red-600 rounded shrink-0"
                    title={`Remove ${personName}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Add ghost member input */}
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-stone-500 font-medium mb-1.5">
            Add person (no account needed)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="Name"
              className="flex-1 px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-stone-500"
              disabled={adding}
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || adding}
              className="px-4 py-2.5 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 disabled:bg-stone-300 flex items-center gap-1.5 shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              Add
            </button>
          </div>
          <div className="text-[11px] text-stone-500 mt-1.5 leading-snug">
            This person does not need an account. They appear as "not on app" and
            participate in expense splits the same as anyone else.
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupForm({ group, myName, onSave, onCancel }) {
  const isNew = !group;
  const [name, setName] = useState(group?.name || '');
  // For an existing group, derive the type from how many people it has.
  const initialType = group ? (group.type || (group.people?.length === 1 ? 'solo' : 'shared')) : 'shared';
  const [type, setType] = useState(initialType);
  // The partner field: find the first person that is NOT myName, default 'Shailja'.
  const initialPartner = group?.people?.find(p => p !== myName) || '';
  const [partner, setPartner] = useState(initialPartner);

  const hasExpenses = (group?.expenses?.length || 0) > 0;
  const valid = name.trim() && (type === 'solo' || partner.trim());

  const save = () => {
    if (!valid) return;
    onSave({
      name: name.trim(),
      type,
      // Extra people beyond the owner — only relevant for new groups.
      extraPeople: type === 'shared' ? [partner.trim()] : [],
    });
  };

  return (
    <div>
      <div className="p-4 space-y-3">
        <Field label="Group name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Boston weekend, July groceries"
            className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-stone-500"
            autoFocus
          />
        </Field>

        <Field label="Type">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setType('shared')}
              disabled={!isNew && hasExpenses}
              className={`py-3 rounded-lg border text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                type === 'shared' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
              }`}
            >
              <Users className="w-4 h-4 inline mr-1.5" />
              Shared
            </button>
            <button
              onClick={() => setType('solo')}
              disabled={!isNew && hasExpenses}
              className={`py-3 rounded-lg border text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                type === 'solo' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
              }`}
            >
              <User className="w-4 h-4 inline mr-1.5" />
              Solo
            </button>
          </div>
          <div className="text-[11px] text-stone-500 mt-1.5 leading-snug">
            {type === 'shared' && 'Track shared expenses with one other person and settle up.'}
            {type === 'solo' && 'Just your own spending. No splits, no settlement.'}
            {!isNew && hasExpenses && (
              <span className="block text-amber-700 mt-1">Type is locked because this group already has expenses.</span>
            )}
          </div>
        </Field>

        {type === 'shared' && (
          <Field label="Other person">
            <input
              type="text"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
              placeholder="Name"
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-stone-500"
              // Disable if editing an existing group — members are managed separately
              disabled={!isNew}
            />
            <div className="text-[11px] text-stone-500 mt-1">
              You are <span className="font-medium">{myName}</span>.
              {!isNew && <span className="block text-amber-700 mt-1">Member list is managed separately for existing groups.</span>}
            </div>
          </Field>
        )}
      </div>

      <div className="sticky bottom-0 bg-white border-t border-stone-200 px-4 py-3 flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50">
          Cancel
        </button>
        <button onClick={save} disabled={!valid} className="flex-1 py-2.5 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 disabled:bg-stone-300">
          {isNew ? 'Create' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ============ Settle modal ============ */

function SettleModal({ balances, people, onClose, onConfirm }) {
  const a = balances[0];
  const b = balances[1];
  const settleAmt = Math.abs(a.net);
  const fromPerson = a.net > 0 ? b.name : a.name;
  const toPerson = a.net > 0 ? a.name : b.name;
  const [amount, setAmount] = useState(settleAmt.toFixed(2));
  const [note, setNote] = useState('');

  const valid = parseFloat(amount) > 0;

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-stone-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold">Record settlement</h2>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm">
            <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-medium mb-1">Payment</div>
            <div className="font-semibold text-emerald-900">
              {fromPerson} pays {toPerson}
            </div>
          </div>

          <Field label="Amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-stone-300 text-sm tabular-nums focus:outline-none focus:border-stone-500"
              />
            </div>
            {Math.abs(parseFloat(amount) - settleAmt) > 0.005 && (
              <div className="text-[11px] text-amber-700 mt-1">
                Partial settlement — full balance is {fmt(settleAmt)}.
              </div>
            )}
          </Field>

          <Field label="Note (optional)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Zelle, cash, Venmo"
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-stone-500"
            />
          </Field>
        </div>

        <div className="border-t border-stone-200 px-4 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ from: fromPerson, to: toPerson, amount: parseFloat(amount), note })}
            disabled={!valid}
            className="flex-1 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 disabled:bg-stone-300"
          >
            Record payment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Expense modal ============ */

function ExpenseModal({ expense, people, isSolo, onClose, onSave }) {
  const isNew = !expense;
  const [name, setName] = useState(expense?.name || '');
  const [amount, setAmount] = useState(expense?.amount?.toString() || '');
  const [date, setDate] = useState(expense?.date || new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(expense?.category || 'Other');
  const [paidBy, setPaidBy] = useState(expense?.paidBy || people[0]);
  const [note, setNote] = useState(expense?.note || '');
  const [splitMode, setSplitMode] = useState(expense?.splitMode || (isSolo ? 'personal' : 'equal'));
  const [catManuallySet, setCatManuallySet] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    if (isNew) setTimeout(() => nameRef.current?.focus(), 50);
  }, [isNew]);

  useEffect(() => {
    if (catManuallySet) return;
    if (!name.trim()) return;
    setCategory(autoCategorize(name));
  }, [name, catManuallySet]);

  const valid = name.trim() && parseFloat(amount) > 0 && date;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    await onSave({
      // Pass the expense id if editing; undefined for new (store decides insert vs update).
      id: expense?.id,
      // Flag so the store knows this is definitely a DB row (not a client temp id).
      _isExistingDbRow: !isNew,
      name: name.trim(),
      amount: parseFloat(amount),
      date,
      category,
      paidBy: isSolo ? people[0] : paidBy,
      note: note.trim(),
      splitMode: isSolo ? 'personal' : splitMode,
    });
    setSaving(false);
  };

  // For split descriptions: everyone except the payer.
  const otherPeople = isSolo ? [] : people.filter(p => p !== paidBy);
  // Keep the old name for backwards compat with 2-person groups where it reads nicely.
  const otherPerson = otherPeople.length === 1 ? otherPeople[0] : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-stone-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold">{isNew ? 'Add expense' : 'Edit expense'}</h2>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-3">
          <Field label="Name">
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Starbucks Albany"
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-stone-500"
            />
            {isNew && name.trim() && !catManuallySet && (
              <div className="text-[11px] text-stone-500 mt-1">
                Auto-categorized as <span className="font-medium">{category}</span>. Change below if needed.
              </div>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-stone-300 text-sm tabular-nums focus:outline-none focus:border-stone-500"
                />
              </div>
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-stone-500"
              />
            </Field>
          </div>

          <Field label="Category">
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setCatManuallySet(true); }}
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white focus:outline-none focus:border-stone-500"
            >
              {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
            </select>
          </Field>

          {!isSolo && (
            <>
              {/* ── Paid by selector ──────────────────────────────────────────
               *  Works for any number of members (real or ghost).
               *  Uses 2 columns for up to 4 people, wraps naturally beyond that.
               *  Ghost members appear here the same as real members — the store
               *  has already resolved their display names. */}
              <Field label="Paid by">
                <div className={`grid gap-2 ${people.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
                  {people.map(p => (
                    <button
                      key={p}
                      onClick={() => setPaidBy(p)}
                      className={`py-2.5 rounded-lg border text-sm font-medium transition truncate ${
                        paidBy === p ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </Field>

              {/* ── Split mode selector ───────────────────────────────────────
               *  The three modes (equal / full / personal) work for any number
               *  of members. Equal divides the amount by people.length; full
               *  means everyone EXCEPT the payer owes the full amount; personal
               *  means no one else owes anything. */}
              <Field label="Split">
                <div className="grid grid-cols-3 gap-2">
                  {SPLIT_MODES.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSplitMode(m.id)}
                      className={`py-2 px-1 rounded-lg border text-xs font-medium transition ${
                        splitMode === m.id ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-stone-500 mt-1.5 leading-snug">
                  {splitMode === 'equal' && (
                    // Equal: divided evenly among ALL members.
                    `Split equally among ${people.length} people (${people.join(', ')}).`
                  )}
                  {splitMode === 'full' && (
                    // Full: everyone else owes the whole amount.
                    otherPerson
                      ? `${otherPerson} owes the full ${amount ? fmt(parseFloat(amount) || 0) : 'amount'}.`
                      : `Everyone else (${otherPeople.join(', ')}) each owe the full ${amount ? fmt(parseFloat(amount) || 0) : 'amount'}.`
                  )}
                  {splitMode === 'personal' && `Just ${paidBy}'s expense. No one owes anyone for this.`}
                </div>
              </Field>
            </>
          )}

          <Field label="Note (optional)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any context"
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-stone-500"
            />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-stone-200 px-4 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Cancel
          </button>
          <button onClick={save} disabled={!valid || saving} className="flex-1 py-2.5 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 disabled:bg-stone-300">
            {saving ? 'Saving…' : isNew ? 'Add' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Shared bits ============ */

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-stone-500 font-medium mb-1">{label}</label>
      {children}
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-base mb-2">{title}</h3>
        <p className="text-sm text-stone-600 mb-4">{message}</p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function formatDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday}, ${month} ${d}`;
}
