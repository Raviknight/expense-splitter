# Splitab (Expense Splitter) — project guide

A multi-user, cloud-synced Progressive Web App (PWA) for splitting trip expenses.
Built with React + esbuild, backed by Supabase (auth + database), deployed to GitHub
Pages, and installable on an iPhone home screen.

- **Live app:** https://splitab.app/
- **Repo:** https://github.com/Raviknight/expense-splitter (public — see "Why public" below)
- **Owner/GitHub:** Raviknight

> Audience note: the owner is a mechanical engineer who is newer to coding. When making
> changes, explain in plain language, distinguish warnings from real errors, and show how
> to verify each step. Avoid the words "just" and "obviously".

---

## 1. How it all fits together (architecture)

```
Browser (PWA)
  └─ React app (src/)                     ← UI
       ├─ src/main.jsx                     ← entry: wraps app in auth + gate
       │     <AuthProvider>                ← knows who is signed in
       │       <AuthGate>                  ← shows login OR the app
       │         <App/>                    ← the expense UI
       ├─ src/auth/                        ← everything sign-in / connections
       ├─ src/data/store.js                ← translates UI <-> database
       └─ src/supabaseClient.js            ← one configured Supabase client
            │
            ▼  (HTTPS, with the user's login token)
Supabase (cloud)
  ├─ Auth            ← magic link / Google / email+password
  ├─ Postgres tables ← profiles, connections, groups, group_members, expenses, settlements
  ├─ Row-Level Security (RLS) ← per-row rules: you only see your own + shared data
  └─ Realtime        ← pushes changes live to every signed-in device
```

**Key idea:** everyone shares one database, but **Row-Level Security** guarantees each
person can only read/write their own data and the data of groups they belong to. The
security lives in the database (`db/01_schema.sql`), not just in the app.

### Source files that matter

| File | Responsibility |
|------|----------------|
| `src/main.jsx` | App entry point. Renders `<AuthProvider><AuthGate><App/></AuthGate></AuthProvider>`. |
| `src/supabaseClient.js` | Creates the single Supabase client from the injected URL + anon key. |
| `src/auth/AuthProvider.jsx` | Tracks the session, loads the signed-in user's `profiles` row, exposes `useAuth()`. |
| `src/auth/AuthScreen.jsx` | Login screen: magic link, Google, email+password. |
| `src/auth/AuthGate.jsx` | Shows a spinner while loading, the login screen when signed out, the app when signed in. |
| `src/auth/Connections.jsx` | The friend handshake UI (send/accept/decline requests). |
| `src/auth/useConnections.js` | Loads connections; exposes `canAddAsRealMember(userId)`. |
| `src/data/store.js` | The translation layer between the UI's data shape and the database tables. Also the realtime subscriptions. |
| `src/App.jsx` | The expense UI (groups, expenses, splits, settlements, members panel). |
| `public/` | Static files copied to `docs/` at build time: `index.html`, `manifest.json`, `sw.js`, `icons/`. |
| `build.mjs` | The build/dev script (esbuild). See section 4. |
| `db/*.sql` | Database scripts run once in the Supabase SQL Editor. See section 3. |

---

## 2. The privacy model (connection handshake)

Two real users can only share a group **after they mutually connect.**

1. A `connections` row is created when someone sends a request: `{ requester, addressee, status:'pending' }`.
2. Only the **addressee** can change it to `accepted` or `declined` (enforced by RLS).
3. A real user can be added to a shared group as a member **only if** an `accepted`
   connection exists between them and the group owner. This is enforced two ways:
   - In the UI via `canAddAsRealMember(userId)` (so the button is disabled otherwise).
   - In the database via the `"owner adds members"` RLS policy (so it cannot be bypassed).

**Finding people by email:** RLS hides the profiles of strangers, so a plain query can't
find someone you're not yet connected to. The `find_profile_by_email()` database function
(`db/03_find_profile_by_email.sql`) does that one narrow lookup safely.

### Ghost members

A **ghost** is a person with no account, added to a group by name only (for the owner's own
tracking). In the database a `group_members` row is either a real member (`user_id` set) or
a ghost (`ghost_name` set) — never both. Ghosts can be added/removed in the app's **People**
panel, and they participate in the existing Equal / Full / Personal split modes.

**Link-later seam:** `MembersPanel` in `src/App.jsx` has a `TODO(link-ghost)` comment and a
disabled "Link to account" placeholder. When a ghost later signs up and an `accepted`
connection exists, a future flow can convert the ghost row (set `user_id`, clear
`ghost_name`). That flow is intentionally **not built yet**.

---

## 3. Supabase setup (database scripts — run once each)

Run these in the Supabase dashboard → **SQL Editor** → New query → paste → **Run**.
A green "Success. No rows returned" is the expected result (these build structure; they
don't return data).

| Script | What it does | When to run |
|--------|--------------|-------------|
| `db/01_schema.sql` | Creates all tables, RLS policies, the profile-on-signup trigger, and turns on realtime. | Once, first. |
| `db/03_find_profile_by_email.sql` | Adds the safe email-lookup function used to send connection requests. | Once, after 01. |
| `db/02_import_my_data.sql` | Loads the owner's Niagara trip into **their** account only. | Once, after signing up. Paste your user id first (see the comments in the file). |
| `db/04_add_preferred_currency.sql` | Adds `profiles.preferred_currency` (default 'USD') for the currency picker. | Once. App defaults to USD until run. |
| `db/05_link_ghost_policy.sql` | Adds the owner UPDATE policy on `group_members` so a ghost can be linked to a connected real account. | Once. Ghost-link errors until run. |
| `db/06_add_group_currency.sql` | Adds `groups.currency` (default 'USD') so each group has its own currency. | Once. New groups default to USD/locale until run. |
| `db/07_custom_split.sql` | Allows `split_mode='custom'` and adds `expenses.split_detail` (jsonb per-person amounts). | Once. Custom split errors until run. |
| `db/08_avatars.sql` | Creates the public `avatars` Storage bucket + upload policies and adds `profiles.avatar_url`. | Once. Profile photo upload errors until run. |
| `db/09_invites.sql` | Adds the `invites` table + `accept_invite(token)` security-definer function for auto-connect invites. Also backfills missing `profiles`. | Once. Invites don't auto-connect until run. Re-deploy `send-invite` after. |
| `db/10_expense_participants.sql` | Adds `expenses.participants` (jsonb member-id list) so an expense is split among its frozen participants; backfills existing expenses. | Once. Old expenses change when adding members until run. |
| `db/11_premium.sql` | Adds `profiles.is_premium`, read by `Settings.jsx` and the (dormant) `PREMIUM_ENFORCED` gate in `App.jsx`. | Once. |
| `db/12_keepalive.sql` | Adds the one-row `keepalive` table the scheduled ping queries so Supabase doesn't pause the project. | Once, before enabling the keep-alive workflow. |
| `db/13_pinned_groups.sql` | Adds `profiles.pinned_groups` (jsonb array of group ids) for the home dashboard. | Once. Pinning falls back to per-device localStorage until run. |
| `db/14_email_prefs.sql` | Adds `profiles.notify_daily` (default off) and `profiles.notify_monthly` (default on) + the digest recipient indexes. | Once, before the digest job. |
| `db/15_digest_tracking.sql` | Records when each digest was last sent per user, so a delayed job never drops activity and a retry can't double-mail. | Once, with db/14. |
| `db/16_scan_limits.sql` | Adds the `scan_usage` table (SELECT-only by design) for the server-side receipt-scan quota. | Once, before enabling scan limits. |
| `db/17_invite_withdraw.sql` | Adds the DELETE policy that lets an inviter withdraw a pending invite. | Once. Withdraw errors until run. |
| `db/18_scan_burst.sql` | Adds burst-window columns to `scan_usage` so a script can't spend a month's scan allowance in seconds. | Once, after db/16. |
| `db/19_category_learning.sql` | Adds the per-user `category_overrides` table so the app learns your own merchant→category corrections. | Once. |
| `db/20_payment_note.sql` | Adds `profiles.payment_note` (free text, ≤200 chars) — the "how to pay me" note shown to others at settle-up. No new RLS policy needed: `profiles` already has "update own profile" + "read connected profiles". | Once. Saving payment details shows a "run db/20" hint until run. |

> `db/02` is personal to the owner. The app itself never seeds anyone's data — new users
> start empty.

**To check what's actually applied** (without opening the dashboard): ask PostgREST for a
column and read the status code. A missing column returns 400 and a missing table 404,
both *before* any row is touched, so this leaks no data:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "$SUPABASE_URL/rest/v1/profiles?select=is_premium&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
# 200 = applied, 400 = column missing, 404 = table missing
```

### Auth configuration (in the Supabase dashboard)

- **URL Configuration** (Authentication → URL Configuration): the **Site URL** and a
  **Redirect URL** must both be set to `https://splitab.app/`.
  Without this, magic links fall back to `localhost` and don't work.
- **Email rate limit:** Supabase's built-in email sender allows only ~2–4/hour. For real
  use, configure **custom SMTP** (Authentication → Emails → SMTP Settings). Resend is the
  chosen provider. Note: without a verified domain, Resend (`onboarding@resend.dev`) only
  delivers to your own account email — emailing other people needs a custom domain.

- ⚠️ **The magic-link email template MUST include `{{ .Token }}`.** Authentication →
  Emails → **Magic Link** template. Without it the sign-in screen's 6-digit code box
  exists but the email carries no code to type, which is worse than not offering it.

  **Why the code exists at all:** corporate and university mail security (Outlook Safe
  Links, Barracuda, Proofpoint) *pre-fetches* every link in an incoming email to scan it.
  A Supabase magic link is single-use, so the scanner consumes the token and the real
  click then fails with "invalid or has expired". This is a known Supabase issue
  ([supabase/auth#1214](https://github.com/supabase/auth/issues/1214)), not a
  misconfiguration, and it makes magic links unusable on many work addresses. A scanner
  cannot consume a code that has to be typed, so the code path works where the link does
  not. `AuthScreen.jsx` shows both: the link is the happy path, the code is the fallback.

  Suggested template addition:

  ```html
  <p>Or enter this code: <strong style="font-size:20px">{{ .Token }}</strong></p>
  ```
### Auth hardening — chosen values and why

Set in Authentication → Rate Limits and → Providers → Email. Recorded here because these
are judgement calls that look arbitrary later.

| Setting | Value | Reasoning |
|---------|-------|-----------|
| Rate limit for sending emails | **300/hour** (was 3000) | Mail goes out from the *verified domain*. If anything ever loops, 3000/hour would wreck the Resend sending reputation — and the first casualty is our own sign-in codes not arriving. A personal-scale app sends a handful an hour. |
| Sign-ups / sign-ins | **15 per 5 min per IP** | The default 30 is loose; 5 is too tight. Mobile carriers put thousands of users behind one IP (CGNAT), so an aggressive cap locks out real people who did nothing wrong. 15 still stops bots. |
| Email OTP expiry | **900s (15 min)** | Was 3600. A sign-in code valid for an hour is a wide window if an inbox is exposed. |
| Email OTP length | **8 digits** | ⚠️ NOT the documented default of 6. `AuthScreen.jsx` must never hard-code the length — an input capped at 6 silently truncates the pasted code and every verification fails with no visible cause. It already did once. |
| Password requirements | **relaxed** (not all four character classes) | Composition rules push people toward `Password1!` and writing passwords down; length does more for security. Most users here sign in with Google or a magic link and never set a password at all. |
| Prevent leaked passwords | **off** | Not a choice — Supabase gates it behind the Pro plan. Revisit if the project upgrades. |

- **Google sign-in** needs a one-time Google OAuth credential pasted into Authentication →
  Providers → Google. Magic link and email+password work without it.

  > **Status: not finished.** The live site currently returns
  > `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: missing OAuth secret"}`
  > — the provider is toggled ON but the **client secret** is blank, so the request never
  > reaches Google. The toggle looks enabled either way, which makes this easy to miss.
  > To finish: Google Cloud Console → Credentials → Create OAuth client ID (Web
  > application) → add `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized
  > redirect URI → paste **both** the client ID and secret into Supabase → Save.

- **Testing sign-in on localhost:** `APP_URL` in `AuthScreen.jsx` is
  `window.location.origin + window.location.pathname`, so on a dev server it resolves to
  `http://localhost:5173/`. That is not on the Supabase redirect allow-list, and a
  `redirectTo` that isn't allow-listed is ignored — you get bounced to the Site URL
  (`https://splitab.app/`) instead of back to your dev server. Add
  `http://localhost:5173/` as a Redirect URL if you need to test auth locally.

---

## 4. Build & deploy

### Commands

```bash
npm install        # one-time, installs dependencies
npm run dev        # local dev server at http://localhost:5173 (rebuilds on save)
npm run build      # production build into docs/ (what GitHub Pages serves)

npm run test:categories   # merchant auto-categorisation tests (no network, no secrets)
```

### How the build works (`build.mjs`)

- Reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `.env` and injects them into the bundle
  at build time. **These two values are safe to ship** in a browser app — real protection
  comes from RLS. The secret `service_role` key is NEVER used here or committed.
- Copies everything in `public/` into `docs/`.
- **Production** (`npm run build`): emits a **content-hashed** bundle like
  `bundle-A1B2C3D4.js` and rewrites `docs/index.html` to point at it. The hash changes
  whenever the code changes, which forces browsers/CDN to fetch the new version
  ("cache busting"). Old `bundle*.js` files are cleaned from `docs/` each build.
- **Dev** (`npm run dev`): emits a fixed `docs/bundle.js` and serves `docs/` on port 5173.

> ⚠️ **Important deploy gotcha:** running the dev server overwrites the production `docs/`
> build (it writes `bundle.js` instead of the hashed file). **Always run `npm run build`
> immediately before committing/pushing a deploy**, and don't commit a `docs/bundle.js`.

### To update the live app

```bash
# 1. make your code changes in src/ (or public/)
npm run build                 # 2. produce the hashed production bundle in docs/
git add -A
git commit -m "your message"  # 3. commit (docs/ IS committed; .env is NOT)
git push origin main          # 4. push — GitHub Pages redeploys in ~1–2 minutes
```

Verify after ~2 minutes: open the live URL in a private/incognito window (guarantees fresh
code), or check the repo's Actions tab for the Pages build.

### Hosting facts

- **GitHub Pages** serves from the **`/docs` folder on `main`**.
- The app lives under a **subpath** (`/expense-splitter/`), so all asset paths and the
  manifest/SW use **relative** URLs, and the sign-in redirect uses `origin + pathname`.
- **Why public?** Free GitHub Pages requires a public repo. Public exposes the *source
  code*, not the *data* — expenses are behind login + RLS in Supabase. The anon key in the
  code is public by design.

### GitHub Actions (`.github/workflows/`)

These guard things that fail *silently* — problems you'd otherwise discover weeks
late, via a broken app rather than a red build.

| Workflow | Runs | What it does |
|----------|------|--------------|
| `keepalive.yml` | daily 06:17 UTC | Runs one tiny query against the `keepalive` table (db/12) so Supabase doesn't pause the Free-plan project. Fails red on any non-200. |
| `provider-health.yml` | Mondays 07:23 UTC | Runs `scripts/test-providers.mjs` against the real AI APIs and fails on any `FAIL`, so a retired scan model surfaces as a red CI run. |
| `categories.yml` | push/PR touching `src/App.jsx` or the script | Runs `scripts/test-categories.mjs` — the merchant auto-categorisation tests. No secrets, no network, no `npm ci` (node builtins only), so it is safe on fork PRs and can't go red for an unrelated dependency. |

**The category test reads `src/App.jsx` as text.** `RULES` and `autoCategorize` are not
exported (App.jsx is JSX and a plain `node` test cannot import it), so
`scripts/test-categories.mjs` slices the source between `const RULES = [` and
`const SPLIT_MODES`, writes that slice plus an export line to a temp file, and imports
it. That is deliberate: the test exercises the shipped source rather than a copy that
drifts. **If you rename either marker, the test fails loudly with a message telling you
to update them** — it does not silently pass. If the rules are ever moved into their own
module, delete the extraction and import that module instead; the cases stay as they are.

It also fails when the same keyword appears in two categories. That check earns its keep:
a duplicated keyword is resolved by rule *order*, which is exactly the fragility the
longest-match rewrite removed, and no amount of example cases reliably catches it.

The first two need **repository secrets** (Settings → Secrets and variables → Actions):
`SUPABASE_URL` + `SUPABASE_ANON_KEY` for the keep-alive; `OPENROUTER_API_KEY` (and
`GROQ_API_KEY` if used) for the health check. Use **Run workflow** once after adding them —
a scheduled job that has never run successfully is not proof of anything.

Two traps worth remembering:

- **GitHub disables scheduled workflows in a repo with no commits for 60 days.** It emails
  first and one click re-enables, but if this repo goes quiet the keep-alive stops and the
  project pauses anyway. An external pinger (cron-job.org, UptimeRobot) is the backup.
- **Grep the result lines, not the whole output.** `test-providers.mjs` always prints
  "needs at least one PASS to be useful", so a bare `grep -q PASS` matches even when every
  provider was skipped — a permanently-green check. `provider-health.yml` matches
  `(TEXT|VISION): PASS` for that reason.

> Supabase pauses Free-plan projects after ~7 days of low **database** activity. The ping
> must be a real PostgREST query; hitting a health endpoint like `/auth/v1/health` would not
> reliably count.

---

## 5. Realtime sync

`src/data/store.js` opens one Supabase realtime channel and subscribes to `postgres_changes`
on `groups`, `group_members`, `expenses`, `settlements`, and `connections`. Any change
triggers a full refetch, so a partner's edit appears on every signed-in device within a
second or two. The channel is cleaned up on sign-out / unmount.

**Resume-from-background handling** (fixes a "stuck loading" bug): a suspended PWA/tab
resumes with a dead realtime socket and a possibly-stale auth token, which could leave a
query hanging forever and the spinner stuck (only a full close/reopen recovered). `store.js`
now (1) runs a **12s loading watchdog** so the spinner can never hang — it falls back to the
cached snapshot; (2) on `visibilitychange`/`focus`/`online`, nudges the auth token
(`getSession()`) and refetches; (3) rebuilds the realtime channel on resume (kept in
`channelRef` so `subscribeRealtime()` can be re-called).

> ⚠️ **There are TWO spinners, and they need separate guards.** The `store.js` watchdog above
> only protects the spinner *inside* `<App/>`. `AuthGate` renders its own spinner while
> `AuthProvider.loading` is true, and while that is up `<App/>` is never mounted — so
> `store.js` cannot help. The original fix covered only `store.js`, and the iOS
> "reopen from the home screen and it just spins" bug persisted because of it.
>
> `AuthProvider` now has its own **8s watchdog**, plus two related fixes:
> - `getSession()` has a `.catch()`. Without one, a *rejected* promise became an unhandled
>   rejection and `loading` stayed true forever.
> - `loadProfile()` no longer gates `loading` on either path. It used to run as
>   `await loadProfile(...)` *before* `setLoading(false)`, so a stalled `profiles` query
>   hung the whole app. The profile is optional — `AuthGate` falls back to the email — so it
>   must never block the gate.
>
> Why iOS specifically: a backgrounded home-screen PWA has its web view purged, so reopening
> is a **fresh page load** on a network stack that is still waking up — ideal conditions for
> `getSession()` or the profile query to stall. Force-quitting worked because it gave a clean
> network context.
>
> **How to test this** (it cannot be reproduced by normal use): temporarily stub both auth
> entry points in `supabaseClient.js` so nothing ever settles —
> `supabase.auth.getSession = () => new Promise(() => {})` and
> `supabase.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } })`.
> The app must show "Loading…" and then reach the sign-in screen within ~8s. If it hangs
> forever, the watchdog has regressed. Revert the stub afterwards.

The store also handles the name↔id translation: the UI works with member **names**
(e.g. "Shailja"), while the database stores `expenses.paid_by` as a `group_members` **id**.
The store builds per-group maps (`_nameToMemberId` / `_memberIdToName`) to convert both ways.

---

## 6. PWA (installable app)

- `public/manifest.json` — name "Expense Splitter", short name "Expenses", standalone,
  theme/background `#FAFAF7`, relative icon paths, includes a maskable icon.
- `public/sw.js` — an **app-shell-only** service worker:
  - Ignores all **cross-origin** requests (so Supabase data and auth are always live, never
    cached).
  - **Network-first** for navigation (always gets the newest `index.html`, which points at
    the newest hashed bundle — avoids the "stuck on old version" trap).
  - **Stale-while-revalidate** for same-origin assets (bundle, icons, manifest).
  - Bump `CACHE_NAME` in `sw.js` when you change the SW itself.
- `public/icons/` — 180/192/512 PNG icons, generated by `scripts/gen-icons.mjs` (uses the
  `sharp` dev dependency). Re-run `node scripts/gen-icons.mjs` to regenerate.
- `public/index.html` — Apple home-screen meta tags, `viewport-fit=cover`, apple-touch-icon,
  SW registration, and a rule forcing 16px form inputs on phones (stops iOS focus-zoom).

**Install on iPhone:** Safari → open the live URL → Share → "Add to Home Screen". Launches
full-screen and stays signed in. iOS does not show an install banner; the Share sheet is the
only path.

---

## 7. Feature status & future work

**Built:**
- **Profile screen** (`src/auth/Profile.jsx`) — view email, edit display name; opens from
  the signed-in top bar. `AuthProvider` exposes `refreshProfile()`.
- **Password reset** — "Forgot password?" on the login screen → `resetPasswordForEmail`;
  `AuthProvider` detects the `PASSWORD_RECOVERY` event; `src/auth/ResetPassword.jsx` sets the
  new password via `updateUser`. Needs the Email provider + custom SMTP to actually deliver.
- **CSV import** (`src/data/csv.js` + `ImportModal` in `App.jsx`) — generic engine with
  Splitwise / bank presets, column mapping, amount/date normalization, preview, and a batch
  `importExpenses` action in `store.js`. Uses `papaparse`. The engine is pure logic (testable
  without auth). Add a provider by appending to `PROVIDER_PRESETS` in `csv.js`.
- **Settle-up for any group size** — `computeNetBalances` + `suggestSettlements` (greedy,
  minimal transactions) in `App.jsx`; settlements are factored as transfers. Unit-tested.
- **Export a group** — CSV download (RFC-4180) + dependency-free print-to-PDF, in the Summary tab.
- **Offline writes** (`src/data/offline.js` + `store.js`) — expense add/edit/delete and
  settlements work offline via client-UUIDs + an optimistic apply + a localStorage outbox that
  flushes on reconnect (23505 = already-synced, idempotent). A localStorage snapshot lets the
  app open offline. Group/people changes stay online-only. Offline/syncing banner in `App.jsx`.
  Pure helpers in `offline.js` are unit-tested. Storage keys: `slitab.snapshot.<userId>`,
  `slitab.outbox.<userId>`.

- **Ghost → real account linking** — `MembersPanel` "Link to account" picks an accepted
  connection; `linkGhostToUser` in `store.js` UPDATEs the `group_members` row (sets `user_id`,
  clears `ghost_name`) keeping the same id so the ghost's expenses stay attached. Requires
  `db/05`. The *email-invite* half (inviting someone who hasn't signed up) is still pending and
  needs working email (Resend + domain).
- **Groups landing dashboard** — the app opens to a list of group cards (member initials + your
  net balance via `computeNetBalances`); tap to enter, back to return. Group creation accepts
  multiple people at once.
- **Per-group currency** — each group has its own `currency` (db/06); chosen at creation
  (default from device locale → profile preference → USD), changeable in group edit. Amounts
  display per-group; home cards use each group's own currency. `localeDefaultCurrency()` in `App.jsx`.
- **Custom domain + branded email** — live at **https://splitab.app** (GitHub Pages custom domain
  via `public/CNAME`; Cloudflare DNS). Email sends from `hello@splitab.app` via Resend (domain
  verified), so magic link / reset / invites reach any address.
- **Ghost email-invite with AUTO-CONNECT** — `MembersPanel` "Invite by email" → `inviteGhostByEmail`
  (passes groupId + ghostMemberId) → `send-invite` Edge Function creates an `invites` row (db/09)
  with a token and emails a `?invite=<token>` link via Resend. On open, `main.jsx` stashes the token
  in localStorage (survives the auth redirect); after sign-in `App.jsx` calls `actions.acceptInvite`
  → the `accept_invite` SQL function (security definer) creates an accepted connection AND links the
  ghost to the new user (email must match the invited address). Needs db/09 + a re-deploy of
  `send-invite` (with the `RESEND_API_KEY` secret).

- **Receipt/statement scanning (OpenRouter → Groq)** — `ImportModal` "Scan" tab → `scanReceipt` in
  `store.js` calls the `scan-receipt` Edge Function (`supabase/functions/scan-receipt/`). IMAGES go
  to a vision model; PDFs are text-extracted in-function via `unpdf` (free, pinned to `@1.8.1`) and
  sent to a text model. Returns expenses into the existing import preview. Toggled by
  `SCAN_ENABLED` in `App.jsx`. Notes in `RECEIPT-SCANNING-PLAN.md`.

  **Why it's built to survive model churn.** Scanning kept breaking because each provider was
  pinned to ONE free-tier model, and free/preview models get renamed, retired and rate-limited
  without notice. Two layers now absorb that:

  1. Each provider takes a **comma-separated list** of candidate models. OpenRouter accepts the
     whole list in one request (`{"models": [...]}`) and fails over internally on rate-limiting,
     downtime, moderation blocks and context errors, billing only the model that actually ran.
     Groq has no such feature, so the function walks its list itself.
  2. Providers are still tried in order: **OpenRouter → Groq**.

  So a retired model is no longer an outage, and **swapping models is a secret change, not a code
  change** — no redeploy of new code needed.

  Defaults are cheap **paid** models on purpose (currently
  `google/gemini-2.5-flash-lite,openai/gpt-5-nano,qwen/qwen3.7-flash`, vendor-diverse so one
  vendor's outage doesn't take out every option). At roughly 1.8k input + 300 output tokens per
  receipt a scan costs about **$0.0003 — ~3,000 scans per dollar**. Paid models are deprecated on a
  published schedule; free ones just vanish. Groq's free tier stays as a safety net.

  Secrets: `OPENROUTER_API_KEY` (primary), `GROQ_API_KEY` (fallback), plus optional
  `OPENROUTER_VISION_MODELS` / `OPENROUTER_TEXT_MODELS` / `GROQ_VISION_MODELS` / `GROQ_TEXT_MODELS`
  (comma-separated, tried in order). The older singular `..._MODEL` names are still honoured.

  > The direct **Gemini API** leg was removed — `gemini-2.0-flash` was retired, and because it sat
  > last in the chain its error was the only one surfaced, making every failure look like a Gemini
  > problem even when the real cause was upstream. (`google/gemini-2.5-flash-lite` in the defaults
  > is Gemini *via OpenRouter* — a different route.)

- **Per-expense participants** — each expense stores `participants` (db/10), the frozen set of
  members it's split among (snapshot at creation). Equal/Full split among the expense's
  participants, not live membership, so adding a member later doesn't change old expenses. The
  expense form has a "Split among" selector (equal/full) to include/exclude people. Backfill in
  db/10 locks existing expenses to their then-current members.

## 8. Roadmap / deferred decisions (recorded so we don't lose them)

> 📋 **Open work lives in [BACKLOG.md](BACKLOG.md), not here.** This section records
> *decisions and their reasoning* — the "why we chose this" that would otherwise be
> re-litigated. Anything still to be built belongs in `BACKLOG.md`, which is updated in the
> same commit as the work. Keeping the two apart is deliberate: mixing "what we decided"
> with "what's left" is how both drift.

- **Information architecture (NEXT / in progress)** — avatar (top-right) → Profile (personal info:
  name, photo, email); gear → Settings/Account (default currency, notifications, password, dark
  mode, sign out); edit/delete/export a group from INSIDE the group (the group-name chevron menu),
  not via the groups list; solo groups show their running total on top.
- **Long-term growth → TIME-BASED FILTERS, not settle-and-archive.** Decision: archiving assumes
  clean settlement, but roommates pay late and partial. So keep ONE continuous running balance
  (partial settlements just reduce it; carried debt is natural) and let users *filter the view* by
  month/period. Default to "this month", past periods browsable. Pair with **pagination / lazy-load**
  of the expense list for performance (today the store loads ALL of a group's expenses at once).
- **Activity feed** — per-group log of expenses / settlements / member changes, next to Connections.
- **Donation link** — a simple "Support Splitab" link to Ko-fi / Buy Me a Coffee in Settings. No
  payment system to build (the provider handles money). Only meaningful if shared publicly.
- **Payment hand-off — DECIDED: a free-text note, and the app NEVER touches money.** Each
  person writes their own "how to pay me" line on their profile (`profiles.payment_note`,
  db/20) — "UPI: name@bank", "Venmo: @handle", "Cash is fine" — and the payer reads it at
  settle-up and pays in whatever app they already use. Two rejected options, recorded so
  they don't come back: (1) *a field per payment app, per country* — an endless maintenance
  tail, and it breaks for anyone travelling; (2) *actually moving the money in-app* — that
  makes Splitab a regulated payment service, a completely different undertaking. So there
  is deliberately **no payment SDK, deep link or API**; the app displays a string the user
  wrote and records that a payment happened elsewhere. The note is visible to everyone you
  are connected to (the existing "read connected profiles" RLS policy), which the Profile
  screen states plainly next to the field.
- **Bank linking — DECIDED: skip.** Regulated (Plaid/aggregators), real cost, compliance/liability
  for bank data. CSV import + receipt scanning cover "get transactions in" without the burden.
  Revisit only if this becomes a funded commercial product.

---

## 9. Conventions for changes

- Match Supabase **table/column names exactly** (`split_mode`, `paid_by`, `ghost_name`,
  `owner_id`, `group_id`, etc.) — see `db/01_schema.sql`.
- Keep the auth files (`src/auth/*`), the data layer (`src/data/store.js`), and the build
  (`build.mjs`) as separate concerns.
- Keep components small and commented in plain language.
- Never commit `.env` or use the `service_role` key in client code.
- Always `npm run build` before a deploy commit (see the gotcha in section 4).

### Keeping the docs honest

These rules exist because this project has already been bitten by each one.

- **Update [BACKLOG.md](BACKLOG.md) in the SAME commit as the work.** Not after. A tracker
  updated "later" is how `HANDOFF.md` ended up listing finished work as pending for months.
- **"Done" requires evidence, not a build.** A passing test, a green CI run, or a live
  check. `CLAUDE.md` §5 once flatly claimed the stuck-loading bug was fixed when only
  `store.js` had been covered — sending the next person to the wrong file entirely.
- **When you find a doc that is wrong, fix it in that commit.** A stale doc is worse than
  no doc, because it is trusted.
- **New ideas go to the BACKLOG Parking lot, not straight into the work.** Deciding to
  start something should be deliberate.
- **Record the reasoning for a rejected option**, not just the chosen one — otherwise it
  gets proposed again next quarter.
