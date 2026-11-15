// Mobile validation against the local preview with touch input: a Galaxy S24-sized phone, the same phone inside Reddit's
// expanded view (minus Reddit's chrome), and a small 360 x 640 phone. Plays the warm-up and today's trial with taps,
// exercises Undo and Wait, opens help, and checks that nothing scrolls or spills out of the viewport.
// Needs `npm run local`. Usage: npx tsx tools/device-check.ts
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { dayNumber } from '../src/shared/engine/generator';
import { applyAction, initialState, type Action, type Puzzle } from '../src/shared/engine/rules';
import { solve } from '../src/shared/engine/solver';
import { trialFor, type SeasonDay } from '../src/shared/game';
import { WARMUP } from '../src/shared/trials/warmup';

const BASE = 'http://127.0.0.1:5199';
const OUT = 'tools/shots/device';
mkdirSync(OUT, { recursive: true });
const season = JSON.parse(readFileSync('src/server/season.json', 'utf8')) as SeasonDay[];
const day = dayNumber(Date.now());
const UA = 'Mozilla/5.0 (Linux; Android 15; SM-S921W) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const findings: string[] = [];

async function tapTile(page: Page, p: Puzzle, x: number, y: number) {
  const box = await page.locator('.board-wrap svg').boundingBox();
  if (!box) throw new Error('no board');
  const scale = box.width / (p.w * 100 + 8);
  await page.touchscreen.tap(box.x + (4 + x * 100 + 50) * scale, box.y + (4 + y * 100 + 50) * scale);
  await page.waitForTimeout(250);
}

async function tapButton(page: Page, name: string | RegExp) {
  const b = page.getByRole('button', { name });
  const box = await b.first().boundingBox();
  if (!box) throw new Error(`no button ${name}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250);
}

async function fits(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const out: string[] = [];
    for (const sel of ['.topbar', '.forecast', '.coach', '.board-wrap', '.heroes', '.actions']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      if (b.bottom > vh + 0.5 || b.right > vw + 0.5 || b.top < -0.5) out.push(`${sel} outside viewport (${Math.round(b.top)}..${Math.round(b.bottom)} of ${vh})`);
    }
    return { scrollH: doc.scrollHeight, vh, out };
  });
  if (r.scrollH > r.vh + 1) findings.push(`${label}: page scrolls (${r.scrollH} > ${r.vh})`);
  for (const o of r.out) findings.push(`${label}: ${o}`);
}

async function playLine(page: Page, p: Puzzle, line: Action[]) {
  let s = initialState(p);
  for (const a of line) {
    const h = s.units.find((u) => u.id === a.hero)!;
    const moves = a.to[0] !== h.x || a.to[1] !== h.y;
    await tapTile(page, p, h.x, h.y);
    if (moves) await tapTile(page, p, a.to[0], a.to[1]);
    if (a.target) await tapTile(page, p, a.target[0], a.target[1]);
    else if (moves) await tapTile(page, p, a.to[0], a.to[1]);
    else await tapButton(page, 'Wait');
    s = applyAction(s, a)!;
  }
}

async function run(tag: string, viewport: { width: number; height: number }, dpr: number) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const user = `dev${tag}${Date.now() % 100000}`;

  const t0 = Date.now();
  await page.goto(`${BASE}/game.html?user=${user}&new=1`);
  await page.waitForSelector('.board-wrap svg');
  const loadMs = Date.now() - t0;
  await page.screenshot({ path: `${OUT}/${tag}-1-warmup.png` });
  await fits(page, `${tag} warm-up`);

  // Warm-up with touch: move, then Undo should put the hero back, then do it properly.
  await tapTile(page, WARMUP, 0, 1);
  await tapButton(page, 'Undo');
  const back = await page.locator('.coach').textContent();
  if (!back?.includes('gold dot')) findings.push(`${tag}: after Undo the coach did not return to the walking hint (got "${back}")`);
  await tapTile(page, WARMUP, 0, 1);
  await tapTile(page, WARMUP, 1, 1);
  await tapButton(page, 'Strike');
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-2-warmup-result.png` });
  const won = await page.getByRole('button', { name: /Begin today/ }).count();
  if (!won) findings.push(`${tag}: warm-up did not end in a win with touch input`);
  await tapButton(page, /Begin today/);
  await page.waitForTimeout(400);
  await fits(page, `${tag} daily`);
  await page.screenshot({ path: `${OUT}/${tag}-3-daily.png` });

  // Wait on the first hero, then Undo it.
  await tapButton(page, 'Wait');
  const doneCards = await page.locator('.hero-card.done').count();
  if (doneCards < 1) findings.push(`${tag}: Wait did not end the hero's turn`);
  await tapButton(page, 'Undo');
  if ((await page.locator('.hero-card.done').count()) !== 0) findings.push(`${tag}: Undo after Wait did not restore the hero`);

  const s = trialFor(season, day);
  const ways = solve(s.puzzle).ways;
  await playLine(page, s.puzzle, ways[ways.length - 1]!.line);
  const ready = await page.locator('.btn.primary.ready').count();
  if (!ready) findings.push(`${tag}: forecast did not turn gold before Strike on a winning line`);
  await page.screenshot({ path: `${OUT}/${tag}-4-ready.png` });
  await tapButton(page, 'Strike');
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}-5-win.png` });
  const title = await page.locator('.sheet h2').textContent();
  if (title !== 'The field is clear') findings.push(`${tag}: expected a win sheet, got "${title}"`);
  // The result sheet itself may scroll inside, but the page must not.
  await fits(page, `${tag} result`);

  // Help sheet opens over the game and closes.
  await page.goto(`${BASE}/game.html?user=${user}`);
  await page.waitForSelector('.board-wrap svg');
  await tapButton(page, 'How to play');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-6-help.png` });
  await tapButton(page, 'Close help');
  if (await page.locator('.sheet').count()) findings.push(`${tag}: help sheet did not close`);

  // The feed card at the post's inline size.
  await page.setViewportSize({ width: viewport.width, height: 512 });
  await page.goto(`${BASE}/splash.html?user=${user}`);
  await page.waitForSelector('.splash-board svg');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-7-card.png` });
  const cardScroll = await page.evaluate(() => (document.scrollingElement?.scrollHeight ?? 0) > window.innerHeight + 1);
  if (cardScroll) findings.push(`${tag}: the feed card scrolls at 512 px tall`);

  for (const e of errors) findings.push(`${tag}: page error: ${e}`);
  console.log(`${tag}: game loaded in ${loadMs} ms`);
  await browser.close();
}

await run('s24', { width: 412, height: 892 }, 2.625);
await run('s24-in-reddit', { width: 412, height: 780 }, 2.625);
await run('small', { width: 360, height: 640 }, 2);
console.log(findings.length ? `FINDINGS:\n- ${findings.join('\n- ')}` : 'no findings');
