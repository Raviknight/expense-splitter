# Backlog — the single source of truth for open work

**Last updated: 2026-09-15**

If it is not in this file, it is not agreed work. If it is done, it leaves this file.

> **Why this exists.** Open work was previously spread across `HANDOFF.md` (which went
> months stale and listed finished work as pending) and prose sections of `CLAUDE.md`
> (which drifted a migration behind the real `db/` folder, and claimed a bug was fixed
> when only half of it was). A tracker you can't trust is worse than no tracker, because
> you stop checking the code. One file, updated in the same commit as the work.

## How to use this file

- **Update it in the same commit as the change.** Not afterwards — afterwards never comes.
- **Done means verified, not written.** Move an item to Done only when there is evidence:
  a passing test, a green CI run, a live check. "It builds" is not evidence.
- **New ideas go to Parking lot, not to In progress.** Anything mid-session that isn't the
  current task gets parked. Promoting it is a deliberate decision, not a reflex.
- **One item In progress at a time.** If something is half-done, it stays In progress with
  a note on where it stopped.
- **Record the WHY for deferrals**, so a decision isn't re-litigated in three months.

---

## In progress

| # | Item | Where it stopped |
|---|------|------------------|
| — | *(nothing in progress)* | Pick the next item from "Agreed — next up". |


## Agreed — next up

| # | Item | Notes |
|---|------|-------|
| 9 | **No way for a user to pay for premium** | Set by hand in Supabase today (`profiles.is_premium`, db/11); `PREMIUM_ENFORCED` is still `false`. Needs a payment-provider decision (a business/tax question — merchant-of-record handles cross-border sales tax, a direct gateway does not). Ask any provider whether they issue **India-format FIRA** before integrating. Blocked on flipping `SCAN_LIMIT_ENABLED` — no point selling a limit that isn't enforced. |

## Decisions pending (not work — just choices)

| Item | Notes |
|------|-------|
| **Multi-currency expenses WITHIN one group** — raised by the owner 2026-09-18, not yet agreed | Today a group has ONE currency (db/06) and every expense is in it. The ask is to enter an expense in a different currency — a trip where some costs are in INR and some in EUR. **The whole feature rests on one question: which exchange rate, and WHEN is it applied?** Get that wrong and it is not a rounding annoyance, it is balances that move on their own. <br><br>**Do NOT convert at display time using a live rate.** It is the obvious implementation and it is wrong: a balance settled exactly today reopens tomorrow because the rate moved, and settle-up suggestions become a moving target. That is the phantom-1-cent bug again, except the amounts are large and nobody can ever clear them. <br><br>**Recommended shape:** store BOTH the original amount+currency AND the converted amount in the group's currency, converting **once, at entry**, with the rate visible and overridable by the user. Never re-convert. A settled balance then stays settled, and the original figure is still on the record for anyone checking against a receipt. Needs a new column pair on `expenses` and a decision about where rates come from — a free API is another dependency and another thing that breaks silently, so letting the user type the rate may be the honest first version. <br><br>Worth noting the app already handles the common case: per-group currency means the Goa trip is in INR and the Europe trip is in EUR, each internally consistent. This is only needed for a group that genuinely mixes currencies. |
| **Flip `SCAN_LIMIT_ENABLED=true`** — DO NOT flip before payments work | Counting is live and enforcing off, deliberately, so a free tier could be set from evidence. **Read 2026-09-15: there is no evidence.** `scan_usage` holds exactly one row — the owner, 9 scans, already premium. Nobody else has scanned once. A sample of one, and that one is the founder, cannot set a limit for anyone. **More importantly, the sequencing recorded here was backwards.** #9 said payments were blocked on enforcement; the reverse dependency is stronger. Enforcement without a checkout means a user who hits the limit is **blocked with no way to continue** — they cannot upgrade because there is nothing to buy, so they simply leave. A wall with no door is worse than no wall. **Correct order: build the payment integration FIRST, flip this in the same week**, so the limit and the escape hatch arrive together. Until then this flag stays `false` and premium stays a manual database toggle, which costs nothing while one person scans. Re-read `db/check_scan_usage.sql` when there is real traffic; the third query answers the only question that matters — how many people a given free tier would actually block. |

## Infrastructure & risks

| # | Item | Notes |
|---|------|-------|
| 14 | 🔴 **Performance — improved, not explained** | **Ruled out by measurement:** network latency (Supabase 120–350ms), asset size (bundle **155KB gzipped in 673ms**; Pages does compress), CSS compilation (Play CDN removed), five sequential queries (now three parallel stages). **Fixed one real mechanism:** the service worker's navigation was network-first with no timeout, so a slow response blocked startup — hence "faster with cache disabled", which should never be true. Now races a 2.5s timeout against the cached shell. Owner reports reload is good. If slowness returns, the next step is a real browser profile (DevTools → Network, hard reload, slowest request + total), not a fifth guess. |
| ~~27~~ | ⬜ **Linking a settlement to specific expenses — DECLINED by the owner, do not build** | Closed 2026-09-14, the same day it was raised: *"I do not want settlement linked to the specific expense. I just want to make sure that delete does not affect others."* So the underlying worry was never about payment traceability at all — it was about one person's deletion silently moving everyone else's balance, which is #25 and is now built. Recorded rather than deleted, because the instinct to "link payments to what they paid for" is an obvious-sounding idea that will occur to someone again, and the answer is no: the net-balance model is deliberate, and allocation would complicate every balance calculation and the settle-up rounding for a problem the owner does not have. Original note follows, for the reasoning. Raised by the owner 2026-09-14: *"when the expenses are tracked for months and paid in kind of installments you would never know for sure that the payment was for which expense."* Correct, and it is a consequence of the model rather than a bug. Splitab settles on NET balances: a settlement reduces what you owe overall, it is not allocated against particular expenses. That is the right model — it matches how people actually settle ("here's what I owe you"), and it keeps `suggestSettlements` tractable — but it means that months later, a payment is an amount and a date and nothing else. **Do NOT fix this by moving to an allocation model** (each payment apportioned across specific expenses). It would complicate every balance calculation and the hard-won settle-up rounding, and it does not match behaviour: nobody says "this 500 is specifically for the dinner on the 3rd". ~~**Cheap fix that recovers most of the value: let people write a note on a settlement.**~~ **DONE 2026-09-16** — see the Done section. Two things this note got wrong, left visible because they are the kind of error a tracker makes when it is written from memory instead of from the code: the line numbers had drifted, and the claim that the UI "never offers an input" was only half true — the **2-person** modal already had one, and the gap was `MultiSettleModal` hardcoding `'Settle up'`. The estimate was right, though: it cost about one text field. **Then**: a chronological statement view with a running balance, so "what did I owe on 1 March" is answerable without reconstructing it by hand. |

## Needs verification (built, not proven)

| # | Item | How to prove it |
|---|------|-----------------|
| ~~V1~~ | ✅ **iPhone/desktop "Showing saved data" banner — SOLVED 2026-09-15, confirmed by the owner: "banner is gone, the app loads now"** | **The cause was none of the three things previously fixed here, and that is the lesson worth keeping.** It was a DEADLOCK: `AuthProvider` registered an `async` handler on `onAuthStateChange` and awaited a Supabase query inside it. auth-js runs that handler while holding its auth lock and awaits it; every query starts with `_getAccessToken()` → `getSession()`, which needs the same lock. Handler waited on the query, query waited on the lock, lock waited on the handler — so **no query ever reached the network for the life of the page**. Found from the owner's DevTools in about sixty seconds, and the decisive detail was an ABSENCE: the token refresh returned 200, the websocket connected, and there were **zero `/rest/v1/` requests**. Not slow ones — none. Fixed in `7c59414` by making the handler synchronous and deferring the profile load with `setTimeout(…, 0)`. **Why three earlier fixes did nothing**: bounded retries, a backoff that never gives up, and a 30s request timeout are all improvements to a request path the code never entered. Each is worth keeping on its own merits — a retry that gives up after 30s and a request that can hang forever are both real defects — but none could have fixed this. **The process lesson, recorded deliberately**: six wrong diagnoses across four reports, because the question asked was always "is the error being produced?" and never "is anything actually being sent?". When someone reports a symptom twice, get the DevTools Network tab before writing a third fix.
| V1b | 🚨 The home screen no longer claims "Settled up" when it cannot compute a balance | **This was the serious one, and it was found while investigating V1 rather than reported.** `myName` falls back to `'Me'` when the profile fails to load; `'Me'` matches no group member, so an unresolvable balance was read as a net of ZERO and rendered as the green "Settled up", while the summary silently skipped groups it could not resolve and announced "You're all settled up across your groups". The app made its most reassuring claim about money exactly when it knew least. Reproduced deterministically against a dead host — the owner's own screenshot was this bug, not stale data. Fixed in `92561bd`: both sites now distinguish "not found" from "owes nothing", and the profile is cached locally so a flaky network costs a stale NAME rather than unavailable MONEY. Verified in three scenarios: unidentified → "Not available yet"; cached profile with a real debt → correct "+$50.00"; genuinely square → still "Settled up". **Test: on a phone with no signal, confirm no group claims to be settled unless it truly is.** |
| V3 | Monthly digest | Only the daily path has been dry-run. The monthly branch fires on the 1st; worth a manual `kind: monthly` dry run before then. |

## Closed — not doing

- **Cloudflare WAF rate limiting (#17f)** — a paid add-on on the Free plan, so unavailable.
  Bot Fight Mode (free, on) plus the Supabase auth rate limits cover the same surface.
- **Capping group members on the free tier** — members cost nothing to serve, and capping
  them throttles the only growth channel this app has. Reasoning in `CLAUDE.md` §8.

## Parking lot (not agreed, do not start)

- Recategorise **existing** expenses with the new rules — still parked in the GENERAL form,
  for the original reason: re-running the whole rules list over every expense would
  silently overwrite categories the user fixed by hand. A **narrow** version shipped
  2026-09-16 as `db/26`, covering only the ~20 merchants whose keyword actually moved
  between categories, only rows still in the old category, and only merchants absent from
  `category_overrides`. It is a preview statement plus an update, run by hand. That is the
  shape any future recategorisation should take: bounded, previewable, and deferring to the
  user's own corrections.
- Aggregate merchant corrections **across users** into shared rules. Privacy care needed —
  merchant names are user data.
- **MCC (merchant category code)** support in CSV import, when a bank export includes it.
- Auto-drafted merchant PRs from an LLM. **Never auto-merge** — one over-generic keyword
  silently miscategorises everything. Draft + run the category tests + human merge.
- Provider-level fallback for scanning. Groq was **deliberately** skipped, so OpenRouter is
  the only provider: model-level fallback works, a full OpenRouter outage does not.
- **Leaked-password protection** — Supabase gates it behind the Pro plan. Revisit if the
  project ever upgrades.

## Done (recent — trim as it grows)

- **Settlement notes** (2026-09-16). The cheap half of the problem raised in ~~#27~~ — *"paid
  in instalments over months, you would never know which expense a payment was for"* — which
  the owner correctly declined to solve by allocating payments across specific expenses.
  **The backlog's own note about this was out of date and worth correcting:** it said the
  UI "never offers an input", but the **2-person** modal already had one. The real gap was
  `MultiSettleModal` (3+ people), which hardcoded `note: 'Settle up'`. That string was not
  merely unhelpful — the expense list renders a settlement's note beneath its row, so every
  multi-person settlement carried a caption repeating what the row already said. Now one
  shared note per settling session, applied to each payment recorded, defaulting to empty.
  **One field, not one per row:** that list is already dense on a phone (two names, amount,
  Record button, sometimes a refusal reason) and a text input per row would bury the control
  people came to press — while a settle-up is normally one event worth one description.
  No migration: `settlements.note` has existed since db/01 and the store already read and
  wrote it. Also replaced the 2-person placeholder "e.g. Zelle, cash, Venmo" — US-only, and
  aimed at *how* the money moved, when the question people actually ask later is *what it
  was for*.

- **Insights: invisible category bars + blank expense names** (2026-09-16). Both found from
  one screenshot the owner sent; neither was caused by that day's work. **The bars** were
  coloured by a helper building `` `bg-${family}-500` `` at runtime, which its own comment
  called safe because the Tailwind Play CDN compiled from the live DOM. True when written —
  then the CDN was replaced by a build step (#13) and the comment became false without
  anything failing. Measured in the shipped CSS: of twenty bar colours requested, **three
  existed** (violet, amber, indigo, and only because those appear literally elsewhere);
  seventeen rendered zero-width. `db/26` made it visible by moving airline expenses from
  Transportation (a colour that worked) to Flights (one that didn't). Colours now live in
  `CATEGORIES[].bar` as literals. **Never interpolate a Tailwind class name.** **The names**
  came from `e.description`, but the UI shape uses `name` — `description` is the scan
  function's key and never reaches the store. Undefined renders as nothing in JSX, so it
  was silent to the console and the build, and shipped from 2026-06-21 to 2026-09-16.
- **Dark-mode contrast on coloured panels** (2026-09-16). Reported from a phone: the
  Insights "Top category" card measured **1.03:1**. `styles.css` remaps the stone palette
  under `.dark` but leaves coloured tints alone — fine for a *chip* carrying its own text
  colour, broken for a *panel* using stone text, where the background stays pale and the
  text turns near-white. Fixed with per-panel `dark:` variants (not a central remap, since
  `bg-indigo-50` is also the Transportation chip and avatar). Also fixed the active group
  card, which had the same fault and had never been reported. Verified by measurement, both
  themes: 15.47:1 dark, 15.64:1 light, with a stripped-class control reproducing the
  original failure. The measurement caught a **regression the fix itself introduced** (a
  sub-label at 2.50:1) and an inaccurate explanation in my own code comments.

- **Categories widened 15 → 23** (2026-09-16). The old list was a ROAD-TRIP list: six of
  fifteen entries were travel-only because it grew out of one Niagara trip (db/02), so
  someone splitting a flat filed their rent under "Other". Added Rent, Utilities,
  Internet & Phone, Health, Flights, Drinks & Bars, Entertainment, Household; reordered
  everyday-first; **"Other" pinned last** because `catMeta` uses the final element as its
  fallback. Front-end only — `expenses.category` is plain `text` with no CHECK constraint.
  `test:categories` went from 54 to 81 cases and caught four real defects before they
  shipped, including a bare `'recharge'` keyword stealing "FASTAG RECHARGE NHAI" off Tolls
  and `' rent '` beating `'hertz'` on "HERTZ RENT A CAR". Airlines moved out of
  Transportation and cinemas out of Attractions; `db/26` moves existing rows to match.
- **Duplicate imports** (2026-09-16). Two distinct problems, one ours and one the user's.
  **Ours:** `importExpenses` minted fresh UUIDs on every call, so a bulk insert that
  COMMITTED but whose response was lost (30s client abort) showed an error that invited the
  user to press Import again — producing a complete second set of rows. The manual path
  never had this because it generates the id once and replays it, so a retry collides with
  the primary key and is swallowed. Import now does the same: `ImportModal` holds one id
  per preview row, and `importExpenses` treats 23505 as success (`alreadyPresent: true`,
  with honest wording rather than a false "Imported 40"). **Theirs:** re-importing an
  overlapping date range silently doubled rows. The preview now flags rows already in the
  group (same name + amount + date, exact match — deliberately NOT the fuzzy `merchantKey`,
  which would call two different Uber trips duplicates) with a skip toggle defaulted on.
  **Never a hard block:** two identical coffees in one day are real.

- **Per-user category learning** (#5) — `db/19`. A category the user picks by hand is
  remembered against a normalised merchant token, so "UBER *TRIP 866-576-1" and
  "UBER *TRIP 901-222-8" share one learned category. Applies to manual entry, CSV import
  and scans. Per-user on purpose: one person filing AMAZON under Groceries and another
  under Shopping are both right. Verified by agent: builds, renders, expense modal opens,
  no ReferenceError. Two bugs it found were fixed — a stale `useMemo` closure that ignored
  the learned map on first import, and `rememberCategory` writing only a ref so a new
  preference didn't reach the UI until reload.
- **Multi-image scanning** (#4) — several receipts per batch, processed sequentially so the
  burst cap isn't tripped, 1 credit per file, partial success preserved, source filename
  shown per row, and a **10-file cap** so one tap on a camera roll can't drain a month's
  quota.
- **Scan burst cap** (#17d) — rolling 1-minute window, applies to everyone including
  premium; premium is 500/month rather than unlimited, with `bonus_scans` for top-ups.
- **Scan draft recovery** — locking the phone mid-scan no longer loses paid-for rows.
- **Monthly digest correctness** — month-boundary gap and mislabelled statement after a
  dropped run, both fixed and tested.

- **Security, first pass** (#17 a/b/e). CORS on `scan-receipt` and `send-invite` was `*`,
  letting any website invoke them with a signed-in user's token — spending that user's scan
  quota, or sending mail from the verified domain. Now an allowlist. Auth rate limits and
  password policy tuned in the dashboard (values recorded in `CLAUDE.md` §3).
- **Stale data no longer silent** (#15). The store exposes `stale`; both views show
  "Showing saved data — these figures may be out of date" with a Refresh action.
- **Invite / connection lifecycle** (#20, #16). State machine written first
  (`docs-internal/invite-state-machine.md`). One input routes to an in-app request or an
  emailed invite; withdraw for both (`db/17`); declined no longer permanently blocks a
  retry; sent invites are visible. Verified working by the owner.
- **Settle-up rounding** — phantom 1-cent balances no payment could clear. Now works in
  whole cents; verified across 17 scenarios, groups of 2–23.
- **Tailwind Play CDN removed** (#13) — ~400KB of JS plus in-browser compilation became
  35.7KB of static CSS.
- **Email notifications** (#11) — `db/14`/`db/15`, `send-digest` (daily + monthly, shared
  secret, dry-run mode), `digests.yml`, `send-welcome` webhook. Daily dry run verified
  green end to end.
- **Scan quota** (#3) — `db/16` + enforcement inside the function; counter in its own
  read-only table so it cannot be self-reset. Counting live, enforcing dormant.
- **Magic link on corporate email** (#12) + sign-in page revamp (#10) + dashboard layout
  (#18) + header consolidation (#1) + dashboard refresh (#2) + Indian merchants.
- **External keep-alive** (#6) — cron-job.org configured by the owner alongside the
  GitHub workflow, so the 60-day rule can't silently pause the project.
