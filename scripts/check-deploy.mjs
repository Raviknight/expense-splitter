// check-deploy.mjs — refuse to ship a docs/ folder that would white-screen the site.
//
// Run before any commit that touches docs/:
//     node scripts/check-deploy.mjs
//
// WHY THIS EXISTS. `npm run dev` rewrites docs/ with an UNHASHED bundle.js and
// points docs/index.html at it. That file is gitignored (correctly — it is a dev
// artifact), so committing after a dev-server run deletes the real hashed bundle
// and leaves index.html referring to a file that is not in the repo. GitHub Pages
// then serves the page, 404s the script, and shows a blank screen.
//
// That is not hypothetical: it happened on 2026-09-14 and was live for about
// three minutes.
//
// THE POINT OF A SCRIPT RATHER THAN A NOTE. CLAUDE.md already carried this exact
// warning, with a ⚠️, in the deploy section — and it still happened. The failure
// is silent at commit time: `git status` shows a deleted bundle and a modified
// index.html, which is precisely what a NORMAL build looks like. There is nothing
// to notice. A rule you must remember at the exact moment you are least likely to
// remember it is not a safeguard; a check that fails loudly is.
//
// Exits 0 when docs/ is safe to publish, 1 with an explanation when it is not.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const fail = (msg, fix) => {
  console.error(`\n  DEPLOY CHECK FAILED\n\n  ${msg}\n\n  Fix: ${fix}\n`);
  process.exit(1);
};

if (!existsSync('docs/index.html')) {
  fail('docs/index.html does not exist.', 'run  npm run build');
}

const html = readFileSync('docs/index.html', 'utf8');
const ref  = (html.match(/bundle[^"']*\.js/) || [])[0];

if (!ref) {
  fail('docs/index.html does not reference any bundle.', 'run  npm run build');
}

// 1. The dev bundle is unhashed. If index.html points at it, a dev server ran
//    and the production build was never regenerated.
if (ref === 'bundle.js') {
  fail(
    'docs/index.html points at the DEV bundle (bundle.js), which is gitignored.\n' +
    '  Committing this deletes the real bundle and white-screens the live site.',
    'run  npm run build  and commit again',
  );
}

// 2. The referenced file must actually be on disk.
if (!existsSync(`docs/${ref}`)) {
  fail(`docs/index.html references ${ref}, but that file does not exist.`,
       'run  npm run build');
}

// 3. And git must be willing to track it — a hashed bundle caught by .gitignore
//    would be just as absent from the deployed site as a missing one.
try {
  execSync(`git check-ignore -q docs/${ref}`, { stdio: 'ignore' });
  fail(`docs/${ref} is IGNORED by .gitignore, so it will never reach the site.`,
       'check .gitignore — only docs/bundle.js (the dev artifact) should be ignored');
} catch {
  // Non-zero exit from check-ignore means NOT ignored. That is what we want.
}

// 4. A stray dev bundle left lying around is not fatal, but it means a dev server
//    ran and is worth saying out loud.
const strays = readdirSync('docs').filter(f => f === 'bundle.js' || f === 'bundle.js.map');
if (strays.length) {
  console.warn(`  note: ${strays.join(', ')} still in docs/ (left by npm run dev). Harmless — gitignored.`);
}

console.log(`  deploy check OK — docs/index.html → ${ref} (present, tracked)`);
