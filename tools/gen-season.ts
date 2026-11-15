// Generate the season: one solver-checked trial per day from Day 1 (15 November 2026). Writes
// src/server/season.json, which only the server reads, so solutions never ship in the client bundle.
// Usage: npx tsx tools/gen-season.ts [days=120]
import { writeFileSync } from 'node:fs';
import { dateOfDay, generateTrial, TIERS } from '../src/shared/engine/generator';
import { makeRng } from '../src/shared/engine/rng';
import type { Puzzle } from '../src/shared/engine/rules';

export type SeasonDay = {
  day: number;
  date: string;
  tier: keyof typeof TIERS;
  puzzle: Puzzle;
  wayKeys: string[];
  winRatio: number;
};

const days = Number(process.argv[2] ?? 120);
const out: SeasonDay[] = [];
const t0 = Date.now();
for (let day = 1; day <= days; day++) {
  const { date, tier } = dateOfDay(day);
  let g = null;
  // Seeds are per day, so a single day can be regenerated without touching the rest.
  for (let salt = 0; salt < 50 && !g; salt++) {
    g = generateTrial(makeRng(day * 1_000_003 + salt), TIERS[tier], `d${day}`, 400);
  }
  if (!g) throw new Error(`No trial found for day ${day} (${tier})`);
  out.push({ day, date, tier, puzzle: g.puzzle, wayKeys: g.wayKeys, winRatio: Number(g.winRatio.toFixed(5)) });
  process.stdout.write(`day ${day} ${date} ${tier.padEnd(8)} ways=${g.ways} ratio=${g.winRatio.toFixed(4)}\n`);
}
writeFileSync('src/server/season.json', JSON.stringify(out));
console.log(`wrote ${out.length} days in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
