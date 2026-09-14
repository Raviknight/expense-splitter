// send-digest — Supabase Edge Function
// ----------------------------------------------------------------------------
// Sends the DAILY summary and the MONTHLY statement. One function, two modes,
// chosen by the request body: { "kind": "daily" | "monthly" }.
//
// Triggered by .github/workflows/digests.yml (GitHub Actions cron).
//
// ── SAFETY ───────────────────────────────────────────────────────────────────
// This function emails EVERY opted-in user, so two guards matter:
//
//   1. SHARED SECRET. It uses the service_role key internally, which bypasses
//      RLS — so it must never be callable by the public. Every request must
//      carry  x-digest-secret: <DIGEST_SECRET>  or it is rejected. Without this
//      anyone who found the URL could trigger mass mail.
//
//   2. DRY RUN. Send { "dryRun": true } to compute everything and report what
//      WOULD be sent, without calling any email provider. Always dry-run first after any
//      change — a mass-email job you cannot test safely is a liability.
//
// ── NO ACTIVITY, NO EMAIL ────────────────────────────────────────────────────
// BOTH digests are skipped for a user with no new activity in their window —
// not just the daily one. "Nothing happened" is not worth an email, and an
// empty monthly statement is equally pointless. Sending anyway is how you train
// people to ignore your mail, or report it, which damages the sending domain
// the sign-in codes also depend on.
//
// Confirmed as the intended product behaviour, and verified by a dry run where
// all eight opted-in recipients were skipped and nothing was sent.
//
// DEPLOY (Supabase dashboard):
//   1. Edge Functions → create a function named exactly  send-digest , paste
//      this file, Deploy.
//   2. Secrets:
//        BREVO_API_KEY             = xkeysib-…       (PRIMARY sender — see below)
//        RESEND_API_KEY            = re_…            (same key the other functions use)
//        SUPABASE_SERVICE_ROLE_KEY = eyJ…            (Settings → API → service_role)
//        DIGEST_SECRET             = <any long random string>
//   3. Put the same DIGEST_SECRET into the GitHub repo secrets so the workflow
//      can authenticate.
//
// ── WHY BREVO IS TRIED FIRST ─────────────────────────────────────────────────
// Supabase AUTH email (sign-in codes, sign-up confirmations) goes through the
// SAME Resend account, which on the free plan allows 100/day and 3000/month.
// A digest run that exhausts the daily quota would stop people SIGNING IN — the
// least important mail starving the most important. So bulk mail like this goes
// to Brevo first, and Resend stays as the safety net. If BREVO_API_KEY is not
// set, or Brevo errors, this falls back to Resend automatically and logs why.
//
// NOTE ON SCALE: this loads the relevant rows and assembles digests in memory,
// which is right for a small user base and a handful of queries. If this ever
// serves thousands of users it should page through recipients instead.
// ----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY    = Deno.env.get("RESEND_API_KEY");
const BREVO_API_KEY     = Deno.env.get("BREVO_API_KEY");
const DIGEST_SECRET     = Deno.env.get("DIGEST_SECRET");

const APP_URL = "https://splitab.app/";
const FROM    = "Splitab <hello@splitab.app>";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", INR: "₹", CAD: "$", AUD: "$", JPY: "¥",
};
const money = (n: number, code: string) =>
  `${CURRENCY_SYMBOL[code] || ""}${Math.abs(n).toFixed(2)}`;

// ── Email shell ──────────────────────────────────────────────────────────────
// Inline styles only: email clients strip <style> blocks and have no CSS
// support worth relying on.
function shell(title: string, bodyHtml: string, footerNote: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FAFAF7;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
    <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;margin-bottom:4px;">Splitab</div>
    <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.02em;margin:16px 0 20px;">${esc(title)}</h1>
    ${bodyHtml}
    <div style="margin-top:28px;">
      <a href="${APP_URL}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:500;">Open Splitab</a>
    </div>
    <p style="color:#a8a29e;font-size:12px;line-height:1.6;margin-top:28px;border-top:1px solid #e7e5e4;padding-top:16px;">
      ${esc(footerNote)}<br>
      Turn this off any time in Splitab → Settings → Notifications.
    </p>
  </div></body></html>`;
}

function row(left: string, right: string, muted = false) {
  return `<tr>
    <td style="padding:7px 0;font-size:14px;color:${muted ? "#78716c" : "#1c1917"};">${left}</td>
    <td style="padding:7px 0;font-size:14px;text-align:right;white-space:nowrap;color:${muted ? "#78716c" : "#1c1917"};">${right}</td>
  </tr>`;
}

// ── Sending: Brevo first, Resend as the fallback ─────────────────────────────
// This block is duplicated, deliberately, in send-invite and send-welcome. These
// functions are deployed by pasting ONE file into the Supabase dashboard, so a
// shared module would be an import the dashboard cannot resolve. A little
// duplication is the price of a file that always deploys.

// FROM is RFC5322 — "Splitab <hello@splitab.app>". Resend takes that string as
// it is; Brevo needs the name and the address as separate fields. Anything that
// doesn't match Name <addr> is treated as a bare address with no name, so an
// unexpected shape degrades instead of throwing.
function parseFrom(from: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(String(from ?? ""));
  if (m) {
    const name = m[1].replace(/^"|"$/g, "").trim();
    return name ? { email: m[2], name } : { email: m[2] };
  }
  return { email: String(from ?? "").trim() };
}

// Throws on any non-2xx, with the status and a truncated body — a fallback that
// hides a real misconfiguration (wrong key, unverified sender) is a trap.
async function sendViaBrevo(to: string, subject: string, html: string) {
  const sender = parseFrom(FROM);
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY!,      // Brevo uses its own header, not Bearer auth.
      "content-type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify({
      sender: sender.name ? { email: sender.email, name: sender.name } : { email: sender.email },
      to: [{ email: to }],
      subject,
      htmlContent: html,              // Brevo calls it htmlContent, not html.
    }),
  });
  if (!resp.ok) throw new Error(`Brevo ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
}

// Unchanged contract: returns on success, throws `Resend <status>: <body>` on
// failure. The caller's per-recipient try/catch still records that message.
async function sendEmail(to: string, subject: string, html: string) {
  if (BREVO_API_KEY) {
    try {
      await sendViaBrevo(to, subject, html);
      console.log("[send-digest] sent via brevo");
      return;
    } catch (err) {
      console.error(`[send-digest] brevo failed, falling back to resend — ${String((err as Error)?.message ?? err)}`);
    }
  } else {
    console.log("[send-digest] BREVO_API_KEY not set — using resend");
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  console.log("[send-digest] sent via resend");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    if (!DIGEST_SECRET) return json({ error: "Server missing DIGEST_SECRET" }, 500);
    if (req.headers.get("x-digest-secret") !== DIGEST_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (!SERVICE_ROLE_KEY) return json({ error: "Server missing SUPABASE_SERVICE_ROLE_KEY" }, 500);

    const body   = await req.json().catch(() => ({}));
    const kind   = body?.kind === "monthly" ? "monthly" : "daily";
    const dryRun = body?.dryRun === true;

    // At least ONE provider. Insisting on Resend would block a healthy Brevo
    // setup the moment the Resend key is removed — the fallback has to be able
    // to stand on either leg. The dry run needs neither, since it sends nothing.
    if (!dryRun && !RESEND_API_KEY && !BREVO_API_KEY) {
      return json({ error: "Server missing BREVO_API_KEY / RESEND_API_KEY" }, 500);
    }

    // service_role bypasses RLS — required, since this reads across all users.
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const prefCol = kind === "daily" ? "notify_daily" : "notify_monthly";
    const sentCol = kind === "daily" ? "last_daily_digest_at" : "last_monthly_digest_at";

    // 1. Recipients who opted in.
    const { data: profiles, error: pErr } = await db
      .from("profiles")
      .select(`id, email, display_name, ${prefCol}, ${sentCol}`)
      .eq(prefCol, true);
    if (pErr) throw new Error(`profiles: ${pErr.message}`);
    if (!profiles?.length) return json({ ok: true, kind, dryRun, considered: 0, sent: 0, skipped: 0, details: [] });

    const now = new Date();

    // Default window when we've never sent before.
    //   daily   → last 24h
    //   monthly → the PREVIOUS calendar month (the job runs on the 1st)
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const defaultSince = kind === "daily"
      ? new Date(now.getTime() - 24 * 3600 * 1000)
      : prevMonthStart;
    // Monthly is a closed period: it must not include the current month.
    const windowEnd = kind === "monthly" ? thisMonthStart : now;

    // Snap a monthly window START to a calendar boundary.
    //
    // Two bugs this fixes, both of which produce a statement that is quietly
    // WRONG rather than obviously broken:
    //
    //  1. Using last_monthly_digest_at raw means the next window starts at the
    //     exact send time — 07:40 on the 1st — silently omitting anything
    //     created in the first ~7.7 hours of that month. It compounds every
    //     month and nobody would ever notice.
    //
    //  2. GitHub delays and sometimes DROPS scheduled runs (noted in
    //     digests.yml). If October's run is dropped, November's covers two
    //     months of expenses — and the heading, computed from "the month before
    //     now", would claim it was just one. Two months of spending under a
    //     one-month title is exactly the silent wrongness worth guarding.
    const monthStartOf = (d: Date) =>
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

    // Name the period from the ACTUAL window, not from an assumption about when
    // the job ran. Spanning months says so.
    const monthLabel = (from: Date, toExclusive: Date) => {
      const last = new Date(toExclusive.getTime() - 1);   // inclusive end
      const fmt = (d: Date, withYear: boolean) =>
        d.toLocaleString("en-US", withYear ? { month: "long", year: "numeric", timeZone: "UTC" }
                                           : { month: "long", timeZone: "UTC" });
      const sameMonth = from.getUTCFullYear() === last.getUTCFullYear()
        && from.getUTCMonth() === last.getUTCMonth();
      if (sameMonth) return fmt(from, true);
      const sameYear = from.getUTCFullYear() === last.getUTCFullYear();
      return `${fmt(from, !sameYear)} – ${fmt(last, true)}`;
    };

    const userIds = profiles.map((p: any) => p.id);

    // 2. Which groups each recipient belongs to.
    const { data: members, error: mErr } = await db
      .from("group_members")
      .select("group_id, user_id, ghost_name")
      .in("user_id", userIds);
    if (mErr) throw new Error(`group_members: ${mErr.message}`);

    const groupsByUser = new Map<string, string[]>();
    for (const m of members ?? []) {
      if (!m.user_id) continue;
      const arr = groupsByUser.get(m.user_id) ?? [];
      arr.push(m.group_id);
      groupsByUser.set(m.user_id, arr);
    }

    const allGroupIds = [...new Set((members ?? []).map((m: any) => m.group_id))];
    if (!allGroupIds.length) return json({ ok: true, kind, dryRun, considered: profiles.length, sent: 0, skipped: profiles.length, details: [] });

    // 3. Group names + currency.
    const { data: groups, error: gErr } = await db
      .from("groups")
      .select("id, name, currency")
      .in("id", allGroupIds);
    if (gErr) throw new Error(`groups: ${gErr.message}`);
    const groupById = new Map((groups ?? []).map((g: any) => [g.id, g]));

    // 4. Expenses in the widest window any recipient needs, fetched once.
    const earliest = profiles.reduce((min: Date, p: any) => {
      const sinceRaw = p[sentCol] ? new Date(p[sentCol]) : defaultSince;
      // Monthly windows run boundary-to-boundary; see monthStartOf above.
      const since = kind === "monthly" ? monthStartOf(sinceRaw) : sinceRaw;
      return since < min ? since : min;
    }, new Date());

    const { data: expenses, error: eErr } = await db
      .from("expenses")
      .select("id, group_id, name, amount, category, created_at")
      .in("group_id", allGroupIds)
      .gte("created_at", earliest.toISOString())
      .lt("created_at", windowEnd.toISOString());
    if (eErr) throw new Error(`expenses: ${eErr.message}`);

    // 5. Build and send one digest per recipient.
    let sent = 0, skipped = 0;
    const details: any[] = [];

    for (const p of profiles as any[]) {
      const sinceRaw = p[sentCol] ? new Date(p[sentCol]) : defaultSince;
      // Monthly windows run boundary-to-boundary; see monthStartOf above.
      const since = kind === "monthly" ? monthStartOf(sinceRaw) : sinceRaw;
      const myGroups = new Set(groupsByUser.get(p.id) ?? []);

      const mine = (expenses ?? []).filter((e: any) =>
        myGroups.has(e.group_id) &&
        new Date(e.created_at) >= since &&
        new Date(e.created_at) < windowEnd
      );

      // QUIET DAY: nothing new → send nothing. Applies to both kinds; an empty
      // monthly statement is equally pointless.
      if (mine.length === 0) {
        skipped++;
        details.push({ email: p.email, skipped: "no new activity", since: since.toISOString() });
        continue;
      }

      // Totals per group, in that group's own currency. Amounts are NEVER added
      // across currencies — the app deliberately avoids that everywhere else too.
      const byGroup = new Map<string, { name: string; currency: string; total: number; items: any[] }>();
      for (const e of mine) {
        const g = groupById.get(e.group_id);
        if (!g) continue;
        const entry = byGroup.get(e.group_id) ?? { name: g.name, currency: g.currency || "USD", total: 0, items: [] };
        entry.total += Number(e.amount) || 0;
        entry.items.push(e);
        byGroup.set(e.group_id, entry);
      }

      const name = (p.display_name || "there").split(" ")[0];
      let bodyHtml = "";
      let subject = "";
      let footer = "";

      if (kind === "daily") {
        subject = `Splitab — ${mine.length} new expense${mine.length === 1 ? "" : "s"}`;
        footer = "You're getting this because the daily summary is on for your account.";
        bodyHtml = `<p style="font-size:15px;line-height:1.6;color:#44403c;margin:0 0 18px;">Hi ${esc(name)}, here's what changed.</p>`;
        for (const [, g] of byGroup) {
          bodyHtml += `<div style="margin-bottom:18px;">
            <div style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#78716c;margin-bottom:6px;">${esc(g.name)}</div>
            <table style="width:100%;border-collapse:collapse;">
              ${g.items.slice(0, 8).map((e: any) =>
                row(esc(e.name || "Expense"), money(Number(e.amount) || 0, g.currency))).join("")}
              ${g.items.length > 8 ? row(`<em>+ ${g.items.length - 8} more</em>`, "", true) : ""}
              ${row("<strong>Total</strong>", `<strong>${money(g.total, g.currency)}</strong>`)}
            </table>
          </div>`;
        }
      } else {
        const label = monthLabel(since, windowEnd);
        subject = `Splitab — your ${label} statement`;
        footer = "You're getting this because the monthly statement is on for your account.";
        bodyHtml = `<p style="font-size:15px;line-height:1.6;color:#44403c;margin:0 0 18px;">Hi ${esc(name)}, here's your ${esc(label)} summary.</p>`;
        for (const [, g] of byGroup) {
          // Per-category breakdown reads better over a month than a list of rows.
          const byCat = new Map<string, number>();
          for (const e of g.items) {
            const c = e.category || "Other";
            byCat.set(c, (byCat.get(c) || 0) + (Number(e.amount) || 0));
          }
          const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
          bodyHtml += `<div style="margin-bottom:18px;">
            <div style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#78716c;margin-bottom:6px;">${esc(g.name)}</div>
            <table style="width:100%;border-collapse:collapse;">
              ${cats.map(([c, v]) => row(esc(c), money(v, g.currency), true)).join("")}
              ${row("<strong>Total</strong>", `<strong>${money(g.total, g.currency)}</strong>`)}
            </table>
            <div style="font-size:12px;color:#a8a29e;margin-top:4px;">${g.items.length} expense${g.items.length === 1 ? "" : "s"}</div>
          </div>`;
        }
      }

      if (dryRun) {
        sent++;
        details.push({ email: p.email, wouldSend: subject, expenses: mine.length, since: since.toISOString() });
        continue;
      }

      try {
        await sendEmail(p.email, subject, shell(subject, bodyHtml, footer));
        // Only advance the marker after a SUCCESSFUL send, so a failure retries
        // the same window next run rather than silently skipping it.
        await db.from("profiles").update({ [sentCol]: now.toISOString() }).eq("id", p.id);
        sent++;
        details.push({ email: p.email, sent: subject, expenses: mine.length });
      } catch (err) {
        details.push({ email: p.email, error: String((err as Error)?.message ?? err) });
      }
    }

    return json({ ok: true, kind, dryRun, considered: profiles.length, sent, skipped, details });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
