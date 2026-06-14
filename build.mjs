// Build / dev script for the Expense Splitter PWA.
// - "npm run build"  -> minified production bundle written to /docs (GitHub Pages root)
// - "npm run dev"    -> local dev server with rebuild-on-save
//
// The two Supabase values are read from a local .env file (or real env vars in CI)
// and injected into the bundle at build time. They are PUBLIC client values, safe to ship.

import esbuild from 'esbuild';
import { readFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';

const isDev = process.argv.includes('--dev');

// --- Load .env (simple parser; no extra dependency) -----------------------
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2];
  }
}

// --- Values injected into the browser bundle ------------------------------
const define = {
  'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL || ''),
  'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY || ''),
  // React (and some libs) read NODE_ENV; without this, the browser would hit
  // "process is not defined". esbuild does not set it automatically.
  'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
};

// --- Static assets: copy everything in /public into /docs -----------------
mkdirSync('docs', { recursive: true });
if (existsSync('public')) cpSync('public', 'docs', { recursive: true });

const options = {
  entryPoints: ['src/main.jsx'],
  bundle: true,
  outfile: 'docs/bundle.js',
  define,
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  logLevel: 'info',
};

if (isDev) {
  const ctx = await esbuild.context({ ...options, sourcemap: true });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'docs', port: 5173 });
  console.log(`\nDev server running:  http://localhost:${port}\n(Edit files and refresh the browser to see changes.)`);
} else {
  await esbuild.build({ ...options, minify: true });
  console.log('Build complete -> docs/');
}
