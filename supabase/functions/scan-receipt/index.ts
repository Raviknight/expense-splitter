// scan-receipt — Supabase Edge Function (multi-provider fallback)
// ----------------------------------------------------------------------------
// Turns a receipt/statement IMAGE or PDF into expense rows, trying providers in
// order so a single one being down/rate-limited doesn't break scanning:
//        OpenRouter  →  Groq  →  Gemini
// (Only providers whose API key is set are attempted.)
//   • IMAGE → a vision model.
//   • PDF   → we extract the text OURSELVES (unpdf, free), then a TEXT model.
// The model flags low-confidence rows ("uncertain") and an unreadable file
// ("unreadable"). Returns { ok, expenses, unreadable }.
//
// IMPORTANT: verify each provider FIRST with `node scripts/test-providers.mjs`
// (fill scripts-friendly keys in .env.providers) before relying on them here.
//
// DEPLOY (Edge Functions → scan-receipt). Secrets (set the ones you use):
//   OPENROUTER_API_KEY  (primary)   + optional OPENROUTER_VISION_MODEL / OPENROUTER_TEXT_MODEL
//   GROQ_API_KEY        (fallback)  + optional GROQ_VISION_MODEL / GROQ_TEXT_MODEL
//   GEMINI_API_KEY      (fallback)  + optional GEMINI_MODEL
// ----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const OPENROUTER_API_KEY    = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_VISION     = Deno.env.get("OPENROUTER_VISION_MODEL") || "meta-llama/llama-3.2-11b-vision-instruct:free";
const OPENROUTER_TEXT       = Deno.env.get("OPENROUTER_TEXT_MODEL")   || "meta-llama/llama-3.3-70b-instruct:free";
const GROQ_API_KEY          = Deno.env.get("GROQ_API_KEY");
const GROQ_VISION           = Deno.env.get("GROQ_VISION_MODEL") || "meta-llama/llama-4-scout-17b-16e-instruct";
const GROQ_TEXT             = Deno.env.get("GROQ_TEXT_MODEL")   || "llama-3.3-70b-versatile";
const GEMINI_API_KEY        = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL          = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";

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

// OpenAI-compatible chat (works for OpenRouter AND Groq).
async function oai(baseUrl: string, key: string, model: string, messages: unknown[], extra: Record<string,string> = {}): Promise<string> {
  const resp = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra },
    body: JSON.stringify({ model, temperature: 0, messages }),
  });
  if (!resp.ok) throw new Error(`${baseUrl.includes("openrouter") ? "OpenRouter" : "Groq"}: ${(await resp.text()).slice(0, 250)}`);
  return (await resp.json())?.choices?.[0]?.message?.content ?? "{}";
}
async function gemini(parts: unknown[]): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
  });
  if (!resp.ok) throw new Error(`Gemini: ${(await resp.text()).slice(0, 250)}`);
  return (await resp.json())?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OR_HEADERS = { "HTTP-Referer": "https://splitab.app", "X-Title": "Splitab" };
const visionMsg = (b64: string, mt: string) => [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: `data:${mt};base64,${b64}` } }] }];
const textMsg   = (t: string) => [{ role: "system", content: PROMPT }, { role: "user", content: t }];

// Try each configured provider in order; return the first success.
async function tryChain(attempts: Array<() => Promise<string>>): Promise<string> {
  let lastErr: unknown = new Error("No AI provider is configured. Set OPENROUTER_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY.");
  for (const fn of attempts) {
    try { return await fn(); } catch (e) { lastErr = e; }
  }
  throw lastErr;
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
      const attempts: Array<() => Promise<string>> = [];
      if (OPENROUTER_API_KEY) attempts.push(() => oai(OR_URL, OPENROUTER_API_KEY, OPENROUTER_VISION, m, OR_HEADERS));
      if (GROQ_API_KEY)       attempts.push(() => oai(GROQ_URL, GROQ_API_KEY, GROQ_VISION, m));
      if (GEMINI_API_KEY)     attempts.push(() => gemini([{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: fileBase64 } }]));
      content = await tryChain(attempts);

    } else if (mimeType === "application/pdf") {
      let text = "";
      try {
        const { extractText, getDocumentProxy } = await import("https://esm.sh/unpdf");
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
      const attempts: Array<() => Promise<string>> = [];
      if (OPENROUTER_API_KEY) attempts.push(() => oai(OR_URL, OPENROUTER_API_KEY, OPENROUTER_TEXT, m, OR_HEADERS));
      if (GROQ_API_KEY)       attempts.push(() => oai(GROQ_URL, GROQ_API_KEY, GROQ_TEXT, m));
      if (GEMINI_API_KEY)     attempts.push(() => gemini([{ text: `${PROMPT}\n\nDOCUMENT TEXT:\n${clipped}` }]));
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
