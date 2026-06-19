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
//   2. Secrets: RESEND_API_KEY = <your re_… key>  (reuse the same Resend key).
//      Optional: WEBHOOK_SECRET = <any random string> for extra safety.
//   3. Database → Webhooks → Create a new hook:
//        - Table: public.profiles, Events: INSERT
//        - Type: Supabase Edge Functions → pick `send-welcome`
//        - (Optional) add an HTTP header  x-webhook-secret: <same WEBHOOK_SECRET>
// ----------------------------------------------------------------------------

const RESEND_API_KEY  = Deno.env.get("RESEND_API_KEY");
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    if (!RESEND_API_KEY) return json({ error: "Server missing RESEND_API_KEY secret" }, 500);

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

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [email], subject, html }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: "Could not send welcome email.", detail }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
