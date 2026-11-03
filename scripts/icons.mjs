// Rasterizes media/icon.svg into the PNG sizes the PWA manifest, notifications and VS Code need.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile('media/icon.svg');
for (const size of [192, 256, 512]) await sharp(svg).resize(size, size).png().toFile(`media/icon-${size}.png`);

// Maskable: artwork inside the 80% safe zone on a full-bleed background.
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#6A56EA' } })
  .composite([{ input: inner, gravity: 'center' }]).png().toFile('media/icon-maskable-512.png');

// Monochrome status-bar badge for Android notifications.
const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect x="14" y="18" width="26" height="60" rx="6" fill="none" stroke="#fff" stroke-width="7"/>
  <path d="M52 34 q10 14 0 28" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
  <path d="M66 30 l16 18 -16 18" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);
await sharp(badge).resize(96, 96).png().toFile('media/badge-96.png');
console.log('icons generated');
