// Print a season day as ASCII with one example line for each way. Usage: npx tsx tools/show.ts <day>
import { readFileSync } from 'node:fs';
import { solve } from '../src/shared/engine/solver';
import type { SeasonDay } from './gen-season';

const season = JSON.parse(readFileSync('src/server/season.json', 'utf8')) as SeasonDay[];
const d = season.find((s) => s.day === Number(process.argv[2] ?? 1));
if (!d) throw new Error('no such day');
const p = d.puzzle;
const glyph: Record<string, string> = { wolf: 'W', boar: 'B', thief: 'T', acolyte: 'A' };
const arrow: Record<string, string> = { N: '^', E: '>', S: 'v', W: '<' };
const grid = p.rows.map((r) => r.split(''));
for (const l of p.lamps) grid[l.y]![l.x] = 'L';
for (const e of p.enemies) grid[e.y]![e.x] = glyph[e.mob]!;
for (const h of p.heroes) grid[h.y]![h.x] = h.cls[0]!.toUpperCase() === 'S' ? '$' : h.cls[0]!;
console.log(`Day ${d.day} ${d.date} ${d.tier}`);
console.log(grid.map((r) => r.join(' ')).join('\n'));
for (const e of p.enemies) console.log(`  ${e.id} ${e.mob}${e.hp > 1 ? ` hp${e.hp}` : ''} at ${e.x},${e.y} facing ${arrow[e.dir]}`);
for (const h of p.heroes) console.log(`  ${h.id} ${h.cls} at ${h.x},${h.y}`);
const res = solve(p);
for (const w of res.ways) {
  console.log(`way: ${w.key}`);
  for (const a of w.line) console.log(`    ${a.hero} -> ${a.to.join(',')}${a.target ? ` targets ${a.target.join(',')}` : ''}`);
}
