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

| # | Item | State |
|---|------|-------|
| 11 | **Email notifications** | **Code complete, awaiting deploy + a dry run.** ✅ `db/14` prefs + Settings toggles. ✅ `db/15` digest tracking. ✅ `send-digest` Edge Function (daily + monthly, shared-secret protected, `dryRun` mode). ✅ `digests.yml` workflow. ✅ `send-welcome` already existed and the owner has now deployed it. ⬜ Owner steps: run `db/15`, deploy `send-digest` with its three secrets, add `DIGEST_SECRET` as a repo secret, create the `profiles` INSERT webhook (now under **Integrations → Webhooks**, moved from Database), then **run the workflow with `dry_run = true` before ever sending for real**. |

## Agreed — next up

| # | Item | Notes |
|---|------|-------|
| 13 | 🔴 **Performance — Tailwind Play CDN** | `public/index.html` loads `https://cdn.tailwindcss.com`, which downloads ~400KB and then **compiles CSS in the browser on every page load** by scanning the DOM. It is render-blocking and Tailwind explicitly warns against it in production (that's the console warning). Biggest single win available. Fix: add a Tailwind build step producing a static CSS file, drop the CDN script. Risk: the content globs must catch every class or styles silently break — needs a careful visual pass afterwards. |
| 14 | 🔴 **Performance — measure before guessing further** | Reported: ~30s to load the dashboard, Connections slow too. Ruled out: network (Supabase round trip measured 120–350ms). Fixed: five sequential queries → three parallel stages. Still unexplained if it persists — next step is a real profile (DevTools Performance + Network) rather than more speculation. Suspects: Play CDN (#13), 558KB bundle, realtime refetching on every change, unbounded `select('*')` on expenses. |
| 15 | 🔴 **Stale data shown silently** | Web showed 4 groups, phone 5, same account. The store's 12s watchdog clears `loading` and falls back to the cached snapshot — correct for not hanging, but the user is shown **stale data with no indication**. Must show a "showing saved data / reconnecting" state so wrong data is never mistaken for current. Likely to become rare once #13/#14 land, but the silence is the real defect. |
| 16 | 🟠 **Two features called "invite", only one emails** — root cause of the "invite never arrived" report. | **Diagnosed, not a bug in the sending path.** `send-invite` is deployed and healthy (returns its own 401 guard when called). The two flows: **Connections → add by email** calls `find_profile_by_email` and only creates an in-app request for someone who ALREADY has an account — it sends no email ever. **Group → People → ghost → "Invite by email"** is the one that calls `send-invite` → Resend. Using the first for a new person produces silence: no email, nothing in Resend, no function invocation. Fix: rename/merge them, and when Connections can't find an address, offer to send a real invite instead of dead-ending. |
| 21 | **Payment hand-off (Zelle / Venmo / UPI …)** — how to avoid hard-coding a provider per country | Recording the approach so it isn't re-litigated. **Do not hard-code apps per country** — that is an endless maintenance tail and it breaks for anyone abroad. Two workable layers: **(1)** open a `upi://` or `venmo://` style deep link only when the user has *chosen* their own handle, so the app never guesses; **(2)** far better, let each person store a free-text "how to pay me" on their profile (UPI ID, Venmo handle, bank reference, "cash"). The payer sees it at settle-up and pays in whatever app they already use. That works in every country with no per-country code, and needs no payment licence — **the app never touches money, it only shows a note and records that a payment happened**. Handling money in-app would make this a regulated payment service, which is a completely different undertaking. |
| 20 | 🟠 **Invite / connection lifecycle is incomplete** | Raised by the owner; these are real gaps, not polish. **(f) A sent email invite appears NOWHERE** — it is not listed in Connections' sent requests, so the sender has no record it happened and no way to chase or cancel it. Invites and connection requests need one combined "pending" list. **(a) No way to withdraw** a sent invite or connection request — once sent it is permanent from the sender's side. **(b) Re-sending gets declined**, because a row already exists for that pair/address and the second attempt collides with it instead of refreshing the first. **(c) In-app vs email is not decided.** Proposal: look the address up first — if they already have an account, create an in-app request only (no email; mailing existing users is noise and a spam-complaint risk); if they do not, send the email invite. That also fixes #16, since the user stops having to know which of the two "invite" buttons to press. **(d) Withdrawal semantics undefined** — withdrawing should delete the pending row so it vanishes from the recipient's list, but a request already *accepted* must not be silently undoable. **(e) Declined should not be terminal** — a decline currently blocks any future invite to that address; it should allow a fresh attempt after some interval. Needs a state machine written down (pending / accepted / declined / withdrawn / expired) BEFORE more code, since these cases are exactly where ad-hoc logic goes wrong. |
| 19 | **Premium features while offline** | Entitlement is already cached with the profile, so the app knows you're premium with no signal — but scanning needs an AI provider, so it genuinely cannot work offline. Needs an honest "needs a connection" state rather than a confusing failure. |
| 17 | 🔒 **Abuse / bot hardening** | Ordered easiest-first. **(a)** Supabase Auth rate limits — dashboard only, no code: Authentication → Rate Limits, lower the per-hour email sign-in cap. **(b)** Enable leaked-password protection (dashboard toggle). **(c)** CAPTCHA on sign-in — Supabase supports Cloudflare Turnstile / hCaptcha; needs a dashboard setting plus a token passed from `AuthScreen.jsx`. **(d)** Tighten `scan-receipt`: it is authenticated and quota'd, but add a per-minute cap so one account cannot burn the monthly quota in seconds. **(e)** Review CORS on the Edge Functions — currently `Access-Control-Allow-Origin: *`; restricting to splitab.app costs nothing. **(f)** Consider Cloudflare rate limiting in front of the domain, since DNS is already there. |
| 12 | 🔴 **Magic link fails on corporate email** — reported for a work address. | **Diagnosed, not a config error.** Corporate mail security (Outlook Safe Links, Barracuda, Proofpoint, university/hospital filters) *pre-fetches* every link to scan it. Supabase magic links are single-use, so the scanner consumes the token and the real click then sees "invalid or has expired". Widely reported: [supabase/auth#1214](https://github.com/supabase/auth/issues/1214), [discussion #41618](https://github.com/orgs/supabase/discussions/41618). **Preferred fix: a 6-digit OTP code** instead of a link — the email carries `{{ .Token }}` and the app calls `verifyOtp({ email, token, type: 'email' })`. A scanner cannot consume a code the user must type. Alternative: put the URL in a page *fragment* (`#confirm={{ .ConfirmationURL }}`), since fragments are never sent to a server — but that needs a landing page and more moving parts. **Workaround today: Google sign-in or email+password.** Pairs naturally with #10 since both touch `AuthScreen.jsx`. |
| 10 | **Sign-in / sign-up page revamp** — the three selling points are stacked at the top, pushing the actual sign-in form down the page. Move them to the side on wide screens and to the bottom on phones, so the form is what you land on. | `src/auth/AuthScreen.jsx`. **Layout only — no auth logic changes.** It is the first screen a new user sees, so it is also the natural place to carry the same visual refresh as #2. |
| 11 | **Email notifications** — welcome email on sign-up, plus the other planned notifications. | ⚠️ **Read the existing unused `supabase/functions/send-welcome/` before writing anything.** Sending infrastructure already exists (Resend, verified domain, `hello@splitab.app`). Blocked on decisions: which notifications, what triggers them, and whether users can opt out. Settings already shows a notifications placeholder. |
| 3b | ✅ **Scan limits — code complete.** `db/16` + enforcement inside `scan-receipt`. **Counting starts immediately; enforcing is off until `SCAN_LIMIT_ENABLED=true`**, so real usage accrues before anyone is blocked. Owner steps: run `db/16`, add `SUPABASE_SERVICE_ROLE_KEY` to the scan-receipt secrets, redeploy. Flip `SCAN_LIMIT_ENABLED` later. | Counter is in its own table, NOT on `profiles` — users can update their own profiles row, so a counter there would be self-resettable with one API call. `scan_usage` grants SELECT only and has no write policy at all. |
| 3 | ~~**Server-side scan limits**~~ (superseded by 3b) — Postgres counter, checked and incremented **inside the `scan-receipt` Edge Function**, RLS preventing users from updating their own counter. | ⚠️ Prerequisite for any paid tier. A limit in `App.jsx` is cosmetic: the anon key is public, so the function can be called directly. Decision made: **cap by request count, not a 24h window** — cost is per-scan, so a time window can't bound spend. **Count per FILE, not per PDF page**: the function clips PDF text at 24,000 chars, so a 50-page PDF costs the same as a 3-page one. |
| 4 | **Multi-image upload** — attach several images per scan, 1 credit each, capped per batch. | Depends on #3 for the credit accounting. Images (vision) are the expensive path; PDFs (text) are cheap. |
| 5 | **Merchant learning from corrections** — record when a user re-categorises an expense, reuse it for that user, and aggregate toward the shared rules. | Auto-adapts to any country with no hand-written keyword lists. Note: **scanned** receipts already get a category from the AI, so `RULES` only affects CSV import and manual entry. |

## Infrastructure & risks

| # | Item | Notes |
|---|------|-------|
| 6 | **External keep-alive pinger** — cron-job.org / UptimeRobot / Cloudflare Workers cron hitting the `keepalive` endpoint. | GitHub disables scheduled workflows after **60 days of no repository activity** (public repos). Keep the GitHub one too; this removes the single point of failure. |
| 7 | **Move the category test suite into the repo** — currently only in a scratch directory. | It already caught a real bug (`booking` → Lodging swallowed "REDBUS BOOKING"). Required before any automated merchant-list updates. |
| 8 | **Deploy drift on `scan-receipt`** — deployed by pasting into the Supabase dashboard, which has no version control. | This exact drift produced the misleading "Gemini not active" error. Installing the Supabase CLI makes deploys come from git. |

## Payments (not started)

| # | Item | Notes |
|---|------|-------|
| 9 | **No way for a user to pay.** Premium is set by hand in Supabase (`profiles.is_premium`, db/11). `PREMIUM_ENFORCED` in `App.jsx` is still `false`. | Needs a payment provider decision (business/tax question, not a technical one). Merchant-of-record services handle sales tax on your behalf; direct gateways do not. Blocked on #3 — there is no point selling a limit that can't be enforced. |

## Needs verification (built, not proven)

| # | Item | How to prove it |
|---|------|-----------------|
| V1 | iPhone PWA no longer hangs on the spinner when reopened from the home icon | Background the app a while, reopen. Must never spin forever; sign-in screen within ~8s is acceptable. Simulated in dev, **not** yet confirmed on real hardware. |
| V2 | Google sign-in works end to end | One real sign-in. Supabase-side redirect is confirmed; a Google-side `redirect_uri_mismatch` would only appear after the redirect. |
| V3 | CSV Import button explains itself when disabled | Open the import modal with no Amount column mapped; a hint should appear. |

## Parking lot (not agreed, do not start)

- Recategorise **existing** expenses with the new rules. Risk: overwrites categories the
  user fixed by hand. Would need to be an explicit, previewable action.
- Aggregate merchant corrections **across users** into shared rules. Privacy care needed —
  merchant names are user data.
- **MCC (merchant category code)** support in CSV import, when a bank export includes it.
  Authoritative when present, and cheap to add to the column mapper.
- Auto-drafted merchant PRs from an LLM. **Never auto-merge** — one over-generic keyword
  silently miscategorises everything. Draft + run the category tests + human merge.
- Provider-level fallback for scanning. Groq was **deliberately** skipped, so OpenRouter is
  the only provider: model-level fallback works, a full OpenRouter outage does not.

## Done (recent — trim as it grows)

- **Invite / connection lifecycle** (#20 + #16). State machine written FIRST, in
  `docs-internal/invite-state-machine.md`, then built to it. **One input, one button** —
  the app looks the address up and routes it: existing account → in-app connection request
  with no email; no account → emailed invite. That removes the two-features-both-called-
  invite trap where picking wrong failed silently. **Withdraw** added for both kinds
  (`db/17` adds the DELETE policy `invites` never had; connections already permitted it,
  the UI just never exposed it). **Declined is no longer terminal** — a dead row used to
  occupy the only slot allowed by `unique (requester, addressee)` forever; a retry now
  clears it after a 24h cool-off, so a decline can't become a way to pester someone.
  **Sent email invites now appear** in the outgoing list; previously they existed nowhere
  in the app at all.
  ⬜ Still needs `db/17` run, and end-to-end testing with a second real account.

- **Dashboard layout** (#18) — greeting moved into the app bar top-left, wordmark centred,
  "New group" became a circular floating button bottom-right matching the Add-expense button
  inside a group. The bar uses three columns rather than `justify-between` so the wordmark
  stays truly centred; verified it holds at 0px off-centre even with a 36-character name,
  with no horizontal overflow. The duplicate display name beside the avatar was removed.

- **Magic link on corporate email** (#12) + **sign-in page revamp** (#10). The email now
  also carries a 6-digit code, entered on the "check your email" screen — a link scanner
  can consume a single-use link, but not a code you type. ⚠️ **Requires `{{ .Token }}` in
  the Supabase Magic Link email template** or the box has no code to accept. Layout: the
  three selling points moved from above the form to a left column on wide screens and
  below the form on phones. Verified at 375px and 1280px: exactly one feature list visible
  at each width, form above the features on mobile and reachable without scrolling, no
  horizontal overflow; code box has numeric keypad + `one-time-code` autocomplete, and a
  wrong code surfaces an error.
- **Dashboard refresh** (#2) — pinned groups, sort by recent activity / amount due /
  alphabetical, and a card restyle (balance is now the dominant element, softer shadows,
  hover lift, pin affordance). Needs **db/13** for pins to sync; falls back to per-device
  localStorage until then. Verified in a dev build against seeded sample groups: all three
  sort orders correct, per-group currency correct (₹ vs $), balances independently checked
  (2400/3 = −$800, 18400/2 = +₹9,200), pin floats to top, survives reload, and unpin
  reverses. Two bugs found and fixed during that check — see below.
- **Header consolidation** (#1). Three top-bar controls (avatar → Profile, people icon →
  Connections, gear → Settings) became one avatar menu on the right, with the signed-in
  email shown in the menu header and a one-line hint under each item. Verified in a dev
  build with a stubbed session: menu opens, closes on outside-click and on Escape, fits a
  375px viewport, and every row is ≥44px. The 44px fix needed `min-h-[44px]` — `min-h-11`
  silently does nothing in the Tailwind version the Play CDN serves.

- Receipt scanning rebuilt to survive model churn (model lists, aggregated provider errors,
  Gemini leg removed, `unpdf` pinned). Verified: a real scan worked, and CI shows
  `OpenRouter TEXT: PASS / VISION: PASS`.
- Supabase keep-alive (`db/12` + daily workflow). Verified: green run, `200 [{"id":1}]`.
- Weekly AI provider health check. Verified: green run.
- PWA stuck-loading fix (`AuthProvider` watchdog). Verified in dev by stubbing both auth
  entry points — pending real-device confirmation (V1).
- Group header showed spend + repayments, so per-person figures exceeded the group total.
  Split into `spent` / `share` / `repaid` / `received`. Verified numerically against the
  real trip: figures now sum to the group total, nets unchanged.
- CSV Import button explains why it is disabled.
- Google OAuth secret (was the cause of sign-in failing). Verified: authorize endpoint now
  redirects instead of returning `missing OAuth secret`.
