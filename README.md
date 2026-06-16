# Slitab

**Split trip expenses with anyone — even friends who aren't on the app.**

Slitab is a multi-user, cloud-synced Progressive Web App (PWA) for splitting expenses on
trips and in groups. It installs on your phone's home screen, works offline, and syncs in
real time across devices.

🔗 **Live app:** https://raviknight.github.io/expense-splitter/

> ⚠️ **Source-available, not open source.** You're welcome to read and learn from this code.
> Please don't use it to build a competing product — see [License](#license).

---

## Features

- **Groups & expenses** — organize spending by trip/group, with categories and auto-categorization.
- **Flexible splits** — Equal, Full (someone else owes it all), or Personal (no split).
- **Ghost members** — add people who aren't on the app, by name, for your own tracking.
- **Settle up (any group size)** — suggests the minimal set of "who pays whom" payments.
- **Real-time sync** — a partner's edits appear on every signed-in device within seconds.
- **Works offline** — add/edit expenses and settle up with no signal; changes sync on reconnect.
- **CSV import** — bring in Splitwise or bank-statement exports with a column-mapping wizard.
- **Export** — download a group as CSV, or save a printable PDF report.
- **Insights** — see spending broken down by category.
- **Multi-currency display**, profile & password management, and installable on iPhone/Android.

## Privacy & security

Everyone shares one database, but **Row-Level Security (RLS)** in the database guarantees you
can only ever read or write your own data and the data of groups you belong to. Two people can
only share a group after they **mutually connect** (a request → accept handshake). The public
source code does **not** expose anyone's data — expenses live behind login + RLS.

## Tech stack

- **Frontend:** React 18, bundled with esbuild (no framework runtime); Tailwind (Play CDN).
- **Backend:** [Supabase](https://supabase.com) — Postgres, Auth (magic link / Google / password),
  Row-Level Security, and Realtime.
- **Hosting:** GitHub Pages (served from `/docs`), installable as a PWA.

## Running it yourself

```bash
npm install     # install dependencies
npm run dev     # local dev server at http://localhost:5173
npm run build   # production build into docs/ (what GitHub Pages serves)
```

You'll need a free Supabase project and a `.env` with `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
The database is set up by running the scripts in `db/` once each in the Supabase SQL Editor.

📖 **Full architecture, setup, and deployment details are in [CLAUDE.md](CLAUDE.md).**

## License

Licensed under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**.

- ✅ You **may** read, study, run, and modify this software for any **noncommercial** purpose —
  personal use, education, and research are all explicitly allowed.
- ❌ You **may not** use it for **commercial** purposes, including running a competing product or
  service.

This is intentionally *source-available for learning*, not a permissive open-source license.
