// Tests the merchant auto-categoriser (RULES + autoCategorize) in src/App.jsx.
//
// Run it with:   npm run test:categories
//
// WHY THIS FILE LOOKS ODD
// -----------------------
// src/App.jsx is a big React component file. It does not export RULES or
// autoCategorize, and a plain `node` process cannot import JSX anyway. The two
// obvious ways out are both bad:
//
//   1. Copy the rules into this test  -> the copy drifts from the real ones and
//      the test starts proving nothing.
//   2. Refactor them into their own module -> a fine idea, but it touches the
//      app and this test has to exist BEFORE it is safe to touch the app.
//
// So instead we read src/App.jsx as TEXT, cut out the slice between
// `const RULES = [` and `const SPLIT_MODES`, add an export line, write it to a
// temp file, and import that. That slice is plain JavaScript (no JSX), so node
// runs it directly. The test therefore always runs the REAL source. If someone
// edits a keyword in App.jsx, this test sees the edit immediately.
//
// If App.jsx is ever refactored so the rules live in their own module, delete
// the extraction below and import that module directly — the test cases stay.

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JSX = resolve(HERE, '..', 'src', 'App.jsx');

const START_MARKER = 'const RULES = [';
const END_MARKER = 'const SPLIT_MODES';

/* ------------------------------------------------------------------ */
/* 1. Extract the real rules out of src/App.jsx                        */
/* ------------------------------------------------------------------ */

function extractCategorizer() {
  // 'utf8' is not optional here: App.jsx contains real Unicode (bullets, em
  // dashes) in its comments, and reading it as latin1 mangles them.
  const source = readFileSync(APP_JSX, 'utf8');

  const start = source.indexOf(START_MARKER);
  if (start === -1) {
    throw new Error(
      `Could not find "${START_MARKER}" in ${APP_JSX}.\n` +
      'The categoriser was probably renamed or moved. Update the markers at ' +
      'the top of scripts/test-categories.mjs.'
    );
  }

  const end = source.indexOf(END_MARKER, start);
  if (end === -1) {
    throw new Error(
      `Found "${START_MARKER}" but not "${END_MARKER}" after it in ${APP_JSX}.\n` +
      'Update the markers at the top of scripts/test-categories.mjs.'
    );
  }

  const slice = source.slice(start, end);

  // Cheap sanity check: the slice must contain the function we intend to test.
  // Without this, a bad slice would fail later with a confusing import error.
  if (!slice.includes('function autoCategorize')) {
    throw new Error(
      'The extracted slice does not contain autoCategorize(). The two markers ' +
      'no longer bracket the categoriser — fix scripts/test-categories.mjs.'
    );
  }

  const dir = mkdtempSync(join(tmpdir(), 'splitab-cat-'));
  const file = join(dir, 'categorizer.mjs');
  writeFileSync(file, slice + '\nexport { RULES, autoCategorize };\n', 'utf8');
  return { dir, file };
}

/* ------------------------------------------------------------------ */
/* 2. The cases                                                        */
/* ------------------------------------------------------------------ */

// [merchant string as it would appear on a statement, expected category]
const CASES = [
  // ---- US regressions: these must not change ----
  ['UBER *TRIP 866-576-1',              'Transportation'],
  ['LYFT *CANC FEE 09-09',              'Transportation'],
  ['Taco Bell 037135',                  'Restaurants'],
  ['STARBUCKS STORE 1234',              'Restaurants'],
  ['WM SUPERCENTER #1234',              'Groceries'],
  ['WALMART SUPERCENTER',               'Groceries'],
  ['WALMART.COM',                       'Shopping'],
  ['TARGET T-1234',                     'Shopping'],
  ['SHELL OIL 574424',                  'Fuel'],
  ['CVS PHARMACY #4512',                'Pharmacy'],
  ['AIRBNB * HMXYZ',                    'Lodging'],
  ['HERTZ RENT A CAR',                  'Car Rental'],
  ['EZPASS NY REBILL',                  'Tolls'],
  ['AMNH MUSEUM ADMISSION',             'Attractions'],

  // ---- Longest-match regressions ----
  // Each of these was categorised WRONG when the categoriser returned the first
  // rule that matched. They only pass because the longest keyword now wins, so
  // they are the canaries for that behaviour being reverted.

  // ' park ' (Parking) used to beat 'state park' (Attractions).
  ['LETCHWORTH STATE PARK',             'Attractions'],
  // 'swiggy' (Restaurants) used to beat 'instamart' (Groceries).
  ['SWIGGY INSTAMART',                  'Groceries'],
  // A bare 'booking' keyword in Lodging used to swallow this. It is now
  // 'booking.com' / 'booking com', so the bus company wins.
  ['REDBUS BOOKING',                    'Transportation'],

  // ---- India: food delivery & restaurants ----
  ['UPI/SWIGGY/841234567/Payment',      'Restaurants'],
  ['ZOMATO ONLINE ORDER',               'Restaurants'],
  ['HALDIRAM S NAGPUR',                 'Restaurants'],
  ['BARBEQUE NATION HOSPITALITY',       'Restaurants'],
  ['POS/WOW MOMO/BLR',                  'Restaurants'],
  ['SARAVANA BHAVAN',                   'Restaurants'],
  ['HIGHWAY DHABA',                     'Restaurants'],

  // ---- India: groceries & quick commerce ----
  ['DMART AVENUE SUPERMARTS',           'Groceries'],
  ['BLINKIT via UPI',                   'Groceries'],
  ['ZEPTO MARKETPLACE',                 'Groceries'],
  ['BIGBASKET INNOVATIVE RETAIL',       'Groceries'],
  ['RELIANCE FRESH STORE',              'Groceries'],
  ['JIOMART DIGITAL',                   'Groceries'],

  // ---- India: transport ----
  ['OLA CABS BANGALORE',                'Transportation'],
  ['UPI/RAPIDO/TRIP',                   'Transportation'],
  ['IRCTC eTICKET',                     'Transportation'],
  ['NAMMA YATRI RIDE',                  'Transportation'],
  // Airlines moved OUT of Transportation into Flights (2026-09-16), along with
  // the other six categories added that day. These two expectations were
  // changed deliberately to follow that decision — they are not a test bent to
  // fit a bug. Transportation is now local travel; a plane ticket is Flights.
  ['SPICEJET LTD',                      'Flights'],
  ['AIR INDIA TICKET',                  'Flights'],
  ['UNITED AIRLINES 0162',              'Flights'],

  // ---- India: fuel & tolls ----
  ['INDIAN OIL PETROL PUMP',            'Fuel'],
  ['BHARAT PETROLEUM CORP',             'Fuel'],
  ['HPCL FUEL STATION',                 'Fuel'],
  ['FASTAG RECHARGE NHAI',              'Tolls'],

  // ---- India: shopping / pharmacy / lodging / attractions ----
  ['FLIPKART INTERNET PVT',             'Shopping'],
  ['MYNTRA DESIGNS',                    'Shopping'],
  ['NYKAA E-RETAIL',                    'Shopping'],
  ['CROMA INFINITI RETAIL',             'Shopping'],
  ['APOLLO PHARMACY LTD',               'Pharmacy'],
  ['PHARMEASY ORDER',                   'Pharmacy'],
  ['OYO ROOMS BOOKING',                 'Lodging'],
  ['MAKEMYTRIP INDIA',                  'Lodging'],
  // Cinemas moved out of Attractions into Entertainment on the same date, for
  // the same reason: Attractions is sightseeing, not a Friday-night film.
  ['BOOKMYSHOW TICKET',                 'Entertainment'],
  ['PVR CINEMAS PHOENIX',               'Entertainment'],

  // ---- The eight categories added 2026-09-16 ----
  ['MONTHLY RENT PAYMENT',              'Rent'],
  ['NOBROKER RENT PAY',                 'Rent'],
  ['TATA POWER ELECTRICITY BILL',       'Utilities'],
  ['INDANE LPG CYLINDER',               'Utilities'],
  ['AIRTEL BROADBAND',                  'Internet & Phone'],
  ['ACT FIBERNET MONTHLY',              'Internet & Phone'],
  ['APOLLO HOSPITAL ENTERPRISE',        'Health'],
  ['DR LAL PATH LABS',                  'Health'],
  ['TOIT BREWERY BANGALORE',            'Drinks & Bars'],
  ['TASMAC WINE SHOP',                  'Drinks & Bars'],
  ['NETFLIX SUBSCRIPTION',              'Entertainment'],
  ['IKEA HYDERABAD',                    'Household'],
  ['HOME DEPOT #4521',                  'Household'],
  ['URBANCLAP CLEANING',                'Household'],

  // ---- False-positive guards for the new keywords ----
  // Each of these is a collision the longest-match rule has to resolve, and
  // every one of them was a REAL failure at some point while writing the list.
  //
  // ' rent ' is padded so it cannot match inside "rental". Unpadded, this case
  // files every car hire under Rent.
  ['ENTERPRISE RENT-A-CAR',             'Car Rental'],
  ['HERTZ CAR RENTAL LAX',              'Car Rental'],
  // 'electrician' is household work; 'electricity' is the bill. Shortening the
  // Utilities keyword to 'electric' makes this go red.
  ['ELECTRICIAN HOME VISIT',            'Household'],
  // In India you recharge a FASTag and a metro card, not just a phone. A bare
  // 'recharge' keyword in Internet & Phone stole this one — the test caught it.
  ['FASTAG RECHARGE NHAI',              'Tolls'],
  // 'jio' (Internet & Phone) is a substring of both of these. They stay put
  // only because the longer keyword wins.
  ['JIOMART GROCERY ORDER',             'Groceries'],
  ['JIO-BP PETROL PUMP',                'Fuel'],
  // ' maid ' is padded so it cannot match "mermaid"; 'maid of the mist' is
  // longer than ' maid ' and wins regardless.
  ['MAID OF THE MIST NIAGARA',          'Attractions'],
  // ' bar ' (Drinks & Bars) sits inside "barbeque". Longest match keeps this
  // one a restaurant.
  ['BARBEQUE NATION GURGAON',           'Restaurants'],
  // 'prime video' (Entertainment) is longer than 'amazon' (Shopping).
  ['AMAZON PRIME VIDEO',                'Entertainment'],
  // …but plain Amazon is still Shopping.
  ['AMAZON.IN ORDER 402',               'Shopping'],
  // Apollo runs both hospitals and pharmacies, so neither keyword may be
  // shortened to bare 'apollo'.
  ['APOLLO PHARMACY KORAMANGALA',       'Pharmacy'],

  // ---- False-positive guards ----
  // ' ola ' is space-padded precisely so it cannot match inside a longer word.
  // If someone "tidies" it to 'ola', this case goes red.
  ['GORGONZOLA CHEESE CO',              'Other'],
  // 'taj hotel' vs 'taj mahal' must not collide — neither may shorten to 'taj'.
  ['TAJ MAHAL ENTRY TICKET',            'Attractions'],
  ['TAJ HOTEL MUMBAI',                  'Lodging'],
  // An unknown merchant must fall through rather than guess.
  ['RANDOM UNKNOWN VENDOR',             'Other'],

  // ---- Empty / junk input must not throw ----
  ['',                                  'Other'],
];

/* ------------------------------------------------------------------ */
/* 3. Run                                                              */
/* ------------------------------------------------------------------ */

const PAD = Math.max(...CASES.map(([input]) => input.length));

function runCases(autoCategorize) {
  let passed = 0;
  let failed = 0;

  console.log('Merchant categorisation');
  console.log('-'.repeat(PAD + 40));

  for (const [input, expected] of CASES) {
    let got;
    try {
      got = autoCategorize(input);
    } catch (err) {
      got = `THREW: ${err.message}`;
    }

    const label = input === '' ? '(empty string)' : input;

    if (got === expected) {
      passed++;
      console.log(`PASS  ${label.padEnd(PAD)}  -> ${got}`);
    } else {
      failed++;
      console.log(`FAIL  ${label.padEnd(PAD)}  -> ${got}   (expected ${expected})`);
    }
  }

  console.log('-'.repeat(PAD + 40));
  console.log(`${CASES.length} cases: ${passed} passed, ${failed} failed`);
  return failed;
}

// The same keyword listed under two different categories is ambiguous: which
// one wins then depends on rule order, which is exactly the fragility the
// longest-match rewrite removed. Treat it as a failure so it gets fixed at the
// point it is introduced rather than debugged from a miscategorised expense.
function checkDuplicateKeywords(RULES) {
  const seen = new Map();      // keyword -> category
  const dupes = [];

  for (const rule of RULES) {
    for (const kw of rule.kws) {
      if (seen.has(kw) && seen.get(kw) !== rule.cat) {
        dupes.push(`  "${kw}" appears in both ${seen.get(kw)} and ${rule.cat}`);
      }
      seen.set(kw, rule.cat);
    }
  }

  console.log('');
  console.log('Duplicate-keyword check');
  console.log('-'.repeat(PAD + 40));
  console.log(`${seen.size} unique keywords across ${RULES.length} categories`);

  if (dupes.length) {
    console.log('FAIL  the same keyword is claimed by two categories:');
    console.log(dupes.join('\n'));
  } else {
    console.log('PASS  no keyword is claimed by two categories');
  }

  return dupes.length;
}

let temp;
let failures = 0;

try {
  temp = extractCategorizer();
  const { RULES, autoCategorize } = await import(pathToFileURL(temp.file).href);

  console.log(`Source: ${APP_JSX}`);
  console.log('');

  failures += runCases(autoCategorize);
  failures += checkDuplicateKeywords(RULES);
} catch (err) {
  console.error(`\nERROR: ${err.message}`);
  failures += 1;
} finally {
  // Best-effort cleanup. On Windows the imported module can still be held open,
  // so a failure to delete a file in the OS temp directory must not fail the
  // test run.
  if (temp) {
    try { rmSync(temp.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

console.log('');
console.log(failures ? `FAILED (${failures} problem${failures === 1 ? '' : 's'})` : 'All checks passed.');
process.exit(failures ? 1 : 0);
