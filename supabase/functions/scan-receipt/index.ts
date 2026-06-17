// scan-receipt — Supabase Edge Function
// ----------------------------------------------------------------------------
// Takes a receipt/statement IMAGE or PDF (base64) and returns the expenses it
// finds, as JSON, by asking Google Gemini's vision model. The app then shows
// those rows in the existing import preview for review before saving.
//
// Why server-side: it uses the secret GEMINI_API_KEY, which must never appear
// in the public browser bundle.
//
// DEPLOY (Supabase dashboard → Edge Functions):
//   1. Create a function named exactly  scan-receipt , paste this, Deploy.
//   2. Add secret:  GEMINI_API_KEY = <your AI Studio key>
//      (optional)   GEMINI_MODEL   = gemini-2.0-flash   ← override if needed
// Get a free key at https://aistudio.google.com  →  "Get API key".
// ----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_API_KEY    = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL      = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// The instruction we give the model. We force JSON output (responseMimeType)
// so we can parse it reliably.
const PROMPT = `You are an expense extractor for a bill-splitting app.
From the attached receipt or bank/card statement, extract each real purchase as an expense.
Rules:
- Return ONLY a JSON array. Each element: {"date":"YYYY-MM-DD","description":"string","amount":number,"category":"string"}.
- amount must be a positive number (no currency symbols).
- Ignore subtotals, taxes, tips, balances, and running totals UNLESS the document only shows a single total (then return that one).
- For an itemized receipt, prefer the line items; if not itemized, return one expense using the merchant name as description and the final total as amount.
- If a transaction's date is not visible, use the document/receipt date; if none, use an empty string.
- category: a short guess like Groceries, Restaurants, Fuel, Lodging, Transportation, Shopping, or Other.
Return [] if you find no purchases.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    if (!GEMINI_API_KEY) return json({ error: "Server missing GEMINI_API_KEY secret" }, 500);

    // 1) Require a signed-in Splitab user.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "You must be signed in." }, 401);

    // 2) Read the file (base64) + its type.
    const { fileBase64, mimeType } = await req.json().catch(() => ({}));
    if (!fileBase64 || !mimeType) {
      return json({ error: "Send { fileBase64, mimeType }." }, 400);
    }
    // Basic guardrail: cap at ~8 MB of base64 (~6 MB file).
    if (fileBase64.length > 8_500_000) {
      return json({ error: "File is too large. Try a smaller image or a single page." }, 413);
    }

    // 3) Ask Gemini, forcing a JSON-array response.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [{
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: fileBase64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: "The scanning service returned an error.", detail }, 502);
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    // 4) Parse the model's JSON. Be defensive — strip stray code fences if any.
    let expenses: unknown = [];
    try {
      const cleaned = String(text).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      expenses = JSON.parse(cleaned);
    } catch {
      return json({ error: "Could not read the scan result. Try a clearer photo." }, 422);
    }
    if (!Array.isArray(expenses)) expenses = [];

    // 5) Light normalization so the app gets clean rows.
    const out = (expenses as any[]).map((e) => ({
      date: typeof e?.date === "string" ? e.date : "",
      description: String(e?.description ?? "").trim() || "Scanned expense",
      amount: Math.abs(Number(e?.amount)) || 0,
      category: String(e?.category ?? "Other").trim() || "Other",
    })).filter((e) => e.amount > 0);

    return json({ ok: true, expenses: out });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
