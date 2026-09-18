/* The currencies Splitab knows about — ONE list, imported everywhere.
 *
 * WHY THIS FILE EXISTS. There were two hardcoded lists: an object in App.jsx
 * (code → symbol, used to format every amount) and an array in Settings.jsx
 * (used to build the default-currency picker). Nothing kept them in step, so a
 * currency added to one and not the other would either be selectable and then
 * formatted with the wrong symbol, or formatted correctly and impossible to
 * choose. Both lists held the same seven entries by luck, not by design.
 *
 * WHY IT WAS WIDENED (2026-09-18). Seven currencies could not describe an
 * ordinary trip: India → Thailand → Malaysia → Singapore had no THB, no MYR and
 * no SGD. The payment-note hints in Profile.jsx already knew about SGD, NZD and
 * AED — currencies the picker would not let you choose — which is the same
 * drift showing up a third way.
 *
 * ORDERING is deliberate: the majors first, then Asia-Pacific (where this app's
 * users and their trips actually are), then the rest. A `<select>` is scrolled,
 * not searched, so the order is the whole navigation.
 *
 * SYMBOLS are the locally-recognised ones where a distinctive symbol exists,
 * and the ISO code otherwise. Several currencies share a glyph — $ is used by a
 * dozen countries and ¥ by two — so ambiguous ones are prefixed (S$, HK$, NT$)
 * rather than left to guess. `fmt` concatenates symbol + number, so code-style
 * symbols carry a trailing space to avoid "AED1,200".
 *
 * Adding one: put it here and it appears in the picker and formats correctly
 * everywhere, with nothing else to update. The code must be the ISO 4217
 * three-letter code, because that is what is stored in `groups.currency` and
 * `profiles.preferred_currency`.
 */
export const CURRENCIES = {
  // Majors
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  // Asia-Pacific
  SGD: 'S$',
  THB: '฿',
  MYR: 'RM',
  IDR: 'Rp',
  PHP: '₱',
  VND: '₫',
  JPY: '¥',
  CNY: 'CN¥',
  HKD: 'HK$',
  KRW: '₩',
  TWD: 'NT$',
  AUD: 'A$',
  NZD: 'NZ$',
  // South Asia
  LKR: 'LKR ',
  NPR: 'NPR ',
  BDT: '৳',
  PKR: 'PKR ',
  // Middle East
  AED: 'AED ',
  SAR: 'SAR ',
  QAR: 'QAR ',
  // Europe (non-euro) and the Americas
  CHF: 'CHF ',
  SEK: 'SEK ',
  NOK: 'NOK ',
  DKK: 'DKK ',
  PLN: 'zł',
  CZK: 'Kč',
  TRY: '₺',
  CAD: 'CA$',
  MXN: 'MX$',
  BRL: 'R$',
  // Africa
  ZAR: 'R',
  KES: 'KES ',
  EGP: 'EGP ',
};

// The symbol for a code, falling back to the code itself rather than to '$'.
//
// The old fallback was '$', which quietly formatted an unknown currency as US
// dollars — the wrong amount presented with total confidence. Showing the code
// is honest: "TND 40" is unambiguous, and nobody reads it as dollars.
export function symbolFor(code) {
  if (!code) return '$';
  return CURRENCIES[code] || `${code} `;
}

// [{ code, symbol, label }] for building a <select>, in the order above.
export const CURRENCY_OPTIONS = Object.entries(CURRENCIES).map(([code, symbol]) => ({
  code,
  symbol,
  label: `${symbol.trim()} ${code}`,
}));
