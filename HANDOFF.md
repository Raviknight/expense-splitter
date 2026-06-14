# Expense Splitter — session handoff

This file records what's already done so a fresh Claude Code session (started inside
`D:\Ravi\GitHub\Expense`) can resume without repeating setup.

## Already done
- Environment verified: Node v24.15.0, npm 11.12.1, git 2.54.0 — all OK (need Node 18+).
- GitHub CLI installed (gh 2.94.0) and logged in as **Raviknight** (token scopes include
  `repo` + `workflow`, enough for a private repo + push).
- Claude Code CLI installed globally (claude 2.1.177).
- Six subagents created in `.claude/agents/`: scaffolder, auth-builder, sync-engine,
  ghost-members, pwa-builder, deployer.
- Source files staged:
  - `trip-splitter.jsx` (project root) — base UI (already copied to `src/App.jsx`).
  - `db/01_schema.sql`, `db/02_import_my_data.sql` — Supabase schema + Ravi's personal import.
- **STEP 1 (scaffolder) COMPLETE and build-verified.** Created: `package.json`, `build.mjs`
  (esbuild → `docs/`, injects Supabase env + NODE_ENV), `src/main.jsx` (with a TEMPORARY
  in-memory `window.storage` shim — sync-engine must remove it), `src/App.jsx`,
  `src/supabaseClient.js`, `public/index.html` (Tailwind Play CDN; pwa-builder enhances it),
  `.env` (real Supabase values, must be gitignored), `.env.example`. `npm install` clean
  (0 vulnerabilities after bumping esbuild to ^0.28.1). `npm run build` succeeds → `docs/`.

## Supabase
- Project created. URL + anon key are ALREADY in `.env` (gitignored later by deployer).
  The anon key is a safe-to-ship client value; the `service_role` key must NEVER be used
  or committed.
- OPEN QUESTION: has `db/01_schema.sql` been run yet in the Supabase SQL Editor? Step 2's
  connection feature and Step 3's sync need those tables to exist. Confirm with the user.

## Execution plan (pause for user confirmation after each step)
1. scaffolder — DONE.
2. auth-builder — DONE. Login (magic link / Google / email+password) in src/auth/AuthScreen.jsx;
   AuthProvider/AuthGate/Connections/useConnections in src/auth/. main.jsx wraps App in
   <AuthProvider><AuthGate>. Email lookup uses RPC find_profile_by_email (db/03), not a direct
   profiles query (RLS hides strangers). Sign-in redirect uses origin+pathname (APP_URL) so it
   works under the GitHub Pages /repo/ subpath.
6. deployer — DONE (brought forward at user request). PUBLIC repo (free Pages needs public):
   https://github.com/Raviknight/expense-splitter — live at
   https://raviknight.github.io/expense-splitter/ . .env is gitignored; docs/ is committed.
3. sync-engine — replace localStorage with Supabase reads/writes + realtime.  <-- NEXT
4. ghost-members — add non-platform people by name; existing equal/full/personal split modes.
5. pwa-builder — manifest, service worker (app shell only), icons (180/192/512), iOS meta.
7. iPhone install instructions; restate the run-once SQL reminder.

## BLOCKING: one-time Supabase setup the user must do before sign-in works
- Run db/01_schema.sql (tables + RLS + profile-on-signup trigger). STATUS: unconfirmed.
- Run db/03_find_profile_by_email.sql (lets "add a connection by email" find people).
- Authentication > URL Configuration: set Site URL AND add Redirect URL =
  https://raviknight.github.io/expense-splitter/  (without this the magic link is rejected).

## Reminders to restate to the user at the end
- `db/01_schema.sql` runs ONCE in the Supabase SQL Editor (creates tables + RLS + realtime).
- `db/02_import_my_data.sql` runs ONCE, AFTER signing up, to load Ravi's Niagara trip into
  his account only. The app itself never seeds anyone's data.
- User is a mechanical engineer, new to coding: explain before running, flag jargon,
  distinguish warnings from real errors, show verification steps, avoid the words
  "just"/"obviously".
