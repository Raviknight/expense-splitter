import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Pencil, Trash2, X, ArrowDownUp, Receipt, Users, PieChart, Search,
  ChevronDown, ChevronRight, Check, ArrowLeft, Handshake, User,
  AlertCircle, RefreshCw, UserPlus, Ghost, Upload, FileSpreadsheet,
  BarChart3, Download, Printer, ScanLine, Loader2, Activity, Pin, PinOff,
} from 'lucide-react';
import { useAuth } from './auth/AuthProvider.jsx';
import { useConnections } from './auth/useConnections.js';
import { useExpenseStore } from './data/store.js';
import { parseCsv, PROVIDER_PRESETS, buildExpenses } from './data/csv.js';
import Avatar from './ui/Avatar.jsx';

// Feature flag: receipt/statement scanning. ON now that the scan-receipt Edge
// Function uses Groq (vision for images; self-extracted text + a cheap text model
// for PDFs). Requires a GROQ_API_KEY secret on the deployed function.
const SCAN_ENABLED = true;

// ── Premium master switch (DORMANT in Phase 1) ───────────────────────────────
// This is the single on/off switch for premium gating across the whole app.
// While it is `false`, NOTHING is gated — every feature stays free and works
// exactly as it does today. The gating code below is scaffolding only.
//
// Phase 2 will flip this to `true` once paid checkout (Lemon Squeezy) is wired
// up, so that non-premium users get an upgrade prompt for premium-only features
// instead of using them. Until then, leave this `false`.
//
// Note: a "free monthly scan allowance" for non-premium users (e.g. 3 free
// scans/month, then prompt to upgrade) is a Phase-2 refinement. It needs usage
// counting in the database and is intentionally NOT built here.
const PREMIUM_ENFORCED = false;

/* ============ Categories & auto-categorization ============ */

// ORDER IS THE DROPDOWN ORDER, and it is deliberate: everyday spending first,
// then home/recurring, health, travel, and the rare ones last. The original list
// was a ROAD-TRIP list — six of its fifteen entries were travel-only, because it
// grew out of one Niagara trip (db/02) — so someone splitting a flat had to file
// their rent under "Other". Everyday categories now sit where the thumb lands.
//
// ⚠️ 'Other' MUST STAY LAST. `catMeta` falls back to CATEGORIES[length - 1] for
// any unknown name, so appending a category after 'Other' silently makes THAT
// one the fallback, and every unrecognised category renders as it.
//
// Adding a category is a front-end change only — `expenses.category` is plain
// `text` with no CHECK constraint (db/01_schema.sql), so nothing needs running
// in Supabase. But a category with no keywords in RULES below is dead weight:
// `autoCategorize` can never choose it, so it only ever appears if someone hunts
// for it by hand.
// ⚠️ `bar` MUST BE A LITERAL STRING. It is the solid colour for the Insights
// "Where it went" bars, and it is spelled out here rather than derived from
// `tone` for a reason that cost real breakage:
//
// A helper used to build it at runtime — `bg-${family}-500` from the tone's
// text- part — and its comment said that was safe because "Tailwind's Play CDN
// generates classes from the DOM at runtime, so there is no purge step to
// miss them". That WAS true. Then the Play CDN was removed (backlog #13) in
// favour of a compiled stylesheet, and the statement silently became false:
// Tailwind's scanner only sees class names that appear LITERALLY in the
// source, so a constructed name is never compiled.
//
// The result was an invisible bar for every category whose colour did not
// happen to be written out somewhere else in the codebase. Only three survived
// — violet, amber and indigo — so 17 of 23 categories rendered a zero-width
// bar, and nothing anywhere reported an error. Reported from a real screenshot
// (Car Rental, Flights and Restaurants showing no bar) months after the CDN
// change that caused it.
//
// So: never interpolate a Tailwind class name. Write it out.
const CATEGORIES = [
  // ── Everyday ──────────────────────────────────────────────────────────────
  { name: 'Restaurants',      emoji: '🍽️', tone: 'bg-rose-50 text-rose-800 border-rose-200',             bar: 'bg-rose-500' },
  { name: 'Drinks & Bars',    emoji: '🍻', tone: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200',     bar: 'bg-fuchsia-500' },
  { name: 'Groceries',        emoji: '🛒', tone: 'bg-lime-50 text-lime-800 border-lime-200',             bar: 'bg-lime-500' },
  { name: 'Convenience',      emoji: '🏪', tone: 'bg-yellow-50 text-yellow-800 border-yellow-200',       bar: 'bg-yellow-500' },
  { name: 'Shopping',         emoji: '🛍️', tone: 'bg-pink-50 text-pink-800 border-pink-200',             bar: 'bg-pink-500' },
  { name: 'Household',        emoji: '🧻', tone: 'bg-cyan-50 text-cyan-800 border-cyan-200',             bar: 'bg-cyan-500' },
  { name: 'Transportation',   emoji: '🚕', tone: 'bg-indigo-50 text-indigo-800 border-indigo-200',       bar: 'bg-indigo-500' },
  { name: 'Fuel',             emoji: '⛽', tone: 'bg-amber-50 text-amber-900 border-amber-200',          bar: 'bg-amber-500' },
  { name: 'Entertainment',    emoji: '🎬', tone: 'bg-purple-50 text-purple-800 border-purple-200',       bar: 'bg-purple-500' },
  // ── Home & recurring ──────────────────────────────────────────────────────
  { name: 'Rent',             emoji: '🏠', tone: 'bg-green-50 text-green-800 border-green-200',          bar: 'bg-green-500' },
  { name: 'Utilities',        emoji: '💡', tone: 'bg-yellow-100 text-yellow-900 border-yellow-300',      bar: 'bg-yellow-400' },
  { name: 'Internet & Phone', emoji: '📶', tone: 'bg-zinc-100 text-zinc-800 border-zinc-200',            bar: 'bg-zinc-500' },
  // ── Health ────────────────────────────────────────────────────────────────
  { name: 'Health',           emoji: '🏥', tone: 'bg-red-50 text-red-800 border-red-200',                bar: 'bg-red-500' },
  { name: 'Pharmacy',         emoji: '💊', tone: 'bg-teal-50 text-teal-800 border-teal-200',             bar: 'bg-teal-500' },
  // ── Travel ────────────────────────────────────────────────────────────────
  { name: 'Flights',          emoji: '✈️', tone: 'bg-sky-100 text-sky-900 border-sky-300',               bar: 'bg-sky-500' },
  { name: 'Lodging',          emoji: '🏨', tone: 'bg-violet-50 text-violet-800 border-violet-200',       bar: 'bg-violet-500' },
  { name: 'Car Rental',       emoji: '🚗', tone: 'bg-blue-50 text-blue-800 border-blue-200',             bar: 'bg-blue-500' },
  { name: 'Tolls',            emoji: '🛣️', tone: 'bg-orange-50 text-orange-800 border-orange-200',       bar: 'bg-orange-500' },
  { name: 'Parking',          emoji: '🅿️', tone: 'bg-sky-50 text-sky-800 border-sky-200',                bar: 'bg-sky-400' },
  { name: 'Attractions',      emoji: '🎫', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200',     bar: 'bg-emerald-500' },
  // ── Occasional ────────────────────────────────────────────────────────────
  { name: 'Auto Service',     emoji: '🔧', tone: 'bg-slate-100 text-slate-800 border-slate-200',         bar: 'bg-slate-500' },
  { name: 'Government',       emoji: '🏛️', tone: 'bg-stone-100 text-stone-800 border-stone-200',         bar: 'bg-stone-500' },
  { name: 'Other',            emoji: '📌', tone: 'bg-gray-100 text-gray-700 border-gray-200',            bar: 'bg-gray-400' },
];

const catMeta = (name) => CATEGORIES.find(c => c.name === name) || CATEGORIES[CATEGORIES.length - 1];

// Merchant keywords per category. Each list is US entries first, then India.
//
// Adding a keyword: prefer the most SPECIFIC string that still matches how the
// merchant appears on a statement. Short generic words cause false positives —
// e.g. plain 'ola' would match "gorgonzola", which is why it is written ' ola '
// with surrounding spaces (autoCategorize pads the name, so this anchors it to
// a whole word). Likewise 'taj hotel' not 'taj' (Taj Mahal is an attraction),
// and 'apollo pharmacy' not 'apollo' (there are Apollo hospitals and tyres too).
//
// Indian statements often wrap the merchant in UPI/POS noise, e.g.
// "UPI/SWIGGY/8412...". Matching is a substring test, so the merchant name is
// still found inside that — no extra parsing needed.
const RULES = [
  { cat: 'Lodging',        kws: [
    // 'booking.com' NOT bare 'booking': on Indian statements "booking" is a
    // generic word (bus/train/movie booking), and it was swallowing "REDBUS
    // BOOKING" into Lodging.
    'airbnb', 'booking.com', 'booking com', 'hotel', ' inn ', 'inn ', ' inn', 'motel', 'resort', 'lodge', 'marriott', 'hilton', 'hyatt', 'sheraton',
    'oyo', 'treebo', 'fabhotel', 'lemon tree', 'oberoi', 'itc hotel', 'taj hotel', 'makemytrip', 'make my trip', 'goibibo', 'cleartrip', 'easemytrip', 'yatra.com',
  ] },
  { cat: 'Car Rental',     kws: [
    // 'rent a car' earns its place against the Rent category's ' rent ': on
    // "HERTZ RENT A CAR" the brand name is only 5 characters, so ' rent ' won
    // and filed a car hire as housing. Longest-match needs a longer string here
    // to push back. (The hyphenated "RENT-A-CAR" never matched ' rent ' at all,
    // which is why only this spelling broke — an easy one to miss by eye.)
    'budget car', 'budget rental', 'hertz', 'avis', 'enterprise rent', 'car rental', 'rent a car', 'sixt', 'alamo', 'national rent',
    'zoomcar', 'zoom car', 'revv ', 'myles ', 'drivezy',
  ] },
  { cat: 'Auto Service',   kws: [
    'toyota', 'honda dealer', 'service center', 'oil change', 'jiffy lube', 'mavis', 'midas',
    'maruti', 'hyundai service', 'bosch service', 'tvs service', 'service centre',
  ] },
  { cat: 'Tolls',          kws: ['ezpass', 'e-zpass', 'turnpike', 'toll', 'fastag', 'fas tag', 'nhai'] },
  { cat: 'Parking',        kws: ['nycdot', 'park*meter', 'parking', 'paybyphone', ' park '] },
  { cat: 'Fuel',           kws: [
    'exxon', 'sunoco', 'shell oil', 'shell gas', 'chevron', 'bp #', 'bp gas', 'gulf', 'speedway', 'wawa gas', 'valero', 'citgo',
    'indian oil', 'indianoil', 'iocl', 'bharat petroleum', 'bpcl', 'hpcl', 'hindustan petroleum', 'nayara', 'reliance petrol', 'jio-bp', 'petrol pump', 'petrol',
  ] },
  { cat: 'Attractions',    kws: [
    // Cinemas ('bookmyshow', 'pvr ', 'inox ', 'cinepolis') moved to
    // Entertainment. This is for sightseeing — places you visit — not a
    // Friday-night film.
    'amnh', 'museum', 'observatory', 'state park', 'maid of the mist', 'whiteface', 'natl park', 'national park', 'letchworth', 'watkins glen', 'aquarium', 'zoo', 'liberty isl',
    'taj mahal', 'qutub', 'red fort', 'wonderla', 'essel world',
  ] },
  { cat: 'Restaurants',    kws: [
    'subway', 'dunkin', 'starbucks', 'mcdonald', 'chipotle', 'taco bell', 'kitchen', 'tandoori', 'restaurant', 'cafe', 'diner', 'pizza', 'bbq', 'aksharpith', 'panera', 'burger', 'noodle', 'curry', 'biryani',
    'swiggy', 'zomato', 'haldiram', 'saravana', 'barbeque nation', 'bikanervala', 'wow momo', 'chaayos', 'cafe coffee day', ' ccd ', 'third wave', 'behrouz', 'faasos', 'box8', 'dhaba', 'udupi', 'sagar ratna', 'chai point', 'thali', 'dominos', "domino's", 'kfc',
  ] },
  { cat: 'Groceries',      kws: [
    'wm supercenter', 'walmart supercenter', 'hannaford', 'seabra', 'food bazaar', 'wegmans', 'shoprite', 'kroger', 'whole foods', 'aldi', 'patel brothers', 'h mart', 'trader joe',
    'dmart', 'd-mart', 'd mart', 'reliance fresh', 'reliance smart', 'big bazaar', 'spencers', "spencer's", 'star bazaar', 'natures basket', "nature's basket",
    'blinkit', 'zepto', 'bigbasket', 'big basket', 'jiomart', 'jio mart', 'instamart', 'more supermarket', 'more megastore', 'licious', 'country delight',
  ] },
  { cat: 'Convenience',    kws: ['7-eleven', '7 eleven', 'refuel ', 'cumberland farm', 'sheetz', 'kirana', 'general store'] },
  { cat: 'Pharmacy',       kws: [
    'walgreens', 'rite aid', 'cvs pharmacy', 'pharmacy',
    'apollo pharmacy', 'medplus', 'netmeds', 'pharmeasy', '1mg', 'wellness forever', 'guardian pharmacy',
  ] },
  { cat: 'Transportation', kws: [
    // Airlines used to live here. They moved to Flights — a keyword can only
    // belong to ONE category (the test below fails on a duplicate), and an
    // airline is not local transport.
    'uber', 'lyft', 'taxi', 'amtrak', 'njt', 'nj transit', 'path', 'mta',
    ' ola ', 'olacabs', 'ola cabs', 'rapido', 'namma yatri', 'irctc', 'indian railway', 'redbus', 'red bus', 'blusmart', 'blu smart', 'meru cab',
    'dmrc', 'bmtc', 'ksrtc', 'msrtc', 'metro rail', 'auto rickshaw',
  ] },
  { cat: 'Government',     kws: ['munic', 'dmv', 'court', 'irs', 'usps', 'passport seva', 'income tax', 'challan', 'gstin'] },
  { cat: 'Shopping',       kws: [
    // 'home depot', 'lowes' and 'ikea' moved to Household — they are where you
    // buy things FOR the home, which is the whole point of that category.
    'walmart', 'wal-mart', 'target', 'costco', 'best buy',
    'flipkart', 'amazon', 'myntra', 'ajio', 'meesho', 'nykaa', 'croma', 'reliance digital', 'vijay sales', 'pantaloons', 'westside', 'shoppers stop', 'tata cliq', 'decathlon', 'snapdeal', 'firstcry',
  ] },

  // ── The eight categories added 2026-09-16 ─────────────────────────────────
  // Everything below is new. The guiding rule for each keyword is the same as
  // above: the most SPECIFIC string that still matches a real statement line.

  { cat: 'Rent',           kws: [
    // ⚠️ ' rent ' is padded on BOTH sides on purpose. Bare 'rent' is a substring
    // of "rental", "car rental" and "enterprise rent", so it would quietly steal
    // every car hire. autoCategorize pads the name with spaces, so ' rent '
    // matches the whole word "rent" and never "rental".
    // 'lease' is deliberately ABSENT for the same class of reason: "please" ends
    // in "lease", so any note saying "please pay" would be filed as Rent.
    ' rent ', 'house rent', 'rent paid', 'rent payment', 'landlord',
    'nobroker', 'no broker', 'magicbricks', '99acres', 'housing.com',
    'society maintenance', 'flat maintenance',
  ] },
  { cat: 'Utilities',      kws: [
    // 'electricity' not bare 'electric': "electrician" is Household work, and
    // bare 'electric' would take it. (Checked: 'electricity' is not a substring
    // of 'electrician', so the two live happily in different categories.)
    'electricity', 'electric bill', 'con edison', 'coned', 'national grid', 'pseg', 'pse&g',
    'water bill', 'sewer', 'gas bill', 'utility', 'utilities',
    'tata power', 'bses', 'torrent power', 'msedcl', 'mahadiscom', 'adani power',
    'lpg', 'indane', 'bharat gas', 'hp gas', 'gail gas',
  ] },
  { cat: 'Internet & Phone', kws: [
    // 'jio' is short and appears inside 'jiomart' (Groceries) and 'jio-bp'
    // (Fuel). That is safe ONLY because autoCategorize prefers the LONGEST
    // match: "JIOMART" scores 7 against 3 and stays Groceries. Do not add short
    // keywords without checking what longer ones already contain them.
    'comcast', 'xfinity', 'verizon', 'at&t', 'spectrum', 'optimum', 't-mobile',
    // ⚠️ NOT bare 'recharge'. The test caught it taking "FASTAG RECHARGE NHAI"
    // off Tolls — in India you recharge a FASTag and a metro card too, not just
    // a phone. Qualified, it is safe; the carrier names below catch the rest
    // ("JIO RECHARGE" already matches 'jio').
    'broadband', 'internet', 'mobile recharge', 'prepaid recharge',
    'jio', 'airtel', 'vodafone', 'bsnl', 'act fibernet', 'hathway', 'excitel', 'tikona',
  ] },
  { cat: 'Health',         kws: [
    // Distinct from Pharmacy, which is buying medicine. This is seeing someone.
    // 'apollo hospital' vs Pharmacy's 'apollo pharmacy' — the brand runs both,
    // so neither may be shortened to bare 'apollo'.
    'hospital', 'clinic', 'doctor', 'dental', 'dentist', 'physician', 'surgery',
    'medical center', 'medical centre', 'diagnostic', 'pathology', 'lab test', 'optician',
    'apollo hospital', 'fortis', 'max healthcare', 'manipal hospital', 'practo',
    'dr lal path', 'srl diagnostic', 'thyrocare', 'metropolis health',
  ] },
  { cat: 'Flights',        kws: [
    // 'airline' alone also matches "airlines", so both are not needed.
    // Note: makemytrip / goibibo / cleartrip stay under Lodging — they sell
    // flights AND hotels, and a keyword cannot be in two categories. Whichever
    // way that one falls, it is a guess.
    'airline', 'airfare', 'united air', 'delta air', 'southwest air', 'jetblue',
    'emirates', 'lufthansa', 'qatar airways', 'british airways', 'etihad', 'air canada',
    'air india', 'goindigo', 'indigo air', 'spicejet', 'vistara', 'akasa air',
    'boarding pass', 'excess baggage',
  ] },
  { cat: 'Drinks & Bars',  kws: [
    // ' bar ' is padded: unpadded it sits inside "barbeque" and plenty of Indian
    // merchant names. Longest-match already protects 'barbeque nation', but the
    // padding means we are not relying on that alone.
    ' bar ', 'brewery', 'brewing', ' pub ', 'tavern', 'liquor', 'wine', 'beer',
    'cocktail', 'distillery', 'taproom', 'tasmac', 'winery',
  ] },
  { cat: 'Entertainment',  kws: [
    // Cinemas moved here out of Attractions, which is for sightseeing.
    'cinema', 'movie', 'theatre', 'theater', 'imax', 'concert', 'ticketmaster',
    'netflix', 'spotify', 'hotstar', 'prime video', 'sony liv', 'zee5',
    'playstation', 'xbox', 'nintendo',
    'bookmyshow', 'book my show', 'pvr ', 'inox ', 'cinepolis',
  ] },
  { cat: 'Household',      kws: [
    // ' maid ' is padded so it cannot match "mermaid". Lodging's 'maid of the
    // mist' is longer and wins on any Niagara receipt regardless.
    'ikea', 'home depot', 'lowes', 'home centre', 'pepperfry', 'urban ladder',
    'nilkamal', 'godrej interio', 'bed bath', 'container store',
    'cleaning', 'detergent', 'housekeeping', ' maid ', 'urban company', 'urbanclap',
    'hardware store', 'plumber', 'electrician', 'carpenter',
  ] },
];

// Pick the category whose keyword match is the LONGEST.
//
// This used to return the first rule that matched anywhere in RULES, which made
// the result depend on array order and broke as soon as one merchant name
// contained another's keyword:
//   • "Swiggy Instamart" hit 'swiggy' (Restaurants) before 'instamart'
//     (Groceries), because Restaurants is listed first.
//   • "Letchworth State Park" hit ' park ' (Parking) before 'state park'
//     (Attractions), for the same reason.
// Preferring the longest match makes the most specific keyword win regardless
// of where its rule sits, so new entries can be added without re-ordering.
// Reduce a messy expense name to a stable merchant token used for learning.
//
//   "UBER *TRIP 866-576-1"      -> "uber trip"
//   "UPI/SWIGGY/8412345/Payment" -> "upi swiggy"
//   "Taco Bell 037135"           -> "taco bell"
//
// Digits and punctuation are stripped because they are exactly what differs
// between two visits to the same merchant — keying on the raw name would learn
// nothing, since every transaction looks unique.
//
// Two words, not one: "swiggy" alone would collapse Swiggy and Swiggy Instamart
// into one merchant even though they are a restaurant and a grocer. Not three:
// statements pad names with branch codes and cities, which would split the same
// merchant into many keys.
function merchantKey(name) {
  const cleaned = String(name || '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')   // digits and punctuation become separators
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.split(' ').slice(0, 2).join(' ');
}

// Identity of an expense for the purpose of "have I already imported this?".
//
// DELIBERATELY STRICT: same date, same amount to the cent, and the same name
// after nothing more than case-folding and whitespace tidying. It is NOT the
// fuzzy `merchantKey` above, and that difference matters — `merchantKey` maps
// "UBER *TRIP 866-576-1" and "UBER *TRIP 901-222-8" to the same token, which is
// right for learning a category and badly wrong here: those are two different
// taxi rides and flagging the second as a duplicate would be a false alarm
// about someone's money.
//
// What this catches is the case that actually happens: the same CSV, or an
// overlapping date range from the same bank, imported twice. Those rows are
// byte-identical, so an exact comparison finds them.
//
// A match is only ever a WARNING. Two identical coffees on one day, two equal
// tolls, two identical taxi fares are all real, and an app that refused them
// would be broken in a way that is harder to explain than the duplicates were.
function duplicateKey(name, amount, date) {
  const cents = Number.isFinite(Number(amount)) ? Number(amount).toFixed(2) : '?';
  const clean = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${String(date || '')}|${cents}|${clean}`;
}

// `overrides` is the user's own learned map (db/19), merchantKey → category.
// It is consulted FIRST and wins outright: a choice this person has already
// made for this merchant beats any built-in guess, which is the entire point of
// learning. The built-in RULES remain the fallback for merchants they have
// never corrected.
function autoCategorize(name, overrides) {
  if (overrides) {
    const learned = overrides[merchantKey(name)];
    if (learned) return learned;
  }
  const lower = ' ' + String(name || '').toLowerCase() + ' ';
  let best = 'Other';
  let bestLen = 0;
  for (const r of RULES) {
    for (const k of r.kws) {
      if (k.length > bestLen && lower.includes(k)) {
        best = r.cat;
        bestLen = k.length;
      }
    }
  }
  return best;
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

// The active group's currency CODE, kept beside the symbol and set from the
// same place. `fmt` only ever needed the symbol; the UPI hand-off below needs
// to know it is specifically INR, and '₹' is not a safe proxy for that.
let currencyCode = 'USD';

// Format a number as money. By default it uses the active group's symbol
// (the module-level `currencySymbol`). Pass an explicit `sym` to override —
// the home dashboard does this so each group card can print in its OWN
// currency even though several cards are on screen at once.
const fmt = (n, sym = currencySymbol) =>
  sym + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* ============ UPI hand-off (India only) ============
 *
 * ⚠️ THIS REVERSES A RECORDED DECISION, deliberately and with the owner's
 * explicit agreement on 2026-09-18. CLAUDE.md §8 and the comment on
 * PaymentNoteLine both said there would be NO deep link of any kind, on the
 * grounds that touching money would make Splitab a regulated payment service.
 *
 * That conclusion reached further than its own reasoning. Two objections were
 * recorded, and each has a specific answer:
 *
 *  1. "Actually moving the money makes this a regulated payment service."
 *     True, and still true — which is why this does NOT move money. A upi://
 *     URI is a LINK. It opens the payer's own UPI app with the fields filled
 *     in; they authenticate and authorise inside their bank's app. Splitab is
 *     never in the funds flow, holds nothing, and settles nothing. The app
 *     still only RECORDS that a payment happened elsewhere.
 *  2. "A field per payment app, per country is an endless maintenance tail."
 *     The strong objection, and UPI is the exception that motivates this: ONE
 *     URI format is honoured by GPay, PhonePe, Paytm, BHIM and the rest. Not a
 *     field per app — one, for a whole country. This is exactly why it is
 *     worth doing in India and not worth doing in the US or Europe, where the
 *     deep links are per-provider and change by country.
 *
 * SCOPED TO INR ON PURPOSE. Gated on the GROUP's currency, not on geography:
 * no IP lookup, no locale sniffing, nothing to get wrong about where someone
 * is. A group settling in rupees gets the button; every other group in the
 * world sees exactly what it saw before. That also means an Indian user
 * splitting a holiday in EUR correctly gets no UPI button, because a UPI
 * payment cannot settle a euro balance.
 */

// Does this token look like a UPI VPA (`name@bank`) rather than an email?
//
// The discriminator is the DOT. A VPA's handle is a bare provider token —
// okhdfcbank, ybl, paytm, upi, axl — with no dot in it. An email address
// effectively always has one (gmail.com). So: letters and digits only after
// the '@', to the end of the token.
//
// This is tested against a WHOLE whitespace-delimited token, never searched
// inside a longer string. That matters: a loose search for "@" followed by
// letters would match the "gmail" inside "someone@gmail.com" and cheerfully
// offer to pay it, which is precisely the kind of quiet wrongness that is
// hard to notice and involves someone's money.
const UPI_VPA = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,100}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

// Pull the first VPA out of a free-text payment note, or null.
//
// The note is whatever the person typed — "UPI: ravi@okhdfcbank", "GPay
// 9876543210@ybl, or cash". So it is split on whitespace and each token is
// stripped of surrounding punctuation before being tested in full.
function findUpiId(note) {
  if (typeof note !== 'string') return null;
  for (const raw of note.split(/\s+/)) {
    const token = raw.replace(/^[^a-zA-Z0-9]+/, '').replace(/[^a-zA-Z0-9]+$/, '');
    if (UPI_VPA.test(token)) return token;
  }
  return null;
}

// Build the upi:// URI. Every value is encoded — a payee name with a space or
// an ampersand would otherwise corrupt the query string.
//
// `am` is fixed to 2 decimals because UPI apps reject odd precision, and `cu`
// is always INR since this is only ever reachable from an INR group. `tn` is
// the transaction note the payer will see in their bank app; it is kept short
// because several UPI apps silently truncate it.
function buildUpiUri({ vpa, payeeName, amount, note }) {
  const params = new URLSearchParams();
  params.set('pa', vpa);
  if (payeeName) params.set('pn', payeeName);
  const amt = Number(amount);
  if (Number.isFinite(amt) && amt > 0) params.set('am', amt.toFixed(2));
  params.set('cu', 'INR');
  if (note) params.set('tn', String(note).slice(0, 40));
  // URLSearchParams uses FORM encoding, where a space becomes '+'. That is
  // correct for a form body and wrong for a URI: a strict parser reads '+' as
  // a literal plus, so "Ravi Sharma" can reach the UPI app as "Ravi+Sharma".
  // Only the payee name and the note can contain spaces, and both are shown to
  // the payer while they confirm the payment, so it is worth getting right.
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

// A balance smaller than one cent counts as SETTLED.
//
// Why not a tighter value: shares rarely land on whole cents. Splitting 100
// three ways gives 33.3333… each, and settle-up suggestions must be rounded to
// real money (33.33), so paying them in full still leaves 0.0067 behind. The
// old half-cent threshold treated that leftover as a live debt, and the home
// screen showed "you are owed $0.01" permanently — for an amount no payment can
// ever clear, because money does not move in fractions of a cent.
//
// One cent is the smallest transferable unit, so anything below it is not a
// debt anyone can act on. Treating it as settled is correct, not a fudge.
const SETTLED_EPSILON = 0.01;

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

/* ============ Activity timeline helpers ============
 *
 * The Activity tab and the home "N new" badge both work off the SAME existing
 * data (every expense, settlement, and member already has a created_at). These
 * small pure helpers turn that data into a friendly timeline.
 */

// Turn an ISO timestamp into a short, friendly "how long ago" string:
//   under a minute → "just now"
//   minutes        → "5m"
//   hours          → "3h"
//   days (< 7)     → "2d"
//   older          → a short date like "Jun 12"
// Guards against a missing or unparseable date by returning '' (the UI then
// simply shows no time, instead of "NaN" or "Invalid Date").
function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';

  const diffMs = Date.now() - then;
  // A tiny clock skew can make a brand-new row look like the future; clamp to 0.
  const secs = Math.max(0, Math.floor(diffMs / 1000));

  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  // Older than a week → a short month/day label (e.g. "Jun 12").
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

// "Last seen" bookkeeping for the home "N new" badge. We remember, per group,
// the moment the user last OPENED it (a millisecond timestamp) in localStorage.
// Anything created after that counts as "new". Wrapped in try/catch so a
// private-mode browser that blocks storage never breaks the app.
const LAST_SEEN_PREFIX = 'slitab.lastseen.';

function getLastSeen(groupId) {
  try {
    const raw = localStorage.getItem(LAST_SEEN_PREFIX + groupId);
    const n = raw ? Number(raw) : 0;
    return isNaN(n) ? 0 : n;
  } catch (e) {
    return 0;
  }
}

function setLastSeen(groupId, ts) {
  try {
    localStorage.setItem(LAST_SEEN_PREFIX + groupId, String(ts));
  } catch (e) {
    /* storage unavailable (private mode) — the badge just won't clear; harmless */
  }
}

// Most recent activity in a group, as a millisecond timestamp (0 if nothing).
// Powers the dashboard's default "Recent activity" sort. Uses the same
// createdAt fields as the "N new" badge — no new data required.
function lastActivityAt(group) {
  let latest = 0;
  const consider = (iso) => {
    if (!iso) return;
    const t = new Date(iso).getTime();
    if (!isNaN(t) && t > latest) latest = t;
  };
  (group.expenses || []).forEach(e => consider(e.createdAt));
  (group._memberJoins || []).forEach(m => consider(m.createdAt));
  return latest;
}

// Dashboard sort preference. Per-DEVICE on purpose (localStorage, like
// lastseen): how you like a list ordered is a habit of the device you're on,
// whereas pins are a statement about the groups themselves and so live on the
// profile and sync. Same try/catch guard as the other storage helpers — a
// private-mode browser that blocks storage must never break the app.
const SORT_PREF_KEY = 'slitab.homesort';
const SORT_OPTIONS = [
  { id: 'activity', label: 'Recent activity' },
  { id: 'due',      label: 'Amount due' },
  { id: 'name',     label: 'Alphabetical' },
];

function getSortPref() {
  try {
    const v = localStorage.getItem(SORT_PREF_KEY);
    return SORT_OPTIONS.some(o => o.id === v) ? v : 'activity';
  } catch (e) {
    return 'activity';
  }
}

function setSortPref(v) {
  try {
    localStorage.setItem(SORT_PREF_KEY, v);
  } catch (e) {
    /* storage unavailable — the sort just won't be remembered; harmless */
  }
}

/* ── Scan draft ────────────────────────────────────────────────────────────
 *
 * Scanned rows are written to localStorage as each file completes, so they
 * survive the page being discarded.
 *
 * Why this exists: locking an iPhone mid-scan suspends the page, and iOS may
 * throw the web view away. React state goes with it — but the scans have
 * ALREADY been charged on the server, so without this the user pays a second
 * time to recover receipts they already paid to read. Credits are real money.
 *
 * The draft is keyed per user and expires, so a forgotten one from last week
 * never resurfaces as a surprise. Cleared once the rows are imported or the
 * user discards them.
 */
// Most files accepted in one scan batch. Each file costs a credit, so an
// accidental select-all on a camera roll must not be able to drain a month's
// quota in a single tap. The server's per-minute burst cap is the backstop;
// this is the friendlier guard that stops it happening at all.
const MAX_SCAN_FILES = 10;

const SCAN_DRAFT_PREFIX = 'slitab.scandraft.';
const SCAN_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;   // a day

function saveScanDraft(key, rows) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), rows }));
  } catch (e) {
    /* storage full or blocked — the scan still works, it just isn't recoverable */
  }
}

function loadScanDraft(key) {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    // Stale drafts are dropped rather than offered: restoring last week's
    // receipts into today's group would be worse than losing them.
    if (Date.now() - (parsed.savedAt || 0) > SCAN_DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

function clearScanDraft(key) {
  if (!key) return;
  try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ }
}

// Count how many activity items (expenses + settlements + member joins +
// deletions) in a group were created AFTER `since` (a millisecond timestamp).
// Used for the home card "N new" badge. Rows with a missing/invalid createdAt
// are ignored.
function countNewActivity(group, since) {
  const after = (iso) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return !isNaN(t) && t > since;
  };
  let n = 0;
  (group.expenses || []).forEach(e => { if (after(e.createdAt)) n++; });
  (group._memberJoins || []).forEach(m => { if (after(m.createdAt)) n++; });
  // Deletions (db/23) carry `deletedAt`, not `createdAt`. A removed expense is
  // exactly the kind of change someone needs to notice — it moves balances and
  // nothing else on screen explains why. Absent (no deletions, or db/23 not
  // run) → an empty array → adds nothing.
  (group._deletions || []).forEach(d => { if (after(d.deletedAt)) n++; });
  return n;
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
// with the biggest creditor and settle the smaller of the two amounts, yielding
// at most N−1 payments. Returns [{ from, to, amount }].
//
// WHY THIS WORKS IN INTEGER CENTS:
//   Shares rarely divide evenly — 100 split three ways is 33.3333… each. The
//   old version matched in floating point and rounded each payment on the way
//   out, so the payments did not add up to what was actually owed. Paying every
//   suggestion in full still left a residue, and the home screen then showed a
//   permanent "you are owed $0.01" that no payment could ever clear.
//
//   The error grew with group size, because every payment could be off by up to
//   half a cent and they all landed on the same creditor. Measured before this
//   change: 7 people left 0.026 outstanding, 15 people left 0.047 — both far
//   above a cent, so no sensible threshold could hide them.
//
//   Working in whole cents removes the problem at the source. Rounding each
//   balance to cents can leave the totals a cent or two apart, so that drift is
//   handed to the largest balances first; after that, debits and credits match
//   exactly and the greedy match is exact too.
function suggestSettlements(netBalances) {
  // Signed cents per person, plus how far rounding moved each one. True balances
  // sum to zero, but the ROUNDED ones need not: 100 across 7 people rounds each
  // -14.2857 to -14.29, overshooting by 0.43c six times over.
  const entries = netBalances.map(b => {
    const exact = b.net * 100;
    const cents = Math.round(exact);
    return { name: b.name, cents, frac: exact - cents };   // frac ∈ (-0.5, 0.5]
  });

  // Force the rounded balances back to a zero sum by nudging INDIVIDUALS by one
  // cent — never by inflating one whole side, which just moves the discrepancy
  // onto the creditor (an earlier attempt did that and left 0.026 outstanding
  // for 7 people). Pick whoever rounding treated most unfairly in the direction
  // we need, so each person stays within a cent of their true balance.
  let drift = entries.reduce((t, e) => t + e.cents, 0);
  if (drift !== 0) {
    const step  = drift > 0 ? -1 : 1;
    const order = [...entries].sort((a, b) => (step > 0 ? b.frac - a.frac : a.frac - b.frac));
    for (let i = 0; i < Math.abs(drift); i++) order[i % order.length].cents += step;
  }

  const debtors = entries
    .filter(e => e.cents < 0)
    .map(e => ({ name: e.name, cents: -e.cents }))   // positive = owes
    .sort((a, b) => b.cents - a.cents);
  const creditors = entries
    .filter(e => e.cents > 0)
    .map(e => ({ name: e.name, cents: e.cents }))    // positive = is owed
    .sort((a, b) => b.cents - a.cents);

  const payments = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di];
    const c = creditors[ci];
    const pay = Math.min(d.cents, c.cents);
    if (pay > 0) {
      payments.push({ from: d.name, to: c.name, amount: pay / 100 });
    }
    d.cents -= pay;
    c.cents -= pay;
    // Exact integers now, so "nothing left" really means zero.
    if (d.cents === 0) di++;
    if (c.cents === 0) ci++;
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
    const label = b.net > SETTLED_EPSILON ? 'is owed' : b.net < -SETTLED_EPSILON ? 'owes' : 'even';
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

  // ── Premium status (Phase 1 plumbing — dormant) ─────────────────────────────
  // `profile.is_premium` comes from the profiles table (added by db/11). Before
  // db/11 is run the column is missing, so `profile.is_premium` is undefined —
  // the `=== true` check treats that as "not premium", which is safe.
  const isPremium = profile?.is_premium === true;

  // Gate helper. Returns true if the user is ALLOWED to use a premium feature.
  // While PREMIUM_ENFORCED is false this ALWAYS returns true, so nothing is
  // blocked today. The `feature` argument isn't used yet — it's there so a
  // future version can allow some premium features but not others (granularity).
  const premiumAllowed = (feature) => !PREMIUM_ENFORCED || isPremium;

  // The small "this is a premium feature" prompt. Null = hidden. When set, it
  // holds a short label of what was attempted (e.g. "Receipt scanning") so the
  // prompt can name it. This only ever appears once PREMIUM_ENFORCED is true.
  const [premiumPrompt, setPremiumPrompt] = useState(null);

  // Load all data from Supabase. The store returns the same shape the UI
  // already knows how to render, so minimal UI changes are needed.
  const { groups, activeGroupId, loading, error, online, pendingCount, stale, categoryOverrides, actions } = useExpenseStore(
    user?.id,
    profile,
  );

  /* ----- Pinned groups (home dashboard ordering) -----
   *
   * MUST STAY ABOVE the `if (loading)` / `if (error)` early returns further
   * down. Hooks declared after a conditional return only run on some renders,
   * which trips React's "rendered more hooks than during the previous render".
   *
   * Source of truth is profiles.pinned_groups (db/13) so pins follow the user
   * between phone and laptop. If that column doesn't exist yet the write fails
   * and we fall back to per-device localStorage, so the feature still works
   * before the migration is run — the same graceful degradation the app uses
   * for preferred_currency.
   */
  const PINS_KEY = user?.id ? `slitab.pins.${user.id}` : null;

  const readLocalPins = () => {
    try {
      const raw = PINS_KEY ? localStorage.getItem(PINS_KEY) : null;
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  };

  const [pinnedIds, setPinnedIds] = useState(() => {
    const fromProfile = profile?.pinned_groups;
    if (Array.isArray(fromProfile)) return fromProfile;
    return readLocalPins();
  });

  // Adopt the profile's list once it loads (or changes on another device).
  // Only when it's a real array — an absent column arrives as undefined, and
  // overwriting good local pins with [] would silently lose them.
  useEffect(() => {
    if (Array.isArray(profile?.pinned_groups)) setPinnedIds(profile.pinned_groups);
  }, [profile?.pinned_groups]);

  const togglePin = async (groupId) => {
    const next = pinnedIds.includes(groupId)
      ? pinnedIds.filter(id => id !== groupId)
      : [...pinnedIds, groupId];
    setPinnedIds(next);   // optimistic — pinning must feel instant

    // Wrapped so ANY failure path reaches the local fallback. Without this an
    // unexpected throw skips it entirely and the pin is lost on reload.
    let saved = false;
    try {
      const res = await actions.savePinnedGroups(next);
      saved = !res?.error;
    } catch (e) {
      saved = false;
    }

    if (!saved) {
      // Most likely db/13 hasn't been run (PostgREST 42703 = undefined column).
      // Keep the pin working locally rather than surfacing an error for
      // something this minor.
      try {
        if (PINS_KEY) localStorage.setItem(PINS_KEY, JSON.stringify(next));
      } catch (e) {
        /* storage unavailable — pins just won't survive a reload */
      }
    }
  };

  // Currency is now PER GROUP. Inside a group's detail view every amount uses
  // that ACTIVE group's currency. We set the module-level `currencySymbol`
  // synchronously during render from the active group so the shared `fmt`
  // helper formats every amount in the right currency. This is display-only —
  // stored values and all math stay exactly the same.
  // (The home dashboard shows many groups at once, so it does NOT rely on this
  // single symbol — each GroupCard formats with its own group's currency.)
  const activeGroupForCurrency = groups.find(g => g.id === activeGroupId) || groups[0];
  currencySymbol = CURRENCIES[activeGroupForCurrency?.currency] || '$';
  currencyCode   = activeGroupForCurrency?.currency || 'USD';

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

  /* ----- Who may delete what — A PREDICTION, NOT A PERMISSION CHECK ---------
   *
   * ⚠️ THIS IS NOT A SECURITY CONTROL. Nothing below protects any data.
   *
   * The rule that protects the data is the Row-Level Security policy in
   * db/23 ("payer or owner deletes expenses" / "party or owner deletes
   * settlements"), enforced by Postgres on every request. It cannot be
   * bypassed from a browser: editing this file, this bundle, or the React
   * state in devtools changes nothing about what the database will do. If the
   * check below were wrong in the permissive direction, the delete would still
   * be refused by the server — the user would simply see the old behaviour
   * (a row vanishing and coming back) instead of a clear explanation.
   *
   * So what is it for? Purely to avoid OFFERING an action that is certain to
   * fail. The app deletes optimistically: the row leaves the screen at once and
   * only returns when the refetch lands. On a slow connection that is seconds
   * of a money record appearing to be destroyed, followed by it reappearing and
   * an error. In an app about money, watching a record disappear reads as data
   * loss — a user may believe they destroyed something and act on it. Showing
   * the doomed action and then visibly undoing it is the worst of both, so the
   * control is disabled up front and says why.
   *
   * Because it is only a prediction, it MIRRORS db/23 exactly and it fails
   * OPEN, never closed. If it ever disagrees with the database the database
   * wins, and an unnecessary-but-attempted delete is a far smaller harm than a
   * bin that is dead for someone who is in fact allowed to use it. Never let
   * this grow into something the data is assumed to depend on; if you change
   * db/23, change this to match, and if you cannot, delete this rather than
   * leave it lying.
   */

  // The signed-in account. May be briefly undefined while the session is loading
  // or a token is refreshing (App is only mounted when signed in, so this is a
  // moment, not a state). See the `!myUserId` branch below for what we do then.
  const myUserId = user?.id;

  // Wording. Kept without a trailing full stop so it reads as a tooltip; the
  // banner adds one so it matches the sentence the server sends back verbatim
  // ('Only the person who paid, or the group owner, can delete this.').
  const DENY_EXPENSE    = 'Only the person who paid, or the group owner, can delete this';
  const DENY_SETTLEMENT = 'Only the two people in this settlement, or the group owner, can delete it';

  // db/24's INSERT rule on settlements, worded for a person rather than a
  // policy. Same shape as the two above, and no trailing full stop for the same
  // reason — it is read as a tooltip, and the banner adds one.
  const DENY_RECORD_SETTLEMENT = 'Only the two people in this payment, or the group owner, can record it';

  // Resolve a member's display NAME to the account behind it. Three answers,
  // and the third is the one that is easy to miss:
  //   a uuid    — that member's account
  //   null      — we know, and there is no account: a ghost, or a name that
  //               is not a member of this group at all. null never equals
  //               myUserId (a non-empty string by the time we get here), so
  //               nobody is ever mistaken for a ghost.
  //   undefined — we do NOT know. The offline snapshot in localStorage is the
  //               whole groups array as it was last fetched, so straight after
  //               this change ships the app renders a snapshot written by the
  //               PREVIOUS bundle, whose _memberMeta entries have no `userId`
  //               key at all. Reading that as "no account" would grey out
  //               everyone's own bin for the second or two until the first
  //               fetch lands. Unknown means fail open, same as an unknown
  //               myUserId.
  // Optional chaining throughout, so a missing map or member cannot throw.
  //
  // Shared by both prediction helpers below — they ask the same question of the
  // same map, and two copies would be two things to keep in step.
  const accountFor = (name) => {
    const m = (activeGroup?._memberMeta || {})[name];
    if (m && !('userId' in m)) return undefined;  // pre-upgrade cached shape
    return m?.userId ?? null;
  };

  // Returns null when the signed-in user would be allowed to delete `entry`,
  // otherwise the sentence explaining why not.
  const deleteDenyReason = (entry) => {
    // Nothing to judge — let the normal path run and let the server answer.
    if (!entry) return null;

    // FAIL OPEN while we do not know who is signed in. Disabling every bin on
    // an unknown id risks a permanently dead control if the id never arrives,
    // which is a worse failure than one doomed request: the user could not
    // delete their OWN expense and nothing would tell them why. The database
    // still decides, so the cost of being wrong here is the pre-existing
    // behaviour, not a lost record.
    if (!myUserId) return null;

    // The group owner may delete anything in the group (db/23, both policies).
    if (activeGroup?.owner_id === myUserId) return null;

    // db/24 adds the CREATOR to both delete rules, fixing a limitation noted
    // when db/23 shipped: someone who entered a record and correctly attributed
    // it to another person could not then remove their own mis-entry. Leaving
    // this out would grey the bin out for exactly the person the database is now
    // willing to let through — this prediction failing CLOSED, which the note
    // above forbids. `createdBy` is null both on rows written before db/24 and
    // everywhere until it is run, and null never equals myUserId, so nothing
    // moves in those states.
    if (entry.createdBy && entry.createdBy === myUserId) return null;

    if (entry.type === 'settlement') {
      // Either party. The row carries display NAMES (_settleFrom / _settleTo).
      const fromUserId = accountFor(entry._settleFrom);
      const toUserId   = accountFor(entry._settleTo);
      if (fromUserId === undefined || toUserId === undefined) return null;
      if (fromUserId === myUserId || toUserId === myUserId) return null;
      return DENY_SETTLEMENT;
    }

    // An expense: only the person it says PAID for it. A ghost has no account,
    // so its userId is null, nobody matches, and the owner is the only route —
    // which is precisely what db/23 intends.
    const payerUserId = accountFor(entry.paidBy);
    if (payerUserId === undefined) return null;
    if (payerUserId === myUserId) return null;
    return DENY_EXPENSE;
  };

  /* ----- Who may RECORD a settlement — the same prediction, going in ---------
   *
   * ⚠️ Also NOT a security control. Everything in the long note above applies
   * here verbatim: db/24's "party or owner adds settlements" policy is what
   * actually decides, this only avoids offering an action certain to fail, and
   * it fails OPEN.
   *
   * This one closes a gap the settle-up UI has always had. The suggestion list
   * is computed from everyone's balances, so it happily offers "Record" on a
   * payment between two OTHER people — and until db/24 the database happily
   * accepted it. Now it will refuse, and a refused settlement insert is worse to
   * watch than a refused delete: the row appears in the list optimistically,
   * the balances move, and both silently revert on the next refetch. Recording a
   * payment that did not happen, or appearing to and not having, are both about
   * money. So the button says why instead.
   *
   * Takes display NAMES (the suggestion rows carry `s.from` / `s.to`), mapped
   * through the same `accountFor` as the delete rules. A ghost has userId null
   * and can never match — correct, and deliberate: db/24 leaves ghost-to-ghost
   * to the group owner because neither side has an account to record it.
   */
  const recordDenyReason = (fromName, toName) => {
    // Unknown signer — fail open, exactly as deleteDenyReason does.
    if (!myUserId) return null;

    // The group owner may record anything, including between two ghosts.
    if (activeGroup?.owner_id === myUserId) return null;

    const fromUserId = accountFor(fromName);
    const toUserId   = accountFor(toName);

    // `undefined` is "we do not know" (a snapshot from an older bundle), not
    // "no account". Fail open rather than disable a control we cannot judge.
    if (fromUserId === undefined || toUserId === undefined) return null;

    if (fromUserId === myUserId || toUserId === myUserId) return null;
    return DENY_RECORD_SETTLEMENT;
  };

  /* ----- Derived ----- */
  const total = realExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  // Four SEPARATE buckets, because "paid" was previously overloaded and made the
  // header lie: a settlement was added to the payer's `paid`, so a person who
  // spent very little but repaid a big balance appeared to have paid far more
  // than they spent — and the per-person figures then summed to MORE than the
  // group total (which counts real expenses only).
  //
  //   spent    — expense amounts this person fronted        (sums to `total`)
  //   share    — this person's share of those expenses
  //   repaid   — settlements this person PAID OUT           (a transfer, not spend)
  //   received — settlements this person RECEIVED
  //
  // The net-balance maths is unchanged:
  //   net = (spent + repaid) − (share + received)
  // which is exactly the old `paid − owed`. Only the display is disambiguated.
  const { balances, sharedPool } = (() => {
    if (isSolo) {
      return {
        balances: [{ name: people[0], paid: total, spent: total, share: total, repaid: 0, received: 0, net: 0 }],
        sharedPool: 0,
      };
    }
    const spent    = Object.fromEntries(people.map(p => [p, 0]));
    const owed     = Object.fromEntries(people.map(p => [p, 0]));
    const repaid   = Object.fromEntries(people.map(p => [p, 0]));
    const received = Object.fromEntries(people.map(p => [p, 0]));
    let shared = 0;
    expenses.forEach(e => {
      const amt = Number(e.amount || 0);
      // A settlement is a PAYMENT (transfer), not a split: the payer (from)
      // reduces their debt and the receiver (to) reduces their credit. Treating
      // it like a "full" expense here is what previously left everyone still
      // looking like they owed money after they'd settled up.
      // It is kept OUT of `spent`/`owed` so those stay "expenses only".
      if (e.type === 'settlement') {
        const from = e._settleFrom, to = e._settleTo;
        if (from in repaid)   repaid[from]   = (repaid[from]   || 0) + amt;
        if (to   in received) received[to]   = (received[to]   || 0) + amt;
        return;
      }
      const mode = e.splitMode || 'equal';
      spent[e.paidBy] = (spent[e.paidBy] || 0) + amt;
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
      balances: people.map(p => ({
        name:     p,
        spent:    spent[p],      // expenses only — these sum to `total`
        share:    owed[p],       // share of expenses only
        repaid:   repaid[p],     // settlements paid out
        received: received[p],   // settlements received
        // `paid` kept for anything still reading it: spend + repayments.
        paid:     spent[p] + repaid[p],
        // Identical to the previous `paid - owed`.
        net:     (spent[p] + repaid[p]) - (owed[p] + received[p]),
      })),
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

    // BELT AND BRACES. The bin is already disabled on rows the user cannot
    // delete, but a disabled button is not the only way in — a stale render, a
    // keyboard activation that lands before the disable, or a future caller
    // could all reach here. Answering here rather than in the store is what
    // makes the difference the owner asked for: actions.deleteExpense removes
    // the row from the screen FIRST and only puts it back when the refetch
    // lands, so the only way to avoid the flash is not to call it at all.
    // (Again: this is not the permission check. db/23 is. See the long note by
    // deleteDenyReason.)
    const denied = deleteDenyReason(item);
    if (denied) {
      actions.showError(`${denied}.`);
      return;
    }

    const isSettlement = item?.type === 'settlement';
    await actions.deleteExpense(activeGroup.id, id, isSettlement);
  };

  const switchGroup = (groupId) => {
    actions.switchGroup(groupId);
    setShowGroups(false);
    setFilterCat('All');
    setSearch('');
    setTab('expenses');
    // Mark this group as "seen now" so its home-card "N new" badge clears.
    // (Anything created after this moment will count as new again.)
    setLastSeen(groupId, Date.now());
    // Opening a group from anywhere moves us into the group detail view.
    setView('group');
  };

  // Return to the groups dashboard (the "All groups" back control).
  const goHome = () => {
    setShowGroups(false);
    setView('home');
  };

  // BELT AND BRACES, the same arrangement as removeExpense above. The Record
  // buttons are already marked aria-disabled when db/24 would refuse, but
  // aria-disabled is deliberately still CLICKABLE (that is the point — see the
  // buttons), so the tap has to land somewhere that answers. Answering here,
  // before actions.recordSettlement, is what avoids the optimistic insert: that
  // action adds the row and moves everyone's balances immediately and only
  // reverts when the refetch lands. The only way not to show a payment that was
  // never accepted is not to call it.
  const recordSettlement = async ({ from, to, amount, note }) => {
    const denied = recordDenyReason(from, to);
    if (denied) { actions.showError(`${denied}.`); return; }
    await actions.recordSettlement(activeGroup.id, { from, to, amount, note });
    setShowSettle(false);
  };

  // Record one suggested payment WITHOUT closing the modal. Used by the 3+
  // settle-up list so the user can record several payments in a row; balances
  // (and therefore the suggestions) refetch after each one.
  const recordSettlementKeepOpen = async ({ from, to, amount, note }) => {
    const denied = recordDenyReason(from, to);
    if (denied) { actions.showError(`${denied}.`); return; }
    await actions.recordSettlement(activeGroup.id, { from, to, amount, note });
  };

  /* ----- Export the active group (CSV download / printable PDF) ----- */
  const exportCsv = () => {
    const csv = buildExpensesCsv(realExpenses);
    downloadTextFile(`${sanitizeFilename(activeGroup.name)}-expenses.csv`, csv);
  };

  const exportPdf = () => {
    // Premium gate (dormant — never triggers while PREMIUM_ENFORCED is false).
    // When enforcement is on, non-premium users get the upgrade prompt instead
    // of the printable report. CSV export (exportCsv) stays free always.
    if (!premiumAllowed('pdf')) { setPremiumPrompt('PDF export'); return; }
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
        { id: 'activity',   label: 'Activity',   icon: Activity },
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
        pinnedIds={pinnedIds}
        onTogglePin={togglePin}
        stale={stale}
        onRetry={actions.retry}
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

      {/* Non-blocking error banner — shown when a write fails but data is loaded.
          FIXED, not inline, and that is the entire point of this block.
          It used to sit in normal document flow at the top of the page. A group
          with fifty expenses is several screens long, so failing to delete one
          near the bottom put the explanation somewhere the user could never see
          — while the row vanished optimistically and reappeared on the next
          refetch. The result read as "nothing happened, no message", which is
          indistinguishable from a broken app and took three rounds to diagnose
          precisely because the message WAS being set correctly all along.
          An error you cannot see is the same as no error.
          z-[60] puts it above the modals (z-40/z-50) too, so a failure raised
          just as a dialog closes cannot hide behind one. */}
      {error && (
        <div className="fixed top-0 inset-x-0 z-[60] px-4 pt-2 pointer-events-none">
          <div className="max-w-3xl mx-auto bg-red-50 border border-red-200 rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-3 pointer-events-auto">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <div className="text-sm text-red-800 flex-1">{error}</div>
            <button
              onClick={actions.clearError}
              className="text-xs text-red-600 underline shrink-0"
            >
              Dismiss
            </button>
          </div>
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

      {/* STALE DATA warning. Shown when the figures on screen came from the
          cached snapshot rather than a completed fetch — the watchdog fired, or
          the network failed. Falling back to cache beats an endless spinner,
          but doing it silently is how one device showed four groups while
          another showed five with nothing to say which was right. A wrong
          balance read as current is worse than an obvious wait.
          Amber, not red: nothing is broken, the numbers are just possibly old. */}
      {stale && online && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center gap-2 max-w-3xl mx-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          <span className="text-xs text-amber-800 flex-1">
            Showing saved data — these figures may be out of date.
          </span>
          <button
            onClick={actions.retry}
            className="text-xs text-amber-900 underline underline-offset-2 shrink-0"
          >
            Refresh
          </button>
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

      {/* BOTTOM PADDING MUST CLEAR THE WHOLE FLOATING BUTTON STACK (see below).
          The stack is `fixed`, so it never moves out of the way — the list has
          to be able to scroll PAST it. If this padding is too small, the last
          expense row comes to rest underneath the buttons and its pencil/bin
          icons become unclickable (the FAB wrapper is z-30; the row is not).
          That is exactly what happened when a second and third button were
          added and this was left at pb-32 (128px).
          Measured height of the stack, bottom of the viewport upward:
            24px  bottom-6 offset
          + 56px  Add-expense button (w-14 h-14)
          + 12px  gap-3
          + 48px  Import-CSV button (w-12 h-12)
          + 12px  gap-3
          + 48px  Scan button (w-12 h-12)
          = 200px occupied, + 16px breathing room = 216px.
          Raise this if a button is ever added to that column. Do NOT "fix" an
          overlap by giving the rows a higher z-index — that just flips the
          problem and makes the + button unclickable instead. */}
      <main className="max-w-3xl mx-auto px-4 py-4 pb-[216px]">
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
            deleteDenyReason={deleteDenyReason}
            isSolo={isSolo}
          />
        )}
        {tab === 'insights' && (
          <InsightsTab
            expenses={realExpenses}
            onPick={(c) => { setFilterCat(c); setTab('expenses'); }}
          />
        )}
        {tab === 'activity' && !isSolo && (
          <ActivityTab group={activeGroup} />
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
            paymentNotes={activeGroup?._memberPaymentNotes || {}}
            myName={profile?.display_name || 'Me'}
            onSettle={() => setShowSettle(true)}
            onExportCsv={exportCsv}
            onExportPdf={exportPdf}
          />
        )}
      </main>

      {/* Floating action buttons: Import CSV (secondary) + Add expense (primary).
          Both only appear here in the normal state where a group exists. */}
      {/* Same content-column alignment as the new-group button on the home
          screen — see the comment there. Pinning to the viewport edge strands
          these in the corner of a wide monitor, away from the content. */}
      <div className="fixed inset-x-0 bottom-6 z-30 pointer-events-none">
      {/* Each button re-enables pointer events individually rather than using a
          `[&>*]:` variant — that arbitrary selector contains a ">", which ends
          the JSX tag early and leaves the div unterminated. The compiler then
          reports a confusing error hundreds of lines later. */}
      <div className="max-w-3xl mx-auto px-4 flex flex-col items-end gap-3">
        {/* Offline, this button STAYS PUT — a control that vanishes reads as a
            bug, and the user has no way to learn why. It carries the reason in
            its label/tooltip instead, and the scan tab repeats it in full. */}
        {SCAN_ENABLED && (
        <button
          onClick={() => {
            // Premium gate (dormant — never triggers while PREMIUM_ENFORCED is
            // false). When enforcement is on, non-premium users get the upgrade
            // prompt instead of opening the scanner.
            if (!premiumAllowed('scan')) { setPremiumPrompt('Receipt scanning'); return; }
            setImportStartMode('scan');
            setShowImport(true);
          }}
          className="pointer-events-auto w-12 h-12 rounded-full bg-white border border-stone-300 text-stone-700 shadow-md hover:bg-stone-50 active:scale-95 transition flex items-center justify-center"
          aria-label={online
            ? 'Scan receipt or statement'
            : 'Scan receipt or statement — needs an internet connection'}
          title={online
            ? 'Scan a receipt or statement photo / PDF'
            : 'Scanning needs an internet connection'}
        >
          <ScanLine className="w-5 h-5" />
        </button>
        )}
        <button
          onClick={() => { setImportStartMode('csv'); setShowImport(true); }}
          className="pointer-events-auto w-12 h-12 rounded-full bg-white border border-stone-300 text-stone-700 shadow-md hover:bg-stone-50 active:scale-95 transition flex items-center justify-center"
          aria-label="Import CSV"
          title="Import expenses from a CSV file"
        >
          <Upload className="w-5 h-5" />
        </button>
        <button
          onClick={() => setEditing('new')}
          className="pointer-events-auto w-14 h-14 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 active:scale-95 transition flex items-center justify-center"
          aria-label="Add expense"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>
      </div>

      {editing && (
        <ExpenseModal
          expense={editing === 'new' ? null : editing}
          people={people}
          isSolo={isSolo}
          myName={profile?.display_name || 'Me'}
          categoryOverrides={categoryOverrides}
          onRememberCategory={actions.rememberCategory}
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
          paymentNotes={activeGroup?._memberPaymentNotes || {}}
          myName={profile?.display_name || 'Me'}
          recordDenyReason={recordDenyReason}
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
          myUserId={user?.id}
          categoryOverrides={categoryOverrides}
          existingExpenses={expenses}
          startMode={importStartMode}
          online={online}
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

      {/* Premium upgrade prompt — only ever shown once PREMIUM_ENFORCED is true
          and a non-premium user taps a premium feature. Points them at
          Settings → Premium. Minimal modal; no checkout here (Phase 2). */}
      {premiumPrompt && (
        <UpgradePrompt feature={premiumPrompt} onClose={() => setPremiumPrompt(null)} />
      )}
    </div>
  );
}

/* ============ Premium upgrade prompt ============
 *
 * A small, dependency-free modal shown when a non-premium user tries to use a
 * premium-only feature (receipt scanning, PDF export). It only appears once
 * PREMIUM_ENFORCED is flipped on in Phase 2 — until then this never renders.
 * It does NOT start checkout; it simply points the user to Settings → Premium.
 */
function UpgradePrompt({ feature, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white border border-stone-200 shadow-xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
            Premium
          </span>
        </div>
        <h3 className="text-base font-semibold text-stone-900">
          {feature} is a Premium feature
        </h3>
        <p className="text-sm text-stone-600 mt-1.5">
          Upgrade to Splitab Premium to unlock {feature.toLowerCase()} and more.
          You can manage your plan in Settings → Premium.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 text-sm font-medium transition"
        >
          Got it
        </button>
      </div>
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
  pinnedIds = [], onTogglePin,
  // `stale` and `onRetry` MUST be passed in. They live on the store, which only
  // App holds — an earlier version referenced `stale`/`actions` directly in this
  // component, which esbuild happily compiled (it treats unknown identifiers as
  // globals) and which then threw ReferenceError at render, blanking the app.
  stale = false, onRetry,
}) {
  // First name for the greeting (myName is the owner's display name, or 'Me').
  // (The greeting that used this moved into the app bar in AuthGate.)

  // Your overall position across SHARED groups, kept SEPARATE per currency —
  // we can't add ₹ to $ into one number, so we show one chip per currency that
  // isn't settled. Solo groups are personal spending, not money owed, so skip them.
  //
  // A group where we cannot find the user is counted, not silently dropped.
  // Dropping it used to turn a failed profile load into "You're all settled up
  // across your groups" — the most reassuring sentence in the app, shown at
  // precisely the moment we knew least. A total assembled from an unknown
  // number of missing groups is not a total.
  const { netByCurrency, unresolved } = useMemo(() => {
    const m = {};
    let missing = 0;
    groups.forEach(g => {
      const people = g.people || [];
      const isSolo = (g.type === 'solo') || people.length === 1;
      if (isSolo) return;
      const mine = computeNetBalances(people, g.expenses || []).find(b => b.name === myName);
      if (!mine) { missing += 1; return; }
      const code = g.currency || 'USD';
      m[code] = (m[code] || 0) + mine.net;
    });
    return { netByCurrency: m, unresolved: missing };
  }, [groups, myName]);

  // Currencies with a real (non-rounding) balance, for the summary chips.
  const balanceChips = Object.entries(netByCurrency).filter(([, v]) => Math.abs(v) >= SETTLED_EPSILON);
  const hasShared = groups.some(g => !((g.type === 'solo') || (g.people || []).length === 1));

  // ── Sort ──────────────────────────────────────────────────────────────────
  // Per-device preference, so it lives in localStorage rather than the profile —
  // unlike pins, which people expect to follow them between phone and laptop.
  const [sortBy, setSortBy] = useState(() => getSortPref());
  const changeSort = (v) => { setSortBy(v); setSortPref(v); };

  const sorted = useMemo(() => {
    const list = [...groups];
    if (sortBy === 'name') {
      // localeCompare so accented names order sensibly rather than by code point.
      list.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    } else if (sortBy === 'due') {
      // Largest outstanding amount first — "what needs my attention", in either
      // direction (owed to me or by me).
      //
      // IMPORTANT: amounts are NOT comparable across currencies. Sorting the
      // raw numbers puts ₹9,200 (about $110) above $1,090, which is nonsense —
      // the same unit-mixing mistake the balance chips already avoid by showing
      // one chip per currency. Converting would need live FX rates, which this
      // app deliberately doesn't carry.
      //
      // So: group by currency first, then sort by amount WITHIN each currency.
      // Currency order is deterministic — most groups first, then code — so the
      // list doesn't reshuffle unpredictably. For the common single-currency
      // user this behaves exactly like a plain "biggest first".
      const owe = (g) => {
        const mine = computeNetBalances(g.people || [], g.expenses || []).find(b => b.name === myName);
        return mine ? Math.abs(mine.net) : 0;
      };
      const counts = {};
      list.forEach(g => { const c = g.currency || 'USD'; counts[c] = (counts[c] || 0) + 1; });
      const currencyRank = Object.keys(counts)
        .sort((a, b) => (counts[b] - counts[a]) || a.localeCompare(b))
        .reduce((m, c, i) => { m[c] = i; return m; }, {});
      list.sort((a, b) => {
        const ra = currencyRank[a.currency || 'USD'];
        const rb = currencyRank[b.currency || 'USD'];
        if (ra !== rb) return ra - rb;
        return owe(b) - owe(a);
      });
    } else {
      // 'activity' (default): most recently touched first.
      list.sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
    }
    // Pinned groups float to the top, keeping the chosen order among themselves.
    return [...list.filter(g => pinnedIds.includes(g.id)), ...list.filter(g => !pinnedIds.includes(g.id))];
  }, [groups, sortBy, myName, pinnedIds]);

  const pinnedCount = sorted.filter(g => pinnedIds.includes(g.id)).length;

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

      {/* STALE DATA warning. Shown when the figures on screen came from the
          cached snapshot rather than a completed fetch — the watchdog fired, or
          the network failed. Falling back to cache beats an endless spinner,
          but doing it silently is how one device showed four groups while
          another showed five with nothing to say which was right. A wrong
          balance read as current is worse than an obvious wait.
          Amber, not red: nothing is broken, the numbers are just possibly old. */}
      {stale && online && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center gap-2 max-w-3xl mx-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          <span className="text-xs text-amber-800 flex-1">
            Showing saved data — these figures may be out of date.
          </span>
          <button
            onClick={onRetry}
            className="text-xs text-amber-900 underline underline-offset-2 shrink-0"
          >
            Refresh
          </button>
        </div>
      )}

      {/* No second sticky header here any more. Once the greeting moved into the
          app bar and "New group" became the floating button, this strip held
          nothing but the group count — a whole band of chrome for one number,
          which is expensive on a phone. The count now sits next to the
          "Your groups" label below, where it reads as a caption rather than a
          heading. */}

      {/* pb-24 (96px) clears this screen's floating button: 24px bottom-6 offset
          + 56px button = 80px, leaving 16px of breathing room. Only ONE button
          floats here, so this is deliberately smaller than the group screen's
          pb-[216px] — re-check it if a second button is ever added. */}
      <main className="max-w-3xl mx-auto px-4 py-4 pb-24 space-y-4">

        {/* At-a-glance balance across shared groups (one chip per currency). */}
        {hasShared && (
          <div className="bg-white border border-stone-200 rounded-2xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium mb-2">Your balance</div>
            {unresolved > 0 ? (
              /* At least one group's balance could not be worked out, so no
                 honest total exists. Never fall through to "all settled up"
                 here — that is the claim most likely to be believed and least
                 likely to be questioned. */
              <div className="text-sm text-stone-500">
                Your balance isn&rsquo;t available yet.
              </div>
            ) : balanceChips.length === 0 ? (
              <div className="text-sm text-stone-600 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                You&rsquo;re all settled up across your groups.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {balanceChips.map(([code, v]) => {
                  const sym = CURRENCIES[code] || '$';
                  const owed = v > 0;
                  return (
                    <span
                      key={code}
                      className={`text-sm font-semibold px-3 py-1.5 rounded-full border ${
                        owed
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-rose-50 text-rose-600 border-rose-200'
                      }`}
                    >
                      {owed ? `You're owed +${fmt(v, sym)}` : `You owe -${fmt(Math.abs(v), sym)}`}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Group cards, or a friendly empty state for brand-new users. */}
        {groups.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">👋</div>
            <h2 className="font-semibold text-lg text-stone-900">Welcome to Splitab</h2>
            <p className="text-sm text-stone-500 mt-1 max-w-xs mx-auto">
              Create a group for a trip, your apartment, or anything you split — then add expenses and the people involved.
            </p>
            <button
              onClick={onNewGroup}
              className="mt-5 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" />
              Create your first group
            </button>
          </div>
        ) : (
          <>
            {/* Sort control. Only worth the space once there are enough groups
                for ordering to matter. */}
            {groups.length > 1 && (
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">
                  Your groups
                  <span className="ml-1.5 normal-case tracking-normal text-stone-400">
                    · {groups.length}
                    {pinnedCount > 0 && `, ${pinnedCount} pinned`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <ArrowDownUp className="w-3.5 h-3.5 text-stone-400" />
                  <select
                    value={sortBy}
                    onChange={(e) => changeSort(e.target.value)}
                    aria-label="Sort groups"
                    className="text-xs font-medium text-stone-600 bg-transparent border border-stone-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500"
                  >
                    {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {sorted.map(g => (
                <GroupCard
                  key={g.id}
                  group={g}
                  myName={myName}
                  pinned={pinnedIds.includes(g.id)}
                  onTogglePin={onTogglePin ? () => onTogglePin(g.id) : undefined}
                  onOpen={() => onOpenGroup(g.id)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Floating "new group" button. Matches the Add-expense button inside a
          group (same size and colour) so the primary action lives in the same
          place on both screens — which is also why it replaced the header
          button rather than sitting alongside it.
          ALIGNED TO THE CONTENT COLUMN, not the viewport: `right-6` pinned it to
          the far edge of a wide monitor, miles from the cards and the avatar it
          belongs with. The wrapper reuses the same max-w-3xl column as the page,
          so the button tracks the content on desktop and still sits bottom-right
          on a phone, where the column fills the screen. pointer-events-none on
          the wrapper keeps the full-width strip from swallowing clicks. */}
      <div className="fixed inset-x-0 bottom-6 z-30 pointer-events-none">
        <div className="max-w-3xl mx-auto px-4 flex justify-end">
          <button
            onClick={onNewGroup}
            className="pointer-events-auto w-14 h-14 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 active:scale-95 transition flex items-center justify-center"
            aria-label="New group"
            title="New group"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </div>

      {groupsModal}
      {confirmDelete}
    </div>
  );
}

/* ============ Group card (one tile on the home dashboard) ============
 *
 * NOTE ON MARKUP: this card used to be a single <button>. It can't be any more —
 * the pin control is itself a button, and nesting a button inside a button is
 * invalid HTML with undefined click behaviour. So the card is a div with
 * role="button" plus explicit Enter/Space handling to keep it keyboard-usable,
 * and the pin stops propagation so pinning never also opens the group.
 */
function GroupCard({ group, myName, onOpen, pinned = false, onTogglePin }) {
  const people = group.people || [];
  const isSolo = (group.type === 'solo') || people.length === 1;

  // The signed-in user's net balance in THIS group, using the shared math.
  // We match the current user by the name the owner appears as in group.people
  // (their profile display name, falling back to 'Me' — same convention the
  // rest of App.jsx uses).
  //
  // "Not found" is NOT the same as "owes nothing", and conflating the two used
  // to make this card lie. When the profile fetch fails, myName falls back to
  // 'Me', which matches no member of any group, so every card rendered the
  // reassuring green "Settled up" no matter what was actually owed — and the
  // summary above agreed with it. A balance we could not compute must never be
  // displayed as a balance of zero, so `settled` now requires actually having
  // found the user.
  const net = computeNetBalances(people, group.expenses || []);
  const mine = net.find(b => b.name === myName);
  const identified = !!mine;
  const myNet = mine ? mine.net : 0;

  // Within a cent = settled up (matches the settle-up rounding elsewhere).
  const settled = identified && Math.abs(myNet) < SETTLED_EPSILON;
  const owed = myNet > 0;   // positive net → you are OWED money

  // This card must print in THIS group's own currency — several cards are on
  // screen at once, so we can't rely on the single module-level symbol. We pass
  // this symbol explicitly to fmt() below.
  const sym = CURRENCIES[group.currency] || '$';

  // Up to 4 avatar circles, then a "+N" overflow bubble.
  const shown = people.slice(0, 4);
  const overflow = people.length - shown.length;

  // "N new" badge: how many activity items (expenses + settlements + member
  // joins) appeared since the user last opened THIS group. Solo groups have no
  // shared activity worth flagging, so we skip the badge for them.
  const newCount = isSolo ? 0 : countNewActivity(group, getLastSeen(group.id));
  const newLabel = newCount > 9 ? '9+' : String(newCount);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Restores the keyboard behaviour a real <button> gave us for free.
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      className={`group relative text-left bg-white rounded-2xl p-4 cursor-pointer flex flex-col gap-3
        border transition-all duration-150
        hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2
        ${pinned
          ? 'border-indigo-200 shadow-[0_1px_2px_rgba(49,46,129,0.06),0_8px_24px_-12px_rgba(49,46,129,0.25)]'
          : 'border-stone-200/80 shadow-[0_1px_2px_rgba(28,25,23,0.04)] hover:shadow-[0_2px_4px_rgba(28,25,23,0.04),0_12px_28px_-16px_rgba(28,25,23,0.35)] hover:border-stone-300'
        }`}
    >
      {/* Title + solo tag + "N new" activity badge + pin */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-center gap-1.5">
          {pinned && <Pin className="w-3.5 h-3.5 text-indigo-500 shrink-0 fill-indigo-500" />}
          <span className="font-semibold text-[15px] text-stone-900 truncate tracking-tight">{group.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {newCount > 0 && (
            <span className="text-[10px] font-semibold text-white bg-indigo-600 rounded-full px-2 py-0.5">
              {newLabel} new
            </span>
          )}
          {isSolo && (
            <span className="text-[10px] uppercase tracking-wider text-stone-500 bg-stone-100 border border-stone-200 rounded-full px-2 py-0.5">
              solo
            </span>
          )}
          {onTogglePin && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
              aria-label={pinned ? `Unpin ${group.name}` : `Pin ${group.name}`}
              aria-pressed={pinned}
              title={pinned ? 'Unpin' : 'Pin to top'}
              /* Always visible on touch (no hover there); fades in on pointer devices. */
              className={`-m-1 p-1 rounded-lg transition hover:bg-stone-100 ${
                pinned ? 'text-indigo-600' : 'text-stone-400 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100'
              }`}
            >
              {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
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

      {/* The signed-in user's balance — the reason you opened the app, so it
          gets the most visual weight on the card. The label sits above the
          figure so the number itself can be scanned down a column of cards. */}
      {isSolo ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 font-medium">Personal</div>
          <div className="text-sm text-stone-500 mt-0.5">Spending only</div>
        </div>
      ) : !identified ? (
        /* We could not find the signed-in user among this group's members —
           almost always because their profile hasn't loaded yet. Say so
           plainly. Silence would be read as "settled up". */
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 font-medium">Balance</div>
          <div className="text-sm font-medium text-stone-400 mt-0.5">Not available yet</div>
        </div>
      ) : settled ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 font-medium">Balance</div>
          <div className="text-sm font-medium text-stone-500 mt-0.5 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            Settled up
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 font-medium">
            {owed ? 'You are owed' : 'You owe'}
          </div>
          <div className={`text-lg font-semibold tabular-nums mt-0.5 tracking-tight ${
            owed ? 'text-emerald-700' : 'text-rose-600'
          }`}>
            {owed ? '+' : '-'}{fmt(Math.abs(myNet), sym)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ Activity tab (shared groups only) ============
 *
 * A single chronological feed of everything that happened in this group, newest
 * first. It reuses data the store already provides — no new tables or queries:
 *   • each real expense        → "{paidBy} added {name}"   (category emoji + amount)
 *   • each settlement          → "{from} paid {to}"        (handshake + amount)
 *   • each member who joined   → "{name} joined" / "{name} was added" (ghost)
 *
 * Every item carries a createdAt (an ISO timestamp). We merge the three kinds
 * into one list, sort newest-first, and render a simple timeline.
 */
function ActivityTab({ group }) {
  const expenses    = group?.expenses || [];      // real expenses + settlements
  const memberJoins = group?._memberJoins || [];
  // Deleted expenses/settlements (db/23). Empty when the group has none AND
  // when the migration hasn't been run — the store attaches [] in both cases,
  // so nothing extra renders and the tab looks exactly as it does today.
  const deletions   = group?._deletions || [];

  // Build a flat list of timeline items, each with a sortable timestamp `ts`.
  const items = useMemo(() => {
    const list = [];

    expenses.forEach(e => {
      if (e.type === 'settlement') {
        // A recorded payment between two people.
        list.push({
          key:      'settle-' + e.id,
          kind:     'settlement',
          title:    `${e._settleFrom} paid ${e._settleTo}`,
          amount:   Number(e.amount || 0),
          iso:      e.createdAt,
        });
      } else {
        // A normal expense. The app doesn't track a separate "creator", so we
        // attribute it to whoever paid — that's the person the row is about.
        list.push({
          key:      'exp-' + e.id,
          kind:     'expense',
          emoji:    catMeta(e.category).emoji,
          title:    `${e.paidBy} added ${e.name}`,
          amount:   Number(e.amount || 0),
          iso:      e.createdAt,
        });
      }
    });

    memberJoins.forEach((m, i) => {
      list.push({
        key:    'join-' + m.name + '-' + i,
        kind:   'join',
        title:  m.isGhost ? `${m.name} was added` : `${m.name} joined`,
        iso:    m.createdAt,
      });
    });

    // Something REMOVED. Every field below is a snapshot taken at deletion
    // time, so this row still reads correctly long after the expense, and even
    // the people involved, are gone.
    deletions.forEach(d => {
      // Fall back to a generic phrase rather than empty quotes when the
      // description wasn't captured.
      const what = d.description
        ? `"${d.description}"`
        : (d.kind === 'settlement' ? 'a settlement' : 'an expense');
      list.push({
        key:     'del-' + d.id,
        kind:    'deletion',
        title:   `${d.deletedByName || 'Someone'} deleted ${what}`,
        // Who had paid it — the detail that explains whose balance just moved.
        subtitle: d.payerName ? `was paid by ${d.payerName}` : '',
        // May be null if the amount wasn't captured; the row then shows no figure.
        amount:  d.amount,
        iso:     d.deletedAt,
      });
    });

    // Newest first. Items with no/invalid date sort to the bottom (ts = 0).
    const ts = (iso) => {
      if (!iso) return 0;
      const t = new Date(iso).getTime();
      return isNaN(t) ? 0 : t;
    };
    return list
      .map(it => ({ ...it, ts: ts(it.iso) }))
      .sort((a, b) => b.ts - a.ts);
  }, [expenses, memberJoins, deletions]);

  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-stone-400">
        <Activity className="w-8 h-8 mx-auto mb-2 opacity-60" />
        <div className="text-sm">No activity yet.</div>
        <div className="text-xs mt-1">Adding expenses and people will show up here.</div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden divide-y divide-stone-100">
      {items.map(it => (
        <div key={it.key} className="flex items-center gap-3 px-3 py-2.5">
          {/* Left icon dot — a little colored circle keyed to the item kind.
              A deletion gets a rose bin so it reads as a REMOVAL at a glance,
              not as one more thing that was added. */}
          <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
            it.kind === 'settlement'
              ? 'bg-emerald-50 text-emerald-700'
              : it.kind === 'join'
                ? 'bg-indigo-50 text-indigo-600'
                : it.kind === 'deletion'
                  ? 'bg-rose-50 text-rose-600'
                  : 'bg-stone-100'
          }`}>
            {it.kind === 'settlement'
              ? <Handshake className="w-4 h-4" />
              : it.kind === 'join'
                ? <User className="w-4 h-4" />
                : it.kind === 'deletion'
                  ? <Trash2 className="w-4 h-4" />
                  : <span>{it.emoji}</span>}
          </div>

          {/* Title + relative time. A deletion also names who had paid the
              thing that went, on the same line as the time. */}
          <div className="flex-1 min-w-0">
            <div className={`text-sm truncate ${
              it.kind === 'deletion' ? 'text-stone-500' : 'text-stone-800'
            }`}>
              {it.title}
            </div>
            <div className="text-[11px] text-stone-400 truncate">
              {it.subtitle ? `${it.subtitle} · ${timeAgo(it.iso)}` : timeAgo(it.iso)}
            </div>
          </div>

          {/* Right-aligned amount (expenses + settlements, and deletions that
              captured one). Struck through for a deletion: that money is no
              longer in the balances. */}
          {(it.kind === 'expense' || it.kind === 'settlement' ||
            (it.kind === 'deletion' && it.amount != null)) && (
            <div className={`shrink-0 text-sm font-semibold tabular-nums ${
              it.kind === 'settlement'
                ? 'text-emerald-700'
                : it.kind === 'deletion'
                  ? 'text-rose-500 line-through'
                  : 'text-stone-900'
            }`}>
              {fmt(it.amount)}
            </div>
          )}
        </div>
      ))}
    </div>
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
          {/* `spent`, NOT `paid`: settlements are transfers between people, not
              money spent on the trip. Using `paid` here made these two figures
              sum to more than the group total. */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-stone-500">{a.name} spent</div>
            <div className="font-semibold tabular-nums">{fmt(a.spent)}</div>
          </div>
          <div className="w-px h-8 bg-stone-200" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-stone-500">{b.name} spent</div>
            <div className="font-semibold tabular-nums">{fmt(b.spent)}</div>
          </div>
        </div>
        {settleAmt > SETTLED_EPSILON ? (
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
  const allSettled = balances.every(b => Math.abs(b.net) < SETTLED_EPSILON);
  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm">
      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        {balances.map((b, i) => (
          <div key={b.name} className="shrink-0 flex items-center gap-3">
            {i > 0 && <div className="w-px h-8 bg-stone-200" />}
            <div>
              {/* `spent`, not `paid` — see the 2-person branch above. */}
              <div className="text-[10px] uppercase tracking-wider text-stone-500 truncate max-w-[80px]">{b.name} spent</div>
              <div className="font-semibold tabular-nums">{fmt(b.spent)}</div>
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

// `deleteDenyReason(entry)` returns null when the signed-in user may delete that
// row, or the sentence explaining why not. It defaults to "no reason to refuse"
// so a caller that forgets to pass it degrades to the old behaviour (every bin
// enabled, the database still refusing) rather than silently disabling
// everything — the check is a UX prediction, not a guard. See App().
function ExpensesTab({ grouped, count, visibleTotal, search, setSearch, filterCat, setFilterCat, sortBy, setSortBy, onEdit, onDelete, deleteDenyReason = () => null, isSolo }) {
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
            {list.map(e => {
              const denyReason = deleteDenyReason(e);
              return (
                <ExpenseRow
                  key={e.id}
                  e={e}
                  onEdit={() => onEdit(e)}
                  onDelete={() => onDelete(e.id)}
                  canDelete={!denyReason}
                  denyReason={denyReason}
                  isSolo={isSolo}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// `canDelete` / `denyReason` come from ExpensesTab and describe whether the
// signed-in user would be ALLOWED to delete this row (db/23). They default to
// "allowed" so a missing prop can never produce a dead control.
//
// The bin is DISABLED rather than hidden when the answer is no. A control that
// disappears is confusing and teaches the user nothing; a disabled one with a
// reason attached says what the rule is and who to ask. Nothing here protects
// the data — see the note by deleteDenyReason in App().
function ExpenseRow({ e, onEdit, onDelete, canDelete = true, denyReason = null, isSolo }) {
  const isSettle = e.type === 'settlement';
  // min-h-[44px]/min-w-[44px]: the minimum comfortable tap target on a phone.
  // Written as arbitrary values because `min-h-11` does nothing in this Tailwind
  // version. The icon size is unchanged — only the hit area is guaranteed.
  const binBase = 'min-h-[44px] min-w-[44px] flex items-center justify-center rounded shrink-0';
  const binTone = canDelete
    ? 'text-stone-400 hover:text-red-600'
    : 'text-stone-300 cursor-not-allowed';
  const binTitle = canDelete ? 'Delete' : denyReason;
  // "recorded by X" (db/24), shown ONLY when the person who ENTERED the record
  // is not the person it says PAID. Same-person is the ordinary case — you add
  // what you spent — and repeating it on every row would be noise on the one
  // screen people scan fastest.
  //
  // Null when we do not know: every row written before db/24, and everything
  // until the owner runs it. We render nothing rather than "recorded by
  // someone", which tells the reader less than silence does and reads as a bug.
  // For a settlement `paidBy` is the person who SENT the money, so the same
  // comparison asks the right question of both kinds of row.
  const recordedBy = (e.createdByName && e.createdByName !== e.paidBy)
    ? e.createdByName
    : null;
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
            {/* The case this exists for: a payment somebody else entered on your
                behalf. Quiet and secondary to the amount on the right — it
                answers "where did this come from", it does not compete. */}
            {recordedBy && (
              <span className="text-[10px] text-stone-500 truncate">recorded by {recordedBy}</span>
            )}
            {e.note && <span className="text-[10px] text-stone-500 truncate">{e.note}</span>}
          </div>
        </button>
        <div className="text-right shrink-0">
          <div className="font-semibold tabular-nums text-sm text-emerald-900">{fmt(Number(e.amount || 0))}</div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          // aria-disabled, NOT disabled. A truly disabled button cannot be clicked,
          // and this is a phone-first app: with no hover there is no tooltip, so a
          // blocked user would see a greyed bin and be told NOTHING - the exact
          // silent failure this whole change exists to end, reintroduced on the
          // platform most people use. Left clickable, the tap routes to
          // removeExpense, which refuses and shows the reason. Still no optimistic
          // removal, still no doomed request.
          aria-disabled={!canDelete}
          title={binTitle}
          aria-label={binTitle}
          className={`${binBase} ${binTone}`}
        >
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
          {/* Only when someone else entered it — an expense attributed to you
              that you do not remember adding is the same question as above.
              Never on a solo group, where you are always both. */}
          {!isSolo && recordedBy && (
            <span className="text-[10px] text-stone-500 truncate">recorded by {recordedBy}</span>
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
        <button
          type="button"
          onClick={onDelete}
          // aria-disabled, NOT disabled. A truly disabled button cannot be clicked,
          // and this is a phone-first app: with no hover there is no tooltip, so a
          // blocked user would see a greyed bin and be told NOTHING - the exact
          // silent failure this whole change exists to end, reintroduced on the
          // platform most people use. Left clickable, the tap routes to
          // removeExpense, which refuses and shows the reason. Still no optimistic
          // removal, still no doomed request.
          aria-disabled={!canDelete}
          title={binTitle}
          aria-label={binTitle}
          className={`${binBase} ${binTone}`}
        >
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

// DELETED: barColorFromTone(tone), which returned `bg-${family}-500`.
//
// It was correct under the Tailwind Play CDN, which compiled classes from the
// live DOM. Once the CDN was replaced by a build step (backlog #13) the
// scanner could only see literal strings, so every constructed name vanished
// from the stylesheet and the bars it coloured silently rendered at zero
// width. Nothing threw; the markup was there; only the CSS rule was missing.
//
// The colour now lives in CATEGORIES[].bar as a literal. If you are tempted to
// re-derive it to avoid the repetition, this is the note saying don't.

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

  // The biggest individual expenses in the chosen period (top 3, high → low).
  const topExpenses = useMemo(
    () => [...periodExpenses].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)).slice(0, 3),
    [periodExpenses]
  );

  // Spend per month across ALL expenses (oldest → newest) for the trend bars.
  // Independent of the period filter — it's the "zoom out" view.
  const monthly = useMemo(() => {
    const m = {};
    expenses.forEach(e => { const k = String(e.date || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + Number(e.amount || 0); });
    return Object.entries(m).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [expenses]);

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

      {/* Top category highlight.
       *
       * ⚠️ DARK MODE NEEDS EXPLICIT HANDLING HERE, and the reason is worth
       * knowing because it applies to every coloured panel in the app.
       * styles.css remaps the STONE palette for dark mode but deliberately
       * leaves coloured tints alone, on the reasoning that a chip like
       * `bg-rose-50 text-rose-800` carries its own matching text colour and
       * stays readable. True for a chip — but this is a coloured panel using
       * STONE text, so the background stayed pale indigo while
       * `.dark .text-stone-900` turned the text near-white. Unreadable, and
       * reported from a real phone.
       *
       * So: darken the panel with `dark:` variants, and lighten the indigo
       * label to match. `text-stone-900` and `text-stone-500` already flip to
       * light on their own, which is correct once the panel is dark.
       *
       * The amount below also gains `text-stone-900`, which it never had.
       * NOT because unclassed text is undefined in dark mode — an earlier
       * version of this comment claimed that and was wrong. The app root
       * carries `text-stone-900` (see the `min-h-screen` wrappers), and
       * `.dark .text-stone-900` is `!important`, so unclassed text INHERITS
       * #f5f5f4 and is light. That is precisely the problem: it inherits a
       * light colour onto a pale panel and disappears, the same failure as
       * above arriving by inheritance instead of by class. Stating the colour
       * here makes the element's contrast legible to whoever reads it next,
       * instead of depending on a wrapper hundreds of lines away.
       *
       * Measured after the fix: 15.47:1 in dark, 15.64:1 in light. Before it,
       * 1.03:1 — which is what "unreadable" looks like as a number. */}
      <div className="bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-900 rounded-xl p-4 flex items-center gap-3">
        <div className="text-2xl shrink-0">{topMeta.emoji}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-indigo-700 dark:text-indigo-300 font-medium">Top category</div>
          <div className="font-semibold text-stone-900 truncate">{topCat}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold tabular-nums text-stone-900">{fmt(topAmt)}</div>
          {/* stone-600, not stone-500: measured 4.29:1 against this panel's
              pale indigo, under the 4.5:1 AA floor. stone-500 is tuned for
              WHITE cards and loses about 0.3 of its ratio on a tint. At 10px
              the large-text allowance does not apply. */}
          <div className="text-[10px] text-stone-600 tabular-nums">{topPct.toFixed(1)}% of total</div>
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
                  className={`h-full rounded-full transition-all ${meta.bar || 'bg-stone-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Biggest individual expenses in the period. */}
      {topExpenses.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2.5">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">Biggest expenses</div>
          {topExpenses.map((e, i) => {
            const meta = catMeta(e.category);
            return (
              <div key={i} className="flex items-center gap-2.5 text-sm">
                <span className="text-base shrink-0">{meta.emoji}</span>
                {/* `e.name`, NOT `e.description`. The UI expense shape uses
                    `name` (store.js builds it that way); `description` is the
                    key the scan Edge Function returns, and it does not survive
                    into the store. Reading it here yielded undefined, so every
                    row in this panel rendered an emoji and an amount with a
                    blank space between them — visible in a screenshot, silent
                    in the console, and shipped since June. */}
                <span className="font-medium text-stone-800 truncate flex-1">{e.name}</span>
                <span className="font-semibold tabular-nums shrink-0">{fmt(Number(e.amount || 0))}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Spending over time — only meaningful in "All time" with 2+ months. */}
      {period === 'all' && monthly.length > 1 && (() => {
        const max = Math.max(...monthly.map(x => x[1]));
        return (
          <div className="bg-white border border-stone-200 rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium mb-3">Spending over time</div>
            <div className="flex items-end gap-1.5 h-28">
              {monthly.map(([mk, amt]) => {
                const h = max > 0 ? Math.max(4, (amt / max) * 100) : 4;
                return (
                  <div
                    key={mk}
                    className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0 h-full"
                    title={`${monthLabel(mk)}: ${fmt(amt)}`}
                  >
                    <div className="w-full bg-indigo-500/80 rounded-t" style={{ height: `${h}%` }} />
                    <span className="text-[9px] text-stone-400 truncate w-full text-center">{mk.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SummaryTab({ expenses, settlements, balances, sharedPool, total, people, entries, paymentNotes, myName, onSettle, onExportCsv, onExportPdf }) {
  // display name → "how to pay me" note (from group._memberPaymentNotes).
  const notes = paymentNotes || {};
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

  // The 2-person card below states a single "X pays Y". Name both sides once
  // here so the payment note can be attached to it without repeating the
  // ternary. Null for a 1-person balance list (nothing to pay).
  const duoFrom = balances.length >= 2 ? (a.net > 0 ? balances[1].name : a.name) : null;
  const duoTo   = balances.length >= 2 ? (a.net > 0 ? a.name : balances[1].name) : null;

  // Everyone who owes ME in the current suggestion set. Used for the single
  // "add your own payment details" nudge below — computed once here, so three
  // people owing you still produces exactly ONE prompt, not three.
  const myPayers = isMulti
    ? suggestions.filter(s => s.to === myName).map(s => s.from)
    : (suggestions.length > 0 && duoTo === myName ? [duoFrom] : []);

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
              {/* Every component shown separately so the net on the right is
                  checkable: net = (spent + repaid) − (owes + received).
                  Previously this read "Paid X · Owes Y" where BOTH silently
                  folded in settlements, so the figures could not be reconciled
                  against the group total. */}
              <div className="text-xs text-stone-500 mt-0.5">
                Spent {fmt(b.spent)} · Owes {fmt(b.share)}
                {b.repaid   > SETTLED_EPSILON && <> · Repaid {fmt(b.repaid)}</>}
                {b.received > SETTLED_EPSILON && <> · Received {fmt(b.received)}</>}
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
                <div key={i} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="text-stone-200">{s.from} pays {s.to}</span>
                    {/* Same rule as the settle modal: only the row where YOU
                        are the payer, because that's the one you must act on. */}
                    {s.from === myName && (
                      <PaymentNoteLine name={s.to} note={notes[s.to]} tone="dark" amount={s.amount} />
                    )}
                  </div>
                  <span className="font-semibold tabular-nums shrink-0">{fmt(s.amount)}</span>
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
            <div className="mt-1 mb-3 min-w-0">
              <div className="text-3xl font-semibold tabular-nums">{fmt(settleAmt)}</div>
              {/* Only when YOU are the payer — see the multi-person list above. */}
              {duoFrom === myName && (
                <PaymentNoteLine name={duoTo} note={notes[duoTo]} tone="dark" amount={settleAmt} />
              )}
            </div>
            <button
              onClick={onSettle}
              className="w-full py-2.5 rounded-lg bg-white text-stone-900 text-sm font-medium hover:bg-stone-100 active:scale-[0.99] transition flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Mark as settled
            </button>
          </>
        )}
        {/* Rendered ONCE for the whole card, outside both branches and outside
            the suggestion loop: one prompt however many people owe you. It
            hides itself when you already have a note (see the component). */}
        <OwnPaymentNoteNudge myNote={notes[myName]} payers={myPayers} tone="dark" />
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
                {/* This list IS the payment ledger, so "who entered it" belongs
                    here more than anywhere. Appended to the date line — one
                    muted line, not a second one. Shown only when the recorder is
                    not the person who sent the money, and never when db/24 has
                    not run (createdByName is null and we say nothing). */}
                <div className="text-[11px] text-stone-500">
                  {formatDay(s.date)}
                  {s.createdByName && s.createdByName !== s.paidBy && ` · recorded by ${s.createdByName}`}
                </div>
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
                      // Same dark-mode trap as the Top category card above: a
                      // coloured panel whose text comes from the stone palette.
                      // Without dark:bg-indigo-950/50 the ACTIVE group is the
                      // one card in this list you cannot read at night.
                      isActive ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50' : 'border-stone-200 bg-white hover:border-stone-400'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button onClick={() => onSwitch(g.id)} className="flex-1 min-w-0 text-left">
                        {/* stone-600 rather than stone-500 on both secondary lines.
                            Measured 4.29:1 on the ACTIVE card's pale indigo tint,
                            under the 4.5:1 AA floor — stone-500 is tuned for white
                            cards and loses about 0.3 of its ratio on any tint. It is
                            applied to every card, not just the active one, because
                            two greys for the same kind of text would be a worse
                            result than one slightly darker grey. */}
                        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-stone-600">
                          {isSolo ? <><User className="w-3 h-3" /> Personal</> : <><Users className="w-3 h-3" /> {g.people.join(' & ')}</>}
                        </div>
                        <div className="font-medium mt-0.5 truncate text-stone-900">{g.name}</div>
                        <div className="text-xs text-stone-600 mt-0.5 tabular-nums">
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

/* ============ "How to pay them" note ============
 *
 * Shows the PAYEE's own free-text payment note (a UPI id, a Venmo handle,
 * "cash is fine"…) to the person who owes them, so they know where to send
 * the money.
 *
 * **The app still never touches money** — no payment SDK, no API, nothing that
 * holds or transfers funds. That part of the original rule is unchanged and
 * should stay that way: it is what keeps Splitab out of being a regulated
 * payment service.
 *
 * ⚠️ WHAT DID CHANGE (2026-09-18): this used to say "no upi:// or venmo://
 * deep link" as well, and that went further than the reasoning behind it. A
 * deep link does not move money — it opens the payer's own app with the fields
 * filled in, and they authorise it there. An INR-only UPI button is now
 * rendered below when the note contains a real VPA. See the long note on
 * UPI_VPA / buildUpiUri above for why UPI specifically, and why nothing
 * equivalent is offered for Venmo or anything else.
 *
 * When the note is EMPTY we say so in one quiet line instead of rendering
 * nothing. Every call site is already gated on the viewer being the payer, so
 * inside here "empty" can only mean "the person I owe hasn't set this up" —
 * and blank space left the payer unable to tell that apart from a broken app.
 * It is deliberately lighter than a real note (it is an explanation, not an
 * error) and it never appears to anyone but the person who has to pay.
 *
 * Long notes: these are free text up to 200 chars and can be one unbroken
 * token, so `break-words` lets them wrap inside the row instead of blowing the
 * layout out sideways. It stays inline text (NOT a `title` tooltip, which is
 * useless on a phone) and `select-all` makes one tap grab the whole handle.
 */
function PaymentNoteLine({ name, note, tone = 'light', amount }) {
  const text = typeof note === 'string' ? note.trim() : '';
  // No name = nothing sensible to say (e.g. a 1-person balance list).
  if (!name) return null;
  if (!text) {
    return (
      <div className={`text-[11px] mt-0.5 leading-snug break-words italic ${tone === 'dark' ? 'text-stone-500' : 'text-stone-400'}`}>
        {name} hasn't added payment details.
      </div>
    );
  }

  // THREE conditions, all required. The note must contain something that is
  // unambiguously a VPA, and the group must be settling in rupees. Anything
  // else falls through to the plain text line this component has always shown,
  // so nobody outside India sees a change.
  const vpa = currencyCode === 'INR' ? findUpiId(text) : null;

  return (
    <div className={`text-[11px] mt-0.5 leading-snug break-words ${tone === 'dark' ? 'text-stone-400' : 'text-stone-500'}`}>
      Pay {name}: <span className="select-all">{text}</span>
      {vpa && (
        <>
          {/* The raw note stays above, deliberately. The button is a
              convenience, not a replacement: UPI links do nothing on a desktop
              browser, and an app can be missing or refuse the URI. If this
              were the ONLY way to see the handle, those cases would leave the
              payer with no way to pay at all. */}
          <a
            href={buildUpiUri({ vpa, payeeName: name, amount, note: 'Splitab settle-up' })}
            className={`mt-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
              tone === 'dark'
                ? 'bg-white text-stone-900 hover:bg-stone-100'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {/* Guarded: a call site that has no amount to hand (or a
                half-typed one) must not render "Pay ₹NaN with UPI". The URI
                omits the amount in the same case, so the payer types it in
                their own app instead of being shown nonsense. */}
            {Number.isFinite(Number(amount)) && Number(amount) > 0
              ? `Pay ${fmt(amount)} with UPI`
              : 'Pay with UPI'}
          </a>
          <div className={`mt-0.5 ${tone === 'dark' ? 'text-stone-500' : 'text-stone-400'}`}>
            Opens your UPI app. Splitab never moves the money — you still confirm it there,
            and mark it done here afterwards.
          </div>
        </>
      )}
    </div>
  );
}

/* ============ "Add your own payment details" nudge ============
 *
 * The mirror image of PaymentNoteLine. It is shown to the PAYEE — the person
 * someone else owes money to — when THEY have not written their own note, so
 * the payer has nothing to read. Settle-up is the exact moment the feature
 * would have paid off for them, which is why the prompt lives here instead of
 * being a generic banner somewhere in Settings.
 *
 * Plain text only, on purpose: it names the Profile screen in words rather
 * than offering navigation or a button. Still no payment integration of any
 * kind (CLAUDE.md §8).
 *
 * ONE per settle-up view: callers render this ONCE, outside the suggestion
 * loop, and pass every person who owes them. Three debts owed to you is still
 * one thing to fix, so it is one prompt.
 *
 * Renders nothing when the user already has a note, or when nobody in the
 * current suggestion set owes them.
 */
function OwnPaymentNoteNudge({ myNote, payers, tone = 'light' }) {
  const mine = typeof myNote === 'string' ? myNote.trim() : '';
  if (mine) return null;                      // already set up — say nothing
  const names = (payers || []).filter(Boolean);
  if (names.length === 0) return null;        // nobody owes you right now

  // "Shailja", "Shailja and Amit", "Shailja and 2 others".
  const who =
    names.length === 1 ? names[0] :
    names.length === 2 ? `${names[0]} and ${names[1]}` :
    `${names[0]} and ${names.length - 1} others`;
  const verb = names.length === 1 ? 'knows' : 'know';

  return (
    <div className={`text-[11px] mt-2 leading-snug break-words ${tone === 'dark' ? 'text-stone-400' : 'text-stone-500'}`}>
      Add your payment details on your Profile so {who} {verb} how to pay you.
    </div>
  );
}

/* ============ Settle modal ============ */

// `recordDenyReason(fromName, toName)` returns null when the signed-in user may
// record that payment (db/24), or the sentence explaining why not. It defaults
// to "no reason to refuse" so a caller that forgets to pass it degrades to the
// old behaviour (every Record button live, the database still deciding) rather
// than silently blocking everyone — the check is a UX prediction, not a guard.
// See App().
function SettleModal({ balances, people, entries, paymentNotes, myName, recordDenyReason = () => null, onClose, onConfirm, onRecord }) {
  // For 3+ members we show a "who pays whom" list instead of a single form.
  if (people.length >= 3) {
    return (
      <MultiSettleModal
        people={people}
        entries={entries}
        paymentNotes={paymentNotes}
        myName={myName}
        recordDenyReason={recordDenyReason}
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

  // db/24's predicted refusal for this one payment. In a two-person group the
  // signed-in user is normally one of the two, so this is almost always null —
  // but "almost always" is not "always" (a display name that resolves to no
  // account, a snapshot written by an older bundle), and a Record button that
  // silently fails is precisely what is being removed. Fails open like the rest.
  const denyRecord = recordDenyReason(fromPerson, toPerson);
  const canRecord  = !denyRecord;

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-stone-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold">Record settlement</h2>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-medium mb-1">Payment</div>
            <div className="font-semibold text-emerald-900">
              {fromPerson} pays {toPerson}
            </div>
            {/* Only when YOU are the one paying: you need to know where to send
                it. Showing one other person's payment handle to a third party
                would be needless exposure. */}
            {/* amount is the LIVE field, not settleAmt: this modal lets the
                payer edit it for a partial payment, and the UPI link must
                carry what they are actually about to send. */}
            {fromPerson === myName && (
              <PaymentNoteLine name={toPerson} note={(paymentNotes || {})[toPerson]} amount={parseFloat(amount)} />
            )}
          </div>

          {/* The reverse case: THEY are paying YOU and you never wrote a note,
              so there is nothing for them to read. One prompt, and only when
              you're the payee on this single payment. */}
          <OwnPaymentNoteNudge
            myNote={(paymentNotes || {})[myName]}
            payers={toPerson === myName ? [fromPerson] : []}
          />

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

          {/* The placeholder suggests WHAT THE PAYMENT WAS FOR, not how it was
              sent. The old one ("e.g. Zelle, cash, Venmo") was both US-only —
              useless to anyone paying by UPI — and aimed at the less useful
              half of the question. Months later nobody wonders which app moved
              the money; they wonder which of several instalments this was, and
              that is the gap this field exists to close. */}
          <Field label="Note (optional)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="e.g. Aug rent — instalment 2 of 3"
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500"
            />
          </Field>
        </div>

        <div className="border-t border-stone-200 px-4 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Cancel
          </button>
          <button
            // .trim() to match MultiSettleModal. Adding trim() there and not
            // here would have stored "  Aug rent  " untrimmed from one modal
            // and trimmed from the other — the same field, two behaviours,
            // depending on how many people are in the group. Caught in review.
            onClick={() => onConfirm({ from: fromPerson, to: toPerson, amount: parseFloat(amount), note: note.trim() })}
            // `disabled` stays for an empty/zero amount: there is nothing to
            // explain and nothing to record, so an inert control is honest.
            disabled={!valid}
            // The REFUSAL is aria-disabled, NOT disabled, for the same reason
            // recorded on the bin buttons: this is a phone-first app, a truly
            // disabled button cannot be tapped, and with no hover there is no
            // tooltip — so a blocked user would see a greyed button and be told
            // NOTHING. Left tappable, the tap routes to recordSettlement, which
            // refuses and shows the reason. Still no optimistic insert, still no
            // doomed request.
            aria-disabled={!canRecord}
            title={canRecord ? 'Record this payment' : denyRecord}
            aria-label={canRecord ? 'Record payment' : denyRecord}
            className={`flex-1 min-h-[44px] py-2.5 rounded-lg text-sm font-medium disabled:bg-stone-300 disabled:text-white ${
              canRecord
                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                : 'bg-stone-200 text-stone-500 cursor-not-allowed'
            }`}
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
function MultiSettleModal({ people, entries, paymentNotes, myName, recordDenyReason = () => null, onClose, onRecord }) {
  // display name → "how to pay me" note (from group._memberPaymentNotes).
  // Defaulted here so a caller that hasn't got the map yet can't crash a render.
  const notes = paymentNotes || {};
  // Track which rows are mid-write so we can disable their buttons.
  const [busyKey, setBusyKey] = useState(null);

  // ONE note for the whole settling session, not one per row.
  //
  // Per-row inputs were the obvious design and are worse here: this list is
  // already dense on a phone — two names, an amount, a Record button and
  // sometimes a refusal reason — and a text field on every row would bury the
  // thing people came to press. A settle-up is normally one event ("Goa trip,
  // final split", "August rent"), so one field describes it and is typed once.
  const [note, setNote] = useState('');

  // Recompute net balances + suggestions on every render (entries change after
  // each recorded payment because the parent refetches).
  const net = computeNetBalances(people, entries || []);
  const suggestions = suggestSettlements(net);

  // Everyone who owes ME in this list — collected once so the "add your own
  // payment details" prompt below appears at most once per settle-up view.
  const myPayers = suggestions.filter(s => s.to === myName).map(s => s.from);

  const handleRecord = async (s) => {
    const key = `${s.from}->${s.to}:${s.amount}`;
    setBusyKey(key);
    // Was hardcoded to 'Settle up'. That string was not just unhelpful, it was
    // NOISE: the expense list renders a settlement's note beneath its row, so
    // every multi-person settlement carried a caption repeating what the row
    // already said. An empty note renders nothing, which is the better default.
    await onRecord({ from: s.from, to: s.to, amount: s.amount, note: note.trim() });
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

          {/* Only worth showing when there is something to record. */}
          {suggestions.length > 0 && (
            <Field label="Note (optional)">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                // Period-based, and deliberately not a holiday. This note covers
                // a whole settling session, so the example must teach "name the
                // occasion" — but "Goa trip" only taught it to travellers, in an
                // app whose category list was widened the same day precisely
                // because the common case is flatmates, not trips. A month fits
                // both, and assumes nothing about where the user is.
                placeholder="e.g. August settle-up"
                className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-indigo-500"
              />
              <div className="text-[11px] text-stone-500 mt-1">
                Added to each payment you record below, and shown against it later.
              </div>
            </Field>
          )}

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
                // db/24: this list is built from everyone's balances, so it
                // offers payments between two OTHER people as readily as your
                // own. Those are the rows the database now refuses. Predict it
                // here so the button explains itself instead of inserting a row,
                // moving every balance, and quietly putting it all back.
                const denyRecord = recordDenyReason(s.from, s.to);
                const canRecord  = !denyRecord;
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
                      {/* Only on the row where YOU are the payer — that's the
                          row you have to act on. On a row between two other
                          people, showing a third party's payment handle would
                          be needless exposure, so we don't. */}
                      {s.from === myName && (
                        <PaymentNoteLine name={s.to} note={notes[s.to]} amount={s.amount} />
                      )}
                    </div>
                    <button
                      onClick={() => handleRecord(s)}
                      // `disabled` stays for the mid-write moment only: there is
                      // nothing to say and a second tap would double-record.
                      disabled={busy}
                      // The REFUSAL is aria-disabled, NOT disabled, for the same
                      // reason recorded on the bin buttons: this is a phone-first
                      // app, a truly disabled button cannot be tapped, and with
                      // no hover there is no tooltip — so a blocked user would
                      // see a greyed button and be told NOTHING. Left tappable,
                      // the tap routes to recordSettlementKeepOpen, which refuses
                      // and shows the reason. No optimistic insert, no doomed
                      // request.
                      aria-disabled={!canRecord}
                      title={canRecord ? `Record ${s.from} paying ${s.to}` : denyRecord}
                      aria-label={canRecord ? `Record ${s.from} paying ${s.to}` : denyRecord}
                      className={`px-4 min-h-[44px] py-2 rounded-lg text-sm font-medium disabled:bg-stone-300 disabled:text-white shrink-0 flex items-center gap-1.5 ${
                        canRecord
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : 'bg-stone-200 text-stone-500 cursor-not-allowed'
                      }`}
                    >
                      <Check className="w-4 h-4" />
                      {busy ? 'Saving…' : 'Record'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ONE nudge for the whole list (outside the map above): if three of
              these rows pay YOU, that is still a single thing to go and fix. */}
          <OwnPaymentNoteNudge myNote={notes[myName]} payers={myPayers} />
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

function ExpenseModal({ expense, people, isSolo, myName, onClose, onSave, categoryOverrides, onRememberCategory }) {
  const isNew = !expense;
  const [name, setName] = useState(expense?.name || '');
  const [amount, setAmount] = useState(expense?.amount?.toString() || '');
  const [date, setDate] = useState(expense?.date || new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(expense?.category || 'Other');
  // Who paid. Two very different cases, so the initial value is computed once,
  // when the form OPENS (lazy useState initialiser — it never re-runs on a
  // later render, so it can't clobber a choice the user has already made):
  //   • EDITING an existing expense → keep exactly what that expense says.
  //     Silently rewriting the payer when someone opens an old expense to fix
  //     a typo would corrupt balances, so edit mode is untouched here.
  //   • A NEW expense → default to the signed-in user. You almost always add
  //     an expense because YOU just paid for it, and a wrong-but-filled-in
  //     payer is the kind of error nobody re-reads.
  // Fallback: if the signed-in user isn't a member of this group (a group of
  // ghosts, or a display-name mismatch), fall back to the old behaviour —
  // people[0] — so we never end up with an empty or non-member paidBy.
  const [paidBy, setPaidBy] = useState(() => {
    if (expense) return expense.paidBy || people[0];
    return people.includes(myName) ? myName : people[0];
  });
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
    setCategory(autoCategorize(name, categoryOverrides));
  }, [name, catManuallySet, categoryOverrides]);

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
              onChange={(e) => {
                setCategory(e.target.value);
                setCatManuallySet(true);
                // Learn from an explicit correction only. Accepting the guess
                // teaches nothing; overriding it is a real preference, and the
                // next expense from this merchant should honour it.
                const key = merchantKey(name);
                if (key && onRememberCategory) onRememberCategory(key, e.target.value);
              }}
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
// `online` defaults to true on purpose: if a future caller forgets to pass it,
// the modal behaves exactly as it did before rather than locking scanning off
// for everyone.
function ImportModal({ people, isSolo, myName, myUserId, categoryOverrides, existingExpenses = [], startMode = 'csv', online = true, onClose, onImport, onScan }) {
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

  // Skip rows that already exist in this group. Defaults ON: the common case is
  // re-importing an overlapping date range from the same bank, where the right
  // answer is "don't add these again". Anyone who genuinely wants the repeats
  // can untick it, which is why this is a toggle and not a silent filter.
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  // Outcome state.
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null); // { inserted } on success
  const [importError, setImportError] = useState('');

  // ── Scan state (only used when mode === 'scan') ────────────────────────────
  const [scanning, setScanning] = useState(false);     // spinner while AI reads
  const [scanError, setScanError] = useState('');      // inline error message
  const [scanRows, setScanRows] = useState(null);       // null = nothing scanned yet
  const [scanFileName, setScanFileName] = useState(''); // name of the picked file
  // { used, limit, enforced, exceeded } — only present once db/16 is applied and
  // the scan function redeployed, so every read of this must tolerate null.
  const [scanQuota, setScanQuota] = useState(null);
  // { done, total } while a multi-file scan is running, else null. Scanning
  // several receipts takes a few seconds each, and a bare spinner for half a
  // minute reads as a hang.
  const [scanProgress, setScanProgress] = useState(null);
  // True when the rows on screen were recovered from a discarded session rather
  // than scanned just now — worth saying, so the user knows why they appeared.
  const [scanRestored, setScanRestored] = useState(false);

  // Per-user so a shared device never restores someone else's receipts.
  const draftKey = myUserId ? SCAN_DRAFT_PREFIX + myUserId : null;

  // Recover anything a discarded page left behind. Runs once on mount: if iOS
  // threw the web view away mid-scan, those rows were already paid for.
  useEffect(() => {
    if (!draftKey) return;
    const draft = loadScanDraft(draftKey);
    if (!draft) return;
    setScanRows(draft.rows);
    setScanRestored(true);
    setMode('scan');
  }, [draftKey]);

  // ── Scan: turn the picked image/PDF into base64 + read it via AI ───────────
  // Turn one File into the base64 payload the Edge Function expects.
  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    // readAsDataURL gives "data:image/jpeg;base64,/9j/4AAQ..." — the function
    // wants only the part after the comma.
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

  // Map one scanned expense into the row shape the CSV preview already uses.
  const mapScanned = (ex, sourceName) => {
    const today = new Date().toISOString().slice(0, 10);
    const name = (ex.description || '').trim() || 'Expense';
    const hasDate = !!ex.date;
    const row = {
      name,
      amount:   Number(ex.amount) || 0,
      date:     hasDate ? ex.date : today,
      category: (ex.category || '').trim() || autoCategorize(name, categoryOverrides),
      _source:  sourceName,
    };
    const flags = [];
    if (ex.uncertain) flags.push(ex.note ? `Low confidence — ${ex.note}` : 'Low confidence — please check');
    if (!hasDate) flags.push('No date found — set to today.');
    if (flags.length) row._warning = flags.join(' · ');
    return row;
  };

  // ── Scan one or MORE files ────────────────────────────────────────────────
  //
  // Files are processed ONE AT A TIME, deliberately, not with Promise.all.
  // Each scan costs a credit and the server enforces a per-minute burst cap, so
  // firing ten at once would trip that cap and waste the attempts. Sequential
  // also means a failure part-way through keeps everything already scanned.
  //
  // Partial success is a real outcome here and is treated as one: if file 4 of 6
  // is unreadable, the rows from 1-3 and 5-6 are still offered, with a note
  // saying which files were skipped and why.
  const handleScanFile = async (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;

    // Belt and braces: the connection can drop between opening this tab and
    // picking a file, and the disabled input was decided a moment ago. Say the
    // real reason rather than letting the fetch fail with a network error.
    if (!online) {
      setScanError('Scanning needs an internet connection. Try again once you are back online.');
      return;
    }

    // CAP THE BATCH. Selecting a whole camera roll is one tap on a phone, and
    // without this that single tap could spend an entire month's quota — each
    // file is a credit, and the server charges whether or not the picture turns
    // out to be a receipt. Capping here is kinder than letting the server refuse
    // file 21 after the user has already paid for twenty.
    const files = picked.slice(0, MAX_SCAN_FILES);
    const droppedForCap = picked.length - files.length;

    setScanError('');
    setScanRows(null);
    setResult(null);
    setScanning(true);
    setScanProgress({ done: 0, total: files.length });
    setScanFileName(files.length === 1 ? files[0].name : `${files.length} files`);

    const collected = [];
    const skipped   = [];
    let quotaInfo   = null;
    let stopReason  = null;   // set when we must abandon the remaining files

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setScanProgress({ done: i, total: files.length });
      try {
        const base64   = await fileToBase64(file);
        const mimeType = file.type || 'application/octet-stream';
        const res      = await onScan(base64, mimeType);

        if (res?.rateLimited) {
          // Stop rather than hammer: the remaining files would all be refused,
          // and each refusal is another pointless round trip.
          stopReason = res.message || 'Too many scans at once — please wait a moment.';
          break;
        }
        if (res?.quotaExceeded) {
          setScanQuota({ used: res.used, limit: res.limit, exceeded: true });
          stopReason = null;   // the quota banner explains it; no error text needed
          break;
        }
        if (!res?.ok) {
          skipped.push(`${file.name}: ${res?.message || 'could not be read'}`);
          continue;
        }
        if (res.unreadable && (res.expenses || []).length === 0) {
          skipped.push(`${file.name}: too unclear to read`);
          continue;
        }

        const mapped = (res.expenses || []).map(ex => mapScanned(ex, file.name)).filter(r => r.amount > 0);
        if (mapped.length === 0) skipped.push(`${file.name}: no expenses found`);
        collected.push(...mapped);
        if (res.quota) quotaInfo = res.quota;

        // Persist after EVERY file, not at the end.
        //
        // Locking an iPhone mid-scan suspends the page, and iOS may discard the
        // web view entirely — React state goes with it. The scans were already
        // charged server-side, so losing the rows means the user pays twice for
        // the same receipts. Writing each batch as it arrives means a reload
        // recovers everything already paid for.
        saveScanDraft(draftKey, collected);
      } catch (err) {
        skipped.push(`${file.name}: could not be opened`);
      }
    }

    setScanProgress(null);
    setScanning(false);

    if (collected.length > 0) {
      setScanRows(collected);
      if (quotaInfo) setScanQuota({ ...quotaInfo, exceeded: false });
    } else {
      setScanRows(null);
    }

    // Report anything that went wrong WITHOUT throwing away what worked.
    const notes = [];
    if (droppedForCap > 0) {
      notes.push(`Only the first ${MAX_SCAN_FILES} files were scanned (${droppedForCap} skipped) — each one uses a scan credit.`);
    }
    if (stopReason) notes.push(stopReason);
    if (skipped.length) notes.push(`Skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} — ${skipped.join('; ')}`);
    setScanError(notes.join(' ') || '');
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
    // Bind the learned map so CSV imports honour the user's own categories too.
    return buildExpenses(rows, mapping, options, (n) => autoCategorize(n, categoryOverrides));
    // categoryOverrides IS a dependency: the learned map loads asynchronously
    // after sign-in, so omitting it left the preview holding an empty map and
    // quietly ignoring the user's own categories on the first import.
  }, [rows, mapping, options, categoryOverrides]);

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

  // ── Already-in-this-group detection ────────────────────────────────────────
  // The store already holds every expense in the group in memory, so this costs
  // one Set build and no query, no index and no migration.
  const existingKeys = useMemo(() => {
    const keys = new Set();
    for (const e of existingExpenses || []) keys.add(duplicateKey(e.name, e.amount, e.date));
    return keys;
  }, [existingExpenses]);

  // Parallel to built.expenses: true where that row already exists.
  const dupFlags = useMemo(
    () => built.expenses.map(e => existingKeys.has(duplicateKey(e.name, e.amount, e.date))),
    [built.expenses, existingKeys]
  );
  const dupCount = dupFlags.filter(Boolean).length;

  // What Import will actually send. The preview still shows EVERY row, flagged,
  // so the skipped ones stay visible rather than vanishing without explanation.
  const rowsToImport = useMemo(
    () => (skipDuplicates ? built.expenses.filter((_, i) => !dupFlags[i]) : built.expenses),
    [built.expenses, dupFlags, skipDuplicates]
  );

  // One id per row, minted ONCE and reused if the user presses Import again.
  // This is the client half of the retry fix in store.importExpenses: sending
  // the same ids means a second attempt collides with the primary key and is
  // swallowed, instead of inserting a whole second set of rows.
  //
  // Keyed on the identity of `rowsToImport`, which is memoised — so it survives
  // re-renders (including the one from setImporting) and is deliberately
  // discarded the moment the user changes the mapping, the file, or the skip
  // toggle, because that is a genuinely different import.
  const importIdsRef = useRef({ src: null, ids: [] });
  const withStableIds = (list) => {
    if (importIdsRef.current.src !== list) {
      importIdsRef.current = { src: list, ids: list.map(() => crypto.randomUUID()) };
    }
    return list.map((e, i) => ({ ...e, _id: importIdsRef.current.ids[i] }));
  };

  const canImport = rowsToImport.length > 0 && paidByName && !importing;

  // Why is Import greyed out? A disabled button with no explanation is a dead
  // end — the user can't tell a missing column from an unreadable file. This
  // mirrors the "pick at least one person" hint on the expense form's Save.
  // Returns null whenever the button is usable (or mid-import), so the hint
  // only appears when something is actually blocking the import.
  const importHint = (() => {
    if (importing) return null;
    // Rows are fine, but there's nobody to attribute them to. `paidByName` is
    // seeded once from the group's people, so an empty group can never enable
    // the button — say so rather than leaving an empty dropdown.
    if (rowsToImport.length > 0 && !paidByName) {
      return 'Add at least one person to this group first — every imported expense needs a payer.';
    }
    if (rowsToImport.length > 0) return null;
    // Every row is already in the group and the skip toggle is filtering them
    // all out. Without this the button just greys out for no visible reason.
    if (built.expenses.length > 0 && dupCount === built.expenses.length) {
      return `All ${built.expenses.length} row${built.expenses.length === 1 ? ' is' : 's are'} already in this group. Untick "Skip rows already in this group" to add them anyway.`;
    }
    if (mode === 'scan') {
      return scanRows
        ? 'No expenses could be read from that file. Try a sharper photo or a single page.'
        : 'Scan a receipt or statement to continue.';
    }
    if (rows.length === 0) return 'Choose a CSV file to continue.';
    // The commonest case by far: the Generic preset ships an empty mapping, so
    // Amount is unset until the user picks it and nothing can be built.
    if (!mapping.amount) {
      return 'Pick your Amount column under "3. Map columns" — nothing can be imported until it is set.';
    }
    return 'No rows had a readable amount. Check the Amount column, and the "Amount style" setting if your file uses negatives.';
  })();

  const doImport = async () => {
    if (!canImport) return;
    setImporting(true);
    setImportError('');
    const res = await onImport(withStableIds(rowsToImport), { paidByName, splitMode });
    setImporting(false);
    if (res?.error) {
      setImportError(res.error);
    } else {
      setResult(res);
      // The rows are now saved as real expenses, so the recovery draft has done
      // its job. Clearing it here — and ONLY on success — means a failed import
      // still leaves the paid-for scans recoverable.
      clearScanDraft(draftKey);
      setScanRestored(false);
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
              {/* `alreadyPresent` means the PREVIOUS attempt actually committed
                  and only its response was lost, so this retry was a no-op.
                  Saying "Imported 40" there would be a lie in the one situation
                  where the user is already unsure what happened. */}
              <div className="font-semibold text-stone-900">
                {result.alreadyPresent
                  ? `Already saved — ${result.inserted} expense${result.inserted === 1 ? '' : 's'}`
                  : `Imported ${result.inserted} expense${result.inserted === 1 ? '' : 's'}`}
              </div>
              <div className="text-sm text-stone-500 mt-1">
                {result.alreadyPresent ? 'The earlier attempt went through. Nothing was added twice.' : 'Closing…'}
              </div>
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
              <Field label="Choose receipts or statements (photos or PDF)">
                {/* Scanning is the ONE thing here that genuinely cannot work
                    offline — the image goes to an AI provider over the network.
                    Say so before the tap, not after a failed request whose error
                    ("Failed to fetch") reads like a bug. Amber, not red: nothing
                    is broken, and the CSV tab beside it still works. */}
                {!online && (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <div className="text-sm font-medium text-amber-900">
                      Scanning needs an internet connection
                    </div>
                    <div className="text-xs text-amber-800 mt-0.5">
                      Receipts are read by an AI service online, so this one can't
                      work offline. You can still add expenses by hand or import a
                      CSV — those save on this device and sync when you reconnect.
                    </div>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={handleScanFile}
                  disabled={scanning || !online}
                  className="w-full text-sm text-stone-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-stone-300 file:bg-stone-50 file:text-sm file:font-medium hover:file:bg-stone-100 disabled:opacity-50"
                />
                {scanFileName && !scanning && !scanError && (
                  <div className="text-[11px] text-stone-500 mt-1">{scanFileName}</div>
                )}
                {scanning && (
                  <div className="flex items-center gap-2 text-sm text-stone-500 mt-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {scanProgress && scanProgress.total > 1
                      ? `Scanning ${scanProgress.done + 1} of ${scanProgress.total}…`
                      : 'Scanning…'}
                  </div>
                )}
                {scanError && <div className="text-sm text-rose-600 mt-2">{scanError}</div>}

                {/* Recovered rows. Worth saying explicitly: otherwise expenses
                    the user doesn't remember scanning just appear, which looks
                    like a bug rather than a rescue. */}
                {scanRestored && (
                  <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                    <div className="text-sm font-medium text-emerald-900">
                      Recovered your last scan
                    </div>
                    <div className="text-xs text-emerald-800 mt-0.5">
                      The app closed before these were saved. They're already paid for, so
                      here they are — import them, or discard to start over.
                    </div>
                    <button
                      type="button"
                      onClick={() => { clearScanDraft(draftKey); setScanRows(null); setScanRestored(false); }}
                      className="text-xs text-emerald-900 underline underline-offset-2 mt-1.5"
                    >
                      Discard
                    </button>
                  </div>
                )}

                {/* Out of scans — an upgrade prompt, not an error. Deliberately
                    amber rather than red: nothing broke, and there is no point
                    inviting a retry that cannot succeed until next month. */}
                {scanQuota?.exceeded && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <div className="text-sm font-medium text-amber-900">
                      You've used all {scanQuota.limit} free scans this month
                    </div>
                    <div className="text-xs text-amber-800 mt-0.5">
                      Your quota resets on the 1st. You can still add expenses by
                      hand or import a CSV in the meantime.
                    </div>
                  </div>
                )}

                {/* Remaining count after a successful scan. Hidden while the
                    limit is only counting (not enforcing) — a number that does
                    nothing yet would just confuse. */}
                {scanQuota && !scanQuota.exceeded && scanQuota.enforced && (
                  <div className="text-[11px] text-stone-500 mt-1.5">
                    {Math.max(0, scanQuota.limit - scanQuota.used)} of {scanQuota.limit} free scans left this month
                  </div>
                )}
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
                              {/* `i` is the index in the full list too, because
                                  slice(0, 8) keeps the original order — so
                                  dupFlags[i] lines up with this row. */}
                              {/* Each highlighted row states its text colour
                                  explicitly, and gets a dark: background.
                                  `bg-sky-50` / `bg-amber-50` are not remapped
                                  for dark mode, while text inherits the app
                                  root's remapped #f5f5f4 — light text, pale
                                  row, invisible. Measured at 1.02:1 before the
                                  dark: variants were added, 13.62:1 after. */}
                              {built.expenses.slice(0, 8).map((ex, i) => (
                                <tr key={i} className={`border-t border-stone-100 ${
                                  dupFlags[i] && skipDuplicates ? 'bg-stone-100 text-stone-400 line-through'
                                  : dupFlags[i] ? 'bg-sky-50 dark:bg-sky-950/40 text-stone-900'
                                  : ex._warning ? 'bg-amber-50 dark:bg-amber-950/40 text-stone-900' : ''
                                }`}>
                                  {/* `_source` is the filename, set only when a
                                      scan produced this row. With several
                                      receipts scanned at once the preview mixes
                                      them together, and without this there is no
                                      way to tell which receipt a line came from
                                      — or which one to re-shoot if it looks wrong. */}
                                  <td className="px-2 py-1.5 truncate max-w-[120px]"
                                      title={[ex._source, ex._warning].filter(Boolean).join(' — ')}>
                                    {ex.name}
                                    {/* dark:text-sky-300 is not decoration. Darkening this
                                        row with dark:bg-sky-950/40 dropped text-sky-700 to
                                        2.50:1 against it — a contrast REGRESSION caused by
                                        the dark-mode fix itself, measured rather than
                                        guessed. */}
                                    {dupFlags[i] && (
                                      <span className="block text-[10px] text-sky-700 dark:text-sky-300 no-underline">already in this group</span>
                                    )}
                                    {ex._source && (
                                      <span className="block text-[10px] text-stone-400 truncate">{ex._source}</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(ex.amount)}</td>
                                  <td className="px-2 py-1.5 tabular-nums">{ex.date}{ex._warning ? ' ⚠️' : ''}</td>
                                  <td className="px-2 py-1.5">{ex.category}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {/* ── Already-in-this-group warning + opt-out ────────
                            Shown only when there is something to warn about.
                            A duplicate is never blocked: two identical coffees
                            on one day are a real thing, so the user decides. */}
                        {dupCount > 0 && (
                          <div className="rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-3 py-2">
                            <div className="text-[11px] text-sky-900 dark:text-sky-200 leading-snug">
                              <strong>{dupCount}</strong> of these {dupCount === 1 ? 'is' : 'are'} already in this group
                              — same name, amount and date. This usually means an overlapping date range from the same
                              file or bank.
                            </div>
                            <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={skipDuplicates}
                                onChange={(e) => setSkipDuplicates(e.target.checked)}
                                className="w-4 h-4 accent-sky-600"
                              />
                              <span className="text-[11px] text-sky-900 dark:text-sky-200 font-medium">
                                Skip rows already in this group
                              </span>
                            </label>
                          </div>
                        )}
                        <div className="text-[11px] text-stone-500">
                          Importing {rowsToImport.length} expense{rowsToImport.length === 1 ? '' : 's'}
                          {dupCount > 0 && skipDuplicates && ` (${dupCount} already present, skipped)`}
                          {built.skipped > 0 && ` (${built.skipped} row${built.skipped === 1 ? '' : 's'} skipped — no valid amount)`}.
                          {built.expenses.some(e => e._warning) && (mode === 'scan'
                            ? ' ⚠️ Highlighted rows were unclear — please check them before importing (hover/tap a row for why).'
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
          <div className="sticky bottom-0 bg-white border-t border-stone-200 px-4 py-3">
            {/* Disabled-button guard: explain WHY Import is greyed out, the same
             *  way the expense form explains its disabled Save. */}
            {importHint && (
              <div className="text-amber-700 text-[11px] mb-2">{importHint}</div>
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50">
                Cancel
              </button>
              <button onClick={doImport} disabled={!canImport} className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-stone-300">
                {importing ? 'Importing…' : `Import${rowsToImport.length ? ` ${rowsToImport.length}` : ''}`}
              </button>
            </div>
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
