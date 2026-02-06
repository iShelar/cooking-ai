#!/usr/bin/env node
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'favicon.svg');

const sizes = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

const svg = readFileSync(svgPath);

for (const { name, size } of sizes) {
  const outPath = join(publicDir, name);
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`Generated ${name}`);
}

console.log('PWA icons generated in public/');
