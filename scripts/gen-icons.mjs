// scripts/gen-icons.mjs
// Generates PNG app icons for the Splitab PWA.
// Design: stone-900 (#1c1917) rounded square with an indigo "S" monogram.
// Run once with: node scripts/gen-icons.mjs
// Requires: npm install -D sharp

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// The "S" monogram as a stroked path in a normalized 0..100 box. Reused at any
// size by scaling. Round caps make it feel like a friendly, rounded lettermark.
const S_PATH_100 =
  'M72 34 C56 24 34 26 32 42 C30.5 54 48 56 55 59 C66 63 70 72 64 78 C56 88 36 86 27 76';
const S_STROKE_100 = 11; // stroke width in the same 0..100 units

// Build an SVG for a given pixel size: a dark rounded square + the indigo S.
function buildSvg(size) {
  const r = Math.round(size * 0.22); // iOS-style rounded square
  const u = size / 100;              // scale factor for the 0..100 monogram

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#1c1917"/>
  <g transform="scale(${u})">
    <path d="${S_PATH_100}" fill="none" stroke="#818cf8"
          stroke-width="${S_STROKE_100}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const sizes = [
  { name: 'icon-180.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

for (const { name, size } of sizes) {
  const svg = Buffer.from(buildSvg(size));
  const outPath = join(outDir, name);
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`Generated ${outPath} (${size}x${size})`);
}

console.log('All icons generated successfully.');
