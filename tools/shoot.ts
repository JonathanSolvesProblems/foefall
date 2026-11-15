// Drive the local preview with Playwright: play the warm-up, then today's trial with a solver line, and screenshot every
// state on a phone-sized and a desktop viewport. Needs `npm run local` running. Usage: npx tsx tools/shoot.ts [day]
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { dayNumber } from '../src/shared/engine/generator';
import { initialState, applyAction, type Action, type Puzzle } from '../src/shared/engine/rules';
import { solve } from '../src/shared/engine/solver';
import { trialFor, type SeasonDay } from '../src/shared/game';
import { WARMUP } from '../src/shared/trials/warmup';

const BASE = 'http://127.0.0.1:5199';
const OUT = 'tools/shots';
mkdirSync(OUT, { recursive: true });
const season = JSON.parse(readFileSync('src/server/season.json', 'utf8')) as SeasonDay[];
const day = Number(process.argv[2] ?? dayNumber(Date.now()));
const errors: string[] = [];

async function tile(page: Page, p: Puzzle, x: number, y: number) {
  const box = await page.locator('.board-wrap svg').boundingBox();
  if (!box) throw new Error('no board');
  // viewBox is -4..W*100+4 on both axes
  const scale = box.width / (p.w * 100 + 8);
  await page.mouse.click(box.x + (4 + x * 100 + 50) * scale, box.y + (4 + y * 100 + 50) * scale);
  await page.waitForTimeout(260);
}

async function playLine(page: Page, p: Puzzle, line: Action[]) {
  let s = initialState(p);
  for (const a of line) {
    const h = s.units.find((u) => u.id === a.hero)!;
    const moves = a.to[0] !== h.x || a.to[1] !== h.y;
    await tile(page, p, h.x, h.y);
    if (moves) await tile(page, p, a.to[0], a.to[1]);
    if (a.target) await tile(page, p, a.target[0], a.target[1]);
    else if (moves) await tile(page, p, a.to[0], a.to[1]);
    else await page.getByRole('button', { name: 'Wait' }).click();
    s = applyAction(s, a)!;
  }
}

async function run(viewport: { width: number; height: number }, tag: string) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`);
  });
  const user = `p${tag}${Date.now() % 100000}`;

  await page.goto(`${BASE}/splash.html?user=${user}&new=1&day=${day}`);
  await page.waitForSelector('.splash-board svg');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}-01-splash.png` });

  await page.goto(`${BASE}/game.html?user=${user}&new=1&day=${day}`);
  await page.waitForSelector('.board-wrap svg');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}-02-warmup.png` });
  await tile(page, WARMUP, 0, 1);
  await page.screenshot({ path: `${OUT}/${tag}-03-warmup-moved.png` });
  await tile(page, WARMUP, 1, 1);
  await page.screenshot({ path: `${OUT}/${tag}-04-warmup-ready.png` });
  await page.getByRole('button', { name: 'Strike' }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${tag}-05-striking.png` });
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-06-warmup-win.png` });
  await page.getByRole('button', { name: /Begin today/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${tag}-07-daily.png` });

  const s = trialFor(season, day);
  const ways = solve(s.puzzle).ways;
  // A wrong turn first, to see the loss sheet.
  await page.getByRole('button', { name: 'Strike' }).click();
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-08-loss.png` });
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.waitForTimeout(300);

  await playLine(page, s.puzzle, ways[0]!.line);
  await page.screenshot({ path: `${OUT}/${tag}-09-daily-ready.png` });
  await page.getByRole('button', { name: 'Strike' }).click();
  await page.waitForTimeout(420);
  await page.screenshot({ path: `${OUT}/${tag}-09b-daily-striking.png` });
  await page.waitForTimeout(560);
  await page.screenshot({ path: `${OUT}/${tag}-09c-daily-falling.png` });
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}-10-daily-win.png`, fullPage: false });
  await page.locator('.sheet').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${tag}-11-daily-win-scrolled.png` });

  await page.goto(`${BASE}/game.html?user=${user}&day=${day}`);
  await page.waitForSelector('.board-wrap svg');
  await page.getByRole('button', { name: 'How to play' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}-12-help.png` });
  await browser.close();
}

await run({ width: 390, height: 780 }, 'phone');
await run({ width: 1024, height: 768 }, 'desk');
// Inline feed card sizes for the splash.
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
for (const [w, h, tag] of [
  [400, 520, 'inline-phone'],
  [640, 520, 'inline-desk'],
] as const) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  await page.goto(`${BASE}/splash.html?user=viewer&day=${day}`);
  await page.waitForSelector('.splash-board svg');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${tag}.png` });
}
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
