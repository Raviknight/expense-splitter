// csv.js
// The CSV import "engine" — pure logic, no React, so it could be unit-tested
// on its own. It does four jobs:
//
//   1. parseCsv(file)        — read a File into { headers, rows } using papaparse.
//   2. PROVIDER_PRESETS      — ready-made column mappings (Generic / Splitwise / Bank).
//   3. normalizeAmount/Date  — clean up messy text into a Number / 'YYYY-MM-DD'.
//   4. buildExpenses(...)    — turn raw rows + a mapping into expense objects the
//                              app can save, reporting how many rows were skipped.
//
// Nothing here knows about Supabase or the DOM. The UI (App.jsx) wires it up.

import Papa from 'papaparse';

// ─── 1. parse a CSV file ─────────────────────────────────────────────────────
// Returns a Promise of { headers: string[], rows: object[] }.
// Each row is an object keyed by the header text, e.g. { Date: '...', Cost: '...' }.
// papaparse handles quoted fields, embedded commas, and newlines for us.
export function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,          // first row becomes the object keys
      skipEmptyLines: true,  // ignore blank lines
      transformHeader: (h) => h.trim(), // tidy stray spaces in header names
      complete: (results) => {
        const headers = results.meta?.fields || [];
        const rows = results.data || [];
        resolve({ headers, rows });
      },
      error: (err) => reject(err),
    });
  });
}

// ─── 2. provider presets ─────────────────────────────────────────────────────
// Each preset pre-fills the column mapping so the user usually doesn't have to
// pick columns by hand. `mapping` values are the EXPECTED header names in that
// provider's export. The UI matches them (case-insensitively) against the real
// headers and pre-selects the dropdowns.
//
// To add a new provider later:
//   • add a new object to this array with a unique `id` and human `label`,
//   • set `mapping` to the header names that provider uses for
//     date / description / amount / (optional) category,
//   • set `options.dateFormat` ('YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY')
//     and `options.amountStyle` ('absolute' | 'negative-expense').
// No other code needs to change — the engine and UI read this array generically.
export const PROVIDER_PRESETS = [
  {
    id: 'generic',
    label: 'Generic (map columns yourself)',
    // Empty mapping — the user picks every column manually.
    mapping: { date: '', description: '', amount: '', category: '' },
    options: { dateFormat: 'YYYY-MM-DD', amountStyle: 'absolute' },
  },
  {
    id: 'splitwise',
    label: 'Splitwise export',
    // Splitwise exports a row per expense with a total "Cost" column plus one
    // column per person. We import the total Cost; per-person columns are ignored.
    mapping: { date: 'Date', description: 'Description', amount: 'Cost', category: 'Category' },
    options: { dateFormat: 'YYYY-MM-DD', amountStyle: 'absolute' },
  },
  {
    id: 'bank',
    label: 'Bank statement',
    // Typical bank export. Amounts are often negative for money spent, so we use
    // the 'negative-expense' style (negatives are treated as expenses; we take
    // the absolute value). No category column in most bank exports.
    mapping: { date: 'Date', description: 'Description', amount: 'Amount', category: '' },
    options: { dateFormat: 'MM/DD/YYYY', amountStyle: 'negative-expense' },
  },
];

// ─── 3a. normalize an amount string → positive Number ────────────────────────
// Handles: currency symbols ($, €, £, ₹), thousands commas, parentheses or a
// leading minus for negatives. Always returns the ABSOLUTE value because every
// imported row becomes an expense (a positive amount). Returns null if the text
// doesn't contain a real number, so the caller can skip that row.
//
// amountStyle is accepted for clarity but does not change the result here:
// because we always take the absolute value, 'absolute' and 'negative-expense'
// produce the same positive number. (amountStyle is kept so the UI can label
// the behaviour and so future styles, e.g. "skip positive deposits", are easy
// to add.)
export function normalizeAmount(str, amountStyle = 'absolute') {
  if (str === null || str === undefined) return null;
  let s = String(str).trim();
  if (!s) return null;

  // Strip everything that isn't a digit, dot, minus, or comma. This also removes
  // currency symbols ($, €, £, ₹) and accounting parentheses like (12.50).
  s = s.replace(/[^0-9.,\-]/g, '');

  // Remove thousands commas (1,234.56 → 1234.56). We assume '.' is the decimal.
  s = s.replace(/,/g, '');

  const num = parseFloat(s);
  if (!Number.isFinite(num)) return null;

  // Always positive — expenses are stored as positive amounts. This is why both
  // amountStyle values ('absolute' and 'negative-expense') yield the same result.
  return Math.abs(num);
}

// ─── 3b. normalize a date string → 'YYYY-MM-DD' ──────────────────────────────
// Accepts the common shapes and uses the dateFormat hint to resolve the
// ambiguous numeric case (is "03/04/2025" March 4th or April 3rd?).
// Returns { date: 'YYYY-MM-DD', guessed: bool }.
//   • guessed = false → parsed cleanly.
//   • guessed = true  → could not parse; fell back to TODAY so the row still
//                       imports, but the UI should flag it.
export function normalizeDate(str, dateFormat = 'YYYY-MM-DD') {
  const today = new Date().toISOString().slice(0, 10);
  if (!str) return { date: today, guessed: true };

  const s = String(str).trim();

  // Already ISO 'YYYY-MM-DD' (optionally with a time part we ignore).
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return { date: iso(y, mo, d), guessed: false };
  }

  // Slash- or dash-separated numeric date: 03/04/2025, 3-4-25, etc.
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    // Expand a 2-digit year to 20xx.
    if (y.length === 2) y = '20' + y;
    let mo, d;
    if (dateFormat === 'DD/MM/YYYY') {
      d = a; mo = b;
    } else {
      // Default + 'MM/DD/YYYY': first part is the month.
      mo = a; d = b;
    }
    // Sanity check the numbers fall in valid ranges.
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) {
      return { date: iso(y, mo, d), guessed: false };
    }
  }

  // Last resort: let the JS Date parser try (handles "Jan 5, 2025" etc.).
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return { date: parsed.toISOString().slice(0, 10), guessed: false };
  }

  // Unparseable — fall back to today and flag it.
  return { date: today, guessed: true };
}

// Small helper: zero-pad month/day and join into 'YYYY-MM-DD'.
function iso(y, mo, d) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ─── 4. build expense objects from raw rows + a mapping ──────────────────────
// rows     : array of objects keyed by header (from parseCsv).
// mapping  : { date, description, amount, category? } — each value is the HEADER
//            name to read from each row.
// options  : { dateFormat, amountStyle }.
// autoCategorize : function(name) → category string (passed in from the app so
//            we reuse the existing rules and don't duplicate them here).
//
// Returns { expenses, skipped }:
//   • expenses : [{ name, amount, date, category, note, _warning? }]
//   • skipped  : count of rows dropped because the amount didn't parse.
//
// A row gets a `_warning` string when its date had to be guessed (fell back to
// today). The amount/category are always valid for rows that make it in.
export function buildExpenses(rows, mapping, options, autoCategorize) {
  const expenses = [];
  let skipped = 0;

  for (const row of rows) {
    // Description → expense name. Trim and fall back to a placeholder.
    const rawName = mapping.description ? (row[mapping.description] ?? '') : '';
    const name = String(rawName).trim() || 'Imported expense';

    // Amount — skip the row entirely if it doesn't parse to a finite number.
    const rawAmount = mapping.amount ? row[mapping.amount] : '';
    const amount = normalizeAmount(rawAmount, options.amountStyle);
    if (amount === null || amount <= 0) {
      skipped++;
      continue;
    }

    // Date — may fall back to today (which we flag with a warning).
    const rawDate = mapping.date ? row[mapping.date] : '';
    const { date, guessed } = normalizeDate(rawDate, options.dateFormat);

    // Category — use the mapped column if present AND it's a real category;
    // otherwise auto-categorize from the name (reusing the app's rules).
    let category;
    const mappedCat = mapping.category ? String(row[mapping.category] ?? '').trim() : '';
    if (mappedCat) {
      // Keep the provider's category text as-is (e.g. Splitwise "Groceries").
      // The DB column is free text defaulting to 'Other', so any value is safe.
      category = mappedCat;
    } else {
      category = autoCategorize(name);
    }

    const expense = { name, amount, date, category, note: '' };
    if (guessed) {
      expense._warning = `Date "${rawDate}" could not be read — set to today.`;
    }
    expenses.push(expense);
  }

  return { expenses, skipped };
}
