// Build / dev script for the Expense Splitter PWA.
// - "npm run build"  -> minified production bundle written to /docs (GitHub Pages root)
// - "npm run dev"    -> local dev server with rebuild-on-save
//
// The two Supabase values are read from a local .env file (or real env vars in CI)
// and injected into the bundle at build time. They are PUBLIC client values, safe to ship.

import esbuild from 'esbuild';
import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';

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

// Remove any previous bundle files so old hashed copies don't pile up in /docs.
for (const f of existsSync('docs') ? readdirSync('docs') : []) {
  if (/^bundle.*\.js(\.map)?$/.test(f)) rmSync(`docs/${f}`);
}

if (existsSync('public')) cpSync('public', 'docs', { recursive: true });

const options = {
  entryPoints: ['src/main.jsx'],
  bundle: true,
  define,
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  logLevel: 'info',
};

if (isDev) {
  // Dev: fixed filename "bundle.js" (local, not cached aggressively). The
  // index.html copied into /docs already points at "bundle.js", so no rewrite.
  const ctx = await esbuild.context({ ...options, outfile: 'docs/bundle.js', sourcemap: true });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'docs', port: 5173 });
  console.log(`\nDev server running:  http://localhost:${port}\n(Edit files and refresh the browser to see changes.)`);
} else {
  // Production: give the bundle a content-hash filename (e.g. bundle-A1B2C3D4.js)
  // so browsers and the GitHub Pages CDN are forced to fetch the new file after
  // every change — this is "cache busting". We then rewrite index.html to point
  // at the freshly-named file.
  const result = await esbuild.build({
    ...options,
    entryNames: 'bundle-[hash]',
    outdir: 'docs',
    minify: true,
    metafile: true,
  });

  // Find the hashed JS filename esbuild produced.
  const outKey = Object.keys(result.metafile.outputs).find(
    f => f.endsWith('.js') && !f.endsWith('.map')
  );
  const bundleName = outKey.split('/').pop(); // e.g. "bundle-A1B2C3D4.js"

  // Point index.html at the new filename (replace the static "bundle.js" ref).
  const htmlPath = 'docs/index.html';
  const html = readFileSync(htmlPath, 'utf8').replace('bundle.js', bundleName);
  writeFileSync(htmlPath, html);

  console.log(`Build complete -> docs/  (${bundleName})`);
}
