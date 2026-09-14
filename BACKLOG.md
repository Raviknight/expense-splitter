# Backlog — the single source of truth for open work

**Last updated: 2026-09-14**

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
| **Flip `SCAN_LIMIT_ENABLED=true`** | Counting is live and enforcing is off, deliberately, so real usage accrues before anyone is blocked. Leave it a few weeks, look at `scan_usage`, then pick a free tier from evidence instead of a guess. |

## Infrastructure & risks

| # | Item | Notes |
|---|------|-------|
| 14 | 🔴 **Performance — improved, not explained** | **Ruled out by measurement:** network latency (Supabase 120–350ms), asset size (bundle **155KB gzipped in 673ms**; Pages does compress), CSS compilation (Play CDN removed), five sequential queries (now three parallel stages). **Fixed one real mechanism:** the service worker's navigation was network-first with no timeout, so a slow response blocked startup — hence "faster with cache disabled", which should never be true. Now races a 2.5s timeout against the cached shell. Owner reports reload is good. If slowness returns, the next step is a real browser profile (DevTools → Network, hard reload, slowest request + total), not a fifth guess. |
| 22 | 🔒 **A declined connection still grants profile read access** | Found while shipping #21, by checking the policy rather than trusting the comment above it. `db/20`'s header states the note is readable only by people you have an **accepted** connection with. That is not what the policy does. `read connected profiles` (db/01:158) only tests that a `connections` row EXISTS — it never looks at `status`, which can be `pending`, `accepted` or `declined`. So anyone who sends you a request can immediately read your profile row, and **declining does not revoke it**; the row stays and so does the access. Today that exposes `display_name` and `email`; once #21 ships it also exposes `payment_note`, the one field someone would actually go fishing for. Severity is bounded — they must already know your email to create the row, and a UPI ID / Venmo handle is meant to be given to payers, so this is harvesting/spam risk, not account compromise. **Not a one-line fix:** `useConnections.js` reads profiles for BOTH sides of every row, so restricting to `accepted` would blank the name on your own *sent* invites. The shape that works is: allow when `status = 'accepted'`, OR when the row is still `pending` (either side, so both the asker and the asked can see who they are dealing with) — and grant nothing on `declined`. Dropping `declined` alone is the cheap first step and breaks nothing. A stricter option, if `payment_note` is judged too sensitive for pending: move it to its own table whose policy requires `accepted`. |
| ~~27~~ | ⬜ **Linking a settlement to specific expenses — DECLINED by the owner, do not build** | Closed 2026-09-14, the same day it was raised: *"I do not want settlement linked to the specific expense. I just want to make sure that delete does not affect others."* So the underlying worry was never about payment traceability at all — it was about one person's deletion silently moving everyone else's balance, which is #25 and is now built. Recorded rather than deleted, because the instinct to "link payments to what they paid for" is an obvious-sounding idea that will occur to someone again, and the answer is no: the net-balance model is deliberate, and allocation would complicate every balance calculation and the settle-up rounding for a problem the owner does not have. Original note follows, for the reasoning. Raised by the owner 2026-09-14: *"when the expenses are tracked for months and paid in kind of installments you would never know for sure that the payment was for which expense."* Correct, and it is a consequence of the model rather than a bug. Splitab settles on NET balances: a settlement reduces what you owe overall, it is not allocated against particular expenses. That is the right model — it matches how people actually settle ("here's what I owe you"), and it keeps `suggestSettlements` tractable — but it means that months later, a payment is an amount and a date and nothing else. **Do NOT fix this by moving to an allocation model** (each payment apportioned across specific expenses). It would complicate every balance calculation and the hard-won settle-up rounding, and it does not match behaviour: nobody says "this 500 is specifically for the dinner on the 3rd". **Cheap fix that recovers most of the value: let people write a note on a settlement.** `settlements.note` ALREADY EXISTS in db/01 and `store.js:577` already reads it into `note`; `App.jsx:4107` just hardcodes `'Settle up'` and never offers an input. Exposing it lets someone write "Aug rent, instalment 2 of 3" — which is the actual question being asked — for roughly the cost of one text field. **Then**: a chronological statement view with a running balance, so "what did I owe on 1 March" is answerable without reconstructing it by hand. |
| 8 | **Deploy drift on Edge Functions** | They are deployed by pasting into the Supabase dashboard, which has no version control, so repo and deployment are separate copies. This exact drift produced the misleading "Gemini not active" error. The Supabase CLI would make deploys come from git. |

## Needs verification (built, not proven)

| # | Item | How to prove it |
|---|------|-----------------|
| V1 | iPhone PWA recovers on its own when reopened from the home icon | **The earlier "fix" did not fix this — it changed the symptom.** The 2.5s service-worker timeout stopped the infinite spinner, so the app then rendered stale data forever instead. Reported again 2026-09-13 with a screenshot. Root cause found and fixed in `92561bd`: `stale` is only cleared by a COMPLETED `fetchAll` and nothing retried after a failure, so a failed first load was terminal — and on iOS the reopen IS the page load, so the existing resume listener had already fired before that first fetch failed. Now: bounded 2/4/8/16s backoff from both the error path and the 12s watchdog (a hung query never reaches the catch), and the resume refetch no longer waits on `getSession()`, which can hang forever because auth-js ships no fetch timeout. **Test: background it overnight, reopen, and do NOT touch Refresh — the banner must clear by itself.** Still unconfirmed on real hardware. |
| V1b | 🚨 The home screen no longer claims "Settled up" when it cannot compute a balance | **This was the serious one, and it was found while investigating V1 rather than reported.** `myName` falls back to `'Me'` when the profile fails to load; `'Me'` matches no group member, so an unresolvable balance was read as a net of ZERO and rendered as the green "Settled up", while the summary silently skipped groups it could not resolve and announced "You're all settled up across your groups". The app made its most reassuring claim about money exactly when it knew least. Reproduced deterministically against a dead host — the owner's own screenshot was this bug, not stale data. Fixed in `92561bd`: both sites now distinguish "not found" from "owes nothing", and the profile is cached locally so a flaky network costs a stale NAME rather than unavailable MONEY. Verified in three scenarios: unidentified → "Not available yet"; cached profile with a real debt → correct "+$50.00"; genuinely square → still "Settled up". **Test: on a phone with no signal, confirm no group claims to be settled unless it truly is.** |
| V4 | #21 payment hand-off — the note actually reaches settle-up from the REAL database | **The UI half is proven; the data half is not, and the distinction matters.** Render-verified in the browser with seeded data: the note appears only on the row where YOU are the payer ("Ravi pays Shailja → Pay Shailja: UPI: shailja@okbank"); it does NOT appear when you are the payee; the other party's note is never leaked; a 200-char unbroken string wraps with no horizontal overflow at 375px; a member with no note renders nothing at all rather than an empty label. The Profile side was also render-verified (field, 200-char counter, and the "visible to your groups" warning), clearing the "build only" flag it carried. **What is NOT proven:** every one of those tests fed `_memberPaymentNotes` from a hand-seeded snapshot, so `store.js` actually populating that map from Supabase has never run against the real database — including the new three-rung fallback ladder (`avatar_url`+`payment_note` → `avatar_url` → name-only). **Test: write a payment note on one account, owe that person money from another, and confirm it shows at settle-up.** Until then the feature is proven to display data it has never actually been given. — **Follow-up shipped and render-verified:** the feature had a cold-start problem — nothing anywhere told anyone the field existed, and a payee who had not filled it in produced a silent blank the payer could not interpret. Now the payer sees "*Shailja hasn't added payment details.*", and a user who is OWED money but has no note of their own gets one prompt (never one per row — verified with two debtors, which produced a single "Shailja and Alex know how to pay you"). Profile examples are now ordered by the user's **`preferred_currency`**, NOT by IP geolocation, which would break behind a VPN and while travelling; verified USD → "Venmo: @handle" and INR → "UPI: name@bank", with PayPal and "Cash is fine" still offered in both, since it reorders hints rather than hiding options. The one-free-text-box design is unchanged — no per-app fields. |
| V2 | Google sign-in works end to end | One real sign-in. The Supabase side is confirmed; a Google-side `redirect_uri_mismatch` would only appear after the redirect. |
| V3 | Monthly digest | Only the daily path has been dry-run. The monthly branch fires on the 1st; worth a manual `kind: monthly` dry run before then. |

## Closed — not doing

- **Cloudflare WAF rate limiting (#17f)** — a paid add-on on the Free plan, so unavailable.
  Bot Fight Mode (free, on) plus the Supabase auth rate limits cover the same surface.
- **Capping group members on the free tier** — members cost nothing to serve, and capping
  them throttles the only growth channel this app has. Reasoning in `CLAUDE.md` §8.

## Parking lot (not agreed, do not start)

- Recategorise **existing** expenses with the new rules. Risk: overwrites categories the
  user fixed by hand. Would need to be an explicit, previewable action.
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
