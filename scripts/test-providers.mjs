// scripts/test-providers.mjs
// Verify each AI provider (OpenRouter → Groq → Gemini) works BEFORE you wire it
// into the scan-receipt Edge Function.
//
// 1. Create a file called  .env.providers  in the project root (it's gitignored):
//
//      OPENROUTER_API_KEY=sk-or-...
//      OPENROUTER_VISION_MODEL=meta-llama/llama-3.2-11b-vision-instruct:free
//      OPENROUTER_TEXT_MODEL=meta-llama/llama-3.3-70b-instruct:free
//      GROQ_API_KEY=gsk_...
//      GROQ_VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
//      GROQ_TEXT_MODEL=llama-3.3-70b-versatile
//      GEMINI_API_KEY=...
//      GEMINI_MODEL=gemini-2.0-flash
//
//    (Only fill the providers you want to test. Models are optional — defaults below.)
//
// 2. Run:  node scripts/test-providers.mjs
//    It prints PASS/FAIL for each provider's TEXT and VISION endpoints, with the
//    real error if something's wrong (bad key, decommissioned model, etc.).

import { readFileSync, existsSync } from 'node:fs';

// --- tiny .env.providers loader (no dependency) ---
const envPath = new URL('../.env.providers', import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].trim();
  }
}
const E = (k, d) => process.env[k] || d;

// 1x1 PNG — enough to confirm a vision endpoint accepts an image request.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function oai(url, key, model, messages, extra = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify({ model, temperature: 0, messages, max_tokens: 50 }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  return t.slice(0, 60);
}
async function gem(model, key, parts) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  return t.slice(0, 60);
}

const OR = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const ORH = { 'HTTP-Referer': 'https://splitab.app', 'X-Title': 'Splitab' };
const imgMsg = [{ role: 'user', content: [{ type: 'text', text: 'What is in this image? Reply in 3 words.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG}` } }] }];
const txtMsg = [{ role: 'user', content: 'Reply with the single word: OK' }];

async function run(label, fn) {
  if (!fn) return `—`;
  try { await fn(); return 'PASS'; }
  catch (e) { return `FAIL (${e.message})`; }
}

const providers = [
  {
    name: 'OpenRouter',
    on: !!process.env.OPENROUTER_API_KEY,
    text: () => oai(OR, E('OPENROUTER_API_KEY'), E('OPENROUTER_TEXT_MODEL', 'meta-llama/llama-3.3-70b-instruct:free'), txtMsg, ORH),
    vision: () => oai(OR, E('OPENROUTER_API_KEY'), E('OPENROUTER_VISION_MODEL', 'meta-llama/llama-3.2-11b-vision-instruct:free'), imgMsg, ORH),
  },
  {
    name: 'Groq',
    on: !!process.env.GROQ_API_KEY,
    text: () => oai(GROQ, E('GROQ_API_KEY'), E('GROQ_TEXT_MODEL', 'llama-3.3-70b-versatile'), txtMsg),
    vision: () => oai(GROQ, E('GROQ_API_KEY'), E('GROQ_VISION_MODEL', 'meta-llama/llama-4-scout-17b-16e-instruct'), imgMsg),
  },
  {
    name: 'Gemini',
    on: !!process.env.GEMINI_API_KEY,
    text: () => gem(E('GEMINI_MODEL', 'gemini-2.0-flash'), E('GEMINI_API_KEY'), [{ text: 'Reply with the single word: OK' }]),
    vision: () => gem(E('GEMINI_MODEL', 'gemini-2.0-flash'), E('GEMINI_API_KEY'), [{ text: 'What is in this image? 3 words.' }, { inline_data: { mime_type: 'image/png', data: TINY_PNG } }]),
  },
];

console.log('\nTesting AI providers (fallback order: OpenRouter → Groq → Gemini)\n');
for (const p of providers) {
  if (!p.on) { console.log(`• ${p.name.padEnd(11)} — no key set (skipped)`); continue; }
  const text = await run('text', p.text);
  const vision = await run('vision', p.vision);
  console.log(`• ${p.name.padEnd(11)} TEXT: ${text}`);
  console.log(`  ${''.padEnd(11)} VISION: ${vision}`);
}
console.log('\nA provider needs at least one PASS to be useful. Set the working keys/models');
console.log('as scan-receipt secrets, then deploy the function.\n');
