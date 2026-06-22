// scan-receipt — Supabase Edge Function (Groq primary, Gemini fallback)
// ----------------------------------------------------------------------------
// Turns a receipt/statement IMAGE or PDF into expense rows, cheaply + reliably:
//   • IMAGE → a vision model (Groq first; Gemini as fallback if Groq is
//     rate-limited / down).
//   • PDF   → we extract the text OURSELVES (unpdf, free), then a cheap TEXT
//     model (Groq first; Gemini fallback). Text is far cheaper than vision.
// The model also flags low-confidence rows ("uncertain") and signals an
// unreadable file ("unreadable"). Returns { ok, expenses, unreadable }.
//
// DEPLOY (Supabase dashboard → Edge Functions → scan-receipt):
//   Secrets:
//     GROQ_API_KEY      = gsk_…           (primary; required)
//     GEMINI_API_KEY    = …               (optional fallback; from aistudio.google.com)
//   Optional model overrides:
//     GROQ_VISION_MODEL (default meta-llama/llama-4-scout-17b-16e-instruct)
//     GROQ_TEXT_MODEL   (default llama-3.3-70b-versatile)
//     GEMINI_MODEL      (default gemini-2.0-flash)
// ----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_KEY      = Deno.env.get("GROQ_API_KEY");
const GEMINI_API_KEY    = Deno.env.get("GEMINI_API_KEY"); // optional fallback
const GROQ_VISION_MODEL = Deno.env.get("GROQ_VISION_MODEL") || "meta-llama/llama-4-scout-17b-16e-instruct";
const GROQ_TEXT_MODEL   = Deno.env.get("GROQ_TEXT_MODEL")   || "llama-3.3-70b-versatile";
const GEMINI_MODEL      = Deno.env.get("GEMINI_MODEL")      || "gemini-2.0-flash";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const PROMPT = `You extract expenses from a receipt or bank/card statement for a bill-splitting app.
Return ONLY a JSON object of the form {"expenses":[{"date":"YYYY-MM-DD","description":"string","amount":number,"category":"string","uncertain":boolean,"note":"string"}]}.
Rules:
- amount is a positive number (no currency symbols).
- Ignore subtotals, taxes, tips, balances and running totals UNLESS the document only shows a single total (then return that one).
- Itemized receipt: prefer the line items; otherwise return one expense (merchant name as description, final total as amount).
- If a transaction's date is missing, use the document date; if none, use "".
- category: a short guess like Groceries, Restaurants, Fuel, Lodging, Transportation, Shopping, or Other.
- CONFIDENCE: set "uncertain": true for any row where a value was illegible/blurry/low-confidence, with a short reason in "note". Else false.
- Return {"expenses":[]} if no purchases, and {"expenses":[],"unreadable":true} if the file is too unclear to read at all.`;

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

// ─── provider calls ──────────────────────────────────────────────────────────
async function groqChat(body: Record<string, unknown>): Promise<string> {
  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Groq: ${(await resp.text()).slice(0, 300)}`);
  return (await resp.json())?.choices?.[0]?.message?.content ?? "{}";
}

async function geminiGenerate(parts: unknown[]): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
  });
  if (!resp.ok) throw new Error(`Gemini: ${(await resp.text()).slice(0, 300)}`);
  return (await resp.json())?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

// Try Groq first; on ANY failure, fall back to Gemini if its key is set.
async function withFallback(groqFn: () => Promise<string>, geminiFn: () => Promise<string>): Promise<string> {
  try {
    return await groqFn();
  } catch (e1) {
    if (!GEMINI_API_KEY) throw e1;
    try {
      return await geminiFn();
    } catch (e2) {
      throw new Error(`${(e1 as Error).message} || ${(e2 as Error).message}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    if (!GROQ_API_KEY && !GEMINI_API_KEY) return json({ error: "Server missing GROQ_API_KEY (and no GEMINI_API_KEY fallback)" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "You must be signed in." }, 401);

    const { fileBase64, mimeType } = await req.json().catch(() => ({}));
    if (!fileBase64 || !mimeType) return json({ error: "Send { fileBase64, mimeType }." }, 400);
    if (fileBase64.length > 12_000_000) return json({ error: "File is too large. Try a smaller image or a single page." }, 413);

    let content: string;

    if (String(mimeType).startsWith("image/")) {
      content = await withFallback(
        () => groqChat({
          model: GROQ_VISION_MODEL, temperature: 0,
          messages: [{ role: "user", content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
          ] }],
        }),
        () => geminiGenerate([{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: fileBase64 } }]),
      );

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
      content = await withFallback(
        () => groqChat({
          model: GROQ_TEXT_MODEL, temperature: 0, response_format: { type: "json_object" },
          messages: [{ role: "system", content: PROMPT }, { role: "user", content: clipped }],
        }),
        () => geminiGenerate([{ text: `${PROMPT}\n\nDOCUMENT TEXT:\n${clipped}` }]),
      );

    } else {
      return json({ error: "Unsupported file type. Upload an image or a PDF." }, 415);
    }

    const { rows, unreadable } = parseResult(content);
    return json({ ok: true, expenses: normalize(rows), unreadable });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
