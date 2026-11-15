// Render the 1024 x 1024 app icon from code (no image generation): the broken moon over a wolf token on a struck tile.
// Usage: npx tsx tools/make-icon.ts
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { ICONS } from '../src/client/icons';

const wolf = ICONS.wolfHead;
const html = `<!doctype html><html><body style="margin:0;background:#110c14">
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="20%" r="90%"><stop offset="0%" stop-color="#3a2850"/><stop offset="65%" stop-color="#140e19"/></radialGradient>
    <radialGradient id="moon" cx="42%" cy="38%" r="65%"><stop offset="0%" stop-color="#fbf6e8"/><stop offset="70%" stop-color="#e3d9c0"/><stop offset="100%" stop-color="#b8ab8d"/></radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="#f6e9c788"/><stop offset="100%" stop-color="#f6e9c700"/></radialGradient>
    <pattern id="hatch" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="36" height="36" fill="#c8443a" fill-opacity="0.35"/><rect width="15" height="36" fill="#ff6a50" fill-opacity="0.7"/>
    </pattern>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="360" r="300" fill="url(#glow)"/>
  <circle cx="512" cy="360" r="200" fill="url(#moon)"/>
  <circle cx="440" cy="300" r="26" fill="#c9bc9e" opacity="0.6"/>
  <circle cx="575" cy="430" r="38" fill="#c9bc9e" opacity="0.5"/>
  <path d="M580 160 L540 250 L575 300 L510 380 L545 440 L490 560" fill="none" stroke="#2a1f30" stroke-width="16" stroke-linejoin="round"/>
  <path d="M760 210 l34 -12 l12 26 l-34 12 z" fill="#d8ccb0"/><path d="M800 300 l20 -6 l6 18 l-20 6 z" fill="#cfc2a5"/>
  <rect x="262" y="600" width="500" height="340" rx="40" fill="url(#hatch)" stroke="#ff7a5c" stroke-width="10"/>
  <circle cx="512" cy="770" r="190" fill="#1b1420" stroke="#d1543f" stroke-width="26"/>
  <path d="M742 770 l-46 -36 v72 z" fill="#d1543f"/>
  <path d="${wolf}" fill="#efe6d2" transform="translate(372 630) scale(${280 / 512})"/>
  <rect x="14" y="14" width="996" height="996" rx="120" fill="none" stroke="#8d7240" stroke-width="20"/>
</svg></body></html>`;

mkdirSync('assets', { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(html);
await page.screenshot({ path: 'assets/icon.png', clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();
console.log('wrote assets/icon.png');
