// send-welcome — Supabase Edge Function
// ----------------------------------------------------------------------------
// Sends a one-time "Welcome to Splitab" email when a new account is created.
// It is meant to be called by a Supabase DATABASE WEBHOOK on INSERT into the
// `profiles` table (one profile row is created per signup), which POSTs the new
// row as { type, table, record: { email, display_name, ... } }.
//
// DEPLOY (Supabase dashboard):
//   1. Edge Functions → create a function named exactly  send-welcome , paste
//      this, Deploy.
//   2. Secrets: BREVO_API_KEY  = <your xkeysib-… key>  (tried FIRST — see below).
//               RESEND_API_KEY = <your re_… key>       (reuse the same Resend key).
//      Optional: WEBHOOK_SECRET = <any random string> for extra safety.
//   3. Database → Webhooks → Create a new hook:
//        - Table: public.profiles, Events: INSERT
//        - Type: Supabase Edge Functions → pick `send-welcome`
//        - (Optional) add an HTTP header  x-webhook-secret: <same WEBHOOK_SECRET>
//
// ── WHY BREVO IS TRIED FIRST ─────────────────────────────────────────────────
// Supabase AUTH email (sign-in codes, sign-up confirmations) goes through the
// SAME Resend account, which on the free plan allows 100/day and 3000/month.
// Burning that quota on welcome mail would stop people SIGNING IN. So app mail
// goes to Brevo first and Resend is the safety net. No BREVO_API_KEY, or a Brevo
// error, falls back to Resend automatically and logs why.
// ----------------------------------------------------------------------------

const RESEND_API_KEY  = Deno.env.get("RESEND_API_KEY");
const BREVO_API_KEY    = Deno.env.get("BREVO_API_KEY");
const WEBHOOK_SECRET   = Deno.env.get("WEBHOOK_SECRET"); // optional

const APP_URL = "https://splitab.app/";
const FROM    = "Splitab <hello@splitab.app>";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ── Sending: Brevo first, Resend as the fallback ─────────────────────────────
// This block is duplicated, deliberately, in send-digest and send-invite. These
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

// Unchanged contract: a Resend non-2xx comes back as { ok: false, detail } so the
// caller still answers 502 with the provider's body, and a thrown fetch still
// propagates to the outer catch (500), exactly as before.
async function sendEmail(
  to: string, subject: string, html: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (BREVO_API_KEY) {
    try {
      await sendViaBrevo(to, subject, html);
      console.log("[send-welcome] sent via brevo");
      return { ok: true };
    } catch (err) {
      console.error(`[send-welcome] brevo failed, falling back to resend — ${String((err as Error)?.message ?? err)}`);
    }
  } else {
    console.log("[send-welcome] BREVO_API_KEY not set — using resend");
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    console.error(`[send-welcome] resend failed — ${resp.status}: ${detail.slice(0, 200)}`);
    return { ok: false, detail };
  }
  console.log("[send-welcome] sent via resend");
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    // At least ONE provider, not Resend specifically — same reasoning as
    // send-invite: a healthy Brevo setup must not be blocked by a missing
    // Resend key, or the fallback protects nothing.
    if (!RESEND_API_KEY && !BREVO_API_KEY) {
      return json({ error: "Server missing BREVO_API_KEY / RESEND_API_KEY secret" }, 500);
    }

    // Optional shared-secret check (set WEBHOOK_SECRET + the matching header).
    if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    const payload = await req.json().catch(() => ({}));
    const record  = payload?.record ?? payload ?? {};
    const email   = record?.email;
    const name    = (record?.display_name || "there").toString();

    if (!email) return json({ error: "No email in payload (nothing to send)." }, 200);

    const subject = "Welcome to Splitab 👋";
    const html = `
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF7;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
        <tr><td align="center">
          <table width="100%" style="max-width:460px;background:#fff;border:1px solid #e7e5e4;border-radius:16px;padding:32px;">
            <tr><td align="center" style="padding-bottom:16px;">
              <div style="width:48px;height:48px;background:#1c1917;border-radius:12px;display:inline-block;line-height:48px;color:#818cf8;font-size:26px;font-weight:700;font-family:Georgia,serif;">S</div>
            </td></tr>
            <tr><td align="center" style="font-size:20px;font-weight:600;color:#1c1917;padding-bottom:8px;">
              Welcome to Splitab, ${escapeHtml(name)}!
            </td></tr>
            <tr><td align="left" style="font-size:14px;color:#57534e;line-height:1.7;padding-bottom:20px;">
              Splitab makes it easy to split any shared expense — trips, rent, dinners, anything — and settle up without the awkward math. A few things you can do:
              <ul style="padding-left:18px;margin:12px 0;color:#57534e;">
                <li>Create a group and add people — even friends who aren't on the app yet.</li>
                <li>Split equally, by exact amounts, or by percentage.</li>
                <li>See who owes whom, and settle up in a tap.</li>
                <li>Add expenses offline — they sync when you're back online.</li>
              </ul>
            </td></tr>
            <tr><td align="center" style="padding-bottom:8px;">
              <a href="${APP_URL}" style="background:#4f46e5;color:#fff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 28px;border-radius:12px;display:inline-block;">
                Open Splitab
              </a>
            </td></tr>
          </table>
          <table width="100%" style="max-width:460px;padding-top:16px;">
            <tr><td align="center" style="font-size:11px;color:#a8a29e;">
              Happy splitting — the Splitab app.
            </td></tr>
          </table>
        </td></tr>
      </table>`;

    // Brevo first, Resend if Brevo is unavailable or errors.
    const result = await sendEmail(email, subject, html);

    if (!result.ok) {
      return json({ error: "Could not send welcome email.", detail: result.detail }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
