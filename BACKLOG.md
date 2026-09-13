# Backlog — the single source of truth for open work

**Last updated: 2026-09-12**

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

*(nothing — pick the next item deliberately)*

## Agreed — next up

| # | Item | Notes |
|---|------|-------|
| 17d | 🔒 **Per-minute scan burst cap** | The monthly quota stops sustained abuse but not a burst: one account can spend a whole month's allowance in seconds, and each scan costs real money. Needs a short rolling window in `scan_usage` checked alongside the monthly count, inside the function. Smallest remaining security item with a real cost attached. |
| 17c | 🔒 **CAPTCHA on sign-in** | Supabase supports Cloudflare Turnstile / hCaptcha: a dashboard setting plus passing a token from `AuthScreen.jsx`. Bigger job than the rate limits, and only worth it if bot sign-ups actually appear. |
| 17f | 🔒 **Cloudflare rate limiting** in front of the domain | DNS is already there, so this is configuration rather than code. Catches abuse before it reaches Supabase at all. |
| 4 | **Multi-image upload** — several images per scan, 1 credit each, capped per batch | Unblocked now the credit accounting exists (`db/16`). Images (vision) are the expensive path; PDFs (text) are cheap. |
| 5 | **Merchant learning from corrections** | Record when a user re-categorises an expense and reuse it, then aggregate toward the shared rules. Auto-adapts to any country with no hand-written keyword lists. Note **scanned** receipts already get a category from the AI, so `RULES` only affects CSV import and manual entry. |
| 19 | **Premium features while offline** | Entitlement is already cached with the profile, so the app knows you're premium with no signal — but scanning needs an AI provider, so it genuinely cannot work offline. Needs an honest "needs a connection" state rather than a confusing failure. |
| 21 | **Payment hand-off (Zelle / Venmo / UPI …)** | **Do not hard-code apps per country** — endless maintenance, and it breaks for anyone abroad. Instead let each person store a free-text "how to pay me" on their profile (UPI ID, Venmo handle, bank reference, "cash"); the payer sees it at settle-up and pays in whatever app they already use. Works everywhere with no per-country code, and needs no payment licence: **the app never touches money, it only shows a note and records that a payment happened.** Handling money in-app would make this a regulated payment service. |
| 9 | **No way for a user to pay for premium** | Set by hand in Supabase today (`profiles.is_premium`, db/11); `PREMIUM_ENFORCED` is still `false`. Needs a payment-provider decision (a business/tax question — merchant-of-record handles cross-border sales tax, a direct gateway does not). Ask any provider whether they issue **India-format FIRA** before integrating. Blocked on flipping `SCAN_LIMIT_ENABLED` — no point selling a limit that isn't enforced. |

## Decisions pending (not work — just choices)

| Item | Notes |
|------|-------|
| **Flip `SCAN_LIMIT_ENABLED=true`** | Counting is live and enforcing is off, deliberately, so real usage accrues before anyone is blocked. Leave it a few weeks, look at `scan_usage`, then pick a free tier from evidence instead of a guess. |

## Infrastructure & risks

| # | Item | Notes |
|---|------|-------|
| 14 | 🔴 **Performance — improved, not explained** | **Ruled out by measurement:** network latency (Supabase 120–350ms), asset size (bundle **155KB gzipped in 673ms**; Pages does compress), CSS compilation (Play CDN removed), five sequential queries (now three parallel stages). **Fixed one real mechanism:** the service worker's navigation was network-first with no timeout, so a slow response blocked startup — hence "faster with cache disabled", which should never be true. Now races a 2.5s timeout against the cached shell. Owner reports reload is good. If slowness returns, the next step is a real browser profile (DevTools → Network, hard reload, slowest request + total), not a fifth guess. |
| 7 | **Move the category test suite into the repo** | Currently only in a scratch directory. It already caught a real bug (`booking` → Lodging swallowed "REDBUS BOOKING"). Required before any automated merchant-list updates. |
| 8 | **Deploy drift on Edge Functions** | They are deployed by pasting into the Supabase dashboard, which has no version control, so repo and deployment are separate copies. This exact drift produced the misleading "Gemini not active" error. The Supabase CLI would make deploys come from git. |

## Needs verification (built, not proven)

| # | Item | How to prove it |
|---|------|-----------------|
| V1 | iPhone PWA no longer hangs on the spinner when reopened from the home icon | Background the app a while, reopen. Must never spin forever. Simulated in dev, **not** confirmed on real hardware. |
| V2 | Google sign-in works end to end | One real sign-in. The Supabase side is confirmed; a Google-side `redirect_uri_mismatch` would only appear after the redirect. |
| V3 | Monthly digest | Only the daily path has been dry-run. The monthly branch fires on the 1st; worth a manual `kind: monthly` dry run before then. |

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
