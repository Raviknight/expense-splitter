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
| 1 | **Header consolidation** — merge avatar + people icon + gear into one avatar menu (Profile / Connections / Settings / Sign out). Matches the IA direction in `CLAUDE.md` §8. | Not started |

## Agreed — next up

| # | Item | Notes |
|---|------|-------|
| 2 | **Dashboard refresh** — user feedback: *"visually flat, styling looks old"*, data density is fine. Add **pinned groups** and **sort by activity / amount due / alphabetical**. | Pin persistence undecided: `localStorage` (no migration, per-device) vs a DB column (syncs across devices). Pick before building. |
| 3 | **Server-side scan limits** — Postgres counter, checked and incremented **inside the `scan-receipt` Edge Function**, RLS preventing users from updating their own counter. | ⚠️ Prerequisite for any paid tier. A limit in `App.jsx` is cosmetic: the anon key is public, so the function can be called directly. Decision made: **cap by request count, not a 24h window** — cost is per-scan, so a time window can't bound spend. **Count per FILE, not per PDF page**: the function clips PDF text at 24,000 chars, so a 50-page PDF costs the same as a 3-page one. |
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
