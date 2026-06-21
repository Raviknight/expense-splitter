import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Pencil, Trash2, X, ArrowDownUp, Receipt, Users, PieChart, Search,
  ChevronDown, ChevronRight, Check, ArrowLeft, Handshake, User,
  AlertCircle, RefreshCw, UserPlus, Ghost, Upload, FileSpreadsheet,
  BarChart3, Download, Printer, ScanLine, Loader2,
} from 'lucide-react';
import { useAuth } from './auth/AuthProvider.jsx';
import { useConnections } from './auth/useConnections.js';
import { useExpenseStore } from './data/store.js';
import { parseCsv, PROVIDER_PRESETS, buildExpenses } from './data/csv.js';
import Avatar from './ui/Avatar.jsx';

// Feature flag: receipt/statement scanning (AI vision) is HIDDEN for now while we
// sort out a reliable vision API (Gemini free tier kept hitting quota limits).
// The whole scan code path is kept intact — flip this to true to re-enable the
// "Scan" button + tab once a working GEMINI_API_KEY (or other provider) is set.
const SCAN_ENABLED = false;

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
  { id: 'custom',   label: 'Custom',   desc: "Set each person's share" },
];

/* ============ Currency (display only — no FX conversion) ============ */

// Map of currency code → the symbol we show in front of amounts.
// This is SYMBOL-ONLY: we never convert money between currencies, we just
// swap which symbol is printed. Anything missing falls back to '$' (USD).
const CURRENCIES = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  CAD: 'CA$',
  AUD: 'A$',
  JPY: '¥',
};

// The symbol currently in use. App sets this from the ACTIVE GROUP's currency
// on every render (see below). It lives at module scope so the shared `fmt`
// helper — used by many components inside the group detail view — can read it
// without every component needing to thread the symbol through props.
let currencySymbol = '$';

// Format a number as money. By default it uses the active group's symbol
// (the module-level `currencySymbol`). Pass an explicit `sym` to override —
// the home dashboard does this so each group card can print in its OWN
// currency even though several cards are on screen at once.
const fmt = (n, sym = currencySymbol) =>
  sym + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Guess a sensible DEFAULT currency for a NEW group from the device region.
// We read the country (e.g. 'US', 'GB', 'DE') from the browser locale and map
// it to one of OUR supported currencies. Returns null if the region is unknown
// or anything goes wrong — the caller then falls back to the profile default.
// This only seeds the picker; the user can always change it.
function localeDefaultCurrency() {
  try {
    // Try the modern Intl.Locale API first; fall back to parsing 'en-US'.
    let region = null;
    try {
      region = new Intl.Locale(navigator.language).region || null;
    } catch (e) {
      region = (navigator.language || '').split('-')[1] || null;
    }
    if (!region) return null;
    region = region.toUpperCase();

    // Common Eurozone regions all map to EUR.
    const EUROZONE = ['DE', 'FR', 'ES', 'IT', 'NL', 'IE', 'PT', 'AT', 'BE', 'FI', 'GR'];
    if (EUROZONE.includes(region)) return 'EUR';

    const REGION_TO_CURRENCY = {
      US: 'USD',
      GB: 'GBP',
      IN: 'INR',
      CA: 'CAD',
      AU: 'AUD',
      JP: 'JPY',
    };
    return REGION_TO_CURRENCY[region] || null;
  } catch (e) {
    return null;
  }
}

/* ============ Settle-up math (works for any group size) ============
 *
 * These two helpers power "who pays whom" for groups of any size (2, 3, 4…).
 * They use the SAME split rules the rest of the app uses:
 *   - equal:    amount / number-of-people charged to EVERY person.
 *   - full:     everyone EXCEPT the payer owes the full amount.
 *   - personal: only the payer "owes" it (so it nets to 0 for them) — no split.
 * A recorded settlement is treated as a pure transfer: the payer (from) gets
 * credited (their debt shrinks) and the receiver (to) gets debited.
 */

// Compute each person's NET balance = (what they paid) − (what they owe).
// `entries` is the group's full expenses array (real expenses + settlements).
// Returns an array of { name, net } in the same order as `people`.
// net > 0  → they are owed money (a creditor).
// net < 0  → they owe money (a debtor).
function computeNetBalances(people, entries) {
  // Running paid/owed totals per person, keyed by display name.
  const paid = Object.fromEntries(people.map(p => [p, 0]));
  const owed = Object.fromEntries(people.map(p => [p, 0]));

  entries.forEach(e => {
    const amt = Number(e.amount || 0);

    // Settlements are a straight transfer, NOT a split. The payer (from)
    // reduces their debt; the receiver (to) reduces their credit. We model
    // that as: from "paid" the amount, to "owes" the amount.
    if (e.type === 'settlement') {
      const from = e._settleFrom;
      const to   = e._settleTo;
      if (from in paid) paid[from] += amt;
      if (to in owed)   owed[to]   += amt;
      return;
    }

    const mode = e.splitMode || 'equal';
    if (e.paidBy in paid) paid[e.paidBy] += amt;

    // Participants: WHO this expense is split among, frozen at creation time
    // (store.js attaches display names). Equal/full splits use ONLY these
    // people, so a member added to the group LATER is not retroactively pulled
    // into old expenses. Fall back to all `people` when an expense has no
    // participant list (legacy / pre-db-10 expenses) or somehow lists nobody.
    const parts = (e.participants && e.participants.length) ? e.participants : people;

    if (mode === 'personal') {
      // Payer keeps it: they owe their own expense, nets to 0 for them.
      if (e.paidBy in owed) owed[e.paidBy] += amt;
    } else if (mode === 'full') {
      // Every PARTICIPANT except the payer owes the full amount.
      parts.forEach(p => { if (p !== e.paidBy && p in owed) owed[p] += amt; });
    } else if (mode === 'custom') {
      // Custom: the per-person amounts were typed by the user and live in
      // e.splitDetail ({ name: amount }). Each named person owes exactly their
      // amount; anyone NOT listed owes 0 for this expense. (The amounts were
      // already made to sum to the expense total when it was saved.)
      const detail = e.splitDetail || {};
      Object.entries(detail).forEach(([name, share]) => {
        if (name in owed) owed[name] += Number(share || 0);
      });
    } else {
      // Equal: divide evenly among the PARTICIPANTS only. Guard against an
      // empty list (would divide by zero) by falling back to all people.
      const split = parts.length ? parts : people;
      const share = amt / split.length;
      split.forEach(p => { if (p in owed) owed[p] += share; });
    }
  });

  return people.map(p => ({ name: p, net: paid[p] - owed[p] }));
}

// Greedy "minimal transactions" settle-up. Repeatedly match the biggest debtor
// with the biggest creditor and settle the smaller of the two amounts. This
// yields at most N−1 payments. Returns [{ from, to, amount }] with amount
// rounded to 2 decimals; tiny floating-point residue (< 1 cent) is ignored.
function suggestSettlements(netBalances) {
  // Work on copies so we don't mutate the caller's data. Round to cents up
  // front so floating-point dust doesn't create phantom 0.001 payments.
  const debtors   = netBalances
    .filter(b => b.net < -0.005)
    .map(b => ({ name: b.name, amount: -b.net }))   // amount they owe (positive)
    .sort((a, b) => b.amount - a.amount);
  const creditors = netBalances
    .filter(b => b.net > 0.005)
    .map(b => ({ name: b.name, amount: b.net }))    // amount they are owed
    .sort((a, b) => b.amount - a.amount);

  const payments = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di];
    const c = creditors[ci];
    const pay = Math.min(d.amount, c.amount);
    if (pay > 0.005) {
      payments.push({
        from: d.name,
        to: c.name,
        amount: Math.round(pay * 100) / 100,   // round to cents
      });
    }
    d.amount -= pay;
    c.amount -= pay;
    // Advance whichever side is now settled (within a cent).
    if (d.amount < 0.005) di++;
    if (c.amount < 0.005) ci++;
  }
  return payments;
}

/* ============ Avatar helpers (home dashboard) ============
 *
 * Build short initials from a person's name for the little avatar circles
 * on the home screen group cards. Rule:
 *   - "Ravi Knight" -> "RK"  (first letter of first word + first letter of last)
 *   - "Shailja"     -> "S"   (single word -> just its first letter)
 * Profile photos aren't available yet, so we only render initials. See the
 * AVATAR SEAM comment in the GroupCard component below for where an <img>
 * could later replace the initials circle.
 */
function initialsFromName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/* ============ Export helpers (CSV + printable PDF) — no libraries ============ */

// Turn a group name into a safe-ish filename fragment (letters/numbers/-/_).
function sanitizeFilename(name) {
  return (name || 'group').replace(/[^a-z0-9\-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'group';
}

// Quote a single CSV field per RFC 4180: wrap in double-quotes and double any
// embedded quotes, but only when the field contains a comma, quote, or newline.
function csvField(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Build the CSV text for a group's REAL expenses (settlements excluded).
// Columns: Date, Name, Category, Amount, Paid By, Split, Note.
function buildExpensesCsv(realExpenses) {
  const header = ['Date', 'Name', 'Category', 'Amount', 'Paid By', 'Split', 'Note'];
  const lines = [header.map(csvField).join(',')];
  // Newest first to match the on-screen ordering.
  const rows = [...realExpenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  rows.forEach(e => {
    const modeLabel = (SPLIT_MODES.find(m => m.id === (e.splitMode || 'equal')) || {}).label || 'Equal';
    lines.push([
      csvField(e.date),
      csvField(e.name),
      csvField(e.category),
      // Plain number (no currency symbol) so the CSV imports cleanly into Excel.
      csvField(Number(e.amount || 0).toFixed(2)),
      csvField(e.paidBy),
      csvField(modeLabel),
      csvField(e.note || ''),
    ].join(','));
  });
  // \r\n line endings are the most spreadsheet-friendly.
  return lines.join('\r\n');
}

// Trigger a browser download of `text` as a file named `filename`.
// Uses a Blob + a temporary <a download> click — no library needed.
function downloadTextFile(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the object URL after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Open a clean, print-friendly window for the group and call print(), letting
// the user "Save as PDF" from the browser's print dialog. No PDF library.
// We build a small standalone HTML document (title, date range, expense table,
// settle-up summary) so printing doesn't disturb the live app DOM.
function printGroupReport(group, realExpenses, netBalances, suggestions, total) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Work out the date range from the real expenses.
  const dates = realExpenses.map(e => e.date).filter(Boolean).sort();
  const dateRange = dates.length
    ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`)
    : '—';

  const rows = [...realExpenses]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map(e => {
      const modeLabel = (SPLIT_MODES.find(m => m.id === (e.splitMode || 'equal')) || {}).label || 'Equal';
      return `<tr>
        <td>${esc(e.date)}</td>
        <td>${esc(e.name)}</td>
        <td>${esc(e.category)}</td>
        <td class="num">${esc(fmt(Number(e.amount || 0)))}</td>
        <td>${esc(e.paidBy)}</td>
        <td>${esc(modeLabel)}</td>
        <td>${esc(e.note || '')}</td>
      </tr>`;
    }).join('');

  // Per-person net summary.
  const balanceRows = netBalances.map(b => {
    const label = b.net > 0.005 ? 'is owed' : b.net < -0.005 ? 'owes' : 'even';
    return `<tr>
      <td>${esc(b.name)}</td>
      <td class="num">${esc(fmt(Math.abs(b.net)))}</td>
      <td>${esc(label)}</td>
    </tr>`;
  }).join('');

  // "Who pays whom" suggested payments.
  const settleRows = suggestions.length
    ? suggestions.map(s => `<li>${esc(s.from)} pays ${esc(s.to)} <strong>${esc(fmt(s.amount))}</strong></li>`).join('')
    : '<li>All settled — no payments needed.</li>';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(group.name)} — Expenses</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c1917; margin: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #78716c; font-size: 13px; margin-bottom: 20px; }
  h2 { font-size: 15px; margin: 24px 0 8px; border-bottom: 1px solid #e7e5e4; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f0efed; }
  th { color: #78716c; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  ul { padding-left: 18px; }
  li { margin: 4px 0; font-size: 13px; }
  .total { font-size: 18px; font-weight: 600; margin-top: 4px; }
  @media print { body { margin: 0; } @page { margin: 16mm; } }
</style>
</head>
<body>
  <h1>${esc(group.name)}</h1>
  <div class="meta">${esc(dateRange)} · ${realExpenses.length} expense${realExpenses.length === 1 ? '' : 's'}</div>
  <div class="total">Total: ${esc(fmt(total))}</div>

  <h2>Settle up</h2>
  <ul>${settleRows}</ul>

  <h2>Balances</h2>
  <table>
    <thead><tr><th>Person</th><th class="num">Amount</th><th>Status</th></tr></thead>
    <tbody>${balanceRows}</tbody>
  </table>

  <h2>Expenses</h2>
  <table>
    <thead><tr><th>Date</th><th>Name</th><th>Category</th><th class="num">Amount</th><th>Paid By</th><th>Split</th><th>Note</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  // Open a new window, write the report, and trigger the print dialog.
  const w = window.open('', '_blank');
  if (!w) {
    // Pop-up blocked — fall back to downloading the HTML so nothing is lost.
    downloadTextFile(`${sanitizeFilename(group.name)}-report.html`, html, 'text/html;charset=utf-8');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give the new document a tick to lay out before printing.
  w.onload = () => { w.focus(); w.print(); };
  // Safety net in case onload already fired.
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 300);
}

/* ============ App ============ */

export default function App() {
  // Get the signed-in user's id and profile from the auth layer.
  const { user, profile } = useAuth();

  // Load all data from Supabase. The store returns the same shape the UI
  // already knows how to render, so minimal UI changes are needed.
  const { groups, activeGroupId, loading, error, online, pendingCount, actions } = useExpenseStore(
    user?.id,
    profile,
  );

  // Currency is now PER GROUP. Inside a group's detail view every amount uses
  // that ACTIVE group's currency. We set the module-level `currencySymbol`
  // synchronously during render from the active group so the shared `fmt`
  // helper formats every amount in the right currency. This is display-only —
  // stored values and all math stay exactly the same.
  // (The home dashboard shows many groups at once, so it does NOT rely on this
  // single symbol — each GroupCard formats with its own group's currency.)
  const activeGroupForCurrency = groups.find(g => g.id === activeGroupId) || groups[0];
  currencySymbol = CURRENCIES[activeGroupForCurrency?.currency] || '$';

  const [tab, setTab] = useState('expenses');
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('All');
  const [sortBy, setSortBy] = useState('date');

  const [editing, setEditing] = useState(null);
  const [showGroups, setShowGroups] = useState(false);
  // How the GroupsModal should OPEN. Most entry points just want the normal
  // list ({ view: 'list' }). A "Create a group" button opens it on the form
  // ({ view: 'form' }); the in-group "People" button opens it straight on the
  // members panel ({ view: 'members', group }). We keep `showGroups` as the
  // simple on/off flag and read this alongside it when rendering the modal.
  const [groupsStart, setGroupsStart] = useState({ view: 'list', group: null });
  // Open the groups modal on a chosen view. Call openGroups() for the list,
  // openGroups('form') to create a new group, or
  // openGroups('members', group) to manage that group's people.
  const openGroups = (view = 'list', group = null) => {
    setGroupsStart({ view, group });
    setShowGroups(true);
  };
  // Which screen are we on?
  //   'home'  → the groups dashboard (cards for every group). The app opens here.
  //   'group' → the detail UI for the one selected (active) group.
  // The user is NOT auto-dropped into a group on load; they pick a card first.
  const [view, setView] = useState('home');
  const [showSettle, setShowSettle] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Which tab the import/scan modal opens on: 'csv' (file import) or 'scan' (photo).
  const [importStartMode, setImportStartMode] = useState('csv');
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(null);
  // Whether the group-header actions menu (Edit / People / Export / Delete) is
  // open. Tapping the group name "Name ▾" toggles it; picking an item closes it.
  const [showGroupMenu, setShowGroupMenu] = useState(false);

  // ── Invite auto-accept notice ─────────────────────────────────────────────
  // A small toast shown after we automatically accept an invite the user
  // arrived with. Shape: { kind: 'success' | 'error', text: string } or null.
  const [inviteNotice, setInviteNotice] = useState(null);
  // Guard so the auto-accept runs at most once per page load, even though the
  // effect below re-runs whenever `user` / `actions` change identity.
  const inviteHandledRef = useRef(false);

  // When the user becomes available, check for a pending invite token that
  // main.jsx stashed in localStorage (it survives the magic-link redirect).
  // If found: remove it immediately (so it only runs once even across reloads),
  // accept it, and show a success or error notice.
  useEffect(() => {
    // Don't run until we actually have a signed-in user.
    if (!user?.id) return;
    // Only ever run once per load.
    if (inviteHandledRef.current) return;

    let token = null;
    try {
      token = localStorage.getItem('slitab.pendingInvite');
      if (token) {
        // Remove right away so a reload or a second effect run can't re-accept.
        localStorage.removeItem('slitab.pendingInvite');
      }
    } catch (e) {
      // localStorage may be unavailable; nothing to do.
      token = null;
    }
    if (!token) return;

    // Mark handled BEFORE the async call so re-renders during the await
    // can't kick off a second accept.
    inviteHandledRef.current = true;

    (async () => {
      const result = await actions.acceptInvite(token);
      if (result?.ok) {
        const who = result.inviter || 'your friend';
        const text = `You're connected with ${who}` +
          (result.group ? ` and added to ${result.group}` : '');
        setInviteNotice({ kind: 'success', text });
      } else {
        setInviteNotice({
          kind: 'error',
          text: result?.message || 'Could not accept the invite.',
        });
      }
    })();
  }, [user?.id, actions]);

  // Auto-dismiss the invite notice after a few seconds (the user can also
  // close it with the X). Only arms a timer while a notice is showing.
  useEffect(() => {
    if (!inviteNotice) return;
    const t = setTimeout(() => setInviteNotice(null), 6000);
    return () => clearTimeout(t);
  }, [inviteNotice]);

  // The toast element, rendered in each view so it shows on home and group
  // screens alike. Fixed to the top so it floats above the page content.
  const inviteNoticeEl = inviteNotice && (
    <div className="fixed top-3 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
      <div
        className={`pointer-events-auto flex items-center gap-3 max-w-md w-full px-4 py-2.5 rounded-xl border shadow-sm text-sm ${
          inviteNotice.kind === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}
      >
        {inviteNotice.kind === 'success'
          ? <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          : <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />}
        <div className="flex-1">{inviteNotice.text}</div>
        <button
          onClick={() => setInviteNotice(null)}
          aria-label="Dismiss"
          className="shrink-0 opacity-60 hover:opacity-100"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

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
            className="flex items-center gap-2 justify-center w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
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
        {inviteNoticeEl}
        <div className="max-w-sm w-full text-center">
          <div className="text-5xl mb-4">🗂️</div>
          <div className="font-semibold text-stone-900 text-lg mb-2">No groups yet</div>
          <div className="text-sm text-stone-500 mb-6">
            Create your first group to start tracking shared expenses.
          </div>
          <button
            onClick={() => openGroups('form')}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
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
              profile={profile}
              startView={groupsStart.view}
              startGroup={groupsStart.group}
              onClose={() => setShowGroups(false)}
              onSwitch={(id) => { actions.switchGroup(id); setShowGroups(false); }}
              onCreateGroup={async (name, type, extraPeople, currency) => {
                await actions.createGroup(name, type, extraPeople, currency);
                setShowGroups(false);
              }}
              onUpdateGroup={async (groupId, name, type, currency) => {
                await actions.updateGroup(groupId, name, type, currency);
              }}
              onRequestDelete={(g) => setConfirmDeleteGroup(g)}
              onAddPerson={async (groupId, personName) => {
                await actions.addPersonToGroup(groupId, personName);
              }}
              onRemovePerson={async (groupId, personName) => {
                await actions.removePersonFromGroup(groupId, personName);
              }}
              onLinkGhost={async (groupId, ghostName, userId) => {
                await actions.linkGhostToUser(groupId, ghostName, userId);
              }}
              onInviteGhost={async (groupId, email, groupName, ghostName) => {
                // Tie the invite to this exact ghost so accept_invite can
                // auto-link it: look up the ghost's group_members.id from the
                // group's display-name → member-id map.
                const g = groups.find(gr => gr.id === groupId);
                const ghostMemberId = g?._nameToMemberId?.[ghostName] || null;
                return actions.inviteGhostByEmail({
                  email,
                  groupName,
                  inviterName: profile?.display_name || 'A friend',
                  groupId,
                  ghostMemberId,
                });
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
      // A settlement is a PAYMENT (transfer), not a split: the payer (from)
      // reduces their debt and the receiver (to) reduces their credit. Treating
      // it like a "full" expense here is what previously left everyone still
      // looking like they owed money after they'd settled up.
      if (e.type === 'settlement') {
        const from = e._settleFrom, to = e._settleTo;
        if (from in paid) paid[from] = (paid[from] || 0) + amt;
        if (to in owed)   owed[to]   = (owed[to]   || 0) + amt;
        return;
      }
      const mode = e.splitMode || 'equal';
      paid[e.paidBy] = (paid[e.paidBy] || 0) + amt;
      // Participants frozen at creation (display names from store.js). Equal/
      // full splits use only these people; fall back to all `people` for legacy
      // expenses with no participant list.
      const parts = (e.participants && e.participants.length) ? e.participants : people;
      if (mode === 'personal') {
        owed[e.paidBy] = (owed[e.paidBy] || 0) + amt;
      } else if (mode === 'full') {
        parts.forEach(p => { if (p !== e.paidBy) owed[p] = (owed[p] || 0) + amt; });
        shared += amt;
      } else if (mode === 'custom') {
        // Custom: each person owes exactly the amount the user typed for them,
        // stored in e.splitDetail ({ name: amount }). People not listed owe 0.
        // Like a normal shared expense, the whole amount goes into the shared
        // pool (it was split among people, just not evenly).
        const detail = e.splitDetail || {};
        Object.entries(detail).forEach(([name, share]) => {
          owed[name] = (owed[name] || 0) + Number(share || 0);
        });
        shared += amt;
      } else {
        // Equal: divide among PARTICIPANTS only. Guard against an empty list
        // (divide-by-zero) by falling back to all people.
        const split = parts.length ? parts : people;
        const share = amt / split.length;
        split.forEach(p => { owed[p] = (owed[p] || 0) + share; });
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
    // Opening a group from anywhere moves us into the group detail view.
    setView('group');
  };

  // Return to the groups dashboard (the "All groups" back control).
  const goHome = () => {
    setShowGroups(false);
    setView('home');
  };

  const recordSettlement = async ({ from, to, amount, note }) => {
    await actions.recordSettlement(activeGroup.id, { from, to, amount, note });
    setShowSettle(false);
  };

  // Record one suggested payment WITHOUT closing the modal. Used by the 3+
  // settle-up list so the user can record several payments in a row; balances
  // (and therefore the suggestions) refetch after each one.
  const recordSettlementKeepOpen = async ({ from, to, amount, note }) => {
    await actions.recordSettlement(activeGroup.id, { from, to, amount, note });
  };

  /* ----- Export the active group (CSV download / printable PDF) ----- */
  const exportCsv = () => {
    const csv = buildExpensesCsv(realExpenses);
    downloadTextFile(`${sanitizeFilename(activeGroup.name)}-expenses.csv`, csv);
  };

  const exportPdf = () => {
    // Use the correct net balances + greedy suggestions for the printed summary.
    const net = computeNetBalances(people, expenses);
    const suggestions = suggestSettlements(net);
    printGroupReport(activeGroup, realExpenses, net, suggestions, total);
  };

  const deleteGroup = async (groupId) => {
    await actions.deleteGroup(groupId);
    setConfirmDeleteGroup(null);
  };

  /* ----- Tabs (conditional on solo) ----- */
  const tabs = isSolo
    ? [
        { id: 'expenses',   label: 'Expenses',   icon: Receipt },
        { id: 'insights',   label: 'Insights',   icon: BarChart3 },
      ]
    : [
        { id: 'expenses',   label: 'Expenses',   icon: Receipt },
        { id: 'insights',   label: 'Insights',   icon: BarChart3 },
        { id: 'summary',    label: 'Settle Up',  icon: Handshake },
      ];

  // ── Home dashboard: list every group as a tappable card ───────────────────
  // This is where the app lands on sign-in (view === 'home'). The user picks a
  // card to drop into that group's detail UI below. Rendered here, after the
  // helper closures (switchGroup, deleteGroup…) are defined so we can pass them.
  if (view === 'home') {
    return (
      <>
      {inviteNoticeEl}
      <HomeScreen
        groups={groups}
        myName={profile?.display_name || 'Me'}
        online={online}
        pendingCount={pendingCount}
        error={error}
        onClearError={actions.clearError}
        onOpenGroup={switchGroup}
        onNewGroup={() => openGroups('form')}
        groupsModal={showGroups && (
          <GroupsModal
            groups={groups}
            activeGroupId={activeGroupId}
            myName={profile?.display_name || 'Me'}
            profile={profile}
            startView={groupsStart.view}
            startGroup={groupsStart.group}
            onClose={() => setShowGroups(false)}
            onSwitch={switchGroup}
            onCreateGroup={async (name, type, extraPeople, currency) => {
              await actions.createGroup(name, type, extraPeople, currency);
              setShowGroups(false);
            }}
            onUpdateGroup={async (groupId, name, type, currency) => {
              await actions.updateGroup(groupId, name, type, currency);
            }}
            onRequestDelete={(g) => setConfirmDeleteGroup(g)}
            onAddPerson={async (groupId, personName) => {
              await actions.addPersonToGroup(groupId, personName);
            }}
            onRemovePerson={async (groupId, personName) => {
              await actions.removePersonFromGroup(groupId, personName);
            }}
            onLinkGhost={async (groupId, ghostName, userId) => {
              await actions.linkGhostToUser(groupId, ghostName, userId);
            }}
            onInviteGhost={async (groupId, email, groupName, ghostName) => {
              // Tie the invite to this exact ghost so accept_invite can
              // auto-link it (display-name → group_members.id).
              const g = groups.find(gr => gr.id === groupId);
              const ghostMemberId = g?._nameToMemberId?.[ghostName] || null;
              return actions.inviteGhostByEmail({
                email,
                groupName,
                inviterName: profile?.display_name || 'A friend',
                groupId,
                ghostMemberId,
              });
            }}
          />
        )}
        confirmDelete={confirmDeleteGroup && (
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
      />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7] text-stone-900" style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>

      {/* Floating notice after auto-accepting an invite */}
      {inviteNoticeEl}

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

      {/* Offline / sync-pending status banner — only shown when relevant */}
      {(!online || pendingCount > 0) && (
        <div className={`border-b px-4 py-1.5 flex items-center gap-2 max-w-3xl mx-auto ${
          !online
            ? 'bg-amber-50 border-amber-200'
            : 'bg-stone-50 border-stone-200'
        }`}>
          {/* Dot indicator */}
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            !online ? 'bg-amber-500' : 'bg-indigo-500 animate-pulse'
          }`} />
          <span className={`text-xs ${!online ? 'text-amber-800' : 'text-stone-600'}`}>
            {!online
              ? 'Offline — changes saved on this device will sync when you reconnect'
              : `Syncing ${pendingCount} change${pendingCount === 1 ? '' : 's'}…`}
          </span>
        </div>
      )}

      <header className="sticky top-11 z-20 bg-[#FAFAF7]/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-3">
          {/* Back control: returns to the groups dashboard (view = 'home'). */}
          <button
            onClick={goHome}
            className="inline-flex items-center gap-1 -ml-1 mb-2 px-1 py-0.5 text-sm text-stone-500 hover:text-stone-800 rounded"
          >
            <ArrowLeft className="w-4 h-4" />
            All groups
          </button>
          <div className="flex items-start justify-between gap-3">
            {/* Group name "Name ▾" — opens an actions menu (Edit / People /
                Export / Delete) so you never have to back out to the groups
                list to manage THIS group. The menu lives in a relatively
                positioned wrapper so it can drop down right under the name. */}
            <div className="relative min-w-0">
              <button
                onClick={() => setShowGroupMenu(o => !o)}
                className="text-left min-w-0 group"
                aria-haspopup="menu"
                aria-expanded={showGroupMenu}
              >
                <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500 font-medium flex items-center gap-1">
                  {isSolo ? <><User className="w-3 h-3" /> Personal</> : <><Users className="w-3 h-3" /> {people.join(' & ')}</>}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <h1 className="text-xl font-semibold truncate">{activeGroup.name}</h1>
                  <ChevronDown className={`w-4 h-4 text-stone-400 group-hover:text-stone-700 shrink-0 transition-transform ${showGroupMenu ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {showGroupMenu && (
                <GroupActionsMenu
                  isSolo={isSolo}
                  onClose={() => setShowGroupMenu(false)}
                  onEdit={() => { setShowGroupMenu(false); openGroups('form', activeGroup); }}
                  onPeople={() => { setShowGroupMenu(false); openGroups('members', activeGroup); }}
                  onExportCsv={() => { setShowGroupMenu(false); exportCsv(); }}
                  onExportPdf={() => { setShowGroupMenu(false); exportPdf(); }}
                  onDelete={groups.length > 1
                    ? () => { setShowGroupMenu(false); setConfirmDeleteGroup(activeGroup); }
                    : null}
                />
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* People button: opens the members panel for THIS group in one
                  tap (no backing out to the groups list). Only shown for shared
                  groups — a solo group has no one to manage. The same action
                  also lives in the group-name menu above. On wider screens we
                  show the "People" label; on phones the icon alone keeps it
                  compact. */}
              {!isSolo && (
                <button
                  onClick={() => openGroups('members', activeGroup)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-300 text-stone-700 text-sm font-medium hover:bg-stone-100"
                  aria-label="Manage people in this group"
                  title="Manage people in this group"
                >
                  <Users className="w-4 h-4" />
                  <span className="hidden sm:inline">People</span>
                </button>
              )}
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-[0.14em] text-stone-500">Total</div>
                <div className="text-lg font-semibold tabular-nums">{fmt(total)}</div>
              </div>
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
                  tab === t.id ? 'bg-indigo-600 text-white' : 'text-stone-600 hover:bg-stone-100'
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
        {tab === 'insights' && (
          <InsightsTab
            expenses={realExpenses}
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
            entries={expenses}
            onSettle={() => setShowSettle(true)}
            onExportCsv={exportCsv}
            onExportPdf={exportPdf}
          />
        )}
      </main>

      {/* Floating action buttons: Import CSV (secondary) + Add expense (primary).
          Both only appear here in the normal state where a group exists. */}
      <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-3">
        {SCAN_ENABLED && (
        <button
          onClick={() => { setImportStartMode('scan'); setShowImport(true); }}
          className="w-12 h-12 rounded-full bg-white border border-stone-300 text-stone-700 shadow-md hover:bg-stone-50 active:scale-95 transition flex items-center justify-center"
          aria-label="Scan receipt or statement"
          title="Scan a receipt or statement photo / PDF"
        >
          <ScanLine className="w-5 h-5" />
        </button>
        )}
        <button
          onClick={() => { setImportStartMode('csv'); setShowImport(true); }}
          className="w-12 h-12 rounded-full bg-white border border-stone-300 text-stone-700 shadow-md hover:bg-stone-50 active:scale-95 transition flex items-center justify-center"
          aria-label="Import CSV"
          title="Import expenses from a CSV file"
        >
          <Upload className="w-5 h-5" />
        </button>
        <button
          onClick={() => setEditing('new')}
          className="w-14 h-14 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 active:scale-95 transition flex items-center justify-center"
          aria-label="Add expense"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

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
          profile={profile}
          startView={groupsStart.view}
          startGroup={groupsStart.group}
          onClose={() => setShowGroups(false)}
          onSwitch={switchGroup}
          onCreateGroup={async (name, type, extraPeople, currency) => {
            await actions.createGroup(name, type, extraPeople, currency);
            setShowGroups(false);
          }}
          onUpdateGroup={async (groupId, name, type, currency) => {
            await actions.updateGroup(groupId, name, type, currency);
          }}
          onRequestDelete={(g) => setConfirmDeleteGroup(g)}
          onAddPerson={async (groupId, personName) => {
            await actions.addPersonToGroup(groupId, personName);
          }}
          onRemovePerson={async (groupId, personName) => {
            await actions.removePersonFromGroup(groupId, personName);
          }}
          onLinkGhost={async (groupId, ghostName, userId) => {
            await actions.linkGhostToUser(groupId, ghostName, userId);
          }}
          onInviteGhost={async (groupId, email, groupName, ghostName) => {
            // Tie the invite to this exact ghost so accept_invite can
            // auto-link it (display-name → group_members.id).
            const g = groups.find(gr => gr.id === groupId);
            const ghostMemberId = g?._nameToMemberId?.[ghostName] || null;
            return actions.inviteGhostByEmail({
              email,
              groupName,
              inviterName: profile?.display_name || 'A friend',
              groupId,
              ghostMemberId,
            });
          }}
        />
      )}

      {showSettle && (
        <SettleModal
          balances={balances}
          people={people}
          entries={expenses}
          onClose={() => setShowSettle(false)}
          onConfirm={recordSettlement}
          onRecord={recordSettlementKeepOpen}
        />
      )}

      {showImport && (
        <ImportModal
          people={people}
          isSolo={isSolo}
          myName={profile?.display_name || 'Me'}
          startMode={importStartMode}
          onClose={() => setShowImport(false)}
          onImport={(rows, opts) => actions.importExpenses(activeGroup.id, rows, opts)}
          onScan={(base64, mimeType) => actions.scanReceipt(base64, mimeType)}
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

/* ============ Home dashboard (groups landing) ============
 *
 * The screen the app opens to. Lists every group as a tappable card. Tapping a
 * card calls onOpenGroup(id), which makes that group active and switches the
 * parent's view to 'group'. A "+ New group" button reuses the existing
 * GroupsModal (passed in as `groupsModal`) so creation stays in one place.
 */
function HomeScreen({
  groups, myName, online, pendingCount, error, onClearError,
  onOpenGroup, onNewGroup, groupsModal, confirmDelete,
}) {
  return (
    <div className="min-h-screen bg-[#FAFAF7] text-stone-900" style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>

      {/* Write-error banner (same as the group view) */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center gap-3 max-w-3xl mx-auto">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <div className="text-sm text-red-800 flex-1">{error}</div>
          <button onClick={onClearError} className="text-xs text-red-600 underline shrink-0">Dismiss</button>
        </div>
      )}

      {/* Offline / syncing banner */}
      {(!online || pendingCount > 0) && (
        <div className={`border-b px-4 py-1.5 flex items-center gap-2 max-w-3xl mx-auto ${
          !online ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-200'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${!online ? 'bg-amber-500' : 'bg-indigo-500 animate-pulse'}`} />
          <span className={`text-xs ${!online ? 'text-amber-800' : 'text-stone-600'}`}>
            {!online
              ? 'Offline — changes saved on this device will sync when you reconnect'
              : `Syncing ${pendingCount} change${pendingCount === 1 ? '' : 's'}…`}
          </span>
        </div>
      )}

      <header className="sticky top-11 z-20 bg-[#FAFAF7]/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 pt-5 pb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Your groups</h1>
          <button
            onClick={onNewGroup}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" />
            New group
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-4 pb-24">
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map(g => (
            <GroupCard key={g.id} group={g} myName={myName} onOpen={() => onOpenGroup(g.id)} />
          ))}
        </div>
      </main>

      {groupsModal}
      {confirmDelete}
    </div>
  );
}

/* ============ Group card (one tile on the home dashboard) ============ */
function GroupCard({ group, myName, onOpen }) {
  const people = group.people || [];
  const isSolo = (group.type === 'solo') || people.length === 1;

  // The signed-in user's net balance in THIS group, using the shared math.
  // We match the current user by the name the owner appears as in group.people
  // (their profile display name, falling back to 'Me' — same convention the
  // rest of App.jsx uses). If that name isn't found (e.g. an unusual setup),
  // `mine` is undefined and we just show "settled up".
  const net = computeNetBalances(people, group.expenses || []);
  const mine = net.find(b => b.name === myName);
  const myNet = mine ? mine.net : 0;

  // Within a cent = settled up (matches the settle-up rounding elsewhere).
  const settled = Math.abs(myNet) < 0.005;
  const owed = myNet > 0;   // positive net → you are OWED money

  // This card must print in THIS group's own currency — several cards are on
  // screen at once, so we can't rely on the single module-level symbol. We pass
  // this symbol explicitly to fmt() below.
  const sym = CURRENCIES[group.currency] || '$';

  // Up to 4 avatar circles, then a "+N" overflow bubble.
  const shown = people.slice(0, 4);
  const overflow = people.length - shown.length;

  return (
    <button
      onClick={onOpen}
      className="text-left bg-white border border-stone-200 rounded-2xl p-4 shadow-sm hover:border-stone-300 hover:shadow active:scale-[0.99] transition flex flex-col gap-3"
    >
      {/* Title + solo tag */}
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-stone-900 truncate">{group.name}</div>
        {isSolo && (
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-stone-500 bg-stone-100 border border-stone-200 rounded-full px-2 py-0.5">
            solo
          </span>
        )}
      </div>

      {/* Member avatars: profile photo when available, else initials.
          group._memberAvatars maps display name → photo URL (null for ghosts /
          no photo). Before db/08 the map is empty → Avatar shows initials. */}
      <div className="flex items-center">
        {shown.map((p, i) => (
          <Avatar
            key={p + i}
            name={p}
            url={(group._memberAvatars || {})[p]}
            size={28}
            className="-ml-1.5 first:ml-0 ring-2 ring-white"
          />
        ))}
        {overflow > 0 && (
          <span className="w-7 h-7 -ml-1.5 rounded-full bg-stone-200 text-stone-600 text-[11px] font-semibold ring-2 ring-white flex items-center justify-center">
            +{overflow}
          </span>
        )}
      </div>

      {/* The signed-in user's balance in this group */}
      {isSolo ? (
        <div className="text-sm text-stone-500">Personal spending</div>
      ) : settled ? (
        <div className="text-sm text-stone-500 font-medium">Settled up</div>
      ) : owed ? (
        <div className="text-sm font-semibold text-emerald-700">
          You are owed +{fmt(myNet, sym)}
        </div>
      ) : (
        <div className="text-sm font-semibold text-rose-600">
          You owe -{fmt(Math.abs(myNet), sym)}
        </div>
      )}
    </button>
  );
}

/* ============ Group actions menu (group-header "Name ▾") ============
 *
 * A small dropdown that opens under the group name in the detail header. It
 * collects every "manage THIS group" action in one place so the owner never
 * has to back out to the groups list:
 *   • Edit        — open the group form pre-filled (rename / change currency)
 *   • People      — open the members panel (shared groups only)
 *   • Export CSV  — download the group's expenses as a .csv
 *   • Save as PDF — open the printable report
 *   • Delete group — confirm-then-delete (hidden when this is the only group;
 *                    the parent passes onDelete=null in that case)
 *
 * A full-screen transparent backdrop sits behind the menu so a tap anywhere
 * outside closes it (same idea as the modals' click-outside-to-close).
 */
function GroupActionsMenu({ isSolo, onClose, onEdit, onPeople, onExportCsv, onExportPdf, onDelete }) {
  // One row in the menu. `danger` tints it red for the destructive Delete item.
  const Item = ({ icon: Icon, label, onClick, danger }) => (
    <button
      role="menuitem"
      onClick={onClick}
      className={
        'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition ' +
        (danger
          ? 'text-rose-600 hover:bg-rose-50'
          : 'text-stone-700 hover:bg-stone-50')
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="font-medium">{label}</span>
    </button>
  );

  return (
    <>
      {/* Click-outside backdrop. Transparent; just catches the tap to close. */}
      <div className="fixed inset-0 z-30" onClick={onClose} />

      {/* The menu itself, anchored under the group name. */}
      <div
        role="menu"
        className="absolute left-0 mt-2 z-40 w-52 rounded-xl border border-stone-200 bg-white shadow-xl py-1 overflow-hidden"
      >
        <Item icon={Pencil} label="Edit group" onClick={onEdit} />
        {/* People only makes sense for a shared group. */}
        {!isSolo && <Item icon={Users} label="People" onClick={onPeople} />}
        <Item icon={Download} label="Export CSV" onClick={onExportCsv} />
        <Item icon={Printer} label="Save as PDF" onClick={onExportPdf} />
        {/* Delete is hidden when this is the user's only group. */}
        {onDelete && (
          <>
            <div className="my-1 border-t border-stone-100" />
            <Item icon={Trash2} label="Delete group" onClick={onDelete} danger />
          </>
        )}
      </div>
    </>
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
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-stone-200 bg-white text-sm focus:outline-none focus:border-indigo-500"
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

/* ============ Insights tab ============
 *
 * A lightweight, READ-ONLY spending overview for the active group. This is the
 * single merged "Insights" tab — it replaces the old separate "Categories" and
 * "Insights" tabs, which showed the same by-category data twice.
 *
 * What it shows:
 *   - A month filter dropdown ("All time" plus every month that has expenses).
 *   - Total spent for the chosen period (real expenses only — settlements are
 *     already excluded by the caller).
 *   - A "top category" highlight.
 *   - A by-category breakdown as simple horizontal bars (plain CSS widths —
 *     no charting library), sorted high → low. Each bar uses that category's
 *     own colour and emoji from CATEGORIES.
 *
 * Tapping a category row jumps to the Expenses tab filtered to that category
 * (that is the old Categories-tab behaviour, folded in here via `onPick`).
 *
 * We do NOT mutate anything here; it only reads the numbers it is handed.
 */

// The category tones look like "bg-violet-50 text-violet-800 border-violet-200".
// For a solid bar we want the same colour family at a stronger shade, e.g.
// "bg-violet-500". We pull the family out of the "text-…" part of the tone and
// rebuild it. Tailwind's Play CDN generates classes from the DOM at runtime, so
// these constructed class names render fine (there is no purge step to miss them).
function barColorFromTone(tone) {
  const match = (tone || '').match(/text-([a-z]+)-\d{3}/);
  const family = match ? match[1] : 'stone';
  return `bg-${family}-500`;
}

// Turn a "YYYY-MM" key (like "2026-06") into a friendly label ("June 2026").
// We build it by hand from the year and the month number so we don't need any
// date library. The month number is 1–12, so we index a plain array of names.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthLabel(key) {
  const [year, month] = key.split('-');           // e.g. "2026", "06"
  const name = MONTH_NAMES[Number(month) - 1];    // "06" → index 5 → "June"
  return `${name} ${year}`;                        // "June 2026"
}

function InsightsTab({ expenses, onPick }) {
  // Which period is shown. 'all' means every expense; otherwise it's a
  // "YYYY-MM" month key. Defaults to "All time".
  const [period, setPeriod] = useState('all');

  // Every month that has at least one expense, newest first. We take each
  // expense's date (a 'YYYY-MM-DD' string), keep just the "YYYY-MM" part,
  // de-duplicate, and sort descending (so the most recent month is on top).
  const months = useMemo(() => {
    const set = new Set();
    expenses.forEach(e => { if (e.date) set.add(String(e.date).slice(0, 7)); });
    return Array.from(set).sort().reverse();
  }, [expenses]);

  // The expenses that belong to the chosen period. For "All time" it's all of
  // them; for a month it's only the ones whose date starts with that month key.
  const periodExpenses = useMemo(() => {
    if (period === 'all') return expenses;
    return expenses.filter(e => String(e.date || '').slice(0, 7) === period);
  }, [expenses, period]);

  // The total for the chosen period (computed locally, NOT the passed-in
  // all-time total), and the per-category sums highest first. Memoised so we
  // only recompute when the filtered list changes.
  const periodTotal = useMemo(
    () => periodExpenses.reduce((s, e) => s + Number(e.amount || 0), 0),
    [periodExpenses]
  );
  const byCategory = useMemo(() => {
    const m = {};
    periodExpenses.forEach(e => { m[e.category] = (m[e.category] || 0) + Number(e.amount || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [periodExpenses]);

  // The month dropdown. Shown above everything so it stays visible even when the
  // chosen period is empty. Only render the picker if there is at least one month.
  const picker = months.length > 0 && (
    <div className="flex items-center justify-between gap-2 px-1">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">Period</div>
      <select
        value={period}
        onChange={(e) => setPeriod(e.target.value)}
        className="text-sm bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 font-medium text-stone-700"
      >
        <option value="all">All time</option>
        {months.map(m => (
          <option key={m} value={m}>{monthLabel(m)}</option>
        ))}
      </select>
    </div>
  );

  // Empty state: either the group has no expenses at all, or the chosen month
  // has none. We still show the picker so the user can switch periods.
  if (periodTotal === 0) return (
    <div className="space-y-3">
      {picker}
      <div className="text-center py-12 text-stone-500">
        <div className="text-sm">
          {period === 'all' ? 'No expenses yet.' : `No expenses in ${monthLabel(period)}.`}
        </div>
        <div className="text-xs mt-1">
          {period === 'all'
            ? 'Add expenses to see spending insights.'
            : 'Pick another month to see spending.'}
        </div>
      </div>
    </div>
  );

  // The biggest category is simply the first row after the high→low sort.
  const [topCat, topAmt] = byCategory[0];
  const topMeta = catMeta(topCat);
  const topPct = (topAmt / periodTotal) * 100;

  return (
    <div className="space-y-3">
      {picker}

      {/* Total spent card (for the chosen period) */}
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium mb-1">
          {period === 'all' ? 'Total spent' : `Spent in ${monthLabel(period)}`}
        </div>
        <div className="text-3xl font-semibold tabular-nums">{fmt(periodTotal)}</div>
        <div className="text-sm text-stone-500 mt-1">
          {periodExpenses.length} expense{periodExpenses.length === 1 ? '' : 's'} across {byCategory.length} categor{byCategory.length === 1 ? 'y' : 'ies'}
        </div>
      </div>

      {/* Top category highlight */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-3">
        <div className="text-2xl shrink-0">{topMeta.emoji}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-indigo-700 font-medium">Top category</div>
          <div className="font-semibold text-stone-900 truncate">{topCat}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold tabular-nums">{fmt(topAmt)}</div>
          <div className="text-[10px] text-stone-500 tabular-nums">{topPct.toFixed(1)}% of total</div>
        </div>
      </div>

      {/* By-category bars (high → low). Each row is a button so tapping it jumps
          to the Expenses tab filtered to that category (via onPick). */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">Where it went</div>
        {byCategory.map(([cat, amt]) => {
          const meta = catMeta(cat);
          const pct = (amt / periodTotal) * 100;
          return (
            <button
              key={cat}
              onClick={() => onPick(cat)}
              className="w-full text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-stone-50 transition"
            >
              <div className="flex items-center justify-between mb-1 text-sm">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span>{meta.emoji}</span>
                  <span className="font-medium truncate">{cat}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 tabular-nums">
                  <span className="font-semibold">{fmt(amt)}</span>
                  <span className="text-[10px] text-stone-500 w-10 text-right">{pct.toFixed(1)}%</span>
                </div>
              </div>
              <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColorFromTone(meta.tone)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SummaryTab({ expenses, settlements, balances, sharedPool, total, people, entries, onSettle, onExportCsv, onExportPdf }) {
  const a = balances[0];
  const settleAmt = Math.abs(a.net);
  const personalTotal = total - sharedPool;

  // Correct net balances + greedy "who pays whom" for ANY group size. For 2
  // people this still produces the single A→B payment; for 3+ it produces the
  // minimal set of transactions. We compute it here so the settle-up card can
  // preview the suggestions inline.
  const netBalances = computeNetBalances(people, entries || expenses);
  const suggestions = suggestSettlements(netBalances);
  const isMulti = people.length >= 3;

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
        {suggestions.length === 0 ? (
          <div className="text-lg font-semibold">All settled.</div>
        ) : isMulti ? (
          // ── 3+ members: show the minimal "who pays whom" list. ──────────────
          <>
            <div className="space-y-1.5 mb-3">
              {suggestions.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-stone-200">{s.from} pays {s.to}</span>
                  <span className="font-semibold tabular-nums">{fmt(s.amount)}</span>
                </div>
              ))}
            </div>
            <button
              onClick={onSettle}
              className="w-full py-2.5 rounded-lg bg-white text-stone-900 text-sm font-medium hover:bg-stone-100 active:scale-[0.99] transition flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Record payments
            </button>
          </>
        ) : (
          // ── 2 members: keep the original single-payment flow. ───────────────
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
        )}
      </div>

      {/* ── Export the group (CSV download + printable PDF) ───────────────────
       *  CSV downloads the expense rows; "Save as PDF" opens a print-friendly
       *  report in a new window and triggers the browser's print dialog. */}
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium mb-2">Export</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onExportCsv}
            className="py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50 flex items-center justify-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
          <button
            onClick={onExportPdf}
            className="py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50 flex items-center justify-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            Save as PDF
          </button>
        </div>
        <div className="text-[11px] text-stone-500 mt-1.5 leading-snug">
          CSV downloads all expenses. "Save as PDF" opens a printable summary — choose "Save as PDF" in the print dialog.
        </div>
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

function GroupsModal({ groups, activeGroupId, myName, profile, startView = 'list', startGroup = null, onClose, onSwitch, onCreateGroup, onUpdateGroup, onRequestDelete, onAddPerson, onRemovePerson, onLinkGhost, onInviteGhost }) {
  // view can be: 'list' | 'form' | 'members'
  // The caller can ask the modal to OPEN on a specific view via `startView`:
  //   'form'    → jump straight to the "New group" form (skip the list step).
  //   'members' → jump straight to the People panel for `startGroup`.
  // Anything else (or unset) opens on the normal groups list.
  const [view, setView] = useState(startView);
  // editingGroup decides whether the 'form' view CREATES or EDITS.
  //   • Opening on 'form' with a startGroup → edit THAT group (pre-filled).
  //     This is what the in-group "Edit" action uses so the owner never has to
  //     back out to the list to rename / change a group's currency.
  //   • Opening on 'form' with no startGroup → create a NEW group (null).
  //   • Edit-an-existing-group from the list still works via setEditingGroup.
  const [editingGroup, setEditingGroup] = useState(
    startView === 'form' ? startGroup : null
  );
  // managingGroup is set when the user opens the Members panel for a group.
  // If the caller asked to open straight on 'members', seed it with startGroup.
  const [managingGroup, setManagingGroup] = useState(
    startView === 'members' ? startGroup : null
  );
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
                      isActive ? 'border-indigo-600 bg-indigo-50' : 'border-stone-200 bg-white hover:border-stone-400'
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
                        {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white">Active</span>}
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
                className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center justify-center gap-1.5"
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
            onLinkGhost={(ghostName, userId) =>
              onLinkGhost(managingGroup.id, ghostName, userId)
            }
            onInviteGhost={(email, ghostName) =>
              onInviteGhost(managingGroup.id, email, managingGroup.name, ghostName)
            }
          />
        ) : (
          <GroupForm
            group={editingGroup}
            myName={myName}
            profile={profile}
            onSave={async (groupData) => {
              if (editingGroup) {
                // Editing an existing group — name, type, and currency can change.
                await onUpdateGroup(editingGroup.id, groupData.name, groupData.type, groupData.currency);
              } else {
                // Creating a new group.
                await onCreateGroup(groupData.name, groupData.type, groupData.extraPeople || [], groupData.currency);
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
 *   "you"        — the signed-in owner
 *   (no badge)   — real connected user
 *   "not on app" — ghost member (ghost_name set, user_id null)
 *
 * Lets the owner:
 *   - Add a new ghost by typing a name (calls onAddPerson)
 *   - Remove a ghost (calls onRequestRemove, which triggers a ConfirmDialog)
 *   - Link a ghost to a real connected user (calls onLinkGhost)
 *
 * Real connected members (non-ghost) cannot be removed or linked here.
 *
 * TODO(link-ghost): The linking seam is now ACTIVE. If the owner later wants
 * to also allow UNLINKING (converting a real member back to a ghost, or
 * transferring the ghost row to a different user), that would be a separate
 * action — add a new store action `unlinkRealUser` and add a button here.
 * The row-id preservation approach (update in place) means that direction
 * of change is also safe for existing expenses.
 */
function MembersPanel({ group, myName, onAddPerson, onRequestRemove, onLinkGhost, onInviteGhost }) {
  const { user } = useAuth();
  // Load the owner's accepted connections so we can offer them as link targets.
  const { accepted } = useConnections();

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  // linkingGhost: the ghost's display name that is currently open for linking,
  // or null if no picker is open.
  const [linkingGhost, setLinkingGhost] = useState(null);

  // confirmLink: { ghostName, realUser: { id, display_name, email } } when
  // the owner has chosen a real user and we're waiting for their confirmation.
  const [confirmLink, setConfirmLink] = useState(null);

  // linking: true while the store action is in flight, so we can disable the button.
  const [linking, setLinking] = useState(false);

  // ── Invite-by-email state ────────────────────────────────────────────────
  // invitingGhost: the ghost's display name whose email input is currently open,
  // or null when the invite panel is closed.
  const [invitingGhost, setInvitingGhost] = useState(null);

  // inviteEmail: what the owner has typed into the invite email field.
  const [inviteEmail, setInviteEmail] = useState('');

  // inviteSending: true while the Edge Function call is in flight.
  const [inviteSending, setInviteSending] = useState(false);

  // inviteResult: { ok, message } after an attempt, or null before one.
  // Keyed by ghost name so each row tracks its own result independently.
  const [inviteResults, setInviteResults] = useState({}); // { [ghostName]: { ok, message } }

  // Open (or close) the invite panel for a specific ghost.
  // Closing clears the email field and any prior result for that ghost.
  const openInvitePanel = (ghostName) => {
    if (invitingGhost === ghostName) {
      // Already open — close it.
      setInvitingGhost(null);
      setInviteEmail('');
    } else {
      // Switch to this ghost's panel; close the link picker if it was open.
      setInvitingGhost(ghostName);
      setInviteEmail('');
      setLinkingGhost(null);
    }
  };

  // Send the invite: validate, call the store action, store the result inline.
  const handleSendInvite = async (ghostName) => {
    const trimmedEmail = inviteEmail.trim();

    // Simple email-shape check: must contain @ and at least one dot after it.
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
    if (!trimmedEmail || !looksLikeEmail) {
      setInviteResults(prev => ({
        ...prev,
        [ghostName]: { ok: false, message: 'Please enter a valid email address.' },
      }));
      return;
    }

    setInviteSending(true);
    // onInviteGhost is threaded from GroupsModal and calls actions.inviteGhostByEmail.
    const result = await onInviteGhost(trimmedEmail, ghostName);
    setInviteSending(false);

    // Store the email alongside the result so the success line can show it
    // even after the inviteEmail input state is later cleared.
    setInviteResults(prev => ({ ...prev, [ghostName]: { ...result, sentTo: trimmedEmail } }));

    if (result?.ok) {
      // Success: collapse the panel after a short delay so the user sees
      // the green confirmation line, then it tidies itself up.
      setTimeout(() => {
        setInvitingGhost(null);
        setInviteEmail('');
        // Clear the success message so it doesn't linger if reopened later.
        setInviteResults(prev => {
          const copy = { ...prev };
          delete copy[ghostName];
          return copy;
        });
      }, 3000);
    }
  };

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setAdding(true);
    await onAddPerson(trimmed);
    setNewName('');
    setAdding(false);
  };

  // Build the list of real users the owner can link a ghost to.
  // Each accepted connection row has requester/addressee ids and _profile objects.
  // The "other" person is whoever is NOT the current signed-in user.
  const linkCandidates = accepted.map(conn => {
    const isRequester = conn.requester === user?.id;
    // Pick the profile of the other person (not the current user).
    const otherProfile = isRequester ? conn.addressee_profile : conn.requester_profile;
    if (!otherProfile) return null;
    return {
      id:           otherProfile.id,
      display_name: otherProfile.display_name || otherProfile.email || 'Unknown',
      email:        otherProfile.email || '',
    };
  }).filter(Boolean); // drop any rows where the profile lookup returned null

  const handleConfirmLink = async () => {
    if (!confirmLink) return;
    setLinking(true);
    await onLinkGhost(confirmLink.ghostName, confirmLink.realUser.id);
    setLinking(false);
    setConfirmLink(null);
    setLinkingGhost(null);
  };

  const people = group?.people || [];
  const memberMeta = group?._memberMeta || {};
  const memberAvatars = group?._memberAvatars || {};

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
            const isPickerOpen = linkingGhost === personName;

            return (
              <div key={personName} className="px-3 py-2.5">
                <div className="flex items-center gap-3">
                  {/* Avatar: real members show their photo (or initials);
                      ghosts keep the little ghost icon so they read as "no
                      account yet". memberAvatars is empty before db/08. */}
                  {isGhost ? (
                    <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center shrink-0">
                      <Ghost className="w-4 h-4 text-stone-400" />
                    </div>
                  ) : (
                    <Avatar name={personName} url={memberAvatars[personName]} size={32} />
                  )}

                  {/* Name and badges */}
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
                    </div>

                    {/* Ghost-member action buttons: "Link to account" and
                     *  "Invite by email" — both shown only for ghost rows.
                     *
                     *  Link to account:
                     *    Shows when the owner has at least one accepted connection.
                     *    If they have none yet, a muted hint points them to Connections.
                     *
                     *    TODO(link-ghost): If we later want auto-suggestions (e.g. fuzzy-
                     *    match the ghost name against connection display names), add that
                     *    filtering here: filter linkCandidates by name similarity before
                     *    rendering the picker list.
                     *
                     *  Invite by email:
                     *    Always available for ghost members. Reveals a small inline email
                     *    input + Send button when clicked. Calls onInviteGhost which
                     *    hits the `send-invite` Edge Function. */}
                    {isGhost && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {/* "Link to account" button (or hint if no connections) */}
                        {linkCandidates.length === 0 ? (
                          <span className="text-[10px] text-stone-400 leading-snug">
                            Connect with this person first (in Connections) to link them.
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setLinkingGhost(isPickerOpen ? null : personName);
                              // Close the invite panel if it was open for this ghost.
                              if (invitingGhost === personName) {
                                setInvitingGhost(null);
                                setInviteEmail('');
                              }
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-300 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition"
                          >
                            {isPickerOpen ? 'Cancel' : 'Link to account'}
                          </button>
                        )}

                        {/* "Invite by email" toggle button */}
                        <button
                          onClick={() => openInvitePanel(personName)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-stone-300 text-stone-600 bg-stone-50 hover:bg-stone-100 transition"
                        >
                          {invitingGhost === personName ? 'Cancel invite' : 'Invite by email'}
                        </button>
                      </div>
                    )}
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

                {/* Inline connection picker — expands below the row when open.
                 *  Lists every accepted connection. Tapping one moves to the
                 *  confirm step (a ConfirmDialog) so the owner can't link
                 *  by accident. */}
                {isGhost && isPickerOpen && (
                  <div className="mt-2 ml-11 space-y-1">
                    <div className="text-[10px] text-stone-500 uppercase tracking-wider font-medium mb-1">
                      Choose who {personName} really is:
                    </div>
                    {linkCandidates.map(candidate => (
                      <button
                        key={candidate.id}
                        onClick={() => setConfirmLink({ ghostName: personName, realUser: candidate })}
                        className="w-full text-left px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 hover:border-indigo-400 hover:bg-indigo-50 transition text-sm"
                      >
                        <div className="font-medium text-stone-900">{candidate.display_name}</div>
                        {candidate.email && (
                          <div className="text-[10px] text-stone-400">{candidate.email}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Inline invite-by-email panel — expands below the row when
                 *  the "Invite by email" button is clicked for this ghost.
                 *  Shows an email input + Send button, a "Sending…" state,
                 *  and a green success or rose error line after the attempt. */}
                {isGhost && invitingGhost === personName && (
                  <div className="mt-2 ml-11 space-y-1.5">
                    <div className="text-[10px] text-stone-500 uppercase tracking-wider font-medium">
                      Email address for {personName}:
                    </div>

                    {/* Show the result line if we already tried for this ghost. */}
                    {inviteResults[personName] && (
                      inviteResults[personName].ok ? (
                        <div className="text-[11px] text-emerald-700 font-medium">
                          Invitation sent to {inviteResults[personName].sentTo || ''}
                        </div>
                      ) : (
                        <div className="text-[11px] text-rose-600">
                          {inviteResults[personName].message}
                        </div>
                      )
                    )}

                    {/* Only show the input + button when no success yet. */}
                    {!inviteResults[personName]?.ok && (
                      <div className="flex gap-2">
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => {
                            setInviteEmail(e.target.value);
                            // Clear any previous error so it doesn't linger while
                            // the owner is typing a corrected address.
                            if (inviteResults[personName] && !inviteResults[personName].ok) {
                              setInviteResults(prev => {
                                const copy = { ...prev };
                                delete copy[personName];
                                return copy;
                              });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !inviteSending) handleSendInvite(personName);
                          }}
                          placeholder="their@email.com"
                          disabled={inviteSending}
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500 disabled:bg-stone-50"
                        />
                        <button
                          onClick={() => handleSendInvite(personName)}
                          disabled={inviteSending || !inviteEmail.trim()}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:bg-stone-300 shrink-0"
                        >
                          {inviteSending ? 'Sending…' : 'Send'}
                        </button>
                      </div>
                    )}

                    <div className="text-[10px] text-stone-400 leading-snug">
                      They will get an email with a link to sign up and join the group.
                      Once they sign up, use "Link to account" to connect them.
                    </div>
                  </div>
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
              className="flex-1 px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500"
              disabled={adding}
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || adding}
              className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-stone-300 flex items-center gap-1.5 shrink-0"
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

      {/* Confirm dialog for linking a ghost to a real user.
       *  Rendered at z-50 (above the modal stack) so it floats on top.
       *  Message reminds the owner that past expenses stay attached — the row
       *  id is preserved (UPDATE in place, not delete + reinsert). */}
      {confirmLink && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4"
          onClick={() => !linking && setConfirmLink(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-base mb-2">
              Link {confirmLink.ghostName} to {confirmLink.realUser.display_name}?
            </h3>
            <p className="text-sm text-stone-600 mb-4">
              Their past expenses stay attached — only the name updates to{' '}
              <span className="font-medium">{confirmLink.realUser.display_name}</span>.
              This cannot be undone from the app.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmLink(null)}
                disabled={linking}
                className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLink}
                disabled={linking}
                className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-stone-300"
              >
                {linking ? 'Linking…' : 'Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupForm({ group, myName, profile, onSave, onCancel }) {
  const isNew = !group;
  const [name, setName] = useState(group?.name || '');
  // For an existing group, derive the type from how many people it has.
  const initialType = group ? (group.type || (group.people?.length === 1 ? 'solo' : 'shared')) : 'shared';
  const [type, setType] = useState(initialType);

  // Per-group currency. When EDITING, default to the group's current currency.
  // When CREATING, default to the user's PROFILE preference first (their chosen
  // currency wins), then the device-region guess, else 'USD'. The user can
  // change it either way.
  const initialCurrency = isNew
    ? (profile?.preferred_currency || localeDefaultCurrency() || 'USD')
    : (group.currency || 'USD');
  const [currency, setCurrency] = useState(initialCurrency);

  // For a NEW shared group the owner can add more than one other person up
  // front. We collect their names into `extraPeople` (a list of chips). The
  // `personDraft` is the text currently typed in the add field.
  // For an EXISTING group we don't edit members here (managed separately), so
  // we seed the list from the current non-owner people just for display.
  const initialExtra = (group?.people || []).filter(p => p !== myName);
  const [extraPeople, setExtraPeople] = useState(initialExtra);
  const [personDraft, setPersonDraft] = useState('');

  const hasExpenses = (group?.expenses?.length || 0) > 0;
  // A new shared group needs at least one other person; solo needs none.
  const valid = name.trim() && (type === 'solo' || extraPeople.length > 0);

  // Add the typed name to the list (ignore blanks and case-insensitive dupes).
  const addPerson = () => {
    const n = personDraft.trim();
    if (!n) return;
    const exists = extraPeople.some(p => p.toLowerCase() === n.toLowerCase())
      || n.toLowerCase() === myName.toLowerCase();
    if (!exists) setExtraPeople([...extraPeople, n]);
    setPersonDraft('');
  };

  const removePerson = (n) => setExtraPeople(extraPeople.filter(p => p !== n));

  const save = () => {
    if (!valid) return;
    onSave({
      name: name.trim(),
      type,
      // The chosen currency code (e.g. 'USD', 'EUR'). Passed through to
      // createGroup / updateGroup in the store.
      currency,
      // Extra people beyond the owner — only sent for new groups. The store
      // already accepts an array; these become ghost members.
      extraPeople: type === 'shared' ? extraPeople : [],
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
            className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500"
            autoFocus
          />
        </Field>

        <Field label="Currency">
          {/* Each group has its own currency. This is display-only — amounts
              are never converted, we just show this symbol in the group. */}
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white focus:outline-none focus:border-indigo-500"
          >
            {Object.entries(CURRENCIES).map(([code, symbol]) => (
              <option key={code} value={code}>{symbol} {code}</option>
            ))}
          </select>
        </Field>

        <Field label="Type">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setType('shared')}
              disabled={!isNew && hasExpenses}
              className={`py-3 rounded-lg border text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                type === 'shared' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
              }`}
            >
              <Users className="w-4 h-4 inline mr-1.5" />
              Shared
            </button>
            <button
              onClick={() => setType('solo')}
              disabled={!isNew && hasExpenses}
              className={`py-3 rounded-lg border text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                type === 'solo' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
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
          <Field label="Other people">
            {/* New group: a full multi-person adder. Existing group: members
                are managed separately, so we just show them read-only. */}
            {isNew ? (
              <>
                {/* Type a name, press Add (or Enter), and it becomes a chip. */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={personDraft}
                    onChange={(e) => setPersonDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } }}
                    placeholder="Name"
                    className="flex-1 px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={addPerson}
                    disabled={!personDraft.trim()}
                    className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-stone-300 flex items-center gap-1.5 shrink-0"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add
                  </button>
                </div>

                {/* The people added so far, each removable. */}
                {extraPeople.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {extraPeople.map(p => (
                      <span
                        key={p}
                        className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-stone-100 border border-stone-200 text-sm text-stone-700"
                      >
                        {p}
                        <button
                          type="button"
                          onClick={() => removePerson(p)}
                          className="p-0.5 text-stone-400 hover:text-red-600 rounded-full"
                          title={`Remove ${p}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="text-[11px] text-stone-500 mt-1.5 leading-snug">
                  You are <span className="font-medium">{myName}</span>. Add one or more
                  people to split with — they don't need an account.
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {extraPeople.length === 0 ? (
                    <span className="text-sm text-stone-400">No other members.</span>
                  ) : extraPeople.map(p => (
                    <span key={p} className="inline-flex items-center px-3 py-1 rounded-full bg-stone-100 border border-stone-200 text-sm text-stone-700">
                      {p}
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-stone-500 mt-1">
                  You are <span className="font-medium">{myName}</span>.
                  <span className="block text-amber-700 mt-1">Member list is managed separately for existing groups.</span>
                </div>
              </>
            )}
          </Field>
        )}
      </div>

      <div className="sticky bottom-0 bg-white border-t border-stone-200 px-4 py-3 flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50">
          Cancel
        </button>
        <button onClick={save} disabled={!valid} className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-stone-300">
          {isNew ? 'Create' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ============ Settle modal ============ */

function SettleModal({ balances, people, entries, onClose, onConfirm, onRecord }) {
  // For 3+ members we show a "who pays whom" list instead of a single form.
  if (people.length >= 3) {
    return (
      <MultiSettleModal
        people={people}
        entries={entries}
        onClose={onClose}
        onRecord={onRecord}
      />
    );
  }

  // ── 2-person flow (unchanged): one payment form. ──────────────────────────
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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">{currencySymbol}</span>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-stone-300 text-sm tabular-nums focus:outline-none focus:border-indigo-500"
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
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500"
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

/* ============ Multi-person settle modal (3+ members) ============
 *
 * Shows the minimal "who pays whom" list from the greedy algorithm. Each row
 * has a "Record" button that inserts that settlement WITHOUT closing the modal,
 * so the user can clear several debts in a row. After each record the parent
 * refetches, `entries` updates, and the suggestions recompute automatically.
 */
function MultiSettleModal({ people, entries, onClose, onRecord }) {
  // Track which rows are mid-write so we can disable their buttons.
  const [busyKey, setBusyKey] = useState(null);

  // Recompute net balances + suggestions on every render (entries change after
  // each recorded payment because the parent refetches).
  const net = computeNetBalances(people, entries || []);
  const suggestions = suggestSettlements(net);

  const handleRecord = async (s) => {
    const key = `${s.from}->${s.to}:${s.amount}`;
    setBusyKey(key);
    await onRecord({ from: s.from, to: s.to, amount: s.amount, note: 'Settle up' });
    // Parent refetch will re-render with fresh suggestions; clear busy flag.
    setBusyKey(null);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-stone-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold">Settle up</h2>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-sm text-stone-600">
            The fewest payments that clear everyone's balance:
          </div>

          {suggestions.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
              <div className="text-2xl mb-1">🎉</div>
              <div className="font-semibold text-emerald-900">Everyone is settled up.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s) => {
                const key = `${s.from}->${s.to}:${s.amount}`;
                const busy = busyKey === key;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 border border-stone-200 rounded-xl px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">
                        {s.from} pays {s.to}
                      </div>
                      <div className="text-lg font-semibold tabular-nums">{fmt(s.amount)}</div>
                    </div>
                    <button
                      onClick={() => handleRecord(s)}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-stone-300 shrink-0 flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      {busy ? 'Saving…' : 'Record'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-stone-200 px-4 py-3">
          <button onClick={onClose} className="w-full py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Done
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

  // ── "Split among" state (only used for the equal / full split modes) ─────────
  // Which members this expense is split among. We keep a plain map
  // { personName: true/false }. Defaults:
  //   • Editing an existing expense → start from its frozen participants (names),
  //     falling back to "everyone" if the expense has none (legacy rows).
  //   • A brand-new expense → everyone is checked.
  // Personal (payer only) and Custom (its per-person rows already say who's in)
  // don't use this — we hide the section for those two modes.
  const [splitAmong, setSplitAmong] = useState(() => {
    const start = {};
    // The set of names to pre-check. expense.participants is an array of NAMES
    // attached by the read layer (or undefined on a fresh add).
    const initial = (expense?.participants && expense.participants.length)
      ? expense.participants
      : people;
    people.forEach(p => { start[p] = initial.includes(p); });
    return start;
  });

  // The names currently checked, in the people order (used for the guard + save).
  const splitAmongNames = people.filter(p => splitAmong[p]);

  // Toggle one person in/out of the split.
  const toggleSplitAmong = (p) =>
    setSplitAmong(s => ({ ...s, [p]: !s[p] }));

  // "All" convenience: check everyone at once.
  const selectAllSplitAmong = () => {
    const next = {};
    people.forEach(p => { next[p] = true; });
    setSplitAmong(next);
  };

  // ── Custom split state ──────────────────────────────────────────────────────
  // customMode: 'amount' (people type currency amounts) or 'percent' (they type
  //   percentages that we convert to amounts on save).
  // customVals: a plain map { personName: "stringValue" } — we keep the raw
  //   string the user typed so the input behaves naturally (e.g. half-typed
  //   numbers), and parse to a number only when we need to do math.
  const [customMode, setCustomMode] = useState('amount');
  const [customVals, setCustomVals] = useState(() => {
    // If we're editing an existing custom expense, pre-fill from its splitDetail
    // (which is amounts, keyed by name). Otherwise start everyone at empty.
    const start = {};
    people.forEach(p => {
      const existing = expense?.splitDetail?.[p];
      start[p] = (existing != null) ? String(existing) : '';
    });
    return start;
  });

  useEffect(() => {
    if (isNew) setTimeout(() => nameRef.current?.focus(), 50);
  }, [isNew]);

  useEffect(() => {
    if (catManuallySet) return;
    if (!name.trim()) return;
    setCategory(autoCategorize(name));
  }, [name, catManuallySet]);

  // The expense total as a number (0 if blank/invalid). Used by the custom
  // editor for the "Assigned of total" math and the equal-split helper.
  const totalAmount = parseFloat(amount) || 0;

  // ── Custom-split math (only meaningful when splitMode === 'custom') ──────────
  // Round a number to whole cents to avoid floating-point dust.
  const roundCents = (n) => Math.round(n * 100) / 100;

  // Sum of whatever the user has typed, as numbers (blank = 0).
  const customSum = people.reduce((s, p) => s + (parseFloat(customVals[p]) || 0), 0);

  // For 'amount' mode the target is the expense total; for 'percent' it's 100.
  const customTarget = customMode === 'percent' ? 100 : totalAmount;

  // Is the custom split complete? Amounts must equal the total within a cent
  // (0.005); percentages must sum to ~100 (a slightly looser 0.05 so typing
  // 33.33 three times = 99.99 still counts as balanced). We also require a
  // positive total to compare against.
  const customEpsilon = customMode === 'percent' ? 0.05 : 0.005;
  const customComplete =
    splitMode !== 'custom' ||
    (totalAmount > 0 && Math.abs(customSum - customTarget) < customEpsilon);

  // Build the final { name: amount } map that sums EXACTLY to the total.
  // - amount mode: use the typed amounts (rounded to cents), then nudge the
  //   LAST participant so the rounded amounts add up to the total exactly.
  // - percent mode: amount = percent/100 * total (rounded), then assign any
  //   rounding remainder to the LAST participant.
  // In both cases people with a 0/blank value are dropped (they owe nothing).
  const buildSplitDetail = () => {
    // Decide participants (anyone with a value > 0). Keep the people order.
    const participants = people.filter(p => (parseFloat(customVals[p]) || 0) > 0);
    if (participants.length === 0) return {};

    const detail = {};
    let running = 0;
    participants.forEach((p, i) => {
      const raw = parseFloat(customVals[p]) || 0;
      let amt;
      if (customMode === 'percent') {
        amt = roundCents((raw / 100) * totalAmount);
      } else {
        amt = roundCents(raw);
      }
      if (i === participants.length - 1) {
        // Last person absorbs any rounding remainder so the parts sum EXACTLY
        // to the expense total.
        amt = roundCents(totalAmount - running);
      }
      running = roundCents(running + amt);
      detail[p] = amt;
    });
    return detail;
  };

  // Fill the per-person inputs with an equal split (amounts or percentages).
  const splitEqually = () => {
    const n = people.length;
    if (n === 0) return;
    const next = {};
    if (customMode === 'percent') {
      // Equal percentages; give the remainder to the last person so it sums 100.
      const each = Math.floor((100 / n) * 100) / 100;
      people.forEach((p, i) => {
        next[p] = String(i === n - 1 ? roundCents(100 - each * (n - 1)) : each);
      });
    } else {
      const each = roundCents(totalAmount / n);
      people.forEach((p, i) => {
        next[p] = String(i === n - 1 ? roundCents(totalAmount - each * (n - 1)) : each);
      });
    }
    setCustomVals(next);
  };

  // Does the active split mode use the "Split among" picker? Only equal & full.
  // (personal = payer only; custom = its own per-person rows decide who's in.)
  const usesSplitAmong = !isSolo && (splitMode === 'equal' || splitMode === 'full');

  // For equal/full we require at least one person to split among.
  const splitAmongOk = !usesSplitAmong || splitAmongNames.length > 0;

  const valid =
    name.trim() && parseFloat(amount) > 0 && date &&
    // For a custom split the per-person values must add up correctly.
    customComplete &&
    // For equal/full at least one participant must be picked.
    splitAmongOk;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const finalMode = isSolo ? 'personal' : splitMode;
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
      splitMode: finalMode,
      // Only custom splits carry per-person amounts; every other mode leaves
      // this undefined so the store stores null (no per-person detail).
      splitDetail: finalMode === 'custom' ? buildSplitDetail() : undefined,
      // For equal/full, pass the chosen participant NAMES so the store can save
      // exactly who this expense is split among. For personal/custom we leave
      // this undefined and let the store derive it (custom → people with
      // amounts; personal/none → all members on insert, preserved on update).
      participants: (finalMode === 'equal' || finalMode === 'full')
        ? splitAmongNames
        : undefined,
    });
    setSaving(false);
  };

  // When the user switches INTO custom mode and hasn't typed anything yet,
  // pre-fill an equal split so they just edit a few numbers instead of starting
  // from blank. We only do this if every value is currently empty.
  useEffect(() => {
    if (splitMode !== 'custom') return;
    const allEmpty = people.every(p => !customVals[p]);
    if (allEmpty) {
      const n = people.length;
      if (n === 0) return;
      const next = {};
      if (customMode === 'percent') {
        const each = Math.floor((100 / n) * 100) / 100;
        people.forEach((p, i) => {
          next[p] = String(i === n - 1 ? roundCents(100 - each * (n - 1)) : each);
        });
      } else {
        const each = roundCents(totalAmount / n);
        people.forEach((p, i) => {
          next[p] = String(i === n - 1 ? roundCents(totalAmount - each * (n - 1)) : each);
        });
      }
      setCustomVals(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitMode, customMode]);

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
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500"
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
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">{currencySymbol}</span>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-stone-300 text-sm tabular-nums focus:outline-none focus:border-indigo-500"
                />
              </div>
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500"
              />
            </Field>
          </div>

          <Field label="Category">
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setCatManuallySet(true); }}
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white focus:outline-none focus:border-indigo-500"
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
                        paidBy === p ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
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
                <div className="grid grid-cols-4 gap-2">
                  {SPLIT_MODES.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSplitMode(m.id)}
                      className={`py-2 px-1 rounded-lg border text-xs font-medium transition ${
                        splitMode === m.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
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
                  {splitMode === 'custom' && "Type each person's share below. Leave someone blank/0 to leave them out."}
                </div>

                {/* ── Split among (who's included) ─────────────────────────────
                 *  Shown only for the equal & full modes. One toggle chip per
                 *  member: tap to include/exclude them from this expense. This
                 *  lets you fix an expense where someone was wrongly included.
                 *  Custom hides this (its amount rows already say who's in);
                 *  personal hides it (it's just the payer). */}
                {usesSplitAmong && (
                  <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-medium text-stone-600">Split among</div>
                      <button
                        type="button"
                        onClick={selectAllSplitAmong}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        All
                      </button>
                    </div>
                    {/* A chip per member; indigo when included, plain when not. */}
                    <div className="flex flex-wrap gap-2">
                      {people.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => toggleSplitAmong(p)}
                          aria-pressed={!!splitAmong[p]}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition truncate max-w-[10rem] ${
                            splitAmong[p]
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white border-stone-300 text-stone-600 hover:border-stone-500'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    {/* Min-one guard: Save is disabled (via `valid`) until at
                     *  least one person is picked; this hint explains why. */}
                    {splitAmongNames.length === 0 && (
                      <div className="text-amber-700 text-[11px] mt-2">
                        Pick at least one person to split among.
                      </div>
                    )}
                  </div>
                )}

                {/* ── Custom split editor ─────────────────────────────────────
                 *  One numeric input per person, plus an "amount vs %" toggle and
                 *  a "Split equally" helper. The Save button is blocked until the
                 *  parts add up (amounts → the total; percentages → 100). */}
                {splitMode === 'custom' && (
                  <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2.5">
                    {/* By amount / By % toggle + Split equally */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex rounded-lg border border-stone-300 overflow-hidden text-xs">
                        <button
                          type="button"
                          onClick={() => setCustomMode('amount')}
                          className={`px-3 py-1.5 font-medium transition ${
                            customMode === 'amount' ? 'bg-indigo-600 text-white' : 'bg-white text-stone-600 hover:bg-stone-100'
                          }`}
                        >
                          By amount
                        </button>
                        <button
                          type="button"
                          onClick={() => setCustomMode('percent')}
                          className={`px-3 py-1.5 font-medium transition border-l border-stone-300 ${
                            customMode === 'percent' ? 'bg-indigo-600 text-white' : 'bg-white text-stone-600 hover:bg-stone-100'
                          }`}
                        >
                          By %
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={splitEqually}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        Split equally
                      </button>
                    </div>

                    {/* Per-person inputs */}
                    <div className="space-y-1.5">
                      {people.map(p => (
                        <div key={p} className="flex items-center gap-2">
                          <div className="flex-1 text-sm text-stone-700 truncate">{p}</div>
                          <div className="relative w-28">
                            {customMode === 'amount' && (
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-sm">{currencySymbol}</span>
                            )}
                            <input
                              type="number"
                              step={customMode === 'percent' ? '0.1' : '0.01'}
                              inputMode="decimal"
                              value={customVals[p] ?? ''}
                              onChange={(e) => setCustomVals(v => ({ ...v, [p]: e.target.value }))}
                              placeholder="0"
                              className={`w-full ${customMode === 'amount' ? 'pl-6' : 'pl-2.5'} pr-6 py-1.5 rounded-lg border border-stone-300 text-sm text-right tabular-nums bg-white focus:outline-none focus:border-indigo-500`}
                            />
                            {customMode === 'percent' && (
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-sm">%</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Running total + remaining / over-by message */}
                    <div className="pt-1 border-t border-stone-200 text-[11px] leading-snug">
                      {customMode === 'percent' ? (
                        <div className="flex items-center justify-between">
                          <span className="text-stone-500">
                            Assigned: {roundCents(customSum)}% of 100%
                          </span>
                          <span className={customComplete ? 'text-emerald-700 font-medium' : 'text-stone-500'}>
                            {customComplete ? 'Balanced' : `${roundCents(100 - customSum)}% left`}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-stone-500">
                            Assigned: {fmt(roundCents(customSum))} of {fmt(totalAmount)}
                          </span>
                          <span className={customComplete ? 'text-emerald-700 font-medium' : 'text-stone-500'}>
                            {customComplete ? 'Balanced' : `${fmt(roundCents(totalAmount - customSum))} left`}
                          </span>
                        </div>
                      )}
                      {!customComplete && totalAmount > 0 && (
                        <div className="text-amber-700 mt-1">
                          {customMode === 'percent'
                            ? 'Percentages must add up to 100% before you can save.'
                            : `Amounts must add up to the ${fmt(totalAmount)} total before you can save.`}
                        </div>
                      )}
                      {totalAmount <= 0 && (
                        <div className="text-amber-700 mt-1">Enter the expense amount above first.</div>
                      )}
                    </div>
                  </div>
                )}
              </Field>
            </>
          )}

          <Field label="Note (optional)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any context"
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500"
            />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-stone-200 px-4 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Cancel
          </button>
          <button onClick={save} disabled={!valid || saving} className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-stone-300">
            {saving ? 'Saving…' : isNew ? 'Add' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Import CSV modal ============ */

// A single-modal wizard for importing a CSV of expenses into the active group.
// Steps (all stacked in one scrollable modal):
//   1. Pick a .csv file        → parse it into headers + rows.
//   2. Choose a provider preset → pre-fills the column mapping below.
//   3. Map columns             → which header is Date / Description / Amount / Category.
//   4. Defaults                → who paid (member) and how to split every row.
//   5. Preview                 → first 8 built expenses + "N to import, M skipped".
//   6. Import                  → batch-insert via the store action.
//
// All the heavy lifting (parsing, normalizing, building) lives in csv.js so this
// component just collects choices and shows results.
function ImportModal({ people, isSolo, myName, startMode = 'csv', onClose, onImport, onScan }) {
  // Which source the user is importing from: 'csv' (a spreadsheet file) or
  // 'scan' (a receipt/statement photo or PDF read by AI vision). Both paths
  // end at the SAME preview + "Paid by"/split defaults + Import button below.
  const [mode, setMode] = useState(startMode === 'scan' ? 'scan' : 'csv');

  // Raw parse results.
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [parseError, setParseError] = useState('');

  // Mapping + options (start from the first preset = Generic).
  const [presetId, setPresetId] = useState('generic');
  const [mapping, setMapping] = useState({ date: '', description: '', amount: '', category: '' });
  const [options, setOptions] = useState(PROVIDER_PRESETS[0].options);

  // Defaults applied to every imported row.
  // Default payer = the current user if they're in the group, else first person.
  const [paidByName, setPaidByName] = useState(
    people.includes(myName) ? myName : (people[0] || '')
  );
  const [splitMode, setSplitMode] = useState(isSolo ? 'personal' : 'equal');

  // Outcome state.
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null); // { inserted } on success
  const [importError, setImportError] = useState('');

  // ── Scan state (only used when mode === 'scan') ────────────────────────────
  const [scanning, setScanning] = useState(false);     // spinner while AI reads
  const [scanError, setScanError] = useState('');      // inline error message
  const [scanRows, setScanRows] = useState(null);       // null = nothing scanned yet
  const [scanFileName, setScanFileName] = useState(''); // name of the picked file

  // ── Scan: turn the picked image/PDF into base64 + read it via AI ───────────
  const handleScanFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError('');
    setScanRows(null);
    setResult(null);
    setScanFileName(file.name);
    setScanning(true);
    try {
      // FileReader.readAsDataURL gives us a string like
      // "data:image/jpeg;base64,/9j/4AAQ...". The Edge Function wants ONLY the
      // part after the comma, so we strip the "data:<mime>;base64," prefix.
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      const base64   = String(dataUrl).split(',')[1] || '';
      const mimeType = file.type || 'application/octet-stream';

      const res = await onScan(base64, mimeType);
      if (!res?.ok) {
        setScanError(res?.message || 'Scanning failed — please try again.');
        setScanRows(null);
      } else {
        // Map the AI's expenses into the SAME row shape the CSV preview uses:
        //   description → name, keep amount/date, fill category/date sensibly.
        const today = new Date().toISOString().slice(0, 10);
        const mapped = (res.expenses || []).map(ex => {
          const name = (ex.description || '').trim() || 'Expense';
          const hasDate = !!ex.date;
          const row = {
            name,
            amount:   Number(ex.amount) || 0,
            // No readable date → fall back to today and flag it like the CSV flow.
            date:     hasDate ? ex.date : today,
            category: (ex.category || '').trim() || autoCategorize(name),
          };
          if (!hasDate) row._warning = 'No date found — set to today.';
          return row;
        }).filter(r => r.amount > 0);
        setScanRows(mapped);
      }
    } catch (err) {
      setScanError('Could not read that file. Try a clearer photo or a single page.');
      setScanRows(null);
    } finally {
      setScanning(false);
    }
  };

  // ── Step 1: read & parse the chosen file ──────────────────────────────────
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setResult(null);
    setFileName(file.name);
    try {
      const parsed = await parseCsv(file);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      // If a non-generic preset is already chosen, re-apply it to the new headers.
      if (presetId !== 'generic') applyPreset(presetId, parsed.headers);
    } catch (err) {
      setParseError('Could not read that file. Is it a valid CSV?');
      setHeaders([]);
      setRows([]);
    }
  };

  // ── Step 2: choosing a preset pre-fills the mapping dropdowns ──────────────
  // We match the preset's expected header names against the file's real headers
  // case-insensitively, so "cost" matches "Cost".
  const applyPreset = (id, hdrs = headers) => {
    const preset = PROVIDER_PRESETS.find(p => p.id === id) || PROVIDER_PRESETS[0];
    setOptions(preset.options);
    const matchHeader = (wanted) => {
      if (!wanted) return '';
      const found = hdrs.find(h => h.toLowerCase() === wanted.toLowerCase());
      return found || '';
    };
    setMapping({
      date:        matchHeader(preset.mapping.date),
      description: matchHeader(preset.mapping.description),
      amount:      matchHeader(preset.mapping.amount),
      category:    matchHeader(preset.mapping.category),
    });
  };

  const onPresetChange = (id) => {
    setPresetId(id);
    applyPreset(id);
  };

  // ── Step 5: build the preview whenever inputs change ───────────────────────
  // Reuse the app's autoCategorize so categorization stays consistent.
  const csvBuilt = useMemo(() => {
    if (rows.length === 0 || !mapping.amount) return { expenses: [], skipped: 0 };
    return buildExpenses(rows, mapping, options, autoCategorize);
  }, [rows, mapping, options]);

  // `built` is the active source for the shared preview + Import button.
  // CSV mode uses the parsed/mapped rows; scan mode uses the AI's rows.
  const built = mode === 'scan'
    ? { expenses: scanRows || [], skipped: 0 }
    : csvBuilt;

  // Show the shared defaults + preview block once a source has produced rows:
  //   CSV → file parsed (headers found); Scan → at least one expense read.
  const showDefaults = mode === 'csv'
    ? headers.length > 0
    : Array.isArray(scanRows) && scanRows.length > 0;

  const canImport = built.expenses.length > 0 && paidByName && !importing;

  const doImport = async () => {
    if (!canImport) return;
    setImporting(true);
    setImportError('');
    const res = await onImport(built.expenses, { paidByName, splitMode });
    setImporting(false);
    if (res?.error) {
      setImportError(res.error);
    } else {
      setResult(res);
      // Auto-close shortly after success so the user sees the confirmation.
      setTimeout(onClose, 1200);
    }
  };

  // A small reusable mapping dropdown (maps one field to a file header).
  const MapSelect = ({ field, label, optional }) => (
    <Field label={label + (optional ? ' (optional)' : '')}>
      <select
        value={mapping[field]}
        onChange={(e) => setMapping(m => ({ ...m, [field]: e.target.value }))}
        className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white focus:outline-none focus:border-indigo-500"
      >
        <option value="">{optional ? '— none —' : '— choose column —'}</option>
        {headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </Field>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-stone-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            {mode === 'scan'
              ? <><ScanLine className="w-4 h-4 text-stone-500" /> Scan receipt / statement</>
              : <><FileSpreadsheet className="w-4 h-4 text-stone-500" /> Import CSV</>}
          </h2>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">

          {/* Success confirmation replaces the form once imported. */}
          {result ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-3">
                <Check className="w-6 h-6 text-emerald-600" />
              </div>
              <div className="font-semibold text-stone-900">Imported {result.inserted} expense{result.inserted === 1 ? '' : 's'}</div>
              <div className="text-sm text-stone-500 mt-1">Closing…</div>
            </div>
          ) : (
            <>
              {/* ── Source picker: CSV file OR Scan a photo/PDF ──────────────
                  The Scan tab is hidden while SCAN_ENABLED is false, so the
                  modal is CSV-only for now. */}
              {SCAN_ENABLED && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode('csv')}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition ${
                    mode === 'csv' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4" /> CSV file
                </button>
                <button
                  onClick={() => setMode('scan')}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition ${
                    mode === 'scan' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
                  }`}
                >
                  <ScanLine className="w-4 h-4" /> Scan
                </button>
              </div>
              )}

              {/* ── CSV mode: Step 1 file picker ─────────────────────────── */}
              {mode === 'csv' && (
              <Field label="1. Choose a CSV file">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFile}
                  className="w-full text-sm text-stone-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-stone-300 file:bg-stone-50 file:text-sm file:font-medium hover:file:bg-stone-100"
                />
                {fileName && !parseError && (
                  <div className="text-[11px] text-stone-500 mt-1">{fileName} — {rows.length} row{rows.length === 1 ? '' : 's'} found.</div>
                )}
                {parseError && <div className="text-[11px] text-red-600 mt-1">{parseError}</div>}
              </Field>
              )}

              {/* ── Scan mode: pick a photo/PDF, then AI reads it ────────── */}
              {mode === 'scan' && (
              <Field label="Choose a receipt or statement (photo or PDF)">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleScanFile}
                  disabled={scanning}
                  className="w-full text-sm text-stone-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-stone-300 file:bg-stone-50 file:text-sm file:font-medium hover:file:bg-stone-100 disabled:opacity-50"
                />
                {scanFileName && !scanning && !scanError && (
                  <div className="text-[11px] text-stone-500 mt-1">{scanFileName}</div>
                )}
                {scanning && (
                  <div className="flex items-center gap-2 text-sm text-stone-500 mt-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Scanning…
                  </div>
                )}
                {scanError && <div className="text-sm text-rose-600 mt-2">{scanError}</div>}
                {!scanning && !scanError && Array.isArray(scanRows) && scanRows.length === 0 && (
                  <div className="text-sm text-stone-500 mt-2">No expenses found — try a clearer photo or a single page.</div>
                )}
              </Field>
              )}

              {/* CSV-only steps 2 & 3 (preset + column mapping). */}
              {mode === 'csv' && headers.length > 0 && (
                <>
                  {/* ── Step 2: provider preset ─────────────────────────── */}
                  <Field label="2. Provider preset">
                    <select
                      value={presetId}
                      onChange={(e) => onPresetChange(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white focus:outline-none focus:border-indigo-500"
                    >
                      {PROVIDER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    <div className="text-[11px] text-stone-500 mt-1">Pre-fills the columns below. You can still change them.</div>
                  </Field>

                  {/* ── Step 3: column mapping ──────────────────────────── */}
                  <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">3. Map columns</div>
                    <MapSelect field="date" label="Date" />
                    <MapSelect field="description" label="Description" />
                    <MapSelect field="amount" label="Amount" />
                    <MapSelect field="category" label="Category" optional />
                    <Field label="Amount style">
                      <select
                        value={options.amountStyle}
                        onChange={(e) => setOptions(o => ({ ...o, amountStyle: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="absolute">Plain numbers</option>
                        <option value="negative-expense">Negatives are expenses (bank)</option>
                      </select>
                    </Field>
                    <Field label="Date format">
                      <select
                        value={options.dateFormat}
                        onChange={(e) => setOptions(o => ({ ...o, dateFormat: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                        <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                        <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      </select>
                    </Field>
                  </div>
                </>
              )}

              {/* ── Shared (both modes): defaults + preview + import ─────── */}
              {/* Shown once there's something to import: CSV mapped rows, or
                  scanned rows. The preview table, "Paid by"/split defaults, and
                  the Import button are IDENTICAL for CSV and Scan. */}
              {showDefaults && (
                <>
                  {/* ── Defaults: paid by + split ───────────────────────── */}
                  <div className="space-y-3">
                    <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">Defaults for every row</div>
                    <Field label="Paid by">
                      <select
                        value={paidByName}
                        onChange={(e) => setPaidByName(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white focus:outline-none focus:border-indigo-500"
                      >
                        {people.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>
                    {!isSolo && (
                      <Field label="Split">
                        <div className="grid grid-cols-3 gap-2">
                          {SPLIT_MODES.map(m => (
                            <button
                              key={m.id}
                              onClick={() => setSplitMode(m.id)}
                              className={`py-2 px-1 rounded-lg border text-xs font-medium transition ${
                                splitMode === m.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-stone-300 text-stone-700 hover:border-stone-500'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </Field>
                    )}
                  </div>

                  {/* ── Preview ─────────────────────────────────────────── */}
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">Preview</div>
                    {built.expenses.length === 0 ? (
                      <div className="text-sm text-stone-500">Nothing to preview yet.</div>
                    ) : (
                      <>
                        <div className="rounded-xl border border-stone-200 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-stone-50 text-stone-500">
                              <tr>
                                <th className="text-left font-medium px-2 py-1.5">Name</th>
                                <th className="text-right font-medium px-2 py-1.5">Amount</th>
                                <th className="text-left font-medium px-2 py-1.5">Date</th>
                                <th className="text-left font-medium px-2 py-1.5">Category</th>
                              </tr>
                            </thead>
                            <tbody>
                              {built.expenses.slice(0, 8).map((ex, i) => (
                                <tr key={i} className={`border-t border-stone-100 ${ex._warning ? 'bg-amber-50' : ''}`}>
                                  <td className="px-2 py-1.5 truncate max-w-[120px]" title={ex._warning || ''}>{ex.name}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(ex.amount)}</td>
                                  <td className="px-2 py-1.5 tabular-nums">{ex.date}{ex._warning ? ' ⚠️' : ''}</td>
                                  <td className="px-2 py-1.5">{ex.category}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="text-[11px] text-stone-500">
                          Importing {built.expenses.length} expense{built.expenses.length === 1 ? '' : 's'}
                          {built.skipped > 0 && ` (${built.skipped} row${built.skipped === 1 ? '' : 's'} skipped — no valid amount)`}.
                          {built.expenses.some(e => e._warning) && (mode === 'scan'
                            ? ' Highlighted rows had no date — set to today.'
                            : ' Highlighted rows had an unreadable date set to today.')}
                        </div>
                      </>
                    )}
                  </div>

                  {importError && <div className="text-sm text-red-600">{importError}</div>}
                </>
              )}
            </>
          )}
        </div>

        {!result && (
          <div className="sticky bottom-0 bg-white border-t border-stone-200 px-4 py-3 flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50">
              Cancel
            </button>
            <button onClick={doImport} disabled={!canImport} className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-stone-300">
              {importing ? 'Importing…' : `Import${built.expenses.length ? ` ${built.expenses.length}` : ''}`}
            </button>
          </div>
        )}
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
