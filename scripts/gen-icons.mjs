// scripts/gen-icons.mjs
// Generates PNG app icons for the Expense Splitter PWA.
// Design: stone-900 (#1c1917) rounded square background with a white receipt glyph.
// Run once with: node scripts/gen-icons.mjs
// Requires: npm install -D sharp

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// Build an SVG for a given pixel size.
// The receipt glyph is drawn on a dark stone-900 background with a rounded square shape.
function buildSvg(size) {
  // Corner radius: ~22% of size gives a nice iOS-style rounded square feel.
  const r = Math.round(size * 0.22);
  // Padding inside the rounded square where the glyph lives.
  const pad = Math.round(size * 0.15);
  const inner = size - pad * 2;

  // Receipt glyph dimensions, centred inside the padded area.
  const rw = Math.round(inner * 0.55);  // receipt body width
  const rh = Math.round(inner * 0.70);  // receipt body height
  const rx = Math.round((size - rw) / 2);
  const ry = Math.round((size - rh) / 2) - Math.round(size * 0.02);

  // Line positions on the receipt (three horizontal lines = text rows).
  const lineX1 = rx + Math.round(rw * 0.15);
  const lineX2 = rx + Math.round(rw * 0.85);
  const lineY1 = ry + Math.round(rh * 0.28);
  const lineY2 = ry + Math.round(rh * 0.45);
  const lineY3 = ry + Math.round(rh * 0.62);
  const sw = Math.max(2, Math.round(size * 0.025)); // stroke width

  // Small zigzag "tear" at the bottom of the receipt.
  const zigY = ry + rh;
  const seg = Math.round(rw / 5);
  const zigH = Math.round(size * 0.04);
  const zigPath = `M${rx},${zigY} `
    + `l${seg},${-zigH} l${seg},${zigH} l${seg},${-zigH} l${seg},${zigH} l${seg},${-zigH}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <!-- Background: stone-900 rounded square -->
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#1c1917"/>

  <!-- Receipt body -->
  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${Math.round(rw * 0.08)}" ry="${Math.round(rw * 0.08)}"
        fill="white" opacity="0.95"/>

  <!-- Receipt text lines -->
  <line x1="${lineX1}" y1="${lineY1}" x2="${lineX2}" y2="${lineY1}"
        stroke="#1c1917" stroke-width="${sw}" stroke-linecap="round"/>
  <line x1="${lineX1}" y1="${lineY2}" x2="${lineX2}" y2="${lineY2}"
        stroke="#1c1917" stroke-width="${sw}" stroke-linecap="round"/>
  <!-- Shorter third line (like a total line) -->
  <line x1="${lineX1}" y1="${lineY3}" x2="${rx + Math.round(rw * 0.60)}" y2="${lineY3}"
        stroke="#1c1917" stroke-width="${sw}" stroke-linecap="round"/>

  <!-- Zigzag tear at bottom of receipt -->
  <path d="${zigPath}" fill="none" stroke="#1c1917" stroke-width="${Math.max(1, Math.round(sw * 0.7))}"
        stroke-linecap="round" stroke-linejoin="round"/>
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
