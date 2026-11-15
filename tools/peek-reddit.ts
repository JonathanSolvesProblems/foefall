// Open a Reddit URL in a logged-out headless Edge and screenshot it. Usage: npx tsx tools/peek-reddit.ts <url> <out.png>
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://www.reddit.com/r/forewarned_daily_dev/';
const out = process.argv[3] ?? 'tools/shots/reddit.png';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: out });
const links = await page.$$eval('a[href*="/comments/"]', (as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))].slice(0, 10));
console.log(JSON.stringify({ title: await page.title(), links }, null, 1));
await browser.close();
