// Mobile validation against the local preview with touch input: a Galaxy S24-sized phone, the same phone inside Reddit's
// expanded view (minus Reddit's chrome), a small 360 x 640 phone and a 1024 x 768 laptop window. Plays the warm-up and today's trial with taps,
// exercises Undo and Wait, opens help, and checks that nothing scrolls or spills out of the viewport.
// Needs `npm run local`. Usage: npx tsx tools/device-check.ts
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { dayNumber } from '../src/shared/engine/generator';
import { applyAction, initialState, type Action, type Puzzle } from '../src/shared/engine/rules';
import { solve } from '../src/shared/engine/solver';
import { trialFor, type SeasonDay } from '../src/shared/game';
import { findNudge } from '../src/shared/nudge';
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

async function boardTop(page: Page) {
  return (await page.locator('.board-wrap svg').boundingBox())?.y ?? -1;
}

/** Plays a line. With `steady`, also checks after every tap that the board has not moved, since a moving board
 *  makes the next tap land on the wrong tile (it did twice on a real phone: the intro line and the hint line). */
async function playLine(page: Page, p: Puzzle, line: Action[], steady?: { label: string; top: number }) {
  let s = initialState(p);
  const tap = async (x: number, y: number) => {
    await tapTile(page, p, x, y);
    if (!steady) return;
    const top = await boardTop(page);
    if (Math.abs(top - steady.top) > 0.5) findings.push(`${steady.label}: the board moved ${Math.round(top - steady.top)} px after a tap`);
    steady.top = top; // report each move once
  };
  for (const a of line) {
    const h = s.units.find((u) => u.id === a.hero)!;
    const moves = a.to[0] !== h.x || a.to[1] !== h.y;
    await tap(h.x, h.y);
    if (moves) await tap(a.to[0], a.to[1]);
    if (a.target) await tap(a.target[0], a.target[1]);
    else if (moves) await tap(a.to[0], a.to[1]);
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

  // Stuck: three failed strikes offer a nudge, which marks a legal first step and explains it, until that hero acts.
  const s = trialFor(season, day);
  for (let i = 0; i < 3; i++) {
    if (i > 0) await tapButton(page, 'Start over');
    await tapButton(page, 'Strike');
    await page.waitForSelector('.sheet h2');
    await page.waitForTimeout(300);
  }
  if (!(await page.getByRole('button', { name: /Show me a first step/ }).count())) findings.push(`${tag}: no nudge offered after three failed tries`);
  else {
    await tapButton(page, /Show me a first step/);
    await page.waitForSelector('.nudge', { timeout: 10_000 }).catch(() => findings.push(`${tag}: the nudge did not appear on the board`));
    const hintText = (await page.locator('.hint').textContent()) ?? '';
    if (!hintText.startsWith('First step:')) findings.push(`${tag}: the hint row does not explain the nudge ("${hintText}")`);
    await page.screenshot({ path: `${OUT}/${tag}-3b-nudge.png` });
    const n = findNudge(s.puzzle, []);
    if (n) {
      const moves = n.to[0] !== n.from[0] || n.to[1] !== n.from[1];
      await tapTile(page, s.puzzle, n.from[0], n.from[1]);
      if (moves) await tapTile(page, s.puzzle, n.to[0], n.to[1]);
      if (n.target) await tapTile(page, s.puzzle, n.target[0], n.target[1]);
      else if (moves) await tapTile(page, s.puzzle, n.to[0], n.to[1]);
      else await tapButton(page, 'Wait');
      if (await page.locator('.nudge').count()) findings.push(`${tag}: the nudge stayed on the board after its hero acted`);
      await tapButton(page, 'Undo');
    }
  }

  const ways = solve(s.puzzle).ways;
  const steady = { label: tag, top: await boardTop(page) };
  await playLine(page, s.puzzle, ways[ways.length - 1]!.line, steady);
  const ready = await page.locator('.btn.primary.ready').count();
  if (!ready) findings.push(`${tag}: forecast did not turn gold before Strike on a winning line`);
  await page.screenshot({ path: `${OUT}/${tag}-4-ready.png` });
  await tapButton(page, 'Strike');
  if (Math.abs((await boardTop(page)) - steady.top) > 0.5) findings.push(`${tag}: the board moved when Strike was pressed`);
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}-5-win.png` });
  const title = await page.locator('.sheet h2').textContent();
  if (title !== 'The field is clear') findings.push(`${tag}: expected a win sheet, got "${title}"`);
  // The result sheet itself may scroll inside, but the page must not.
  await fits(page, `${tag} result`);

  // Next steps: a chalk mark is left once (the button says so and the server refuses a repeat), and Join stays hidden until judging.
  await tapButton(page, 'Leave a chalk mark');
  await page.waitForTimeout(300);
  const chalkBtn = page.getByRole('button', { name: 'Chalk mark left' });
  if (!(await chalkBtn.count()) || !(await chalkBtn.isDisabled())) findings.push(`${tag}: the chalk mark button did not change to a disabled "Chalk mark left"`);
  const again = await page.evaluate(async () => (await fetch(`/api/chalk${location.search}`, { method: 'POST' })).status);
  if (again !== 409) findings.push(`${tag}: a second chalk mark for the same ways was not refused (status ${again})`);
  // Join is off until judging (the demo subreddit must stay under 200 members).
  if (await page.getByRole('button', { name: /^Join r\// }).count()) findings.push(`${tag}: the Join button is back before judging`);
  if (!(await page.locator('.next-trial').textContent())?.match(/next trial goes up in \d/)) findings.push(`${tag}: no time for the next trial on the win sheet`);

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

/** A redditor who is not logged in: the warm-up shows, the win shows, nothing is saved, and Log in is offered. */
async function runLoggedOut() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/game.html`);
  await page.waitForSelector('.board-wrap svg');
  if (!(await page.locator('.coach').count())) findings.push('logged out: no warm-up for a first-time visitor');
  await tapTile(page, WARMUP, 0, 1);
  await tapTile(page, WARMUP, 1, 1);
  await tapButton(page, 'Strike');
  await page.waitForSelector('.sheet');
  await tapButton(page, /Begin today/);
  await page.waitForTimeout(400);
  const s = trialFor(season, day);
  await playLine(page, s.puzzle, solve(s.puzzle).ways[0]!.line);
  await tapButton(page, 'Strike');
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/loggedout-win.png` });
  if (!(await page.getByRole('button', { name: 'Log in to Reddit' }).count())) findings.push('logged out: no Log in button after a win');
  if (await page.getByRole('button', { name: 'Leave a chalk mark' }).count()) findings.push('logged out: chalk mark offered to a logged-out player');
  const sheetText = (await page.locator('.sheet').textContent()) ?? '';
  if (sheetText.includes('carries your name')) findings.push('logged out: told the way carries their name, but nothing was saved');
  if (await page.locator('.badge-first').count()) findings.push('logged out: shown the first-finder badge without being saved');
  if (await page.locator('.stat-row').count()) findings.push('logged out: shown saved stats (ways, streak) that do not exist');
  for (const e of errors) findings.push(`logged out: page error: ${e}`);
  await browser.close();
}

/** An older day's post: the card still fits, and it points at today's trial, which is where the link goes. */
async function runOldPost() {
  if (day < 2) return;
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 512 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/splash.html?user=old${Date.now() % 100000}&day=${day - 1}`);
  await page.waitForSelector('.splash-board svg');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/old-post-card.png` });
  if (await page.evaluate(() => (document.scrollingElement?.scrollHeight ?? 0) > window.innerHeight + 1)) findings.push('old post: the feed card scrolls at 512 px tall');
  const link = page.getByRole('button', { name: new RegExp(`Today's trial is #${day}`) });
  if (!(await link.count())) findings.push('old post: no link to today’s trial on the card');
  else {
    await link.tap();
    await page.waitForURL(new RegExp(`day=${day}`), { timeout: 5000 }).catch(() => findings.push('old post: the link did not go to today’s trial'));
  }
  await browser.close();
}

await runLoggedOut();
await runOldPost();
await run('s24', { width: 412, height: 892 }, 2.625);
await run('s24-in-reddit', { width: 412, height: 780 }, 2.625);
await run('small', { width: 360, height: 640 }, 2);
// A short laptop window: the board is limited by height here, not width, which phones never exercise.
await run('laptop', { width: 1024, height: 768 }, 1);
console.log(findings.length ? `FINDINGS:\n- ${findings.join('\n- ')}` : 'no findings');
