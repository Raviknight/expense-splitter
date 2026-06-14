import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Pencil, Trash2, X, ArrowDownUp, Receipt, Users, PieChart, Search,
  ChevronDown, ChevronRight, Check, Wallet, ArrowLeft, Handshake, User,
} from 'lucide-react';

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

/* ============ Seed data ============ */

const ME = 'Ravi';

const SEED_TRIP_EXPENSES = [
  { id: 's1',  date: '2026-05-30', name: 'AMNH (Museum of Natural History)',        amount: 172.00, category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's2',  date: '2026-05-30', name: 'Empire State Observatory',                amount: 423.52, category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's3',  date: '2026-05-30', name: 'Hudson Toyota Jersey City',               amount: 110.35, category: 'Auto Service', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's4',  date: '2026-05-30', name: 'Starbucks NYC',                           amount: 11.65,  category: 'Restaurants', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's5',  date: '2026-05-31', name: "America's Natl Parks (Liberty Island)",   amount: 25.96,  category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's6',  date: '2026-05-31', name: 'Metropolis Parking',                      amount: 7.99,   category: 'Parking',     paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's7',  date: '2026-05-31', name: 'NYCDOT ParkNYC',                          amount: 3.20,   category: 'Parking',     paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's8',  date: '2026-05-31', name: 'NYCDOT ParkNYC',                          amount: 14.70,  category: 'Parking',     paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's9',  date: '2026-05-31', name: 'Seabra Foods Harrison',                   amount: 26.22,  category: 'Groceries',   paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's10', date: '2026-06-04', name: 'Airbnb (Niagara stay)',                   amount: 531.24, category: 'Lodging',     paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's11', date: '2026-06-04', name: 'Budget Car Rental — GMC Yukon (net)',     amount: 699.02, category: 'Car Rental',  paidBy: 'Ravi', splitMode: 'equal', note: 'Net of -$739.32 refund and +$739.32 charge from statement' },
  { id: 's12', date: '2026-06-06', name: 'WM Supercenter Kearny',                   amount: 2.33,   category: 'Groceries',   paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's13', date: '2026-06-07', name: 'Wal-Mart #2107 Lockport',                 amount: 26.77,  category: 'Shopping',    paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's14', date: '2026-06-07', name: '7-Eleven Oakfield (snacks)',              amount: 3.00,   category: 'Convenience', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's15', date: '2026-06-07', name: '7-Eleven Oakfield (gas)',                 amount: 101.38, category: 'Fuel',        paidBy: 'Ravi', splitMode: 'equal', note: 'Re-categorized — large amount suggests fuel fill-up' },
  { id: 's16', date: '2026-06-07', name: '7-Eleven Niagara Falls',                  amount: 17.46,  category: 'Convenience', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's17', date: '2026-06-07', name: '777 Food Bazaar Niagara Falls',           amount: 10.00,  category: 'Groceries',   paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's18', date: '2026-06-07', name: 'Watkins Glen State Park',                 amount: 10.00,  category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's19', date: '2026-06-08', name: '7-Eleven Niagara Falls',                  amount: 13.69,  category: 'Convenience', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's20', date: '2026-06-08', name: '7-Eleven Niagara Falls',                  amount: 18.95,  category: 'Convenience', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's21', date: '2026-06-08', name: 'Maid of the Mist (store)',                amount: 33.45,  category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's22', date: '2026-06-08', name: 'Maid of the Mist (tickets)',              amount: 181.50, category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's23', date: '2026-06-08', name: 'Niagara Falls State Park',                amount: 30.00,  category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's24', date: '2026-06-08', name: 'Niagara Falls State Park',                amount: 138.00, category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's25', date: '2026-06-08', name: 'Niagra Tandoori Hut',                     amount: 20.41,  category: 'Restaurants', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's26', date: '2026-06-08', name: 'NJ EZPass',                               amount: 25.00,  category: 'Tolls',       paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's27', date: '2026-06-09', name: 'Hannaford Lake Placid',                   amount: 31.24,  category: 'Groceries',   paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's28', date: '2026-06-09', name: 'Lake Placid Inn',                         amount: 216.41, category: 'Lodging',     paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's29', date: '2026-06-09', name: 'Letchworth Concessions',                  amount: 10.25,  category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's30', date: '2026-06-09', name: 'Letchworth State Park entry',             amount: 10.00,  category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's31', date: '2026-06-09', name: 'Subway Rochester',                        amount: 5.38,   category: 'Restaurants', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's32', date: '2026-06-09', name: 'Subway Rochester',                        amount: 37.38,  category: 'Restaurants', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's33', date: '2026-06-09', name: 'Walgreens Niagara Falls',                 amount: 9.99,   category: 'Pharmacy',    paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's34', date: '2026-06-09', name: 'Refuel Fulton',                           amount: 5.18,   category: 'Convenience', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's35', date: '2026-06-10', name: 'ExxonMobil Lake Placid',                  amount: 106.85, category: 'Fuel',        paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's36', date: '2026-06-10', name: 'ExxonMobil New Paltz',                    amount: 3.77,   category: 'Fuel',        paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's37', date: '2026-06-10', name: 'Lake George Parking',                     amount: 2.00,   category: 'Parking',     paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's38', date: '2026-06-10', name: 'Subway Queensbury',                       amount: 3.29,   category: 'Restaurants', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's39', date: '2026-06-10', name: 'Subway Queensbury',                       amount: 37.61,  category: 'Restaurants', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's40', date: '2026-06-10', name: 'Whiteface Mountain',                      amount: 7.56,   category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's41', date: '2026-06-10', name: 'Whiteface Mountain',                      amount: 85.00,  category: 'Attractions', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's42', date: '2026-06-10', name: 'Refuel Fulton NY',                        amount: 5.38,   category: 'Convenience', paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 's43', date: '2026-06-11', name: 'WM Supercenter Kearny',                   amount: 88.71,  category: 'Groceries',   paidBy: 'Ravi', splitMode: 'equal', note: '' },
  { id: 'p1',  date: '2026-06-12', name: 'Uber',                                    amount: 25.97,  category: 'Transportation', paidBy: 'Ravi', splitMode: 'equal', note: 'Pending' },
  { id: 'p2',  date: '2026-06-12', name: 'Sunoco',                                  amount: 100.00, category: 'Fuel',        paidBy: 'Ravi', splitMode: 'equal', note: 'Pending — placeholder ~$100 (settled amount TBD)' },
  { id: 'p3',  date: '2026-06-12', name: 'NJ Harrison Municipal',                   amount: 41.20,  category: 'Government',  paidBy: 'Ravi', splitMode: 'equal', note: 'Pending' },
  { id: 'p4',  date: '2026-06-12', name: 'Dunkin',                                  amount: 29.79,  category: 'Restaurants', paidBy: 'Ravi', splitMode: 'equal', note: 'Pending' },
  { id: 'p5',  date: '2026-06-12', name: 'Union Kitchen Eckington',                 amount: 28.43,  category: 'Restaurants', paidBy: 'Ravi', splitMode: 'equal', note: 'Pending' },
  { id: 'p6',  date: '2026-06-12', name: 'DC Park Meter',                           amount: 4.60,   category: 'Parking',     paidBy: 'Ravi', splitMode: 'equal', note: 'Pending' },
  { id: 'p7',  date: '2026-06-12', name: 'Walmart Store 01985',                     amount: 33.82,  category: 'Shopping',    paidBy: 'Ravi', splitMode: 'equal', note: 'Pending' },
  { id: 'p8',  date: '2026-06-12', name: 'Aksharpith Robbinsville',                 amount: 11.73,  category: 'Restaurants', paidBy: 'Ravi', splitMode: 'equal', note: 'Pending — BAPS food court' },
  { id: 'p9',  date: '2026-06-12', name: '7-Eleven 44753',                          amount: 100.00, category: 'Fuel',        paidBy: 'Ravi', splitMode: 'equal', note: 'Pending — placeholder ~$100 (settled amount TBD)' },
  { id: 'p10', date: '2026-06-12', name: 'Booking.com (Partners on Booking BV)',    amount: 254.13, category: 'Lodging',     paidBy: 'Ravi', splitMode: 'equal', note: 'Pending' },
];

const SEED_DATA = {
  version: 2,
  me: ME,
  activeGroupId: 'g_seed_trip',
  groups: [
    { id: 'g_seed_trip', name: 'NY · Niagara · Adirondacks', people: ['Ravi', 'Shailja'], expenses: SEED_TRIP_EXPENSES },
    { id: 'g_seed_solo', name: 'My personal',                people: ['Ravi'],            expenses: [] },
  ],
};

const STORAGE_KEY = 'trip_data_v2';
const LEGACY_KEY = 'trip_expenses_v1';
const fmt = (n) => '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const makeId = (prefix = 'e') => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ============ App ============ */

export default function App() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [tab, setTab] = useState('expenses');
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('All');
  const [sortBy, setSortBy] = useState('date');

  const [editing, setEditing] = useState(null);
  const [showGroups, setShowGroups] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(null);

  /* ----- Load with migration ----- */
  useEffect(() => {
    (async () => {
      // Try v2 first
      try {
        const v2 = await window.storage.get(STORAGE_KEY);
        if (v2 && v2.value) {
          setData(JSON.parse(v2.value));
          setLoaded(true);
          return;
        }
      } catch {}
      // Migrate from v1 if present
      try {
        const v1 = await window.storage.get(LEGACY_KEY);
        if (v1 && v1.value) {
          const old = JSON.parse(v1.value);
          setData({
            version: 2,
            me: ME,
            activeGroupId: 'g_migrated',
            groups: [
              { id: 'g_migrated', name: 'NY · Niagara · Adirondacks', people: ['Ravi', 'Shailja'], expenses: old },
              { id: 'g_seed_solo', name: 'My personal', people: ['Ravi'], expenses: [] },
            ],
          });
          setLoaded(true);
          return;
        }
      } catch {}
      // Fresh start with seed
      setData(SEED_DATA);
      setLoaded(true);
    })();
  }, []);

  /* ----- Save on changes ----- */
  useEffect(() => {
    if (!loaded || !data) return;
    window.storage.set(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
  }, [data, loaded]);

  if (!loaded || !data) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center">
        <div className="text-stone-500 text-sm">Loading...</div>
      </div>
    );
  }

  const activeGroup = data.groups.find(g => g.id === data.activeGroupId) || data.groups[0];
  const people = activeGroup.people;
  const isSolo = people.length === 1;
  const expenses = activeGroup.expenses || [];
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

  /* ----- Mutations ----- */
  const updateActiveGroup = (mutator) => {
    setData(prev => ({
      ...prev,
      groups: prev.groups.map(g => g.id === activeGroup.id ? mutator(g) : g),
    }));
  };

  const upsertExpense = (exp) => {
    updateActiveGroup(g => {
      const idx = g.expenses.findIndex(e => e.id === exp.id);
      if (idx === -1) return { ...g, expenses: [...g.expenses, exp] };
      const next = [...g.expenses]; next[idx] = exp;
      return { ...g, expenses: next };
    });
  };

  const removeExpense = (id) => {
    updateActiveGroup(g => ({ ...g, expenses: g.expenses.filter(e => e.id !== id) }));
  };

  const switchGroup = (groupId) => {
    setData(prev => ({ ...prev, activeGroupId: groupId }));
    setShowGroups(false);
    setFilterCat('All');
    setSearch('');
    setTab('expenses');
  };

  const upsertGroup = (group) => {
    setData(prev => {
      const idx = prev.groups.findIndex(g => g.id === group.id);
      if (idx === -1) {
        return { ...prev, groups: [...prev.groups, group], activeGroupId: group.id };
      }
      const next = [...prev.groups]; next[idx] = group;
      return { ...prev, groups: next };
    });
  };

  const deleteGroup = (groupId) => {
    setData(prev => {
      const remaining = prev.groups.filter(g => g.id !== groupId);
      if (remaining.length === 0) return prev;
      return {
        ...prev,
        groups: remaining,
        activeGroupId: prev.activeGroupId === groupId ? remaining[0].id : prev.activeGroupId,
      };
    });
    setConfirmDeleteGroup(null);
  };

  const recordSettlement = ({ from, to, amount, note }) => {
    const settlement = {
      id: makeId('stl'),
      type: 'settlement',
      date: new Date().toISOString().slice(0, 10),
      name: `Settlement: ${from} paid ${to}`,
      amount,
      category: 'Other',
      paidBy: from,
      splitMode: 'full',
      note: note || '',
    };
    upsertExpense(settlement);
    setShowSettle(false);
  };

  const resetTripData = () => {
    setData(SEED_DATA);
    setConfirmReset(false);
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
            onReset={() => setConfirmReset(true)}
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
          onSave={(e) => { upsertExpense(e); setEditing(null); }}
        />
      )}

      {showGroups && (
        <GroupsModal
          data={data}
          onClose={() => setShowGroups(false)}
          onSwitch={switchGroup}
          onUpsert={upsertGroup}
          onRequestDelete={(g) => setConfirmDeleteGroup(g)}
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

      {confirmReset && (
        <ConfirmDialog
          title="Reset to original seed data?"
          message="This replaces ALL groups and expenses with the seeded trip. Any edits, additions, deletions, or other groups you've created will be lost."
          confirmLabel="Reset everything"
          onCancel={() => setConfirmReset(false)}
          onConfirm={resetTripData}
        />
      )}

      {confirmDeleteGroup && (
        <ConfirmDialog
          title={`Delete "${confirmDeleteGroup.name}"?`}
          message={`This will permanently remove the group and all ${confirmDeleteGroup.expenses.length} expense${confirmDeleteGroup.expenses.length === 1 ? '' : 's'} in it.`}
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
  const a = balances[0]; // first person (Ravi)
  const b = balances[1]; // second person
  // a.net positive = a is owed; negative = a owes
  // For "who pays whom": if a.net > 0, b pays a |a.net|. If a.net < 0, a pays b |a.net|.
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
          <div className="text-sm">No expenses yet.</div>
          <div className="text-xs mt-1">Tap the + button to add one.</div>
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

  if (total === 0) return <div className="text-center py-12 text-stone-500 text-sm">No data yet.</div>;
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

function SummaryTab({ expenses, settlements, balances, sharedPool, total, people, onSettle, onReset }) {
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

      <div className="pt-2">
        <button
          onClick={onReset}
          className="w-full text-xs text-stone-500 hover:text-red-600 py-2 border border-stone-200 rounded-lg bg-white"
        >
          Reset all data to original seed
        </button>
      </div>
    </div>
  );
}

/* ============ Groups modal ============ */

function GroupsModal({ data, onClose, onSwitch, onUpsert, onRequestDelete }) {
  const [view, setView] = useState('list'); // 'list' | 'form'
  const [editingGroup, setEditingGroup] = useState(null); // null or group

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
              {data.groups.map(g => {
                const isActive = g.id === data.activeGroupId;
                const isSolo = g.people.length === 1;
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
                          {g.expenses.length} {g.expenses.length === 1 ? 'item' : 'items'} · {fmt(g.expenses.filter(e => e.type !== 'settlement').reduce((s, e) => s + Number(e.amount || 0), 0))}
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
                      {data.groups.length > 1 && (
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
        ) : (
          <GroupForm
            group={editingGroup}
            myName={data.me}
            onSave={(g) => { onUpsert(g); setView('list'); setEditingGroup(null); }}
            onCancel={() => { setView('list'); setEditingGroup(null); }}
          />
        )}
      </div>
    </div>
  );
}

function GroupForm({ group, myName, onSave, onCancel }) {
  const isNew = !group;
  const [name, setName] = useState(group?.name || '');
  const initialType = group ? (group.people.length === 1 ? 'solo' : 'shared') : 'shared';
  const [type, setType] = useState(initialType);
  const initialPartner = group?.people.find(p => p !== myName) || 'Shailja';
  const [partner, setPartner] = useState(initialPartner);

  const valid = name.trim() && (type === 'solo' || partner.trim());

  const save = () => {
    if (!valid) return;
    const people = type === 'solo' ? [myName] : [myName, partner.trim()];
    onSave({
      id: group?.id || makeId('g'),
      name: name.trim(),
      people,
      expenses: group?.expenses || [],
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
              disabled={!isNew && group?.expenses?.length > 0}
              className={`py-3 rounded-lg border text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                type === 'shared' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
              }`}
            >
              <Users className="w-4 h-4 inline mr-1.5" />
              Shared
            </button>
            <button
              onClick={() => setType('solo')}
              disabled={!isNew && group?.expenses?.length > 0}
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
            {!isNew && group?.expenses?.length > 0 && (
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
            />
            <div className="text-[11px] text-stone-500 mt-1">You are <span className="font-medium">{myName}</span>.</div>
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

  const save = () => {
    if (!valid) return;
    onSave({
      id: expense?.id || makeId(),
      name: name.trim(),
      amount: parseFloat(amount),
      date,
      category,
      paidBy: isSolo ? people[0] : paidBy,
      note: note.trim(),
      splitMode: isSolo ? 'personal' : splitMode,
    });
  };

  const otherPerson = isSolo ? null : people.find(p => p !== paidBy);

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
              <Field label="Paid by">
                <div className="grid grid-cols-2 gap-2">
                  {people.map(p => (
                    <button
                      key={p}
                      onClick={() => setPaidBy(p)}
                      className={`py-2.5 rounded-lg border text-sm font-medium transition ${
                        paidBy === p ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </Field>

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
                  {splitMode === 'equal' && `Split 50/50 between ${people.join(' and ')}.`}
                  {splitMode === 'full' && `${otherPerson} owes the full ${amount ? fmt(parseFloat(amount) || 0) : 'amount'}.`}
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
          <button onClick={save} disabled={!valid} className="flex-1 py-2.5 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 disabled:bg-stone-300">
            {isNew ? 'Add' : 'Save'}
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
