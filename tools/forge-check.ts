// End-to-end check of the trial forge in the local preview, with touch input on a phone-sized screen: clear today's
// trial, open the forge, build a small board, check it, prove it, post it, then play the posted trial as someone else.
// Needs `npm run local`. Usage: npx tsx tools/forge-check.ts
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { dayNumber } from '../src/shared/engine/generator';
import { applyAction, initialState, type Action, type Puzzle } from '../src/shared/engine/rules';
import { solve } from '../src/shared/engine/solver';
import { trialFor, type SeasonDay } from '../src/shared/game';
import { WARMUP } from '../src/shared/trials/warmup';

const BASE = 'http://127.0.0.1:5199';
const OUT = 'tools/shots/forge';
mkdirSync(OUT, { recursive: true });
const season = JSON.parse(readFileSync('src/server/season.json', 'utf8')) as SeasonDay[];
const day = dayNumber(Date.now());
const findings: string[] = [];
const SIX = { w: 6, h: 6 } as Puzzle;

async function tapTile(page: Page, p: Pick<Puzzle, 'w'>, x: number, y: number) {
  const box = await page.locator('.board-wrap svg').boundingBox();
  if (!box) throw new Error('no board');
  const scale = box.width / (p.w * 100 + 8);
  await page.touchscreen.tap(box.x + (4 + x * 100 + 50) * scale, box.y + (4 + y * 100 + 50) * scale);
  await page.waitForTimeout(200);
}

async function tapButton(page: Page, name: string | RegExp, exact = false) {
  const b = page.getByRole('button', { name, exact }).first();
  await b.scrollIntoViewIfNeeded();
  const box = await b.boundingBox();
  if (!box) throw new Error(`no button ${name}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250);
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
    else await tapButton(page, 'Wait', true);
    s = applyAction(s, a)!;
  }
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => findings.push(`page error: ${e.message}`));
const maker = `forger${Date.now() % 100000}`;

// 1. Clear the warm-up and today's trial, then open the forge from the win sheet.
await page.goto(`${BASE}/game.html?user=${maker}&new=1`);
await page.waitForSelector('.board-wrap svg');
await tapTile(page, WARMUP, 0, 1);
await tapTile(page, WARMUP, 1, 1);
await tapButton(page, 'Strike', true);
await page.waitForSelector('.sheet');
await tapButton(page, /Begin today/);
await page.waitForTimeout(300);
const s = trialFor(season, day);
await playLine(page, s.puzzle, solve(s.puzzle).ways[0]!.line);
await tapButton(page, 'Strike', true);
await page.waitForSelector('.sheet');
await page.waitForTimeout(300);
if (!(await page.getByRole('button', { name: 'Forge a trial' }).count())) findings.push('no Forge a trial button on the win sheet');
await tapButton(page, 'Forge a trial', true);
await page.waitForSelector('.palette');
await page.screenshot({ path: `${OUT}/1-empty.png` });

// 2. Build: a wolf turned to face east at (1,2), a boar at (3,2), a vanguard at (0,4).
await tapButton(page, 'Wolf', true);
await tapTile(page, SIX, 1, 2); // faces W
await tapTile(page, SIX, 1, 2); // N
await tapTile(page, SIX, 1, 2); // E
await tapButton(page, 'Boar', true);
await tapTile(page, SIX, 3, 2);
await tapButton(page, 'Vanguard', true);
await tapTile(page, SIX, 0, 4);
await page.screenshot({ path: `${OUT}/2-built.png` });
await tapButton(page, 'Check', true);
await page.waitForFunction(() => /can be won|No way|Too many|already won/.test(document.querySelector('.forecast')?.textContent ?? ''), null, { timeout: 15_000 });
const status = (await page.locator('.forecast').textContent()) ?? '';
if (!status.includes('can be won')) findings.push(`check did not pass: "${status}"`);
await page.screenshot({ path: `${OUT}/3-checked.png` });

// 3. Prove it: shove the wolf into the boar.
await tapButton(page, 'Prove it', true);
await page.waitForSelector('.board-wrap svg');
await tapTile(page, SIX, 0, 2);
await tapTile(page, SIX, 1, 2);
await tapButton(page, 'Strike', true);
await page.waitForSelector('.sheet');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/4-proven.png` });
if ((await page.locator('.sheet h2').textContent()) !== 'Proven') findings.push('proof win did not show the Proven sheet');
await page.locator('.field input').fill('The Lantern Gate');
await tapButton(page, 'Post it', true);
await page.waitForURL(/forge=\d+/, { timeout: 10_000 });
const forgeId = Number(new URL(page.url()).searchParams.get('forge'));
await page.waitForSelector('.splash-board svg');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/5-posted-card.png` });
const card = (await page.locator('.splash-info').textContent()) ?? '';
if (!card.includes('The Lantern Gate') || !card.includes(`Forged by u/${maker}`)) findings.push(`posted card does not show title and maker: "${card}"`);

// 4. Someone else plays the posted trial and wins it.
const player = `hunter${Date.now() % 100000}`;
await page.goto(`${BASE}/game.html?user=${player}&forge=${forgeId}`);
await page.waitForSelector('.board-wrap svg');
// First visit shows the warm-up; skip it the way a player would.
if (await page.locator('.coach').count()) {
  await tapTile(page, WARMUP, 0, 1);
  await tapTile(page, WARMUP, 1, 1);
  await tapButton(page, 'Strike', true);
  await page.waitForSelector('.sheet');
  await tapButton(page, /Begin today/);
  await page.waitForTimeout(300);
}
const sub = (await page.locator('.topbar .sub').textContent()) ?? '';
if (!sub.includes(`Forged by u/${maker}`)) findings.push(`forged trial top bar does not credit the maker: "${sub}"`);
await tapTile(page, SIX, 0, 4);
await tapTile(page, SIX, 0, 2);
await tapTile(page, SIX, 1, 2);
await tapButton(page, 'Strike', true);
await page.waitForSelector('.sheet');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/6-other-player-win.png` });
if ((await page.locator('.sheet h2').textContent()) !== 'The field is clear') findings.push('another player could not win the posted trial');

await browser.close();
console.log(findings.length ? `FINDINGS:\n- ${findings.join('\n- ')}` : `no findings (forge id ${forgeId})`);
