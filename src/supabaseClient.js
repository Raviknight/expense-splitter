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

export const supabase = createClient(url, anonKey);
