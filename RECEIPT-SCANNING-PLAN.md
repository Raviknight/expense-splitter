# Phase 3 plan — Scan receipts & statements (AI vision)

Goal: let the user photograph a receipt, or upload a statement image/PDF, and have the app
**extract the expenses automatically** instead of typing them — then review them in the
existing CSV-import preview before saving.

## Why a server-side function is required

Extraction uses the Anthropic (Claude) API, which needs a secret API key. That key must
**never** ship in the public browser bundle. So the call runs in a **Supabase Edge Function**
(Deno, server-side), where the key is a protected secret. The browser only ever talks to our
own function.

## Architecture

```
Browser (ImportModal: "Scan a receipt / statement")
  → uploads the image or PDF (base64) to:
Supabase Edge Function  `extract-expenses`
  → verifies the caller's Supabase auth token (only signed-in users)
  → calls the Anthropic API with the file + a strict "extract expenses as JSON" prompt
  → returns a clean JSON array: [{ date, description, amount, category? }, ...]
Browser
  → feeds those rows into the EXISTING ImportModal preview (reuse buildExpenses-style flow)
  → user reviews/edits → confirms → store.importExpenses(activeGroupId, rows, ...)
```

This reuses the import preview we already built, so the only new surface is the scan step.

## Model & file handling

- **Model:** start with a fast, low-cost vision-capable Claude model (e.g. `claude-haiku-4-5`)
  and only escalate to a larger model for hard/blurry scans. (Verify current model IDs and
  pricing against the Claude API reference before building.)
- **Images** (JPG/PNG/HEIC): sent as an image content block.
- **PDFs:** the Anthropic API accepts PDFs directly as a document content block — no client-side
  PDF-to-image conversion needed.
- **Prompt:** instruct the model to return ONLY a JSON array of expenses with normalized
  `date` (YYYY-MM-DD), `description`, positive `amount`, and an optional `category`; ignore
  totals/subtotals/tax lines unless useful; flag low-confidence rows.

## Rough cost & effort

- **Cost:** a single receipt is a small image (~a couple thousand input tokens) plus a short
  JSON response — on a small model this is a fraction of a cent per scan. A multi-page statement
  costs more (more pages = more tokens) but is still cents, not dollars. Confirm with current
  pricing.
- **Effort:** moderate. New pieces: one Edge Function, one secret (`ANTHROPIC_API_KEY`), a file
  picker + "Scan" path in `ImportModal`, and the result→preview mapping. No schema change.

## Build steps (when we do it)

1. `supabase functions new extract-expenses`; implement auth check + Anthropic call + JSON parse.
2. `supabase secrets set ANTHROPIC_API_KEY=...`; deploy the function.
3. Client: add a "Scan receipt / statement" entry in `ImportModal` (image/PDF picker → call the
   function → map rows into the existing preview).
4. Reuse `importExpenses` to save the confirmed rows.
5. Add light guardrails: max file size, a friendly error if extraction returns nothing,
   and a per-user rate limit in the function.

## Open decisions for later

- Which model tier by default (cost vs accuracy).
- Whether to store the original image (Supabase Storage) for reference, or discard after parsing
  (privacy-friendlier).
- A monthly scan cap to bound cost.
