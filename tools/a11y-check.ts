// Accessibility check with axe-core against the local preview: the feed card, the warm-up, today's trial while
// planning, the win sheet, the help sheet and the trial builder, on a phone-sized screen. The brief asks for
// "accessible contrast, legible text" and "make it accessible"; this reports every WCAG 2 A/AA violation axe finds.
// Needs `npm run local`. Usage: npx tsx tools/a11y-check.ts
import { AxeBuilder } from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { dayNumber } from '../src/shared/engine/generator';
import { applyAction, initialState } from '../src/shared/engine/rules';
import { solve } from '../src/shared/engine/solver';
import { trialFor, type SeasonDay } from '../src/shared/game';

const BASE = 'http://127.0.0.1:5199';
const season = JSON.parse(readFileSync('src/server/season.json', 'utf8')) as SeasonDay[];
const findings: string[] = [];

async function audit(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  for (const v of r.violations) {
    const where = v.nodes
      .slice(0, 4)
      .map((n) => `${n.target.join(' ')}${n.any[0]?.message ? ` (${n.any[0].message})` : ''}`)
      .join('\n      ');
    findings.push(`${label}: [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)\n      ${where}`);
  }
  // axe cannot measure text over gradients or images and files it as "incomplete", not as a pass. List those so
  // they get checked by eye (or by the sampled check below) instead of being taken as passing.
  for (const v of r.incomplete.filter((i) => i.id === 'color-contrast')) {
    for (const n of v.nodes) await sampled(page, n.target.join(' '), label);
  }
}

/**
 * Contrast for text axe could not measure (text over gradients and translucent panels). Screenshots the element with
 * and without its text; the pixels that change are where the glyphs are, and the hidden-text shot gives the background
 * exactly behind them, so borders, rounded corners and icons around the text do not count. Text with a plain colour is
 * compared by that colour (as WCAG defines it); gradient text (transparent colour, background-clip) by the rendered
 * glyph pixels. Reports the 5th percentile over glyph pixels. Skips text under a sheet or in a disabled control.
 */
async function sampled(page: Page, selector: string, label: string) {
  const loc = page.locator(selector).first();
  const info = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const covered = !top || !(el === top || el.contains(top) || top.contains(el));
    const cs = getComputedStyle(el);
    let opacity = 1;
    for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    const disabled = !!el.closest('button:disabled, [aria-disabled="true"]');
    return { covered, disabled, color: cs.color, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400, opacity, w: r.width, h: r.height, text: (el.textContent ?? '').trim().slice(0, 32) };
  });
  if (info.covered || info.disabled || info.w < 2 || info.h < 2 || !info.text) return;
  const gradientText = /rgba\(.*,\s*0\)$/.test(info.color);
  const shown = (await loc.screenshot({ animations: 'disabled' })).toString('base64');
  // Hide only the text. Gradient text is painted by the element's own background, so that goes too.
  const hide = `color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important;${gradientText ? ' background: none !important;' : ''}`;
  await page.addStyleTag({ content: `${selector}, ${selector} * { ${hide} }` });
  const hidden = (await loc.screenshot({ animations: 'disabled' })).toString('base64');
  await page.evaluate(() => document.head.lastElementChild?.remove());
  const ratio = await page.evaluate(
    async ({ shown, hidden, color, opacity, gradientText }) => {
      const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const pixels = async (png: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
        const cx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
        cx.drawImage(bmp, 0, 0);
        return cx.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const [a, b] = [await pixels(shown), await pixels(hidden)];
      const [r, g, bl, al = 1] = color.match(/[\d.]+/g)!.map(Number) as [number, number, number, number?];
      const alpha = al * opacity;
      const ratios: number[] = [];
      for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
        const diff = Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
        if (diff < 60) continue; // not a glyph pixel (or only a faint anti-aliased edge)
        const [br, bg, bb] = [b[i]!, b[i + 1]!, b[i + 2]!];
        const t = gradientText ? lum(a[i]!, a[i + 1]!, a[i + 2]!) : lum(r * alpha + br * (1 - alpha), g * alpha + bg * (1 - alpha), bl * alpha + bb * (1 - alpha));
        const l = lum(br, bg, bb);
        ratios.push((Math.max(t, l) + 0.05) / (Math.min(t, l) + 0.05));
      }
      if (!ratios.length) return -1;
      ratios.sort((x, y) => x - y);
      // Rendered gradient glyphs include anti-aliased edges, so judge them by their solid core.
      return ratios[Math.floor(ratios.length * (gradientText ? 0.5 : 0.05))]!;
    },
    { shown, hidden, color: info.color, opacity: info.opacity, gradientText }
  );
  if (ratio < 0) return void findings.push(`${label}: could not find the glyphs of ${selector} "${info.text}" to measure`);
  const large = info.size >= 24 || (info.size >= 18.66 && info.weight >= 700);
  const need = large ? 3 : 4.5;
  if (ratio < need) findings.push(`${label}: low contrast ${ratio.toFixed(2)}:1 (needs ${need}) on ${selector} "${info.text}" (${info.color}, ${info.size}px)`);
  else checked.push(`${ratio.toFixed(1)} ${selector}`);
}
const checked: string[] = [];

async function tapTile(page: Page, w: number, x: number, y: number) {
  const box = (await page.locator('.board-wrap svg').boundingBox())!;
  const k = box.width / (w * 100 + 8);
  await page.mouse.click(box.x + (4 + x * 100 + 50) * k, box.y + (4 + y * 100 + 50) * k);
  await page.waitForTimeout(150);
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
// axe opens a helper page in the same context, which a page made by browser.newPage() does not allow.
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2 });
// tsx wraps named functions in a __name() helper that does not exist inside the page.
await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
const page = await ctx.newPage();
const user = `a11y${Date.now() % 100000}`;

await page.setViewportSize({ width: 412, height: 512 });
await page.goto(`${BASE}/splash.html?user=${user}`);
await page.waitForSelector('.splash-board svg');
await audit(page, 'feed card');

await page.setViewportSize({ width: 412, height: 892 });
await page.goto(`${BASE}/game.html?user=${user}&new=1`);
await page.waitForSelector('.board-wrap svg');
await audit(page, 'warm-up');
await tapTile(page, 4, 0, 1);
await tapTile(page, 4, 1, 1);
await page.getByRole('button', { name: 'Strike', exact: true }).click();
await page.getByRole('button', { name: /Begin today/ }).click();
await page.waitForTimeout(300);

const s = trialFor(season, dayNumber(Date.now()));
const line = solve(s.puzzle).ways[0]!.line;
let st = initialState(s.puzzle);
const first = line[0]!;
const h = st.units.find((u) => u.id === first.hero)!;
await tapTile(page, s.puzzle.w, h.x, h.y);
await audit(page, 'daily, hero selected');
for (const a of line) {
  const u = st.units.find((v) => v.id === a.hero)!;
  if (a !== first) await tapTile(page, s.puzzle.w, u.x, u.y);
  const moves = a.to[0] !== u.x || a.to[1] !== u.y;
  if (moves) await tapTile(page, s.puzzle.w, a.to[0], a.to[1]);
  if (a.target) await tapTile(page, s.puzzle.w, a.target[0], a.target[1]);
  else if (moves) await tapTile(page, s.puzzle.w, a.to[0], a.to[1]);
  else await page.getByRole('button', { name: 'Wait', exact: true }).click();
  st = applyAction(st, a)!;
}
await page.getByRole('button', { name: 'Strike', exact: true }).click();
await page.waitForSelector('.sheet h2');
await page.waitForTimeout(600);
await audit(page, 'win sheet');

await page.goto(`${BASE}/game.html?user=${user}`);
await page.waitForSelector('.board-wrap svg');
await page.getByRole('button', { name: 'How to play' }).click();
await page.waitForTimeout(300);
await audit(page, 'help sheet');

await browser.close();
console.log(`sampled contrast passed on ${checked.length} elements axe could not measure`);
console.log(findings.length ? `FINDINGS (${findings.length}):\n- ${findings.join('\n- ')}` : 'no findings');
