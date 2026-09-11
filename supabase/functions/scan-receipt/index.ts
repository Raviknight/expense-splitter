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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "You must be signed in." }, 401);

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
    return json({ ok: true, expenses: normalize(rows), unreadable });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
