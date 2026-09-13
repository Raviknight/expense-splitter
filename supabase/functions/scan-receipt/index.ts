// scan-receipt — Supabase Edge Function (multi-provider fallback)
// ----------------------------------------------------------------------------
// Turns a receipt/statement IMAGE or PDF into expense rows.
//   • IMAGE → a vision model.
//   • PDF   → we extract the text OURSELVES (unpdf, free), then a TEXT model.
// The model flags low-confidence rows ("uncertain") and an unreadable file
// ("unreadable"). Returns { ok, expenses, unreadable }.
//
// RELIABILITY — why this is shaped the way it is:
//   Scanning used to break every few months because each provider was pinned to
//   ONE free-tier model, and free/preview models are exactly the ones that get
//   renamed, retired and rate-limited without notice. Two layers now absorb that:
//
//     1. Each provider takes a LIST of candidate models, not one. OpenRouter
//        accepts the whole list in a single request and fails over internally
//        (rate-limit, downtime, moderation, context errors), billing only the
//        model that actually ran. Groq has no such feature, so we walk its list
//        ourselves.
//     2. Providers are still tried in order: OpenRouter → Groq.
//
//   So a retired model is no longer an outage, and swapping models is a SECRET
//   change (comma-separated list) — no code edit, no redeploy.
//
//   The defaults below are cheap PAID models on purpose. At roughly 1.8k input
//   + 300 output tokens per receipt, a scan costs ~$0.0003 (about 3,000 scans
//   per dollar). Paid models are versioned and deprecated on a published
//   schedule; free ones just vanish. Groq's free tier stays as a safety net.
//
// IMPORTANT: verify each provider FIRST with `node scripts/test-providers.mjs`
// (fill scripts-friendly keys in .env.providers) before relying on them here.
// A scheduled GitHub Actions job runs that same script weekly, so a dead model
// shows up as a red CI run instead of a user-reported bug.
//
// DEPLOY (Edge Functions → scan-receipt). Secrets (set the ones you use):
//   OPENROUTER_API_KEY  (primary)   + optional OPENROUTER_VISION_MODELS / OPENROUTER_TEXT_MODELS
//   GROQ_API_KEY        (fallback)  + optional GROQ_VISION_MODELS / GROQ_TEXT_MODELS
//   (…_MODELS take a comma-separated list, tried in order. The older singular
//    …_MODEL names are still honoured so existing deployments keep working.)
// ----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ── Scan quota ───────────────────────────────────────────────────────────────
// Enforced HERE, in the function, and nowhere else. A limit in App.jsx would be
// decorative: the anon key is public (it ships in the browser bundle), so anyone
// can call this endpoint directly and skip the UI entirely.
//
// SCAN_LIMIT_ENABLED lets counting run before enforcing starts. Usage accrues
// from day one, so real numbers are available to pick a sensible free tier,
// while nobody is blocked yet. Flip to "true" when ready — same dormant-gate
// pattern as PREMIUM_ENFORCED in App.jsx.
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SCAN_LIMIT_ENABLED   = Deno.env.get("SCAN_LIMIT_ENABLED") === "true";
const FREE_SCANS_PER_MONTH = Number(Deno.env.get("FREE_SCANS_PER_MONTH") || "20");

// Premium is a HIGHER cap, not an unlimited one. Every scan costs real money at
// the provider, so "unlimited" would mean one runaway loop on a paid account
// could spend without bound. 500/month is far beyond normal use — the honest
// version of unlimited is "a limit you will not reach, and we tell you where it
// is". Extra scans bought on top are added via scan_usage.bonus_scans (db/18).
const PREMIUM_SCANS_PER_MONTH = Number(Deno.env.get("PREMIUM_SCANS_PER_MONTH") || "500");

// ── Burst cap ────────────────────────────────────────────────────────────────
// The monthly quota bounds total damage but not SPEED: a script could spend a
// whole month's allowance in seconds. This applies to EVERYONE, premium
// included, because it exists to stop runaway loops and abuse rather than to
// ration a plan. Nobody scans 8 receipts in a minute by hand.
//
// Unlike the monthly cap this is NOT gated behind SCAN_LIMIT_ENABLED — that
// flag delays *rationing* while real usage accrues, whereas a runaway loop is
// never acceptable and costs money the moment it happens.
const BURST_WINDOW_MS = 60_000;
const BURST_MAX       = Number(Deno.env.get("SCAN_BURST_PER_MINUTE") || "8");

// Parse a comma-separated model list, dropping blanks/stray spaces.
const list = (v: string | undefined, fallback: string): string[] =>
  (v || fallback).split(",").map((s) => s.trim()).filter(Boolean);

// Candidate models per provider, in preference order. Vendor-diverse on purpose:
// if Google has a bad day the next pick is OpenAI, then Qwen — an outage at one
// vendor shouldn't take out every option.
const DEFAULT_MODELS = "google/gemini-2.5-flash-lite,openai/gpt-5-nano,qwen/qwen3.7-flash";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_VISION  = list(
  Deno.env.get("OPENROUTER_VISION_MODELS") ?? Deno.env.get("OPENROUTER_VISION_MODEL"),
  DEFAULT_MODELS,
);
const OPENROUTER_TEXT = list(
  Deno.env.get("OPENROUTER_TEXT_MODELS") ?? Deno.env.get("OPENROUTER_TEXT_MODEL"),
  DEFAULT_MODELS,
);

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const GROQ_VISION  = list(
  Deno.env.get("GROQ_VISION_MODELS") ?? Deno.env.get("GROQ_VISION_MODEL"),
  "meta-llama/llama-4-scout-17b-16e-instruct",
);
const GROQ_TEXT = list(
  Deno.env.get("GROQ_TEXT_MODELS") ?? Deno.env.get("GROQ_TEXT_MODEL"),
  "llama-3.3-70b-versatile",
);

// Origins allowed to call this function from a browser.
//
// Was "*", which let ANY website invoke it. That matters here because a signed-in
// user's browser will happily attach their token: a malicious page could spend
// this user's scan quota (and the account's real AI credit) without them
// noticing. An allowlist costs nothing and removes that.
//
// CORS is a browser control, not a server one — it does not stop a script
// calling the endpoint directly. The real protections remain the auth check and
// the per-user quota below; this just closes the drive-by case.
const ALLOWED_ORIGINS = [
  "https://splitab.app",
  "http://localhost:5173",   // local dev server
];
function corsFor(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    // Responses differ per origin, so caches must key on it.
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
// `cors` is set per-request in the handler so the echoed Origin is correct.
let cors: Record<string, string> = CORS;
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const PROMPT = `You extract expenses from a receipt or bank/card statement for a bill-splitting app.
Return ONLY a JSON object: {"expenses":[{"date":"YYYY-MM-DD","description":"string","amount":number,"category":"string","uncertain":boolean,"note":"string"}]}.
Rules:
- amount is a positive number (no currency symbols).
- Ignore subtotals/taxes/tips/balances/running totals UNLESS the document only shows a single total.
- Itemized receipt: prefer line items; otherwise one expense (merchant as description, final total as amount).
- Missing date → use the document date; if none, "".
- category: short guess (Groceries, Restaurants, Fuel, Lodging, Transportation, Shopping, Other).
- uncertain: true for any row that was illegible/blurry/low-confidence (put a short reason in note); else false.
- Return {"expenses":[]} if no purchases, and {"expenses":[],"unreadable":true} if too unclear to read at all.`;

function parseResult(content: string): { rows: any[]; unreadable: boolean } {
  try {
    const cleaned = String(content).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const obj = JSON.parse(cleaned);
    const rows = Array.isArray(obj) ? obj : (obj?.expenses ?? []);
    return { rows: Array.isArray(rows) ? rows : [], unreadable: obj?.unreadable === true };
  } catch {
    return { rows: [], unreadable: false };
  }
}
function normalize(rows: any[]) {
  return rows.map((e) => ({
    date: typeof e?.date === "string" ? e.date : "",
    description: String(e?.description ?? "").trim() || "Scanned expense",
    amount: Math.abs(Number(e?.amount)) || 0,
    category: String(e?.category ?? "Other").trim() || "Other",
    uncertain: e?.uncertain === true,
    note: String(e?.note ?? "").trim(),
  })).filter((e) => e.amount > 0);
}

const pickContent = (data: any): string =>
  data?.choices?.[0]?.message?.content ?? "{}";

// OpenRouter: send the WHOLE candidate list in one request. OpenRouter picks the
// first model that works, falling back on rate-limiting, provider downtime,
// moderation rejections and context-length errors — and bills only the model
// that actually ran (returned in the response's `model` field).
async function openrouter(models: string[], messages: unknown[]): Promise<string> {
  const resp = await fetch(OR_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      ...OR_HEADERS,
    },
    body: JSON.stringify({ models, temperature: 0, messages }),
  });
  if (!resp.ok) {
    throw new Error(`tried [${models.join(", ")}] → ${(await resp.text()).slice(0, 250)}`);
  }
  return pickContent(await resp.json());
}

// Groq is OpenAI-compatible but has NO models-array fallback, so we walk the
// list ourselves and keep the first success. Every failure is recorded, so a
// dead model names itself rather than hiding behind the next one.
async function groq(models: string[], messages: unknown[]): Promise<string> {
  const failures: string[] = [];
  for (const model of models) {
    try {
      const resp = await fetch(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0, messages }),
      });
      if (!resp.ok) throw new Error((await resp.text()).slice(0, 200));
      return pickContent(await resp.json());
    } catch (e) {
      failures.push(`${model} → ${String((e as Error)?.message ?? e)}`);
    }
  }
  throw new Error(failures.join(" ; "));
}

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OR_HEADERS = { "HTTP-Referer": "https://splitab.app", "X-Title": "Splitab" };
const visionMsg = (b64: string, mt: string) => [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: `data:${mt};base64,${b64}` } }] }];
const textMsg   = (t: string) => [{ role: "system", content: PROMPT }, { role: "user", content: t }];

// One provider attempt: a label (so an error can say WHICH provider failed)
// plus the call itself.
type Attempt = { name: string; run: () => Promise<string> };

// Try each configured provider in order; return the first success.
//
// WHY every failure is collected instead of just the last one:
//   This used to keep only `lastErr`, so an earlier provider's failure was
//   silently overwritten by whatever the NEXT one said. With a dead provider
//   sitting last in the chain, every failure looked like that provider's fault
//   — even when the real cause was a missing key further up. The reported error
//   named the wrong thing and sent debugging the wrong way.
//   Now the thrown message lists every provider tried and why each one failed.
async function tryChain(attempts: Attempt[]): Promise<string> {
  if (attempts.length === 0) {
    throw new Error(
      "No AI provider is configured. Set OPENROUTER_API_KEY or GROQ_API_KEY.",
    );
  }
  const failures: string[] = [];
  for (const { name, run } of attempts) {
    try {
      return await run();
    } catch (e) {
      failures.push(`${name} → ${String((e as Error)?.message ?? e)}`);
    }
  }
  throw new Error(
    `All ${attempts.length} AI provider(s) failed. ${failures.join("  |  ")}`,
  );
}

// Read the caller's quota, rolling the period forward if the month changed.
// Uses the SERVICE ROLE client because scan_usage grants no write access to
// users — that is the whole point of the table (see db/16).
// Returns null when quota can't be evaluated, which callers treat as "allow".
async function getQuota(admin: any, userId: string) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const period = monthStart.toISOString().slice(0, 10);   // YYYY-MM-01

  // burst_* and bonus_scans arrive with db/18. Select them separately so a
  // project that hasn't run it yet still gets the monthly quota rather than
  // failing the whole lookup on an unknown column.
  let data: any = null;
  const full = await admin
    .from("scan_usage")
    .select("used, period_start, burst_start, burst_count, bonus_scans")
    .eq("user_id", userId)
    .maybeSingle();
  if (full.error) {
    const basic = await admin
      .from("scan_usage")
      .select("used, period_start")
      .eq("user_id", userId)
      .maybeSingle();
    if (basic.error) return null;
    data = basic.data;
  } else {
    data = full.data;
  }

  const now = Date.now();
  const burstStart = data?.burst_start ? new Date(data.burst_start).getTime() : 0;
  const burstFresh = burstStart > 0 && (now - burstStart) < BURST_WINDOW_MS;

  // No row yet, or the stored period is an earlier month → this month is fresh.
  // Rolling forward here means quotas reset without needing a scheduled job.
  const newMonth = !data || String(data.period_start) < period;

  return {
    period,
    used:  newMonth ? 0 : (Number(data.used) || 0),
    bonus: Number(data?.bonus_scans) || 0,
    // An expired window counts as zero — same lazy roll-forward as the month.
    burstCount: burstFresh ? (Number(data.burst_count) || 0) : 0,
    burstStart: burstFresh ? burstStart : 0,
  };
}

type Quota = NonNullable<Awaited<ReturnType<typeof getQuota>>>;

// Record one unit of usage. One unit per FILE — never per PDF page (a 50-page
// PDF costs the same as a 3-page one, since the text is clipped at 24k chars).
async function recordUsage(admin: any, userId: string, quota: Quota) {
  const now = Date.now();
  // Starting a new window when the old one lapsed is what makes the cap a
  // ROLLING limit rather than a permanent one.
  const windowLive = quota.burstStart > 0 && (now - quota.burstStart) < BURST_WINDOW_MS;

  const row: Record<string, unknown> = {
    user_id:      userId,
    period_start: quota.period,
    used:         quota.used + 1,
    updated_at:   new Date().toISOString(),
  };

  // Only written when db/18 has been run; a missing column would reject the
  // whole upsert and cost the user their scan result.
  try {
    row.burst_start = new Date(windowLive ? quota.burstStart : now).toISOString();
    row.burst_count = windowLive ? quota.burstCount + 1 : 1;
    const { error } = await admin.from("scan_usage").upsert(row, { onConflict: "user_id" });
    if (!error) return;
  } catch (_) { /* fall through */ }

  delete row.burst_start;
  delete row.burst_count;
  await admin.from("scan_usage").upsert(row, { onConflict: "user_id" });
}

Deno.serve(async (req) => {
  cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "You must be signed in." }, 401);

    // ── Quota check (before doing any paid work) ─────────────────────────────
    // Deliberately BEFORE the AI call: checking afterwards would still cost a
    // request to the provider, so an over-quota user could burn real money.
    const admin = SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
    let quota: Quota | null = null;
    // Hoisted so the SUCCESS response can report the caller's real allowance.
    // It previously echoed FREE_SCANS_PER_MONTH unconditionally, which would
    // have told a premium user "3 of 20 left" while the server allowed 500.
    let monthlyLimit = FREE_SCANS_PER_MONTH;

    if (admin) {
      // Premium is read with the ADMIN client: a user can update their own
      // profiles row, but is_premium is not writable through the API by them
      // (no policy grants it), so this value is trustworthy here.
      const { data: prof } = await admin
        .from("profiles").select("is_premium").eq("id", user.id).maybeSingle();
      const isPremium = prof?.is_premium === true;

      quota = await getQuota(admin, user.id);

      // 1. BURST first, and for everyone. Always on, regardless of
      //    SCAN_LIMIT_ENABLED: that flag delays rationing while usage data
      //    accrues, but a runaway loop is never acceptable and spends money
      //    the moment it starts. 429 = Too Many Requests, i.e. "slow down",
      //    which is a different remedy from "you are out of scans".
      if (quota && quota.burstCount >= BURST_MAX) {
        const waitSec = Math.max(1, Math.ceil((BURST_WINDOW_MS - (Date.now() - quota.burstStart)) / 1000));
        return json({
          error: `Too many scans at once. Try again in ${waitSec} second${waitSec === 1 ? "" : "s"}.`,
          code: "scan_rate_limited",
          retryAfterSeconds: waitSec,
        }, 429);
      }

      // 2. MONTHLY allowance. Premium gets a much higher cap rather than none,
      //    plus any scans bought on top.
      monthlyLimit = (isPremium ? PREMIUM_SCANS_PER_MONTH : FREE_SCANS_PER_MONTH)
        + (quota?.bonus ?? 0);

      if (SCAN_LIMIT_ENABLED && quota && quota.used >= monthlyLimit) {
        // 402 Payment Required — distinguishable from a generic failure so the
        // app can show an upgrade prompt rather than "something went wrong".
        return json({
          error: isPremium
            ? `You've used all ${monthlyLimit} scans this month.`
            : `You've used all ${monthlyLimit} free scans this month.`,
          code: "scan_quota_exceeded",
          used: quota.used,
          limit: monthlyLimit,
          isPremium,
        }, 402);
      }
    }

    const { fileBase64, mimeType } = await req.json().catch(() => ({}));
    if (!fileBase64 || !mimeType) return json({ error: "Send { fileBase64, mimeType }." }, 400);
    if (fileBase64.length > 12_000_000) return json({ error: "File is too large. Try a smaller image or a single page." }, 413);

    let content: string;

    if (String(mimeType).startsWith("image/")) {
      const m = visionMsg(fileBase64, mimeType);
      const attempts: Attempt[] = [];
      if (OPENROUTER_API_KEY) attempts.push({ name: "OpenRouter", run: () => openrouter(OPENROUTER_VISION, m) });
      if (GROQ_API_KEY)       attempts.push({ name: "Groq",       run: () => groq(GROQ_VISION, m) });
      content = await tryChain(attempts);

    } else if (mimeType === "application/pdf") {
      let text = "";
      try {
        // Pinned on purpose: an unpinned esm.sh import silently upgrades, so an
        // upstream breaking release could take out PDF scanning with no change
        // on our side. Bump this deliberately after testing.
        const { extractText, getDocumentProxy } = await import("https://esm.sh/unpdf@1.8.1");
        const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
        const pdf = await getDocumentProxy(bytes);
        const out = await extractText(pdf, { mergePages: true });
        text = (typeof out?.text === "string" ? out.text : Array.isArray(out?.text) ? out.text.join("\n") : "").trim();
      } catch (e) {
        return json({ error: "Could not read this PDF.", detail: String((e as Error)?.message ?? e) }, 422);
      }
      if (text.length < 40) return json({ error: "This PDF looks like scanned images (no selectable text). Try a photo instead." }, 422);

      const clipped = text.slice(0, 24000);
      const m = textMsg(clipped);
      const attempts: Attempt[] = [];
      if (OPENROUTER_API_KEY) attempts.push({ name: "OpenRouter", run: () => openrouter(OPENROUTER_TEXT, m) });
      if (GROQ_API_KEY)       attempts.push({ name: "Groq",       run: () => groq(GROQ_TEXT, m) });
      content = await tryChain(attempts);

    } else {
      return json({ error: "Unsupported file type. Upload an image or a PDF." }, 415);
    }

    const { rows, unreadable } = parseResult(content);

    // Count usage only after a SUCCESSFUL scan. A provider outage or an
    // unreadable file must not cost the user a credit — they got nothing for it.
    // Failures throw before reaching here, so this is the only success path.
    if (admin && quota) {
      // Never let a bookkeeping failure lose the user's scan result.
      try { await recordUsage(admin, user.id, quota); } catch (_) { /* ignore */ }
    }

    return json({
      ok: true,
      expenses: normalize(rows),
      unreadable,
      // Lets the app show "3 of 20 left" without another round trip. Omitted
      // when quota can't be evaluated (e.g. before db/16 is run).
      quota: quota
        ? { used: quota.used + 1, limit: monthlyLimit, enforced: SCAN_LIMIT_ENABLED }
        : undefined,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
