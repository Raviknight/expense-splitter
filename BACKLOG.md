# Backlog — the single source of truth for open work

**Last updated: 2026-09-13**

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
| 21 | **Payment hand-off (Zelle / Venmo / UPI …)** — profile half DONE, settle-up half PENDING | Built: `db/20_payment_note.sql` (adds `profiles.payment_note`, free text ≤200 chars, no new RLS policy needed) and the "How people pay you" section in `src/auth/Profile.jsx` (view/edit/clear, "run db/20" fallback when the column is missing, a visible warning that people in your groups can see it). **Still to do:** show the payee's note to the payer at settle-up in `src/App.jsx` — and `store.js` does not fetch `payment_note` yet (`loadAll` selects `id, display_name, avatar_url` for other members, with a name-only retry when that fails). Add it there in the same change, keeping that graceful-degradation retry intact. Reminder for whoever picks it up: **the app must never touch money** — display the note, record that a payment happened, no SDK / deep link / API. Rendering of the Profile change is UNVERIFIED (build only). |

## Agreed — next up

| # | Item | Notes |
|---|------|-------|
| 19 | **Premium features while offline** | Entitlement is already cached with the profile, so the app knows you're premium with no signal — but scanning needs an AI provider, so it genuinely cannot work offline. Needs an honest "needs a connection" state rather than a confusing failure. |
| ~~21~~ | *(moved to In progress above)* | **Do not hard-code apps per country** — endless maintenance, and it breaks for anyone abroad. Instead let each person store a free-text "how to pay me" on their profile (UPI ID, Venmo handle, bank reference, "cash"); the payer sees it at settle-up and pays in whatever app they already use. Works everywhere with no per-country code, and needs no payment licence: **the app never touches money, it only shows a note and records that a payment happened.** Handling money in-app would make this a regulated payment service. |
| 9 | **No way for a user to pay for premium** | Set by hand in Supabase today (`profiles.is_premium`, db/11); `PREMIUM_ENFORCED` is still `false`. Needs a payment-provider decision (a business/tax question — merchant-of-record handles cross-border sales tax, a direct gateway does not). Ask any provider whether they issue **India-format FIRA** before integrating. Blocked on flipping `SCAN_LIMIT_ENABLED` — no point selling a limit that isn't enforced. |

## Decisions pending (not work — just choices)

| Item | Notes |
|------|-------|
| **Flip `SCAN_LIMIT_ENABLED=true`** | Counting is live and enforcing is off, deliberately, so real usage accrues before anyone is blocked. Leave it a few weeks, look at `scan_usage`, then pick a free tier from evidence instead of a guess. |

## Infrastructure & risks

| # | Item | Notes |
|---|------|-------|
| 14 | 🔴 **Performance — improved, not explained** | **Ruled out by measurement:** network latency (Supabase 120–350ms), asset size (bundle **155KB gzipped in 673ms**; Pages does compress), CSS compilation (Play CDN removed), five sequential queries (now three parallel stages). **Fixed one real mechanism:** the service worker's navigation was network-first with no timeout, so a slow response blocked startup — hence "faster with cache disabled", which should never be true. Now races a 2.5s timeout against the cached shell. Owner reports reload is good. If slowness returns, the next step is a real browser profile (DevTools → Network, hard reload, slowest request + total), not a fifth guess. |
| 8 | **Deploy drift on Edge Functions** | They are deployed by pasting into the Supabase dashboard, which has no version control, so repo and deployment are separate copies. This exact drift produced the misleading "Gemini not active" error. The Supabase CLI would make deploys come from git. |

## Needs verification (built, not proven)

| # | Item | How to prove it |
|---|------|-----------------|
| 17c | 🔒 **CAPTCHA on sign-in (Cloudflare Turnstile)** — code shipped and verified live, feature **not active yet**, and deliberately so | **Built and verified:** commit `2b18e3e` on `main`, live at splitab.app on `bundle-62DEYQRT.js`. `src/auth/AuthScreen.jsx` gained a `useTurnstile()` hook that renders ONE shared widget (Managed mode, sitekey `0x4AAAAAAEyIZXeY6pnjwznA` — public by design, safe in the file); `getCaptchaToken` / `resetCaptcha` go as props to `MagicLinkForm` and `EmailPasswordForm`. `GoogleButton` gets neither, because supabase-js `signInWithOAuth` does not accept a `captchaToken`. Four call sites now send a token: `signInWithOtp`, `signInWithPassword`, `signUp` and `resetPasswordForEmail`. Tokens are single-use, so the widget resets after every attempt. Checked in production: the page renders, the hidden `cf-turnstile-response` input holds a real 773-char token, and the email box and submit button are enabled. Also checked with the Turnstile script **blocked**: the form stays usable and the auth request still goes out with an empty captcha field, byte-identical to pre-change behaviour. **But that safety is only client-side, and only while the toggle is OFF.** Once Supabase enforces CAPTCHA it rejects any request without a token, so anyone who cannot reach `challenges.cloudflare.com` — corporate firewall, strict ad-blocker, some countries — will be unable to sign in *at all*, by any method except Google (which sends no token and is therefore unaffected). This is inherent to server-side CAPTCHA, not a flaw in this implementation, and it cannot be fixed client-side. It is the real cost of switching protection on, and the mitigation is that Google sign-in stays open as an escape hatch. Relevant precedent: a corporate mailserver already broke magic-link sign-in for the owner once. **Not proven, because the feature is not on.** The Supabase toggle (Authentication → Attack Protection → enable CAPTCHA, provider Turnstile) is still **OFF**; the secret key is already pasted in. Flipping it is the owner's manual step and is sequenced **last on purpose**: switch protection on before the app sends tokens and every sign-in is rejected, locking the owner out of his own app. That near-miss already happened once in this project and had to be rolled back. ~~All three of these must happen before this is Done: **(a)** owner flips the Supabase toggle; **(b)** re-run the password-grant probe and confirm it changes from `invalid_credentials` to a captcha error; **(c)** owner completes one real end-to-end sign-in.~~ **(a) and (b) DONE 2026-09-13.** Toggle is on; the same probe that returned `invalid_credentials` now returns `captcha_failed` ("request disallowed (no captcha_token found)") on both `/auth/v1/token` and `/auth/v1/otp`. Acceptance proven separately and this is the part that mattered: submitting the **live app's own sign-in form** sent a 773-char token and got **`200 {}`** from `/auth/v1/otp` at the same moment the raw no-token probe was being rejected — so real users are not locked out. Also confirmed `grant_type=refresh_token` is **not** captcha-gated (returns `validation_failed`, not `captcha_failed`), so every already-signed-in session keeps refreshing normally — this was worth checking, since gating refresh would have silently broken every existing user. Only **(c)** remains: one real sign-in by a signed-out human confirming the email actually lands. — **Known and deliberately NOT fixed (not a bug):** for a sub-second window after a token reset there is no token available, so a machine-speed double-submit could send one request without one. Once protection is on, the worst case is a single "request disallowed" error that succeeds on retry. Blocking submission until a token exists was rejected — it would violate the rule that a Turnstile outage must never block sign-in. — **Gotcha worth keeping: `resetPasswordForEmail` takes the token FLAT, not nested.** Its signature is `(email, options)` and the SDK reads `options.captchaToken` straight off the second argument, whereas `signInWithOtp` / `signInWithPassword` / `signUp` read it from `captchaToken` nested under their `options`. Nesting it for the reset call is accepted silently and simply never sends a token — invisible until the toggle goes on and password resets start failing. |
| V1 | iPhone PWA no longer hangs on the spinner when reopened from the home icon | Background the app a while, reopen. Must never spin forever. Simulated in dev, **not** confirmed on real hardware. |
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
