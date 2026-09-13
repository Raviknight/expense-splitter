// send-invite — Supabase Edge Function
// ----------------------------------------------------------------------------
// Sends a "you've been invited to Splitab" email, from hello@splitab.app, via
// Resend. Used by the app's "Invite by email" button on a ghost member.
//
// Why this runs on the server (not in the app): it uses the secret RESEND_API_KEY,
// which must never be exposed in the public browser bundle. Edge Functions keep
// secrets safe.
//
// DEPLOY (Supabase dashboard → Edge Functions):
//   1. Create a new function named exactly  send-invite
//   2. Paste this file's contents and Deploy.
//   3. Add a secret:  RESEND_API_KEY = <your re_… key>  (Edge Functions → Secrets)
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.
// ----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const APP_URL = "https://splitab.app/";
const FROM    = "Splitab <hello@splitab.app>"; // must be on your Resend-verified domain

// Allow the browser app to call this function.
// Origins allowed to call this from a browser. Was "*", which let any website
// trigger an invite email using a signed-in user's token — a way to send mail
// from your verified domain without the user realising, which is how a sending
// reputation gets destroyed. CORS is a browser control only; the auth check
// remains the real protection.
const ALLOWED_ORIGINS = [
  "https://splitab.app",
  "http://localhost:5173",   // local dev server
];
function corsFor(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// `cors` is set per-request so the echoed Origin is correct.
let cors: Record<string, string> = CORS;
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req) => {
  // Browser pre-flight check.
  cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    if (!RESEND_API_KEY) return json({ error: "Server missing RESEND_API_KEY secret" }, 500);

    // 1) Confirm the caller is a signed-in Splitab user (uses their token).
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "You must be signed in." }, 401);

    // 2) Read + validate input.
    const { email, groupName, inviterName, groupId, ghostMemberId } =
      await req.json().catch(() => ({}));
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "A valid email address is required." }, 400);
    }

    const inviter = (inviterName || user.email || "A friend").toString();
    const subject = `${inviter} invited you to split expenses on Splitab`;

    // Invites now arrive from TWO places, and only one of them has a group:
    //   • a ghost member inside a group  → groupName is set
    //   • Connections, person-to-person  → no group at all
    // groupName used to default to the literal string "a group", so a
    // connection invite claimed "added you to a group" when no group existed.
    // Saying something untrue in the first email a stranger receives is exactly
    // how mail gets reported as spam.
    const group    = (groupName || "").toString().trim();
    const hasGroup = group.length > 0;
    const intro = hasGroup
      ? `<strong>${escapeHtml(inviter)}</strong> added you to <strong>${escapeHtml(group)}</strong> and wants to split expenses with you. Sign up (free) to see what you're owed and settle up easily.`
      : `<strong>${escapeHtml(inviter)}</strong> wants to split expenses with you on Splitab. Sign up (free) to share costs and settle up easily.`;

    // 3) Create an invite token so the app can auto-connect them on signup
    //    (db/09 invites table + accept_invite function). The link carries the
    //    token; when they open it signed in, the app calls accept_invite(token).
    const token = crypto.randomUUID();
    const { error: invErr } = await supabase.from("invites").insert({
      token,
      inviter: user.id,
      email: String(email).toLowerCase(),
      group_id: groupId ?? null,
      ghost_member_id: ghostMemberId ?? null,
    });
    if (invErr) {
      // Most likely the invites table doesn't exist yet (db/09 not run).
      return json({ error: "Invite setup incomplete — run db/09_invites.sql in Supabase.", detail: invErr.message }, 500);
    }
    const inviteLink = `${APP_URL}?invite=${token}`;

    const html = `
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF7;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
        <tr><td align="center">
          <table width="100%" style="max-width:460px;background:#fff;border:1px solid #e7e5e4;border-radius:16px;padding:32px;">
            <tr><td align="center" style="padding-bottom:16px;">
              <div style="width:48px;height:48px;background:#1c1917;border-radius:12px;display:inline-block;line-height:48px;color:#818cf8;font-size:26px;font-weight:700;font-family:Georgia,serif;">S</div>
            </td></tr>
            <tr><td align="center" style="font-size:20px;font-weight:600;color:#1c1917;padding-bottom:8px;">
              You're invited to Splitab
            </td></tr>
            <tr><td align="center" style="font-size:14px;color:#78716c;line-height:1.6;padding-bottom:24px;">
              ${intro}
            </td></tr>
            <tr><td align="center" style="padding-bottom:24px;">
              <a href="${inviteLink}" style="background:#4f46e5;color:#fff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 28px;border-radius:12px;display:inline-block;">
                Join on Splitab
              </a>
            </td></tr>
            <tr><td align="center" style="font-size:12px;color:#a8a29e;line-height:1.5;">
              Or open this link: <span style="color:#78716c;word-break:break-all;">${inviteLink}</span>
            </td></tr>
          </table>
          <table width="100%" style="max-width:460px;padding-top:16px;">
            <tr><td align="center" style="font-size:11px;color:#a8a29e;">
              You received this because someone invited you to Splitab. If it wasn't expected, you can ignore it.
            </td></tr>
          </table>
        </td></tr>
      </table>`;

    // 3) Send via Resend.
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
      return json({ error: "Could not send the invite email.", detail }, 502);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
