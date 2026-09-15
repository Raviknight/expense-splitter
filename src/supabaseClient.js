// Single configured Supabase client for the whole app.
// The URL and anon key are injected at build time (see build.mjs) from .env.
// Both are PUBLIC client values; real protection comes from Row-Level Security
// rules in db/01_schema.sql.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaces an obvious message in the browser console if the build didn't
  // inject the values (e.g. missing .env).
  console.error('[supabase] Missing SUPABASE_URL / SUPABASE_ANON_KEY. Check your .env and rebuild.');
}

// ── EVERY REQUEST MUST BE ABLE TO FAIL ──────────────────────────────────────
//
// This was `createClient(url, anonKey)` with no options, which means no request
// this app makes could EVER time out. Not a theoretical worry — it is the cause
// of the "Showing saved data" banner that would not go away, on desktop as well
// as iPhone:
//
//   every PostgREST query  →  SupabaseClient._getAccessToken()
//                          →  auth.getSession()
//                          →  if the token expired, POST /token?grant_type=refresh_token
//
// and @supabase/auth-js ships no AbortController in its fetch layer. So if that
// one refresh request hangs — a socket frozen while the machine slept, a flaky
// moment, a proxy holding the connection open — it never settles, and because
// every query waits on it, NOTHING settles. fetchAll's `finally` never runs, so
// `setStale(false)` is never reached, the 12s watchdog paints the banner, and
// every retry queues behind the same stuck promise. The app sits there showing
// figures it knows are old, with no way back except a full reload.
//
// A hung request is worse than a failed one. A failure is information: the
// retry logic already knows what to do with it. A hang is silence, and silence
// is what the whole recovery path is unable to handle.
//
// WHY 30 SECONDS. Measured query latency against this project is 0.2–0.5s, so
// 30s is roughly sixty times the normal worst case — it can only fire on a
// genuine hang, never on a slow-but-working request. It is also chosen to clear
// the longest legitimate call in the app: `scan-receipt` invokes an AI provider
// and can take ten to twenty seconds. Do not lower this below ~25s without
// checking a real scan, or receipt scanning will start failing for people on
// slow connections and it will look like a scanning bug rather than this line.
const REQUEST_TIMEOUT_MS = 30_000;

function fetchWithTimeout(input, init = {}) {
  // Respect a caller's own signal if it ever passes one; ours is additional.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const onCallerAbort = () => controller.abort();
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal })
    .catch((err) => {
      // Re-label OUR timeout so it is unmistakable in a console and, more
      // importantly, so isNetworkError() classifies it as a network problem —
      // which routes it to the retry path instead of a dead-end error banner.
      if (controller.signal.aborted && !init.signal?.aborted) {
        throw new TypeError(`Network request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
      init.signal?.removeEventListener?.('abort', onCallerAbort);
    });
}

export const supabase = createClient(url, anonKey, {
  global: { fetch: fetchWithTimeout },
});
