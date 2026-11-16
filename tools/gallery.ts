// Devpost gallery: eight 3:2 slides in the demo video's order, each a headline, a badge naming where the picture comes
// from, the capture itself, and one caption (140 characters at most, asserted here and only printed here). Captures from
// the Reddit app come from the phone (PHONE below); the week of boards and the trial builder are captured fresh from the
// local preview, which runs the shipped code. Re-run after re-shooting on r/Foefall and every slide re-renders.
// Needs `npm run local`. Usage: npx tsx tools/gallery.ts
// Output: tools/shots/gallery/N-name.png and captions.md (one fenced block per caption, nothing else in it).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { dayNumber, TIERS } from '../src/shared/engine/generator';
import { applyAction, initialState } from '../src/shared/engine/rules';
import { solve } from '../src/shared/engine/solver';
import { trialFor, type SeasonDay } from '../src/shared/game';
import { WARMUP } from '../src/shared/trials/warmup';

const BASE = 'http://127.0.0.1:5199';
const OUT = 'tools/shots/gallery';
const SRC = join(OUT, 'src');
const PHONE = 'tmp/val'; // Reddit-app captures from the Galaxy S24 (adb screencap, 1080 x 2340)
const ORVANDEL = 'C:/Users/Jon_A/OneDrive/Desktop/Projects/Time4/EpicMMO/preview/03-first-fight-telegraph.jpg';
const W = 1500;
const H = 1000;
mkdirSync(SRC, { recursive: true });
const season = JSON.parse(readFileSync('src/server/season.json', 'utf8')) as SeasonDay[];

type Img = { file: string; badge: string; crop?: { top: number; bottom: number }; rect?: { x: number; y: number; w: number; h: number } };
type Slide = {
  name: string;
  headline: string;
  sub: string;
  caption: string;
  kind: 'phone' | 'pair' | 'week';
  images: Img[];
};

// Android status and navigation bars, in source pixels: cut so the frame shows the Reddit app only.
const APP = { top: 100, bottom: 125 };

const SLIDES: Slide[] = [
  {
    name: 'feed',
    headline: 'Every monster shows where it will strike',
    sub: 'Make them strike each other. A new Foefall trial goes up in the subreddit every day, and plays inside the post.',
    caption: "Foefall in the Reddit app: today's trial drawn in the post, with its moon and how many of its ways the subreddit has found.",
    kind: 'phone',
    images: [{ file: `${PHONE}/shot-57-card2.png`, badge: 'Reddit app, Galaxy S24', crop: APP }],
  },
  {
    name: 'port',
    headline: 'Ported from Orvandel',
    sub: 'In my MMO, big attacks are marked on the ground before they land. Foefall turns that into a puzzle: same wolf, same Vanguard.',
    caption: 'Ported from Orvandel, my MMO: the Duskfield Wolf, the Vanguard and attacks marked before they land, now a daily Reddit puzzle.',
    kind: 'pair',
    images: [
      // The fight itself: the Duskfield Wolf, the Vanguard and the ring marked on the ground.
      { file: ORVANDEL, badge: 'Orvandel, my browser MMO', rect: { x: 560, y: 300, w: 860, h: 620 } },
      { file: `${PHONE}/shot-62-ready-signedin.png`, badge: 'Foefall, Reddit app', crop: APP },
    ],
  },
  {
    name: 'forecast',
    headline: 'The forecast reads every tap',
    sub: 'Red tiles are this turn’s strikes. Before you commit, it says how many monsters fall, who gets hit, and whether the lamp survives.',
    caption: 'Every red tile is a strike that will land. The forecast updates on each tap: 0 of 4 monsters fall, 1 hero struck, lamp goes out.',
    kind: 'phone',
    images: [{ file: `${PHONE}/shot-62-ready-signedin.png`, badge: 'Reddit app, Galaxy S24', crop: APP }],
  },
  {
    name: 'strike',
    headline: 'Then they all strike at once',
    sub: 'Shove, hurl, drag, swap or drop a star until every strike lands on a monster. Undo is free; only Strike counts as a try.',
    caption: 'Every strike lands true: all four monsters will fall, both heroes are safe and the lamp stays lit. Only Strike counts as a try.',
    kind: 'phone',
    images: [{ file: `${PHONE}/shot-63-ready-signedin.png`, badge: 'Reddit app, Galaxy S24', crop: APP }],
  },
  {
    name: 'first',
    headline: 'First to find it',
    sub: 'Most trials can be won more than one way. The first redditor to find each way gets their name and avatar on it.',
    caption: 'A clear on Reddit: nobody had found this way, so it carries the player’s name. The card names every strike that felled a monster.',
    kind: 'phone',
    images: [{ file: `${PHONE}/shot-64-win-signedin.png`, badge: 'Reddit app, Galaxy S24', crop: APP }],
  },
  {
    name: 'hunt',
    headline: 'The subreddit hunts every way',
    sub: 'The ways found so far and who found each first, Orvandel’s four nations to fight for, the trial builder and today’s first clears.',
    caption: 'After a clear: the hunt with each way’s first finder, the four nations’ tally and today’s first clears. Test players, local build.',
    kind: 'phone',
    images: [{ file: 'tools/shots/phone-11-daily-win-scrolled.png', badge: 'Local preview, test players' }],
  },
  {
    name: 'builder',
    headline: 'Build one for the subreddit',
    sub: 'The solver refuses a trial that wins by itself or cannot be won, and the maker has to clear it before it posts.',
    caption: 'The trial builder refuses a board that wins with nobody moving. Fixed, the solver finds one way, and the maker must clear it to post.',
    kind: 'pair',
    images: [
      // Status line and board only: the piece palette below them is not the point of this slide.
      { file: `${SRC}/forge-refused.png`, badge: 'Refused', crop: { top: 0, bottom: 640 } },
      { file: `${SRC}/forge-checked.png`, badge: 'Checked', crop: { top: 0, bottom: 640 } },
    ],
  },
  {
    name: 'week',
    headline: 'A week by the moon',
    sub: 'Gentle under the New Moon on Monday, fiendish under the Broken Moon on Saturday. 120 trials, each one checked by the solver.',
    caption: 'One week of trials from the season file, gentle on Monday to fiendish on Saturday. npm test re-solves all 120 days.',
    kind: 'week',
    images: [2, 3, 4, 5, 6, 7, 8].map((d) => ({ file: `${SRC}/week-${d}.png`, badge: weekLabel(d) })),
  },
];

function weekLabel(day: number): string {
  const t = TIERS[trialFor(season, day).tier];
  const wd = new Date(Date.UTC(2026, 10, 15) + (day - 1) * 86_400_000).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${wd}|${t.moon}|${t.feel}`;
}

// --- Checks before anything renders ------------------------------------------------------------------------------
for (const s of SLIDES) if (s.caption.length > 140) throw new Error(`${s.name}: caption is ${s.caption.length} characters, limit is 140`);
if (SLIDES.length > 8) throw new Error('eight is the ceiling; a gallery is a story, not an archive');

// --- Captures from the local preview ----------------------------------------------------------------------------
async function tapTile(page: Page, w: number, x: number, y: number) {
  const box = (await page.locator('.board-wrap svg').boundingBox())!;
  const k = box.width / (w * 100 + 8);
  await page.mouse.click(box.x + (4 + x * 100 + 50) * k, box.y + (4 + y * 100 + 50) * k);
  await page.waitForTimeout(150);
}

async function captureLocal() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2.625 });
  const page = await ctx.newPage();
  // The week: each day's board as the feed card draws it.
  for (let d = 2; d <= 8; d++) {
    await page.setViewportSize({ width: 412, height: 520 });
    await page.goto(`${BASE}/splash.html?user=gallery&day=${d}`);
    await page.waitForSelector('.splash-board svg');
    await page.waitForTimeout(200);
    await page.locator('.splash-board svg').screenshot({ path: `${SRC}/week-${d}.png` });
  }
  // The builder: a board that wins by itself is refused; moved apart, the solver finds a way.
  await page.setViewportSize({ width: 412, height: 892 });
  const user = `galleryb${Date.now() % 100000}`;
  await page.goto(`${BASE}/game.html?user=${user}&new=1`);
  await page.waitForSelector('.board-wrap svg');
  await tapTile(page, WARMUP.w, 0, 1);
  await tapTile(page, WARMUP.w, 1, 1);
  await page.getByRole('button', { name: 'Strike', exact: true }).click();
  await page.getByRole('button', { name: /Begin today/ }).click();
  await page.waitForTimeout(300);
  // Clear today's trial: the builder opens from the win card.
  const today = trialFor(season, dayNumber(Date.now())).puzzle;
  let st = initialState(today);
  for (const a of solve(today).ways[0]!.line) {
    const h = st.units.find((u) => u.id === a.hero)!;
    const moves = a.to[0] !== h.x || a.to[1] !== h.y;
    await tapTile(page, today.w, h.x, h.y);
    if (moves) await tapTile(page, today.w, a.to[0], a.to[1]);
    if (a.target) await tapTile(page, today.w, a.target[0], a.target[1]);
    else if (moves) await tapTile(page, today.w, a.to[0], a.to[1]);
    else await page.getByRole('button', { name: 'Wait', exact: true }).click();
    st = applyAction(st, a)!;
  }
  await page.getByRole('button', { name: 'Strike', exact: true }).click();
  await page.waitForSelector('.sheet h2');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Build a trial', exact: true }).click();
  await page.waitForSelector('.palette');
  const tool = (name: string) => page.getByRole('button', { name, exact: true }).click();
  await tool('Wolf');
  await tapTile(page, 6, 1, 2); // faces W
  await tapTile(page, 6, 1, 2); // N
  await tapTile(page, 6, 1, 2); // E: biting the boar next to it
  await tool('Boar');
  await tapTile(page, 6, 2, 2);
  await tool('Vanguard');
  await tapTile(page, 6, 0, 4);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SRC}/forge-refused.png` });
  await tool('Erase');
  await tapTile(page, 6, 2, 2);
  await tool('Boar');
  await tapTile(page, 6, 3, 2);
  await tool('Check');
  await page.waitForFunction(() => /can be won/.test(document.querySelector('.forecast')?.textContent ?? ''), null, { timeout: 15_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SRC}/forge-checked.png` });
  await browser.close();
}

// --- Slide composition -----------------------------------------------------------------------------------------------
const dataUri = (file: string) => {
  const ext = file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
  return `data:image/${ext};base64,${readFileSync(file).toString('base64')}`;
};
const font = (pkg: string, file: string) => `data:font/woff2;base64,${readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`).toString('base64')}`;
const FONTS = `
@font-face { font-family: 'Cormorant Unicase'; font-weight: 700; src: url(${font('cormorant-unicase', 'cormorant-unicase-latin-700-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Alegreya Sans'; font-weight: 400; src: url(${font('alegreya-sans', 'alegreya-sans-latin-400-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Alegreya Sans'; font-weight: 700; src: url(${font('alegreya-sans', 'alegreya-sans-latin-700-normal.woff2')}) format('woff2'); }`;

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A phone capture in a frame of height h, cropped to the app; source size is read from the image itself. */
function phone(img: Img, h: number, size: { w: number; h: number }): string {
  const top = img.crop?.top ?? 0;
  const bottom = img.crop?.bottom ?? 0;
  const visible = size.h - top - bottom;
  const scale = h / visible;
  const w = Math.round(size.w * scale);
  return `<figure class="shot"><div class="frame" style="width:${w}px;height:${h}px">
    <img src="${dataUri(img.file)}" style="width:${w}px;margin-top:${-Math.round(top * scale)}px" /></div>
    <figcaption class="badge">${esc(img.badge)}</figcaption></figure>`;
}

/** A landscape capture at width w, optionally cropped to a source rectangle. */
function wide(img: Img, w: number, size: { w: number; h: number }): string {
  const r = img.rect ?? { x: 0, y: 0, w: size.w, h: size.h };
  const k = w / r.w;
  return `<figure class="shot"><div class="frame wide" style="width:${w}px;height:${Math.round(r.h * k)}px">
    <img src="${dataUri(img.file)}" style="width:${Math.round(size.w * k)}px;margin:${-Math.round(r.y * k)}px 0 0 ${-Math.round(r.x * k)}px" /></div>
    <figcaption class="badge">${esc(img.badge)}</figcaption></figure>`;
}

async function imageSize(page: Page, file: string): Promise<{ w: number; h: number }> {
  return page.evaluate(async (src) => {
    const im = new Image();
    im.src = src;
    await im.decode();
    return { w: im.naturalWidth, h: im.naturalHeight };
  }, dataUri(file));
}

async function slideHtml(page: Page, s: Slide, n: number): Promise<string> {
  let art = '';
  if (s.kind === 'phone') art = phone(s.images[0]!, 820, await imageSize(page, s.images[0]!.file));
  else if (s.kind === 'pair' && s.name === 'port') {
    art = `<div class="pair">${wide(s.images[0]!, 520, await imageSize(page, s.images[0]!.file))}${phone(s.images[1]!, 780, await imageSize(page, s.images[1]!.file))}</div>`;
  } else if (s.kind === 'pair') {
    const a = await imageSize(page, s.images[0]!.file);
    art = `<div class="pair">${phone(s.images[0]!, 660, a)}${phone(s.images[1]!, 660, await imageSize(page, s.images[1]!.file))}</div>`;
  } else {
    art = s.images
      .map((im) => {
        const [wd, moon, feel] = im.badge.split('|');
        return `<div class="day"><div class="wd">${esc(wd!)}</div><img src="${dataUri(im.file)}" /><div class="moon">${esc(moon!)}</div><div class="feel">${esc(feel!)}</div></div>`;
      })
      .join('');
  }
  const textFirst = s.kind !== 'week';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
  * { box-sizing: border-box; margin: 0; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; color: #efe8d8; font-family: 'Alegreya Sans', sans-serif;
    background: radial-gradient(1200px 800px at 20% 0%, #2a1f36 0%, #150f1b 55%, #0d0a10 100%); }
  .slide { position: relative; width: 100%; height: 100%; display: flex; align-items: center; gap: 56px; padding: 0 72px; }
  .slide.week { flex-direction: column; justify-content: center; gap: 36px; padding: 0 48px; }
  .text { flex: 1; min-width: 0; }
  .num { font-family: 'Cormorant Unicase', serif; font-weight: 700; color: #8d7240; font-size: 26px; letter-spacing: .08em; }
  h1 { font-family: 'Cormorant Unicase', serif; font-weight: 700; color: #f6e1a8; font-size: 64px; line-height: 1.04; margin: 10px 0 22px; }
  .week h1 { text-align: center; margin: 0 0 8px; }
  p { font-size: 29px; line-height: 1.4; color: #c9bfd4; max-width: 620px; }
  .week p { text-align: center; max-width: 1100px; margin: 0 auto; }
  .mark { position: absolute; left: 72px; bottom: 44px; font-family: 'Cormorant Unicase', serif; font-weight: 700; color: #d9b66b; font-size: 30px; letter-spacing: .04em; }
  .week .mark { left: 48px; }
  .shot { flex: none; display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .frame { position: relative; flex: none; overflow: hidden; border-radius: 34px; border: 3px solid #4a3c56; background: #000;
    box-shadow: 0 30px 80px #000c, 0 0 0 10px #ffffff08; }
  .frame.wide { border-radius: 18px; }
  .frame img { display: block; max-width: none; }
  .badge { padding: 5px 15px; border-radius: 999px; font-size: 19px; font-weight: 700; color: #1a1208; background: #e8c77e; }
  .pair { display: flex; align-items: center; gap: 28px; flex: none; }
  .weekrow { display: flex; gap: 18px; justify-content: center; }
  .day { width: 186px; text-align: center; }
  .day img { width: 186px; height: 186px; display: block; border-radius: 10px; }
  .wd { font-family: 'Cormorant Unicase', serif; font-weight: 700; color: #f6e1a8; font-size: 30px; margin-bottom: 10px; }
  .moon { margin-top: 12px; font-size: 21px; color: #efe8d8; }
  .feel { font-size: 19px; color: #c9bfd4; }
  </style></head><body><div class="slide ${s.kind === 'week' ? 'week' : ''}">
  ${
    textFirst
      ? `<div class="text"><div class="num">${n} / ${SLIDES.length}</div><h1>${esc(s.headline)}</h1><p>${esc(s.sub)}</p></div>${art}`
      : `<div><h1>${esc(s.headline)}</h1><p>${esc(s.sub)}</p></div><div class="weekrow">${art}</div>`
  }
  <div class="mark">Foefall</div></div></body></html>`;
}

if (!process.argv.includes('--no-capture')) await captureLocal();

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const md: string[] = ['# Foefall gallery captions', '', 'One block per image, in upload order. Paste the text inside each block, nothing else.', ''];
for (const [i, s] of SLIDES.entries()) {
  const n = i + 1;
  await page.setContent(await slideHtml(page, s, n), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const file = join(OUT, `${n}-${s.name}.png`);
  await page.screenshot({ path: file });
  console.log(`ok ${file} (caption ${s.caption.length})`);
  md.push(`## ${n}. ${s.name}`, '', '```', s.caption, '```', '');
}
writeFileSync(join(OUT, 'captions.md'), md.join('\n'));
await browser.close();
console.log(`wrote ${SLIDES.length} slides and captions.md to ${OUT}`);
