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

> `db/02` is personal to the owner. The app itself never seeds anyone's data — new users
> start empty.

### Auth configuration (in the Supabase dashboard)

- **URL Configuration** (Authentication → URL Configuration): the **Site URL** and a
  **Redirect URL** must both be set to `https://splitab.app/`.
  Without this, magic links fall back to `localhost` and don't work.
- **Email rate limit:** Supabase's built-in email sender allows only ~2–4/hour. For real
  use, configure **custom SMTP** (Authentication → Emails → SMTP Settings). Resend is the
  chosen provider. Note: without a verified domain, Resend (`onboarding@resend.dev`) only
  delivers to your own account email — emailing other people needs a custom domain.
- **Google sign-in** needs a one-time Google OAuth credential pasted into Authentication →
  Providers → Google. Magic link and email+password work without it.

---

## 4. Build & deploy

### Commands

```bash
npm install        # one-time, installs dependencies
npm run dev        # local dev server at http://localhost:5173 (rebuilds on save)
npm run build      # production build into docs/ (what GitHub Pages serves)
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

---

## 5. Realtime sync

`src/data/store.js` opens one Supabase realtime channel and subscribes to `postgres_changes`
on `groups`, `group_members`, `expenses`, `settlements`, and `connections`. Any change
triggers a full refetch, so a partner's edit appears on every signed-in device within a
second or two. The channel is cleaned up on sign-out / unmount.

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
- **Ghost email-invite** — `MembersPanel` "Invite by email" → `inviteGhostByEmail` in `store.js`
  calls the `send-invite` Supabase Edge Function (`supabase/functions/send-invite/index.ts`),
  which emails an invite via Resend. The function must be deployed in the Supabase dashboard with
  a `RESEND_API_KEY` secret. Auto-link on signup is intentionally not built; the invitee signs up,
  connects, then the owner uses the existing "Link to account" flow.

- **Receipt/statement scanning (AI vision)** — `ImportModal` "Scan" tab → `scanReceipt` in
  `store.js` calls the `scan-receipt` Supabase Edge Function (`supabase/functions/scan-receipt/`),
  which sends the image/PDF to Google Gemini (free tier) and returns extracted expenses that flow
  into the existing import preview. Deploy the function with a `GEMINI_API_KEY` secret (optional
  `GEMINI_MODEL`). Design notes in `RECEIPT-SCANNING-PLAN.md`.

**Not built yet:**
- **Per-person balance DISPLAY for 3+ groups with recorded settlements** — the settle-up
  *suggestions* use correct net-balance math, but the older balance *display* at the top of the
  Summary still treats settlements as a `full` split (exact for 2 people only). Align it with
  `computeNetBalances` if needed.

---

## 8. Conventions for changes

- Match Supabase **table/column names exactly** (`split_mode`, `paid_by`, `ghost_name`,
  `owner_id`, `group_id`, etc.) — see `db/01_schema.sql`.
- Keep the auth files (`src/auth/*`), the data layer (`src/data/store.js`), and the build
  (`build.mjs`) as separate concerns.
- Keep components small and commented in plain language.
- Never commit `.env` or use the `service_role` key in client code.
- Always `npm run build` before a deploy commit (see the gotcha in section 4).
