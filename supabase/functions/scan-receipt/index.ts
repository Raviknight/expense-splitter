// scan-receipt — Supabase Edge Function (Groq edition)
// ----------------------------------------------------------------------------
// Turns a receipt/statement IMAGE or PDF into expense rows, cheaply:
//   • IMAGE  → sent to a Groq VISION model.
//   • PDF    → we extract the text OURSELVES (unpdf, free, no API), then send the
//              TEXT to a Groq TEXT model. Text is far cheaper + has roomier free
//              limits than vision, which is the whole money-saving idea.
// Returns { ok, expenses } that flow into the app's existing import preview.
//
// DEPLOY (Supabase dashboard → Edge Functions):
//   1. Create/replace a function named  scan-receipt , paste this, Deploy.
//   2. Secrets: GROQ_API_KEY = <your gsk_… key>.
//      Optional overrides if Groq renames models:
//        GROQ_VISION_MODEL (default: llama-3.2-11b-vision-preview)
//        GROQ_TEXT_MODEL   (default: llama-3.3-70b-versatile)
// Get a free key at https://console.groq.com → API Keys.
// ----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_KEY     = Deno.env.get("GROQ_API_KEY");
const GROQ_VISION_MODEL = Deno.env.get("GROQ_VISION_MODEL") || "meta-llama/llama-4-scout-17b-16e-instruct";
const GROQ_TEXT_MODEL   = Deno.env.get("GROQ_TEXT_MODEL")   || "llama-3.3-70b-versatile";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

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

const PROMPT = `You extract expenses from a receipt or bank/card statement for a bill-splitting app.
Return ONLY a JSON object of the form {"expenses":[{"date":"YYYY-MM-DD","description":"string","amount":number,"category":"string"}]}.
Rules:
- amount is a positive number (no currency symbols).
- Ignore subtotals, taxes, tips, balances and running totals UNLESS the document only shows a single total (then return that one).
- Itemized receipt: prefer the line items; otherwise return one expense (merchant name as description, final total as amount).
- If a transaction's date is missing, use the document date; if none, use "".
- category: a short guess like Groceries, Restaurants, Fuel, Lodging, Transportation, Shopping, or Other.
- Return {"expenses":[]} if there are no purchases.`;

// Pull the model's JSON content out of an OpenAI-style Groq response.
function parseExpenses(content: string): any[] {
  try {
    const cleaned = String(content).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const obj = JSON.parse(cleaned);
    const arr = Array.isArray(obj) ? obj : (obj?.expenses ?? []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function normalize(rows: any[]) {
  return rows.map((e) => ({
    date: typeof e?.date === "string" ? e.date : "",
    description: String(e?.description ?? "").trim() || "Scanned expense",
    amount: Math.abs(Number(e?.amount)) || 0,
    category: String(e?.category ?? "Other").trim() || "Other",
  })).filter((e) => e.amount > 0);
}

async function callGroq(body: Record<string, unknown>) {
  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Groq error: ${detail.slice(0, 400)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "{}";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    if (!GROQ_API_KEY) return json({ error: "Server missing GROQ_API_KEY secret" }, 500);

    // Require a signed-in user.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "You must be signed in." }, 401);

    const { fileBase64, mimeType } = await req.json().catch(() => ({}));
    if (!fileBase64 || !mimeType) return json({ error: "Send { fileBase64, mimeType }." }, 400);
    if (fileBase64.length > 12_000_000) {
      return json({ error: "File is too large. Try a smaller image or a single page." }, 413);
    }

    let content: string;

    if (String(mimeType).startsWith("image/")) {
      // IMAGE → Groq vision model.
      content = await callGroq({
        model: GROQ_VISION_MODEL,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
          ],
        }],
      });

    } else if (mimeType === "application/pdf") {
      // PDF → extract text ourselves, then a cheap Groq text model.
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
      if (text.length < 40) {
        return json({ error: "This PDF looks like scanned images (no selectable text). Try a photo instead." }, 422);
      }
      content = await callGroq({
        model: GROQ_TEXT_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: text.slice(0, 24000) },
        ],
      });

    } else {
      return json({ error: "Unsupported file type. Upload an image or a PDF." }, 415);
    }

    const expenses = normalize(parseExpenses(content));
    return json({ ok: true, expenses });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
